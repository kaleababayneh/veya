import {
  Client as EscrowClient,
  Errors,
  type Ad,
  type Reservation,
  AdStatus,
  ReservationStatus,
  type Config as EscrowConfig,
} from "@/contracts/escrow";
import type { AssembledTransaction, Result } from "@stellar/stellar-sdk/contract";
import { config } from "./config";
import { bytesToHex } from "./format";

export type { Ad, Reservation, EscrowConfig };
export { AdStatus, ReservationStatus };

type Signer = (xdr: string, opts?: { networkPassphrase?: string; address?: string }) => Promise<{ signedTxXdr: string; signerAddress?: string }>;

export function escrow(publicKey?: string | null, signTransaction?: Signer) {
  if (!config.escrowId) throw new Error("NEXT_PUBLIC_ESCROW_ID is not set");
  return new EscrowClient({
    contractId: config.escrowId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey: publicKey ?? undefined,
    signTransaction: signTransaction as never,
  });
}

/** Unwrap a Soroban `Result<T>` produced by the generated bindings into `T` or a thrown Error. */
export function unwrapResult<T>(r: Result<T>): T {
  if (r.isOk()) return r.unwrap();
  throw new Error(r.unwrapErr()?.message ?? "contract error");
}

export const reservationLabel: Record<number, string> = {
  [ReservationStatus.Active]: "Reserved",
  [ReservationStatus.Settled]: "Completed",
  [ReservationStatus.Released]: "Released",
};

export const adLabel: Record<number, string> = {
  [AdStatus.Active]: "Active",
  [AdStatus.Closed]: "Closed",
};

/** ceil(amount × price / 10^decimals) — the contract's `quote`. */
export function quoteKurus(amount: bigint, priceKurus: bigint, decimals: number): bigint {
  const unit = 10n ** BigInt(decimals);
  return (amount * priceKurus + unit - 1n) / unit;
}

/** Largest token amount whose quote does not exceed `kurus`. */
export function tokensForKurus(kurus: bigint, priceKurus: bigint, decimals: number): bigint {
  const unit = 10n ** BigInt(decimals);
  return (kurus * unit) / priceKurus;
}

export async function listAds(limit = 200): Promise<Ad[]> {
  const c = escrow();
  const count = (await c.ad_count()).result;
  if (count === 0n) return [];
  const start = count > BigInt(limit) ? count - BigInt(limit) + 1n : 1n;
  const tx = await c.list_ads({ start, limit });
  return [...tx.result].reverse();
}

export async function getAd(id: bigint): Promise<Ad> {
  return unwrapResult((await escrow().get_ad({ id })).result);
}

export async function listReservations(limit = 200): Promise<Reservation[]> {
  const c = escrow();
  const count = (await c.reservation_count()).result;
  if (count === 0n) return [];
  const start = count > BigInt(limit) ? count - BigInt(limit) + 1n : 1n;
  const tx = await c.list_reservations({ start, limit });
  return [...tx.result].reverse();
}

export async function getReservation(id: bigint): Promise<Reservation> {
  return unwrapResult((await escrow().get_reservation({ id })).result);
}

export async function getConfig(): Promise<EscrowConfig> {
  return unwrapResult((await escrow().config()).result);
}

/** The escrow's payee binding hash for an IBAN + name (hex), exactly as the proof derives it. */
export async function payeeHashHex(iban: string, name: string): Promise<string> {
  const h = unwrapResult((await escrow().payee_hash({ iban, name })).result);
  return bytesToHex(h);
}

/** Sign + submit an assembled transaction; returns the contract result and the tx hash. */
export async function send<T>(tx: AssembledTransaction<T>): Promise<{ result: T; hash: string }> {
  const sent = await tx.signAndSend();
  const hash = sent.sendTransactionResponse?.hash ?? "";
  return { result: sent.result as T, hash };
}

/** Human-readable message for errors thrown by the bindings / RPC. */
export function explainError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/Error\(Contract, #(\d+)\)/);
  if (m) {
    const code = Number(m[1]);
    const name = (Errors as Record<number, { message: string }>)[code]?.message;
    return name ? `${name} (contract error #${code})` : msg;
  }
  const known = Object.values(Errors).find((x) => msg.includes(x.message));
  if (known) return known.message;
  if (/insufficient/i.test(msg)) return "Insufficient balance for this transaction (including network fee).";
  if (/trustline/i.test(msg)) return "Missing trustline: add the asset to your wallet first.";
  return msg.length > 300 ? msg.slice(0, 300) + "…" : msg;
}

export const ERROR_HELP: Record<string, string> = {
  Paused: "The market is paused by the operator. Existing reservations can still be settled.",
  LockActive: "This reservation is still protected; it can only be released by the buyer, or by anyone after it expires.",
  AdExpired: "This ad has expired and takes no new reservations.",
  TokenNotAllowed: "This token is not on the allow-list.",
  PayeeMismatch: "The dekont's recipient (name, bank, account) does not match the maker's payee commitment.",
  AmountTooLow: "The transfer in the dekont is smaller than the reservation's TRY amount.",
  DateOutOfWindow: "The payment date is before the reservation (Istanbul calendar day) or in the future.",
  NullifierUsed: "This bank transfer was already used to settle another reservation.",
  ProofInvalid: "The zero-knowledge proof did not verify on-chain.",
  DkimKeyNotTrusted: "The e-mail was signed with a DKIM key this contract does not trust yet.",
  DomainMismatch: "The e-mail was not signed by ileti.ziraatbank.com.tr.",
  NotBuyer: "Only the wallet that holds this reservation can do that.",
  NotSeller: "Only the maker of this ad can do that.",
  InvalidStatus: "This ad or reservation is not in a state that allows this action.",
  WrongReservation: "This proof was generated for a different reservation.",
  InvalidIban: "IBAN must be a Turkish IBAN: TR + 24 digits.",
  AmountOutOfRange: "The trade's TRY value is outside the ad's limits.",
  InsufficientLiquidity: "The ad does not have that much unreserved liquidity right now.",
  TooManyReservations: "This ad, or your wallet, already has the maximum number of active reservations.",
  BondExhausted: "The ad's bond pool cannot back another reservation right now; try a smaller amount or another ad.",
  AlreadyDeclared: "You already declared this payment; continue with the e-dekont upload.",
  LockExpired: "Your reservation has ended. Do not send money now; reserve again first.",
  LateClaimClosed: "There is no open bond claim for your wallet on this reservation.",
  BondHeld: "The bond slice stays in escrow until the buyer's claim window has passed.",
  NoBond: "No bond is held for this reservation.",
  InvalidBond: "The bond rate must be at most 50%.",
  ReferenceMismatch: "The transfer description does not carry the payment reference for this wallet and reservation (ZKOTC<id><code>).",
  InvalidPrice: "The price must be positive.",
  InvalidLimits: "Per-trade limits must be within the deployment's bounds, min ≤ max, and the deposit must be worth at least one minimum trade.",
  BlobTooLarge: "The encrypted payee details are too large.",
  InvalidName: "The nickname is too long (24 characters max).",
};
