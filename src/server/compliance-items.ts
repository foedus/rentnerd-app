import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { complianceItemType, property, propertyComplianceItem, unit } from "../db/schema";
import { SEEDED_COMPLIANCE_TYPES, initialDueDate, isTypeApplicable } from "../shared/compliance-rules";
import { todayNy } from "../shared/dates";

type Tx = Pick<Db, "select" | "insert" | "update">;

/**
 * Inserts the §9.1 catalog types that are missing (never touching existing ones, so edits survive restarts) and
 * gives every property an item for each type. Idempotent and safe to run twice at once (D-34).
 */
export async function seedComplianceCatalog(db: Db): Promise<{ inserted: number }> {
  const rows = SEEDED_COMPLIANCE_TYPES.map((t) => ({
    name: t.name,
    appliesTo: t.appliesTo,
    nycOnly: t.nycOnly,
    scheduleType: t.scheduleType,
    dueMonth: t.scheduleType === "annual_date" ? t.dueMonth : null,
    dueDay: t.scheduleType === "annual_date" ? t.dueDay : null,
    intervalMonths: t.scheduleType === "interval" ? t.intervalMonths : null,
    isSeeded: true,
  }));
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(complianceItemType).values(rows).onConflictDoNothing().returning({ id: complianceItemType.id });
    const ids = await tx.select({ id: property.id }).from(property);
    for (const { id } of ids) await syncPropertyCompliance(tx, id);
    return { inserted: inserted.length };
  });
}

/**
 * SPEC §6.14: makes sure the property has an item for every non-archived type and recomputes `applicable` from
 * the type's rules, unless an editor has set it. Call inside the transaction of any unit add/archive/restore
 * or NYC-flag change. An item that becomes applicable with no due date gets its annual date.
 */
export async function syncPropertyCompliance(tx: Tx, propertyId: string, today: string = todayNy()): Promise<void> {
  const [prop] = await tx.select({ inNyc: property.inNyc }).from(property).where(eq(property.id, propertyId));
  if (!prop) return;
  const uses = (await tx.select({ use: unit.use }).from(unit).where(and(eq(unit.propertyId, propertyId), isNull(unit.archivedAt)))).map((u) => u.use);
  const types = await tx.select().from(complianceItemType).where(isNull(complianceItemType.archivedAt));
  const items = new Map((await tx.select().from(propertyComplianceItem).where(eq(propertyComplianceItem.propertyId, propertyId))).map((i) => [i.typeId, i]));

  const missing = [];
  for (const type of types) {
    const applicable = isTypeApplicable(type, prop, uses);
    const item = items.get(type.id);
    if (!item) {
      missing.push({ propertyId, typeId: type.id, applicable, nextDueDate: applicable ? initialDueDate(type, today) : null });
    } else if (!item.applicableSetByUser && item.applicable !== applicable) {
      await tx
        .update(propertyComplianceItem)
        .set({ applicable, nextDueDate: applicable && item.nextDueDate === null ? initialDueDate(type, today) : item.nextDueDate, version: sql`${propertyComplianceItem.version} + 1`, updatedAt: new Date() })
        .where(eq(propertyComplianceItem.id, item.id));
    }
  }
  if (missing.length > 0) await tx.insert(propertyComplianceItem).values(missing).onConflictDoNothing();
}

/** Creates the item for one new (or restored) type on every property (§6.14); used by the item type API. */
export async function syncTypeOnAllProperties(tx: Tx, typeId: string, today: string = todayNy()): Promise<void> {
  const [type] = await tx.select().from(complianceItemType).where(and(eq(complianceItemType.id, typeId), isNull(complianceItemType.archivedAt)));
  if (!type) return;
  const props = await tx.select({ id: property.id, inNyc: property.inNyc }).from(property);
  if (props.length === 0) return;
  const unitRows = await tx.select({ propertyId: unit.propertyId, use: unit.use }).from(unit).where(and(inArray(unit.propertyId, props.map((p) => p.id)), isNull(unit.archivedAt)));
  const existing = new Set((await tx.select({ propertyId: propertyComplianceItem.propertyId }).from(propertyComplianceItem).where(eq(propertyComplianceItem.typeId, typeId))).map((r) => r.propertyId));
  const values = props
    .filter((p) => !existing.has(p.id))
    .map((p) => {
      const applicable = isTypeApplicable(type, p, unitRows.filter((u) => u.propertyId === p.id).map((u) => u.use));
      return { propertyId: p.id, typeId, applicable, nextDueDate: applicable ? initialDueDate(type, today) : null };
    });
  if (values.length > 0) await tx.insert(propertyComplianceItem).values(values).onConflictDoNothing();
}
