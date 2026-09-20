/** Pure presentation rules; all amounts remain integer contract units. */
export function netReceipt(amount: bigint, feeBps: number): bigint {
  return amount - (amount * BigInt(feeBps)) / 10000n;
}
export function validId(value: string): bigint | null {
  return /^\d{1,18}$/.test(value) ? BigInt(value) : null;
}
export function availableOffer(
  ad: {
    status: number;
    expires_at: bigint;
    remaining: bigint;
    min_try_kurus: bigint;
    max_try_kurus: bigint;
    price_kurus: bigint;
    decimals: number;
  },
  now: number,
  amountKurus = 0n,
): boolean {
  if (
    ad.status !== 0 ||
    ad.price_kurus <= 0n ||
    ad.remaining <= 0n ||
    (ad.expires_at !== 0n && ad.expires_at <= BigInt(now))
  )
    return false;
  const capacity = (ad.remaining * ad.price_kurus) / 10n ** BigInt(ad.decimals);
  return (
    capacity >= ad.min_try_kurus &&
    (amountKurus === 0n ||
      (amountKurus >= ad.min_try_kurus &&
        amountKurus <= ad.max_try_kurus &&
        amountKurus <= capacity))
  );
}
export function tradeAction(
  r: {
    status: number;
    paid_declared_at: bigint;
    lock_expires_at: bigint;
    late_claim_until: bigint;
    bond_slice: bigint;
  },
  now: number,
): "pay" | "verify" | "expired" | "bond" | "view" {
  if (r.status === 0)
    return r.paid_declared_at !== 0n
      ? "verify"
      : r.lock_expires_at <= BigInt(now)
        ? "expired"
        : "pay";
  if (
    r.status === 2 &&
    r.paid_declared_at !== 0n &&
    r.bond_slice > 0n &&
    r.late_claim_until > BigInt(now)
  )
    return "bond";
  return "view";
}
export function receiptFileError(file: {
  name: string;
  size: number;
}): "format" | "size" | null {
  if (!/\.eml$/i.test(file.name)) return "format";
  if (!file.size || file.size > 2 * 1024 * 1024) return "size";
  return null;
}
