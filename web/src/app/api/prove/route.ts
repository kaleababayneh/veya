/**
 * POST /api/prove — the only way the browser starts a proving job.
 *
 * Gate: the caller signs `zkotc prove reservation <id> at <unix>` with the buyer wallet; the route checks the
 * signature, that the message is fresh, and on-chain that this wallet holds a live reservation with that id
 * (Active, or Released inside the late-claim window). It then derives every prover parameter from the chain
 * itself — amount, date window, and the maker's payee details opened from the sealed box with the reveal key —
 * and forwards the e-mail to the prover with the server-side PROVER_TOKEN. The token never reaches the browser,
 * and a wallet without a reservation cannot spend GPU time. The e-mail passes through this function in memory
 * only; nothing is stored.
 *
 * Env (server): PROVER_URL (falls back to NEXT_PUBLIC_PROVER_URL), PROVER_TOKEN, REVEAL_SECRET_KEY.
 */
import { NextResponse } from "next/server";
import sodium from "libsodium-wrappers";
import { Client, ReservationStatus } from "@/contracts/escrow";
import { config } from "@/lib/config";
import { istanbulYmd } from "@/lib/format";
import { signatureOk, fresh } from "@/lib/server/auth";
import { proverUrl as proverBase } from "@/lib/server/prover";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_EML_B64 = 3 * 1024 * 1024; // 2 MiB of e-mail, base64-encoded

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function unwrap<T>(r: { isOk(): boolean; unwrap(): T; unwrapErr(): { message?: string } | undefined }): T {
  if (r.isOk()) return r.unwrap();
  throw new Error(r.unwrapErr()?.message ?? "contract error");
}

export async function POST(req: Request) {
  const proverUrl = proverBase();
  const token = process.env.PROVER_TOKEN ?? "";
  const secretHex = process.env.REVEAL_SECRET_KEY;
  if (!proverUrl || !secretHex) return bad(503, "proving is not configured on this deployment (PROVER_URL / REVEAL_SECRET_KEY)");

  let body: { reservationId?: string; address?: string; message?: string; signature?: string; emlBase64?: string };
  try {
    body = await req.json();
  } catch {
    return bad(400, "invalid JSON");
  }
  const { reservationId, address, message, signature, emlBase64 } = body;
  if (!reservationId || !address || !message || !signature || !emlBase64) return bad(400, "reservationId, address, message, signature and emlBase64 are required");
  if (emlBase64.length > MAX_EML_B64) return bad(413, "e-mail larger than 2 MiB");

  // 1. signed, fresh, and about this reservation
  const m = /^zkotc prove reservation (\d+) at (\d+)$/.exec(message);
  if (!m || m[1] !== reservationId) return bad(400, "message does not match the request");
  if (!fresh(Number(m[2]))) return bad(400, "signed message is too old; sign again");
  if (!signatureOk(address, message, signature)) return bad(401, "wallet signature does not verify");

  // 2. on-chain: the wallet holds this reservation and it can still settle
  const c = new Client({ contractId: config.escrowId, networkPassphrase: config.networkPassphrase, rpcUrl: config.rpcUrl });
  let r, ad;
  try {
    r = unwrap((await c.get_reservation({ id: BigInt(reservationId) })).result);
    ad = unwrap((await c.get_ad({ id: r.ad_id })).result);
  } catch {
    return bad(404, "reservation not found");
  }
  const now = Math.floor(Date.now() / 1000);
  const live = r.status === ReservationStatus.Active || (r.status === ReservationStatus.Released && Number(r.late_claim_until) > now);
  if (r.buyer !== address) return bad(403, "this wallet does not hold the reservation");
  if (!live) return bad(409, "the reservation can no longer be settled");

  // 3. the maker's payee details, opened server-side (what the buyer paid to must be what the ad committed to)
  await sodium.ready;
  const sk = sodium.from_hex(secretHex.replace(/^0x/, ""));
  let payee: { iban: string; name: string };
  try {
    payee = JSON.parse(Buffer.from(sodium.crypto_box_seal_open(new Uint8Array(ad.payee_blob), sodium.crypto_scalarmult_base(sk), sk)).toString("utf8"));
  } catch {
    return bad(409, "the maker's payee details cannot be decrypted");
  }

  // 4. forward to the prover with the server-side token
  const res = await fetch(`${proverUrl}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-prover-token": token } : {}) },
    body: JSON.stringify({
      eml_base64: emlBase64,
      offer_id: Number(r.id),
      buyer: r.buyer,
      recipient_iban: payee.iban,
      recipient_name: payee.name,
      min_amount_kurus: Number(r.try_amount_kurus),
      since_yyyymmdd: istanbulYmd(Number(r.created_at)),
    }),
  });
  const text = await res.text();
  let out: unknown;
  try {
    out = JSON.parse(text);
  } catch {
    out = { error: text.slice(0, 300) };
  }
  return NextResponse.json(out, { status: res.status });
}
