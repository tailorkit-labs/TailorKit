import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-orm/zod";
import z from "zod";
import { app } from "./apps";
import { cliToken } from "./cli-auth";
import { project } from "./project";
import { type Scope, scopeValueSchema } from "./scope";

/** The durable lifecycle of a local-development preview. */
export const previewSessionStatus = pgEnum("preview_session_status", ["active", "ended"]);

export const previewSession = pgTable(
  "preview_session",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "cascade" }),
    /**
     * The host-authorized CLI credential that opened this session.
     *
     * `cli_token.scope_json` is issued by the host integration, so this is
     * intentionally not a foreign key to a TailorKit dashboard user.
     */
    cliTokenId: uuid("cli_token_id")
      .notNull()
      .references(() => cliToken.id, { onDelete: "restrict" }),
    /** A stable, host-defined authorization boundary (user, team, workspace, etc.). */
    scopeKey: text("scope_key").notNull(),
    scope: jsonb("scope_json").$type<Scope>().notNull(),
    /** Hash of the credential accepted by the tunnel WebSocket, never the raw credential. */
    tunnelTokenHash: text("tunnel_token_hash").notNull(),
    /** Public invitation identifier; separate from the CLI upload credential. */
    shareId: text("share_id").notNull().unique(),
    status: previewSessionStatus("status").default("active").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    endedAt: timestamp("ended_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("preview_session_project_id_status_idx").on(table.projectId, table.status),
    index("preview_session_cli_token_id_idx").on(table.cliTokenId),
    index("preview_session_tunnel_token_hash_idx").on(table.tunnelTokenHash),
    index("preview_session_app_id_scope_key_status_idx").on(
      table.appId,
      table.scopeKey,
      table.status,
    ),
    index("preview_session_expires_at_idx").on(table.expiresAt),
    uniqueIndex("preview_session_one_active_per_app_idx")
      .on(table.appId)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const PreviewSession = createSelectSchema(previewSession, {
  scopeKey: z.string().regex(/^[a-f0-9]{64}$/u),
  scope: scopeValueSchema,
});
export type PreviewSession = z.output<typeof PreviewSession>;
