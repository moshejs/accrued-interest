/**
 * accrued-interest — bond accrued interest between coupon dates.
 *
 * Zero dependencies; the needed day-count conventions (ISDA 2006 §4.16) are
 * implemented internally. Dates are "YYYY-MM-DD" strings (recommended) or
 * Date objects read as UTC calendar dates.
 */

export type AccrualConvention =
  | "ACT/ACT-ICMA" // US Treasury notes/bonds (default)
  | "30/360"       // typical US corporates and municipals
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

function validate(p: AccruedInterestParams): {
  ps: YMD;
  pe: YMD;
  st: YMD;
  convention: AccrualConvention;
} {
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
  return { ps, pe, st, convention: p.convention ?? "ACT/ACT-ICMA" };
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
 *   coupon × accruedDays / periodDays
 * All other conventions:
 *   face × rate × yearFraction(periodStart, settlement)
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
  const { ps, pe, st, convention } = validate(p);
  if (convention === "ACT/ACT-ICMA") {
    const coupon = (p.face * p.rate) / p.frequency;
    return (coupon * actualDays(ps, st)) / actualDays(ps, pe);
  }
  return p.face * p.rate * yearFraction(ps, st, convention);
}
