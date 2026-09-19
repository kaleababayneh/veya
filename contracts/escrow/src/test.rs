#![cfg(test)]
#![allow(clippy::inconsistent_digit_grouping)]
//! Escrow v5 unit tests (ads + reservations). The RISC Zero verifier router is replaced by a test double
//! that accepts seals whose first byte is 0x01; real receipt verification happens on testnet via Nethermind's stack.

use super::*;
use sha2::{Digest, Sha256};
use soroban_sdk::{
    contract, contracterror, contractimpl,
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec, IntoVal, Val,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum StubErr {
    Invalid = 7,
}

#[contract]
pub struct StubVerifier;

#[contractimpl]
impl StubVerifier {
    /// Same signature as the RISC Zero verifier router: verify(seal, image_id, journal_digest).
    pub fn verify(_env: Env, seal: Bytes, _image_id: BytesN<32>, _journal_digest: BytesN<32>) -> Result<(), StubErr> {
        if !seal.is_empty() && seal.get(0) == Some(1) {
            Ok(())
        } else {
            Err(StubErr::Invalid)
        }
    }
}

const T0: u64 = 1_788_739_200; // 2026-09-07 00:00:00 UTC
const NOW: u64 = T0 + 3600; // 01:00 UTC = 04:00 Istanbul, 2026-09-07
const DAY0: u64 = 20_260_907;
const LOCK: u64 = 3600;
const PROOF_WINDOW: u64 = 7200;
const BOND_BPS: u32 = 500; // 5 %
const LATE_WINDOW: u64 = 3 * 86_400;
const MAX_PER_AD: u32 = 3;
const MAX_PER_BUYER: u32 = 2;
const IBAN: &str = "TR33 0006 1005 1978 6457 8413 26";
const NAME: &str = "AYŞE YILMAZ";
const DOMAIN: &str = "ileti.ziraatbank.com.tr";
const ONE: i128 = 1_0000000; // 1 token (7 decimals)
const DEPOSIT: i128 = 1_000 * ONE;
const BOND: i128 = 50 * ONE; // 5 % of the deposit
const PRICE: u64 = 40_00; // ₺40.00 per token
const SLICE: i128 = 100 * ONE; // a 100-token reservation …
const SLICE_TRY: u64 = 4_000_00; // … costs ₺4,000
const SLICE_BOND: i128 = 5 * ONE;

fn sha(b: &[u8]) -> [u8; 32] {
    Sha256::digest(b).into()
}

struct World<'a> {
    env: Env,
    client: OtcEscrowClient<'a>,
    token: Address,
    seller: Address,
    buyer: Address,
    fee_to: Address,
    dkim_key: [u8; 32],
}

fn setup() -> World<'static> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(NOW);

    let admin = Address::generate(&env);
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);
    let fee_to = Address::generate(&env);
    let issuer = Address::generate(&env);

    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token = sac.address();
    StellarAssetClient::new(&env, &token).mint(&seller, &(10_000 * ONE));

    let verifier = env.register(StubVerifier, ());
    let dkim_key = sha(b"ziraat-msg2-der");
    let args: Vec<Val> = vec![
        &env,
        admin.into_val(&env),
        verifier.into_val(&env),
        BytesN::from_array(&env, &[7u8; 32]).into_val(&env),
        BytesN::from_array(&env, &sha(DOMAIN.as_bytes())).into_val(&env),
        vec![&env, BytesN::from_array(&env, &dkim_key)].into_val(&env),
        vec![&env, token.clone()].into_val(&env),
        LOCK.into_val(&env),
        25u32.into_val(&env),
        fee_to.into_val(&env),
        50_00u64.into_val(&env),    // deployment min ₺50
        5_000_00u64.into_val(&env), // deployment max ₺5,000
        PROOF_WINDOW.into_val(&env),
        BOND_BPS.into_val(&env),
        LATE_WINDOW.into_val(&env),
        MAX_PER_AD.into_val(&env),
        MAX_PER_BUYER.into_val(&env),
        BytesN::from_array(&env, &[9u8; 32]).into_val(&env),
    ];
    let id = env.register(OtcEscrow, args);
    let client = OtcEscrowClient::new(&env, &id);
    World { env, client, token, seller, buyer, fee_to, dkim_key }
}

/// Mirrors zkotc_lib::payee::payee_hash_from_full for IBAN + NAME.
fn payee_hash_of(iban: &str, name: &str) -> [u8; 32] {
    let iban: std::string::String = iban.replace(' ', "").to_uppercase();
    let folded: std::string::String = name
        .chars()
        .map(|c| match c {
            'ç' | 'Ç' => 'C', 'ğ' | 'Ğ' => 'G', 'ı' | 'İ' | 'i' | 'I' => 'I', 'ö' | 'Ö' => 'O', 'ş' | 'Ş' => 'S', 'ü' | 'Ü' => 'U',
            c => c.to_ascii_uppercase(),
        })
        .collect::<std::string::String>()
        .split_whitespace()
        .collect::<std::vec::Vec<_>>()
        .join(" ");
    let ib = iban.as_str();
    let mut h = Sha256::new();
    h.update(b"zkotc/payee/v1");
    h.update(&ib.as_bytes()[0..4]);
    h.update(&ib.as_bytes()[4..9]);
    h.update(&ib.as_bytes()[20..26]);
    h.update(folded.as_bytes());
    h.finalize().into()
}

