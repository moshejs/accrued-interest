# accrued-interest

Bond accrued interest between coupon dates — **ACT/ACT-ICMA** (US Treasuries), **30/360** (US corporates/munis), **30E/360**, **ACT/360**, **ACT/365F**, **ACT/ACT-ISDA**. Zero dependencies.

```
npm install accrued-interest
```

## Why

Accrued interest is on every bond ticket and in every fixed-income P&L, yet npm had no package that computes it. The formula is one line — the day-count conventions underneath are not. This package does both, and its default convention reproduces the US Treasury's own published numbers.

```ts
import { accruedInterest, accruedDays, couponPayment } from "accrued-interest";

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
- `periodStart` / `periodEnd` — the coupon period bracketing settlement
- `settlement` — must lie within the period
- `convention` — default `"ACT/ACT-ICMA"`

ACT/ACT-ICMA computes `coupon × accruedDays / periodDays`; other conventions compute `face × rate × yearFraction(periodStart, settlement)`. Returns the exact unrounded amount — round per your market's convention. Dates are `"YYYY-MM-DD"` strings (recommended) or `Date` objects read as UTC calendar dates; impossible dates throw.

### `accruedDays(params) → number`

The day count from `periodStart` to `settlement` under the convention (actual days for ACT, 360-basis count for the 30/360 family).

### `couponPayment(face, rate, frequency) → number`

One period's coupon: `face × rate / frequency`.

## Related

Part of a small fixed-income toolkit: [`32nds`](https://github.com/moshejs/32nds) (Treasury quote notation) · [`day-count`](https://github.com/moshejs/day-count) (the conventions, standalone) · [`sifma-holidays`](https://github.com/moshejs/sifma-holidays) (bond-market calendar) · [`treasurydirect`](https://github.com/moshejs/treasurydirect) (auction data client).

## Author

Built by **[Moshe Malka](https://moshemalka.com)** — engineering leader in New York City. Studio work at [Quentin.Code](https://www.quentin.software/).

MIT © Moshe Malka
