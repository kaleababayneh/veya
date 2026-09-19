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
  14: {message:"IbanMismatch"},
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
  26: {message:"InvalidName"}
}


export interface Offer {
  /**
 * token amount in the token's smallest unit (7 decimals for XLM/USDC SACs)
 */
amount: i128;
  buyer: Option<string>;
  created_at: u64;
  /**
 * unix seconds after which the seller may cancel an unlocked offer (0 = never)
 */
expires_at: u64;
  fulfilled_at: u64;
  id: u64;
  lock_expires_at: u64;
  locked_at: u64;
  seller: string;
  /**
 * payee IBAN shown to the buyer (normalized: uppercase, no spaces)
 */
seller_iban: string;
  seller_iban_hash: Buffer;
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
 * seconds a buyer holds an exclusive lock
 */
lock_duration: u64;
  max_try_kurus: u64;
  min_try_kurus: u64;
  paused: boolean;
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
  recipient_iban_hash: Buffer;
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
   * Buyer releases their own lock early (or anyone releases an expired one).
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
   * Construct and simulate a iban_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * sha256 of the normalized IBAN, as the guest program computes it.
   */
  iban_hash: ({iban}: {iban: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_config: ({verifier, image_id, domain_hash, lock_duration, fee_bps, fee_recipient, min_try_kurus, max_try_kurus}: {verifier: string, image_id: Buffer, domain_hash: Buffer, lock_duration: u64, fee_bps: u32, fee_recipient: string, min_try_kurus: u64, max_try_kurus: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
   * Seller withdraws an Open offer (or a Locked one whose lock has expired).
   */
  cancel_offer: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_offer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deposit `amount` of `token` and list it for `try_amount_kurus`, payable to `iban`.
   */
  create_offer: ({seller, token, amount, try_amount_kurus, iban, seller_name, expires_at}: {seller: string, token: string, amount: i128, try_amount_kurus: u64, iban: string, seller_name: string, expires_at: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

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
   * Construct and simulate a is_nullifier_used transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_nullifier_used: ({nullifier}: {nullifier: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, verifier, image_id, domain_hash, dkim_key_hashes, tokens, lock_duration, fee_bps, fee_recipient, min_try_kurus, max_try_kurus}: {admin: string, verifier: string, image_id: Buffer, domain_hash: Buffer, dkim_key_hashes: Array<Buffer>, tokens: Array<string>, lock_duration: u64, fee_bps: u32, fee_recipient: string, min_try_kurus: u64, max_try_kurus: u64},
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
    return ContractClient.deploy({admin, verifier, image_id, domain_hash, dkim_key_hashes, tokens, lock_duration, fee_bps, fee_recipient, min_try_kurus, max_try_kurus}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAFwAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAABlBhdXNlZAAAAAAAAgAAAAAAAAANT2ZmZXJOb3RGb3VuZAAAAAAAAAMAAAAAAAAADUludmFsaWRTdGF0dXMAAAAAAAAEAAAAAAAAAAhOb3RCdXllcgAAAAYAAAAAAAAACkxvY2tBY3RpdmUAAAAAAAcAAAAAAAAADE9mZmVyRXhwaXJlZAAAAAkAAAAAAAAAD1Rva2VuTm90QWxsb3dlZAAAAAAKAAAAAAAAABNJbnZhbGlkUHVibGljVmFsdWVzAAAAAAsAAAAAAAAAEURraW1LZXlOb3RUcnVzdGVkAAAAAAAADAAAAAAAAAAORG9tYWluTWlzbWF0Y2gAAAAAAA0AAAAAAAAADEliYW5NaXNtYXRjaAAAAA4AAAAAAAAADEFtb3VudFRvb0xvdwAAAA8AAAAAAAAAD0RhdGVPdXRPZldpbmRvdwAAAAAQAAAAAAAAAA1OdWxsaWZpZXJVc2VkAAAAAAAAEQAAAAAAAAAMUHJvb2ZJbnZhbGlkAAAAEgAAAAAAAAAKV3JvbmdPZmZlcgAAAAAAEwAAAAAAAAANSW52YWxpZEFtb3VudAAAAAAAABQAAAAAAAAAC0ludmFsaWRJYmFuAAAAABUAAAAAAAAAEEFtb3VudE91dE9mUmFuZ2UAAAAWAAAAAAAAAA1JbnZhbGlkRXhwaXJ5AAAAAAAAFwAAAAAAAAAKSW52YWxpZEZlZQAAAAAAGQAAAAAAAAALSW52YWxpZE5hbWUAAAAAGg==",
        "AAAAAQAAAAAAAAAAAAAABU9mZmVyAAAAAAAADwAAAEh0b2tlbiBhbW91bnQgaW4gdGhlIHRva2VuJ3Mgc21hbGxlc3QgdW5pdCAoNyBkZWNpbWFscyBmb3IgWExNL1VTREMgU0FDcykAAAAGYW1vdW50AAAAAAALAAAAAAAAAAVidXllcgAAAAAAA+gAAAATAAAAAAAAAApjcmVhdGVkX2F0AAAAAAAGAAAATHVuaXggc2Vjb25kcyBhZnRlciB3aGljaCB0aGUgc2VsbGVyIG1heSBjYW5jZWwgYW4gdW5sb2NrZWQgb2ZmZXIgKDAgPSBuZXZlcikAAAAKZXhwaXJlc19hdAAAAAAABgAAAAAAAAAMZnVsZmlsbGVkX2F0AAAABgAAAAAAAAACaWQAAAAAAAYAAAAAAAAAD2xvY2tfZXhwaXJlc19hdAAAAAAGAAAAAAAAAAlsb2NrZWRfYXQAAAAAAAAGAAAAAAAAAAZzZWxsZXIAAAAAABMAAABAcGF5ZWUgSUJBTiBzaG93biB0byB0aGUgYnV5ZXIgKG5vcm1hbGl6ZWQ6IHVwcGVyY2FzZSwgbm8gc3BhY2VzKQAAAAtzZWxsZXJfaWJhbgAAAAAQAAAAAAAAABBzZWxsZXJfaWJhbl9oYXNoAAAD7gAAACAAAABBYWNjb3VudCBob2xkZXIgbmFtZSB0aGUgYnV5ZXIgbXVzdCB0eXBlIGluIHRoZSBGQVNUIHRyYW5zZmVyIGZvcm0AAAAAAAALc2VsbGVyX25hbWUAAAAAEAAAAAAAAAAGc3RhdHVzAAAAAAfQAAAAC09mZmVyU3RhdHVzAAAAAAAAAAAFdG9rZW4AAAAAAAATAAAALWZpYXQgcHJpY2UgdGhlIGJ1eWVyIG11c3QgdHJhbnNmZXIsIGluIGt1cnXFnwAAAAAAABB0cnlfYW1vdW50X2t1cnVzAAAABg==",
        "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAACgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAKnNoYTI1NiBvZiB0aGUgYWNjZXB0ZWQgREtJTSBzaWduaW5nIGRvbWFpbgAAAAAAC2RvbWFpbl9oYXNoAAAAA+4AAAAgAAAAAAAAAAdmZWVfYnBzAAAAAAQAAAAAAAAADWZlZV9yZWNpcGllbnQAAAAAAAATAAAAJ1JJU0MgWmVybyBpbWFnZSBpZCBvZiB0aGUgemtFbWFpbCBndWVzdAAAAAAIaW1hZ2VfaWQAAAPuAAAAIAAAACdzZWNvbmRzIGEgYnV5ZXIgaG9sZHMgYW4gZXhjbHVzaXZlIGxvY2sAAAAADWxvY2tfZHVyYXRpb24AAAAAAAAGAAAAAAAAAA1tYXhfdHJ5X2t1cnVzAAAAAAAABgAAAAAAAAANbWluX3RyeV9rdXJ1cwAAAAAAAAYAAAAAAAAABnBhdXNlZAAAAAAAAQAAAEJSSVNDIFplcm8gdmVyaWZpZXIgcm91dGVyICh2ZXJpZnkoc2VhbCwgaW1hZ2VfaWQsIGpvdXJuYWxfZGlnZXN0KSkAAAAAAAh2ZXJpZmllcgAAABM=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABgAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAAAAAAAAAAAGVG9rZW5zAAAAAAAAAAAAAAAAAAhEa2ltS2V5cwAAAAAAAAAAAAAACk9mZmVyQ291bnQAAAAAAAEAAAAAAAAABU9mZmVyAAAAAAAAAQAAAAYAAAABAAAAAAAAAAlOdWxsaWZpZXIAAAAAAAABAAAD7gAAACA=",
        "AAAAAwAAAAAAAAAAAAAAC09mZmVyU3RhdHVzAAAAAAQAAAAAAAAABE9wZW4AAAAAAAAAAAAAAAZMb2NrZWQAAAAAAAEAAAAAAAAACUZ1bGZpbGxlZAAAAAAAAAIAAAAAAAAACUNhbmNlbGxlZAAAAAAAAAM=",
        "AAAABQAAAAAAAAAAAAAAC09mZmVyTG9ja2VkAAAAAAEAAAAMb2ZmZXJfbG9ja2VkAAAAAwAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAAVidXllcgAAAAAAABMAAAAAAAAAAAAAAA9sb2NrX2V4cGlyZXNfYXQAAAAABgAAAAAAAAAC",
        "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",
        "AAAAAAAAAEhQdXJlIGhlbHBlciBzbyBjbGllbnRzIGNhbiBwcmV2aWV3IGhvdyB0aGUgY29udHJhY3QgcmVhZHMgcHVibGljIHZhbHVlcy4AAAAMZGVjb2RlX2NsYWltAAAAAQAAAAAAAAANcHVibGljX3ZhbHVlcwAAAAAAAA4AAAABAAAD6QAAB9AAAAAMUGF5bWVudENsYWltAAAAAw==",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAsAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIdmVyaWZpZXIAAAATAAAAAAAAAAhpbWFnZV9pZAAAA+4AAAAgAAAAAAAAAAtkb21haW5faGFzaAAAAAPuAAAAIAAAAAAAAAAPZGtpbV9rZXlfaGFzaGVzAAAAA+oAAAPuAAAAIAAAAAAAAAAGdG9rZW5zAAAAAAPqAAAAEwAAAAAAAAANbG9ja19kdXJhdGlvbgAAAAAAAAYAAAAAAAAAB2ZlZV9icHMAAAAABAAAAAAAAAANZmVlX3JlY2lwaWVudAAAAAAAABMAAAAAAAAADW1pbl90cnlfa3VydXMAAAAAAAAGAAAAAAAAAA1tYXhfdHJ5X2t1cnVzAAAAAAAABgAAAAA=",
        "AAAAAAAAAAAAAAANc2V0X2RraW1fa2V5cwAAAAAAAAEAAAAAAAAABGtleXMAAAPqAAAD7gAAACAAAAABAAAD6QAAAAIAAAAD",
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
        iban_hash: this.txFromJSON<Result<Buffer>>,
        set_admin: this.txFromJSON<Result<void>>,
        set_config: this.txFromJSON<Result<void>>,
        set_paused: this.txFromJSON<Result<void>>,
        set_tokens: this.txFromJSON<Result<void>>,
        list_offers: this.txFromJSON<Array<Offer>>,
        offer_count: this.txFromJSON<u64>,
        cancel_offer: this.txFromJSON<Result<void>>,
        create_offer: this.txFromJSON<Result<u64>>,
        decode_claim: this.txFromJSON<Result<PaymentClaim>>,
        set_dkim_keys: this.txFromJSON<Result<void>>,
        is_nullifier_used: this.txFromJSON<boolean>
  }
}