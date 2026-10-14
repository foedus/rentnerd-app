import { sql } from "drizzle-orm";
import { bigint, boolean, date, index, integer, jsonb, numeric, pgEnum, primaryKey, uniqueIndex, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