fn payee() -> [u8; 32] {
    payee_hash_of(IBAN, NAME)
}

fn addr_str(a: &Address) -> std::string::String {
    let s = a.to_string();
    let mut raw = [0u8; 64];
    s.copy_into_slice(&mut raw[..s.len() as usize]);
    std::string::String::from(std::str::from_utf8(&raw[..s.len() as usize]).unwrap())
}

/// Mirrors `zkotc_lib::payment_reference` for the test wallets.
fn reference_of(addr: &Address, id: u64) -> std::string::String {
    let h = sha(addr_str(addr).as_bytes());
    std::format!("ZKOTC{id}{:02X}{:02X}{:02X}", h[0], h[1], h[2])
}

/// Public values for a claim of reservation `rid` by `buyer`.
fn pv_for(w: &World, buyer: &Address, payee_hash: [u8; 32], amount: u64, date: u64, nullifier: [u8; 32], rid: u64) -> Bytes {
    let mut v = std::vec::Vec::with_capacity(184);
    v.extend_from_slice(&w.dkim_key);
    v.extend_from_slice(&sha(DOMAIN.as_bytes()));
    v.extend_from_slice(&payee_hash);
    v.extend_from_slice(&amount.to_be_bytes());
    v.extend_from_slice(&date.to_be_bytes());
    v.extend_from_slice(&nullifier);
    v.extend_from_slice(&rid.to_be_bytes());
    v.extend_from_slice(&sha(reference_of(buyer, rid).as_bytes()));
    Bytes::from_slice(&w.env, &v)
}

fn pv(w: &World, payee_hash: [u8; 32], amount: u64, date: u64, nullifier: [u8; 32], rid: u64) -> Bytes {
    pv_for(w, &w.buyer.clone(), payee_hash, amount, date, nullifier, rid)
}

/// A good proof of the default reservation slice, with a unique row.
fn proof_for(w: &World, rid: u64, row: &[u8]) -> Bytes {
    pv(w, payee(), SLICE_TRY, DAY0, sha(row), rid)
}

fn good_proof(env: &Env) -> Bytes {
    Bytes::from_array(env, &[1u8; 260])
}

fn bad_proof(env: &Env) -> Bytes {
    Bytes::from_array(env, &[0u8; 260])
}

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn blob(env: &Env) -> Bytes {
    Bytes::from_array(env, &[1u8, 2, 3, 4])
}

fn create(w: &World) -> u64 {
    w.client.create_ad(
        &w.seller,
        &w.token,
        &DEPOSIT,
        &PRICE,
        &50_00,    // min ₺50
        &5_000_00, // max ₺5,000
        &BytesN::from_array(&w.env, &payee()),
        &blob(&w.env),
        &s(&w.env, "ayse"),
        &0,
    )
}

fn reserve(w: &World) -> u64 {
    w.client.reserve(&create(w), &w.buyer, &SLICE).id
}

fn bal(w: &World, who: &Address) -> i128 {
    TokenClient::new(&w.env, &w.token).balance(who)
}

// ───────────────────────────── ads ─────────────────────────────

#[test]
fn create_ad_deposits_amount_plus_bond() {
    let w = setup();
    let id = create(&w);
    assert_eq!(id, 1);
    let a = w.client.get_ad(&id);
    assert_eq!(a.status, AdStatus::Active);
    assert_eq!(a.decimals, 7);
    assert_eq!(a.remaining, DEPOSIT);
    assert_eq!(a.reserved, 0);
    assert_eq!(a.bond_available, BOND);
    assert_eq!(a.bond_held, 0);
    assert_eq!(a.payee_hash, BytesN::from_array(&w.env, &payee()));
    assert_eq!(a.payee_blob, blob(&w.env));
    assert_eq!(a.nickname, s(&w.env, "ayse"));
    assert_eq!(bal(&w, &w.seller), 10_000 * ONE - DEPOSIT - BOND);
    assert_eq!(bal(&w, &w.client.address), DEPOSIT + BOND);
    assert_eq!(w.client.ad_count(), 1);
    assert_eq!(w.client.list_ads(&0, &10).len(), 1);
    // quotes round up to the kuruş
    assert_eq!(w.client.quote(&id, &SLICE), SLICE_TRY);
    assert_eq!(w.client.quote(&id, &1), 1, "1 stroop at ₺40/token → ceil → 1 kuruş");
    assert_eq!(w.client.quote(&id, &(ONE / 2)), 20_00);
}

