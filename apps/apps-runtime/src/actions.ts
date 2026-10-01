import { WorkerEntrypoint } from "cloudflare:workers";
import type { Identity } from "@tailorkit/apps-server";
import type { Invocation } from "@tailorkit/apps-server/runtime";
import { StorageError } from "@tailorkit/app-storage";

/** Per-invocation capabilities are revoked on completion, cancellation or expiry. */
export class ActionLeases {
  #active = new Map<
    string,
    { identity: Identity; deadline: number; signal: AbortSignal; calls: number }
  >();
  open(identity: Identity, parent?: AbortSignal) {
    if (this.#active.size >= 16)
      throw new StorageError("UNAVAILABLE", "Installation action limit exceeded");
    const deadline = Math.min(identity.expiresAt, Date.now() + 30_000);
    if (deadline <= Date.now()) throw new StorageError("UNAUTHORIZED", "App token expired");
    const id = crypto.randomUUID();
    const controller = new AbortController();
    const cancel = () => controller.abort(new StorageError("UNAVAILABLE", "Action cancelled"));
    parent?.addEventListener("abort", cancel, { once: true });
    if (parent?.aborted) cancel();
    const timer = setTimeout(
      () => controller.abort(new StorageError("UNAVAILABLE", "Action deadline exceeded")),
      deadline - Date.now(),
    );
    this.#active.set(id, { identity, deadline, signal: controller.signal, calls: 0 });
    return {
      id,
      signal: controller.signal,
      close: () => {
        this.#active.delete(id);
        clearTimeout(timer);
        parent?.removeEventListener("abort", cancel);
        cancel();
      },
    };
  }
  access(id: string, count = true) {
    const lease = this.#active.get(id);
    if (!lease || lease.signal.aborted || lease.deadline <= Date.now())
      throw new StorageError("UNAVAILABLE", "Action has ended");
    if (count && ++lease.calls > 64)
      throw new StorageError("BAD_REQUEST", "Action call limit exceeded");
    return lease;
  }
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

/** HTTPS Internet access only; validate every redirect rather than forwarding it implicitly. */
export function actionDestination(url: URL) {
  const host = url.hostname.toLowerCase();
  const octets = /^\d+\.\d+\.\d+\.\d+$/u.test(host) ? host.split(".").map(Number) : undefined;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (!host.includes(".") && !host.startsWith("[")) ||
    /(^|\.)(localhost|local|internal)$/u.test(host) ||
    (host.startsWith("[") && !/^\[[23][a-f\d]{3}:/u.test(host)) ||
    (octets &&
      (octets[0] === 0 ||
        octets[0] === 10 ||
        octets[0] === 127 ||
        octets[0]! >= 224 ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
        (octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127)))
  )
    throw new StorageError("FORBIDDEN", "Action destination must be a public HTTPS endpoint");
}

/** Only the trusted supervisor creates this binding. Apps cannot choose its installation or lease. */
export class ActionBridge extends WorkerEntrypoint<
  Env,
  { installationName: string; actionId: string }
> {
  #store() {
    return this.env.STORES.getByName(this.ctx.props.installationName);
  }
  runQuery(input: Invocation) {
    return this.#store().actionCall(this.ctx.props.actionId, "query", input);
  }
  runMutation(input: Invocation & { requestId: string }) {
    return this.#store().actionCall(this.ctx.props.actionId, "mutation", input);
  }
  async fetch(request: Request): Promise<Response> {
    let next = new Request(request, { redirect: "manual" });
    for (let redirect = 0; redirect <= 4; redirect++) {
      actionDestination(new URL(next.url));
      const deadline = await this.#store().actionAccess(this.ctx.props.actionId);
      const backup = next.clone();
      const response = await fetch(next, {
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.has("location"))
        return response;
      await response.body?.cancel();
      const url = new URL(response.headers.get("location")!, next.url);
      const headers = new Headers(backup.headers);
      if (url.origin !== new URL(next.url).origin) {
        headers.delete("authorization");
        headers.delete("cookie");
      }
      const get =
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && backup.method === "POST");
      if (get) {
        headers.delete("content-type");
        headers.delete("content-length");
      }
      next = new Request(url, {
        method: get ? "GET" : backup.method,
        headers,
        body: get || ["GET", "HEAD"].includes(backup.method) ? undefined : backup.body,
        redirect: "manual",
      });
    }
    throw new StorageError("BAD_REQUEST", "Too many action redirects");
  }
}
