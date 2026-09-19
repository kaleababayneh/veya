#![cfg(test)]
#![allow(clippy::inconsistent_digit_grouping)]
//! Escrow unit tests. The RISC Zero verifier router is replaced by a test double that accepts
//! seals whose first byte is 0x01; real receipt verification happens on testnet via Nethermind's stack.

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
    pub fn verify(
        _env: Env,
        seal: Bytes,
        _image_id: BytesN<32>,
        _journal_digest: BytesN<32>,
    ) -> Result<(), StubErr> {
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
const BOND: i128 = 5_0000000; // 5 % of the 100-token offer
const IBAN: &str = "TR33 0006 1005 1978 6457 8413 26";
const NAME: &str = "AYŞE YILMAZ";
const DOMAIN: &str = "ileti.ziraatbank.com.tr";

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
    StellarAssetClient::new(&env, &token).mint(&seller, &1_000_0000000);

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
        50_00u64.into_val(&env),    // min 50 TRY
        5_000_00u64.into_val(&env), // max 5,000 TRY
        PROOF_WINDOW.into_val(&env),
        BOND_BPS.into_val(&env),
        LATE_WINDOW.into_val(&env),
    ];
    let id = env.register(OtcEscrow, args);
    let client = OtcEscrowClient::new(&env, &id);
    World {
        env,
        client,
        token,
        seller,
        buyer,
        fee_to,
        dkim_key,
    }
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

fn iban_hash() -> [u8; 32] {
    payee_hash_of(IBAN, NAME)
}