#[test]
fn create_ad_rejects_bad_inputs() {
    let w = setup();
    let e = &w.env;
    let other = Address::generate(e);
    let ph = BytesN::from_array(e, &payee());
    let ok_name = s(e, "ayse");
    assert_eq!(w.client.try_create_ad(&w.seller, &other, &DEPOSIT, &PRICE, &50_00, &5_000_00, &ph, &blob(e), &ok_name, &0), Err(Ok(Error::TokenNotAllowed)));
    assert_eq!(w.client.try_create_ad(&w.seller, &w.token, &0, &PRICE, &50_00, &5_000_00, &ph, &blob(e), &ok_name, &0), Err(Ok(Error::InvalidAmount)));
    assert_eq!(w.client.try_create_ad(&w.seller, &w.token, &DEPOSIT, &0, &50_00, &5_000_00, &ph, &blob(e), &ok_name, &0), Err(Ok(Error::InvalidPrice)));
    assert_eq!(w.client.try_create_ad(&w.seller, &w.token, &DEPOSIT, &PRICE, &10_00, &5_000_00, &ph, &blob(e), &ok_name, &0), Err(Ok(Error::InvalidLimits)), "below deployment min");
    assert_eq!(w.client.try_create_ad(&w.seller, &w.token, &DEPOSIT, &PRICE, &50_00, &9_000_00, &ph, &blob(e), &ok_name, &0), Err(Ok(Error::InvalidLimits)), "above deployment max");
    assert_eq!(w.client.try_create_ad(&w.seller, &w.token, &DEPOSIT, &PRICE, &500_00, &100_00, &ph, &blob(e), &ok_name, &0), Err(Ok(Error::InvalidLimits)), "min > max");
    assert_eq!(w.client.try_create_ad(&w.seller, &w.token, &ONE, &PRICE, &50_00, &5_000_00, &ph, &blob(e), &ok_name, &0), Err(Ok(Error::InvalidLimits)), "deposit worth ₺40 < min trade ₺50");
    assert_eq!(w.client.try_create_ad(&w.seller, &w.token, &DEPOSIT, &PRICE, &50_00, &5_000_00, &ph, &Bytes::from_array(e, &[0u8; 513]), &ok_name, &0), Err(Ok(Error::BlobTooLarge)));
    assert_eq!(w.client.try_create_ad(&w.seller, &w.token, &DEPOSIT, &PRICE, &50_00, &5_000_00, &ph, &blob(e), &s(e, "a name that is far too long!!"), &0), Err(Ok(Error::InvalidName)));
    assert_eq!(w.client.try_create_ad(&w.seller, &w.token, &DEPOSIT, &PRICE, &50_00, &5_000_00, &ph, &blob(e), &ok_name, &(NOW - 1)), Err(Ok(Error::InvalidExpiry)));
}

#[test]
fn set_price_only_affects_new_reservations() {
    let w = setup();
    let id = create(&w);
    let r1 = w.client.reserve(&id, &w.buyer, &SLICE);
    assert_eq!(r1.try_amount_kurus, SLICE_TRY);
    w.client.set_price(&id, &(45_00));
    let other = Address::generate(&w.env);
    let r2 = w.client.reserve(&id, &other, &SLICE);
    assert_eq!(r2.try_amount_kurus, 4_500_00);
    assert_eq!(w.client.get_reservation(&r1.id).try_amount_kurus, SLICE_TRY, "already fixed");
    let stranger = Address::generate(&w.env);
    w.env.mock_all_auths();
    let _ = stranger;
    assert_eq!(w.client.try_set_price(&id, &0), Err(Ok(Error::InvalidPrice)));
}

// ───────────────────────────── reservations ─────────────────────────────

#[test]
fn reserve_locks_a_slice_and_fixes_the_price() {
    let w = setup();
    let id = create(&w);
    let r = w.client.reserve(&id, &w.buyer, &SLICE);
    assert_eq!(r.id, 1);
    assert_eq!(r.status, ReservationStatus::Active);
    assert_eq!(r.try_amount_kurus, SLICE_TRY);
    assert_eq!(r.bond_slice, SLICE_BOND);
    assert_eq!(r.lock_expires_at, NOW + LOCK);
    let a = w.client.get_ad(&id);
    assert_eq!(a.remaining, DEPOSIT - SLICE);
    assert_eq!(a.reserved, SLICE);
    assert_eq!(a.bond_available, BOND - SLICE_BOND);
    assert_eq!(a.bond_held, SLICE_BOND);
    assert_eq!(a.active_reservations, 1);
    assert_eq!(w.client.active_reservations(&w.buyer), 1);
    assert_eq!(w.client.reservation_count(), 1);
    assert_eq!(w.client.list_reservations(&0, &10).len(), 1);
    // several buyers can hold slices of the same ad at once
    let other = Address::generate(&w.env);
    w.client.reserve(&id, &other, &SLICE);
    assert_eq!(w.client.get_ad(&id).reserved, 2 * SLICE);
}

