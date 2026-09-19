//! zkOTC escrow v5 — a P2P market (Binance-P2P / zkP2P style) for TRY ⇄ XLM/USDC on Stellar.
//!
//! * **Makers post ads**: a deposit of `token`, a price in kuruş per whole token, min/max TRY per trade,
//!   and where to pay — committed on-chain as `payee_hash` and stored only *encrypted* (`payee_blob`,
//!   sealed to the reveal service's key); a buyer learns the IBAN and name only after reserving.
//! * **Takers reserve any amount** within the limits: the reservation fixes `try_amount_kurus` at the
//!   maker's price, locks that slice of the ad, and is settled with a RISC Zero zkEmail proof of
//!   Ziraat's DKIM-signed e-dekont e-mail, verified by the RISC Zero verifier router (NethermindEth)
//!   through Soroban's native BN254 host functions: `verify(seal, image_id, sha256(journal))`.
//!
//! Trust model (unchanged from v4): the buyer pays off-chain after reserving, so `declare_paid`
//! extends the lock to at least `proof_window` during which only the buyer can release it; every ad
//! carries a bond pool (`bond_bps` of the deposit) and each reservation earmarks its slice — if a
//! declared reservation is released anyway, the buyer's valid proof takes the slice within
//! `late_claim_window` (`claim_bond`), otherwise it returns to the pool (`reclaim_bond`). Proofs are
//! bound to the reservation id and to the claiming wallet through the payment reference the buyer
//! types into the FAST description (`payment_reference`).
//!
//! Journal committed by the guest (184 bytes, big-endian) — `public_values` of `settle`/`claim_bond`:
//!
//! ```text
//! [  0.. 32] dkim_key_hash        sha256(DER SubjectPublicKeyInfo of the DKIM key)
//! [ 32.. 64] domain_hash          sha256(dkim d= domain, e.g. "ileti.ziraatbank.com.tr")
//! [ 64.. 96] payee_hash           sha256("zkotc/payee/v1" ‖ TRcc ‖ bank5 ‖ last6 ‖ folded name), see `payee_hash`
//! [ 96..104] amount_kurus         u64, outgoing amount in kuruş (1 TRY = 100)
//! [104..112] date_yyyymmdd        u64, statement date
//! [112..144] nullifier            unique per statement row
//! [144..152] reservation_id       u64, bound to this reservation
//! [152..184] reference_hash       sha256("ZKOTC <reservation id> <6 hex of sha256(claiming wallet)>")
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

