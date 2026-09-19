/**
 * Payee privacy: a maker's IBAN + name never appear on-chain in plain text. The browser seals them to the
 * reveal service's X25519 key (libsodium sealed box) when posting the ad; the service (`/api/reveal`, this
 * app's server side) opens the box only for the wallet that holds a reservation on the ad — or the maker —
 * after checking a signed message, and only if the details hash to the ad's on-chain `payee_hash`.
 */
import sodium from "libsodium-wrappers";

export type Payee = { iban: string; name: string; bank?: string };
export type Revealed = Payee & { verified: boolean };

export async function sealPayee(payee: Payee, revealPubkeyHex: string): Promise<Uint8Array> {
  await sodium.ready;
  const pk = sodium.from_hex(revealPubkeyHex.replace(/^0x/, ""));
  return sodium.crypto_box_seal(new TextEncoder().encode(JSON.stringify(payee)), pk);
}

export type MessageSigner = (message: string) => Promise<{ signedMessage: string; signerAddress?: string }>;

const cacheKey = (adId: bigint, reservationId: bigint | null, address: string) => `zkotc-payee-${adId}-${reservationId ?? "maker"}-${address}`;

/** Payee details already revealed in this browser session, if any (no wallet interaction). */
export function cachedReveal(adId: bigint, reservationId: bigint | null, address: string): Revealed | null {
  try {
    const cached = sessionStorage.getItem(cacheKey(adId, reservationId, address));
    return cached ? (JSON.parse(cached) as Revealed) : null;
  } catch {
    return null;
  }
}

/** Ask the reveal service for the payee details of `adId`, proving control of `address` with a wallet signature. */
export async function requestReveal(adId: bigint, reservationId: bigint | null, address: string, signMessage: MessageSigner): Promise<Revealed> {
  const key = cacheKey(adId, reservationId, address);
  try {
    const cached = sessionStorage.getItem(key);
    if (cached) return JSON.parse(cached) as Revealed;
  } catch {
    /* no session storage */
  }
  const message = `zkotc reveal ad ${adId.toString()} reservation ${reservationId?.toString() ?? "0"} at ${Math.floor(Date.now() / 1000)}`;
  const { signedMessage } = await signMessage(message);
  const res = await fetch("/api/reveal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adId: adId.toString(), reservationId: reservationId?.toString() ?? null, address, message, signature: signedMessage }),
  });
  const body = (await res.json()) as Revealed & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  try {
    sessionStorage.setItem(key, JSON.stringify(body));
  } catch {
    /* ignore */
  }
  return body;
}