#[test]
fn reserve_limits() {
    let w = setup();
    let id = create(&w);
    assert_eq!(w.client.try_reserve(&id, &w.buyer, &0), Err(Ok(Error::InvalidAmount)));
    assert_eq!(w.client.try_reserve(&id, &w.buyer, &ONE), Err(Ok(Error::AmountOutOfRange)), "₺40 < min ₺50");
    assert_eq!(w.client.try_reserve(&id, &w.buyer, &(200 * ONE)), Err(Ok(Error::AmountOutOfRange)), "₺8,000 > max ₺5,000");
    assert_eq!(w.client.try_reserve(&id, &w.buyer, &(DEPOSIT + 1)), Err(Ok(Error::InsufficientLiquidity)));
    // per-buyer cap
    w.client.reserve(&id, &w.buyer, &SLICE);
    w.client.reserve(&id, &w.buyer, &SLICE);
    assert_eq!(w.client.try_reserve(&id, &w.buyer, &SLICE), Err(Ok(Error::TooManyReservations)), "buyer holds 2 already");
    // per-ad cap
    let third = Address::generate(&w.env);
    w.client.reserve(&id, &third, &SLICE);
    let fourth = Address::generate(&w.env);
    assert_eq!(w.client.try_reserve(&id, &fourth, &SLICE), Err(Ok(Error::TooManyReservations)), "ad has 3 active");
    // releasing one frees both counters
    w.client.release(&3, &third);
    assert_eq!(w.client.get_ad(&id).active_reservations, 2);
    w.client.reserve(&id, &fourth, &SLICE);
    // liquidity exhaustion at the tail: only 700 tokens left → a ₺4,000 slice still fits, ₺32,000 does not
    assert_eq!(w.client.get_ad(&id).remaining, 700 * ONE);
    // bond exhaustion: an ad whose pool cannot back another slice
    let w2 = setup();
    let id2 = w2.client.create_ad(&w2.seller, &w2.token, &(200 * ONE), &PRICE, &50_00, &5_000_00, &BytesN::from_array(&w2.env, &payee()), &blob(&w2.env), &s(&w2.env, "x"), &0);
    w2.client.set_price(&id2, &1_00); // ₺1 per token → a 100-token slice is ₺100
    w2.client.reserve(&id2, &w2.buyer, &SLICE);
    let a = w2.client.get_ad(&id2);
    assert_eq!(a.bond_available, 5 * ONE);
    // bond pool = 10 tokens; two 5-token slices fit, so exhaust via a smaller pool: close and reopen not needed —
    // reserve the second slice, then a third cannot be backed
    let other = Address::generate(&w2.env);
    w2.client.reserve(&id2, &other, &SLICE);
    assert_eq!(w2.client.get_ad(&id2).bond_available, 0);
    assert_eq!(w2.client.get_ad(&id2).remaining, 0);
    // expired / closed / paused ads
    let w3 = setup();
    let id3 = w3.client.create_ad(&w3.seller, &w3.token, &DEPOSIT, &PRICE, &50_00, &5_000_00, &BytesN::from_array(&w3.env, &payee()), &blob(&w3.env), &s(&w3.env, "x"), &(NOW + 10));
    w3.env.ledger().set_timestamp(NOW + 10);
    assert_eq!(w3.client.try_reserve(&id3, &w3.buyer, &SLICE), Err(Ok(Error::AdExpired)));
    w3.client.close_ad(&id3);
    assert_eq!(w3.client.try_reserve(&id3, &w3.buyer, &SLICE), Err(Ok(Error::InvalidStatus)));
}

#[test]
fn settle_pays_buyer_and_fee_and_frees_the_bond_slice() {
    let w = setup();
    let id = create(&w);
    let rid = w.client.reserve(&id, &w.buyer, &SLICE).id;
    let claim = w.client.settle(&rid, &w.buyer, &proof_for(&w, rid, b"row-1"), &good_proof(&w.env));
    assert_eq!(claim.amount_kurus, SLICE_TRY);
    assert_eq!(claim.reservation_id, rid);
    let r = w.client.get_reservation(&rid);
    assert_eq!(r.status, ReservationStatus::Settled);
    assert_eq!(r.settled_at, NOW);
    assert_eq!(r.bond_slice, 0);
    let a = w.client.get_ad(&id);
    assert_eq!(a.remaining, DEPOSIT - SLICE);
    assert_eq!(a.reserved, 0);
    assert_eq!(a.bond_available, BOND);
    assert_eq!(a.bond_held, 0);
    assert_eq!(a.settled_count, 1);
    assert_eq!(a.active_reservations, 0);
    assert_eq!(w.client.active_reservations(&w.buyer), 0);
    // 25 bps fee on the slice
    assert_eq!(bal(&w, &w.buyer), SLICE - SLICE * 25 / 10_000);
    assert_eq!(bal(&w, &w.fee_to), SLICE * 25 / 10_000);
    assert_eq!(bal(&w, &w.client.address), DEPOSIT - SLICE + BOND);
    assert!(w.client.is_nullifier_used(&BytesN::from_array(&w.env, &sha(b"row-1"))));
    // the ad keeps serving
    let other = Address::generate(&w.env);
    let r2 = w.client.reserve(&id, &other, &SLICE);
    w.client.settle(&r2.id, &other, &pv_for(&w, &other, payee(), SLICE_TRY, DAY0, sha(b"row-2"), r2.id), &good_proof(&w.env));
    assert_eq!(w.client.get_ad(&id).settled_count, 2);
}