fn pv(w: &World, iban_hash: [u8; 32], amount: u64, date: u64, nullifier: [u8; 32], offer_id: u64) -> Bytes {
    let mut v = std::vec::Vec::with_capacity(152);
    v.extend_from_slice(&w.dkim_key);
    v.extend_from_slice(&sha(DOMAIN.as_bytes()));
    v.extend_from_slice(&iban_hash);
    v.extend_from_slice(&amount.to_be_bytes());
    v.extend_from_slice(&date.to_be_bytes());
    v.extend_from_slice(&nullifier);
    v.extend_from_slice(&offer_id.to_be_bytes());
    Bytes::from_slice(&w.env, &v)
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

fn create(w: &World) -> u64 {
    w.client.create_offer(
        &w.seller,
        &w.token,
        &100_0000000, // 100 tokens
        &4_000_00,    // 4,000 TRY
        &s(&w.env, IBAN),
        &s(&w.env, NAME),
        &0,
    )
}

fn bal(w: &World, who: &Address) -> i128 {
    TokenClient::new(&w.env, &w.token).balance(who)
}

#[test]
fn create_deposits_and_normalizes_iban() {
    let w = setup();
    let id = create(&w);
    assert_eq!(id, 1);
    let o = w.client.get_offer(&id);
    assert_eq!(o.status, OfferStatus::Open);
    assert_eq!(o.seller_iban, s(&w.env, "TR330006100519786457841326"));
    assert_eq!(o.payee_hash, BytesN::from_array(&w.env, &iban_hash()));
    assert_eq!(o.seller_name, s(&w.env, NAME));
    assert_eq!(o.bond, BOND);
    assert_eq!(bal(&w, &w.seller), 895_0000000, "amount + 5% bond deposited");
    assert_eq!(bal(&w, &w.client.address), 105_0000000);
    assert_eq!(w.client.offer_count(), 1);
    assert_eq!(w.client.list_offers(&0, &10).len(), 1);
}

#[test]
fn create_rejects_bad_inputs() {
    let w = setup();
    let other = Address::generate(&w.env);
    let e = &w.env;
    assert_eq!(
        w.client.try_create_offer(&w.seller, &other, &1, &4_000_00, &s(e, IBAN), &s(e, NAME), &0),
        Err(Ok(Error::TokenNotAllowed))
    );
    assert_eq!(
        w.client.try_create_offer(&w.seller, &w.token, &1, &10_00, &s(e, IBAN), &s(e, NAME), &0),
        Err(Ok(Error::AmountOutOfRange))
    );
    assert_eq!(
        w.client.try_create_offer(&w.seller, &w.token, &1, &4_000_00, &s(e, "DE89 3704 0044 0532 0130 00"), &s(e, NAME), &0),
        Err(Ok(Error::InvalidIban))
    );
    assert_eq!(
        w.client.try_create_offer(&w.seller, &w.token, &1, &4_000_00, &s(e, IBAN), &s(e, NAME), &(NOW - 1)),
        Err(Ok(Error::InvalidExpiry))
    );
    assert_eq!(
        w.client.try_create_offer(&w.seller, &w.token, &0, &4_000_00, &s(e, IBAN), &s(e, NAME), &0),
        Err(Ok(Error::InvalidAmount))
    );
}

#[test]
fn lock_is_exclusive_until_expiry() {
    let w = setup();
    let id = create(&w);
    let o = w.client.lock(&id, &w.buyer);
    assert_eq!(o.status, OfferStatus::Locked);
    assert_eq!(o.lock_expires_at, NOW + LOCK);

    let other = Address::generate(&w.env);
    assert_eq!(w.client.try_lock(&id, &other), Err(Ok(Error::LockActive)));
    assert_eq!(w.client.try_cancel_offer(&id), Err(Ok(Error::LockActive)));

    // after expiry another buyer can take over
    w.env.ledger().set_timestamp(NOW + LOCK + 1);
    let o = w.client.lock(&id, &other);
    assert_eq!(o.buyer, Some(other));
}

#[test]
fn fulfill_happy_path_pays_buyer_and_fee() {
    let w = setup();
    let id = create(&w);
    w.client.lock(&id, &w.buyer);
    let claim = w.client.fulfill(
        &id,
        &w.buyer,
        &pv(&w, iban_hash(), 4_000_00, DAY0, sha(b"row-1"), id),
        &good_proof(&w.env),
    );
    assert_eq!(claim.amount_kurus, 4_000_00);
    assert_eq!(w.client.get_offer(&id).status, OfferStatus::Fulfilled);
    // 25 bps fee; the bond returns to the seller with the settlement
    assert_eq!(bal(&w, &w.buyer), 99_7500000);
    assert_eq!(bal(&w, &w.fee_to), 2500000);
    assert_eq!(bal(&w, &w.seller), 900_0000000);
    assert_eq!(bal(&w, &w.client.address), 0);
    assert_eq!(w.client.get_offer(&id).bond, 0);
    assert!(w.client.is_nullifier_used(&BytesN::from_array(&w.env, &sha(b"row-1"))));
}

#[test]
fn fulfill_rejections() {
    let w = setup();
    let id = create(&w);
    let other = Address::generate(&w.env);

    // not locked yet
    assert_eq!(
        w.client.try_fulfill(&id, &w.buyer, &pv(&w, iban_hash(), 4_000_00, DAY0, sha(b"n"), id), &good_proof(&w.env)),
        Err(Ok(Error::InvalidStatus))
    );
    w.client.lock(&id, &w.buyer);

    let ok = |n: &[u8]| pv(&w, iban_hash(), 4_000_00, DAY0, sha(n), id);
    assert_eq!(w.client.try_fulfill(&id, &other, &ok(b"a"), &good_proof(&w.env)), Err(Ok(Error::NotBuyer)));
    assert_eq!(w.client.try_fulfill(&id, &w.buyer, &ok(b"a"), &bad_proof(&w.env)), Err(Ok(Error::ProofInvalid)));
    assert_eq!(
        w.client.try_fulfill(&id, &w.buyer, &pv(&w, iban_hash(), 4_000_00, DAY0, sha(b"a"), id + 1), &good_proof(&w.env)),
        Err(Ok(Error::WrongOffer))
    );
    assert_eq!(
        w.client.try_fulfill(&id, &w.buyer, &pv(&w, sha(b"other iban"), 4_000_00, DAY0, sha(b"a"), id), &good_proof(&w.env)),
        Err(Ok(Error::PayeeMismatch))
    );
    assert_eq!(
        w.client.try_fulfill(&id, &w.buyer, &pv(&w, iban_hash(), 3_999_99, DAY0, sha(b"a"), id), &good_proof(&w.env)),
        Err(Ok(Error::AmountTooLow))
    );
    // paid the day before the lock (Istanbul date)
    assert_eq!(
        w.client.try_fulfill(&id, &w.buyer, &pv(&w, iban_hash(), 4_000_00, 20_260_906, sha(b"a"), id), &good_proof(&w.env)),
        Err(Ok(Error::DateOutOfWindow))
    );
    // statement dated tomorrow
    assert_eq!(
        w.client.try_fulfill(&id, &w.buyer, &pv(&w, iban_hash(), 4_000_00, 20_260_908, sha(b"a"), id), &good_proof(&w.env)),
        Err(Ok(Error::DateOutOfWindow))
    );
    // malformed date
    assert_eq!(
        w.client.try_fulfill(&id, &w.buyer, &pv(&w, iban_hash(), 4_000_00, 20_261_345, sha(b"a"), id), &good_proof(&w.env)),
        Err(Ok(Error::InvalidPublicValues))
    );
    // short public values
    assert_eq!(
        w.client.try_fulfill(&id, &w.buyer, &Bytes::from_array(&w.env, &[0u8; 151]), &good_proof(&w.env)),
        Err(Ok(Error::InvalidPublicValues))
    );
    // untrusted dkim key / wrong domain
    let mut v = std::vec![0u8; 152];
    ok(b"a").copy_into_slice(&mut v);
    v[0] ^= 1;
    assert_eq!(
        w.client.try_fulfill(&id, &w.buyer, &Bytes::from_slice(&w.env, &v), &good_proof(&w.env)),
        Err(Ok(Error::DkimKeyNotTrusted))
    );
    v[0] ^= 1;
    v[40] ^= 1;
    assert_eq!(
        w.client.try_fulfill(&id, &w.buyer, &Bytes::from_slice(&w.env, &v), &good_proof(&w.env)),
        Err(Ok(Error::DomainMismatch))
    );
    // still locked, buyer still owns it, funds (amount + bond) untouched
    assert_eq!(w.client.get_offer(&id).status, OfferStatus::Locked);
    assert_eq!(bal(&w, &w.client.address), 105_0000000);
}

#[test]
fn istanbul_day_boundary() {
    // 2026-09-07 21:30 UTC = 2026-09-08 00:30 Istanbul: a statement dated 08.09 is valid,
    // one dated 07.09 (yesterday in Istanbul) is not accepted for a lock taken "today".
    let w = setup();
    let id = create(&w);
    w.env.ledger().set_timestamp(T0 + 21 * 3600 + 1800);
    w.client.lock(&id, &w.buyer);
    assert_eq!(
        w.client.try_fulfill(&id, &w.buyer, &pv(&w, iban_hash(), 4_000_00, 20_260_907, sha(b"a"), id), &good_proof(&w.env)),
        Err(Ok(Error::DateOutOfWindow))
    );
    w.client.fulfill(&id, &w.buyer, &pv(&w, iban_hash(), 4_000_00, 20_260_908, sha(b"a"), id), &good_proof(&w.env));
}

#[test]
fn nullifier_cannot_be_reused_across_offers() {
    let w = setup();
    let id1 = create(&w);
    let id2 = create(&w);
    w.client.lock(&id1, &w.buyer);
    w.client.lock(&id2, &w.buyer);
    let n = sha(b"same-bank-row");
    w.client.fulfill(&id1, &w.buyer, &pv(&w, iban_hash(), 4_000_00, DAY0, n, id1), &good_proof(&w.env));
    assert_eq!(
        w.client.try_fulfill(&id2, &w.buyer, &pv(&w, iban_hash(), 4_000_00, DAY0, n, id2), &good_proof(&w.env)),
        Err(Ok(Error::NullifierUsed))
    );
}

#[test]
fn fulfill_allowed_after_lock_expiry_if_not_unlocked() {
    let w = setup();
    let id = create(&w);
    w.client.lock(&id, &w.buyer);
    w.env.ledger().set_timestamp(NOW + LOCK + 10);
    w.client.fulfill(&id, &w.buyer, &pv(&w, iban_hash(), 4_000_00, DAY0, sha(b"x"), id), &good_proof(&w.env));
    assert_eq!(w.client.get_offer(&id).status, OfferStatus::Fulfilled);
}

#[test]
fn cancel_and_unlock_paths() {
    let w = setup();
    let id = create(&w);
    w.client.lock(&id, &w.buyer);

    let stranger = Address::generate(&w.env);
    assert_eq!(w.client.try_unlock(&id, &stranger), Err(Ok(Error::LockActive)));
    w.client.unlock(&id, &w.buyer);
    assert_eq!(w.client.get_offer(&id).status, OfferStatus::Open);

    w.client.lock(&id, &w.buyer);
    w.env.ledger().set_timestamp(NOW + LOCK + 1);
    w.client.unlock(&id, &stranger);
    w.client.cancel_offer(&id);
    assert_eq!(w.client.get_offer(&id).status, OfferStatus::Cancelled);
    assert_eq!(bal(&w, &w.seller), 1_000_0000000);
    assert_eq!(w.client.try_lock(&id, &w.buyer), Err(Ok(Error::InvalidStatus)));
    assert_eq!(w.client.try_cancel_offer(&id), Err(Ok(Error::InvalidStatus)));
}

#[test]
fn seller_can_cancel_directly_after_lock_expiry() {
    let w = setup();
    let id = create(&w);
    w.client.lock(&id, &w.buyer);
    w.env.ledger().set_timestamp(NOW + LOCK);
    w.client.cancel_offer(&id);
    assert_eq!(w.client.get_offer(&id).status, OfferStatus::Cancelled);
}

#[test]
fn expired_offer_cannot_be_locked() {
    let w = setup();
    let id = w.client.create_offer(&w.seller, &w.token, &10_0000000, &4_000_00, &s(&w.env, IBAN), &s(&w.env, NAME), &(NOW + 7200));
    w.env.ledger().set_timestamp(NOW + 7200);
    assert_eq!(w.client.try_lock(&id, &w.buyer), Err(Ok(Error::OfferExpired)));
    w.client.cancel_offer(&id);
}

#[test]
fn pause_blocks_new_activity_but_never_settlement() {
    let w = setup();
    let id = create(&w);
    let id2 = create(&w);
    w.client.lock(&id, &w.buyer);
    w.client.set_paused(&true);
    assert_eq!(
        w.client.try_create_offer(&w.seller, &w.token, &1_0000000, &4_000_00, &s(&w.env, IBAN), &s(&w.env, NAME), &0),
        Err(Ok(Error::Paused))
    );
    assert_eq!(w.client.try_lock(&id2, &w.buyer), Err(Ok(Error::Paused)));
    // settlement and exits still work
    w.client.fulfill(&id, &w.buyer, &pv(&w, iban_hash(), 4_000_00, DAY0, sha(b"p"), id), &good_proof(&w.env));
    w.client.cancel_offer(&id2);
}

#[test]
fn fee_cap_enforced() {
    let w = setup();
    let cfg = w.client.config();
    assert_eq!(
        w.client.try_set_config(&cfg.verifier, &cfg.image_id, &cfg.domain_hash, &cfg.lock_duration, &101, &cfg.fee_recipient, &cfg.min_try_kurus, &cfg.max_try_kurus, &cfg.proof_window, &cfg.bond_bps, &cfg.late_claim_window),
        Err(Ok(Error::InvalidFee))
    );
    assert_eq!(
        w.client.try_set_config(&cfg.verifier, &cfg.image_id, &cfg.domain_hash, &cfg.lock_duration, &cfg.fee_bps, &cfg.fee_recipient, &cfg.min_try_kurus, &cfg.max_try_kurus, &cfg.proof_window, &5_001, &cfg.late_claim_window),
        Err(Ok(Error::InvalidBond))
    );
}

#[test]
fn payee_hash_view_matches_guest_convention() {
    let w = setup();
    let h = w.client.payee_hash(&s(&w.env, "tr33 0006 1005 1978 6457 8413 26"), &s(&w.env, "Ayşe  Yılmaz"));
    assert_eq!(h, BytesN::from_array(&w.env, &payee_hash_of("TR330006100519786457841326", "AYSE YILMAZ")));
    // Turkish folding: İ/ı → I, Ç → C, Ö → O, Ş → S, Ü → U, Ğ → G
    let h2 = w.client.payee_hash(&s(&w.env, IBAN), &s(&w.env, "İbrahim Çağrı Öztürk Şık Ğ"));
    assert_eq!(h2, BytesN::from_array(&w.env, &payee_hash_of(IBAN, "IBRAHIM CAGRI OZTURK SIK G")));
}

#[test]
fn decode_claim_roundtrip() {
    let w = setup();
    let c = w.client.decode_claim(&pv(&w, iban_hash(), 123_45, 20_260_907, sha(b"n"), 42));
    assert_eq!(c.amount_kurus, 123_45);
    assert_eq!(c.date_yyyymmdd, 20_260_907);
    assert_eq!(c.offer_id, 42);
}

#[test]
fn date_math() {
    assert_eq!(days_from_yyyymmdd(19_700_101), Some(0));
    assert_eq!(days_from_yyyymmdd(20_260_907), Some((T0 / 86_400) as i64));
    assert_eq!(days_from_yyyymmdd(20_261_301), None);
}

// ───────────────────────── trust gap: declare_paid + seller bond ─────────────────────────

fn proof_for(w: &World, id: u64, row: &[u8]) -> Bytes {
    pv(w, iban_hash(), 4_000_00, DAY0, sha(row), id)
}

#[test]
fn declare_paid_protects_the_buyer() {
    let w = setup();
    let id = create(&w);
    w.client.lock(&id, &w.buyer);
    let stranger = Address::generate(&w.env);

    // buyer pays 10 minutes in and declares it: the lock now runs to declared_at + proof_window
    w.env.ledger().set_timestamp(NOW + 600);
    let o = w.client.declare_paid(&id, &w.buyer);
    assert_eq!(o.lock_expires_at, NOW + 600 + PROOF_WINDOW);
    assert_eq!(o.paid_declared_at, NOW + 600);
    assert_eq!(o.paid_buyer, Some(w.buyer.clone()));

    // the old lock expiry passes: nobody but the buyer can release, the seller cannot withdraw
    w.env.ledger().set_timestamp(NOW + LOCK + 1);
    assert_eq!(w.client.try_unlock(&id, &stranger), Err(Ok(Error::LockActive)));
    assert_eq!(w.client.try_cancel_offer(&id), Err(Ok(Error::LockActive)));
    assert_eq!(w.client.try_lock(&id, &stranger), Err(Ok(Error::LockActive)));

    // the proof lands inside the window: normal settlement, bond back to the seller
    w.client.fulfill(&id, &w.buyer, &proof_for(&w, id, b"r1"), &good_proof(&w.env));
    assert_eq!(w.client.get_offer(&id).status, OfferStatus::Fulfilled);
    assert_eq!(bal(&w, &w.seller), 900_0000000);
    assert_eq!(bal(&w, &w.client.address), 0);
}

#[test]
fn late_claim_wins_the_bond() {
    let w = setup();
    let id = create(&w);
    w.client.lock(&id, &w.buyer);
    w.client.declare_paid(&id, &w.buyer);

    // the whole protection window passes without a proof (prover down); the seller withdraws
    let t_release = NOW + PROOF_WINDOW + 1;
    w.env.ledger().set_timestamp(t_release);
    w.client.cancel_offer(&id);
    let o = w.client.get_offer(&id);
    assert_eq!(o.status, OfferStatus::Cancelled);
    assert_eq!(o.bond, BOND, "bond stays in escrow while a declared payment can still be proven");
    assert_eq!(o.late_claim_until, t_release + LATE_WINDOW);
    assert_eq!(bal(&w, &w.seller), 995_0000000, "amount refunded, bond held");
    assert_eq!(w.client.try_withdraw_bond(&id), Err(Ok(Error::BondHeld)));

    // a stranger cannot claim; the declared buyer proves the payment and gets the bond
    let stranger = Address::generate(&w.env);
    assert_eq!(
        w.client.try_claim_bond(&id, &stranger, &proof_for(&w, id, b"r1"), &good_proof(&w.env)),
        Err(Ok(Error::NotBuyer))
    );
    assert_eq!(
        w.client.try_claim_bond(&id, &w.buyer, &proof_for(&w, id, b"r1"), &bad_proof(&w.env)),
        Err(Ok(Error::ProofInvalid))
    );
    w.env.ledger().set_timestamp(t_release + 3600);
    let claim = w.client.claim_bond(&id, &w.buyer, &proof_for(&w, id, b"r1"), &good_proof(&w.env));
    assert_eq!(claim.offer_id, id);
    assert_eq!(bal(&w, &w.buyer), BOND);
    assert_eq!(bal(&w, &w.client.address), 0);
    let o = w.client.get_offer(&id);
    assert_eq!(o.bond, 0);
    assert_eq!(o.late_claim_until, 0);
    assert_eq!(w.client.try_withdraw_bond(&id), Err(Ok(Error::NoBond)));
    // the same row cannot be used again
    assert_eq!(
        w.client.try_claim_bond(&id, &w.buyer, &proof_for(&w, id, b"r1"), &good_proof(&w.env)),
        Err(Ok(Error::LateClaimClosed))
    );
}

#[test]
fn seller_recovers_the_bond_after_the_claim_window() {
    let w = setup();
    let id = create(&w);
    w.client.lock(&id, &w.buyer);
    w.client.declare_paid(&id, &w.buyer);
    let t_release = NOW + PROOF_WINDOW + 1;
    w.env.ledger().set_timestamp(t_release);
    let stranger = Address::generate(&w.env);
    w.client.unlock(&id, &stranger); // third-party release after expiry keeps the claim right
    let o = w.client.get_offer(&id);
    assert_eq!(o.status, OfferStatus::Open);
    assert_eq!(o.late_claim_until, t_release + LATE_WINDOW);
    w.client.cancel_offer(&id);
    assert_eq!(w.client.try_withdraw_bond(&id), Err(Ok(Error::BondHeld)));

    w.env.ledger().set_timestamp(t_release + LATE_WINDOW + 1);
    assert_eq!(
        w.client.try_claim_bond(&id, &w.buyer, &proof_for(&w, id, b"r1"), &good_proof(&w.env)),
        Err(Ok(Error::LateClaimClosed))
    );
    assert_eq!(w.client.withdraw_bond(&id), BOND);
    assert_eq!(bal(&w, &w.seller), 1_000_0000000);
    assert_eq!(w.client.try_withdraw_bond(&id), Err(Ok(Error::NoBond)));
}

#[test]
fn buyer_who_gives_up_forfeits_the_claim() {
    let w = setup();
    let id = create(&w);
    w.client.lock(&id, &w.buyer);
    w.client.declare_paid(&id, &w.buyer);
    w.client.unlock(&id, &w.buyer); // buyer releases: no late claim survives
    let o = w.client.get_offer(&id);
    assert_eq!(o.paid_buyer, None);
    assert_eq!(o.late_claim_until, 0);
    w.client.cancel_offer(&id);
    assert_eq!(bal(&w, &w.seller), 1_000_0000000, "amount and bond back at once");
    assert_eq!(
        w.client.try_claim_bond(&id, &w.buyer, &proof_for(&w, id, b"r1"), &good_proof(&w.env)),
        Err(Ok(Error::NotBuyer))
    );
}

#[test]
fn takeover_buyer_settles_while_first_buyers_claim_is_pending() {
    let w = setup();
    let id = create(&w);
    w.client.lock(&id, &w.buyer);
    w.client.declare_paid(&id, &w.buyer);
    let t = NOW + PROOF_WINDOW + 1;
    w.env.ledger().set_timestamp(t);
    // another buyer takes the stale lock over: that is a release, the first buyer's claim right opens
    let second = Address::generate(&w.env);
    w.client.lock(&id, &second);
    let o = w.client.get_offer(&id);
    assert_eq!(o.paid_buyer, Some(w.buyer.clone()));
    assert_eq!(o.late_claim_until, t + LATE_WINDOW);
    assert_eq!(w.client.try_declare_paid(&id, &second), Err(Ok(Error::LateClaimPending)));
    // the second buyer settles with their own proof; the bond stays for the first buyer
    w.client.fulfill(&id, &second, &proof_for(&w, id, b"second"), &good_proof(&w.env));
    let o = w.client.get_offer(&id);
    assert_eq!(o.status, OfferStatus::Fulfilled);
    assert_eq!(o.bond, BOND, "bond held: the first buyer may still prove they paid too");
    assert_eq!(w.client.try_withdraw_bond(&id), Err(Ok(Error::BondHeld)));
    // …and does: the seller took two payments for one delivery and loses the bond
    w.client.claim_bond(&id, &w.buyer, &proof_for(&w, id, b"first"), &good_proof(&w.env));
    assert_eq!(bal(&w, &w.buyer), BOND);
    assert_eq!(w.client.get_offer(&id).bond, 0);
}

#[test]
fn declare_paid_rules() {
    let w = setup();
    let id = create(&w);
    let stranger = Address::generate(&w.env);
    assert_eq!(w.client.try_declare_paid(&id, &w.buyer), Err(Ok(Error::InvalidStatus)));
    w.client.lock(&id, &w.buyer);
    assert_eq!(w.client.try_declare_paid(&id, &stranger), Err(Ok(Error::NotBuyer)));
    w.client.declare_paid(&id, &w.buyer);
    assert_eq!(w.client.try_declare_paid(&id, &w.buyer), Err(Ok(Error::AlreadyDeclared)));
    // declaring never shortens a lock that is already longer than the window
    let w2 = setup();
    let id2 = create(&w2);
    w2.client.lock(&id2, &w2.buyer);
    w2.env.ledger().set_timestamp(NOW + LOCK);
    assert_eq!(w2.client.try_declare_paid(&id2, &w2.buyer), Err(Ok(Error::LockExpired)));
}

#[test]
fn bond_cap_enforced() {
    let env = Env::default();
    env.mock_all_auths();
    let a = Address::generate(&env);
    let args: Vec<Val> = vec![
        &env,
        a.clone().into_val(&env),
        a.clone().into_val(&env),
        BytesN::from_array(&env, &[7u8; 32]).into_val(&env),
        BytesN::from_array(&env, &[8u8; 32]).into_val(&env),
        Vec::<BytesN<32>>::new(&env).into_val(&env),
        Vec::<Address>::new(&env).into_val(&env),
        LOCK.into_val(&env),
        25u32.into_val(&env),
        a.into_val(&env),
        50_00u64.into_val(&env),
        5_000_00u64.into_val(&env),
        PROOF_WINDOW.into_val(&env),
        5_001u32.into_val(&env),
        LATE_WINDOW.into_val(&env),
    ];
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| env.register(OtcEscrow, args)));
    assert!(r.is_err(), "bond above 50% must be rejected");
}
