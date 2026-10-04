CREATE TABLE "agent_session" (
	"id" text PRIMARY KEY,
	"project_id" uuid NOT NULL,
	"scope_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_session_project_scope_idx" ON "agent_session" ("project_id","scope_key");--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;