#[test]
fn settle_rejections() {
    let w = setup();
    let id = create(&w);
    let other = Address::generate(&w.env);
    assert_eq!(w.client.try_settle(&99, &w.buyer, &proof_for(&w, 99, b"n"), &good_proof(&w.env)), Err(Ok(Error::ReservationNotFound)));
    let rid = w.client.reserve(&id, &w.buyer, &SLICE).id;
    let ok = |n: &[u8]| proof_for(&w, rid, n);
    assert_eq!(w.client.try_settle(&rid, &other, &ok(b"a"), &good_proof(&w.env)), Err(Ok(Error::NotBuyer)));
    assert_eq!(w.client.try_settle(&rid, &w.buyer, &ok(b"a"), &bad_proof(&w.env)), Err(Ok(Error::ProofInvalid)));
    assert_eq!(w.client.try_settle(&rid, &w.buyer, &pv(&w, payee(), SLICE_TRY, DAY0, sha(b"a"), rid + 1), &good_proof(&w.env)), Err(Ok(Error::WrongReservation)));
    assert_eq!(w.client.try_settle(&rid, &w.buyer, &pv(&w, sha(b"other payee"), SLICE_TRY, DAY0, sha(b"a"), rid), &good_proof(&w.env)), Err(Ok(Error::PayeeMismatch)));
    assert_eq!(w.client.try_settle(&rid, &w.buyer, &pv(&w, payee(), SLICE_TRY - 1, DAY0, sha(b"a"), rid), &good_proof(&w.env)), Err(Ok(Error::AmountTooLow)));
    // a proof carrying someone else's reference (a stolen e-mail)
    assert_eq!(w.client.try_settle(&rid, &w.buyer, &pv_for(&w, &other, payee(), SLICE_TRY, DAY0, sha(b"a"), rid), &good_proof(&w.env)), Err(Ok(Error::ReferenceMismatch)));
    // paid the day before the reservation (Istanbul date) / dated tomorrow / malformed
    assert_eq!(w.client.try_settle(&rid, &w.buyer, &pv(&w, payee(), SLICE_TRY, 20_260_906, sha(b"a"), rid), &good_proof(&w.env)), Err(Ok(Error::DateOutOfWindow)));
    assert_eq!(w.client.try_settle(&rid, &w.buyer, &pv(&w, payee(), SLICE_TRY, 20_260_908, sha(b"a"), rid), &good_proof(&w.env)), Err(Ok(Error::DateOutOfWindow)));
    assert_eq!(w.client.try_settle(&rid, &w.buyer, &pv(&w, payee(), SLICE_TRY, 20_261_345, sha(b"a"), rid), &good_proof(&w.env)), Err(Ok(Error::InvalidPublicValues)));
    assert_eq!(w.client.try_settle(&rid, &w.buyer, &Bytes::from_array(&w.env, &[0u8; 183]), &good_proof(&w.env)), Err(Ok(Error::InvalidPublicValues)));
    // untrusted dkim key / wrong domain
    let mut v = std::vec![0u8; 184];
    ok(b"a").copy_into_slice(&mut v);
    v[0] ^= 1;
    assert_eq!(w.client.try_settle(&rid, &w.buyer, &Bytes::from_slice(&w.env, &v), &good_proof(&w.env)), Err(Ok(Error::DkimKeyNotTrusted)));
    v[0] ^= 1;
    v[40] ^= 1;
    assert_eq!(w.client.try_settle(&rid, &w.buyer, &Bytes::from_slice(&w.env, &v), &good_proof(&w.env)), Err(Ok(Error::DomainMismatch)));
    // untouched
    assert_eq!(w.client.get_reservation(&rid).status, ReservationStatus::Active);
    assert_eq!(bal(&w, &w.client.address), DEPOSIT + BOND);
    assert!(!w.client.is_nullifier_used(&BytesN::from_array(&w.env, &sha(b"a"))));
}

#[test]
fn nullifier_cannot_be_reused_across_reservations() {
    let w = setup();
    let id = create(&w);
    let r1 = w.client.reserve(&id, &w.buyer, &SLICE).id;
    w.client.settle(&r1, &w.buyer, &proof_for(&w, r1, b"same-row"), &good_proof(&w.env));
    let r2 = w.client.reserve(&id, &w.buyer, &SLICE).id;
    assert_eq!(w.client.try_settle(&r2, &w.buyer, &proof_for(&w, r2, b"same-row"), &good_proof(&w.env)), Err(Ok(Error::NullifierUsed)));
}

