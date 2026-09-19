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




export const Errors = {
  1: {message:"NotInitialized"},
  2: {message:"Paused"},
  3: {message:"OfferNotFound"},
  4: {message:"InvalidStatus"},
  6: {message:"NotBuyer"},
  7: {message:"LockActive"},
  9: {message:"OfferExpired"},
  10: {message:"TokenNotAllowed"},
  11: {message:"InvalidPublicValues"},
  12: {message:"DkimKeyNotTrusted"},
  13: {message:"DomainMismatch"},
  14: {message:"PayeeMismatch"},
  15: {message:"AmountTooLow"},
  16: {message:"DateOutOfWindow"},
  17: {message:"NullifierUsed"},
  18: {message:"ProofInvalid"},
  19: {message:"WrongOffer"},
  20: {message:"InvalidAmount"},
  21: {message:"InvalidIban"},
  22: {message:"AmountOutOfRange"},
  23: {message:"InvalidExpiry"},
  25: {message:"InvalidFee"},
  26: {message:"InvalidName"},
  /**
   * payment already declared for this lock
   */
  27: {message:"AlreadyDeclared"},
  /**
   * no declared payment / no late claim open for this caller
   */
  28: {message:"LateClaimClosed"},
  /**
   * the bond is still reserved for a possible late claim
   */
  29: {message:"BondHeld"},
  30: {message:"NoBond"},
  31: {message:"InvalidBond"},
  /**
   * the lock has expired (declare before it does)
   */
  32: {message:"LockExpired"},
  /**
   * another buyer's declared payment is still awaiting a late claim on this offer
   */
  33: {message:"LateClaimPending"}
}


export interface Offer {
  /**
 * token amount in the token's smallest unit (7 decimals for XLM/USDC SACs)
 */
amount: i128;
  /**
 * seller bond still held by the escrow (same token as `amount`)
 */
bond: i128;
  buyer: Option<string>;
  created_at: u64;
  /**
 * unix seconds after which the seller may cancel an unlocked offer (0 = never)
 */
expires_at: u64;
  fulfilled_at: u64;
  id: u64;
  /**
 * deadline for the declared buyer's `claim_bond` after the offer was released (0 = none)
 */
late_claim_until: u64;
  lock_expires_at: u64;
  locked_at: u64;
  /**
 * who declared it (kept after a release so they can still `claim_bond`)
 */
paid_buyer: Option<string>;
  /**
 * when the locked buyer declared the TRY payment (0 = not declared)
 */
paid_declared_at: u64;
  /**
 * `locked_at` of the lock under which the payment was declared (date window for a late claim)
 */
paid_locked_at: u64;
  /**
 * binding checked against the proof: check digits + bank code + last 6 digits + folded name
 */
payee_hash: Buffer;
  seller: string;
  /**
 * payee IBAN shown to the buyer (normalized: uppercase, no spaces)
 */
seller_iban: string;
  /**
 * account holder name the buyer must type in the FAST transfer form
 */
seller_name: string;
  status: OfferStatus;
  token: string;
  /**
 * fiat price the buyer must transfer, in kuruş
 */
try_amount_kurus: u64;
}


export interface Config {
  admin: string;
  /**
 * seller bond in basis points of the offer amount
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
 * seconds a buyer holds an exclusive lock
 */
lock_duration: u64;
  max_try_kurus: u64;
  min_try_kurus: u64;
  paused: boolean;
  /**
 * seconds of protection after `declare_paid` (the lock is extended to at least this)
 */
proof_window: u64;
  /**
 * RISC Zero verifier router (verify(seal, image_id, journal_digest))
 */
verifier: string;
}

export type DataKey = {tag: "Config", values: void} | {tag: "Tokens", values: void} | {tag: "DkimKeys", values: void} | {tag: "OfferCount", values: void} | {tag: "Offer", values: readonly [u64]} | {tag: "Nullifier", values: readonly [Buffer]};

export enum OfferStatus {
  Open = 0,
  Locked = 1,
  Fulfilled = 2,
  Cancelled = 3,
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
  offer_id: u64;
  payee_hash: Buffer;
}







