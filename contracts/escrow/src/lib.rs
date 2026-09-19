//! P2P OTC escrow: sellers deposit XLM/USDC priced in TRY; buyers pay TRY by FAST bank transfer
//! and unlock the crypto with a RISC Zero zkEmail proof of their Ziraat statement e-mail, verified
//! by the RISC Zero verifier router (NethermindEth/stellar-risc0-verifier) through Soroban's native
//! BN254 host functions. The escrow calls `verify(seal, image_id, sha256(journal))` on the router.
//!
//! Journal committed by the guest (152 bytes, big-endian) — passed to `fulfill` as `public_values`:
//!
//! ```text
//! [  0.. 32] dkim_key_hash        sha256(DER SubjectPublicKeyInfo of the DKIM key)
//! [ 32.. 64] domain_hash          sha256(dkim d= domain, e.g. "ileti.ziraatbank.com.tr")
//! [ 64.. 96] payee_hash           sha256("zkotc/payee/v1" ‖ TRcc ‖ bank5 ‖ last6 ‖ folded name), see `payee_hash`
//! [ 96..104] amount_kurus         u64, outgoing amount in kuruş (1 TRY = 100)
//! [104..112] date_yyyymmdd        u64, statement date
//! [112..144] nullifier            unique per statement row
//! [144..152] offer_id             u64, bound to this escrow offer
//! ```
#![no_std]
// Soroban entry points take their arguments flat; constructor/config need more than 7.
#![allow(clippy::too_many_arguments)]
// generated token/verifier clients take `impl IntoVal`; borrowing is the idiomatic call form.
#![allow(clippy::needless_borrows_for_generic_args)]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token, vec,
    Address, Bytes, BytesN, Env, IntoVal, String, Symbol, Vec,
};

#[cfg(test)]
extern crate std;

