import { describe, expect, it } from "vitest";
import { accruedDays, accruedInterest, couponPayment } from "../src/index.js";

describe("accruedInterest — ACT/ACT-ICMA (US Treasuries)", () => {
  it("reproduces TreasuryDirect's published accrued interest exactly", () => {
    // 9y10m reopened Note, 4.375%, dated 2026-05-15, issued 2026-07-15.
    // TreasuryDirect (auction result 2026-07-08, CUSIP 91282CQQ7):
    // accruedInterestPer1000 = "7.2520400000" (rounded to 7 figures)
    const perThousand = accruedInterest({
      face: 1000,
      rate: 0.04375,
      frequency: 2,
      periodStart: "2026-05-15",
      periodEnd: "2026-11-15",
      settlement: "2026-07-15",
    });
    expect(perThousand).toBe((21.875 * 61) / 184);
    expect(perThousand).toBeCloseTo(7.25204, 5);
  });

  it("scales linearly with face", () => {
    const base = {
      rate: 0.04375,
      frequency: 2,
      periodStart: "2026-05-15",
      periodEnd: "2026-11-15",
      settlement: "2026-07-15",
    };
    expect(accruedInterest({ ...base, face: 1_000_000 })).toBeCloseTo(7252.04, 1);
  });

  it("is zero on the coupon date and the full coupon at period end", () => {
    const base = {
      face: 1000,
      rate: 0.05,
      frequency: 2,
      periodStart: "2026-02-15",
      periodEnd: "2026-08-15",
    };
    expect(accruedInterest({ ...base, settlement: "2026-02-15" })).toBe(0);
    expect(accruedInterest({ ...base, settlement: "2026-08-15" })).toBe(25);
  });
});

describe("accruedInterest — other conventions", () => {
  it("30/360 corporate accrual", () => {
    // 6% corporate, period Jan 31 → Jul 31, settle Mar 31.
    // 30/360 days Jan 31 → Mar 31: D1 31→30, D2 31→30 ⇒ 60 days
    const accrued = accruedInterest({
      face: 100_000,
      rate: 0.06,
      frequency: 2,
      periodStart: "2026-01-31",
      periodEnd: "2026-07-31",
      settlement: "2026-03-31",
      convention: "30/360",
    });
    expect(accrued).toBe(100_000 * 0.06 * (60 / 360)); // 1000
  });

  it("ACT/360 money-market style accrual", () => {
    const accrued = accruedInterest({
      face: 1_000_000,
      rate: 0.05,
      frequency: 4,
      periodStart: "2026-01-15",
      periodEnd: "2026-04-15",
      settlement: "2026-02-14",
      convention: "ACT/360",
    });
    expect(accrued).toBe(1_000_000 * 0.05 * (30 / 360));
  });

  it("ACT/ACT-ISDA splits across year boundary", () => {
    const accrued = accruedInterest({
      face: 1000,
      rate: 0.04,
      frequency: 2,
      periodStart: "2025-11-15",
      periodEnd: "2026-05-15",
      settlement: "2026-01-15",
      convention: "ACT/ACT-ISDA",
    });
    // 47 days in 2025 (Nov 15 → Jan 1) + 14 days in 2026, both ÷365
    expect(accrued).toBeCloseTo(1000 * 0.04 * (47 / 365 + 14 / 365), 12);
  });
});

describe("accruedDays", () => {
  it("counts actual days for ACT conventions", () => {
    expect(
      accruedDays({
        face: 1000,
        rate: 0.04375,
        frequency: 2,
        periodStart: "2026-05-15",
        periodEnd: "2026-11-15",
        settlement: "2026-07-15",
      }),
    ).toBe(61);
  });

  it("counts 360-basis days for 30/360", () => {
    expect(
      accruedDays({
        face: 1000,
        rate: 0.06,
        frequency: 2,
        periodStart: "2026-01-31",
        periodEnd: "2026-07-31",
        settlement: "2026-03-31",
        convention: "30/360",
      }),
    ).toBe(60);
  });
});

describe("couponPayment", () => {
  it("computes face × rate / frequency", () => {
    expect(couponPayment(1_000_000, 0.04375, 2)).toBe(21_875);
    expect(couponPayment(1000, 0.06, 4)).toBe(15);
  });
});

describe("validation", () => {
  const ok = {
    face: 1000,
    rate: 0.05,
    frequency: 2,
    periodStart: "2026-02-15",
    periodEnd: "2026-08-15",
    settlement: "2026-04-15",
  };

  it("catches percent-instead-of-decimal rates", () => {
    expect(() => accruedInterest({ ...ok, rate: 4.375 })).toThrow(/decimal/);
  });

  it("rejects settlement outside the period", () => {
    expect(() => accruedInterest({ ...ok, settlement: "2026-01-01" })).toThrow(RangeError);
    expect(() => accruedInterest({ ...ok, settlement: "2026-09-01" })).toThrow(RangeError);
  });

  it("rejects inverted periods, bad face/frequency, malformed dates", () => {
    expect(() => accruedInterest({ ...ok, periodEnd: "2026-01-15" })).toThrow(RangeError);
    expect(() => accruedInterest({ ...ok, face: 0 })).toThrow(RangeError);
    expect(() => accruedInterest({ ...ok, frequency: 2.5 })).toThrow(RangeError);
    expect(() => accruedInterest({ ...ok, settlement: "2026-4-15" })).toThrow(RangeError);
    expect(() => accruedInterest({ ...ok, settlement: "2026-02-30" })).toThrow(RangeError);
  });
});
