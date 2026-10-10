import { AppError } from "../errors";
import type { Session } from "./session";
export interface ToolBridge {
  client(path: string, input: unknown): Promise<unknown>;
  session(path: string): Promise<Session>;
}
export interface TailorKitServerTools {}
/** Generated callers delegate only transport; host/server declarations validate both directions. */
export function callTool(
  kind: "client" | "server",
  path: string,
  input?: unknown,
): Promise<unknown> {
  const bridge = (globalThis as typeof globalThis & { __tailorkitTools?: ToolBridge })
    .__tailorkitTools;
  if (!bridge) return Promise.reject(new AppError("UNAVAILABLE", "Tool bridge unavailable"));
  if (kind === "client") return bridge.client(path, input);
  return bridge.session(path).then((session) => executeServerTool(session, path, input));
}
export async function executeServerTool(
  session: Session,
  path: string,
  input: unknown,
  request: typeof fetch = globalThis.fetch,
  signal?: AbortSignal,
) {
  const response = await request(session.url, {
    method: "POST",
    redirect: "error",
    credentials: "omit",
    signal,
    headers: { authorization: `Bearer ${session.token}`, "content-type": "application/json" },
    body: JSON.stringify({ path, input, requestId: crypto.randomUUID() }),
  });
  if (!response.ok)
    throw new AppError(
      response.status === 401
        ? "UNAUTHORIZED"
        : response.status === 400
          ? "BAD_REQUEST"
          : "UNAVAILABLE",
      "Tool call failed",
    );
  return ((await response.json()) as { output?: unknown }).output;
}
