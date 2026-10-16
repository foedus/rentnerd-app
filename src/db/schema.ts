import { sql } from "drizzle-orm";
import { bigint, boolean, check, customType, date, index, integer, jsonb, numeric, pgEnum, primaryKey, unique, uniqueIndex, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["admin", "landlord", "smoke"]);
export const emailStatus = pgEnum("email_status", ["queued", "sent", "failed"]);
export const userStatus = pgEnum("user_status", ["invited", "active", "deactivated"]);

// Better Auth's `user` table, extended (SPEC §6.1). Its other tables are used unchanged.
export const user = pgTable(
  "user",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: userRole("role").notNull().default("landlord"),
  status: userStatus("status").notNull().default("invited"),
  lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Exactly one admin and at most one smoke user (SPEC §6.1).
  (t) => [
    uniqueIndex("user_single_admin_idx").on(t.role).where(sql`${t.role} = 'admin'`),
    uniqueIndex("user_single_smoke_idx").on(t.role).where(sql`${t.role} = 'smoke'`),
  ],
);

export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// Test environments only (D-25, SPEC §6.16): a single row holding the app clock offset.
export const testClock = pgTable("test_clock", {
  id: integer("id").primaryKey().default(1),
  offsetMs: bigint("offset_ms", { mode: "number" }).notNull().default(0),
});

// SPEC §6: one row per email message; the email.send job updates it (D-28).
export const emailLog = pgTable(
  "email_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    to: text("to").notNull(),
    template: text("template").notNull(),
    subject: text("subject").notNull(),
    status: emailStatus("status").notNull().default("queued"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_log_status_idx").on(t.status)],
);

// Test environments only (D-25): named one-shot switches shared by the web and worker processes.
export const testFlag = pgTable("test_flag", {
  name: text("name").primaryKey(),
});

// SPEC §6.2: single-use invitation links (SHA-256 of the token is stored, never the token).
export const invitation = pgTable(
  "invitation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    invitedById: uuid("invited_by_id").references(() => user.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // At most one unaccepted, unrevoked invitation per user.
    uniqueIndex("invitation_one_live_idx")
      .on(t.userId)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
  ],
);

export const auditAction = pgEnum("audit_action", [
  "create", "update", "delete", "archive", "restore", "sign_in", "sign_in_failed", "sign_out", "password_reset",
  "password_changed", "invite", "invite_revoked", "deactivate", "reactivate", "pdf_generate", "pdf_download",
  "pdf_delete", "import", "compliance_complete",
]);

// SPEC §6.16, D-27: written in the same transaction as each change; never edited or deleted (`ip` is cleared after 2 years).
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    action: auditAction("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    changes: jsonb("changes").$type<Record<string, [string | null, string | null]>>(),
    ip: text("ip"),
  },
  (t) => [index("audit_log_at_idx").on(t.at), index("audit_log_actor_idx").on(t.actorUserId)],
);

export const ownerType = pgEnum("owner_type", ["LLC", "Corporation", "Partnership", "Trust", "Individual", "Other"]);

// SPEC §6.3: archivable; `version` is the optimistic-lock counter (D-10).
export const owner = pgTable(
  "owner",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    ownerType: ownerType("owner_type").notNull(),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    zip: text("zip").notNull(),
    email: text("email"),
    phone: text("phone"),
    signatoryName: text("signatory_name"),
    signatoryTitle: text("signatory_title"),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => user.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("owner_name_idx").on(t.name)],
);

// SPEC §6.4: archivable; `version` is the optimistic-lock counter (D-10). The unique name applies to non-archived rows only.
export const property = pgTable(
  "property",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    street: text("street").notNull(),
    city: text("city").notNull(),
    state: text("state").notNull(),
    zip: text("zip").notNull(),
    inNyc: boolean("in_nyc").notNull().default(true),
    bbl: text("bbl"),
    yearBuilt: integer("year_built"),
    ownerId: uuid("owner_id").notNull().references(() => owner.id),
    purchasePriceCents: bigint("purchase_price_cents", { mode: "number" }),
    purchaseDate: date("purchase_date", { mode: "string" }),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archiveBatchId: uuid("archive_batch_id"),
    createdById: uuid("created_by_id").references(() => user.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("property_active_name_idx").on(sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
    index("property_owner_idx").on(t.ownerId),
  ],
);

export const propertyResponsible = pgTable(
  "property_responsible",
  {
    propertyId: uuid("property_id").notNull().references(() => property.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => user.id),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.userId] }), index("property_responsible_user_idx").on(t.userId)],
);

