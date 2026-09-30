import { createIframeStorage } from "./storage";
import type { StorageClient } from "@tailorkit/app-storage";
import { iframeReadyType, sandboxMessageType } from "../bridge";
import { readElementProps } from "../host/serialize";
import type {
  HostToIframePayload,
  IframeToHostPayload,
  RemoteCallbackBinding,
  RemoteNode,
} from "../protocol";
import { assertAppClient, renderClient } from "./resolve-view";
import type { AppClient, ViewRequest } from "./resolve-view";

type InitData = Extract<HostToIframePayload, { type: "init" }>["data"];

export function startIframeRuntime(options: {
  root: HTMLElement;
  channel: string;
  parentWindow?: Pick<Window, "postMessage">;
  importModule?: (url: string) => Promise<{ default?: unknown }>;
}): () => void {
  const {
    root,
    channel,
    parentWindow = window.parent,
    importModule = (url) => import(/* @vite-ignore */ url),
  } = options;
  const nodeIds = new WeakMap<Node, string>();
  const nodes = new Map<string, WeakRef<Node>>();
  let nextNodeId = 1;
  let revision = 0;
  let loadedAppUrl: string | null = null;
  let client: AppClient | null = null;
  let rendering = false;
  let destroyed = false;

  const send = (payload: IframeToHostPayload) => {
    if (!destroyed) {
      parentWindow.postMessage({ channel, payload, type: sandboxMessageType }, "*");
    }
  };
  const storage = createIframeStorage((data) => send({ type: "storageRequest", data }));
  const storageGlobal = globalThis as typeof globalThis & { __tailorkitStorage?: StorageClient };
  storageGlobal.__tailorkitStorage = storage.client;
  const sendError = (error: unknown) =>
    send({
      data: { message: error instanceof Error ? error.stack || error.message : String(error) },
      type: "error",
    });
  const getNodeId = (node: Node): string => {
    let id = nodeIds.get(node);
    if (!id) {
      id = `n:${nextNodeId++}`;
      nodeIds.set(node, id);
      nodes.set(id, new WeakRef(node));
    }
    return id;
  };
  const readCallbacks = (element: Element): RemoteCallbackBinding[] => {
    const value = element.getAttribute("data-tailorkit-callbacks");
    if (!value) {
      return [];
    }
    try {
      const callbacks = JSON.parse(value) as Record<string, Partial<RemoteCallbackBinding>>;
      if (!callbacks || typeof callbacks !== "object" || Array.isArray(callbacks)) {
        return [];
      }
      return Object.entries(callbacks).flatMap(([event, config]) =>
        config && typeof config.callback === "string" && typeof config.inputCount === "number"
          ? [{ callback: config.callback, event, inputCount: config.inputCount }]
          : [],
      );
    } catch {
      return [];
    }
  };
  const serializeNode = (node: Node): RemoteNode => {
    if (node instanceof Text) {
      return { id: getNodeId(node), kind: "text", text: node.data };
    }
    if (node instanceof Element) {
      return {
        callbacks: readCallbacks(node),
        children: Array.from(node.childNodes, serializeNode),
        id: getNodeId(node),
        kind: "element",
        props: readElementProps(node),
        type: node.localName,
      };
    }
    return {
      children: Array.from(node.childNodes, serializeNode),
      id: getNodeId(node),
      kind: "fragment",
    };
  };
  const sendSnapshot = () =>
    send({
      data: {
        revision: ++revision,
        tree: {
          children: Array.from(root.childNodes, serializeNode),
          id: getNodeId(root),
          kind: "fragment",
        },
      },
      type: "snapshot",
    });
  const observer = new MutationObserver(() => {
    if (!rendering) {
      sendSnapshot();
    }
  });
  observer.observe(root, { attributes: true, characterData: true, childList: true, subtree: true });

  const loadApp = async ({ appSource, appUrl, props }: InitData) => {
    if (destroyed) {
      return;
    }
    if (loadedAppUrl !== appUrl) {
      const module = await importModule(
        `data:text/javascript;charset=utf-8,${encodeURIComponent(appSource)}`,
      );
      if (destroyed) {
        return;
      }
      assertAppClient(module.default);
      client = module.default;
      loadedAppUrl = appUrl;
    }
    if (!client || !props) {
      throw new Error("TailorKit app requires a view request.");
    }
    rendering = true;
    try {
      renderClient(client, props as unknown as ViewRequest, root);
    } finally {
      observer.takeRecords();
      rendering = false;
    }
    sendSnapshot();
  };
  let pendingLoad = Promise.resolve();
  const handleMessage = (event: MessageEvent) => {
    if (
      event.source !== parentWindow ||
      event.data?.channel !== channel ||
      event.data.type !== sandboxMessageType
    ) {
      return;
    }
    const payload = event.data.payload as HostToIframePayload;
    if (payload?.type === "storageResult") {
      storage.receive(payload.data);
    } else if (payload?.type === "init") {
      pendingLoad = pendingLoad.then(() => loadApp(payload.data)).catch(sendError);
    } else if (payload?.type === "dispatchCallback") {
      const target = nodes.get(payload.data.nodeId)?.deref();
      if (!(target instanceof Element)) {
        nodes.delete(payload.data.nodeId);
        sendError(new Error(`Cannot dispatch callback to unknown node "${payload.data.nodeId}".`));
        return;
      }
      target.dispatchEvent(
        new CustomEvent(payload.data.event, {
          bubbles: false,
          cancelable: true,
          detail: payload.data.args ?? [],
        }),
      );
    }
  };
  window.addEventListener("message", handleMessage);
  parentWindow.postMessage({ channel, type: iframeReadyType }, "*");
  send({ type: "ready" });
  return () => {
    storage.close();
    if (storageGlobal.__tailorkitStorage === storage.client) {
      delete storageGlobal.__tailorkitStorage;
    }
    destroyed = true;
    observer.disconnect();
    window.removeEventListener("message", handleMessage);
    nodes.clear();
  };
}
