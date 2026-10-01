import type { Session } from "@tailorkit/apps-server/client";
import type { StorageClient } from "@tailorkit/app-storage";
import { functionReference, StorageError } from "@tailorkit/app-storage";
import { HostToIframePayload, IframeToHostPayload } from "../protocol.js";
import type { HostToIframePayload as HostToIframePayloadType } from "../protocol.js";
import { createRemoteUiStore } from "./store.js";
import type { RemoteUiStore } from "./store.js";
import iframeSource from "virtual:tailorkit-iframe";
import { iframeReadyType, sandboxMessageType } from "../bridge";

interface IframeBridgeMessage {
  channel: string;
  payload?: unknown;
  type: string;
}

export interface IframeUiHost extends RemoteUiStore {
  destroy(): void;
  dispatch(payload: HostToIframePayloadType): void;
  iframe: HTMLIFrameElement;
  mount(): void;
  setProps(props: Record<string, unknown> | undefined): void;
}

export interface IframeUiHostOptions {
  createIframe?: () => HTMLIFrameElement;
  fetch?: typeof globalThis.fetch;
  mountTarget?: HTMLElement;
  onError?: (error: Error) => void;
  props?: Record<string, unknown>;
  /** Complete source for a committed preview revision. */
  sourceText?: string;
  /** Bound by the host SDK to this app installation; never supplied by the iframe. */
  storage?: StorageClient;
  getBackendSession?: (options: { refresh: boolean }) => Promise<Session>;
}