export const unitUse = pgEnum("unit_use", ["Residential", "Commercial"]);

// SPEC §6.7: archivable; `use` never changes after creation. The unique label applies to non-archived rows of one property.
export const unit = pgTable(
  "unit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => property.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    use: unitUse("use").notNull(),
    bedrooms: integer("bedrooms"),
    bathrooms: numeric("bathrooms", { precision: 3, scale: 1 }),
    squareFeet: integer("square_feet"),
    ownerOverrideId: uuid("owner_override_id").references(() => owner.id),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archiveBatchId: uuid("archive_batch_id"),
    createdById: uuid("created_by_id").references(() => user.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("unit_active_label_idx").on(t.propertyId, sql`lower(${t.label})`).where(sql`${t.archivedAt} is null`),
    index("unit_owner_override_idx").on(t.ownerOverrideId),
  ],
);

export const propertyValueKind = pgEnum("property_value_kind", ["market_estimate", "assessed"]);

// SPEC §6.5: value history, hard-deleted. Only market estimates feed the current value (D-15).
export const propertyValue = pgTable(
  "property_value",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => property.id, { onDelete: "cascade" }),
    valueDate: date("value_date", { mode: "string" }).notNull(),
    kind: propertyValueKind("kind").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    source: text("source"),
    version: integer("version").notNull().default(1),
    createdById: uuid("created_by_id").references(() => user.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("property_value_property_idx").on(t.propertyId, t.valueDate)],
);

// SPEC §6.15: renovation/appliance/repair log, hard-deleted. Restrict FKs: a property or unit with entries can only be archived (D-09).
export const investmentCategory = pgEnum("investment_category", ["Renovation", "Appliance", "Repair", "Other"]);
export const investmentEntry = pgTable(
  "investment_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    propertyId: uuid("property_id").notNull().references(() => property.id, { onDelete: "restrict" }),
    unitId: uuid("unit_id").references(() => unit.id, { onDelete: "restrict" }),
    category: investmentCategory("category").notNull(),
    description: text("description").notNull(),
    vendor: text("vendor"),
    costCents: bigint("cost_cents", { mode: "number" }).notNull(),
    version: integer("version").notNull().default(1),
    createdById: uuid("created_by_id").references(() => user.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("investment_entry_property_idx").on(t.propertyId, t.entryDate), index("investment_entry_unit_idx").on(t.unitId)],
);

// SPEC §6.6: annual property tax per tax year, unique per property, hard-deleted.
export const propertyTax = pgTable(
  "property_tax",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => property.id, { onDelete: "cascade" }),
    taxYear: integer("tax_year").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    version: integer("version").notNull().default(1),
    createdById: uuid("created_by_id").references(() => user.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("property_tax_property_year_unique").on(t.propertyId, t.taxYear)],
);

export const tenantType = pgEnum("tenant_type", ["Individual", "Business"]);

// SPEC §6.8: archivable; `version` is the optimistic-lock counter (D-10). Name columns that don't apply to the type are null.
export const tenant = pgTable(
  "tenant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantType: tenantType("tenant_type").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    businessName: text("business_name"),
    contactPerson: text("contact_person"),
    email: text("email"),
    phone: text("phone"),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => user.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tenant_last_name_idx").on(t.lastName)],
);

export const increaseType = pgEnum("increase_type", ["none", "percent", "schedule"]);
export const leaseEndReason = pgEnum("lease_end_reason", [
  "Tenant moved out",
  "Not renewed",
  "Terminated",
  "Tenant broke lease",
  "Replaced by new lease",
  "Other",
]);

