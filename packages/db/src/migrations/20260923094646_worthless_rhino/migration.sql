ALTER TABLE "preview_session" ADD COLUMN "share_id" text;--> statement-breakpoint
UPDATE "preview_session" SET "status" = 'ended', "ended_at" = now() WHERE "status" = 'active';--> statement-breakpoint
UPDATE "preview_session" SET "share_id" = replace(pg_catalog.gen_random_uuid()::text, '-', '') || replace(pg_catalog.gen_random_uuid()::text, '-', '');--> statement-breakpoint
ALTER TABLE "preview_session" ALTER COLUMN "share_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "preview_session" ADD CONSTRAINT "preview_session_share_id_key" UNIQUE("share_id");--> statement-breakpoint
CREATE UNIQUE INDEX "preview_session_one_active_per_app_idx" ON "preview_session" ("app_id") WHERE "status" = 'active';
