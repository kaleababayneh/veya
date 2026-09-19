import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}





/**
 * A maker's liquidity: what is sold, at what price, in what sizes, and (encrypted) where to pay.
 */
export interface Ad {
  active_reservations: u32;
  /**
 * bond pool not earmarked by any reservation
 */
bond_available: i128;
  /**
 * bond earmarked by reservations (active, or released with a pending late claim)
 */
bond_held: i128;
  created_at: u64;
  /**
 * token decimals (7 for the XLM/USDC SACs); prices are per whole token
 */
decimals: u32;
  /**
 * unix seconds after which no new reservation is accepted (0 = never)
 */
expires_at: u64;
  id: u64;
  max_try_kurus: u64;
  /**
 * per-trade TRY limits
 */
min_try_kurus: u64;
  /**
 * public display name of the maker (no PII)
 */
nickname: string;
  /**
 * IBAN + account holder name, sealed to the reveal service's key (`Config::reveal_pubkey`);
 * revealed off-chain only to the wallet holding a reservation, after it verifies the hash
 */
payee_blob: Buffer;
  /**
 * binding checked against every proof: check digits + bank code + last 6 digits + folded name
 */
payee_hash: Buffer;
  /**
 * kuruş per whole token (1 TRY = 100 kuruş)
 */
price_kurus: u64;
  /**
 * unreserved liquidity (token units)
 */
remaining: i128;
  /**
 * liquidity held by active reservations
 */
reserved: i128;
  seller: string;
  settled_count: u32;
  status: AdStatus;
  token: string;
}

export const Errors = {
  1: {message:"NotInitialized"},
  2: {message:"Paused"},
  3: {message:"AdNotFound"},
  4: {message:"InvalidStatus"},
  5: {message:"ReservationNotFound"},
  6: {message:"NotBuyer"},
  7: {message:"LockActive"},
  8: {message:"NotSeller"},
  9: {message:"AdExpired"},
  10: {message:"TokenNotAllowed"},
  11: {message:"InvalidPublicValues"},
  12: {message:"DkimKeyNotTrusted"},
  13: {message:"DomainMismatch"},
  14: {message:"PayeeMismatch"},
  15: {message:"AmountTooLow"},
  16: {message:"DateOutOfWindow"},
  17: {message:"NullifierUsed"},
  18: {message:"ProofInvalid"},
  19: {message:"WrongReservation"},
  20: {message:"InvalidAmount"},
  21: {message:"InvalidIban"},
  /**
   * the trade's TRY value is outside the ad's (or the deployment's) min/max
   */
  22: {message:"AmountOutOfRange"},
  23: {message:"InvalidExpiry"},
  /**
   * the ad does not have that much unreserved liquidity
   */
  24: {message:"InsufficientLiquidity"},
  25: {message:"InvalidFee"},
  26: {message:"InvalidName"},
  27: {message:"AlreadyDeclared"},
  28: {message:"LateClaimClosed"},
  29: {message:"BondHeld"},
  30: {message:"NoBond"},
  31: {message:"InvalidBond"},
  32: {message:"LockExpired"},
  /**
   * the ad or the buyer already has the maximum number of active reservations
   */
  33: {message:"TooManyReservations"},
  34: {message:"ReferenceMismatch"},
  35: {message:"InvalidPrice"},
  36: {message:"InvalidLimits"},
  37: {message:"BlobTooLarge"},
  /**
   * the ad's bond pool cannot back another reservation right now
   */
  38: {message:"BondExhausted"}
}


export interface Config {
  admin: string;
  /**
 * maker bond in basis points of the deposit, earmarked per reservation pro rata
 */
bond_bps: u32;
  /**
 * sha256 of the accepted DKIM signing domain
 */
domain_hash: Buffer;
  fee_bps: u32;
  fee_recipient: string;
  /**
 * RISC Zero image id of the zkEmail guest
 */
image_id: Buffer;
  /**
 * seconds after a release during which the declared buyer may still `claim_bond`
 */
late_claim_window: u64;
  /**
 * seconds a reservation holds its slice
 */
lock_duration: u64;
  max_active_per_buyer: u32;
  max_reservations_per_ad: u32;
  max_try_kurus: u64;
  /**
 * deployment-wide bounds for an ad's per-trade limits
 */
min_try_kurus: u64;
  paused: boolean;
  /**
 * seconds of protection after `declare_paid`
 */
proof_window: u64;
  /**
 * X25519 public key of the payee-reveal service (makers seal their IBAN + name to it)
 */
reveal_pubkey: Buffer;
  /**
 * RISC Zero verifier router (verify(seal, image_id, journal_digest))
 */
verifier: string;
}

export type DataKey = {tag: "Config", values: void} | {tag: "Tokens", values: void} | {tag: "DkimKeys", values: void} | {tag: "AdCount", values: void} | {tag: "Ad", values: readonly [u64]} | {tag: "ReservationCount", values: void} | {tag: "Reservation", values: readonly [u64]} | {tag: "Nullifier", values: readonly [Buffer]} | {tag: "ActiveCount", values: readonly [string]};


export enum AdStatus {
  Active = 0,
  Closed = 1,
}






/**
 * A taker's slice of an ad.
 */
export interface Reservation {
  ad_id: u64;
  /**
 * token units the buyer receives on settlement (before the protocol fee)
 */
amount: i128;
  /**
 * bond earmarked from the ad's pool for this reservation
 */
bond_slice: i128;
  buyer: string;
  created_at: u64;
  id: u64;
  /**
 * deadline for the buyer's `claim_bond` after a release that ignored a declared payment (0 = none)
 */
late_claim_until: u64;
  lock_expires_at: u64;
  /**
 * when the buyer declared the TRY payment (0 = not declared)
 */
paid_declared_at: u64;
  settled_at: u64;
  status: ReservationStatus;
  /**
 * TRY the buyer must transfer, fixed at the ad's price when reserving
 */
try_amount_kurus: u64;
}



/**
 * Decoded view of the guest's public values.
 */
export interface PaymentClaim {
  amount_kurus: u64;
  date_yyyymmdd: u64;
  dkim_key_hash: Buffer;
  domain_hash: Buffer;
  nullifier: Buffer;
  payee_hash: Buffer;
  reference_hash: Buffer;
  reservation_id: u64;
}




