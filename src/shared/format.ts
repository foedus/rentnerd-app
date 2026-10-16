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

const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2027-01-05" -> "January 5, 2027" (documents, §8.1). */
export function formatLongDate(ymd: string): string {
  const m = YMD.exec(ymd);
  const month = m ? LONG_MONTHS[Number(m[2]) - 1] : undefined;
  if (!m || !month) return ymd;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

/** 1 -> "1st", 22 -> "22nd", 11 -> "11th" */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = [[1_000_000_000, "billion"], [1_000_000, "million"], [1_000, "thousand"]] as const;

function wordsBelowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
  const rest = n % 100;
  if (rest >= 20) parts.push(rest % 10 === 0 ? TENS[rest / 10]! : `${TENS[Math.floor(rest / 10)]}-${ONES[rest % 10]}`);
  else if (rest > 0) parts.push(ONES[rest]!);
  return parts.join(" ");
}

/** 215000 -> "Two thousand one hundred fifty dollars and 00/100" (§8.1 monthly_rent_words). */
export function centsInWords(cents: number): string {
  const dollars = Math.floor(Math.abs(cents) / 100);
  const parts: string[] = [];
  let rest = dollars;
  for (const [size, name] of SCALES) {
    if (rest >= size) {
      parts.push(`${wordsBelowThousand(Math.floor(rest / size))} ${name}`);
      rest %= size;
    }
  }
  if (rest > 0 || parts.length === 0) parts.push(dollars === 0 ? "zero" : wordsBelowThousand(rest));
  const text = parts.join(" ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} ${dollars === 1 ? "dollar" : "dollars"} and ${String(Math.abs(cents) % 100).padStart(2, "0")}/100`;
}