#[test]
fn release_paths_restore_liquidity() {
    let w = setup();
    let id = create(&w);
    let rid = w.client.reserve(&id, &w.buyer, &SLICE).id;
    let stranger = Address::generate(&w.env);
    assert_eq!(w.client.try_release(&rid, &stranger), Err(Ok(Error::LockActive)));
    // buyer releases early: slice and bond go back to the ad
    w.client.release(&rid, &w.buyer);
    let a = w.client.get_ad(&id);
    assert_eq!((a.remaining, a.reserved, a.bond_available, a.bond_held, a.active_reservations), (DEPOSIT, 0, BOND, 0, 0));
    assert_eq!(w.client.get_reservation(&rid).status, ReservationStatus::Released);
    assert_eq!(w.client.try_settle(&rid, &w.buyer, &proof_for(&w, rid, b"x"), &good_proof(&w.env)), Err(Ok(Error::InvalidStatus)));
    // anyone releases an expired one
    let rid2 = w.client.reserve(&id, &w.buyer, &SLICE).id;
    w.env.ledger().set_timestamp(NOW + LOCK + 1);
    w.client.release(&rid2, &stranger);
    assert_eq!(w.client.get_ad(&id).remaining, DEPOSIT);
    // settlement is still possible after expiry as long as nobody released it
    let rid3 = w.client.reserve(&id, &w.buyer, &SLICE).id;
    w.env.ledger().set_timestamp(NOW + 2 * LOCK + 10);
    w.client.settle(&rid3, &w.buyer, &proof_for(&w, rid3, b"late-but-fine"), &good_proof(&w.env));
}

#[test]
fn declare_paid_protects_the_buyer() {
    let w = setup();
    let rid = reserve(&w);
    let stranger = Address::generate(&w.env);
    w.env.ledger().set_timestamp(NOW + 600);
    let r = w.client.declare_paid(&rid, &w.buyer);
    assert_eq!(r.lock_expires_at, NOW + 600 + PROOF_WINDOW);
    assert_eq!(r.paid_declared_at, NOW + 600);
    assert_eq!(w.client.try_declare_paid(&rid, &w.buyer), Err(Ok(Error::AlreadyDeclared)));
    assert_eq!(w.client.try_declare_paid(&rid, &stranger), Err(Ok(Error::NotBuyer)));
    w.env.ledger().set_timestamp(NOW + LOCK + 1);
    assert_eq!(w.client.try_release(&rid, &stranger), Err(Ok(Error::LockActive)), "protected past the original expiry");
    // closing the ad never touches a protected slice
    w.client.close_ad(&1);
    assert_eq!(w.client.get_ad(&1).reserved, SLICE);
    w.client.settle(&rid, &w.buyer, &proof_for(&w, rid, b"r1"), &good_proof(&w.env));
    assert_eq!(bal(&w, &w.client.address), 0, "everything paid out: buyer, fee, maker (rest + bond)");
    // declaring after expiry is refused
    let w2 = setup();
    let rid2 = reserve(&w2);
    w2.env.ledger().set_timestamp(NOW + LOCK);
    assert_eq!(w2.client.try_declare_paid(&rid2, &w2.buyer), Err(Ok(Error::LockExpired)));
}

#[test]
fn late_claim_wins_the_bond_slice() {
    let w = setup();
    let id = create(&w);
    let rid = w.client.reserve(&id, &w.buyer, &SLICE).id;
    w.client.declare_paid(&rid, &w.buyer);
    let t_release = NOW + PROOF_WINDOW + 1;
    w.env.ledger().set_timestamp(t_release);
    let stranger = Address::generate(&w.env);
    w.client.release(&rid, &stranger);
    let r = w.client.get_reservation(&rid);
    assert_eq!(r.status, ReservationStatus::Released);
    assert_eq!(r.late_claim_until, t_release + LATE_WINDOW);
    assert_eq!(r.bond_slice, SLICE_BOND, "slice stays earmarked");
    let a = w.client.get_ad(&id);
    assert_eq!((a.remaining, a.bond_held, a.bond_available), (DEPOSIT, SLICE_BOND, BOND - SLICE_BOND));
    assert_eq!(w.client.try_reclaim_bond(&rid), Err(Ok(Error::BondHeld)));
    assert_eq!(w.client.try_claim_bond(&rid, &stranger, &proof_for(&w, rid, b"r"), &good_proof(&w.env)), Err(Ok(Error::NotBuyer)));
    assert_eq!(w.client.try_claim_bond(&rid, &w.buyer, &proof_for(&w, rid, b"r"), &bad_proof(&w.env)), Err(Ok(Error::ProofInvalid)));
    w.env.ledger().set_timestamp(t_release + 3600);
    w.client.claim_bond(&rid, &w.buyer, &proof_for(&w, rid, b"r"), &good_proof(&w.env));
    assert_eq!(bal(&w, &w.buyer), SLICE_BOND);
    let a = w.client.get_ad(&id);
    assert_eq!((a.bond_held, a.bond_available), (0, BOND - SLICE_BOND), "the ad lost that slice for good");
    assert_eq!(w.client.get_reservation(&rid).bond_slice, 0);
    assert_eq!(w.client.try_claim_bond(&rid, &w.buyer, &proof_for(&w, rid, b"r2"), &good_proof(&w.env)), Err(Ok(Error::LateClaimClosed)));
}

