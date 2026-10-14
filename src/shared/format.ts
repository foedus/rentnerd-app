/** Display and input helpers for money and dates (SPEC §11, D-30). Pure; money is integer cents. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONEY_INPUT = /^\$?(?:(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{0,2}))?|\.(\d{1,2}))$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2150", "2,150", "$2,150.00", "2150.5", ".50", "5." -> cents; null when the text is not a money amount. */
export function parseMoneyToCents(input: string): number | null {
  const m = MONEY_INPUT.exec(input.trim());
  if (!m) return null;
  const cents = Number((m[1] ?? "0").replace(/,/g, "")) * 100 + Number((m[2] ?? m[3] ?? "").padEnd(2, "0") || "0");
  return Number.isSafeInteger(cents) ? cents : null;
}

/** 215000 -> "$2,150.00" */
export function formatCents(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${cents < 0 ? "-" : ""}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** "2027-01-05" -> "Jan 5, 2027". Calendar dates have no time zone, so nothing is converted. */
export function formatDate(ymd: string): string {
  const m = YMD.exec(ymd);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!m || !month) return ymd;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

const NY_DATE_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** An instant (Date or ISO string) shown in New York time, e.g. "Jan 5, 2027, 3:04 PM". */
export function formatDateTime(instant: Date | string): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return Number.isNaN(d.getTime()) ? "" : NY_DATE_TIME.format(d);
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