pub const PUBLIC_VALUES_LEN: u32 = 152;
const IBAN_LEN: usize = 26;
const MAX_FEE_BPS: u32 = 100;
/// Statement dates are Istanbul local (UTC+3, no DST since 2016).
const ISTANBUL_OFFSET: u64 = 3 * 3600;
const DAY_LEDGERS: u32 = 17_280; // ~5s ledgers
const OFFER_TTL_THRESHOLD: u32 = 30 * DAY_LEDGERS;
const OFFER_TTL_EXTEND: u32 = 60 * DAY_LEDGERS;
const INSTANCE_TTL_THRESHOLD: u32 = 30 * DAY_LEDGERS;
const INSTANCE_TTL_EXTEND: u32 = 120 * DAY_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    Paused = 2,
    OfferNotFound = 3,
    InvalidStatus = 4,
    NotBuyer = 6,
    LockActive = 7,
    OfferExpired = 9,
    TokenNotAllowed = 10,
    InvalidPublicValues = 11,
    DkimKeyNotTrusted = 12,
    DomainMismatch = 13,
    PayeeMismatch = 14,
    AmountTooLow = 15,
    DateOutOfWindow = 16,
    NullifierUsed = 17,
    ProofInvalid = 18,
    WrongOffer = 19,
    InvalidAmount = 20,
    InvalidIban = 21,
    AmountOutOfRange = 22,
    InvalidExpiry = 23,
    InvalidFee = 25,
    InvalidName = 26,
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum OfferStatus {
    Open = 0,
    Locked = 1,
    Fulfilled = 2,
    Cancelled = 3,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Offer {
    pub id: u64,
    pub seller: Address,
    pub token: Address,
    /// token amount in the token's smallest unit (7 decimals for XLM/USDC SACs)
    pub amount: i128,
    /// fiat price the buyer must transfer, in kuruş
    pub try_amount_kurus: u64,
    /// payee IBAN shown to the buyer (normalized: uppercase, no spaces)
    pub seller_iban: String,
    /// binding checked against the proof: check digits + bank code + last 6 digits + folded name
    pub payee_hash: BytesN<32>,
    /// account holder name the buyer must type in the FAST transfer form
    pub seller_name: String,
    pub status: OfferStatus,
    pub buyer: Option<Address>,
    pub locked_at: u64,
    pub lock_expires_at: u64,
    pub created_at: u64,
    /// unix seconds after which the seller may cancel an unlocked offer (0 = never)
    pub expires_at: u64,
    pub fulfilled_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Config {
    pub admin: Address,
    /// RISC Zero verifier router (verify(seal, image_id, journal_digest))
    pub verifier: Address,
    /// RISC Zero image id of the zkEmail guest
    pub image_id: BytesN<32>,
    /// sha256 of the accepted DKIM signing domain
    pub domain_hash: BytesN<32>,
    /// seconds a buyer holds an exclusive lock
    pub lock_duration: u64,
    pub fee_bps: u32,
    pub fee_recipient: Address,
    pub paused: bool,
    pub min_try_kurus: u64,
    pub max_try_kurus: u64,
}

#[contracttype]
pub enum DataKey {
    Config,
    Tokens,
    DkimKeys,
    OfferCount,
    Offer(u64),
    Nullifier(BytesN<32>),
}

/// Decoded view of the guest's public values.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PaymentClaim {
    pub dkim_key_hash: BytesN<32>,
    pub domain_hash: BytesN<32>,
    pub payee_hash: BytesN<32>,
    pub amount_kurus: u64,
    pub date_yyyymmdd: u64,
    pub nullifier: BytesN<32>,
    pub offer_id: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct OfferCreated {
    #[topic]
    pub id: u64,
    pub seller: Address,
    pub token: Address,
    pub amount: i128,
    pub try_amount_kurus: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct OfferLocked {
    #[topic]
    pub id: u64,
    pub buyer: Address,
    pub lock_expires_at: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct OfferUnlocked {
    #[topic]
    pub id: u64,
    pub caller: Address,
    pub after_expiry: bool,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct OfferCancelled {
    #[topic]
    pub id: u64,
    pub seller: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct OfferFulfilled {
    #[topic]
    pub id: u64,
    pub buyer: Address,
    pub amount_kurus: u64,
    pub date_yyyymmdd: u64,
    pub payout: i128,
    pub fee: i128,
}

#[contract]
pub struct OtcEscrow;

#[contractimpl]
impl OtcEscrow {
    pub fn __constructor(
        env: Env,
        admin: Address,
        verifier: Address,
        image_id: BytesN<32>,
        domain_hash: BytesN<32>,
        dkim_key_hashes: Vec<BytesN<32>>,
        tokens: Vec<Address>,
        lock_duration: u64,
        fee_bps: u32,
        fee_recipient: Address,
        min_try_kurus: u64,
        max_try_kurus: u64,
    ) {
        if fee_bps > MAX_FEE_BPS {
            panic_with_error!(&env, Error::InvalidFee);
        }
        let cfg = Config {
            admin,
            verifier,
            image_id,
            domain_hash,
            lock_duration,
            fee_bps,
            fee_recipient,
            paused: false,
            min_try_kurus,
            max_try_kurus,
        };
        env.storage().instance().set(&DataKey::Config, &cfg);
        env.storage().instance().set(&DataKey::DkimKeys, &dkim_key_hashes);
        env.storage().instance().set(&DataKey::Tokens, &tokens);
        env.storage().instance().set(&DataKey::OfferCount, &0u64);
    }

    // ───────────────────────────── seller ─────────────────────────────

    /// Deposit `amount` of `token` and list it for `try_amount_kurus`, payable to `iban`.
    pub fn create_offer(
        env: Env,
        seller: Address,
        token: Address,
        amount: i128,
        try_amount_kurus: u64,
        iban: String,
        seller_name: String,
        expires_at: u64,
    ) -> Result<u64, Error> {
        seller.require_auth();
        let cfg = config(&env)?;
        if cfg.paused {
            return Err(Error::Paused);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if try_amount_kurus < cfg.min_try_kurus || try_amount_kurus > cfg.max_try_kurus {
            return Err(Error::AmountOutOfRange);
        }
        let tokens: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Tokens)
            .unwrap_or(Vec::new(&env));
        if !tokens.contains(&token) {
            return Err(Error::TokenNotAllowed);
        }
        let now = env.ledger().timestamp();
        if expires_at != 0 && expires_at <= now {
            return Err(Error::InvalidExpiry);
        }
        let iban_norm = normalize_iban(&env, &iban)?;
        if seller_name.is_empty() || seller_name.len() > 64 {
            return Err(Error::InvalidName);
        }
        let payee = payee_hash(&env, &iban_norm, &seller_name);

        token::Client::new(&env, &token).transfer(
            &seller,
            &env.current_contract_address(),
            &amount,
        );

        let id: u64 = env.storage().instance().get(&DataKey::OfferCount).unwrap_or(0) + 1;
        env.storage().instance().set(&DataKey::OfferCount, &id);
        let offer = Offer {
            id,
            seller: seller.clone(),
            token,
            amount,
            try_amount_kurus,
            seller_iban: iban_norm,
            payee_hash: payee,
            seller_name,
            status: OfferStatus::Open,
            buyer: None,
            locked_at: 0,
            lock_expires_at: 0,
            created_at: now,
            expires_at,
            fulfilled_at: 0,
        };
        put_offer(&env, &offer);
        bump_instance(&env);
        OfferCreated {
            id,
            seller,
            token: offer.token.clone(),
            amount,
            try_amount_kurus,
        }
        .publish(&env);
        Ok(id)
    }

    /// Seller withdraws an Open offer (or a Locked one whose lock has expired).
    pub fn cancel_offer(env: Env, id: u64) -> Result<(), Error> {
        let mut offer = get_offer(&env, id)?;
        offer.seller.require_auth();
        let now = env.ledger().timestamp();
        match offer.status {
            OfferStatus::Open => {}
            OfferStatus::Locked => {
                if now < offer.lock_expires_at {
                    return Err(Error::LockActive);
                }
            }
            _ => return Err(Error::InvalidStatus),
        }
        offer.status = OfferStatus::Cancelled;
        offer.buyer = None;
        put_offer(&env, &offer);
        token::Client::new(&env, &offer.token).transfer(
            &env.current_contract_address(),
            &offer.seller,
            &offer.amount,
        );
        OfferCancelled {
            id,
            seller: offer.seller,
        }
        .publish(&env);
        Ok(())
    }

    // ───────────────────────────── buyer ─────────────────────────────

    /// Buyer takes an exclusive lock so nobody else can claim while they pay.
    pub fn lock(env: Env, id: u64, buyer: Address) -> Result<Offer, Error> {
        buyer.require_auth();
        let cfg = config(&env)?;
        if cfg.paused {
            return Err(Error::Paused);
        }
        let mut offer = get_offer(&env, id)?;
        let now = env.ledger().timestamp();
        match offer.status {
            OfferStatus::Open => {}
            OfferStatus::Locked => {
                // a stale lock may be taken over
                if now < offer.lock_expires_at {
                    return Err(Error::LockActive);
                }
            }
            _ => return Err(Error::InvalidStatus),
        }
        if offer.expires_at != 0 && now >= offer.expires_at {
            return Err(Error::OfferExpired);
        }
        offer.status = OfferStatus::Locked;
        offer.buyer = Some(buyer.clone());
        offer.locked_at = now;
        offer.lock_expires_at = now + cfg.lock_duration;
        put_offer(&env, &offer);
        OfferLocked {
            id,
            buyer,
            lock_expires_at: offer.lock_expires_at,
        }
        .publish(&env);
        Ok(offer)
    }

    /// Buyer releases their own lock early (or anyone releases an expired one).
    pub fn unlock(env: Env, id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        let mut offer = get_offer(&env, id)?;
        if offer.status != OfferStatus::Locked {
            return Err(Error::InvalidStatus);
        }
        let now = env.ledger().timestamp();
        let is_buyer = offer.buyer.as_ref() == Some(&caller);
        let after_expiry = now >= offer.lock_expires_at;
        if !is_buyer && !after_expiry {
            return Err(Error::LockActive);
        }
        offer.status = OfferStatus::Open;
        offer.buyer = None;
        offer.locked_at = 0;
        offer.lock_expires_at = 0;
        put_offer(&env, &offer);
        OfferUnlocked {
            id,
            caller,
            after_expiry,
        }
        .publish(&env);
        Ok(())
    }

    /// Buyer proves the TRY payment and receives the crypto.
    pub fn fulfill(
        env: Env,
        id: u64,
        buyer: Address,
        public_values: Bytes,
        proof: Bytes,
    ) -> Result<PaymentClaim, Error> {
        buyer.require_auth();
        let cfg = config(&env)?;
        let mut offer = get_offer(&env, id)?;
        if offer.status != OfferStatus::Locked {
            return Err(Error::InvalidStatus);
        }
        if offer.buyer.as_ref() != Some(&buyer) {
            return Err(Error::NotBuyer);
        }

        // 1. cryptographic verification: RISC Zero Groth16 receipt via the verifier router
        //    (native BN254 pairing). journal_digest = sha256(journal) per RISC Zero's ReceiptClaim.
        let journal_digest: BytesN<32> = env.crypto().sha256(&public_values).into();
        let res = env.try_invoke_contract::<(), soroban_sdk::Error>(
            &cfg.verifier,
            &Symbol::new(&env, "verify"),
            vec![
                &env,
                proof.into_val(&env),
                cfg.image_id.into_val(&env),
                journal_digest.into_val(&env),
            ],
        );
        if !matches!(res, Ok(Ok(()))) {
            return Err(Error::ProofInvalid);
        }

        // 2. business checks on the committed values
        let claim = decode_public_values(&env, &public_values)?;
        if claim.offer_id != id {
            return Err(Error::WrongOffer);
        }
        let keys: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&DataKey::DkimKeys)
            .unwrap_or(Vec::new(&env));
        if !keys.contains(&claim.dkim_key_hash) {
            return Err(Error::DkimKeyNotTrusted);
        }
        if claim.domain_hash != cfg.domain_hash {
            return Err(Error::DomainMismatch);
        }
        if claim.payee_hash != offer.payee_hash {
            return Err(Error::PayeeMismatch);
        }
        if claim.amount_kurus < offer.try_amount_kurus {
            return Err(Error::AmountTooLow);
        }
        let now = env.ledger().timestamp();
        let pay_day = days_from_yyyymmdd(claim.date_yyyymmdd).ok_or(Error::InvalidPublicValues)?;
        let lock_day = ((offer.locked_at + ISTANBUL_OFFSET) / 86_400) as i64;
        let today = ((now + ISTANBUL_OFFSET) / 86_400) as i64;
        if pay_day < lock_day || pay_day > today {
            return Err(Error::DateOutOfWindow);
        }
        let nkey = DataKey::Nullifier(claim.nullifier.clone());
        if env.storage().persistent().has(&nkey) {
            return Err(Error::NullifierUsed);
        }
        env.storage().persistent().set(&nkey, &id);
        env.storage()
            .persistent()
            .extend_ttl(&nkey, OFFER_TTL_THRESHOLD, OFFER_TTL_EXTEND);

        // 3. settle
        offer.status = OfferStatus::Fulfilled;
        offer.fulfilled_at = now;
        put_offer(&env, &offer);
        let fee = offer.amount * (cfg.fee_bps as i128) / 10_000;
        let payout = offer.amount - fee;
        let tk = token::Client::new(&env, &offer.token);
        if fee > 0 {
            tk.transfer(&env.current_contract_address(), &cfg.fee_recipient, &fee);
        }
        tk.transfer(&env.current_contract_address(), &buyer, &payout);
        bump_instance(&env);
        OfferFulfilled {
            id,
            buyer,
            amount_kurus: claim.amount_kurus,
            date_yyyymmdd: claim.date_yyyymmdd,
            payout,
            fee,
        }
        .publish(&env);
        Ok(claim)
    }

    // ───────────────────────────── views ─────────────────────────────

    pub fn get_offer(env: Env, id: u64) -> Result<Offer, Error> {
        get_offer(&env, id)
    }

    pub fn offer_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::OfferCount).unwrap_or(0)
    }

    /// Offers with ids in `[start, start+limit)` that exist (newest ids are highest).
    pub fn list_offers(env: Env, start: u64, limit: u32) -> Vec<Offer> {
        let mut out = Vec::new(&env);
        let count: u64 = env.storage().instance().get(&DataKey::OfferCount).unwrap_or(0);
        let mut id = if start == 0 { 1 } else { start };
        while id <= count && out.len() < limit {
            if let Some(o) = env.storage().persistent().get::<_, Offer>(&DataKey::Offer(id)) {
                out.push_back(o);
            }
            id += 1;
        }
        out
    }

    pub fn config(env: Env) -> Result<Config, Error> {
        config(&env)
    }

    pub fn tokens(env: Env) -> Vec<Address> {
        env.storage().instance().get(&DataKey::Tokens).unwrap_or(Vec::new(&env))
    }

    pub fn dkim_keys(env: Env) -> Vec<BytesN<32>> {
        env.storage().instance().get(&DataKey::DkimKeys).unwrap_or(Vec::new(&env))
    }

    pub fn is_nullifier_used(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage().persistent().has(&DataKey::Nullifier(nullifier))
    }

    /// Pure helper so clients can preview how the contract reads public values.
    pub fn decode_claim(env: Env, public_values: Bytes) -> Result<PaymentClaim, Error> {
        decode_public_values(&env, &public_values)
    }

    /// Payee binding hash for a full IBAN + name, exactly as the guest derives it from a masked dekont.
    pub fn payee_hash(env: Env, iban: String, name: String) -> Result<BytesN<32>, Error> {
        let norm = normalize_iban(&env, &iban)?;
        Ok(payee_hash(&env, &norm, &name))
    }

    // ───────────────────────────── admin ─────────────────────────────

    pub fn set_paused(env: Env, paused: bool) -> Result<(), Error> {
        let mut cfg = config(&env)?;
        cfg.admin.require_auth();
        cfg.paused = paused;
        env.storage().instance().set(&DataKey::Config, &cfg);
        Ok(())
    }

    pub fn set_dkim_keys(env: Env, keys: Vec<BytesN<32>>) -> Result<(), Error> {
        config(&env)?.admin.require_auth();
        env.storage().instance().set(&DataKey::DkimKeys, &keys);
        Ok(())
    }

    pub fn set_tokens(env: Env, tokens: Vec<Address>) -> Result<(), Error> {
        config(&env)?.admin.require_auth();
        env.storage().instance().set(&DataKey::Tokens, &tokens);
        Ok(())
    }

    pub fn set_config(
        env: Env,
        verifier: Address,
        image_id: BytesN<32>,
        domain_hash: BytesN<32>,
        lock_duration: u64,
        fee_bps: u32,
        fee_recipient: Address,
        min_try_kurus: u64,
        max_try_kurus: u64,
    ) -> Result<(), Error> {
        let mut cfg = config(&env)?;
        cfg.admin.require_auth();
        if fee_bps > MAX_FEE_BPS {
            return Err(Error::InvalidFee);
        }
        cfg.verifier = verifier;
        cfg.image_id = image_id;
        cfg.domain_hash = domain_hash;
        cfg.lock_duration = lock_duration;
        cfg.fee_bps = fee_bps;
        cfg.fee_recipient = fee_recipient;
        cfg.min_try_kurus = min_try_kurus;
        cfg.max_try_kurus = max_try_kurus;
        env.storage().instance().set(&DataKey::Config, &cfg);
        Ok(())
    }

    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let mut cfg = config(&env)?;
        cfg.admin.require_auth();
        cfg.admin = new_admin;
        env.storage().instance().set(&DataKey::Config, &cfg);
        Ok(())
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        config(&env)?.admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }
}

// ───────────────────────────── internals ─────────────────────────────

fn config(env: &Env) -> Result<Config, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(Error::NotInitialized)
}

fn get_offer(env: &Env, id: u64) -> Result<Offer, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Offer(id))
        .ok_or(Error::OfferNotFound)
}