export enum ReservationStatus {
  Active = 0,
  Settled = 1,
  Released = 2,
}

export interface Client {
  /**
   * Construct and simulate a quote transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * TRY (kuruş) a buyer pays for `amount` token units of ad `id` at its current price (rounded up).
   */
  quote: ({id, amount}: {id: u64, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  config: (options?: MethodOptions) => Promise<AssembledTransaction<Result<Config>>>

  /**
   * Construct and simulate a get_ad transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_ad: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Ad>>>

  /**
   * Construct and simulate a settle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Buyer proves the TRY payment and receives the reserved tokens (minus the protocol fee).
   */
  settle: ({id, buyer, public_values, proof}: {id: u64, buyer: string, public_values: Buffer, proof: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<PaymentClaim>>>

  /**
   * Construct and simulate a tokens transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  tokens: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a release transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Buyer releases early (giving up a declared payment), or anyone releases an expired reservation —
   * then a declared payment keeps its late-claim right and the bond slice stays earmarked.
   */
  release: ({id, caller}: {id: u64, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a reserve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Reserve `amount` token units of ad `id`: the slice is locked for `lock_duration` and the TRY amount
   * is fixed now. Then pay by FAST with the payment reference in the description, `declare_paid`, and
   * `settle` with the proof.
   */
  reserve: ({id, buyer, amount}: {id: u64, buyer: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Reservation>>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a ad_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  ad_count: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a close_ad transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Maker withdraws all unreserved liquidity and the unearmarked bond; no new reservations. Active
   * reservations still settle or release (their token and bond slices then go straight to the maker).
   */
  close_ad: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a list_ads transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Ads with ids in `[start, start+limit)` that exist.
   */
  list_ads: ({start, limit}: {start: u64, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Ad>>>

  /**
   * Construct and simulate a create_ad transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Post an ad: deposit `amount` of `token` (plus the bond) at `price_kurus` per whole token, tradeable in
   * slices worth `min_try_kurus..=max_try_kurus`. `payee_hash` must be `payee_hash(iban, name)` of the
   * details sealed in `payee_blob`; buyers verify that before paying, so a mismatch only stalls the ad.
   */
  create_ad: ({seller, token, amount, price_kurus, min_try_kurus, max_try_kurus, payee_hash, payee_blob, nickname, expires_at}: {seller: string, token: string, amount: i128, price_kurus: u64, min_try_kurus: u64, max_try_kurus: u64, payee_hash: Buffer, payee_blob: Buffer, nickname: string, expires_at: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a dkim_keys transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  dkim_keys: (options?: MethodOptions) => Promise<AssembledTransaction<Array<Buffer>>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_price transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Maker changes the price; reservations already taken keep their TRY amount.
   */
  set_price: ({id, price_kurus}: {id: u64, price_kurus: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a claim_bond transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * After a release that ignored a declared payment, the buyer proves the payment within
   * `late_claim_window` and receives the reservation's bond slice.
   */
  claim_bond: ({id, buyer, public_values, proof}: {id: u64, buyer: string, public_values: Buffer, proof: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<PaymentClaim>>>

  /**
   * Construct and simulate a payee_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Payee binding hash for a full IBAN + name, exactly as the guest derives it from a masked dekont.
   */
  payee_hash: ({iban, name}: {iban: string, name: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

  /**
   * Construct and simulate a set_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_config: ({verifier, image_id, domain_hash, lock_duration, fee_bps, fee_recipient, min_try_kurus, max_try_kurus, proof_window, bond_bps, late_claim_window, max_reservations_per_ad, max_active_per_buyer, reveal_pubkey}: {verifier: string, image_id: Buffer, domain_hash: Buffer, lock_duration: u64, fee_bps: u32, fee_recipient: string, min_try_kurus: u64, max_try_kurus: u64, proof_window: u64, bond_bps: u32, late_claim_window: u64, max_reservations_per_ad: u32, max_active_per_buyer: u32, reveal_pubkey: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_paused: ({paused}: {paused: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_tokens transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_tokens: ({tokens}: {tokens: Array<string>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a declare_paid transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The buyer states that the TRY transfer has been sent: nobody but the buyer can release the reservation
   * for at least `proof_window` seconds, and a release after that still leaves `claim_bond` open.
   */
  declare_paid: ({id, buyer}: {id: u64, buyer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Reservation>>>

  /**
   * Construct and simulate a decode_claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pure helper so clients can preview how the contract reads public values.
   */
  decode_claim: ({public_values}: {public_values: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<PaymentClaim>>>

  /**
   * Construct and simulate a reclaim_bond transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return a released reservation's bond slice to the ad (or the maker, if the ad is closed) once its
   * late-claim window has passed. Anyone may call it.
   */
  reclaim_bond: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a set_dkim_keys transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_dkim_keys: ({keys}: {keys: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_reservation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_reservation: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Reservation>>>

  /**
   * Construct and simulate a is_nullifier_used transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_nullifier_used: ({nullifier}: {nullifier: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a list_reservations transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Reservations with ids in `[start, start+limit)` that exist.
   */
  list_reservations: ({start, limit}: {start: u64, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Reservation>>>

  /**
   * Construct and simulate a payment_reference transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The text a buyer must type into the FAST description for reservation `id` when claiming with `buyer`:
   * `ZKOTC<id><6 hex of sha256(buyer address)>`, one token (mirrors `zkotc_lib::payment_reference`).
   */
  payment_reference: ({id, buyer}: {id: u64, buyer: string}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a reservation_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  reservation_count: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a active_reservations transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Active reservations currently held by `buyer`.
   */
  active_reservations: ({buyer}: {buyer: string}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, verifier, image_id, domain_hash, dkim_key_hashes, tokens, lock_duration, fee_bps, fee_recipient, min_try_kurus, max_try_kurus, proof_window, bond_bps, late_claim_window, max_reservations_per_ad, max_active_per_buyer, reveal_pubkey}: {admin: string, verifier: string, image_id: Buffer, domain_hash: Buffer, dkim_key_hashes: Array<Buffer>, tokens: Array<string>, lock_duration: u64, fee_bps: u32, fee_recipient: string, min_try_kurus: u64, max_try_kurus: u64, proof_window: u64, bond_bps: u32, late_claim_window: u64, max_reservations_per_ad: u32, max_active_per_buyer: u32, reveal_pubkey: Buffer},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, verifier, image_id, domain_hash, dkim_key_hashes, tokens, lock_duration, fee_bps, fee_recipient, min_try_kurus, max_try_kurus, proof_window, bond_bps, late_claim_window, max_reservations_per_ad, max_active_per_buyer, reveal_pubkey}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAAF5BIG1ha2VyJ3MgbGlxdWlkaXR5OiB3aGF0IGlzIHNvbGQsIGF0IHdoYXQgcHJpY2UsIGluIHdoYXQgc2l6ZXMsIGFuZCAoZW5jcnlwdGVkKSB3aGVyZSB0byBwYXkuAAAAAAAAAAAAAkFkAAAAAAATAAAAAAAAABNhY3RpdmVfcmVzZXJ2YXRpb25zAAAAAAQAAAAqYm9uZCBwb29sIG5vdCBlYXJtYXJrZWQgYnkgYW55IHJlc2VydmF0aW9uAAAAAAAOYm9uZF9hdmFpbGFibGUAAAAAAAsAAABOYm9uZCBlYXJtYXJrZWQgYnkgcmVzZXJ2YXRpb25zIChhY3RpdmUsIG9yIHJlbGVhc2VkIHdpdGggYSBwZW5kaW5nIGxhdGUgY2xhaW0pAAAAAAAJYm9uZF9oZWxkAAAAAAAACwAAAAAAAAAKY3JlYXRlZF9hdAAAAAAABgAAAER0b2tlbiBkZWNpbWFscyAoNyBmb3IgdGhlIFhMTS9VU0RDIFNBQ3MpOyBwcmljZXMgYXJlIHBlciB3aG9sZSB0b2tlbgAAAAhkZWNpbWFscwAAAAQAAABDdW5peCBzZWNvbmRzIGFmdGVyIHdoaWNoIG5vIG5ldyByZXNlcnZhdGlvbiBpcyBhY2NlcHRlZCAoMCA9IG5ldmVyKQAAAAAKZXhwaXJlc19hdAAAAAAABgAAAAAAAAACaWQAAAAAAAYAAAAAAAAADW1heF90cnlfa3VydXMAAAAAAAAGAAAAFHBlci10cmFkZSBUUlkgbGltaXRzAAAADW1pbl90cnlfa3VydXMAAAAAAAAGAAAAKXB1YmxpYyBkaXNwbGF5IG5hbWUgb2YgdGhlIG1ha2VyIChubyBQSUkpAAAAAAAACG5pY2tuYW1lAAAAEAAAALFJQkFOICsgYWNjb3VudCBob2xkZXIgbmFtZSwgc2VhbGVkIHRvIHRoZSByZXZlYWwgc2VydmljZSdzIGtleSAoYENvbmZpZzo6cmV2ZWFsX3B1YmtleWApOwpyZXZlYWxlZCBvZmYtY2hhaW4gb25seSB0byB0aGUgd2FsbGV0IGhvbGRpbmcgYSByZXNlcnZhdGlvbiwgYWZ0ZXIgaXQgdmVyaWZpZXMgdGhlIGhhc2gAAAAAAAAKcGF5ZWVfYmxvYgAAAAAADgAAAFtiaW5kaW5nIGNoZWNrZWQgYWdhaW5zdCBldmVyeSBwcm9vZjogY2hlY2sgZGlnaXRzICsgYmFuayBjb2RlICsgbGFzdCA2IGRpZ2l0cyArIGZvbGRlZCBuYW1lAAAAAApwYXllZV9oYXNoAAAAAAPuAAAAIAAAACtrdXJ1xZ8gcGVyIHdob2xlIHRva2VuICgxIFRSWSA9IDEwMCBrdXJ1xZ8pAAAAAAtwcmljZV9rdXJ1cwAAAAAGAAAAInVucmVzZXJ2ZWQgbGlxdWlkaXR5ICh0b2tlbiB1bml0cykAAAAAAAlyZW1haW5pbmcAAAAAAAALAAAAJWxpcXVpZGl0eSBoZWxkIGJ5IGFjdGl2ZSByZXNlcnZhdGlvbnMAAAAAAAAIcmVzZXJ2ZWQAAAALAAAAAAAAAAZzZWxsZXIAAAAAABMAAAAAAAAADXNldHRsZWRfY291bnQAAAAAAAAEAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAIQWRTdGF0dXMAAAAAAAAABXRva2VuAAAAAAAAEw==",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAJgAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAABlBhdXNlZAAAAAAAAgAAAAAAAAAKQWROb3RGb3VuZAAAAAAAAwAAAAAAAAANSW52YWxpZFN0YXR1cwAAAAAAAAQAAAAAAAAAE1Jlc2VydmF0aW9uTm90Rm91bmQAAAAABQAAAAAAAAAITm90QnV5ZXIAAAAGAAAAAAAAAApMb2NrQWN0aXZlAAAAAAAHAAAAAAAAAAlOb3RTZWxsZXIAAAAAAAAIAAAAAAAAAAlBZEV4cGlyZWQAAAAAAAAJAAAAAAAAAA9Ub2tlbk5vdEFsbG93ZWQAAAAACgAAAAAAAAATSW52YWxpZFB1YmxpY1ZhbHVlcwAAAAALAAAAAAAAABFEa2ltS2V5Tm90VHJ1c3RlZAAAAAAAAAwAAAAAAAAADkRvbWFpbk1pc21hdGNoAAAAAAANAAAAAAAAAA1QYXllZU1pc21hdGNoAAAAAAAADgAAAAAAAAAMQW1vdW50VG9vTG93AAAADwAAAAAAAAAPRGF0ZU91dE9mV2luZG93AAAAABAAAAAAAAAADU51bGxpZmllclVzZWQAAAAAAAARAAAAAAAAAAxQcm9vZkludmFsaWQAAAASAAAAAAAAABBXcm9uZ1Jlc2VydmF0aW9uAAAAEwAAAAAAAAANSW52YWxpZEFtb3VudAAAAAAAABQAAAAAAAAAC0ludmFsaWRJYmFuAAAAABUAAABHdGhlIHRyYWRlJ3MgVFJZIHZhbHVlIGlzIG91dHNpZGUgdGhlIGFkJ3MgKG9yIHRoZSBkZXBsb3ltZW50J3MpIG1pbi9tYXgAAAAAEEFtb3VudE91dE9mUmFuZ2UAAAAWAAAAAAAAAA1JbnZhbGlkRXhwaXJ5AAAAAAAAFwAAADN0aGUgYWQgZG9lcyBub3QgaGF2ZSB0aGF0IG11Y2ggdW5yZXNlcnZlZCBsaXF1aWRpdHkAAAAAFUluc3VmZmljaWVudExpcXVpZGl0eQAAAAAAABgAAAAAAAAACkludmFsaWRGZWUAAAAAABkAAAAAAAAAC0ludmFsaWROYW1lAAAAABoAAAAAAAAAD0FscmVhZHlEZWNsYXJlZAAAAAAbAAAAAAAAAA9MYXRlQ2xhaW1DbG9zZWQAAAAAHAAAAAAAAAAIQm9uZEhlbGQAAAAdAAAAAAAAAAZOb0JvbmQAAAAAAB4AAAAAAAAAC0ludmFsaWRCb25kAAAAAB8AAAAAAAAAC0xvY2tFeHBpcmVkAAAAACAAAABJdGhlIGFkIG9yIHRoZSBidXllciBhbHJlYWR5IGhhcyB0aGUgbWF4aW11bSBudW1iZXIgb2YgYWN0aXZlIHJlc2VydmF0aW9ucwAAAAAAABNUb29NYW55UmVzZXJ2YXRpb25zAAAAACEAAAAAAAAAEVJlZmVyZW5jZU1pc21hdGNoAAAAAAAAIgAAAAAAAAAMSW52YWxpZFByaWNlAAAAIwAAAAAAAAANSW52YWxpZExpbWl0cwAAAAAAACQAAAAAAAAADEJsb2JUb29MYXJnZQAAACUAAAA8dGhlIGFkJ3MgYm9uZCBwb29sIGNhbm5vdCBiYWNrIGFub3RoZXIgcmVzZXJ2YXRpb24gcmlnaHQgbm93AAAADUJvbmRFeGhhdXN0ZWQAAAAAAAAm",
        "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAAEAAAAAAAAAAFYWRtaW4AAAAAAAATAAAATW1ha2VyIGJvbmQgaW4gYmFzaXMgcG9pbnRzIG9mIHRoZSBkZXBvc2l0LCBlYXJtYXJrZWQgcGVyIHJlc2VydmF0aW9uIHBybyByYXRhAAAAAAAACGJvbmRfYnBzAAAABAAAACpzaGEyNTYgb2YgdGhlIGFjY2VwdGVkIERLSU0gc2lnbmluZyBkb21haW4AAAAAAAtkb21haW5faGFzaAAAAAPuAAAAIAAAAAAAAAAHZmVlX2JwcwAAAAAEAAAAAAAAAA1mZWVfcmVjaXBpZW50AAAAAAAAEwAAACdSSVNDIFplcm8gaW1hZ2UgaWQgb2YgdGhlIHprRW1haWwgZ3Vlc3QAAAAACGltYWdlX2lkAAAD7gAAACAAAABOc2Vjb25kcyBhZnRlciBhIHJlbGVhc2UgZHVyaW5nIHdoaWNoIHRoZSBkZWNsYXJlZCBidXllciBtYXkgc3RpbGwgYGNsYWltX2JvbmRgAAAAAAARbGF0ZV9jbGFpbV93aW5kb3cAAAAAAAAGAAAAJXNlY29uZHMgYSByZXNlcnZhdGlvbiBob2xkcyBpdHMgc2xpY2UAAAAAAAANbG9ja19kdXJhdGlvbgAAAAAAAAYAAAAAAAAAFG1heF9hY3RpdmVfcGVyX2J1eWVyAAAABAAAAAAAAAAXbWF4X3Jlc2VydmF0aW9uc19wZXJfYWQAAAAABAAAAAAAAAANbWF4X3RyeV9rdXJ1cwAAAAAAAAYAAAAzZGVwbG95bWVudC13aWRlIGJvdW5kcyBmb3IgYW4gYWQncyBwZXItdHJhZGUgbGltaXRzAAAAAA1taW5fdHJ5X2t1cnVzAAAAAAAABgAAAAAAAAAGcGF1c2VkAAAAAAABAAAAKnNlY29uZHMgb2YgcHJvdGVjdGlvbiBhZnRlciBgZGVjbGFyZV9wYWlkYAAAAAAADHByb29mX3dpbmRvdwAAAAYAAABTWDI1NTE5IHB1YmxpYyBrZXkgb2YgdGhlIHBheWVlLXJldmVhbCBzZXJ2aWNlIChtYWtlcnMgc2VhbCB0aGVpciBJQkFOICsgbmFtZSB0byBpdCkAAAAADXJldmVhbF9wdWJrZXkAAAAAAAPuAAAAIAAAAEJSSVNDIFplcm8gdmVyaWZpZXIgcm91dGVyICh2ZXJpZnkoc2VhbCwgaW1hZ2VfaWQsIGpvdXJuYWxfZGlnZXN0KSkAAAAAAAh2ZXJpZmllcgAAABM=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAACQAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAAAAAAAAAAAGVG9rZW5zAAAAAAAAAAAAAAAAAAhEa2ltS2V5cwAAAAAAAAAAAAAAB0FkQ291bnQAAAAAAQAAAAAAAAACQWQAAAAAAAEAAAAGAAAAAAAAAAAAAAAQUmVzZXJ2YXRpb25Db3VudAAAAAEAAAAAAAAAC1Jlc2VydmF0aW9uAAAAAAEAAAAGAAAAAQAAAAAAAAAJTnVsbGlmaWVyAAAAAAAAAQAAA+4AAAAgAAAAAQAAAAAAAAALQWN0aXZlQ291bnQAAAAAAQAAABM=",
        "AAAABQAAAAAAAAAAAAAAB1NldHRsZWQAAAAAAQAAAAdzZXR0bGVkAAAAAAcAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAFYWRfaWQAAAAAAAAGAAAAAQAAAAAAAAAFYnV5ZXIAAAAAAAATAAAAAAAAAAAAAAAMYW1vdW50X2t1cnVzAAAABgAAAAAAAAAAAAAADWRhdGVfeXl5eW1tZGQAAAAAAAAGAAAAAAAAAAAAAAAGcGF5b3V0AAAAAAALAAAAAAAAAAAAAAADZmVlAAAAAAsAAAAAAAAAAg==",
        "AAAAAwAAAAAAAAAAAAAACEFkU3RhdHVzAAAAAgAAAAAAAAAGQWN0aXZlAAAAAAAAAAAAAAAAAAZDbG9zZWQAAAAAAAE=",
        "AAAABQAAAAAAAAAAAAAACEFkQ2xvc2VkAAAAAQAAAAlhZF9jbG9zZWQAAAAAAAAEAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAABnNlbGxlcgAAAAAAEwAAAAAAAAAAAAAACXdpdGhkcmF3bgAAAAAAAAsAAAAAAAAAAAAAAA5ib25kX3dpdGhkcmF3bgAAAAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAACFJlbGVhc2VkAAAAAQAAAAhyZWxlYXNlZAAAAAUAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAFYWRfaWQAAAAAAAAGAAAAAQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAAAAAAMYWZ0ZXJfZXhwaXJ5AAAAAQAAAAAAAAAAAAAAEGxhdGVfY2xhaW1fdW50aWwAAAAGAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAACFJlc2VydmVkAAAAAQAAAAhyZXNlcnZlZAAAAAYAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAFYWRfaWQAAAAAAAAGAAAAAQAAAAAAAAAFYnV5ZXIAAAAAAAATAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAAAAAAQdHJ5X2Ftb3VudF9rdXJ1cwAAAAYAAAAAAAAAAAAAAA9sb2NrX2V4cGlyZXNfYXQAAAAABgAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAACUFkQ3JlYXRlZAAAAAAAAAEAAAAKYWRfY3JlYXRlZAAAAAAACAAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAAZzZWxsZXIAAAAAABMAAAAAAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAAAAAAtwcmljZV9rdXJ1cwAAAAAGAAAAAAAAAAAAAAANbWluX3RyeV9rdXJ1cwAAAAAAAAYAAAAAAAAAAAAAAA1tYXhfdHJ5X2t1cnVzAAAAAAAABgAAAAAAAAAAAAAABGJvbmQAAAALAAAAAAAAAAI=",
        "AAAAAQAAABlBIHRha2VyJ3Mgc2xpY2Ugb2YgYW4gYWQuAAAAAAAAAAAAAAtSZXNlcnZhdGlvbgAAAAAMAAAAAAAAAAVhZF9pZAAAAAAAAAYAAABGdG9rZW4gdW5pdHMgdGhlIGJ1eWVyIHJlY2VpdmVzIG9uIHNldHRsZW1lbnQgKGJlZm9yZSB0aGUgcHJvdG9jb2wgZmVlKQAAAAAABmFtb3VudAAAAAAACwAAADZib25kIGVhcm1hcmtlZCBmcm9tIHRoZSBhZCdzIHBvb2wgZm9yIHRoaXMgcmVzZXJ2YXRpb24AAAAAAApib25kX3NsaWNlAAAAAAALAAAAAAAAAAVidXllcgAAAAAAABMAAAAAAAAACmNyZWF0ZWRfYXQAAAAAAAYAAAAAAAAAAmlkAAAAAAAGAAAAYGRlYWRsaW5lIGZvciB0aGUgYnV5ZXIncyBgY2xhaW1fYm9uZGAgYWZ0ZXIgYSByZWxlYXNlIHRoYXQgaWdub3JlZCBhIGRlY2xhcmVkIHBheW1lbnQgKDAgPSBub25lKQAAABBsYXRlX2NsYWltX3VudGlsAAAABgAAAAAAAAAPbG9ja19leHBpcmVzX2F0AAAAAAYAAAA6d2hlbiB0aGUgYnV5ZXIgZGVjbGFyZWQgdGhlIFRSWSBwYXltZW50ICgwID0gbm90IGRlY2xhcmVkKQAAAAAAEHBhaWRfZGVjbGFyZWRfYXQAAAAGAAAAAAAAAApzZXR0bGVkX2F0AAAAAAAGAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAARUmVzZXJ2YXRpb25TdGF0dXMAAAAAAABDVFJZIHRoZSBidXllciBtdXN0IHRyYW5zZmVyLCBmaXhlZCBhdCB0aGUgYWQncyBwcmljZSB3aGVuIHJlc2VydmluZwAAAAAQdHJ5X2Ftb3VudF9rdXJ1cwAAAAY=",
        "AAAABQAAAAAAAAAAAAAAC0JvbmRTbGFzaGVkAAAAAAEAAAAMYm9uZF9zbGFzaGVkAAAAAwAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAAVidXllcgAAAAAAABMAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAAAQAAACpEZWNvZGVkIHZpZXcgb2YgdGhlIGd1ZXN0J3MgcHVibGljIHZhbHVlcy4AAAAAAAAAAAAMUGF5bWVudENsYWltAAAACAAAAAAAAAAMYW1vdW50X2t1cnVzAAAABgAAAAAAAAANZGF0ZV95eXl5bW1kZAAAAAAAAAYAAAAAAAAADWRraW1fa2V5X2hhc2gAAAAAAAPuAAAAIAAAAAAAAAALZG9tYWluX2hhc2gAAAAD7gAAACAAAAAAAAAACW51bGxpZmllcgAAAAAAA+4AAAAgAAAAAAAAAApwYXllZV9oYXNoAAAAAAPuAAAAIAAAAAAAAAAOcmVmZXJlbmNlX2hhc2gAAAAAA+4AAAAgAAAAAAAAAA5yZXNlcnZhdGlvbl9pZAAAAAAABg==",
        "AAAABQAAAAAAAAAAAAAADUJvbmRSZWNsYWltZWQAAAAAAAABAAAADmJvbmRfcmVjbGFpbWVkAAAAAAADAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAABWFkX2lkAAAAAAAABgAAAAEAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADkFkUHJpY2VDaGFuZ2VkAAAAAAABAAAAEGFkX3ByaWNlX2NoYW5nZWQAAAACAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAAC3ByaWNlX2t1cnVzAAAAAAYAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAD1BheW1lbnREZWNsYXJlZAAAAAABAAAAEHBheW1lbnRfZGVjbGFyZWQAAAAEAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAABWJ1eWVyAAAAAAAAEwAAAAAAAAAAAAAAC2RlY2xhcmVkX2F0AAAAAAYAAAAAAAAAAAAAAA9wcm90ZWN0ZWRfdW50aWwAAAAABgAAAAAAAAAC",
        "AAAAAwAAAAAAAAAAAAAAEVJlc2VydmF0aW9uU3RhdHVzAAAAAAAAAwAAAAAAAAAGQWN0aXZlAAAAAAAAAAAAAAAAAAdTZXR0bGVkAAAAAAEAAABhbG9jayBlbmRlZCB3aXRob3V0IHNldHRsZW1lbnQ7IGEgZGVjbGFyZWQgcGF5bWVudCBtYXkgc3RpbGwgYGNsYWltX2JvbmRgIHVudGlsIGBsYXRlX2NsYWltX3VudGlsYAAAAAAAAAhSZWxlYXNlZAAAAAI=",
        "AAAAAAAAAGBUUlkgKGt1cnXFnykgYSBidXllciBwYXlzIGZvciBgYW1vdW50YCB0b2tlbiB1bml0cyBvZiBhZCBgaWRgIGF0IGl0cyBjdXJyZW50IHByaWNlIChyb3VuZGVkIHVwKS4AAAAFcXVvdGUAAAAAAAACAAAAAAAAAAJpZAAAAAAABgAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAAGAAAAAw==",
        "AAAAAAAAAAAAAAAGY29uZmlnAAAAAAAAAAAAAQAAA+kAAAfQAAAABkNvbmZpZwAAAAAAAw==",
        "AAAAAAAAAAAAAAAGZ2V0X2FkAAAAAAABAAAAAAAAAAJpZAAAAAAABgAAAAEAAAPpAAAH0AAAAAJBZAAAAAAAAw==",
        "AAAAAAAAAFdCdXllciBwcm92ZXMgdGhlIFRSWSBwYXltZW50IGFuZCByZWNlaXZlcyB0aGUgcmVzZXJ2ZWQgdG9rZW5zIChtaW51cyB0aGUgcHJvdG9jb2wgZmVlKS4AAAAABnNldHRsZQAAAAAABAAAAAAAAAACaWQAAAAAAAYAAAAAAAAABWJ1eWVyAAAAAAAAEwAAAAAAAAANcHVibGljX3ZhbHVlcwAAAAAAAA4AAAAAAAAABXByb29mAAAAAAAADgAAAAEAAAPpAAAH0AAAAAxQYXltZW50Q2xhaW0AAAAD",
        "AAAAAAAAAAAAAAAGdG9rZW5zAAAAAAAAAAAAAQAAA+oAAAAT",
        "AAAAAAAAALlCdXllciByZWxlYXNlcyBlYXJseSAoZ2l2aW5nIHVwIGEgZGVjbGFyZWQgcGF5bWVudCksIG9yIGFueW9uZSByZWxlYXNlcyBhbiBleHBpcmVkIHJlc2VydmF0aW9uIOKAlAp0aGVuIGEgZGVjbGFyZWQgcGF5bWVudCBrZWVwcyBpdHMgbGF0ZS1jbGFpbSByaWdodCBhbmQgdGhlIGJvbmQgc2xpY2Ugc3RheXMgZWFybWFya2VkLgAAAAAAAAdyZWxlYXNlAAAAAAIAAAAAAAAAAmlkAAAAAAAGAAAAAAAAAAZjYWxsZXIAAAAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAN5SZXNlcnZlIGBhbW91bnRgIHRva2VuIHVuaXRzIG9mIGFkIGBpZGA6IHRoZSBzbGljZSBpcyBsb2NrZWQgZm9yIGBsb2NrX2R1cmF0aW9uYCBhbmQgdGhlIFRSWSBhbW91bnQKaXMgZml4ZWQgbm93LiBUaGVuIHBheSBieSBGQVNUIHdpdGggdGhlIHBheW1lbnQgcmVmZXJlbmNlIGluIHRoZSBkZXNjcmlwdGlvbiwgYGRlY2xhcmVfcGFpZGAsIGFuZApgc2V0dGxlYCB3aXRoIHRoZSBwcm9vZi4AAAAAAAdyZXNlcnZlAAAAAAMAAAAAAAAAAmlkAAAAAAAGAAAAAAAAAAVidXllcgAAAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAH0AAAAAtSZXNlcnZhdGlvbgAAAAAD",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAIYWRfY291bnQAAAAAAAAAAQAAAAY=",
        "AAAAAAAAAMBNYWtlciB3aXRoZHJhd3MgYWxsIHVucmVzZXJ2ZWQgbGlxdWlkaXR5IGFuZCB0aGUgdW5lYXJtYXJrZWQgYm9uZDsgbm8gbmV3IHJlc2VydmF0aW9ucy4gQWN0aXZlCnJlc2VydmF0aW9ucyBzdGlsbCBzZXR0bGUgb3IgcmVsZWFzZSAodGhlaXIgdG9rZW4gYW5kIGJvbmQgc2xpY2VzIHRoZW4gZ28gc3RyYWlnaHQgdG8gdGhlIG1ha2VyKS4AAAAIY2xvc2VfYWQAAAABAAAAAAAAAAJpZAAAAAAABgAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAADJBZHMgd2l0aCBpZHMgaW4gYFtzdGFydCwgc3RhcnQrbGltaXQpYCB0aGF0IGV4aXN0LgAAAAAACGxpc3RfYWRzAAAAAgAAAAAAAAAFc3RhcnQAAAAAAAAGAAAAAAAAAAVsaW1pdAAAAAAAAAQAAAABAAAD6gAAB9AAAAACQWQAAA==",
        "AAAAAAAAAS1Qb3N0IGFuIGFkOiBkZXBvc2l0IGBhbW91bnRgIG9mIGB0b2tlbmAgKHBsdXMgdGhlIGJvbmQpIGF0IGBwcmljZV9rdXJ1c2AgcGVyIHdob2xlIHRva2VuLCB0cmFkZWFibGUgaW4Kc2xpY2VzIHdvcnRoIGBtaW5fdHJ5X2t1cnVzLi49bWF4X3RyeV9rdXJ1c2AuIGBwYXllZV9oYXNoYCBtdXN0IGJlIGBwYXllZV9oYXNoKGliYW4sIG5hbWUpYCBvZiB0aGUKZGV0YWlscyBzZWFsZWQgaW4gYHBheWVlX2Jsb2JgOyBidXllcnMgdmVyaWZ5IHRoYXQgYmVmb3JlIHBheWluZywgc28gYSBtaXNtYXRjaCBvbmx5IHN0YWxscyB0aGUgYWQuAAAAAAAACWNyZWF0ZV9hZAAAAAAAAAoAAAAAAAAABnNlbGxlcgAAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAC3ByaWNlX2t1cnVzAAAAAAYAAAAAAAAADW1pbl90cnlfa3VydXMAAAAAAAAGAAAAAAAAAA1tYXhfdHJ5X2t1cnVzAAAAAAAABgAAAAAAAAAKcGF5ZWVfaGFzaAAAAAAD7gAAACAAAAAAAAAACnBheWVlX2Jsb2IAAAAAAA4AAAAAAAAACG5pY2tuYW1lAAAAEAAAAAAAAAAKZXhwaXJlc19hdAAAAAAABgAAAAEAAAPpAAAABgAAAAM=",
        "AAAAAAAAAAAAAAAJZGtpbV9rZXlzAAAAAAAAAAAAAAEAAAPqAAAD7gAAACA=",
        "AAAAAAAAAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAEpNYWtlciBjaGFuZ2VzIHRoZSBwcmljZTsgcmVzZXJ2YXRpb25zIGFscmVhZHkgdGFrZW4ga2VlcCB0aGVpciBUUlkgYW1vdW50LgAAAAAACXNldF9wcmljZQAAAAAAAAIAAAAAAAAAAmlkAAAAAAAGAAAAAAAAAAtwcmljZV9rdXJ1cwAAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAJNBZnRlciBhIHJlbGVhc2UgdGhhdCBpZ25vcmVkIGEgZGVjbGFyZWQgcGF5bWVudCwgdGhlIGJ1eWVyIHByb3ZlcyB0aGUgcGF5bWVudCB3aXRoaW4KYGxhdGVfY2xhaW1fd2luZG93YCBhbmQgcmVjZWl2ZXMgdGhlIHJlc2VydmF0aW9uJ3MgYm9uZCBzbGljZS4AAAAACmNsYWltX2JvbmQAAAAAAAQAAAAAAAAAAmlkAAAAAAAGAAAAAAAAAAVidXllcgAAAAAAABMAAAAAAAAADXB1YmxpY192YWx1ZXMAAAAAAAAOAAAAAAAAAAVwcm9vZgAAAAAAAA4AAAABAAAD6QAAB9AAAAAMUGF5bWVudENsYWltAAAAAw==",
        "AAAAAAAAAGBQYXllZSBiaW5kaW5nIGhhc2ggZm9yIGEgZnVsbCBJQkFOICsgbmFtZSwgZXhhY3RseSBhcyB0aGUgZ3Vlc3QgZGVyaXZlcyBpdCBmcm9tIGEgbWFza2VkIGRla29udC4AAAAKcGF5ZWVfaGFzaAAAAAAAAgAAAAAAAAAEaWJhbgAAABAAAAAAAAAABG5hbWUAAAAQAAAAAQAAA+kAAAPuAAAAIAAAAAM=",
        "AAAAAAAAAAAAAAAKc2V0X2NvbmZpZwAAAAAADgAAAAAAAAAIdmVyaWZpZXIAAAATAAAAAAAAAAhpbWFnZV9pZAAAA+4AAAAgAAAAAAAAAAtkb21haW5faGFzaAAAAAPuAAAAIAAAAAAAAAANbG9ja19kdXJhdGlvbgAAAAAAAAYAAAAAAAAAB2ZlZV9icHMAAAAABAAAAAAAAAANZmVlX3JlY2lwaWVudAAAAAAAABMAAAAAAAAADW1pbl90cnlfa3VydXMAAAAAAAAGAAAAAAAAAA1tYXhfdHJ5X2t1cnVzAAAAAAAABgAAAAAAAAAMcHJvb2Zfd2luZG93AAAABgAAAAAAAAAIYm9uZF9icHMAAAAEAAAAAAAAABFsYXRlX2NsYWltX3dpbmRvdwAAAAAAAAYAAAAAAAAAF21heF9yZXNlcnZhdGlvbnNfcGVyX2FkAAAAAAQAAAAAAAAAFG1heF9hY3RpdmVfcGVyX2J1eWVyAAAABAAAAAAAAAANcmV2ZWFsX3B1YmtleQAAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAKc2V0X3BhdXNlZAAAAAAAAQAAAAAAAAAGcGF1c2VkAAAAAAABAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAKc2V0X3Rva2VucwAAAAAAAQAAAAAAAAAGdG9rZW5zAAAAAAPqAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAMRUaGUgYnV5ZXIgc3RhdGVzIHRoYXQgdGhlIFRSWSB0cmFuc2ZlciBoYXMgYmVlbiBzZW50OiBub2JvZHkgYnV0IHRoZSBidXllciBjYW4gcmVsZWFzZSB0aGUgcmVzZXJ2YXRpb24KZm9yIGF0IGxlYXN0IGBwcm9vZl93aW5kb3dgIHNlY29uZHMsIGFuZCBhIHJlbGVhc2UgYWZ0ZXIgdGhhdCBzdGlsbCBsZWF2ZXMgYGNsYWltX2JvbmRgIG9wZW4uAAAADGRlY2xhcmVfcGFpZAAAAAIAAAAAAAAAAmlkAAAAAAAGAAAAAAAAAAVidXllcgAAAAAAABMAAAABAAAD6QAAB9AAAAALUmVzZXJ2YXRpb24AAAAAAw==",
        "AAAAAAAAAEhQdXJlIGhlbHBlciBzbyBjbGllbnRzIGNhbiBwcmV2aWV3IGhvdyB0aGUgY29udHJhY3QgcmVhZHMgcHVibGljIHZhbHVlcy4AAAAMZGVjb2RlX2NsYWltAAAAAQAAAAAAAAANcHVibGljX3ZhbHVlcwAAAAAAAA4AAAABAAAD6QAAB9AAAAAMUGF5bWVudENsYWltAAAAAw==",
        "AAAAAAAAAJNSZXR1cm4gYSByZWxlYXNlZCByZXNlcnZhdGlvbidzIGJvbmQgc2xpY2UgdG8gdGhlIGFkIChvciB0aGUgbWFrZXIsIGlmIHRoZSBhZCBpcyBjbG9zZWQpIG9uY2UgaXRzCmxhdGUtY2xhaW0gd2luZG93IGhhcyBwYXNzZWQuIEFueW9uZSBtYXkgY2FsbCBpdC4AAAAADHJlY2xhaW1fYm9uZAAAAAEAAAAAAAAAAmlkAAAAAAAGAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAABEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIdmVyaWZpZXIAAAATAAAAAAAAAAhpbWFnZV9pZAAAA+4AAAAgAAAAAAAAAAtkb21haW5faGFzaAAAAAPuAAAAIAAAAAAAAAAPZGtpbV9rZXlfaGFzaGVzAAAAA+oAAAPuAAAAIAAAAAAAAAAGdG9rZW5zAAAAAAPqAAAAEwAAAAAAAAANbG9ja19kdXJhdGlvbgAAAAAAAAYAAAAAAAAAB2ZlZV9icHMAAAAABAAAAAAAAAANZmVlX3JlY2lwaWVudAAAAAAAABMAAAAAAAAADW1pbl90cnlfa3VydXMAAAAAAAAGAAAAAAAAAA1tYXhfdHJ5X2t1cnVzAAAAAAAABgAAAAAAAAAMcHJvb2Zfd2luZG93AAAABgAAAAAAAAAIYm9uZF9icHMAAAAEAAAAAAAAABFsYXRlX2NsYWltX3dpbmRvdwAAAAAAAAYAAAAAAAAAF21heF9yZXNlcnZhdGlvbnNfcGVyX2FkAAAAAAQAAAAAAAAAFG1heF9hY3RpdmVfcGVyX2J1eWVyAAAABAAAAAAAAAANcmV2ZWFsX3B1YmtleQAAAAAAA+4AAAAgAAAAAA==",
        "AAAAAAAAAAAAAAANc2V0X2RraW1fa2V5cwAAAAAAAAEAAAAAAAAABGtleXMAAAPqAAAD7gAAACAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAPZ2V0X3Jlc2VydmF0aW9uAAAAAAEAAAAAAAAAAmlkAAAAAAAGAAAAAQAAA+kAAAfQAAAAC1Jlc2VydmF0aW9uAAAAAAM=",
        "AAAAAAAAAAAAAAARaXNfbnVsbGlmaWVyX3VzZWQAAAAAAAABAAAAAAAAAAludWxsaWZpZXIAAAAAAAPuAAAAIAAAAAEAAAAB",
        "AAAAAAAAADtSZXNlcnZhdGlvbnMgd2l0aCBpZHMgaW4gYFtzdGFydCwgc3RhcnQrbGltaXQpYCB0aGF0IGV4aXN0LgAAAAARbGlzdF9yZXNlcnZhdGlvbnMAAAAAAAACAAAAAAAAAAVzdGFydAAAAAAAAAYAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPqAAAH0AAAAAtSZXNlcnZhdGlvbgA=",
        "AAAAAAAAAMZUaGUgdGV4dCBhIGJ1eWVyIG11c3QgdHlwZSBpbnRvIHRoZSBGQVNUIGRlc2NyaXB0aW9uIGZvciByZXNlcnZhdGlvbiBgaWRgIHdoZW4gY2xhaW1pbmcgd2l0aCBgYnV5ZXJgOgpgWktPVEM8aWQ+PDYgaGV4IG9mIHNoYTI1NihidXllciBhZGRyZXNzKT5gLCBvbmUgdG9rZW4gKG1pcnJvcnMgYHprb3RjX2xpYjo6cGF5bWVudF9yZWZlcmVuY2VgKS4AAAAAABFwYXltZW50X3JlZmVyZW5jZQAAAAAAAAIAAAAAAAAAAmlkAAAAAAAGAAAAAAAAAAVidXllcgAAAAAAABMAAAABAAAAEA==",
        "AAAAAAAAAAAAAAARcmVzZXJ2YXRpb25fY291bnQAAAAAAAAAAAAAAQAAAAY=",
        "AAAAAAAAAC5BY3RpdmUgcmVzZXJ2YXRpb25zIGN1cnJlbnRseSBoZWxkIGJ5IGBidXllcmAuAAAAAAATYWN0aXZlX3Jlc2VydmF0aW9ucwAAAAABAAAAAAAAAAVidXllcgAAAAAAABMAAAABAAAABA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    quote: this.txFromJSON<Result<u64>>,
        config: this.txFromJSON<Result<Config>>,
        get_ad: this.txFromJSON<Result<Ad>>,
        settle: this.txFromJSON<Result<PaymentClaim>>,
        tokens: this.txFromJSON<Array<string>>,
        release: this.txFromJSON<Result<void>>,
        reserve: this.txFromJSON<Result<Reservation>>,
        upgrade: this.txFromJSON<Result<void>>,
        ad_count: this.txFromJSON<u64>,
        close_ad: this.txFromJSON<Result<void>>,
        list_ads: this.txFromJSON<Array<Ad>>,
        create_ad: this.txFromJSON<Result<u64>>,
        dkim_keys: this.txFromJSON<Array<Buffer>>,
        set_admin: this.txFromJSON<Result<void>>,
        set_price: this.txFromJSON<Result<void>>,
        claim_bond: this.txFromJSON<Result<PaymentClaim>>,
        payee_hash: this.txFromJSON<Result<Buffer>>,
        set_config: this.txFromJSON<Result<void>>,
        set_paused: this.txFromJSON<Result<void>>,
        set_tokens: this.txFromJSON<Result<void>>,
        declare_paid: this.txFromJSON<Result<Reservation>>,
        decode_claim: this.txFromJSON<Result<PaymentClaim>>,
        reclaim_bond: this.txFromJSON<Result<i128>>,
        set_dkim_keys: this.txFromJSON<Result<void>>,
        get_reservation: this.txFromJSON<Result<Reservation>>,
        is_nullifier_used: this.txFromJSON<boolean>,
        list_reservations: this.txFromJSON<Array<Reservation>>,
        payment_reference: this.txFromJSON<string>,
        reservation_count: this.txFromJSON<u64>,
        active_reservations: this.txFromJSON<u32>
  }
}