export interface Client {
  /**
   * Construct and simulate a lock transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Buyer takes an exclusive lock so nobody else can claim while they pay.
   */
  lock: ({id, buyer}: {id: u64, buyer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Offer>>>

  /**
   * Construct and simulate a config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  config: (options?: MethodOptions) => Promise<AssembledTransaction<Result<Config>>>

  /**
   * Construct and simulate a tokens transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  tokens: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a unlock transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Buyer releases their own lock early (giving up any declared payment), or anyone releases an
   * expired one — then a declared payment keeps its late-claim right for `late_claim_window`.
   */
  unlock: ({id, caller}: {id: u64, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a fulfill transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Buyer proves the TRY payment and receives the crypto.
   */
  fulfill: ({id, buyer, public_values, proof}: {id: u64, buyer: string, public_values: Buffer, proof: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<PaymentClaim>>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a dkim_keys transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  dkim_keys: (options?: MethodOptions) => Promise<AssembledTransaction<Array<Buffer>>>

  /**
   * Construct and simulate a get_offer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_offer: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Offer>>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a claim_bond transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * After a release (unlock by a third party or cancel) that happened despite a declared payment, the
   * declared buyer proves the payment within `late_claim_window` and receives the seller's bond.
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
  set_config: ({verifier, image_id, domain_hash, lock_duration, fee_bps, fee_recipient, min_try_kurus, max_try_kurus, proof_window, bond_bps, late_claim_window}: {verifier: string, image_id: Buffer, domain_hash: Buffer, lock_duration: u64, fee_bps: u32, fee_recipient: string, min_try_kurus: u64, max_try_kurus: u64, proof_window: u64, bond_bps: u32, late_claim_window: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_paused: ({paused}: {paused: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_tokens transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_tokens: ({tokens}: {tokens: Array<string>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a list_offers transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Offers with ids in `[start, start+limit)` that exist (newest ids are highest).
   */
  list_offers: ({start, limit}: {start: u64, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Offer>>>

  /**
   * Construct and simulate a offer_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  offer_count: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a cancel_offer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Seller withdraws an Open offer (or a Locked one whose lock — including any `declare_paid`
   * protection — has expired). The bond comes back with the funds unless a declared payment is
   * pending a late claim; then it stays until `late_claim_until` (see `withdraw_bond`).
   */
  cancel_offer: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_offer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deposit `amount` of `token` plus the seller bond (`bond_bps`) and list it for `try_amount_kurus`,
   * payable to `iban`.
   */
  create_offer: ({seller, token, amount, try_amount_kurus, iban, seller_name, expires_at}: {seller: string, token: string, amount: i128, try_amount_kurus: u64, iban: string, seller_name: string, expires_at: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a declare_paid transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The locked buyer states that the TRY transfer has been sent. From now on nobody but the buyer can
   * release the lock for at least `proof_window` seconds, and if the offer is nevertheless released
   * later, a valid proof still wins the seller's bond (`claim_bond`).
   */
  declare_paid: ({id, buyer}: {id: u64, buyer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Offer>>>

  /**
   * Construct and simulate a decode_claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pure helper so clients can preview how the contract reads public values.
   */
  decode_claim: ({public_values}: {public_values: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<PaymentClaim>>>

  /**
   * Construct and simulate a set_dkim_keys transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_dkim_keys: ({keys}: {keys: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a withdraw_bond transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Seller collects a bond that was held back for a possible late claim, once that window is over.
   */
  withdraw_bond: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a is_nullifier_used transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_nullifier_used: ({nullifier}: {nullifier: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, verifier, image_id, domain_hash, dkim_key_hashes, tokens, lock_duration, fee_bps, fee_recipient, min_try_kurus, max_try_kurus, proof_window, bond_bps, late_claim_window}: {admin: string, verifier: string, image_id: Buffer, domain_hash: Buffer, dkim_key_hashes: Array<Buffer>, tokens: Array<string>, lock_duration: u64, fee_bps: u32, fee_recipient: string, min_try_kurus: u64, max_try_kurus: u64, proof_window: u64, bond_bps: u32, late_claim_window: u64},
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
    return ContractClient.deploy({admin, verifier, image_id, domain_hash, dkim_key_hashes, tokens, lock_duration, fee_bps, fee_recipient, min_try_kurus, max_try_kurus, proof_window, bond_bps, late_claim_window}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAHgAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAABlBhdXNlZAAAAAAAAgAAAAAAAAANT2ZmZXJOb3RGb3VuZAAAAAAAAAMAAAAAAAAADUludmFsaWRTdGF0dXMAAAAAAAAEAAAAAAAAAAhOb3RCdXllcgAAAAYAAAAAAAAACkxvY2tBY3RpdmUAAAAAAAcAAAAAAAAADE9mZmVyRXhwaXJlZAAAAAkAAAAAAAAAD1Rva2VuTm90QWxsb3dlZAAAAAAKAAAAAAAAABNJbnZhbGlkUHVibGljVmFsdWVzAAAAAAsAAAAAAAAAEURraW1LZXlOb3RUcnVzdGVkAAAAAAAADAAAAAAAAAAORG9tYWluTWlzbWF0Y2gAAAAAAA0AAAAAAAAADVBheWVlTWlzbWF0Y2gAAAAAAAAOAAAAAAAAAAxBbW91bnRUb29Mb3cAAAAPAAAAAAAAAA9EYXRlT3V0T2ZXaW5kb3cAAAAAEAAAAAAAAAANTnVsbGlmaWVyVXNlZAAAAAAAABEAAAAAAAAADFByb29mSW52YWxpZAAAABIAAAAAAAAACldyb25nT2ZmZXIAAAAAABMAAAAAAAAADUludmFsaWRBbW91bnQAAAAAAAAUAAAAAAAAAAtJbnZhbGlkSWJhbgAAAAAVAAAAAAAAABBBbW91bnRPdXRPZlJhbmdlAAAAFgAAAAAAAAANSW52YWxpZEV4cGlyeQAAAAAAABcAAAAAAAAACkludmFsaWRGZWUAAAAAABkAAAAAAAAAC0ludmFsaWROYW1lAAAAABoAAAAmcGF5bWVudCBhbHJlYWR5IGRlY2xhcmVkIGZvciB0aGlzIGxvY2sAAAAAAA9BbHJlYWR5RGVjbGFyZWQAAAAAGwAAADhubyBkZWNsYXJlZCBwYXltZW50IC8gbm8gbGF0ZSBjbGFpbSBvcGVuIGZvciB0aGlzIGNhbGxlcgAAAA9MYXRlQ2xhaW1DbG9zZWQAAAAAHAAAADR0aGUgYm9uZCBpcyBzdGlsbCByZXNlcnZlZCBmb3IgYSBwb3NzaWJsZSBsYXRlIGNsYWltAAAACEJvbmRIZWxkAAAAHQAAAAAAAAAGTm9Cb25kAAAAAAAeAAAAAAAAAAtJbnZhbGlkQm9uZAAAAAAfAAAALXRoZSBsb2NrIGhhcyBleHBpcmVkIChkZWNsYXJlIGJlZm9yZSBpdCBkb2VzKQAAAAAAAAtMb2NrRXhwaXJlZAAAAAAgAAAATWFub3RoZXIgYnV5ZXIncyBkZWNsYXJlZCBwYXltZW50IGlzIHN0aWxsIGF3YWl0aW5nIGEgbGF0ZSBjbGFpbSBvbiB0aGlzIG9mZmVyAAAAAAAAEExhdGVDbGFpbVBlbmRpbmcAAAAh",
        "AAAAAQAAAAAAAAAAAAAABU9mZmVyAAAAAAAAFAAAAEh0b2tlbiBhbW91bnQgaW4gdGhlIHRva2VuJ3Mgc21hbGxlc3QgdW5pdCAoNyBkZWNpbWFscyBmb3IgWExNL1VTREMgU0FDcykAAAAGYW1vdW50AAAAAAALAAAAPXNlbGxlciBib25kIHN0aWxsIGhlbGQgYnkgdGhlIGVzY3JvdyAoc2FtZSB0b2tlbiBhcyBgYW1vdW50YCkAAAAAAAAEYm9uZAAAAAsAAAAAAAAABWJ1eWVyAAAAAAAD6AAAABMAAAAAAAAACmNyZWF0ZWRfYXQAAAAAAAYAAABMdW5peCBzZWNvbmRzIGFmdGVyIHdoaWNoIHRoZSBzZWxsZXIgbWF5IGNhbmNlbCBhbiB1bmxvY2tlZCBvZmZlciAoMCA9IG5ldmVyKQAAAApleHBpcmVzX2F0AAAAAAAGAAAAAAAAAAxmdWxmaWxsZWRfYXQAAAAGAAAAAAAAAAJpZAAAAAAABgAAAFZkZWFkbGluZSBmb3IgdGhlIGRlY2xhcmVkIGJ1eWVyJ3MgYGNsYWltX2JvbmRgIGFmdGVyIHRoZSBvZmZlciB3YXMgcmVsZWFzZWQgKDAgPSBub25lKQAAAAAAEGxhdGVfY2xhaW1fdW50aWwAAAAGAAAAAAAAAA9sb2NrX2V4cGlyZXNfYXQAAAAABgAAAAAAAAAJbG9ja2VkX2F0AAAAAAAABgAAAEV3aG8gZGVjbGFyZWQgaXQgKGtlcHQgYWZ0ZXIgYSByZWxlYXNlIHNvIHRoZXkgY2FuIHN0aWxsIGBjbGFpbV9ib25kYCkAAAAAAAAKcGFpZF9idXllcgAAAAAD6AAAABMAAABBd2hlbiB0aGUgbG9ja2VkIGJ1eWVyIGRlY2xhcmVkIHRoZSBUUlkgcGF5bWVudCAoMCA9IG5vdCBkZWNsYXJlZCkAAAAAAAAQcGFpZF9kZWNsYXJlZF9hdAAAAAYAAABbYGxvY2tlZF9hdGAgb2YgdGhlIGxvY2sgdW5kZXIgd2hpY2ggdGhlIHBheW1lbnQgd2FzIGRlY2xhcmVkIChkYXRlIHdpbmRvdyBmb3IgYSBsYXRlIGNsYWltKQAAAAAOcGFpZF9sb2NrZWRfYXQAAAAAAAYAAABZYmluZGluZyBjaGVja2VkIGFnYWluc3QgdGhlIHByb29mOiBjaGVjayBkaWdpdHMgKyBiYW5rIGNvZGUgKyBsYXN0IDYgZGlnaXRzICsgZm9sZGVkIG5hbWUAAAAAAAAKcGF5ZWVfaGFzaAAAAAAD7gAAACAAAAAAAAAABnNlbGxlcgAAAAAAEwAAAEBwYXllZSBJQkFOIHNob3duIHRvIHRoZSBidXllciAobm9ybWFsaXplZDogdXBwZXJjYXNlLCBubyBzcGFjZXMpAAAAC3NlbGxlcl9pYmFuAAAAABAAAABBYWNjb3VudCBob2xkZXIgbmFtZSB0aGUgYnV5ZXIgbXVzdCB0eXBlIGluIHRoZSBGQVNUIHRyYW5zZmVyIGZvcm0AAAAAAAALc2VsbGVyX25hbWUAAAAAEAAAAAAAAAAGc3RhdHVzAAAAAAfQAAAAC09mZmVyU3RhdHVzAAAAAAAAAAAFdG9rZW4AAAAAAAATAAAALWZpYXQgcHJpY2UgdGhlIGJ1eWVyIG11c3QgdHJhbnNmZXIsIGluIGt1cnXFnwAAAAAAABB0cnlfYW1vdW50X2t1cnVzAAAABg==",
        "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAADQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAL3NlbGxlciBib25kIGluIGJhc2lzIHBvaW50cyBvZiB0aGUgb2ZmZXIgYW1vdW50AAAAAAhib25kX2JwcwAAAAQAAAAqc2hhMjU2IG9mIHRoZSBhY2NlcHRlZCBES0lNIHNpZ25pbmcgZG9tYWluAAAAAAALZG9tYWluX2hhc2gAAAAD7gAAACAAAAAAAAAAB2ZlZV9icHMAAAAABAAAAAAAAAANZmVlX3JlY2lwaWVudAAAAAAAABMAAAAnUklTQyBaZXJvIGltYWdlIGlkIG9mIHRoZSB6a0VtYWlsIGd1ZXN0AAAAAAhpbWFnZV9pZAAAA+4AAAAgAAAATnNlY29uZHMgYWZ0ZXIgYSByZWxlYXNlIGR1cmluZyB3aGljaCB0aGUgZGVjbGFyZWQgYnV5ZXIgbWF5IHN0aWxsIGBjbGFpbV9ib25kYAAAAAAAEWxhdGVfY2xhaW1fd2luZG93AAAAAAAABgAAACdzZWNvbmRzIGEgYnV5ZXIgaG9sZHMgYW4gZXhjbHVzaXZlIGxvY2sAAAAADWxvY2tfZHVyYXRpb24AAAAAAAAGAAAAAAAAAA1tYXhfdHJ5X2t1cnVzAAAAAAAABgAAAAAAAAANbWluX3RyeV9rdXJ1cwAAAAAAAAYAAAAAAAAABnBhdXNlZAAAAAAAAQAAAFJzZWNvbmRzIG9mIHByb3RlY3Rpb24gYWZ0ZXIgYGRlY2xhcmVfcGFpZGAgKHRoZSBsb2NrIGlzIGV4dGVuZGVkIHRvIGF0IGxlYXN0IHRoaXMpAAAAAAAMcHJvb2Zfd2luZG93AAAABgAAAEJSSVNDIFplcm8gdmVyaWZpZXIgcm91dGVyICh2ZXJpZnkoc2VhbCwgaW1hZ2VfaWQsIGpvdXJuYWxfZGlnZXN0KSkAAAAAAAh2ZXJpZmllcgAAABM=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABgAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAAAAAAAAAAAGVG9rZW5zAAAAAAAAAAAAAAAAAAhEa2ltS2V5cwAAAAAAAAAAAAAACk9mZmVyQ291bnQAAAAAAAEAAAAAAAAABU9mZmVyAAAAAAAAAQAAAAYAAAABAAAAAAAAAAlOdWxsaWZpZXIAAAAAAAABAAAD7gAAACA=",
        "AAAAAwAAAAAAAAAAAAAAC09mZmVyU3RhdHVzAAAAAAQAAAAAAAAABE9wZW4AAAAAAAAAAAAAAAZMb2NrZWQAAAAAAAEAAAAAAAAACUZ1bGZpbGxlZAAAAAAAAAIAAAAAAAAACUNhbmNlbGxlZAAAAAAAAAM=",
        "AAAABQAAAAAAAAAAAAAAC0JvbmRTbGFzaGVkAAAAAAEAAAAMYm9uZF9zbGFzaGVkAAAAAwAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAAVidXllcgAAAAAAABMAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAC09mZmVyTG9ja2VkAAAAAAEAAAAMb2ZmZXJfbG9ja2VkAAAAAwAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAAVidXllcgAAAAAAABMAAAAAAAAAAAAAAA9sb2NrX2V4cGlyZXNfYXQAAAAABgAAAAAAAAAC",
        "AAAAAQAAACpEZWNvZGVkIHZpZXcgb2YgdGhlIGd1ZXN0J3MgcHVibGljIHZhbHVlcy4AAAAAAAAAAAAMUGF5bWVudENsYWltAAAABwAAAAAAAAAMYW1vdW50X2t1cnVzAAAABgAAAAAAAAANZGF0ZV95eXl5bW1kZAAAAAAAAAYAAAAAAAAADWRraW1fa2V5X2hhc2gAAAAAAAPuAAAAIAAAAAAAAAALZG9tYWluX2hhc2gAAAAD7gAAACAAAAAAAAAACW51bGxpZmllcgAAAAAAA+4AAAAgAAAAAAAAAAhvZmZlcl9pZAAAAAYAAAAAAAAACnBheWVlX2hhc2gAAAAAA+4AAAAg",
        "AAAABQAAAAAAAAAAAAAADEJvbmRSZXR1cm5lZAAAAAEAAAANYm9uZF9yZXR1cm5lZAAAAAAAAAMAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAGc2VsbGVyAAAAAAATAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADE9mZmVyQ3JlYXRlZAAAAAEAAAANb2ZmZXJfY3JlYXRlZAAAAAAAAAYAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAGc2VsbGVyAAAAAAATAAAAAAAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAAAAAAQdHJ5X2Ftb3VudF9rdXJ1cwAAAAYAAAAAAAAAAAAAAARib25kAAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADU9mZmVyVW5sb2NrZWQAAAAAAAABAAAADm9mZmVyX3VubG9ja2VkAAAAAAAEAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAAAAAADGFmdGVyX2V4cGlyeQAAAAEAAAAAAAAAWW5vbi16ZXJvIHdoZW4gYSBkZWNsYXJlZCBwYXltZW50IHN1cnZpdmVzIHRoZSByZWxlYXNlIChidXllciBtYXkgYGNsYWltX2JvbmRgIHVudGlsIHRoZW4pAAAAAAAAEGxhdGVfY2xhaW1fdW50aWwAAAAGAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADk9mZmVyQ2FuY2VsbGVkAAAAAAABAAAAD29mZmVyX2NhbmNlbGxlZAAAAAACAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAABnNlbGxlcgAAAAAAEwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADk9mZmVyRnVsZmlsbGVkAAAAAAABAAAAD29mZmVyX2Z1bGZpbGxlZAAAAAAGAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAABWJ1eWVyAAAAAAAAEwAAAAAAAAAAAAAADGFtb3VudF9rdXJ1cwAAAAYAAAAAAAAAAAAAAA1kYXRlX3l5eXltbWRkAAAAAAAABgAAAAAAAAAAAAAABnBheW91dAAAAAAACwAAAAAAAAAAAAAAA2ZlZQAAAAALAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAD1BheW1lbnREZWNsYXJlZAAAAAABAAAAEHBheW1lbnRfZGVjbGFyZWQAAAAEAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAABWJ1eWVyAAAAAAAAEwAAAAAAAAAAAAAAC2RlY2xhcmVkX2F0AAAAAAYAAAAAAAAANW5vYm9keSBidXQgdGhlIGJ1eWVyIGNhbiByZWxlYXNlIHRoZSBsb2NrIGJlZm9yZSB0aGlzAAAAAAAAD3Byb3RlY3RlZF91bnRpbAAAAAAGAAAAAAAAAAI=",
        "AAAAAAAAAEZCdXllciB0YWtlcyBhbiBleGNsdXNpdmUgbG9jayBzbyBub2JvZHkgZWxzZSBjYW4gY2xhaW0gd2hpbGUgdGhleSBwYXkuAAAAAAAEbG9jawAAAAIAAAAAAAAAAmlkAAAAAAAGAAAAAAAAAAVidXllcgAAAAAAABMAAAABAAAD6QAAB9AAAAAFT2ZmZXIAAAAAAAAD",
        "AAAAAAAAAAAAAAAGY29uZmlnAAAAAAAAAAAAAQAAA+kAAAfQAAAABkNvbmZpZwAAAAAAAw==",
        "AAAAAAAAAAAAAAAGdG9rZW5zAAAAAAAAAAAAAQAAA+oAAAAT",
        "AAAAAAAAALdCdXllciByZWxlYXNlcyB0aGVpciBvd24gbG9jayBlYXJseSAoZ2l2aW5nIHVwIGFueSBkZWNsYXJlZCBwYXltZW50KSwgb3IgYW55b25lIHJlbGVhc2VzIGFuCmV4cGlyZWQgb25lIOKAlCB0aGVuIGEgZGVjbGFyZWQgcGF5bWVudCBrZWVwcyBpdHMgbGF0ZS1jbGFpbSByaWdodCBmb3IgYGxhdGVfY2xhaW1fd2luZG93YC4AAAAABnVubG9jawAAAAAAAgAAAAAAAAACaWQAAAAAAAYAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAADVCdXllciBwcm92ZXMgdGhlIFRSWSBwYXltZW50IGFuZCByZWNlaXZlcyB0aGUgY3J5cHRvLgAAAAAAAAdmdWxmaWxsAAAAAAQAAAAAAAAAAmlkAAAAAAAGAAAAAAAAAAVidXllcgAAAAAAABMAAAAAAAAADXB1YmxpY192YWx1ZXMAAAAAAAAOAAAAAAAAAAVwcm9vZgAAAAAAAA4AAAABAAAD6QAAB9AAAAAMUGF5bWVudENsYWltAAAAAw==",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAJZGtpbV9rZXlzAAAAAAAAAAAAAAEAAAPqAAAD7gAAACA=",
        "AAAAAAAAAAAAAAAJZ2V0X29mZmVyAAAAAAAAAQAAAAAAAAACaWQAAAAAAAYAAAABAAAD6QAAB9AAAAAFT2ZmZXIAAAAAAAAD",
        "AAAAAAAAAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAL5BZnRlciBhIHJlbGVhc2UgKHVubG9jayBieSBhIHRoaXJkIHBhcnR5IG9yIGNhbmNlbCkgdGhhdCBoYXBwZW5lZCBkZXNwaXRlIGEgZGVjbGFyZWQgcGF5bWVudCwgdGhlCmRlY2xhcmVkIGJ1eWVyIHByb3ZlcyB0aGUgcGF5bWVudCB3aXRoaW4gYGxhdGVfY2xhaW1fd2luZG93YCBhbmQgcmVjZWl2ZXMgdGhlIHNlbGxlcidzIGJvbmQuAAAAAAAKY2xhaW1fYm9uZAAAAAAABAAAAAAAAAACaWQAAAAAAAYAAAAAAAAABWJ1eWVyAAAAAAAAEwAAAAAAAAANcHVibGljX3ZhbHVlcwAAAAAAAA4AAAAAAAAABXByb29mAAAAAAAADgAAAAEAAAPpAAAH0AAAAAxQYXltZW50Q2xhaW0AAAAD",
        "AAAAAAAAAGBQYXllZSBiaW5kaW5nIGhhc2ggZm9yIGEgZnVsbCBJQkFOICsgbmFtZSwgZXhhY3RseSBhcyB0aGUgZ3Vlc3QgZGVyaXZlcyBpdCBmcm9tIGEgbWFza2VkIGRla29udC4AAAAKcGF5ZWVfaGFzaAAAAAAAAgAAAAAAAAAEaWJhbgAAABAAAAAAAAAABG5hbWUAAAAQAAAAAQAAA+kAAAPuAAAAIAAAAAM=",
        "AAAAAAAAAAAAAAAKc2V0X2NvbmZpZwAAAAAACwAAAAAAAAAIdmVyaWZpZXIAAAATAAAAAAAAAAhpbWFnZV9pZAAAA+4AAAAgAAAAAAAAAAtkb21haW5faGFzaAAAAAPuAAAAIAAAAAAAAAANbG9ja19kdXJhdGlvbgAAAAAAAAYAAAAAAAAAB2ZlZV9icHMAAAAABAAAAAAAAAANZmVlX3JlY2lwaWVudAAAAAAAABMAAAAAAAAADW1pbl90cnlfa3VydXMAAAAAAAAGAAAAAAAAAA1tYXhfdHJ5X2t1cnVzAAAAAAAABgAAAAAAAAAMcHJvb2Zfd2luZG93AAAABgAAAAAAAAAIYm9uZF9icHMAAAAEAAAAAAAAABFsYXRlX2NsYWltX3dpbmRvdwAAAAAAAAYAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAKc2V0X3BhdXNlZAAAAAAAAQAAAAAAAAAGcGF1c2VkAAAAAAABAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAKc2V0X3Rva2VucwAAAAAAAQAAAAAAAAAGdG9rZW5zAAAAAAPqAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAE5PZmZlcnMgd2l0aCBpZHMgaW4gYFtzdGFydCwgc3RhcnQrbGltaXQpYCB0aGF0IGV4aXN0IChuZXdlc3QgaWRzIGFyZSBoaWdoZXN0KS4AAAAAAAtsaXN0X29mZmVycwAAAAACAAAAAAAAAAVzdGFydAAAAAAAAAYAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPqAAAH0AAAAAVPZmZlcgAAAA==",
        "AAAAAAAAAAAAAAALb2ZmZXJfY291bnQAAAAAAAAAAAEAAAAG",
        "AAAAAAAAAQxTZWxsZXIgd2l0aGRyYXdzIGFuIE9wZW4gb2ZmZXIgKG9yIGEgTG9ja2VkIG9uZSB3aG9zZSBsb2NrIOKAlCBpbmNsdWRpbmcgYW55IGBkZWNsYXJlX3BhaWRgCnByb3RlY3Rpb24g4oCUIGhhcyBleHBpcmVkKS4gVGhlIGJvbmQgY29tZXMgYmFjayB3aXRoIHRoZSBmdW5kcyB1bmxlc3MgYSBkZWNsYXJlZCBwYXltZW50IGlzCnBlbmRpbmcgYSBsYXRlIGNsYWltOyB0aGVuIGl0IHN0YXlzIHVudGlsIGBsYXRlX2NsYWltX3VudGlsYCAoc2VlIGB3aXRoZHJhd19ib25kYCkuAAAADGNhbmNlbF9vZmZlcgAAAAEAAAAAAAAAAmlkAAAAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAHREZXBvc2l0IGBhbW91bnRgIG9mIGB0b2tlbmAgcGx1cyB0aGUgc2VsbGVyIGJvbmQgKGBib25kX2Jwc2ApIGFuZCBsaXN0IGl0IGZvciBgdHJ5X2Ftb3VudF9rdXJ1c2AsCnBheWFibGUgdG8gYGliYW5gLgAAAAxjcmVhdGVfb2ZmZXIAAAAHAAAAAAAAAAZzZWxsZXIAAAAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAABB0cnlfYW1vdW50X2t1cnVzAAAABgAAAAAAAAAEaWJhbgAAABAAAAAAAAAAC3NlbGxlcl9uYW1lAAAAABAAAAAAAAAACmV4cGlyZXNfYXQAAAAAAAYAAAABAAAD6QAAAAYAAAAD",
        "AAAAAAAAAQNUaGUgbG9ja2VkIGJ1eWVyIHN0YXRlcyB0aGF0IHRoZSBUUlkgdHJhbnNmZXIgaGFzIGJlZW4gc2VudC4gRnJvbSBub3cgb24gbm9ib2R5IGJ1dCB0aGUgYnV5ZXIgY2FuCnJlbGVhc2UgdGhlIGxvY2sgZm9yIGF0IGxlYXN0IGBwcm9vZl93aW5kb3dgIHNlY29uZHMsIGFuZCBpZiB0aGUgb2ZmZXIgaXMgbmV2ZXJ0aGVsZXNzIHJlbGVhc2VkCmxhdGVyLCBhIHZhbGlkIHByb29mIHN0aWxsIHdpbnMgdGhlIHNlbGxlcidzIGJvbmQgKGBjbGFpbV9ib25kYCkuAAAAAAxkZWNsYXJlX3BhaWQAAAACAAAAAAAAAAJpZAAAAAAABgAAAAAAAAAFYnV5ZXIAAAAAAAATAAAAAQAAA+kAAAfQAAAABU9mZmVyAAAAAAAAAw==",
        "AAAAAAAAAEhQdXJlIGhlbHBlciBzbyBjbGllbnRzIGNhbiBwcmV2aWV3IGhvdyB0aGUgY29udHJhY3QgcmVhZHMgcHVibGljIHZhbHVlcy4AAAAMZGVjb2RlX2NsYWltAAAAAQAAAAAAAAANcHVibGljX3ZhbHVlcwAAAAAAAA4AAAABAAAD6QAAB9AAAAAMUGF5bWVudENsYWltAAAAAw==",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAA4AAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIdmVyaWZpZXIAAAATAAAAAAAAAAhpbWFnZV9pZAAAA+4AAAAgAAAAAAAAAAtkb21haW5faGFzaAAAAAPuAAAAIAAAAAAAAAAPZGtpbV9rZXlfaGFzaGVzAAAAA+oAAAPuAAAAIAAAAAAAAAAGdG9rZW5zAAAAAAPqAAAAEwAAAAAAAAANbG9ja19kdXJhdGlvbgAAAAAAAAYAAAAAAAAAB2ZlZV9icHMAAAAABAAAAAAAAAANZmVlX3JlY2lwaWVudAAAAAAAABMAAAAAAAAADW1pbl90cnlfa3VydXMAAAAAAAAGAAAAAAAAAA1tYXhfdHJ5X2t1cnVzAAAAAAAABgAAAAAAAAAMcHJvb2Zfd2luZG93AAAABgAAAAAAAAAIYm9uZF9icHMAAAAEAAAAAAAAABFsYXRlX2NsYWltX3dpbmRvdwAAAAAAAAYAAAAA",
        "AAAAAAAAAAAAAAANc2V0X2RraW1fa2V5cwAAAAAAAAEAAAAAAAAABGtleXMAAAPqAAAD7gAAACAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAF5TZWxsZXIgY29sbGVjdHMgYSBib25kIHRoYXQgd2FzIGhlbGQgYmFjayBmb3IgYSBwb3NzaWJsZSBsYXRlIGNsYWltLCBvbmNlIHRoYXQgd2luZG93IGlzIG92ZXIuAAAAAAANd2l0aGRyYXdfYm9uZAAAAAAAAAEAAAAAAAAAAmlkAAAAAAAGAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAAAAAAARaXNfbnVsbGlmaWVyX3VzZWQAAAAAAAABAAAAAAAAAAludWxsaWZpZXIAAAAAAAPuAAAAIAAAAAEAAAAB" ]),
      options
    )
  }
  public readonly fromJSON = {
    lock: this.txFromJSON<Result<Offer>>,
        config: this.txFromJSON<Result<Config>>,
        tokens: this.txFromJSON<Array<string>>,
        unlock: this.txFromJSON<Result<void>>,
        fulfill: this.txFromJSON<Result<PaymentClaim>>,
        upgrade: this.txFromJSON<Result<void>>,
        dkim_keys: this.txFromJSON<Array<Buffer>>,
        get_offer: this.txFromJSON<Result<Offer>>,
        set_admin: this.txFromJSON<Result<void>>,
        claim_bond: this.txFromJSON<Result<PaymentClaim>>,
        payee_hash: this.txFromJSON<Result<Buffer>>,
        set_config: this.txFromJSON<Result<void>>,
        set_paused: this.txFromJSON<Result<void>>,
        set_tokens: this.txFromJSON<Result<void>>,
        list_offers: this.txFromJSON<Array<Offer>>,
        offer_count: this.txFromJSON<u64>,
        cancel_offer: this.txFromJSON<Result<void>>,
        create_offer: this.txFromJSON<Result<u64>>,
        declare_paid: this.txFromJSON<Result<Offer>>,
        decode_claim: this.txFromJSON<Result<PaymentClaim>>,
        set_dkim_keys: this.txFromJSON<Result<void>>,
        withdraw_bond: this.txFromJSON<Result<i128>>,
        is_nullifier_used: this.txFromJSON<boolean>
  }
}