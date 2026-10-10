import { describe, expect, it } from "vitest";
import {
  accruedDays,
  accruedInterest,
  bondAccruedInterest,
  couponPayment,
  couponPeriod,
  periodCoupon,
} from "../src/index.js";
import { QUANTLIB, TREASURY } from "./fixtures.js";

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

describe("irregular (odd) first coupons — ACT/ACT-ICMA", () => {
  it("long first coupon: bond 912810DB1 (dated 1982-11-15, first coupon 1984-05-15)", () => {
    // TreasuryDirect accruedInterestPer1000 at issue (1983-02-15) = 26.36740.
    // v1.0.0 divided by the whole 18-month period and returned 8.72486.
    const p = {
      face: 1000,
      rate: 0.10375,
      frequency: 2,
      periodStart: "1982-11-15",
      periodEnd: "1984-05-15",
      settlement: "1983-02-15",
    };
    expect(accruedInterest(p)).toBeCloseTo(26.3674, 5);
    expect(
      bondAccruedInterest({
        face: 1000,
        rate: 0.10375,
        frequency: 2,
        maturity: "2012-05-15",
        datedDate: "1982-11-15",
        firstCouponDate: "1984-05-15",
        settlement: "1983-02-15",
      }),
    ).toBeCloseTo(26.3674, 5);
    // The 18-month first coupon pays three regular half-year coupons
    expect(periodCoupon(p)).toBeCloseTo(3 * 51.875, 10);
  });

  it("short first coupon: note 912827NE8 (dated 1982-05-17, first coupon 1982-11-15)", () => {
    // TreasuryDirect: 34.00136 (v1.0.0 returned the full 34.375)
    const p = {
      face: 1000,
      rate: 0.1375,
      frequency: 2,
      periodStart: "1982-05-17",
      periodEnd: "1982-11-15",
      settlement: "1982-08-16",
    };
    expect(accruedInterest(p)).toBeCloseTo(34.00136, 5);
    // Short coupon = coupon × (actual days / quasi-period days) = 68.75 × 182/184
    expect(periodCoupon(p)).toBeCloseTo(68.75 * (182 / 184), 10);
  });

  it("odd final coupon with oddPeriod: \"last\"", () => {
    // Regular coupons on the 15th; maturity 2027-03-01 makes a short last period.
    const p = {
      face: 100,
      rate: 0.06,
      frequency: 2,
      periodStart: "2026-11-15",
      periodEnd: "2027-03-01",
      settlement: "2027-01-15",
      oddPeriod: "last" as const,
    };
    // quasi period 2026-11-15 → 2027-05-15 = 181 days
    expect(accruedInterest(p)).toBeCloseTo(3 * (61 / 181), 12);
  });

  it("treats Nov 29 → Feb 28 as regular for a schedule on the 29th", () => {
    const p = {
      face: 100,
      rate: 0.04,
      frequency: 4,
      periodStart: "2026-11-29",
      periodEnd: "2027-02-28",
      settlement: "2027-01-10",
    };
    expect(accruedInterest(p)).toBeCloseTo(1 * (42 / 91), 12);
  });

  it("rolls quasi-coupon dates from maturity, keeping the schedule's day", () => {
    // Bond paying Feb 28 (clamped) / Aug 30, long first coupon from 2009-02-06.
    // Quasi periods: 2008-08-30 → 2009-02-28 (182 days), 2009-02-28 → 2009-08-30.
    // (QuantLib 1.43 rolls back from the clamped Feb 28 instead and gets 181 or 184.)
    const ai = bondAccruedInterest({
      face: 100,
      rate: 0.025,
      frequency: 2,
      maturity: "2011-08-30",
      datedDate: "2009-02-06",
      firstCouponDate: "2009-08-30",
      settlement: "2009-06-16",
    });
    expect(ai).toBeCloseTo(1.25 * (22 / 182 + 108 / 183), 12);
  });
});

describe("reproduces TreasuryDirect accruedInterestPer1000 (test/fixtures.ts)", () => {
  it(`${TREASURY.length} note and bond auctions, incl. every irregular first period`, () => {
    for (const t of TREASURY) {
      const ai = bondAccruedInterest({
        face: 1000,
        rate: t.rate / 100,
        frequency: t.frequency,
        maturity: t.maturity,
        datedDate: t.datedDate,
        firstCouponDate: t.firstCouponDate,
        settlement: t.issueDate,
      });
      expect(Math.round(ai * 1e5) / 1e5, t.cusip).toBe(t.accruedPer1000);
    }
  });
});

