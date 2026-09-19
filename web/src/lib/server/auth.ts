/**
 * Server-side wallet authentication shared by the API routes: a short message signed by the wallet proves
 * control of a Stellar address without a transaction. Accepts a raw ed25519 signature over the message bytes
 * or a SEP-53 one (over sha256("Stellar Signed Message:\n" ‖ message)), which is what Freighter produces.
 */
import { Keypair, hash } from "@stellar/stellar-sdk";

export const MAX_AGE_S = 10 * 60;

export function signatureOk(address: string, message: string, signature: string): boolean {
  let kp: Keypair;
  try {
    kp = Keypair.fromPublicKey(address);
  } catch {
    return false;
  }
  const candidates: Buffer[] = [];
  try {
    candidates.push(Buffer.from(signature, "base64"));
  } catch {
    /* not base64 */
  }
  if (/^[0-9a-fA-F]{128}$/.test(signature)) candidates.push(Buffer.from(signature, "hex"));
  const raw = Buffer.from(message, "utf8");
  const sep53 = Buffer.from(hash(Buffer.concat([Buffer.from("Stellar Signed Message:\n", "utf8"), raw])));
  return candidates.some((sig) => sig.length === 64 && (safeVerify(kp, raw, sig) || safeVerify(kp, sep53, sig)));
}

function safeVerify(kp: Keypair, data: Buffer, sig: Buffer): boolean {
  try {
    return kp.verify(data, sig);
  } catch {
    return false;
  }
}

/** Is `ts` (unix seconds embedded in a signed message) recent enough? Allows 60 s of clock skew into the future. */
export function fresh(ts: number): boolean {
  const age = Math.floor(Date.now() / 1000) - ts;
  return age >= -60 && age <= MAX_AGE_S;
}