// SPEC §6.9: archivable only together with its unit or property (archiveBatchId); `version` is the lease-wide
// optimistic-lock counter (D-10) and equals the latest LeaseRevision number (D-31). Tenants, rent steps and
// extensions share it. Tax fields are Commercial only and `childrenReside` Residential only (checked by the API).
export const lease = pgTable(
  "lease",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitId: uuid("unit_id").notNull().references(() => unit.id),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    baseRentCents: bigint("base_rent_cents", { mode: "number" }).notNull(),
    increaseType: increaseType("increase_type").notNull().default("none"),
    increasePercent: numeric("increase_percent", { precision: 7, scale: 4 }),
    securityDepositCents: bigint("security_deposit_cents", { mode: "number" }),
    rentDueDay: integer("rent_due_day").notNull().default(1),
    lateFeeCents: bigint("late_fee_cents", { mode: "number" }),
    lateFeeGraceDays: integer("late_fee_grace_days"),
    pets: text("pets"),
    parking: text("parking"),
    parkingChargeCents: bigint("parking_charge_cents", { mode: "number" }),
    childrenReside: boolean("children_reside"),
    breakClause: text("break_clause"),
    otherTerms: text("other_terms"),
    baseTaxYear: integer("base_tax_year"),
    taxSharePercent: numeric("tax_share_percent", { precision: 7, scale: 4 }),
    monthToMonth: boolean("month_to_month").notNull().default(false),
    monthToMonthRentCents: bigint("month_to_month_rent_cents", { mode: "number" }),
    moveOutDate: date("move_out_date", { mode: "string" }),
    endReason: leaseEndReason("end_reason"),
    version: integer("version").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archiveBatchId: uuid("archive_batch_id"),
    createdById: uuid("created_by_id").references(() => user.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("lease_unit_idx").on(t.unitId, t.startDate),
    check("lease_dates_check", sql`${t.endDate} > ${t.startDate}`),
    check("lease_rent_check", sql`${t.baseRentCents} > 0`),
    check("lease_due_day_check", sql`${t.rentDueDay} between 1 and 28`),
    check("lease_end_reason_check", sql`(${t.moveOutDate} is null) = (${t.endReason} is null)`),
  ],
);

// §6.9 LeaseTenant: at least one tenant per lease and exactly one primary (the second is enforced here, the first by the API).
export const leaseTenant = pgTable(
  "lease_tenant",
  {
    leaseId: uuid("lease_id").notNull().references(() => lease.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.leaseId, t.tenantId] }),
    index("lease_tenant_tenant_idx").on(t.tenantId),
    uniqueIndex("lease_tenant_one_primary_idx").on(t.leaseId).where(sql`${t.isPrimary}`),
  ],
);

// SPEC §6.10: a full copy of the terms; only the latest extension is editable (API rule).
export const leaseExtension = pgTable(
  "lease_extension",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leaseId: uuid("lease_id").notNull().references(() => lease.id, { onDelete: "cascade" }),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    baseRentCents: bigint("base_rent_cents", { mode: "number" }).notNull(),
    increaseType: increaseType("increase_type").notNull().default("none"),
    increasePercent: numeric("increase_percent", { precision: 7, scale: 4 }),
    securityDepositCents: bigint("security_deposit_cents", { mode: "number" }),
    rentDueDay: integer("rent_due_day").notNull().default(1),
    lateFeeCents: bigint("late_fee_cents", { mode: "number" }),
    lateFeeGraceDays: integer("late_fee_grace_days"),
    pets: text("pets"),
    parking: text("parking"),
    parkingChargeCents: bigint("parking_charge_cents", { mode: "number" }),
    childrenReside: boolean("children_reside"),
    breakClause: text("break_clause"),
    otherTerms: text("other_terms"),
    baseTaxYear: integer("base_tax_year"),
    taxSharePercent: numeric("tax_share_percent", { precision: 7, scale: 4 }),
    notes: text("notes"),
    createdById: uuid("created_by_id").references(() => user.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("lease_extension_lease_idx").on(t.leaseId, t.startDate),
    check("lease_extension_dates_check", sql`${t.endDate} > ${t.startDate}`),
    check("lease_extension_rent_check", sql`${t.baseRentCents} > 0`),
    check("lease_extension_due_day_check", sql`${t.rentDueDay} between 1 and 28`),
  ],
);

export const extensionTenant = pgTable(
  "extension_tenant",
  {
    extensionId: uuid("extension_id").notNull().references(() => leaseExtension.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.extensionId, t.tenantId] }),
    index("extension_tenant_tenant_idx").on(t.tenantId),
    uniqueIndex("extension_tenant_one_primary_idx").on(t.extensionId).where(sql`${t.isPrimary}`),
  ],
);

