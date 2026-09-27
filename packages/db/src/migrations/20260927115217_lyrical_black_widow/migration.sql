DROP INDEX "app_projectId_scopeId_idx";--> statement-breakpoint
DROP INDEX "cli_token_project_id_scope_id_idx";--> statement-breakpoint
DROP INDEX "preview_session_app_id_scope_id_status_idx";--> statement-breakpoint
ALTER TABLE "app" ADD COLUMN "scope_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "app" ADD COLUMN "scope_json" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cli_auth_session" ADD COLUMN "scope_key" text;--> statement-breakpoint
ALTER TABLE "cli_auth_session" ADD COLUMN "scope_json" jsonb;--> statement-breakpoint
ALTER TABLE "cli_token" ADD COLUMN "scope_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "cli_token" ADD COLUMN "scope_json" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "preview_session" ADD COLUMN "scope_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "preview_session" ADD COLUMN "scope_json" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app" DROP COLUMN "scope_id";--> statement-breakpoint
ALTER TABLE "cli_auth_session" DROP COLUMN "scope_id";--> statement-breakpoint
ALTER TABLE "cli_token" DROP COLUMN "scope_id";--> statement-breakpoint
ALTER TABLE "preview_session" DROP COLUMN "scope_id";--> statement-breakpoint
CREATE INDEX "app_project_scope_key_idx" ON "app" ("project_id","scope_key");--> statement-breakpoint
CREATE INDEX "cli_token_project_scope_key_idx" ON "cli_token" ("project_id","scope_key");--> statement-breakpoint
CREATE INDEX "preview_session_app_id_scope_key_status_idx" ON "preview_session" ("app_id","scope_key","status");