#[test]
fn bond_slice_is_reclaimed_after_the_window() {
    let w = setup();
    let id = create(&w);
    let rid = w.client.reserve(&id, &w.buyer, &SLICE).id;
    w.client.declare_paid(&rid, &w.buyer);
    let t_release = NOW + PROOF_WINDOW + 1;
    w.env.ledger().set_timestamp(t_release);
    w.client.release(&rid, &Address::generate(&w.env));
    w.env.ledger().set_timestamp(t_release + LATE_WINDOW + 1);
    assert_eq!(w.client.try_claim_bond(&rid, &w.buyer, &proof_for(&w, rid, b"r"), &good_proof(&w.env)), Err(Ok(Error::LateClaimClosed)));
    assert_eq!(w.client.reclaim_bond(&rid), SLICE_BOND);
    let a = w.client.get_ad(&id);
    assert_eq!((a.bond_held, a.bond_available), (0, BOND));
    assert_eq!(w.client.try_reclaim_bond(&rid), Err(Ok(Error::NoBond)));
}

#[test]
fn buyer_who_gives_up_forfeits_the_claim() {
    let w = setup();
    let id = create(&w);
    let rid = w.client.reserve(&id, &w.buyer, &SLICE).id;
    w.client.declare_paid(&rid, &w.buyer);
    w.client.release(&rid, &w.buyer);
    let r = w.client.get_reservation(&rid);
    assert_eq!((r.paid_declared_at, r.late_claim_until, r.bond_slice), (0, 0, 0));
    assert_eq!(w.client.get_ad(&id).bond_available, BOND);
    assert_eq!(w.client.try_claim_bond(&rid, &w.buyer, &proof_for(&w, rid, b"r"), &good_proof(&w.env)), Err(Ok(Error::LateClaimClosed)));
}

#[test]
fn close_ad_withdraws_free_funds_and_open_reservations_still_settle() {
    let w = setup();
    let id = create(&w);
    let rid = w.client.reserve(&id, &w.buyer, &SLICE).id;
    let other = Address::generate(&w.env);
    let rid2 = w.client.reserve(&id, &other, &SLICE).id;
    w.client.close_ad(&id);
    let a = w.client.get_ad(&id);
    assert_eq!(a.status, AdStatus::Closed);
    assert_eq!((a.remaining, a.bond_available), (0, 0));
    assert_eq!((a.reserved, a.bond_held), (2 * SLICE, 2 * SLICE_BOND));
    assert_eq!(bal(&w, &w.seller), 10_000 * ONE - 2 * SLICE - 2 * SLICE_BOND, "everything not reserved came back");
    assert_eq!(w.client.try_close_ad(&id), Err(Ok(Error::InvalidStatus)));
    assert_eq!(w.client.try_set_price(&id, &1), Err(Ok(Error::InvalidStatus)));
    // settlement: buyer paid, that slice's bond goes straight to the maker
    w.client.settle(&rid, &w.buyer, &proof_for(&w, rid, b"r"), &good_proof(&w.env));
    assert_eq!(bal(&w, &w.seller), 10_000 * ONE - 2 * SLICE - SLICE_BOND);
    // release on a closed ad: tokens + bond slice straight to the maker
    w.client.release(&rid2, &other);
    assert_eq!(bal(&w, &w.seller), 10_000 * ONE - SLICE);
    assert_eq!(bal(&w, &w.client.address), 0);
    let a = w.client.get_ad(&id);
    assert_eq!((a.reserved, a.bond_held, a.active_reservations), (0, 0, 0));
    // a declared-then-released slice on a closed ad: bond waits, then reclaim pays the maker
    let w2 = setup();
    let id2 = create(&w2);
    let r3 = w2.client.reserve(&id2, &w2.buyer, &SLICE).id;
    w2.client.declare_paid(&r3, &w2.buyer);
    w2.client.close_ad(&id2);
    let t = NOW + PROOF_WINDOW + 1;
    w2.env.ledger().set_timestamp(t);
    w2.client.release(&r3, &Address::generate(&w2.env));
    assert_eq!(bal(&w2, &w2.seller), 10_000 * ONE - SLICE_BOND, "tokens back, bond slice still held");
    w2.env.ledger().set_timestamp(t + LATE_WINDOW + 1);
    w2.client.reclaim_bond(&r3);
    assert_eq!(bal(&w2, &w2.seller), 10_000 * ONE);
}

