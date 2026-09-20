import { hash } from "@stellar/stellar-sdk";
export const short = (s: string, n = 4) => (s.length > 2 * n + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);

/** i128 smallest units -> human string with up to `decimals` fractional digits, trailing zeros trimmed */
export function fmtToken(amount: bigint | number | string, decimals = 7): string {
  const v = BigInt(amount);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const int = a / base;
  const frac = (a % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${int.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}

/** human token amount -> i128 smallest units */
export function parseToken(s: string, decimals = 7): bigint {
  const t = s.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error("invalid amount");
  const [i, f = ""] = t.split(".");
  if(f.length > decimals) throw new Error("Too many decimal places");
  return BigInt(i) * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals));
}

export const fmtTRY = (kurus: bigint | number) => {
  const k = Number(kurus);
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2 }).format(k / 100);
};

/** "4000" | "4000,50" | "4.000,50" -> kuruş */
export function parseTRY(s: string): bigint {
  const t = s.trim().replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new Error("invalid TRY amount");
  const [i, f = ""] = t.split(".");
  return BigInt(i) * 100n + BigInt((f + "00").slice(0, 2));
}

export const fmtIBAN = (iban: string) => iban.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();

export const fmtDate = (unix: bigint | number) =>
  unix && Number(unix) > 0 ? new Date(Number(unix) * 1000).toLocaleString("en-GB", { timeZone: "Europe/Istanbul" }) + " (Istanbul)" : "—";

export const fmtYmd = (ymd: bigint | number) => {
  const s = ymd.toString().padStart(8, "0");
  return `${s.slice(6, 8)}.${s.slice(4, 6)}.${s.slice(0, 4)}`;
};

/** Istanbul calendar day (yyyymmdd) for a unix timestamp — mirrors the contract's date window rule */
export const istanbulYmd = (unix: number) => {
  const d = new Date((unix + 3 * 3600) * 1000);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
};

export const nowSec = () => Math.floor(Date.now() / 1000);

export const secondsToClock = (s: number) => {
  if (s <= 0) return "00:00";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
};

export const hexToBuffer = (hex: string) => Buffer.from(hex.replace(/^0x/, ""), "hex");

/** Hex of contract bytes from the bindings — a Buffer in Node, but possibly a plain Uint8Array in the browser,
 *  whose `toString("hex")` would silently return comma-separated decimals. */
export function bytesToHex(b: Uint8Array | { toString(enc: string): string }): string {
  if (b instanceof Uint8Array) return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return String(b.toString("hex"));
}

/** `ZKOTC<offer id><6 hex of sha256(wallet)>`, one token — what the buyer types into the FAST description; the
 *  proof commits its hash and the escrow recomputes it from (offer, claiming wallet). Mirrors
 *  zkotc_lib::payment_reference and the escrow's payment_reference view. */
export function paymentReference(offerId: bigint | number, buyer: string): string {
  const h = hash(Buffer.from(buyer.trim(), "utf8"));
  return `ZKOTC${offerId.toString()}${Buffer.from(h.subarray(0, 3)).toString("hex").toUpperCase()}`;
}