pub const PUBLIC_VALUES_LEN: u32 = 184;
const IBAN_LEN: usize = 26;
const MAX_FEE_BPS: u32 = 100;
const MAX_BOND_BPS: u32 = 5_000;
const MAX_BLOB_LEN: u32 = 512;
const MAX_NICKNAME_LEN: u32 = 24;
/// Statement dates are Istanbul local (UTC+3, no DST since 2016).
const ISTANBUL_OFFSET: u64 = 3 * 3600;
const DAY_LEDGERS: u32 = 17_280; // ~5s ledgers
const TTL_THRESHOLD: u32 = 30 * DAY_LEDGERS;
const TTL_EXTEND: u32 = 60 * DAY_LEDGERS;
const INSTANCE_TTL_THRESHOLD: u32 = 30 * DAY_LEDGERS;
const INSTANCE_TTL_EXTEND: u32 = 120 * DAY_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    Paused = 2,
    AdNotFound = 3,
    InvalidStatus = 4,
    ReservationNotFound = 5,
    NotBuyer = 6,
    LockActive = 7,
    NotSeller = 8,
    AdExpired = 9,
    TokenNotAllowed = 10,
    InvalidPublicValues = 11,
    DkimKeyNotTrusted = 12,
    DomainMismatch = 13,
    PayeeMismatch = 14,
    AmountTooLow = 15,
    DateOutOfWindow = 16,
    NullifierUsed = 17,
    ProofInvalid = 18,
    WrongReservation = 19,
    InvalidAmount = 20,
    InvalidIban = 21,
    /// the trade's TRY value is outside the ad's (or the deployment's) min/max
    AmountOutOfRange = 22,
    InvalidExpiry = 23,
    /// the ad does not have that much unreserved liquidity
    InsufficientLiquidity = 24,
    InvalidFee = 25,
    InvalidName = 26,
    AlreadyDeclared = 27,
    LateClaimClosed = 28,
    BondHeld = 29,
    NoBond = 30,
    InvalidBond = 31,
    LockExpired = 32,
    /// the ad or the buyer already has the maximum number of active reservations
    TooManyReservations = 33,
    ReferenceMismatch = 34,
    InvalidPrice = 35,
    InvalidLimits = 36,
    BlobTooLarge = 37,
    /// the ad's bond pool cannot back another reservation right now
    BondExhausted = 38,
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum AdStatus {
    Active = 0,
    Closed = 1,
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum ReservationStatus {
    Active = 0,
    Settled = 1,
    /// lock ended without settlement; a declared payment may still `claim_bond` until `late_claim_until`
    Released = 2,
}

/// A maker's liquidity: what is sold, at what price, in what sizes, and (encrypted) where to pay.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ad {
    pub id: u64,
    pub seller: Address,
    pub token: Address,
    /// token decimals (7 for the XLM/USDC SACs); prices are per whole token
    pub decimals: u32,
    /// kuruş per whole token (1 TRY = 100 kuruş)
    pub price_kurus: u64,
    /// per-trade TRY limits
    pub min_try_kurus: u64,
    pub max_try_kurus: u64,
    /// unreserved liquidity (token units)
    pub remaining: i128,
    /// liquidity held by active reservations
    pub reserved: i128,
    /// bond pool not earmarked by any reservation
    pub bond_available: i128,
    /// bond earmarked by reservations (active, or released with a pending late claim)
    pub bond_held: i128,
    /// binding checked against every proof: check digits + bank code + last 6 digits + folded name
    pub payee_hash: BytesN<32>,
    /// IBAN + account holder name, sealed to the reveal service's key (`Config::reveal_pubkey`);
    /// revealed off-chain only to the wallet holding a reservation, after it verifies the hash
    pub payee_blob: Bytes,
    /// public display name of the maker (no PII)
    pub nickname: String,
    pub status: AdStatus,
    pub active_reservations: u32,
    pub settled_count: u32,
    pub created_at: u64,
    /// unix seconds after which no new reservation is accepted (0 = never)
    pub expires_at: u64,
}

/// A taker's slice of an ad.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reservation {
    pub id: u64,
    pub ad_id: u64,
    pub buyer: Address,
    /// token units the buyer receives on settlement (before the protocol fee)
    pub amount: i128,
    /// TRY the buyer must transfer, fixed at the ad's price when reserving
    pub try_amount_kurus: u64,
    /// bond earmarked from the ad's pool for this reservation
    pub bond_slice: i128,
    pub status: ReservationStatus,
    pub created_at: u64,
    pub lock_expires_at: u64,
    /// when the buyer declared the TRY payment (0 = not declared)
    pub paid_declared_at: u64,
    /// deadline for the buyer's `claim_bond` after a release that ignored a declared payment (0 = none)
    pub late_claim_until: u64,
    pub settled_at: u64,
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
    /// seconds a reservation holds its slice
    pub lock_duration: u64,
    pub fee_bps: u32,
    pub fee_recipient: Address,
    pub paused: bool,
    /// deployment-wide bounds for an ad's per-trade limits
    pub min_try_kurus: u64,
    pub max_try_kurus: u64,
    /// seconds of protection after `declare_paid`
    pub proof_window: u64,
    /// maker bond in basis points of the deposit, earmarked per reservation pro rata
    pub bond_bps: u32,
    /// seconds after a release during which the declared buyer may still `claim_bond`
    pub late_claim_window: u64,
    pub max_reservations_per_ad: u32,
    pub max_active_per_buyer: u32,
    /// X25519 public key of the payee-reveal service (makers seal their IBAN + name to it)
    pub reveal_pubkey: BytesN<32>,
}

