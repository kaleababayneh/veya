//! P2P OTC escrow: sellers deposit XLM/USDC priced in TRY; buyers pay TRY by FAST bank transfer
//! and unlock the crypto with a RISC Zero zkEmail proof of their Ziraat statement e-mail, verified
//! by the RISC Zero verifier router (NethermindEth/stellar-risc0-verifier) through Soroban's native
//! BN254 host functions. The escrow calls `verify(seal, image_id, sha256(journal))` on the router.
//!
//! Trust model (why a lock alone is not enough): the buyer pays TRY off-chain *after* locking, so a
//! seller who could withdraw the moment the lock expires would keep both the TRY and the crypto.
//! Therefore:
//! * `declare_paid` — the locked buyer states they have sent the TRY; the lock is extended to at least
//!   `proof_window` from that moment, during which nobody but the buyer can release it.
//! * seller bond — `bond_bps` of the amount, deposited with the offer. If the offer is released after a
//!   declared payment and the buyer later presents a valid proof (`claim_bond`, within
//!   `late_claim_window`), the bond goes to the buyer. Otherwise the seller gets it back
//!   (`withdraw_bond`, or automatically on fulfil/cancel when no claim is pending).
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
const MAX_BOND_BPS: u32 = 5_000;
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
    /// payment already declared for this lock
    AlreadyDeclared = 27,
    /// no declared payment / no late claim open for this caller
    LateClaimClosed = 28,
    /// the bond is still reserved for a possible late claim
    BondHeld = 29,
    NoBond = 30,
    InvalidBond = 31,
    /// the lock has expired (declare before it does)
    LockExpired = 32,
    /// another buyer's declared payment is still awaiting a late claim on this offer
    LateClaimPending = 33,
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
    /// seller bond still held by the escrow (same token as `amount`)
    pub bond: i128,
    /// when the locked buyer declared the TRY payment (0 = not declared)
    pub paid_declared_at: u64,
    /// who declared it (kept after a release so they can still `claim_bond`)
    pub paid_buyer: Option<Address>,
    /// `locked_at` of the lock under which the payment was declared (date window for a late claim)
    pub paid_locked_at: u64,
    /// deadline for the declared buyer's `claim_bond` after the offer was released (0 = none)
    pub late_claim_until: u64,
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
    /// seconds of protection after `declare_paid` (the lock is extended to at least this)
    pub proof_window: u64,
    /// seller bond in basis points of the offer amount
    pub bond_bps: u32,
    /// seconds after a release during which the declared buyer may still `claim_bond`
    pub late_claim_window: u64,
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
    pub bond: i128,
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
    /// non-zero when a declared payment survives the release (buyer may `claim_bond` until then)
    pub late_claim_until: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct PaymentDeclared {
    #[topic]
    pub id: u64,
    pub buyer: Address,
    pub declared_at: u64,
    /// nobody but the buyer can release the lock before this
    pub protected_until: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct BondSlashed {
    #[topic]
    pub id: u64,
    pub buyer: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct BondReturned {
    #[topic]
    pub id: u64,
    pub seller: Address,
    pub amount: i128,
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
        proof_window: u64,
        bond_bps: u32,
        late_claim_window: u64,
    ) {
        if fee_bps > MAX_FEE_BPS {
            panic_with_error!(&env, Error::InvalidFee);
        }
        if bond_bps > MAX_BOND_BPS {
            panic_with_error!(&env, Error::InvalidBond);
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
            proof_window,
            bond_bps,
            late_claim_window,
        };
        env.storage().instance().set(&DataKey::Config, &cfg);
        env.storage().instance().set(&DataKey::DkimKeys, &dkim_key_hashes);
        env.storage().instance().set(&DataKey::Tokens, &tokens);
        env.storage().instance().set(&DataKey::OfferCount, &0u64);
    }

    // ───────────────────────────── seller ─────────────────────────────

    /// Deposit `amount` of `token` plus the seller bond (`bond_bps`) and list it for `try_amount_kurus`,
    /// payable to `iban`.
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
        let bond = amount * (cfg.bond_bps as i128) / 10_000;

        token::Client::new(&env, &token).transfer(
            &seller,
            &env.current_contract_address(),
            &(amount + bond),
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
            bond,
            paid_declared_at: 0,
            paid_buyer: None,
            paid_locked_at: 0,
            late_claim_until: 0,
        };
        put_offer(&env, &offer);
        bump_instance(&env);
        OfferCreated {
            id,
            seller,
            token: offer.token.clone(),
            amount,
            try_amount_kurus,
            bond,
        }
        .publish(&env);
        Ok(id)
    }

    /// Seller withdraws an Open offer (or a Locked one whose lock — including any `declare_paid`
    /// protection — has expired). The bond comes back with the funds unless a declared payment is
    /// pending a late claim; then it stays until `late_claim_until` (see `withdraw_bond`).
    pub fn cancel_offer(env: Env, id: u64) -> Result<(), Error> {
        let mut offer = get_offer(&env, id)?;
        offer.seller.require_auth();
        let cfg = config(&env)?;
        let now = env.ledger().timestamp();
        match offer.status {
            OfferStatus::Open => {}
            OfferStatus::Locked => {
                if now < offer.lock_expires_at {
                    return Err(Error::LockActive);
                }
                release_lock(&mut offer, &cfg, now, false);
            }
            _ => return Err(Error::InvalidStatus),
        }
        offer.status = OfferStatus::Cancelled;
        let tk = token::Client::new(&env, &offer.token);
        let mut refund = offer.amount;
        if offer.bond > 0 && offer.late_claim_until <= now {
            refund += offer.bond;
            BondReturned { id, seller: offer.seller.clone(), amount: offer.bond }.publish(&env);
            offer.bond = 0;
        }
        put_offer(&env, &offer);
        tk.transfer(&env.current_contract_address(), &offer.seller, &refund);
        OfferCancelled {
            id,
            seller: offer.seller,
        }
        .publish(&env);
        Ok(())
    }

    /// Seller collects a bond that was held back for a possible late claim, once that window is over.
    pub fn withdraw_bond(env: Env, id: u64) -> Result<i128, Error> {
        let mut offer = get_offer(&env, id)?;
        offer.seller.require_auth();
        if !matches!(offer.status, OfferStatus::Cancelled | OfferStatus::Fulfilled) {
            return Err(Error::InvalidStatus);
        }
        if offer.bond <= 0 {
            return Err(Error::NoBond);
        }
        if env.ledger().timestamp() <= offer.late_claim_until {
            return Err(Error::BondHeld);
        }
        let bond = offer.bond;
        offer.bond = 0;
        put_offer(&env, &offer);
        token::Client::new(&env, &offer.token).transfer(&env.current_contract_address(), &offer.seller, &bond);
        BondReturned { id, seller: offer.seller, amount: bond }.publish(&env);
        Ok(bond)
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
                // a stale lock may be taken over; a payment declared under it keeps its late-claim right
                if now < offer.lock_expires_at {
                    return Err(Error::LockActive);
                }
                release_lock(&mut offer, &cfg, now, false);
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

    /// Buyer releases their own lock early (giving up any declared payment), or anyone releases an
    /// expired one — then a declared payment keeps its late-claim right for `late_claim_window`.
    pub fn unlock(env: Env, id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        let mut offer = get_offer(&env, id)?;
        if offer.status != OfferStatus::Locked {
            return Err(Error::InvalidStatus);
        }
        let cfg = config(&env)?;
        let now = env.ledger().timestamp();
        let is_buyer = offer.buyer.as_ref() == Some(&caller);
        let after_expiry = now >= offer.lock_expires_at;
        if !is_buyer && !after_expiry {
            return Err(Error::LockActive);
        }
        release_lock(&mut offer, &cfg, now, is_buyer);
        offer.status = OfferStatus::Open;
        put_offer(&env, &offer);
        OfferUnlocked {
            id,
            caller,
            after_expiry,
            late_claim_until: offer.late_claim_until,
        }
        .publish(&env);
        Ok(())
    }

    /// The locked buyer states that the TRY transfer has been sent. From now on nobody but the buyer can
    /// release the lock for at least `proof_window` seconds, and if the offer is nevertheless released
    /// later, a valid proof still wins the seller's bond (`claim_bond`).
    pub fn declare_paid(env: Env, id: u64, buyer: Address) -> Result<Offer, Error> {
        buyer.require_auth();
        let cfg = config(&env)?;
        let mut offer = get_offer(&env, id)?;
        if offer.status != OfferStatus::Locked {
            return Err(Error::InvalidStatus);
        }
        if offer.buyer.as_ref() != Some(&buyer) {
            return Err(Error::NotBuyer);
        }
        let now = env.ledger().timestamp();
        if now >= offer.lock_expires_at {
            return Err(Error::LockExpired);
        }
        if offer.paid_declared_at != 0 && offer.paid_buyer.as_ref() == Some(&buyer) {
            return Err(Error::AlreadyDeclared);
        }
        if offer.late_claim_until > now && offer.paid_buyer.is_some() {
            return Err(Error::LateClaimPending);
        }
        offer.paid_declared_at = now;
        offer.paid_buyer = Some(buyer.clone());
        offer.paid_locked_at = offer.locked_at;
        offer.late_claim_until = 0;
        let protected_until = now + cfg.proof_window;
        if protected_until > offer.lock_expires_at {
            offer.lock_expires_at = protected_until;
        }
        put_offer(&env, &offer);
        PaymentDeclared {
            id,
            buyer,
            declared_at: now,
            protected_until: offer.lock_expires_at,
        }
        .publish(&env);
        Ok(offer)
    }

    /// After a release (unlock by a third party or cancel) that happened despite a declared payment, the
    /// declared buyer proves the payment within `late_claim_window` and receives the seller's bond.
    pub fn claim_bond(
        env: Env,
        id: u64,
        buyer: Address,
        public_values: Bytes,
        proof: Bytes,
    ) -> Result<PaymentClaim, Error> {
        buyer.require_auth();
        let cfg = config(&env)?;
        let mut offer = get_offer(&env, id)?;
        if offer.paid_buyer.as_ref() != Some(&buyer) {
            return Err(Error::NotBuyer);
        }
        let now = env.ledger().timestamp();
        if offer.late_claim_until == 0 || now > offer.late_claim_until {
            return Err(Error::LateClaimClosed);
        }
        if offer.bond <= 0 {
            return Err(Error::NoBond);
        }
        let claim = verify_and_consume(&env, &cfg, &offer, offer.paid_locked_at, &public_values, &proof)?;
        let bond = offer.bond;
        offer.bond = 0;
        offer.late_claim_until = 0;
        put_offer(&env, &offer);
        token::Client::new(&env, &offer.token).transfer(&env.current_contract_address(), &buyer, &bond);
        BondSlashed { id, buyer, amount: bond }.publish(&env);
        Ok(claim)
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

        let claim = verify_and_consume(&env, &cfg, &offer, offer.locked_at, &public_values, &proof)?;
        let now = env.ledger().timestamp();

        // settle
        offer.status = OfferStatus::Fulfilled;
        offer.fulfilled_at = now;
        // the bond goes home with the settlement unless another buyer's declared payment may still claim it
        let claim_pending =
            offer.late_claim_until > now && offer.paid_buyer.is_some() && offer.paid_buyer.as_ref() != Some(&buyer);
        if offer.paid_buyer.as_ref() == Some(&buyer) {
            offer.late_claim_until = 0;
        }
        let mut bond_back = 0i128;
        if offer.bond > 0 && !claim_pending {
            bond_back = offer.bond;
            offer.bond = 0;
        }
        put_offer(&env, &offer);
        let fee = offer.amount * (cfg.fee_bps as i128) / 10_000;
        let payout = offer.amount - fee;
        let tk = token::Client::new(&env, &offer.token);
        if fee > 0 {
            tk.transfer(&env.current_contract_address(), &cfg.fee_recipient, &fee);
        }
        tk.transfer(&env.current_contract_address(), &buyer, &payout);
        if bond_back > 0 {
            tk.transfer(&env.current_contract_address(), &offer.seller, &bond_back);
            BondReturned { id, seller: offer.seller.clone(), amount: bond_back }.publish(&env);
        }
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
        proof_window: u64,
        bond_bps: u32,
        late_claim_window: u64,
    ) -> Result<(), Error> {
        let mut cfg = config(&env)?;
        cfg.admin.require_auth();
        if fee_bps > MAX_FEE_BPS {
            return Err(Error::InvalidFee);
        }
        if bond_bps > MAX_BOND_BPS {
            return Err(Error::InvalidBond);
        }
        cfg.verifier = verifier;
        cfg.image_id = image_id;
        cfg.domain_hash = domain_hash;
        cfg.lock_duration = lock_duration;
        cfg.fee_bps = fee_bps;
        cfg.fee_recipient = fee_recipient;
        cfg.min_try_kurus = min_try_kurus;
        cfg.max_try_kurus = max_try_kurus;
        cfg.proof_window = proof_window;
        cfg.bond_bps = bond_bps;
        cfg.late_claim_window = late_claim_window;
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

/// Clear the lock. A payment declared under it either dies with the lock (the buyer released it
/// themselves) or turns into a late-claim right for `late_claim_window` (someone else released it).
fn release_lock(offer: &mut Offer, cfg: &Config, now: u64, by_buyer: bool) {
    if offer.paid_declared_at != 0 && offer.paid_buyer.is_some() {
        if by_buyer {
            offer.paid_declared_at = 0;
            offer.paid_buyer = None;
            offer.paid_locked_at = 0;
            offer.late_claim_until = 0;
        } else {
            offer.late_claim_until = now + cfg.late_claim_window;
        }
    }
    offer.buyer = None;
    offer.locked_at = 0;
    offer.lock_expires_at = 0;
}

/// Verify a receipt against the router and check the committed values against the offer; on success the
/// nullifier is recorded (a statement row settles at most once, across all offers).
fn verify_and_consume(
    env: &Env,
    cfg: &Config,
    offer: &Offer,
    locked_at: u64,
    public_values: &Bytes,
    proof: &Bytes,
) -> Result<PaymentClaim, Error> {
    // 1. cryptographic verification: RISC Zero Groth16 receipt via the verifier router
    //    (native BN254 pairing). journal_digest = sha256(journal) per RISC Zero's ReceiptClaim.
    let journal_digest: BytesN<32> = env.crypto().sha256(public_values).into();
    let res = env.try_invoke_contract::<(), soroban_sdk::Error>(
        &cfg.verifier,
        &Symbol::new(env, "verify"),
        vec![
            env,
            proof.into_val(env),
            cfg.image_id.into_val(env),
            journal_digest.into_val(env),
        ],
    );
    if !matches!(res, Ok(Ok(()))) {
        return Err(Error::ProofInvalid);
    }

    // 2. business checks on the committed values
    let claim = decode_public_values(env, public_values)?;
    if claim.offer_id != offer.id {
        return Err(Error::WrongOffer);
    }
    let keys: Vec<BytesN<32>> = env
        .storage()
        .instance()
        .get(&DataKey::DkimKeys)
        .unwrap_or(Vec::new(env));
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
    let lock_day = ((locked_at + ISTANBUL_OFFSET) / 86_400) as i64;
    let today = ((now + ISTANBUL_OFFSET) / 86_400) as i64;
    if pay_day < lock_day || pay_day > today {
        return Err(Error::DateOutOfWindow);
    }
    let nkey = DataKey::Nullifier(claim.nullifier.clone());
    if env.storage().persistent().has(&nkey) {
        return Err(Error::NullifierUsed);
    }
    env.storage().persistent().set(&nkey, &offer.id);
    env.storage()
        .persistent()
        .extend_ttl(&nkey, OFFER_TTL_THRESHOLD, OFFER_TTL_EXTEND);
    Ok(claim)
}

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
