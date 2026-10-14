/** Portfolio and per-property statistics (SPEC §7.6, D-15, D-16). Money is integer cents. */
import { otherIncome, type OtherIncomeTerms, type PropertyTaxYear } from "./income";
import { currentTerm, unitOccupancy, type UnitLease } from "./lease";

export interface StatLease extends UnitLease {
  /** Other-income inputs of each term, keyed by the term's start date (master and extensions). */
  otherIncomeByTermStart: Readonly<Record<string, OtherIncomeTerms>>;
}

export interface PropertyValueEntry {
  valueDate: string;
  kind: "market_estimate" | "assessed";
  amountCents: number;
}

export interface StatProperty {
  purchasePriceCents: number | null;
  values: readonly PropertyValueEntry[];
  taxes: readonly PropertyTaxYear[];
  /** Non-archived units, each with its leases. */
  units: readonly { leases: readonly StatLease[] }[];
}

export interface Stats {
  units: number;
  occupied: number;
  vacant: number;
  /** Occupancy in tenths of a percent (999 = 99.9%); null with no units. */
  occupancyTenths: number | null;
  monthlyRentRollCents: number;
  annualRentRollCents: number;
  monthlyOtherIncomeCents: number;
  vacancyLossCents: number;
  /** Property value (D-15); for a portfolio the sum of values that exist, null if none. */
  valueCents: number | null;
  /** Gross yield in hundredths of a percent (525 = 5.25%); null without a value. */
  grossYieldHundredths: number | null;
  /** Portfolio only: properties with a value, and all properties ("Based on {n} of {m} properties with a value."). */
  propertiesWithValue: number;
  properties: number;
}

/** Where a property's value comes from (D-15): the latest market estimate (with its date) or the purchase price. */
export type ValueBasis = { kind: "market_estimate"; date: string } | { kind: "purchase_price" };

/** D-15: latest market estimate (latest date wins; on a tie the later entry), else purchase price, else null. */
export function currentValue(property: Pick<StatProperty, "purchasePriceCents" | "values">): { amountCents: number; basis: ValueBasis } | null {
  const market = property.values.filter((v) => v.kind === "market_estimate");
  if (market.length > 0) {
    const latest = market.reduce((a, b) => (b.valueDate >= a.valueDate ? b : a));
    return { amountCents: latest.amountCents, basis: { kind: "market_estimate", date: latest.valueDate } };
  }
  return property.purchasePriceCents == null ? null : { amountCents: property.purchasePriceCents, basis: { kind: "purchase_price" } };
}

export function propertyValue(property: Pick<StatProperty, "purchasePriceCents" | "values">): number | null {
  return currentValue(property)?.amountCents ?? null;
}

function divRound(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

interface Totals {
  units: number;
  occupied: number;
  rent: number;
  other: number;
  loss: number;
}

function propertyTotals(property: StatProperty, today: string): Totals {
  const totals: Totals = { units: property.units.length, occupied: 0, rent: 0, other: 0, loss: 0 };
  for (const unit of property.units) {
    const occ = unitOccupancy(unit.leases, today);
    if (occ.occupied) {
      totals.occupied += 1;
      totals.rent += occ.currentRentCents ?? 0;
      const lease = unit.leases.find((l) => l.id === occ.currentLeaseId);
      const terms = lease?.otherIncomeByTermStart[currentTerm(lease, today).startDate];
      if (terms) totals.other += otherIncome(terms, property.taxes).totalCents;
    } else {
      totals.loss += occ.potentialRentCents ?? 0;
    }
  }
  return totals;
}

/** Statistics over a set of non-archived properties (one property for per-property figures). */
export function computeStats(properties: readonly StatProperty[], today: string): Stats {
  const sum: Totals = { units: 0, occupied: 0, rent: 0, other: 0, loss: 0 };
  let value = 0;
  let withValue = 0;
  let incomeWithValue = 0;
  for (const property of properties) {
    const t = propertyTotals(property, today);
    sum.units += t.units;
    sum.occupied += t.occupied;
    sum.rent += t.rent;
    sum.other += t.other;
    sum.loss += t.loss;
    const v = propertyValue(property);
    if (v !== null) {
      value += v;
      withValue += 1;
      incomeWithValue += t.rent + t.other;
    }
  }
  return {
    units: sum.units,
    occupied: sum.occupied,
    vacant: sum.units - sum.occupied,
    occupancyTenths: sum.units === 0 ? null : divRound(sum.occupied * 1000, sum.units),
    monthlyRentRollCents: sum.rent,
    annualRentRollCents: 12 * sum.rent,
    monthlyOtherIncomeCents: sum.other,
    vacancyLossCents: sum.loss,
    valueCents: withValue === 0 ? null : value,
    grossYieldHundredths: withValue === 0 || value === 0 ? null : divRound(12 * incomeWithValue * 10_000, value),
    propertiesWithValue: withValue,
    properties: properties.length,
  };
}

/** 999 -> "99.9%"; null -> "—". */
export function formatOccupancy(tenths: number | null): string {
  return tenths === null ? "—" : `${(tenths / 10).toFixed(1)}%`;
}

/** 525 -> "5.25%"; null -> "—". */
export function formatYield(hundredths: number | null): string {
  return hundredths === null ? "—" : `${(hundredths / 100).toFixed(2)}%`;
}

/** "Based on 2 of 3 properties with a value." */
export function yieldNote(stats: Pick<Stats, "propertiesWithValue" | "properties">): string {
  return `Based on ${stats.propertiesWithValue} of ${stats.properties} properties with a value.`;
}
