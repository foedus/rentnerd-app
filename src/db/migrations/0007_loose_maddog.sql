CREATE TYPE "public"."unit_use" AS ENUM('Residential', 'Commercial');--> statement-breakpoint
CREATE TABLE "unit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"label" text NOT NULL,
	"use" "unit_use" NOT NULL,
	"bedrooms" integer,
	"bathrooms" numeric(3, 1),
	"square_feet" integer,
	"owner_override_id" uuid,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"archive_batch_id" uuid,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_owner_override_id_owner_id_fk" FOREIGN KEY ("owner_override_id") REFERENCES "public"."owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unit_active_label_idx" ON "unit" USING btree ("property_id",lower("label")) WHERE "unit"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "unit_owner_override_idx" ON "unit" USING btree ("owner_override_id");