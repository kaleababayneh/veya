import { describe, it, expect } from "vitest";
import {
  availableOffer,
  netReceipt,
  receiptFileError,
  tradeAction,
  validId,
} from "../src/lib/ux";
import { parseToken, parseTRY, fmtToken } from "../src/lib/format";
import { quoteKurus, tokensForKurus } from "../src/lib/escrow";
const offer = {
  status: 0,
  expires_at: 2000n,
  remaining: 1000000000n,
  min_try_kurus: 10000n,
  max_try_kurus: 1000000n,
  price_kurus: 4250n,
  decimals: 7,
};
describe("money and availability", () => {
  it("uses Turkish money punctuation and rejects ambiguous token commas", () => {
    expect(parseTRY("1.250,50")).toBe(125050n);
    expect(() => parseToken("1,25")).toThrow();
    expect(() => parseToken("0.00000001")).toThrow();
    expect(fmtToken(1n)).toBe("0.0000001");
  });
  it("preserves exact quote and fee at awkward rounding boundaries", () => {
    for (const budget of [10000n, 42501n, 100001n]) {
      const gross = tokensForKurus(budget, 4250n, 7);
      expect(quoteKurus(gross, 4250n, 7)).toBeLessThanOrEqual(budget);
      expect(quoteKurus(gross + 1n, 4250n, 7)).toBeGreaterThan(budget);
      expect(netReceipt(gross, 25)).toBe(gross - (gross * 25n) / 10000n);
    }
  });
  it("excludes closed, expired, exhausted and out-of-range offers", () => {
    expect(availableOffer(offer, 1000, 10000n)).toBe(true);
    for (const change of [
      { status: 1 },
      { expires_at: 1000n },
      { remaining: 1n },
      { price_kurus: 0n },
    ])
      expect(availableOffer({ ...offer, ...change }, 1000, 10000n)).toBe(false);
    expect(availableOffer(offer, 1000, 9999n)).toBe(false);
    expect(availableOffer(offer, 1000, 425001n)).toBe(false);
  });
});
describe("recovery", () => {
  const r = {
    status: 0,
    paid_declared_at: 0n,
    lock_expires_at: 1100n,
    late_claim_until: 1500n,
    bond_slice: 50n,
  };
  it("separates unpaid expiry, paid verification, settlement and bond deadlines", () => {
    expect(tradeAction(r, 1000)).toBe("pay");
    expect(tradeAction(r, 1100)).toBe("expired");
    expect(tradeAction({ ...r, paid_declared_at: 900n }, 1200)).toBe("verify");
    expect(tradeAction({ ...r, status: 1 }, 1000)).toBe("view");
    expect(tradeAction({ ...r, status: 2, paid_declared_at: 900n }, 1499)).toBe(
      "bond",
    );
    expect(tradeAction({ ...r, status: 2, paid_declared_at: 900n }, 1500)).toBe(
      "view",
    );
  });
  it("rejects malformed links and receipt format/size before uploading", () => {
    expect(validId("abc")).toBeNull();
    expect(validId("-1")).toBeNull();
    expect(validId("12")).toBe(12n);
    expect(receiptFileError({ name: "receipt.pdf", size: 200 })).toBe("format");
    expect(receiptFileError({ name: "receipt.eml", size: 0 })).toBe("size");
    expect(receiptFileError({ name: "receipt.eml", size: 2097153 })).toBe(
      "size",
    );
    expect(receiptFileError({ name: "receipt.EML", size: 2097152 })).toBeNull();
  });
});