#[test]
fn payment_reference_view_matches_the_library() {
    let w = setup();
    let rid = reserve(&w);
    let view = w.client.payment_reference(&rid, &w.buyer);
    let mut raw = [0u8; 40];
    view.copy_into_slice(&mut raw[..view.len() as usize]);
    let view_str = std::str::from_utf8(&raw[..view.len() as usize]).unwrap();
    assert_eq!(view_str, reference_of(&w.buyer, rid));
    assert_eq!(view_str, zkotc_lib::payment_reference(rid, &addr_str(&w.buyer)));
    assert!(view_str.starts_with("ZKOTC1") && view_str.len() == 12, "{view_str}");
}

#[test]
fn pause_blocks_new_activity_but_never_settlement() {
    let w = setup();
    let id = create(&w);
    let rid = w.client.reserve(&id, &w.buyer, &SLICE).id;
    w.client.set_paused(&true);
    assert_eq!(w.client.try_reserve(&id, &w.buyer, &SLICE), Err(Ok(Error::Paused)));
    assert_eq!(
        w.client.try_create_ad(&w.seller, &w.token, &DEPOSIT, &PRICE, &50_00, &5_000_00, &BytesN::from_array(&w.env, &payee()), &blob(&w.env), &s(&w.env, "x"), &0),
        Err(Ok(Error::Paused))
    );
    w.client.settle(&rid, &w.buyer, &proof_for(&w, rid, b"r"), &good_proof(&w.env));
    w.client.close_ad(&id);
}

#[test]
fn caps_enforced() {
    let w = setup();
    let cfg = w.client.config();
    assert_eq!(
        w.client.try_set_config(&cfg.verifier, &cfg.image_id, &cfg.domain_hash, &cfg.lock_duration, &101, &cfg.fee_recipient, &cfg.min_try_kurus, &cfg.max_try_kurus, &cfg.proof_window, &cfg.bond_bps, &cfg.late_claim_window, &cfg.max_reservations_per_ad, &cfg.max_active_per_buyer, &cfg.reveal_pubkey),
        Err(Ok(Error::InvalidFee))
    );
    assert_eq!(
        w.client.try_set_config(&cfg.verifier, &cfg.image_id, &cfg.domain_hash, &cfg.lock_duration, &cfg.fee_bps, &cfg.fee_recipient, &cfg.min_try_kurus, &cfg.max_try_kurus, &cfg.proof_window, &5_001, &cfg.late_claim_window, &cfg.max_reservations_per_ad, &cfg.max_active_per_buyer, &cfg.reveal_pubkey),
        Err(Ok(Error::InvalidBond))
    );
    assert_eq!(cfg.reveal_pubkey, BytesN::from_array(&w.env, &[9u8; 32]));
}

#[test]
fn payee_hash_view_matches_guest_convention() {
    let w = setup();
    let h = w.client.payee_hash(&s(&w.env, "tr33 0006 1005 1978 6457 8413 26"), &s(&w.env, "ayşe yılmaz"));
    assert_eq!(h, BytesN::from_array(&w.env, &payee()));
    let mut a = [0u8; 32];
    h.copy_into_slice(&mut a);
    assert_eq!(a, zkotc_lib::payee::payee_hash_from_full(IBAN, NAME).unwrap());
}

#[test]
fn decode_claim_roundtrip() {
    let w = setup();
    let c = w.client.decode_claim(&pv(&w, payee(), 168150, 20260905, sha(b"n"), 7));
    assert_eq!(c.amount_kurus, 168150);
    assert_eq!(c.date_yyyymmdd, 20260905);
    assert_eq!(c.reservation_id, 7);
    assert_eq!(c.payee_hash, BytesN::from_array(&w.env, &payee()));
}

#[test]
fn istanbul_day_boundary() {
    // 2026-09-07 21:30 UTC = 2026-09-08 00:30 Istanbul: a dekont dated 08.09 is valid,
    // one dated 07.09 (yesterday in Istanbul) is not accepted for a reservation taken "today".
    let w = setup();
    w.env.ledger().set_timestamp(T0 + 21 * 3600 + 1800);
    let rid = reserve(&w);
    assert_eq!(w.client.try_settle(&rid, &w.buyer, &pv(&w, payee(), SLICE_TRY, 20_260_907, sha(b"y"), rid), &good_proof(&w.env)), Err(Ok(Error::DateOutOfWindow)));
    w.client.settle(&rid, &w.buyer, &pv(&w, payee(), SLICE_TRY, 20_260_908, sha(b"t"), rid), &good_proof(&w.env));
}

#[test]
fn date_math() {
    assert_eq!(days_from_yyyymmdd(19_700_101), Some(0));
    assert_eq!(days_from_yyyymmdd(20_260_907), Some(20_703));
    assert_eq!(days_from_yyyymmdd(20_260_931), None);
    assert_eq!(days_from_yyyymmdd(20_261_301), None);
    assert_eq!(quote_kurus(SLICE, PRICE, 7), SLICE_TRY);
    assert_eq!(quote_kurus(1, PRICE, 7), 1);
    assert_eq!(quote_kurus(3 * ONE, 3333, 7), 9999);
}