describe("matches QuantLib FixedRateBond.accruedAmount (test/fixtures.ts)", () => {
  it(`${QUANTLIB.length} bonds across all conventions, odd first coupons, ex-coupon`, () => {
    for (const q of QUANTLIB) {
      const base = { face: 100, rate: q.rate, frequency: q.frequency, convention: q.convention };
      const label = JSON.stringify(q);
      const period = accruedInterest({
        ...base,
        periodStart: q.periodStart,
        periodEnd: q.periodEnd,
        settlement: q.settlement,
        eom: q.eom,
        exCouponDate: q.exCouponDate,
      });
      expect(Math.abs(period - q.accrued), label).toBeLessThan(1e-9);
      if (!q.exCouponDate) {
        const sched = bondAccruedInterest({
          ...base,
          maturity: q.maturity,
          datedDate: q.datedDate,
          firstCouponDate: q.firstCouponDate,
          settlement: q.settlement,
          eom: q.eom,
        });
        expect(Math.abs(sched - q.accrued), label).toBeLessThan(1e-9);
      }
    }
  });
});

describe("ex-coupon periods", () => {
  const p = {
    face: 100,
    rate: 0.04,
    frequency: 2,
    periodStart: "2026-03-07",
    periodEnd: "2026-09-07",
    exCouponDate: "2026-08-27",
  };

  it("accrues normally before the ex-coupon date", () => {
    expect(accruedInterest({ ...p, settlement: "2026-08-26" })).toBeCloseTo(2 * (172 / 184), 12);
  });

  it("is negative from the ex-coupon date to the coupon date", () => {
    expect(accruedInterest({ ...p, settlement: "2026-08-27" })).toBeCloseTo(-2 * (11 / 184), 12);
    expect(accruedInterest({ ...p, settlement: "2026-09-07" })).toBe(0);
  });

  it("rejects an ex-coupon date after the coupon date", () => {
    expect(() => accruedInterest({ ...p, settlement: "2026-04-01", exCouponDate: "2026-09-08" })).toThrow(
      RangeError,
    );
  });
});

describe("couponPeriod", () => {
  it("finds the regular period from maturity", () => {
    expect(couponPeriod({ maturity: "2036-05-15", frequency: 2, settlement: "2026-07-15" })).toEqual({
      periodStart: "2026-05-15",
      periodEnd: "2026-11-15",
      regular: true,
    });
  });

  it("applies the end-of-month rule for month-end maturities", () => {
    expect(couponPeriod({ maturity: "2027-08-31", frequency: 2, settlement: "2026-03-10" })).toEqual({
      periodStart: "2026-02-28",
      periodEnd: "2026-08-31",
      regular: true,
    });
    expect(couponPeriod({ maturity: "2027-04-30", frequency: 2, settlement: "2026-11-10" })).toEqual({
      periodStart: "2026-10-31",
      periodEnd: "2027-04-30",
      regular: true,
    });
    expect(
      couponPeriod({ maturity: "2027-04-30", frequency: 2, settlement: "2026-11-10", eom: false }),
    ).toEqual({ periodStart: "2026-10-30", periodEnd: "2027-04-30", regular: true });
  });

  it("starts at the dated date for an odd first period", () => {
    expect(
      couponPeriod({
        maturity: "2027-08-31",
        frequency: 2,
        datedDate: "2025-09-02",
        settlement: "2025-09-02",
      }),
    ).toEqual({ periodStart: "2025-09-02", periodEnd: "2026-02-28", regular: false });
  });

  it("settlement on a coupon date starts the next period", () => {
    expect(couponPeriod({ maturity: "2036-05-15", frequency: 2, settlement: "2026-11-15" })).toEqual({
      periodStart: "2026-11-15",
      periodEnd: "2027-05-15",
      regular: true,
    });
  });

  it("validates its inputs", () => {
    const ok = { maturity: "2036-05-15", frequency: 2, settlement: "2026-07-15" };
    expect(() => couponPeriod({ ...ok, frequency: 5 })).toThrow(RangeError);
    expect(() => couponPeriod({ ...ok, settlement: "2036-05-15" })).toThrow(RangeError);
    expect(() => couponPeriod({ ...ok, datedDate: "2026-08-01" })).toThrow(RangeError);
    expect(() => couponPeriod({ ...ok, firstCouponDate: "2026-11-15" })).toThrow(/datedDate/);
  });
});

describe("convention validation", () => {
  it("rejects unknown conventions in every function", () => {
    const p = {
      face: 1000,
      rate: 0.05,
      frequency: 2,
      periodStart: "2026-02-15",
      periodEnd: "2026-08-15",
      settlement: "2026-04-15",
      convention: "ACT/365" as never,
    };
    expect(() => accruedInterest(p)).toThrow(RangeError);
    expect(() => accruedDays(p)).toThrow(RangeError); // v1.0.0 silently counted actual days
  });
});
