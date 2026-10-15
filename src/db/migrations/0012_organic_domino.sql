CREATE TYPE "public"."compliance_applies_to" AS ENUM('All properties', 'Properties with residential units', 'Properties with commercial units');--> statement-breakpoint
CREATE TYPE "public"."compliance_schedule_type" AS ENUM('annual_date', 'interval', 'one_time');--> statement-breakpoint
CREATE TABLE "compliance_completion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"completed_on" date NOT NULL,
	"notes" text,
	"completed_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_item_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"applies_to" "compliance_applies_to" NOT NULL,
	"nyc_only" boolean DEFAULT false NOT NULL,
	"schedule_type" "compliance_schedule_type" NOT NULL,
	"due_month" integer,
	"due_day" integer,
	"interval_months" integer,
	"is_seeded" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_item_type_schedule_check" CHECK (("compliance_item_type"."schedule_type" = 'annual_date' and "compliance_item_type"."due_month" between 1 and 12 and "compliance_item_type"."due_day" between 1 and 31 and "compliance_item_type"."interval_months" is null)
      or ("compliance_item_type"."schedule_type" = 'interval' and "compliance_item_type"."interval_months" between 1 and 120 and "compliance_item_type"."due_month" is null and "compliance_item_type"."due_day" is null)
      or ("compliance_item_type"."schedule_type" = 'one_time' and "compliance_item_type"."due_month" is null and "compliance_item_type"."due_day" is null and "compliance_item_type"."interval_months" is null))
);
--> statement-breakpoint
CREATE TABLE "property_compliance_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"applicable" boolean NOT NULL,
	"applicable_set_by_user" boolean DEFAULT false NOT NULL,
	"next_due_date" date,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_compliance_item_pair_idx" UNIQUE("property_id","type_id")
);
--> statement-breakpoint
ALTER TABLE "compliance_completion" ADD CONSTRAINT "compliance_completion_item_id_property_compliance_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."property_compliance_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_completion" ADD CONSTRAINT "compliance_completion_completed_by_id_user_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_item_type" ADD CONSTRAINT "compliance_item_type_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_item_type" ADD CONSTRAINT "compliance_item_type_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_compliance_item" ADD CONSTRAINT "property_compliance_item_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_compliance_item" ADD CONSTRAINT "property_compliance_item_type_id_compliance_item_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."compliance_item_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compliance_completion_item_idx" ON "compliance_completion" USING btree ("item_id","completed_on");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_item_type_name_idx" ON "compliance_item_type" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "property_compliance_item_type_idx" ON "property_compliance_item" USING btree ("type_id");