export function createIframeUiHost(
  appUrl: string | URL,
  options: IframeUiHostOptions = {},
): IframeUiHost {
  if (typeof document === "undefined" || typeof window === "undefined") {
    throw new TypeError("TailorKit's iframe sandbox requires a browser environment.");
  }

  const store = createRemoteUiStore();
  const iframe = options.createIframe?.() ?? document.createElement("iframe");
  const channel = createChannelId();
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const resolvedAppUrl = toUrl(appUrl);
  const storageSubscriptions = new Map<string, () => void>();
  const storageCalls = new Set<string>();
  const sessionCalls = new Set<string>();
  const queuedPayloads: HostToIframePayloadType[] = [];
  let appSourcePromise: Promise<string> | null = null;
  let destroyed = false;
  let iframeReady = false;
  let mounted = false;
  let currentProps = options.props;
  let initRevision = 0;

  configureIframe(iframe, channel);

  const reportError = (error: unknown): void => {
    options.onError?.(error instanceof Error ? error : new Error(String(error)));
  };

  const postToIframe = (payload: HostToIframePayloadType): void => {
    iframe.contentWindow?.postMessage({ channel, payload, type: sandboxMessageType }, "*");
  };

  const sendInit = async (): Promise<void> => {
    if (!mounted || !iframeReady || destroyed) {
      return;
    }
    const revision = ++initRevision;
    const appSource = await appSourcePromise;
    if (destroyed || appSource === null || revision !== initRevision) {
      return;
    }
    postToIframe({
      data: {
        appSource,
        appUrl: resolvedAppUrl.toString(),
        props: currentProps,
      },
      type: "init",
    });
    for (const payload of queuedPayloads.splice(0)) {
      postToIframe(payload);
    }
  };

  const handleMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== iframe.contentWindow || !isBridgeMessage(event.data, channel)) {
      return;
    }
    if (event.data.type === iframeReadyType) {
      iframeReady = true;
      void sendInit().catch(reportError);
      return;
    }
    if (event.data.type !== sandboxMessageType) {
      return;
    }

    const result = IframeToHostPayload.safeParse(event.data.payload);
    if (!result.success) {
      reportError(new Error(`Invalid sandbox message: ${result.error.message}`));
      return;
    }
    if (result.data.type === "backendSessionRequest") {
      const { id, refresh } = result.data.data;
      if (sessionCalls.has(id) || sessionCalls.size >= 4) return;
      sessionCalls.add(id);
      void (
        options.getBackendSession?.({ refresh }) ??
        Promise.reject(new Error("App backend is not configured"))
      )
        .then((session) => {
          if (!destroyed) postToIframe({ type: "backendSessionResult", data: { id, session } });
        })
        .catch(() => {
          if (!destroyed)
            postToIframe({
              type: "backendSessionResult",
              data: { id, error: "Unable to authorize the app backend" },
            });
        })
        .finally(() => sessionCalls.delete(id));
      return;
    }
    if (result.data.type === "storageRequest") {
      const data = result.data.data;
      const reply = (
        result: Omit<Extract<HostToIframePayloadType, { type: "storageResult" }>["data"], "id">,
      ) => {
        if (!destroyed) {
          postToIframe({ type: "storageResult", data: { id: data.id, ...result } });
        }
      };
      const fail = (error: unknown) => {
        const failure =
          error instanceof StorageError
            ? error
            : new StorageError("INTERNAL_SERVER_ERROR", "Storage operation failed");
        reply({ error: { code: failure.code, message: failure.message } });
      };
      if (data.op === "cancel") {
        storageSubscriptions.get(data.id)?.();
        storageSubscriptions.delete(data.id);
        return;
      }
      if (storageCalls.has(data.id) || storageSubscriptions.has(data.id)) {
        return;
      }
      if (!options.storage) {
        fail(new StorageError("UNAVAILABLE", "App storage is not configured"));
        return;
      }
      let size: number;
      try {
        size = JSON.stringify(data).length;
      } catch {
        fail(new StorageError("BAD_REQUEST", "Storage input must be JSON"));
        return;
      }
      if (storageCalls.size + storageSubscriptions.size >= 128 || size > 1024 * 1024) {
        fail(new StorageError("BAD_REQUEST", "Storage bridge limit exceeded"));
        return;
      }
      try {
        if (data.op === "subscribe") {
          const stop = options.storage.subscribe(
            functionReference(data.name, "query", data.apiVersion),
            data.input,
            (value) => reply({ value }),
            { onError: fail, onStatus: (status) => reply({ status }) },
          );
          storageSubscriptions.set(data.id, stop);
        } else {
          storageCalls.add(data.id);
          const call =
            data.op === "query"
              ? options.storage.query(
                  functionReference(data.name, "query", data.apiVersion),
                  data.input,
                )
              : options.storage.mutate(
                  functionReference(data.name, "mutation", data.apiVersion),
                  data.input,
                  { requestId: data.requestId },
                );
          void call
            .then((value) => reply({ value }))
            .catch(fail)
            .finally(() => storageCalls.delete(data.id));
        }
      } catch (error) {
        storageCalls.delete(data.id);
        fail(error);
      }
      return;
    }
    try {
      store.handleSandboxMessage(result.data);
    } catch (error) {
      reportError(error);
    }
  };

  window.addEventListener("message", handleMessage);

  return {
    ...store,
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      queuedPayloads.length = 0;
      for (const stop of storageSubscriptions.values()) {
        stop();
      }
      storageSubscriptions.clear();
      storageCalls.clear();
      window.removeEventListener("message", handleMessage);
      iframe.remove();
    },
    dispatch(payload) {
      HostToIframePayload.parse(payload);
      if (!iframeReady) {
        queuedPayloads.push(payload);
        return;
      }
      postToIframe(payload);
    },
    iframe,
    setProps(props) {
      if (currentProps === props || destroyed) {
        return;
      }
      currentProps = props;
      void sendInit().catch(reportError);
    },
    mount() {
      if (mounted || destroyed) {
        return;
      }
      mounted = true;
      appSourcePromise =
        options.sourceText === undefined
          ? fetchSource(fetchImplementation, resolvedAppUrl)
          : Promise.resolve(options.sourceText);
      const attach = (origin?: string) => {
        if (destroyed) return;
        if (origin) configureIframe(iframe, channel, origin);
        (options.mountTarget ?? document.body).append(iframe);
        void sendInit().catch(reportError);
      };
      if (options.getBackendSession) {
        void options
          .getBackendSession({ refresh: false })
          .then((session) => {
            const url = new URL(session.url);
            if (url.protocol === "https:") url.protocol = "wss:";
            else if (
              url.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
            )
              url.protocol = "ws:";
            else throw new Error("Backend requires HTTPS or loopback");
            attach(url.origin);
          })
          .catch(() => attach());
      } else attach();
    },
  };
}

function configureIframe(iframe: HTMLIFrameElement, channel: string, backendOrigin?: string): void {
  iframe.hidden = true;
  iframe.tabIndex = -1;
  iframe.title = "TailorKit extension sandbox";
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.srcdoc = createIframeDocument(channel, backendOrigin);
}

function createIframeDocument(channel: string, backendOrigin?: string): string {
  return `<!doctype html>
<html data-tailorkit-channel="${channel}">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' data:; worker-src 'none'; connect-src ${backendOrigin ?? "'none'"}; img-src 'none'; style-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">
  </head>
  <body>
    <div id="tailorkit-root"></div>
    <script>${iframeSource.replaceAll("</script", "<\\/script")}</script>
  </body>
</html>`;
}

async function fetchSource(
  fetchImplementation: typeof globalThis.fetch,
  url: URL,
): Promise<string> {
  const response = await fetchImplementation(url, { credentials: "omit" });
  if (!response.ok) {
    throw new Error(`Unable to load TailorKit app client from ${url.toString()}.`);
  }
  return response.text();
}

function createChannelId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isBridgeMessage(value: unknown, channel: string): value is IframeBridgeMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "channel" in value &&
    value.channel === channel &&
    "type" in value &&
    typeof value.type === "string"
  );
}

function toUrl(value: string | URL): URL {
  return value instanceof URL ? value : new URL(value, globalThis.location?.href);
}

export { createRemoteUiStore };
export type { RemoteUiStore };
