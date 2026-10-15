CREATE TYPE "public"."investment_category" AS ENUM('Renovation', 'Appliance', 'Repair', 'Other');--> statement-breakpoint
CREATE TABLE "investment_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_date" date NOT NULL,
	"property_id" uuid NOT NULL,
	"unit_id" uuid,
	"category" "investment_category" NOT NULL,
	"description" text NOT NULL,
	"vendor" text,
	"cost_cents" bigint NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "investment_entry" ADD CONSTRAINT "investment_entry_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_entry" ADD CONSTRAINT "investment_entry_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_entry" ADD CONSTRAINT "investment_entry_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_entry" ADD CONSTRAINT "investment_entry_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investment_entry_property_idx" ON "investment_entry" USING btree ("property_id","entry_date");--> statement-breakpoint
CREATE INDEX "investment_entry_unit_idx" ON "investment_entry" USING btree ("unit_id");