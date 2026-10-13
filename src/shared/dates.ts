/** Calendar-date arithmetic on `YYYY-MM-DD` strings (SPEC §7.7). Pure; no time zones involved. */
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

interface Parts {
  y: number;
  m: number;
  d: number;
}

function parts(ymd: string): Parts | null {
  const match = YMD.exec(ymd);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m) ? { y, m, d } : null;
}

function mustParse(ymd: string): Parts {
  const p = parts(ymd);
  if (!p) throw new RangeError(`Not a calendar date: ${ymd}`);
  return p;
}

function format({ y, m, d }: Parts): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function isValidYmd(ymd: string): boolean {
  return parts(ymd) !== null;
}

/** Negative when a is before b, 0 when equal, positive when after. */
export function compareYmd(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Same day in the target month, or the last day of that month when it doesn't exist. */
export function addMonths(ymd: string, months: number): string {
  const { y, m, d } = mustParse(ymd);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12 + 12) % 12 + 1;
  return format({ y: year, m: month, d: Math.min(d, daysInMonth(year, month)) });
}

/** Feb 29 plus a year is Feb 28 in non-leap years (also D-12). */
export function addYears(ymd: string, years: number): string {
  return addMonths(ymd, years * 12);
}

function toDayNumber({ y, m, d }: Parts): number {
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function addDays(ymd: string, days: number): string {
  const date = new Date((toDayNumber(mustParse(ymd)) + days) * 86_400_000);
  return format({ y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() });
}

/** Days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return toDayNumber(mustParse(to)) - toDayNumber(mustParse(from));
}

/**
 * Whole months from start to the day after end, leftover days ignored:
 * 2026-11-01..2027-10-31 is 12; 2026-11-15..2027-11-30 is 12. Never negative.
 */
export function wholeMonthsBetween(start: string, end: string): number {
  const s = mustParse(start);
  const after = mustParse(addDays(end, 1));
  let months = (after.y - s.y) * 12 + (after.m - s.m);
  if (addMonths(start, months) > format(after)) months -= 1;
  return Math.max(0, months);
}

/** Full years from `start` to `on` using the anniversary rule (Feb 29 anniversary is Feb 28). */
export function fullYearsBetween(start: string, on: string): number {
  if (on < start) return 0;
  let years = mustParse(on).y - mustParse(start).y;
  if (addYears(start, years) > on) years -= 1;
  return Math.max(0, years);
}

const NY_YMD = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** The calendar date in America/New_York (D-04) for an instant; defaults to the app clock's "now". */
export function todayNy(now: Date = new Date()): string {
  return NY_YMD.format(now);
}
