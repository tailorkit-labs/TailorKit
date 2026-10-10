import { RpcTarget } from "cloudflare:workers";
import { AppError } from "@tailorkit/app/server";

/** Tracks active actions only for cancellation and token expiry. */
export function createActionLeases() {
  const active = new Set<AbortController>();
  return {
    open(identity: { expiresAt: number }, parent?: AbortSignal) {
      const deadline = identity.expiresAt;
      if (deadline <= Date.now()) {
        throw new AppError("UNAUTHORIZED", "App token expired");
      }
      const controller = new AbortController();
      const cancel = () => controller.abort(new AppError("UNAVAILABLE", "Action cancelled"));
      const timer = setTimeout(cancel, deadline - Date.now());
      const signal = parent ? AbortSignal.any([controller.signal, parent]) : controller.signal;
      active.add(controller);
      return {
        deadline,
        signal,
        close: () => {
          clearTimeout(timer);
          active.delete(controller);
          cancel();
        },
      };
    },
    closeAll() {
      for (const controller of active) {
        controller.abort(new AppError("UNAVAILABLE", "App deployment changed"));
      }
    },
  };
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
    (octets && privateIPv4(octets))
  ) {
    throw new AppError("FORBIDDEN", "Action destination must be a public HTTPS endpoint");
  }
}

function privateIPv4([first = 0, second = 0]: number[]) {
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 169 && second === 254) ||
    (first === 192 && second === 168) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}

/** Trusted outbound fetch and committed-write notification; database calls stay in the facet. */
export class ActionCapability extends RpcTarget {
  private lease: { signal: AbortSignal; deadline: number };
  private appSession: { url: string; token: string } | undefined;
  private notify: (tables: string[]) => Promise<void>;
  constructor(
    lease: { signal: AbortSignal; deadline: number },
    notify: (tables: string[]) => Promise<void>,
    appSession?: { url: string; token: string },
  ) {
    super();
    this.lease = lease;
    this.notify = notify;
    this.appSession = appSession;
  }

  async tool(path: string, input: unknown): Promise<unknown> {
    const credential = this.appSession;
    if (!credential || this.lease.signal.aborted || this.lease.deadline <= Date.now())
      throw new AppError("UNAVAILABLE", "Action has ended");
    if (!/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*$/u.test(path) || path.length > 512)
      throw new AppError("BAD_REQUEST", "Invalid tool path");
    actionDestination(new URL(credential.url));
    const response = await fetch(credential.url, {
      method: "POST",
      redirect: "manual",
      signal: this.lease.signal,
      headers: { authorization: `Bearer ${credential.token}`, "content-type": "application/json" },
      body: JSON.stringify({ path, input, requestId: crypto.randomUUID() }),
    });
    if (!response.ok)
      throw new AppError(
        response.status === 401 ? "UNAUTHORIZED" : "UNAVAILABLE",
        "Tool call failed",
      );
    return ((await response.json()) as { output?: unknown }).output;
  }

  // A committed write still needs delivery if its caller cancels before this RPC arrives.
  committed(tables: string[]) {
    return this.notify(tables);
  }

  async fetch(request: Request, cancellation: ReadableStream): Promise<Response> {
    const controller = new AbortController();
    const reader = cancellation.getReader();
    const cleanup = () => {
      this.lease.signal.removeEventListener("abort", cleanup);
      void reader.cancel().catch(() => {});
    };
    // Keep per-request cancellation alive while the returned body is being read.
    // The action lease bounds all readers, including responses abandoned by app code.
    this.lease.signal.addEventListener("abort", cleanup, { once: true });
    const cancel = () => {
      controller.abort();
      cleanup();
    };
    void reader.read().then(cancel, cancel);
    try {
      return await this.#fetch(request, controller.signal);
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  async #fetch(request: Request, signal: AbortSignal): Promise<Response> {
    let next = new Request(request, { redirect: "manual" });

    for (let redirect = 0; redirect <= 4; redirect++) {
      actionDestination(new URL(next.url));
      if (this.lease.signal.aborted || this.lease.deadline <= Date.now()) {
        throw new AppError("UNAVAILABLE", "Action has ended");
      }
      const backup = next.clone();
      const response = await fetch(next, {
        signal: AbortSignal.any([
          signal,
          this.lease.signal,
          AbortSignal.timeout(Math.max(1, this.lease.deadline - Date.now())),
        ]),
      });

      const location = response.headers.get("location");
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
        return response;
      }

      if (request.redirect === "manual") return response;
      await response.body?.cancel();
      if (request.redirect === "error") throw new TypeError("Fetch encountered a redirect");

      const url = new URL(location, next.url);
      const headers = new Headers(backup.headers);

      if (url.origin !== new URL(next.url).origin) {
        headers.delete("authorization");
        headers.delete("cookie");
      }

      const get =
        (response.status === 303 && !["GET", "HEAD"].includes(backup.method)) ||
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

    throw new AppError("BAD_REQUEST", "Too many action redirects");
  }
}
