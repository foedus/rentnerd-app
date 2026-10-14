CREATE TYPE "public"."increase_type" AS ENUM('none', 'percent', 'schedule');--> statement-breakpoint
CREATE TYPE "public"."lease_end_reason" AS ENUM('Tenant moved out', 'Not renewed', 'Terminated', 'Tenant broke lease', 'Replaced by new lease', 'Other');--> statement-breakpoint
CREATE TABLE "extension_tenant" (
	"extension_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "extension_tenant_extension_id_tenant_id_pk" PRIMARY KEY("extension_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "lease" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"base_rent_cents" bigint NOT NULL,
	"increase_type" "increase_type" DEFAULT 'none' NOT NULL,
	"increase_percent" numeric(7, 4),
	"security_deposit_cents" bigint,
	"rent_due_day" integer DEFAULT 1 NOT NULL,
	"late_fee_cents" bigint,
	"late_fee_grace_days" integer,
	"pets" text,
	"parking" text,
	"parking_charge_cents" bigint,
	"children_reside" boolean,
	"break_clause" text,
	"other_terms" text,
	"base_tax_year" integer,
	"tax_share_percent" numeric(7, 4),
	"month_to_month" boolean DEFAULT false NOT NULL,
	"month_to_month_rent_cents" bigint,
	"move_out_date" date,
	"end_reason" "lease_end_reason",
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"archive_batch_id" uuid,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lease_dates_check" CHECK ("lease"."end_date" > "lease"."start_date"),
	CONSTRAINT "lease_rent_check" CHECK ("lease"."base_rent_cents" > 0),
	CONSTRAINT "lease_due_day_check" CHECK ("lease"."rent_due_day" between 1 and 28),
	CONSTRAINT "lease_end_reason_check" CHECK (("lease"."move_out_date" is null) = ("lease"."end_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "lease_extension" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lease_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"base_rent_cents" bigint NOT NULL,
	"increase_type" "increase_type" DEFAULT 'none' NOT NULL,
	"increase_percent" numeric(7, 4),
	"security_deposit_cents" bigint,
	"rent_due_day" integer DEFAULT 1 NOT NULL,
	"late_fee_cents" bigint,
	"late_fee_grace_days" integer,
	"pets" text,
	"parking" text,
	"parking_charge_cents" bigint,
	"children_reside" boolean,
	"break_clause" text,
	"other_terms" text,
	"base_tax_year" integer,
	"tax_share_percent" numeric(7, 4),
	"notes" text,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lease_extension_dates_check" CHECK ("lease_extension"."end_date" > "lease_extension"."start_date"),
	CONSTRAINT "lease_extension_rent_check" CHECK ("lease_extension"."base_rent_cents" > 0),
	CONSTRAINT "lease_extension_due_day_check" CHECK ("lease_extension"."rent_due_day" between 1 and 28)
);
--> statement-breakpoint
CREATE TABLE "lease_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lease_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changed_by_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" text NOT NULL,
	CONSTRAINT "lease_revision_lease_version_unique" UNIQUE("lease_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "lease_tenant" (
	"lease_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "lease_tenant_lease_id_tenant_id_pk" PRIMARY KEY("lease_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "rent_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lease_id" uuid,
	"extension_id" uuid,
	"effective_date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	CONSTRAINT "rent_step_owner_check" CHECK (("rent_step"."lease_id" is null) <> ("rent_step"."extension_id" is null)),
	CONSTRAINT "rent_step_amount_check" CHECK ("rent_step"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "extension_tenant" ADD CONSTRAINT "extension_tenant_extension_id_lease_extension_id_fk" FOREIGN KEY ("extension_id") REFERENCES "public"."lease_extension"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_tenant" ADD CONSTRAINT "extension_tenant_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease" ADD CONSTRAINT "lease_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease" ADD CONSTRAINT "lease_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease" ADD CONSTRAINT "lease_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_extension" ADD CONSTRAINT "lease_extension_lease_id_lease_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."lease"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_extension" ADD CONSTRAINT "lease_extension_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_extension" ADD CONSTRAINT "lease_extension_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_revision" ADD CONSTRAINT "lease_revision_lease_id_lease_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."lease"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_revision" ADD CONSTRAINT "lease_revision_changed_by_id_user_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_tenant" ADD CONSTRAINT "lease_tenant_lease_id_lease_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."lease"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_tenant" ADD CONSTRAINT "lease_tenant_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_step" ADD CONSTRAINT "rent_step_lease_id_lease_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."lease"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_step" ADD CONSTRAINT "rent_step_extension_id_lease_extension_id_fk" FOREIGN KEY ("extension_id") REFERENCES "public"."lease_extension"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extension_tenant_tenant_idx" ON "extension_tenant" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "extension_tenant_one_primary_idx" ON "extension_tenant" USING btree ("extension_id") WHERE "extension_tenant"."is_primary";--> statement-breakpoint
CREATE INDEX "lease_unit_idx" ON "lease" USING btree ("unit_id","start_date");--> statement-breakpoint
CREATE INDEX "lease_extension_lease_idx" ON "lease_extension" USING btree ("lease_id","start_date");--> statement-breakpoint
CREATE INDEX "lease_tenant_tenant_idx" ON "lease_tenant" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lease_tenant_one_primary_idx" ON "lease_tenant" USING btree ("lease_id") WHERE "lease_tenant"."is_primary";--> statement-breakpoint
CREATE INDEX "rent_step_lease_idx" ON "rent_step" USING btree ("lease_id","effective_date");--> statement-breakpoint
CREATE INDEX "rent_step_extension_idx" ON "rent_step" USING btree ("extension_id","effective_date");