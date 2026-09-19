import { Client as EscrowClient, Errors, type Offer, OfferStatus, type Config as EscrowConfig } from "@/contracts/escrow";
import type { AssembledTransaction, Result } from "@stellar/stellar-sdk/contract";
import { config } from "./config";

export type { Offer, EscrowConfig };
export { OfferStatus };

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

export const statusLabel: Record<number, string> = {
  [OfferStatus.Open]: "Open",
  [OfferStatus.Locked]: "Reserved",
  [OfferStatus.Fulfilled]: "Completed",
  [OfferStatus.Cancelled]: "Cancelled",
};

export async function listOffers(limit = 200): Promise<Offer[]> {
  const c = escrow();
  const count = (await c.offer_count()).result;
  if (count === 0n) return [];
  const start = count > BigInt(limit) ? count - BigInt(limit) + 1n : 1n;
  const tx = await c.list_offers({ start, limit });
  return [...tx.result].reverse();
}

export async function getOffer(id: bigint): Promise<Offer> {
  const tx = await escrow().get_offer({ id });
  return unwrapResult(tx.result);
}

export async function getConfig(): Promise<EscrowConfig> {
  const tx = await escrow().config();
  return unwrapResult(tx.result);
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
  Paused: "The marketplace is paused by the operator. Existing reservations can still be settled.",
  LockActive: "Another buyer holds this offer right now. Try again when the timer runs out.",
  OfferExpired: "This offer has expired. The seller can withdraw it.",
  TokenNotAllowed: "This token is not on the allow-list.",
  PayeeMismatch: "The dekont's recipient (name, bank, account) does not match the seller.",
  AmountTooLow: "The transfer in the dekont is smaller than the offer amount.",
  DateOutOfWindow: "The payment date is before you reserved this offer (Istanbul calendar day).",
  NullifierUsed: "This bank transfer was already used to settle another offer.",
  ProofInvalid: "The zero-knowledge proof did not verify on-chain.",
  DkimKeyNotTrusted: "The e-mail was signed with a DKIM key this contract does not trust yet.",
  DomainMismatch: "The e-mail was not signed by ileti.ziraatbank.com.tr.",
  NotBuyer: "Only the wallet that reserved this offer can claim it.",
  InvalidStatus: "This offer is not in a state that allows this action.",
  WrongOffer: "This proof was generated for a different offer.",
  InvalidIban: "IBAN must be a Turkish IBAN: TR + 24 digits.",
  AmountOutOfRange: "The TRY amount is outside the allowed range for this testnet deployment.",
};
