CREATE TYPE "public"."import_run_status" AS ENUM('validated', 'committed', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "import_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploaded_by_id" uuid,
	"file_name" text NOT NULL,
	"file" "bytea",
	"status" "import_run_status" NOT NULL,
	"counts" jsonb NOT NULL,
	"errors" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_uploaded_by_id_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;