// §6.9 RentStep: belongs to exactly one of a lease or an extension; dates strictly increase within a term (API rule).
export const rentStep = pgTable(
  "rent_step",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leaseId: uuid("lease_id").references(() => lease.id, { onDelete: "cascade" }),
    extensionId: uuid("extension_id").references(() => leaseExtension.id, { onDelete: "cascade" }),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  },
  (t) => [
    index("rent_step_lease_idx").on(t.leaseId, t.effectiveDate),
    index("rent_step_extension_idx").on(t.extensionId, t.effectiveDate),
    check("rent_step_owner_check", sql`(${t.leaseId} is null) <> (${t.extensionId} is null)`),
    check("rent_step_amount_check", sql`${t.amountCents} > 0`),
  ],
);

// SPEC §6.9 / D-31: read-only snapshot of every saved lease version; deleted only with the lease.
export const leaseRevision = pgTable(
  "lease_revision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leaseId: uuid("lease_id").notNull().references(() => lease.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    changedById: uuid("changed_by_id").references(() => user.id, { onDelete: "set null" }),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
    summary: text("summary").notNull(),
  },
  (t) => [unique("lease_revision_lease_version_unique").on(t.leaseId, t.versionNumber)],
);

export const complianceAppliesTo = pgEnum("compliance_applies_to", ["All properties", "Properties with residential units", "Properties with commercial units"]);
export const complianceScheduleType = pgEnum("compliance_schedule_type", ["annual_date", "interval", "one_time"]);

// SPEC §6.13: archivable; the unique name applies to every type, archived or not.
export const complianceItemType = pgTable(
  "compliance_item_type",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    appliesTo: complianceAppliesTo("applies_to").notNull(),
    nycOnly: boolean("nyc_only").notNull().default(false),
    scheduleType: complianceScheduleType("schedule_type").notNull(),
    dueMonth: integer("due_month"),
    dueDay: integer("due_day"),
    intervalMonths: integer("interval_months"),
    isSeeded: boolean("is_seeded").notNull().default(false),
    version: integer("version").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => user.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("compliance_item_type_name_idx").on(sql`lower(${t.name})`),
    check("compliance_item_type_schedule_check", sql`(${t.scheduleType} = 'annual_date' and ${t.dueMonth} between 1 and 12 and ${t.dueDay} between 1 and 31 and ${t.intervalMonths} is null)
      or (${t.scheduleType} = 'interval' and ${t.intervalMonths} between 1 and 120 and ${t.dueMonth} is null and ${t.dueDay} is null)
      or (${t.scheduleType} = 'one_time' and ${t.dueMonth} is null and ${t.dueDay} is null and ${t.intervalMonths} is null)`),
  ],
);

// SPEC §6.14: one row per property × type. Removed with the property (cascade) or, by the app, with a completion-free type.
export const propertyComplianceItem = pgTable(
  "property_compliance_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => property.id, { onDelete: "cascade" }),
    typeId: uuid("type_id").notNull().references(() => complianceItemType.id),
    applicable: boolean("applicable").notNull(),
    applicableSetByUser: boolean("applicable_set_by_user").notNull().default(false),
    nextDueDate: date("next_due_date", { mode: "string" }),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("property_compliance_item_pair_idx").on(t.propertyId, t.typeId), index("property_compliance_item_type_idx").on(t.typeId)],
);

export const complianceCompletion = pgTable(
  "compliance_completion",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id").notNull().references(() => propertyComplianceItem.id, { onDelete: "cascade" }),
    completedOn: date("completed_on", { mode: "string" }).notNull(),
    notes: text("notes"),
    completedById: uuid("completed_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("compliance_completion_item_idx").on(t.itemId, t.completedOn)],
);

// SPEC §6.11: lease and extension templates stored as TipTap JSON. Names are unique among non-archived templates.
export const templateKind = pgEnum("template_kind", ["master_lease", "extension"]);
export const template = pgTable(
  "template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: templateKind("kind").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    version: integer("version").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => user.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("template_active_name_idx").on(sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`)],
);

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

// SPEC §6.17, D-22: an uploaded import file and its check result. The file is cleared at commit or after 24 hours.
export const importRunStatus = pgEnum("import_run_status", ["validated", "committed", "failed", "expired"]);
export const importRun = pgTable("import_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  uploadedById: uuid("uploaded_by_id").references(() => user.id, { onDelete: "set null" }),
  fileName: text("file_name").notNull(),
  file: bytea("file"),
  status: importRunStatus("status").notNull(),
  counts: jsonb("counts").$type<Record<string, number>>().notNull(),
  errors: jsonb("errors").$type<{ sheet: string; row: number | null; column: string | null; problem: string }[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