fn put_offer(env: &Env, offer: &Offer) {
    let key = DataKey::Offer(offer.id);
    env.storage().persistent().set(&key, offer);
    env.storage()
        .persistent()
        .extend_ttl(&key, OFFER_TTL_THRESHOLD, OFFER_TTL_EXTEND);
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND);
}

/// Uppercase, strip spaces, require `TR` + 24 digits.
fn normalize_iban(env: &Env, iban: &String) -> Result<String, Error> {
    let len = iban.len() as usize;
    if iban.is_empty() || len > 64 {
        return Err(Error::InvalidIban);
    }
    let mut raw = [0u8; 64];
    iban.copy_into_slice(&mut raw[..len]);
    let mut norm = [0u8; IBAN_LEN];
    let mut n = 0usize;
    for &c in raw[..len].iter() {
        if c == b' ' {
            continue;
        }
        if n >= IBAN_LEN {
            return Err(Error::InvalidIban);
        }
        norm[n] = c.to_ascii_uppercase();
        n += 1;
    }
    if n != IBAN_LEN || &norm[..2] != b"TR" || !norm[2..].iter().all(|c| c.is_ascii_digit()) {
        return Err(Error::InvalidIban);
    }
    Ok(String::from_bytes(env, &norm))
}

const PAYEE_DOMAIN: &[u8] = b"zkotc/payee/v1";

