import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { project } from "./project";

// Eve owns the conversation. This record only binds its opaque session ID to
// the host-approved project scope that may send and read its events.
export const agentSession = pgTable(
  "agent_session",
  {
    id: text("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    scopeKey: text("scope_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("agent_session_project_scope_idx").on(table.projectId, table.scopeKey)],
);
