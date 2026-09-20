// Browser-only fixtures; this directory is never imported by the Next application.
import React, { useState } from "react";
import { Buffer } from "buffer";
import { Keypair } from "@stellar/stellar-sdk";
export {
  quoteKurus,
  tokensForKurus,
  explainError,
  unwrapResult,
  ERROR_HELP,
  reservationLabel,
} from "../../src/lib/escrow";
export const config = {
  xlmSac: "XLM",
  usdcSac: "USDC",
  minMinutesToPay: 15,
  proverUrl: "https://fixture.invalid",
  anchorHomeDomain: "",
  networkPassphrase: "test",
};
export const txUrl = (s: string) => `https://fixture.invalid/tx/${s}`,
  accountUrl = txUrl,
  contractUrl = txUrl;
const buyer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey(),
  seller = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
export function useWallet() {
  const [address, setAddress] = useState<string | null>(
    new URLSearchParams(location.search).get("wallet") === "off" ? null : buyer,
  );
  return {
    address,
    ready: true,
    connecting: false,
    connect: async () => {
      setAddress(buyer);
    },
    disconnect: async () => {
      setAddress(null);
    },
    signTransaction: async () => {
      throw new Error("Fixture: no transaction sent");
    },
    signMessage: async () => ({ signedMessage: "fixture" }),
  };
}
export function WalletProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
const now = BigInt(Math.floor(Date.now() / 1000));
const ad = {
  id: 1n,
  seller,
  token: "USDC",
  remaining: 10000000000n,
  reserved: 100000000n,
  bond_available: 500000000n,
  bond_held: 5000000n,
  price_kurus: 4000n,
  min_try_kurus: 10000n,
  max_try_kurus: 1000000n,
  status: 0,
  decimals: 7,
  expires_at: now + 86400n,
  nickname: "Ada",
  settled_count: 8,
  created_at: now - 500n,
  active_reservations: 1,
  payee_hash: Buffer.alloc(32),
  payee_blob: Buffer.alloc(32),
};
export const getConfig = async () => ({
  fee_bps: 25,
  bond_bps: 500,
  min_try_kurus: 10000n,
  max_try_kurus: 1000000n,
  image_id: Buffer.alloc(32),
  reveal_pubkey: Buffer.alloc(32),
  lock_duration: 1800n,
  proof_window: 7200n,
  late_claim_window: 259200n,
});
export const getAd = async () => ad;
export const listAds = async () => [
  ad,
  { ...ad, id: 2n, nickname: "Deniz", price_kurus: 4100n, settled_count: 12 },
  { ...ad, id: 3n, nickname: "Mert", price_kurus: 4200n, settled_count: 3 },
];
export const getReservation = async () => {
  const state = new URLSearchParams(location.search).get("state");
  return {
    id: 1n,
    ad_id: 1n,
    buyer,
    amount: 250000000n,
    try_amount_kurus: 100000n,
    bond_slice: 12500000n,
    status: state === "bond" ? 2 : state === "settled" ? 1 : 0,
    created_at: now - 20n,
    lock_expires_at: state === "expired" ? 1n : now + 1800n,
    paid_declared_at: state === "paid" || state === "bond" ? now - 10n : 0n,
    late_claim_until: state === "bond" ? now + 10000n : 0n,
    settled_at: now,
  };
};
export const listReservations = async () => [await getReservation()];
export const requestReveal = async () => ({
  verified: true,
  iban: "TR420001000000000000000001",
  name: "TEST PERSON",
  bank: "Ziraat",
});
export const cachedReveal = () => null;
export const sealPayee = async () => new Uint8Array(32);
export const payeeHashHex = async () => "00".repeat(32);
export const escrow = () => ({
  reserve: async () => ({}),
  create_ad: async () => ({}),
});
export const send = async () => {
  throw new Error("Fixture: no transaction sent");
};
export const proverInfo = async () => ({
  image_id: "00".repeat(32),
  prover_mode: "fixture",
  dkim_source: "fixture",
});
export const getJob = async () => {
  throw new Error("Fixture job not found");
};
export const requestProof = async () => {
  throw new Error("Fixture: no email sent");
};
export const fileToBase64 = async () => "";
export const JOB_STEPS = [
  { key: "queued", label: "Queued" },
  { key: "proving", label: "Generating proof" },
  { key: "done", label: "Proof ready" },
];
export const TOKENS = [
  { address: "XLM", symbol: "XLM", decimals: 7, name: "Stellar Lumens" },
  { address: "USDC", symbol: "USDC", decimals: 7, name: "USD Coin" },
];
export const tokenByAddress = (address: string) =>
  TOKENS.find((t) => t.address === address) ?? TOKENS[0];
