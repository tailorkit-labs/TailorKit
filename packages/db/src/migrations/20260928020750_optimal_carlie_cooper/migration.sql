DROP INDEX "app_projectId_scopeId_idx";--> statement-breakpoint
DROP INDEX "cli_token_project_id_scope_id_idx";--> statement-breakpoint
DROP INDEX "preview_session_app_id_scope_id_status_idx";--> statement-breakpoint
ALTER TABLE "app" ADD COLUMN "scope_key" text;--> statement-breakpoint
ALTER TABLE "app" ADD COLUMN "scope_json" jsonb;--> statement-breakpoint
ALTER TABLE "cli_auth_session" ADD COLUMN "scope_key" text;--> statement-breakpoint
ALTER TABLE "cli_auth_session" ADD COLUMN "scope_json" jsonb;--> statement-breakpoint
ALTER TABLE "cli_token" ADD COLUMN "scope_key" text;--> statement-breakpoint
ALTER TABLE "cli_token" ADD COLUMN "scope_json" jsonb;--> statement-breakpoint
ALTER TABLE "preview_session" ADD COLUMN "scope_key" text;--> statement-breakpoint
ALTER TABLE "preview_session" ADD COLUMN "scope_json" jsonb;--> statement-breakpoint
-- Preserve old string identities as the new named `legacy` scope before removing `scope_id`.
UPDATE "app"
SET
  "scope_json" = jsonb_build_object('name', 'legacy', 'value', jsonb_build_object('scopeId', "scope_id")),
  "scope_key" = encode(substring(sha256(convert_to('scope:v2:' || '{"name":"legacy","value":{"scopeId":' || to_json("scope_id")::text || '}}', 'UTF8')) from 1 for 16), 'hex');--> statement-breakpoint
UPDATE "cli_auth_session"
SET
  "scope_json" = jsonb_build_object('name', 'legacy', 'value', jsonb_build_object('scopeId', "scope_id")),
  "scope_key" = encode(substring(sha256(convert_to('scope:v2:' || '{"name":"legacy","value":{"scopeId":' || to_json("scope_id")::text || '}}', 'UTF8')) from 1 for 16), 'hex')
WHERE "scope_id" IS NOT NULL;--> statement-breakpoint
UPDATE "cli_token"
SET
  "scope_json" = jsonb_build_object('name', 'legacy', 'value', jsonb_build_object('scopeId', "scope_id")),
  "scope_key" = encode(substring(sha256(convert_to('scope:v2:' || '{"name":"legacy","value":{"scopeId":' || to_json("scope_id")::text || '}}', 'UTF8')) from 1 for 16), 'hex');--> statement-breakpoint
UPDATE "preview_session"
SET
  "scope_json" = jsonb_build_object('name', 'legacy', 'value', jsonb_build_object('scopeId', "scope_id")),
  "scope_key" = encode(substring(sha256(convert_to('scope:v2:' || '{"name":"legacy","value":{"scopeId":' || to_json("scope_id")::text || '}}', 'UTF8')) from 1 for 16), 'hex');--> statement-breakpoint
ALTER TABLE "app" ALTER COLUMN "scope_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "app" ALTER COLUMN "scope_json" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cli_token" ALTER COLUMN "scope_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cli_token" ALTER COLUMN "scope_json" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "preview_session" ALTER COLUMN "scope_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "preview_session" ALTER COLUMN "scope_json" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "app" DROP COLUMN "scope_id";--> statement-breakpoint
ALTER TABLE "cli_auth_session" DROP COLUMN "scope_id";--> statement-breakpoint
ALTER TABLE "cli_token" DROP COLUMN "scope_id";--> statement-breakpoint
ALTER TABLE "preview_session" DROP COLUMN "scope_id";--> statement-breakpoint
CREATE INDEX "app_project_scope_key_idx" ON "app" ("project_id","scope_key");--> statement-breakpoint
CREATE INDEX "cli_auth_session_project_scope_key_idx" ON "cli_auth_session" ("project_id","scope_key");--> statement-breakpoint
CREATE INDEX "cli_token_project_scope_key_idx" ON "cli_token" ("project_id","scope_key");--> statement-breakpoint
CREATE INDEX "preview_session_app_id_scope_key_status_idx" ON "preview_session" ("app_id","scope_key","status");