/// sha256(PAYEE_DOMAIN ‖ iban[0..4] ‖ iban[4..9] ‖ iban[20..26] ‖ fold_name(name)) — mirrors `zkotc_lib::payee`.
fn payee_hash(env: &Env, iban_norm: &String, name: &String) -> BytesN<32> {
    let mut iban = [0u8; IBAN_LEN];
    iban_norm.copy_into_slice(&mut iban);
    let mut pre = Bytes::from_slice(env, PAYEE_DOMAIN);
    pre.extend_from_slice(&iban[0..4]);
    pre.extend_from_slice(&iban[4..9]);
    pre.extend_from_slice(&iban[20..26]);
    let mut raw = [0u8; 64];
    let n = name.len() as usize;
    name.copy_into_slice(&mut raw[..n]);
    let mut folded = [0u8; 64];
    let m = fold_name(&raw[..n], &mut folded);
    pre.extend_from_slice(&folded[..m]);
    env.crypto().sha256(&pre).into()
}

/// Uppercase ASCII, Turkish letters folded (Ç→C Ğ→G İ/ı→I Ö→O Ş→S Ü→U), whitespace collapsed to
/// single spaces, trimmed. Operates on UTF-8 bytes; must match `zkotc_lib::payee::fold_name`.
fn fold_name(input: &[u8], out: &mut [u8; 64]) -> usize {
    let mut n = 0usize;
    let mut pending_space = false;
    let mut i = 0usize;
    let mut push = |b: u8, n: &mut usize, pending: &mut bool| {
        if *pending && *n < 64 {
            out[*n] = b' ';
            *n += 1;
            *pending = false;
        }
        if *n < 64 {
            out[*n] = b;
            *n += 1;
        }
    };
    while i < input.len() {
        let b = input[i];
        // two-byte UTF-8 Turkish letters
        if i + 1 < input.len() {
            let mapped = match (b, input[i + 1]) {
                (0xC3, 0x87) | (0xC3, 0xA7) => Some(b'C'), // Ç ç
                (0xC4, 0x9E) | (0xC4, 0x9F) => Some(b'G'), // Ğ ğ
                (0xC4, 0xB0) | (0xC4, 0xB1) => Some(b'I'), // İ ı
                (0xC3, 0x96) | (0xC3, 0xB6) => Some(b'O'), // Ö ö
                (0xC5, 0x9E) | (0xC5, 0x9F) => Some(b'S'), // Ş ş
                (0xC3, 0x9C) | (0xC3, 0xBC) => Some(b'U'), // Ü ü
                _ => None,
            };
            if let Some(m) = mapped {
                push(m, &mut n, &mut pending_space);
                i += 2;
                continue;
            }
        }
        if b == b' ' || b == b'\t' || b == b'\n' || b == b'\r' {
            pending_space = n > 0;
        } else {
            push(b.to_ascii_uppercase(), &mut n, &mut pending_space);
        }
        i += 1;
    }
    n
}

