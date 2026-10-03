CREATE TYPE "preview_session_status" AS ENUM('active', 'ended');--> statement-breakpoint
CREATE TABLE "preview_session" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"cli_token_id" uuid NOT NULL,
	"scope_id" text NOT NULL,
	"tunnel_token_hash" text NOT NULL,
	"status" "preview_session_status" DEFAULT 'active'::"preview_session_status" NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "preview_session_project_id_status_idx" ON "preview_session" ("project_id","status");--> statement-breakpoint
CREATE INDEX "preview_session_cli_token_id_idx" ON "preview_session" ("cli_token_id");--> statement-breakpoint
CREATE INDEX "preview_session_tunnel_token_hash_idx" ON "preview_session" ("tunnel_token_hash");--> statement-breakpoint
CREATE INDEX "preview_session_app_id_scope_id_status_idx" ON "preview_session" ("app_id","scope_id","status");--> statement-breakpoint
CREATE INDEX "preview_session_expires_at_idx" ON "preview_session" ("expires_at");--> statement-breakpoint
ALTER TABLE "preview_session" ADD CONSTRAINT "preview_session_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "preview_session" ADD CONSTRAINT "preview_session_app_id_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "app"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "preview_session" ADD CONSTRAINT "preview_session_cli_token_id_cli_token_id_fkey" FOREIGN KEY ("cli_token_id") REFERENCES "cli_token"("id") ON DELETE RESTRICT;