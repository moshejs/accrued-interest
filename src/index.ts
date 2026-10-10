/**
 * accrued-interest — bond accrued interest between coupon dates.
 *
 * Zero dependencies; the needed day-count conventions (ISDA 2006 §4.16) are
 * implemented internally. Dates are "YYYY-MM-DD" strings (recommended) or
 * Date objects read as UTC calendar dates.
 */

export type AccrualConvention =
  | "ACT/ACT-ICMA" // US Treasury notes/bonds (default)
  | "30/360"       // ISDA "Bond Basis": typical US corporates and municipals
  | "30E/360"
  | "ACT/360"
  | "ACT/365F"
  | "ACT/ACT-ISDA";

export type DateInput = string | Date;

export interface AccruedInterestParams {
  /** Face (par) amount, e.g. 1_000_000. */
  face: number;
  /** Annual coupon rate as a decimal, e.g. 0.04375 for 4.375%. */
  rate: number;
  /** Coupon payments per year: 2 for US Treasuries/corporates, 1, 4, 12. */
  frequency: number;
  /** Last coupon date (start of the current coupon period). */
  periodStart: DateInput;
  /** Next coupon date (end of the current coupon period). */
  periodEnd: DateInput;
  /** Settlement date; must lie within the coupon period. */
  settlement: DateInput;
  /** Day-count convention. Default "ACT/ACT-ICMA". */
  convention?: AccrualConvention;
  /**
   * ACT/ACT-ICMA only: where an irregular (short or long) period sits, which
   * fixes how its quasi-coupon dates are found. `"first"` (default) counts
   * regular periods back from periodEnd — an odd first coupon, the usual case
   * (e.g. bond 912810DB1: dated 1982-11-15, long first coupon 1984-05-15).
   * `"last"` counts forward from periodStart — an odd final coupon. Regular
   * periods give the same result either way.
   */
  oddPeriod?: "first" | "last";
  /**
   * ACT/ACT-ICMA only: end-of-month rule for quasi-coupon dates. When the
   * anchor date (periodEnd, or periodStart for `oddPeriod: "last"`) is the
   * last day of its month, `true` puts every quasi-coupon date on a month end
   * (US Treasury practice: Aug 31 ↔ Feb 28/29). Default: true when the
   * anchor is a month end.
   */
  eom?: boolean;
  /**
   * Ex-coupon (ex-dividend) date for this period, for markets that have one
   * (UK gilts, Australian bonds, …). When settlement falls on or after it, the
   * buyer does not receive the coupon and accrued interest is negative:
   * minus the interest from settlement to periodEnd.
   */
  exCouponDate?: DateInput;
}

interface YMD {
  y: number;
  m: number;
  d: number;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

function toYMD(input: DateInput, label: string): YMD {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) throw new RangeError(`Invalid Date for ${label}`);
    return { y: input.getUTCFullYear(), m: input.getUTCMonth() + 1, d: input.getUTCDate() };
  }
  const m = DATE_RE.exec(input);
  if (!m) throw new RangeError(`Invalid date for ${label}: "${input}" (expected YYYY-MM-DD)`);
  const ymd = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  const check = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d));
  if (
    check.getUTCFullYear() !== ymd.y ||
    check.getUTCMonth() + 1 !== ymd.m ||
    check.getUTCDate() !== ymd.d
  ) {
    throw new RangeError(`Invalid calendar date for ${label}: "${input}"`);
  }
  return ymd;
}

function utc(a: YMD): number {
  return Date.UTC(a.y, a.m - 1, a.d);
}