#[contracttype]
pub enum DataKey {
    Config,
    Tokens,
    DkimKeys,
    AdCount,
    Ad(u64),
    ReservationCount,
    Reservation(u64),
    Nullifier(BytesN<32>),
    ActiveCount(Address),
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
    pub reservation_id: u64,
    pub reference_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct AdCreated {
    #[topic]
    pub id: u64,
    pub seller: Address,
    pub token: Address,
    pub amount: i128,
    pub price_kurus: u64,
    pub min_try_kurus: u64,
    pub max_try_kurus: u64,
    pub bond: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct AdPriceChanged {
    #[topic]
    pub id: u64,
    pub price_kurus: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct AdClosed {
    #[topic]
    pub id: u64,
    pub seller: Address,
    pub withdrawn: i128,
    pub bond_withdrawn: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct Reserved {
    #[topic]
    pub id: u64,
    #[topic]
    pub ad_id: u64,
    pub buyer: Address,
    pub amount: i128,
    pub try_amount_kurus: u64,
    pub lock_expires_at: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct PaymentDeclared {
    #[topic]
    pub id: u64,
    pub buyer: Address,
    pub declared_at: u64,
    pub protected_until: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct Released {
    #[topic]
    pub id: u64,
    #[topic]
    pub ad_id: u64,
    pub caller: Address,
    pub after_expiry: bool,
    pub late_claim_until: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct Settled {
    #[topic]
    pub id: u64,
    #[topic]
    pub ad_id: u64,
    pub buyer: Address,
    pub amount_kurus: u64,
    pub date_yyyymmdd: u64,
    pub payout: i128,
    pub fee: i128,
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
pub struct BondReclaimed {
    #[topic]
    pub id: u64,
    #[topic]
    pub ad_id: u64,
    pub amount: i128,
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
        max_reservations_per_ad: u32,
        max_active_per_buyer: u32,
        reveal_pubkey: BytesN<32>,
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
            max_reservations_per_ad,
            max_active_per_buyer,
            reveal_pubkey,
        };
        env.storage().instance().set(&DataKey::Config, &cfg);
        env.storage().instance().set(&DataKey::DkimKeys, &dkim_key_hashes);
        env.storage().instance().set(&DataKey::Tokens, &tokens);
        env.storage().instance().set(&DataKey::AdCount, &0u64);
        env.storage().instance().set(&DataKey::ReservationCount, &0u64);
    }

    // ───────────────────────────── maker ─────────────────────────────

    /// Post an ad: deposit `amount` of `token` (plus the bond) at `price_kurus` per whole token, tradeable in
    /// slices worth `min_try_kurus..=max_try_kurus`. `payee_hash` must be `payee_hash(iban, name)` of the
    /// details sealed in `payee_blob`; buyers verify that before paying, so a mismatch only stalls the ad.
    pub fn create_ad(
        env: Env,
        seller: Address,
        token: Address,
        amount: i128,
        price_kurus: u64,
        min_try_kurus: u64,
        max_try_kurus: u64,
        payee_hash: BytesN<32>,
        payee_blob: Bytes,
        nickname: String,
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
        if price_kurus == 0 {
            return Err(Error::InvalidPrice);
        }
        if min_try_kurus == 0 || min_try_kurus > max_try_kurus || min_try_kurus < cfg.min_try_kurus || max_try_kurus > cfg.max_try_kurus {
            return Err(Error::InvalidLimits);
        }
        if payee_blob.len() > MAX_BLOB_LEN {
            return Err(Error::BlobTooLarge);
        }
        if nickname.len() > MAX_NICKNAME_LEN {
            return Err(Error::InvalidName);
        }
        let tokens: Vec<Address> = env.storage().instance().get(&DataKey::Tokens).unwrap_or(Vec::new(&env));
        if !tokens.contains(&token) {
            return Err(Error::TokenNotAllowed);
        }
        let now = env.ledger().timestamp();
        if expires_at != 0 && expires_at <= now {
            return Err(Error::InvalidExpiry);
        }
        let tk = token::Client::new(&env, &token);
        let decimals = tk.decimals();
        // the whole deposit must be worth at least one minimum trade
        if quote_kurus(amount, price_kurus, decimals) < min_try_kurus {
            return Err(Error::InvalidLimits);
        }
        let bond = amount * (cfg.bond_bps as i128) / 10_000;
        tk.transfer(&seller, &env.current_contract_address(), &(amount + bond));

        let id: u64 = env.storage().instance().get(&DataKey::AdCount).unwrap_or(0) + 1;
        env.storage().instance().set(&DataKey::AdCount, &id);
        let ad = Ad {
            id,
            seller: seller.clone(),
            token: token.clone(),
            decimals,
            price_kurus,
            min_try_kurus,
            max_try_kurus,
            remaining: amount,
            reserved: 0,
            bond_available: bond,
            bond_held: 0,
            payee_hash,
            payee_blob,
            nickname,
            status: AdStatus::Active,
            active_reservations: 0,
            settled_count: 0,
            created_at: now,
            expires_at,
        };
        put_ad(&env, &ad);
        bump_instance(&env);
        AdCreated { id, seller, token, amount, price_kurus, min_try_kurus, max_try_kurus, bond }.publish(&env);
        Ok(id)
    }

    /// Maker changes the price; reservations already taken keep their TRY amount.
    pub fn set_price(env: Env, id: u64, price_kurus: u64) -> Result<(), Error> {
        let mut ad = get_ad(&env, id)?;
        ad.seller.require_auth();
        if ad.status != AdStatus::Active {
            return Err(Error::InvalidStatus);
        }
        if price_kurus == 0 {
            return Err(Error::InvalidPrice);
        }
        ad.price_kurus = price_kurus;
        put_ad(&env, &ad);
        AdPriceChanged { id, price_kurus }.publish(&env);
        Ok(())
    }

    /// Maker withdraws all unreserved liquidity and the unearmarked bond; no new reservations. Active
    /// reservations still settle or release (their token and bond slices then go straight to the maker).
    pub fn close_ad(env: Env, id: u64) -> Result<(), Error> {
        let mut ad = get_ad(&env, id)?;
        ad.seller.require_auth();
        if ad.status != AdStatus::Active {
            return Err(Error::InvalidStatus);
        }
        let withdrawn = ad.remaining;
        let bond_withdrawn = ad.bond_available;
        ad.remaining = 0;
        ad.bond_available = 0;
        ad.status = AdStatus::Closed;
        put_ad(&env, &ad);
        let total = withdrawn + bond_withdrawn;
        if total > 0 {
            token::Client::new(&env, &ad.token).transfer(&env.current_contract_address(), &ad.seller, &total);
        }
        AdClosed { id, seller: ad.seller, withdrawn, bond_withdrawn }.publish(&env);
        Ok(())
    }

    // ───────────────────────────── taker ─────────────────────────────

    /// TRY (kuruş) a buyer pays for `amount` token units of ad `id` at its current price (rounded up).
    pub fn quote(env: Env, id: u64, amount: i128) -> Result<u64, Error> {
        let ad = get_ad(&env, id)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        Ok(quote_kurus(amount, ad.price_kurus, ad.decimals))
    }

    /// Reserve `amount` token units of ad `id`: the slice is locked for `lock_duration` and the TRY amount
    /// is fixed now. Then pay by FAST with the payment reference in the description, `declare_paid`, and
    /// `settle` with the proof.
    pub fn reserve(env: Env, id: u64, buyer: Address, amount: i128) -> Result<Reservation, Error> {
        buyer.require_auth();
        let cfg = config(&env)?;
        if cfg.paused {
            return Err(Error::Paused);
        }
        let mut ad = get_ad(&env, id)?;
        let now = env.ledger().timestamp();
        if ad.status != AdStatus::Active {
            return Err(Error::InvalidStatus);
        }
        if ad.expires_at != 0 && now >= ad.expires_at {
            return Err(Error::AdExpired);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if amount > ad.remaining {
            return Err(Error::InsufficientLiquidity);
        }
        let try_amount_kurus = quote_kurus(amount, ad.price_kurus, ad.decimals);
        if try_amount_kurus < ad.min_try_kurus || try_amount_kurus > ad.max_try_kurus {
            return Err(Error::AmountOutOfRange);
        }
        if ad.active_reservations >= cfg.max_reservations_per_ad {
            return Err(Error::TooManyReservations);
        }
        let active: u32 = env.storage().persistent().get(&DataKey::ActiveCount(buyer.clone())).unwrap_or(0);
        if active >= cfg.max_active_per_buyer {
            return Err(Error::TooManyReservations);
        }
        let bond_slice = amount * (cfg.bond_bps as i128) / 10_000;
        if bond_slice > ad.bond_available {
            return Err(Error::BondExhausted);
        }

        ad.remaining -= amount;
        ad.reserved += amount;
        ad.bond_available -= bond_slice;
        ad.bond_held += bond_slice;
        ad.active_reservations += 1;
        put_ad(&env, &ad);
        set_active_count(&env, &buyer, active + 1);

        let rid: u64 = env.storage().instance().get(&DataKey::ReservationCount).unwrap_or(0) + 1;
        env.storage().instance().set(&DataKey::ReservationCount, &rid);
        let r = Reservation {
            id: rid,
            ad_id: id,
            buyer: buyer.clone(),
            amount,
            try_amount_kurus,
            bond_slice,
            status: ReservationStatus::Active,
            created_at: now,
            lock_expires_at: now + cfg.lock_duration,
            paid_declared_at: 0,
            late_claim_until: 0,
            settled_at: 0,
        };
        put_reservation(&env, &r);
        bump_instance(&env);
        Reserved { id: rid, ad_id: id, buyer, amount, try_amount_kurus, lock_expires_at: r.lock_expires_at }.publish(&env);
        Ok(r)
    }

    /// The buyer states that the TRY transfer has been sent: nobody but the buyer can release the reservation
    /// for at least `proof_window` seconds, and a release after that still leaves `claim_bond` open.
    pub fn declare_paid(env: Env, id: u64, buyer: Address) -> Result<Reservation, Error> {
        buyer.require_auth();
        let cfg = config(&env)?;
        let mut r = get_reservation(&env, id)?;
        if r.status != ReservationStatus::Active {
            return Err(Error::InvalidStatus);
        }
        if r.buyer != buyer {
            return Err(Error::NotBuyer);
        }
        let now = env.ledger().timestamp();
        if now >= r.lock_expires_at {
            return Err(Error::LockExpired);
        }
        if r.paid_declared_at != 0 {
            return Err(Error::AlreadyDeclared);
        }
        r.paid_declared_at = now;
        let protected_until = now + cfg.proof_window;
        if protected_until > r.lock_expires_at {
            r.lock_expires_at = protected_until;
        }
        put_reservation(&env, &r);
        PaymentDeclared { id, buyer, declared_at: now, protected_until: r.lock_expires_at }.publish(&env);
        Ok(r)
    }

    /// Buyer releases early (giving up a declared payment), or anyone releases an expired reservation —
    /// then a declared payment keeps its late-claim right and the bond slice stays earmarked.
    pub fn release(env: Env, id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        let cfg = config(&env)?;
        let mut r = get_reservation(&env, id)?;
        if r.status != ReservationStatus::Active {
            return Err(Error::InvalidStatus);
        }
        let now = env.ledger().timestamp();
        let is_buyer = r.buyer == caller;
        let after_expiry = now >= r.lock_expires_at;
        if !is_buyer && !after_expiry {
            return Err(Error::LockActive);
        }
        let mut ad = get_ad(&env, r.ad_id)?;
        // liquidity goes back to the ad, or straight to the maker if the ad is closed
        ad.reserved -= r.amount;
        ad.active_reservations -= 1;
        let mut to_seller = 0i128;
        if ad.status == AdStatus::Active {
            ad.remaining += r.amount;
        } else {
            to_seller += r.amount;
        }
        if r.paid_declared_at != 0 && !is_buyer {
            r.late_claim_until = now + cfg.late_claim_window;
        } else {
            // no claim possible: the bond slice is free again
            ad.bond_held -= r.bond_slice;
            if ad.status == AdStatus::Active {
                ad.bond_available += r.bond_slice;
            } else {
                to_seller += r.bond_slice;
            }
            r.bond_slice = 0;
            r.paid_declared_at = 0;
        }
        r.status = ReservationStatus::Released;
        r.lock_expires_at = 0;
        put_reservation(&env, &r);
        put_ad(&env, &ad);
        dec_active_count(&env, &r.buyer);
        if to_seller > 0 {
            token::Client::new(&env, &ad.token).transfer(&env.current_contract_address(), &ad.seller, &to_seller);
        }
        Released { id, ad_id: r.ad_id, caller, after_expiry, late_claim_until: r.late_claim_until }.publish(&env);
        Ok(())
    }

    /// Buyer proves the TRY payment and receives the reserved tokens (minus the protocol fee).
    pub fn settle(env: Env, id: u64, buyer: Address, public_values: Bytes, proof: Bytes) -> Result<PaymentClaim, Error> {
        buyer.require_auth();
        let cfg = config(&env)?;
        let mut r = get_reservation(&env, id)?;
        if r.status != ReservationStatus::Active {
            return Err(Error::InvalidStatus);
        }
        if r.buyer != buyer {
            return Err(Error::NotBuyer);
        }
        let mut ad = get_ad(&env, r.ad_id)?;
        let claim = verify_and_consume(&env, &cfg, &ad, &r, &buyer, &public_values, &proof)?;
        let now = env.ledger().timestamp();

        r.status = ReservationStatus::Settled;
        r.settled_at = now;
        r.lock_expires_at = 0;
        ad.reserved -= r.amount;
        ad.active_reservations -= 1;
        ad.settled_count += 1;
        // the bond slice served its purpose
        ad.bond_held -= r.bond_slice;
        let mut bond_to_seller = 0i128;
        if ad.status == AdStatus::Active {
            ad.bond_available += r.bond_slice;
        } else {
            bond_to_seller = r.bond_slice;
        }
        r.bond_slice = 0;
        put_reservation(&env, &r);
        put_ad(&env, &ad);
        dec_active_count(&env, &buyer);

        let fee = r.amount * (cfg.fee_bps as i128) / 10_000;
        let payout = r.amount - fee;
        let tk = token::Client::new(&env, &ad.token);
        if fee > 0 {
            tk.transfer(&env.current_contract_address(), &cfg.fee_recipient, &fee);
        }
        tk.transfer(&env.current_contract_address(), &buyer, &payout);
        if bond_to_seller > 0 {
            tk.transfer(&env.current_contract_address(), &ad.seller, &bond_to_seller);
        }
        bump_instance(&env);
        Settled { id, ad_id: r.ad_id, buyer, amount_kurus: claim.amount_kurus, date_yyyymmdd: claim.date_yyyymmdd, payout, fee }.publish(&env);
        Ok(claim)
    }

    /// After a release that ignored a declared payment, the buyer proves the payment within
    /// `late_claim_window` and receives the reservation's bond slice.
    pub fn claim_bond(env: Env, id: u64, buyer: Address, public_values: Bytes, proof: Bytes) -> Result<PaymentClaim, Error> {
        buyer.require_auth();
        let cfg = config(&env)?;
        let mut r = get_reservation(&env, id)?;
        if r.buyer != buyer {
            return Err(Error::NotBuyer);
        }
        let now = env.ledger().timestamp();
        if r.status != ReservationStatus::Released || r.late_claim_until == 0 || now > r.late_claim_until {
            return Err(Error::LateClaimClosed);
        }
        if r.bond_slice <= 0 {
            return Err(Error::NoBond);
        }
        let mut ad = get_ad(&env, r.ad_id)?;
        let claim = verify_and_consume(&env, &cfg, &ad, &r, &buyer, &public_values, &proof)?;
        let bond = r.bond_slice;
        r.bond_slice = 0;
        r.late_claim_until = 0;
        ad.bond_held -= bond;
        put_reservation(&env, &r);
        put_ad(&env, &ad);
        token::Client::new(&env, &ad.token).transfer(&env.current_contract_address(), &buyer, &bond);
        BondSlashed { id, buyer, amount: bond }.publish(&env);
        Ok(claim)
    }

    /// Return a released reservation's bond slice to the ad (or the maker, if the ad is closed) once its
    /// late-claim window has passed. Anyone may call it.
    pub fn reclaim_bond(env: Env, id: u64) -> Result<i128, Error> {
        let mut r = get_reservation(&env, id)?;
        if r.status != ReservationStatus::Released {
            return Err(Error::InvalidStatus);
        }
        if r.bond_slice <= 0 {
            return Err(Error::NoBond);
        }
        if r.late_claim_until != 0 && env.ledger().timestamp() <= r.late_claim_until {
            return Err(Error::BondHeld);
        }
        let mut ad = get_ad(&env, r.ad_id)?;
        let bond = r.bond_slice;
        r.bond_slice = 0;
        r.late_claim_until = 0;
        ad.bond_held -= bond;
        let mut to_seller = 0i128;
        if ad.status == AdStatus::Active {
            ad.bond_available += bond;
        } else {
            to_seller = bond;
        }
        put_reservation(&env, &r);
        put_ad(&env, &ad);
        if to_seller > 0 {
            token::Client::new(&env, &ad.token).transfer(&env.current_contract_address(), &ad.seller, &to_seller);
        }
        BondReclaimed { id, ad_id: r.ad_id, amount: bond }.publish(&env);
        Ok(bond)
    }

    // ───────────────────────────── views ─────────────────────────────

    pub fn get_ad(env: Env, id: u64) -> Result<Ad, Error> {
        get_ad(&env, id)
    }

    pub fn ad_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::AdCount).unwrap_or(0)
    }

    /// Ads with ids in `[start, start+limit)` that exist.
    pub fn list_ads(env: Env, start: u64, limit: u32) -> Vec<Ad> {
        let mut out = Vec::new(&env);
        let count: u64 = env.storage().instance().get(&DataKey::AdCount).unwrap_or(0);
        let mut id = if start == 0 { 1 } else { start };
        while id <= count && out.len() < limit {
            if let Some(a) = env.storage().persistent().get::<_, Ad>(&DataKey::Ad(id)) {
                out.push_back(a);
            }
            id += 1;
        }
        out
    }

    pub fn get_reservation(env: Env, id: u64) -> Result<Reservation, Error> {
        get_reservation(&env, id)
    }

    pub fn reservation_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::ReservationCount).unwrap_or(0)
    }

    /// Reservations with ids in `[start, start+limit)` that exist.
    pub fn list_reservations(env: Env, start: u64, limit: u32) -> Vec<Reservation> {
        let mut out = Vec::new(&env);
        let count: u64 = env.storage().instance().get(&DataKey::ReservationCount).unwrap_or(0);
        let mut id = if start == 0 { 1 } else { start };
        while id <= count && out.len() < limit {
            if let Some(r) = env.storage().persistent().get::<_, Reservation>(&DataKey::Reservation(id)) {
                out.push_back(r);
            }
            id += 1;
        }
        out
    }

    /// Active reservations currently held by `buyer`.
    pub fn active_reservations(env: Env, buyer: Address) -> u32 {
        env.storage().persistent().get(&DataKey::ActiveCount(buyer)).unwrap_or(0)
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

    /// The text a buyer must type into the FAST description for reservation `id` when claiming with `buyer`:
    /// `ZKOTC <id> <6 hex of sha256(buyer address)>` (mirrors `zkotc_lib::payment_reference`).
    pub fn payment_reference(env: Env, id: u64, buyer: Address) -> String {
        let b = payment_reference(&env, id, &buyer);
        let mut raw = [0u8; 40];
        let n = b.len() as usize;
        b.copy_into_slice(&mut raw[..n]);
        String::from_bytes(&env, &raw[..n])
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
        max_reservations_per_ad: u32,
        max_active_per_buyer: u32,
        reveal_pubkey: BytesN<32>,
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
        cfg.max_reservations_per_ad = max_reservations_per_ad;
        cfg.max_active_per_buyer = max_active_per_buyer;
        cfg.reveal_pubkey = reveal_pubkey;
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

/// ceil(amount × price / 10^decimals) in kuruş.
fn quote_kurus(amount: i128, price_kurus: u64, decimals: u32) -> u64 {
    let unit = 10i128.pow(decimals);
    ((amount * price_kurus as i128 + unit - 1) / unit) as u64
}

/// Verify a receipt against the router and check the committed values against the ad + reservation; on
/// success the nullifier is recorded (a statement row settles at most once, across everything).
fn verify_and_consume(
    env: &Env,
    cfg: &Config,
    ad: &Ad,
    r: &Reservation,
    buyer: &Address,
    public_values: &Bytes,
    proof: &Bytes,
) -> Result<PaymentClaim, Error> {
    // 1. cryptographic verification: RISC Zero Groth16 receipt via the verifier router
    //    (native BN254 pairing). journal_digest = sha256(journal) per RISC Zero's ReceiptClaim.
    let journal_digest: BytesN<32> = env.crypto().sha256(public_values).into();
    let res = env.try_invoke_contract::<(), soroban_sdk::Error>(
        &cfg.verifier,
        &Symbol::new(env, "verify"),
        vec![env, proof.into_val(env), cfg.image_id.into_val(env), journal_digest.into_val(env)],
    );
    if !matches!(res, Ok(Ok(()))) {
        return Err(Error::ProofInvalid);
    }

    // 2. business checks on the committed values
    let claim = decode_public_values(env, public_values)?;
    if claim.reservation_id != r.id {
        return Err(Error::WrongReservation);
    }
    let keys: Vec<BytesN<32>> = env.storage().instance().get(&DataKey::DkimKeys).unwrap_or(Vec::new(env));
    if !keys.contains(&claim.dkim_key_hash) {
        return Err(Error::DkimKeyNotTrusted);
    }
    if claim.domain_hash != cfg.domain_hash {
        return Err(Error::DomainMismatch);
    }
    if claim.payee_hash != ad.payee_hash {
        return Err(Error::PayeeMismatch);
    }
    if claim.amount_kurus < r.try_amount_kurus {
        return Err(Error::AmountTooLow);
    }
    // the transfer must carry this wallet's reference: a stolen e-mail settles nothing for anyone else
    let expected: BytesN<32> = env.crypto().sha256(&payment_reference(env, r.id, buyer)).into();
    if claim.reference_hash != expected {
        return Err(Error::ReferenceMismatch);
    }
    let now = env.ledger().timestamp();
    let pay_day = days_from_yyyymmdd(claim.date_yyyymmdd).ok_or(Error::InvalidPublicValues)?;
    let lock_day = ((r.created_at + ISTANBUL_OFFSET) / 86_400) as i64;
    let today = ((now + ISTANBUL_OFFSET) / 86_400) as i64;
    if pay_day < lock_day || pay_day > today {
        return Err(Error::DateOutOfWindow);
    }
    let nkey = DataKey::Nullifier(claim.nullifier.clone());
    if env.storage().persistent().has(&nkey) {
        return Err(Error::NullifierUsed);
    }
    env.storage().persistent().set(&nkey, &r.id);
    env.storage().persistent().extend_ttl(&nkey, TTL_THRESHOLD, TTL_EXTEND);
    Ok(claim)
}

fn config(env: &Env) -> Result<Config, Error> {
    env.storage().instance().get(&DataKey::Config).ok_or(Error::NotInitialized)
}

fn get_ad(env: &Env, id: u64) -> Result<Ad, Error> {
    env.storage().persistent().get(&DataKey::Ad(id)).ok_or(Error::AdNotFound)
}

fn put_ad(env: &Env, ad: &Ad) {
    let key = DataKey::Ad(ad.id);
    env.storage().persistent().set(&key, ad);
    env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND);
}

fn get_reservation(env: &Env, id: u64) -> Result<Reservation, Error> {
    env.storage().persistent().get(&DataKey::Reservation(id)).ok_or(Error::ReservationNotFound)
}

fn put_reservation(env: &Env, r: &Reservation) {
    let key = DataKey::Reservation(r.id);
    env.storage().persistent().set(&key, r);
    env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND);
}

fn set_active_count(env: &Env, buyer: &Address, n: u32) {
    let key = DataKey::ActiveCount(buyer.clone());
    env.storage().persistent().set(&key, &n);
    env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND);
}

fn dec_active_count(env: &Env, buyer: &Address) {
    let n: u32 = env.storage().persistent().get(&DataKey::ActiveCount(buyer.clone())).unwrap_or(0);
    set_active_count(env, buyer, n.saturating_sub(1));
}

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND);
}

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

/// `ZKOTC <id> <HEX6>` where HEX6 = first 3 bytes of sha256(strkey of the wallet), uppercase hex.
fn payment_reference(env: &Env, id: u64, buyer: &Address) -> Bytes {
    let addr = buyer.to_string();
    let n = addr.len() as usize;
    let mut raw = [0u8; 64];
    addr.copy_into_slice(&mut raw[..n]);
    let h: BytesN<32> = env.crypto().sha256(&Bytes::from_slice(env, &raw[..n])).into();
    let ha = h.to_array();
    let mut out = Bytes::from_slice(env, b"ZKOTC ");
    let mut digits = [0u8; 20];
    let mut k = 20;
    let mut v = id;
    if v == 0 {
        k -= 1;
        digits[k] = b'0';
    }
    while v > 0 {
        k -= 1;
        digits[k] = b'0' + (v % 10) as u8;
        v /= 10;
    }
    out.extend_from_slice(&digits[k..]);
    out.push_back(b' ');
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    for b in &ha[..3] {
        out.push_back(HEX[(b >> 4) as usize]);
        out.push_back(HEX[(b & 15) as usize]);
    }
    out
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
        reservation_id: u64_at(144),
        reference_hash: b32(152),
    })
}

/// yyyymmdd -> days since 1970-01-01 (Howard Hinnant's days_from_civil), None if malformed.
/// yyyymmdd -> days since 1970-01-01 (Howard Hinnant's days_from_civil), None if malformed.
fn days_from_yyyymmdd(v: u64) -> Option<i64> {
    let y = (v / 10_000) as i64;
    let m = ((v / 100) % 100) as i64;
    let d = (v % 100) as i64;
    if !(1970..=2200).contains(&y) || !(1..=12).contains(&m) || d < 1 {
        return None;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let max_d = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => if leap { 29 } else { 28 },
    };
    if d > max_d {
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
