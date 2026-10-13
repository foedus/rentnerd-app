CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'delete', 'archive', 'restore', 'sign_in', 'sign_in_failed', 'sign_out', 'password_reset', 'password_changed', 'invite', 'invite_revoked', 'deactivate', 'reactivate', 'pdf_generate', 'pdf_download', 'pdf_delete', 'import', 'compliance_complete');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"action" "audit_action" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"summary" text NOT NULL,
	"changes" jsonb,
	"ip" text
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id");