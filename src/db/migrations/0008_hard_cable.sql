CREATE TYPE "public"."property_value_kind" AS ENUM('market_estimate', 'assessed');--> statement-breakpoint
CREATE TABLE "property_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"value_date" date NOT NULL,
	"kind" "property_value_kind" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"source" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "property_value" ADD CONSTRAINT "property_value_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_value" ADD CONSTRAINT "property_value_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_value" ADD CONSTRAINT "property_value_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "property_value_property_idx" ON "property_value" USING btree ("property_id","value_date");