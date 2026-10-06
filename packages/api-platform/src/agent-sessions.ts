import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { getKV } from "@tailorkit/kv";
import { z } from "zod";

export const agentSessionLifetimeSeconds = 60 * 60;
const sessionSchema = z.object({
  projectId: z.string(),
  cliTokenId: z.string(),
  expiresAt: z.number(),
  runId: z.string().optional(),
});
export type AgentSession = z.infer<typeof sessionSchema>;

export function agentSessionStore() {
  const kv = getKV();
  if (!kv) {
    throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Agent sessions require KV storage." });
  }
  const key = (id: string) => `agent:session:${id}`;
  const endedKey = (id: string) => `agent:ended:${id}`;
  const lockKey = (id: string) => `agent:lock:${id}`;

  return {
    async create(projectId: string, cliTokenId: string) {
      const sessionId = randomUUID();
      const expiresAt = Date.now() + agentSessionLifetimeSeconds * 1000;
      await kv.set(key(sessionId), JSON.stringify({ projectId, cliTokenId, expiresAt }), {
        ttl: agentSessionLifetimeSeconds,
      });
      return { sessionId, expiresAt: new Date(expiresAt).toISOString() };
    },
    async get(id: string, projectId: string, cliTokenId: string): Promise<AgentSession> {
      const raw = await kv.get(key(id));
      const session = raw ? sessionSchema.parse(JSON.parse(raw)) : undefined;
      if (
        !session ||
        session.expiresAt <= Date.now() ||
        session.projectId !== projectId ||
        session.cliTokenId !== cliTokenId ||
        (await kv.get(endedKey(id)))
      ) {
        throw new ORPCError("NOT_FOUND", {
          message: "Agent session is unavailable. Start a new session.",
        });
      }
      return session;
    },
    async claim(id: string, owner: string) {
      if (
        !(await kv.claimUpload(lockKey(id), endedKey(id), null, owner, agentSessionLifetimeSeconds))
      ) {
        throw new ORPCError("CONFLICT", { message: "This agent session is busy or closed." });
      }
    },
    async save(id: string, session: AgentSession) {
      if (await kv.get(endedKey(id))) return false;
      await kv.set(key(id), JSON.stringify(session), {
        ttl: Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000)),
      });
      // A simultaneous close must not resurrect the session.
      if (await kv.get(endedKey(id))) {
        await kv.delete(key(id));
        return false;
      }
      return true;
    },
    async release(id: string) {
      await kv.delete(lockKey(id));
    },
    async end(id: string) {
      await kv.set(endedKey(id), "1", { ttl: agentSessionLifetimeSeconds });
      await kv.delete(key(id));
    },
  };
}