function actualDays(a: YMD, b: YMD): number {
  return Math.round((utc(b) - utc(a)) / MS_PER_DAY);
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function isMonthEnd(a: YMD): boolean {
  return a.d === daysInMonth(a.y, a.m);
}

/** `a` shifted by whole months; the day is clamped, or forced to month end. */
function addMonths(a: YMD, months: number, eom: boolean): YMD {
  const total = a.y * 12 + (a.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  const dim = daysInMonth(y, m);
  return { y, m, d: eom ? dim : Math.min(a.d, dim) };
}

function sameDay(a: YMD, b: YMD): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

function days30360(a: YMD, b: YMD): number {
  let d1 = a.d;
  let d2 = b.d;
  if (d1 === 31) d1 = 30;
  if (d2 === 31 && d1 === 30) d2 = 30;
  return 360 * (b.y - a.y) + 30 * (b.m - a.m) + (d2 - d1);
}

function days30E360(a: YMD, b: YMD): number {
  const d1 = a.d === 31 ? 30 : a.d;
  const d2 = b.d === 31 ? 30 : b.d;
  return 360 * (b.y - a.y) + 30 * (b.m - a.m) + (d2 - d1);
}

function yearFraction(a: YMD, b: YMD, convention: AccrualConvention): number {
  switch (convention) {
    case "30/360":
      return days30360(a, b) / 360;
    case "30E/360":
      return days30E360(a, b) / 360;
    case "ACT/360":
      return actualDays(a, b) / 360;
    case "ACT/365F":
      return actualDays(a, b) / 365;
    case "ACT/ACT-ISDA": {
      if (a.y === b.y) return actualDays(a, b) / (isLeap(a.y) ? 366 : 365);
      return (
        actualDays(a, { y: a.y + 1, m: 1, d: 1 }) / (isLeap(a.y) ? 366 : 365) +
        (b.y - a.y - 1) +
        actualDays({ y: b.y, m: 1, d: 1 }, b) / (isLeap(b.y) ? 366 : 365)
      );
    }
    default:
      throw new RangeError(`Unsupported convention here: ${convention}`);
  }
}

interface Validated {
  ps: YMD;
  pe: YMD;
  st: YMD;
  convention: AccrualConvention;
  ex: YMD | undefined;
}

const CONVENTIONS: readonly AccrualConvention[] = [
  "ACT/ACT-ICMA",
  "30/360",
  "30E/360",
  "ACT/360",
  "ACT/365F",
  "ACT/ACT-ISDA",
];

function validate(p: AccruedInterestParams): Validated {
  if (!Number.isFinite(p.face) || p.face <= 0) throw new RangeError(`Invalid face: ${p.face}`);
  if (!Number.isFinite(p.rate) || p.rate < 0) throw new RangeError(`Invalid rate: ${p.rate}`);
  if (p.rate > 1) {
    throw new RangeError(
      `rate must be a decimal (got ${p.rate} — did you mean ${p.rate / 100}? e.g. 0.04375 for 4.375%)`,
    );
  }
  if (!Number.isInteger(p.frequency) || p.frequency <= 0) {
    throw new RangeError(`Invalid frequency: ${p.frequency}`);
  }
  const ps = toYMD(p.periodStart, "periodStart");
  const pe = toYMD(p.periodEnd, "periodEnd");
  const st = toYMD(p.settlement, "settlement");
  if (utc(pe) <= utc(ps)) throw new RangeError("periodEnd must be after periodStart");
  if (utc(st) < utc(ps) || utc(st) > utc(pe)) {
    throw new RangeError("settlement must lie within [periodStart, periodEnd]");
  }
  const convention = p.convention ?? "ACT/ACT-ICMA";
  if (!CONVENTIONS.includes(convention)) {
    throw new RangeError(`Unsupported convention: ${String(convention)}`);
  }
  if (p.oddPeriod !== undefined && p.oddPeriod !== "first" && p.oddPeriod !== "last") {
    throw new RangeError(`oddPeriod must be "first" or "last", got ${String(p.oddPeriod)}`);
  }
  let ex: YMD | undefined;
  if (p.exCouponDate !== undefined) {
    ex = toYMD(p.exCouponDate, "exCouponDate");
    // May precede periodStart for a very short period (the whole period is then ex).
    if (utc(ex) > utc(pe)) throw new RangeError("exCouponDate must not be after periodEnd");
  }
  return { ps, pe, st, convention, ex };
}

/**
 * Regular coupon dates as month offsets from an anchor (normally the period
 * end; the maturity when the full schedule is known, so a 29th-of-month bond
 * keeps its day after a clamped Feb 28).
 */
interface QuasiGrid {
  anchor: YMD;
  /** Months from anchor to the period's regular end (0 or negative). */
  offset: number;
  eom: boolean;
}

/**
 * ACT/ACT-ICMA accrued interest from `from` to `to` (both within [ps, pe]).
 * A regular period gives coupon × days / periodDays;
 * an irregular one is split into quasi-coupon periods, each counted against
 * its own length (ICMA Rule 251; 31 CFR 356 Appendix B for Treasury short and
 * long first coupons).
 */
function icmaAccrual(
  ps: YMD,
  pe: YMD,
  from: YMD,
  to: YMD,
  p: AccruedInterestParams,
  grid?: QuasiGrid,
): number {
  const coupon = (p.face * p.rate) / p.frequency;
  const lo = utc(from);
  const hi = utc(to);
  if (hi <= lo) return 0;
  const regular = (): number => (coupon * actualDays(from, to)) / actualDays(ps, pe);
  // Frequencies that don't divide a year into whole months have no
  // quasi-coupon calendar: treat the period as regular.
  if (12 % p.frequency !== 0) return regular();
  const step = 12 / p.frequency;

  // A period exactly one regular period long is regular, whichever end the
  // schedule was rolled from and under either EOM reading (a schedule on the
  // 29th has Nov 29 → Feb 28, which is regular even though Feb 28 − 3 months
  // is Nov 28).
  for (const eom of [false, true]) {
    if (
      sameDay(addMonths(pe, -step, eom && isMonthEnd(pe)), ps) ||
      sameDay(addMonths(ps, step, eom && isMonthEnd(ps)), pe) ||
      (grid && sameDay(addMonths(grid.anchor, grid.offset - step, grid.eom), ps))
    ) {
      return regular();
    }
  }

  const last = p.oddPeriod === "last";
  const dir = last ? 1 : -1;
  const g: QuasiGrid = grid ?? {
    anchor: last ? ps : pe,
    offset: 0,
    eom: (p.eom ?? true) && isMonthEnd(last ? ps : pe),
  };
  let fraction = 0;
  // Walk quasi-coupon periods away from the anchor until the period is covered.
  for (let k = 0; ; k++) {
    const a = addMonths(g.anchor, g.offset + dir * k * step, g.eom);
    const b = addMonths(g.anchor, g.offset + dir * (k + 1) * step, g.eom);
    const [qs, qe] = last ? [a, b] : [b, a];
    const overlap = Math.min(hi, utc(qe)) - Math.max(lo, utc(qs));
    if (overlap > 0) fraction += Math.round(overlap / MS_PER_DAY) / actualDays(qs, qe);
    if (last ? utc(qe) >= utc(pe) : utc(qs) <= utc(ps)) break;
  }
  return coupon * fraction;
}

/** Accrued interest between two dates inside the period (no ex-coupon logic). */
function accrue(
  v: Validated,
  from: YMD,
  to: YMD,
  p: AccruedInterestParams,
  grid?: QuasiGrid,
): number {
  if (v.convention === "ACT/ACT-ICMA") {
    return icmaAccrual(v.ps, v.pe, from, to, p, grid);
  }
  return p.face * p.rate * yearFraction(from, to, v.convention);
}

/**
 * The coupon payment for one period: `face × rate / frequency`.
 */
export function couponPayment(face: number, rate: number, frequency: number): number {
  if (!Number.isFinite(face)) throw new RangeError(`Invalid face: ${face}`);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new RangeError(`rate must be a decimal in [0, 1], got ${rate}`);
  }
  if (!Number.isInteger(frequency) || frequency <= 0) {
    throw new RangeError(`Invalid frequency: ${frequency}`);
  }
  return (face * rate) / frequency;
}

/**
 * Days accrued from periodStart to settlement, counted per the convention
 * (actual days for ACT conventions, the 360-basis count for 30/360 family).
 */
export function accruedDays(p: AccruedInterestParams): number {
  const { ps, st, convention } = validate(p);
  switch (convention) {
    case "30/360":
      return days30360(ps, st);
    case "30E/360":
      return days30E360(ps, st);
    default:
      return actualDays(ps, st);
  }
}

/**
 * Accrued interest at settlement.
 *
 * ACT/ACT-ICMA (default — US Treasuries):
 *   coupon × accruedDays / periodDays for a regular period; an irregular
 *   (short or long) period is measured in quasi-coupon periods
 * All other conventions:
 *   face × rate × yearFraction(periodStart, settlement)
 *
 * With `exCouponDate` and settlement on or after it, the result is negative:
 * minus the interest from settlement to periodEnd.
 *
 * ```ts
 * // T 4.375% — matches TreasuryDirect's published accruedInterestPer1000
 * accruedInterest({
 *   face: 1000,
 *   rate: 0.04375,
 *   frequency: 2,
 *   periodStart: "2026-05-15",
 *   periodEnd: "2026-11-15",
 *   settlement: "2026-07-15",
 * }); // 7.252038043478261  (TreasuryDirect: 7.25204)
 * ```
 *
 * Returns the exact unrounded amount; round per your market's convention.
 */
export function accruedInterest(p: AccruedInterestParams): number {
  return accruedImpl(p);
}

function accruedImpl(p: AccruedInterestParams, grid?: QuasiGrid): number {
  const v = validate(p);
  if (v.ex && utc(v.st) >= utc(v.ex)) {
    const owed = accrue(v, v.st, v.pe, p, grid);
    return owed === 0 ? 0 : -owed;
  }
  return accrue(v, v.ps, v.st, p, grid);
}

/**
 * The coupon actually paid for the period: the regular `face × rate /
 * frequency` for a regular ACT/ACT-ICMA period, prorated for a short or long
 * one; `face × rate × yearFraction(periodStart, periodEnd)` otherwise.
 * Takes the same parameters as {@link accruedInterest} (settlement is still
 * validated but does not affect the result).
 */
export function periodCoupon(p: AccruedInterestParams): number {
  const v = validate(p);
  return accrue(v, v.ps, v.pe, p);
}

export interface CouponScheduleParams {
  /** Maturity date; regular coupon dates are counted back from it. */
  maturity: DateInput;
  /** Coupon payments per year; must divide 12 (1, 2, 3, 4, 6, 12). */
  frequency: number;
  /** Settlement date; must be before maturity (and on/after datedDate). */
  settlement: DateInput;
  /** Date interest starts accruing. Required with firstCouponDate. */
  datedDate?: DateInput;
  /**
   * First coupon date, for an odd (short or long) first coupon. Without it
   * but with a datedDate, the first period runs from datedDate to the first
   * regular coupon date after it.
   */
  firstCouponDate?: DateInput;
  /**
   * End-of-month rule: when maturity is the last day of its month, every
   * coupon date falls on a month end (Aug 31 ↔ Feb 28/29). Default true when
   * maturity is a month end.
   */
  eom?: boolean;
}

export interface CouponPeriod {
  /** Start of the coupon period containing settlement ("YYYY-MM-DD"). */
  periodStart: string;
  /** End of that period: the next coupon date ("YYYY-MM-DD"). */
  periodEnd: string;
  /** False for an odd (short or long) first period. */
  regular: boolean;
}

function fmt(a: YMD): string {
  return `${String(a.y).padStart(4, "0")}-${String(a.m).padStart(2, "0")}-${String(a.d).padStart(2, "0")}`;
}

/**
 * The coupon period containing settlement, from a bond's maturity, frequency
 * and (optionally) dated date / first coupon date. Coupon dates are generated
 * backward from maturity, unadjusted for holidays (as accrual dates are for
 * US Treasuries).
 *
 * ```ts
 * couponPeriod({ maturity: "2036-05-15", frequency: 2, settlement: "2026-07-15" });
 * // { periodStart: "2026-05-15", periodEnd: "2026-11-15", regular: true }
 * ```
 */
export function couponPeriod(p: CouponScheduleParams): CouponPeriod {
  return schedulePeriod(p).period;
}

function schedulePeriod(p: CouponScheduleParams): { period: CouponPeriod; grid?: QuasiGrid } {
  if (!Number.isInteger(p.frequency) || p.frequency <= 0 || 12 % p.frequency !== 0) {
    throw new RangeError(`frequency must divide 12 (1, 2, 3, 4, 6, 12), got ${p.frequency}`);
  }
  const mat = toYMD(p.maturity, "maturity");
  const st = toYMD(p.settlement, "settlement");
  const dated = p.datedDate === undefined ? undefined : toYMD(p.datedDate, "datedDate");
  if (utc(st) >= utc(mat)) throw new RangeError("settlement must be before maturity");
  if (dated && utc(st) < utc(dated))
    throw new RangeError("settlement must not be before datedDate");
  const step = 12 / p.frequency;
  const eom = (p.eom ?? true) && isMonthEnd(mat);

  if (p.firstCouponDate !== undefined) {
    const fc = toYMD(p.firstCouponDate, "firstCouponDate");
    if (!dated) throw new RangeError("firstCouponDate requires datedDate");
    if (utc(fc) <= utc(dated) || utc(fc) > utc(mat)) {
      throw new RangeError("firstCouponDate must lie within (datedDate, maturity]");
    }
    if (utc(st) < utc(fc)) {
      // Locate the first coupon on the maturity grid, if it is on it.
      let j = 0;
      while (utc(addMonths(mat, -j * step, eom)) > utc(fc)) j++;
      const onGrid = sameDay(addMonths(mat, -j * step, eom), fc);
      const grid = onGrid ? { anchor: mat, offset: -j * step, eom } : undefined;
      const regular = onGrid
        ? sameDay(addMonths(mat, -(j + 1) * step, eom), dated)
        : sameDay(addMonths(fc, -step, eom && isMonthEnd(fc)), dated);
      return { period: { periodStart: fmt(dated), periodEnd: fmt(fc), regular }, grid };
    }
  }

  let k = 1;
  let start = addMonths(mat, -step, eom);
  while (utc(start) > utc(st)) {
    k++;
    start = addMonths(mat, -k * step, eom);
  }
  const end = addMonths(mat, -(k - 1) * step, eom);
  const grid = { anchor: mat, offset: -(k - 1) * step, eom };
  if (dated && utc(start) < utc(dated)) {
    return { period: { periodStart: fmt(dated), periodEnd: fmt(end), regular: false }, grid };
  }
  return { period: { periodStart: fmt(start), periodEnd: fmt(end), regular: true }, grid };
}

export type BondAccruedInterestParams = CouponScheduleParams &
  Pick<AccruedInterestParams, "face" | "rate" | "convention">;

/**
 * Accrued interest straight from a bond's terms: finds the coupon period with
 * {@link couponPeriod}, then applies {@link accruedInterest} (odd first
 * coupons handled per ACT/ACT-ICMA quasi-coupon periods).
 *
 * ```ts
 * // 2-year note 91282CNV9: dated 2025-08-31, first coupon 2026-02-28,
 * // issued 2025-09-02. TreasuryDirect: accruedInterestPer1000 = 0.20028
 * bondAccruedInterest({
 *   face: 1000, rate: 0.03625, frequency: 2,
 *   maturity: "2027-08-31", datedDate: "2025-08-31",
 *   settlement: "2025-09-02",
 * }); // 0.2002762…
 * ```
 */
export function bondAccruedInterest(p: BondAccruedInterestParams): number {
  const { period, grid } = schedulePeriod(p);
  return accruedImpl(
    {
      face: p.face,
      rate: p.rate,
      frequency: p.frequency,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      settlement: p.settlement,
      convention: p.convention,
      oddPeriod: "first",
      eom: p.eom,
    },
    grid,
  );
}
