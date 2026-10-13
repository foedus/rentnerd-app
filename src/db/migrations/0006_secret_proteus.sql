CREATE TABLE "property" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"street" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"zip" text NOT NULL,
	"in_nyc" boolean DEFAULT true NOT NULL,
	"bbl" text,
	"year_built" integer,
	"owner_id" uuid NOT NULL,
	"purchase_price_cents" bigint,
	"purchase_date" date,
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
CREATE TABLE "property_responsible" (
	"property_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "property_responsible_property_id_user_id_pk" PRIMARY KEY("property_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_owner_id_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_responsible" ADD CONSTRAINT "property_responsible_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_responsible" ADD CONSTRAINT "property_responsible_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "property_active_name_idx" ON "property" USING btree (lower("name")) WHERE "property"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "property_owner_idx" ON "property" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "property_responsible_user_idx" ON "property_responsible" USING btree ("user_id");