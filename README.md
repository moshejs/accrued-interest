# accrued-interest

Bond accrued interest between coupon dates — **ACT/ACT-ICMA** (US Treasuries), **30/360** (US corporates/munis), **30E/360**, **ACT/360**, **ACT/365F**, **ACT/ACT-ISDA**. Zero dependencies.

```
npm install accrued-interest
```

## Why

Accrued interest is on every bond ticket and in every fixed-income P&L, yet npm had no package that computes it. The formula is one line — the day-count conventions and odd coupon periods underneath are not. This package does both, and its default convention reproduces the US Treasury's own published numbers.

```ts
import { accruedInterest, bondAccruedInterest } from "accrued-interest";

// T 4.375% — TreasuryDirect publishes accruedInterestPer1000 = 7.25204
// for this exact security (CUSIP 91282CQQ7, issued 2026-07-15):
accruedInterest({
  face: 1000,
  rate: 0.04375,          // annual coupon, decimal
  frequency: 2,           // semiannual
  periodStart: "2026-05-15",  // last coupon (dated date)
  periodEnd: "2026-11-15",    // next coupon
  settlement: "2026-07-15",
}); // 7.252038043478261

// A 30/360 corporate:
accruedInterest({
  face: 100_000,
  rate: 0.06,
  frequency: 2,
  periodStart: "2026-01-31",
  periodEnd: "2026-07-31",
  settlement: "2026-03-31",
  convention: "30/360",
}); // 1000
```

## API

### `accruedInterest(params) → number`

- `face` — par amount
- `rate` — annual coupon as a **decimal** (`0.04375`; passing `4.375` throws with a helpful message)
- `frequency` — coupon payments per year (2 for Treasuries and most corporates)
- `periodStart` / `periodEnd` — the coupon period bracketing settlement (for an odd first coupon: the dated date and the first coupon date)
- `settlement` — must lie within the period
- `convention` — default `"ACT/ACT-ICMA"`
- `oddPeriod` — ACT/ACT-ICMA only: `"first"` (default) or `"last"`, where an irregular period sits (see below)
- `eom` — ACT/ACT-ICMA only: end-of-month rule for quasi-coupon dates; default `true` when the anchor date is a month end
- `exCouponDate` — for markets with an ex-coupon (ex-dividend) period; from this date on, accrued interest is negative

ACT/ACT-ICMA computes `coupon × accruedDays / periodDays` for a regular period. For an **irregular** period — a short or long odd coupon — it follows ICMA Rule 251 and Treasury's own rule (31 CFR 356 Appendix B): the period is split into quasi-coupon periods, and each part is counted against the length of its own quasi period. By default quasi-coupon dates are counted back from `periodEnd` (an odd *first* coupon); pass `oddPeriod: "last"` to count forward from `periodStart` (an odd *final* coupon). Other conventions compute `face × rate × yearFraction(periodStart, settlement)`, which already handles odd periods.

```ts
// Long first coupon — bond 912810DB1, dated 1982-11-15, first coupon 1984-05-15.
// TreasuryDirect publishes accruedInterestPer1000 = 26.36740 at issue:
accruedInterest({
  face: 1000, rate: 0.10375, frequency: 2,
  periodStart: "1982-11-15", periodEnd: "1984-05-15", settlement: "1983-02-15",
}); // 26.367403…
```

With `exCouponDate` and settlement on or after it, the buyer doesn't receive the coupon, so the result is minus the interest from settlement to `periodEnd`.

Returns the exact unrounded amount — round per your market's convention. Dates are `"YYYY-MM-DD"` strings (recommended) or `Date` objects read as UTC calendar dates; impossible dates throw.

### `bondAccruedInterest(params) → number`

Accrued interest straight from the bond's terms — no need to work out the coupon period yourself:

```ts
// 2-year note 91282CNV9: dated 2025-08-31, issued 2025-09-02.
// TreasuryDirect: accruedInterestPer1000 = 0.20028
bondAccruedInterest({
  face: 1000, rate: 0.03625, frequency: 2,
  maturity: "2027-08-31",
  datedDate: "2025-08-31",
  settlement: "2025-09-02",
}); // 0.2002762…
```

Takes `face`, `rate`, `convention` plus the `couponPeriod` parameters below.

### `couponPeriod(params) → { periodStart, periodEnd, regular }`

The coupon period containing `settlement`. Coupon dates are generated backward from `maturity` (unadjusted for holidays, as accrual dates are for Treasuries), with the end-of-month rule when maturity is a month end (`eom: false` to turn it off). `frequency` must divide 12. Optional `datedDate` and `firstCouponDate` describe an odd first coupon; without `firstCouponDate`, the first period runs from `datedDate` to the first regular coupon date after it. Dates come back as `"YYYY-MM-DD"` strings.

### `periodCoupon(params) → number`

The coupon actually paid for the period (same parameters as `accruedInterest`): the regular `face × rate / frequency`, prorated for a short or long ACT/ACT-ICMA period.

### `accruedDays(params) → number`

The day count from `periodStart` to `settlement` under the convention (actual days for ACT, 360-basis count for the 30/360 family).

### `couponPayment(face, rate, frequency) → number`

One regular period's coupon: `face × rate / frequency`.

### Conventions

| Convention | Rule |
| --- | --- |
| `ACT/ACT-ICMA` | ICMA Rule 251 — US Treasuries, most government bonds |
| `30/360` | ISDA 2006 §4.16(f) "Bond Basis": D1 31→30; D2 31→30 only if D1 is 30/31. No end-of-February adjustment |
| `30E/360` | ISDA 2006 §4.16(g) "Eurobond Basis": any 31st → 30 |
| `ACT/360`, `ACT/365F` | actual days ÷ 360 or 365 |
| `ACT/ACT-ISDA` | actual days in each calendar year ÷ that year's length |

## Verification

- **TreasuryDirect**: `bondAccruedInterest` reproduces the published `accruedInterestPer1000` of 1,664 of the 1,666 note and bond auctions that report it (1980–2026), including every short and long first coupon and month-end schedule. The two exceptions are a 1986 auction whose figure doesn't follow ACT/ACT, and an exact half-way case (2.421875) that Treasury shows as 2.42187.
- **QuantLib 1.43** (`FixedRateBond.accruedAmount`): 105,121 comparisons over random bonds — every convention, frequencies 1/2/4/12, regular, short-first, long-first, non-EOM, and ex-coupon schedules — agree to 1e-9 except 17 cases. All 17 are odd first coupons on bonds paying on the 29th or 30th whose quasi period crosses February: QuantLib rolls quasi-coupon dates from the clamped Feb 28 (or a 30-day month end) while this package keeps the schedule's own day (e.g. Aug 30, not Aug 31).

A sample of both data sets is committed as test fixtures.

## Related

Part of a small fixed-income toolkit: [`32nds`](https://github.com/moshejs/32nds) (Treasury quote notation) · [`day-count`](https://github.com/moshejs/day-count) (the conventions, standalone) · [`sifma-holidays`](https://github.com/moshejs/sifma-holidays) (bond-market calendar) · [`treasurydirect`](https://github.com/moshejs/treasurydirect) (auction data client).

## Author

Built by **[Moshe Malka](https://moshemalka.com)** — engineering leader in New York City. Studio work at [Quentin.Code](https://www.quentin.software/).

MIT © Moshe Malka
