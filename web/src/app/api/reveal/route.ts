import { NextResponse } from "next/server";
import { Keypair, hash } from "@stellar/stellar-sdk";
import sodium from "libsodium-wrappers";
import { Client, ReservationStatus } from "@/contracts/escrow";
import { config } from "@/lib/config";
import { bytesToHex } from "@/lib/format";

export const runtime = "nodejs";

const MAX_AGE_S = 10 * 60;

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function unwrap<T>(r: { isOk(): boolean; unwrap(): T; unwrapErr(): { message?: string } | undefined }): T {
  if (r.isOk()) return r.unwrap();
  throw new Error(r.unwrapErr()?.message ?? "contract error");
}

/** Accept a raw ed25519 signature over the message bytes, or a SEP-53 one (over sha256("Stellar Signed Message:\n" ‖ message)). */
function signatureOk(address: string, message: string, signature: string): boolean {
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

export async function POST(req: Request) {
  const secretHex = process.env.REVEAL_SECRET_KEY;
  if (!secretHex) return bad(503, "reveal service is not configured (REVEAL_SECRET_KEY)");
  let body: { adId?: string; reservationId?: string | null; address?: string; message?: string; signature?: string };
  try {
    body = await req.json();
  } catch {
    return bad(400, "invalid JSON");
  }
  const { adId, reservationId, address, message, signature } = body;
  if (!adId || !address || !message || !signature) return bad(400, "adId, address, message and signature are required");

  // 1. the signed message must name this ad/reservation and be fresh
  const m = /^zkotc reveal ad (\d+) reservation (\d+) at (\d+)$/.exec(message);
  if (!m || m[1] !== adId || m[2] !== (reservationId ?? "0")) return bad(400, "message does not match the request");
  const age = Math.floor(Date.now() / 1000) - Number(m[3]);
  if (age < -60 || age > MAX_AGE_S) return bad(400, "signed message is too old; sign again");
  if (!signatureOk(address, message, signature)) return bad(401, "wallet signature does not verify");

  // 2. on-chain: is this wallet the maker, or does it hold a live reservation on the ad?
  const c = new Client({ contractId: config.escrowId, networkPassphrase: config.networkPassphrase, rpcUrl: config.rpcUrl });
  let ad;
  try {
    ad = unwrap((await c.get_ad({ id: BigInt(adId) })).result);
  } catch {
    return bad(404, "ad not found");
  }
  let allowed = ad.seller === address;
  if (!allowed && reservationId) {
    try {
      const r = unwrap((await c.get_reservation({ id: BigInt(reservationId) })).result);
      const now = Math.floor(Date.now() / 1000);
      const live = r.status === ReservationStatus.Active || (r.status === ReservationStatus.Released && Number(r.late_claim_until) > now);
      allowed = r.buyer === address && r.ad_id === ad.id && live;
    } catch {
      return bad(404, "reservation not found");
    }
  }
  if (!allowed) return bad(403, "only the maker or a wallet holding a reservation on this ad may see the payee details");

  // 3. open the sealed box and check the details against the ad's commitment
  await sodium.ready;
  const sk = sodium.from_hex(secretHex.replace(/^0x/, ""));
  const pk = sodium.crypto_scalarmult_base(sk);
  let payee: { iban: string; name: string };
  try {
    const plain = sodium.crypto_box_seal_open(new Uint8Array(ad.payee_blob), pk, sk);
    payee = JSON.parse(Buffer.from(plain).toString("utf8"));
  } catch {
    return bad(409, "the maker's payee details cannot be decrypted (sealed to another key)");
  }
  let verified = false;
  try {
    const h = unwrap((await c.payee_hash({ iban: payee.iban, name: payee.name })).result);
    verified = bytesToHex(h).toLowerCase() === bytesToHex(ad.payee_hash).toLowerCase();
  } catch {
    verified = false;
  }
  return NextResponse.json({ iban: payee.iban, name: payee.name, verified });
}