fn decode_public_values(env: &Env, pv: &Bytes) -> Result<PaymentClaim, Error> {
    if pv.len() != PUBLIC_VALUES_LEN {
        return Err(Error::InvalidPublicValues);
    }
    let b32 = |s: u32| -> BytesN<32> {
        let mut a = [0u8; 32];
        pv.slice(s..s + 32).copy_into_slice(&mut a);
        BytesN::from_array(env, &a)
    };
    let u64_at = |s: u32| -> u64 {
        let mut a = [0u8; 8];
        pv.slice(s..s + 8).copy_into_slice(&mut a);
        u64::from_be_bytes(a)
    };
    Ok(PaymentClaim {
        dkim_key_hash: b32(0),
        domain_hash: b32(32),
        payee_hash: b32(64),
        amount_kurus: u64_at(96),
        date_yyyymmdd: u64_at(104),
        nullifier: b32(112),
        offer_id: u64_at(144),
    })
}

/// yyyymmdd -> days since 1970-01-01 (Howard Hinnant's days_from_civil), None if malformed.
fn days_from_yyyymmdd(v: u64) -> Option<i64> {
    let y = (v / 10_000) as i64;
    let m = ((v / 100) % 100) as i64;
    let d = (v % 100) as i64;
    if !(1970..=2200).contains(&y) || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

#[cfg(test)]
mod test;
