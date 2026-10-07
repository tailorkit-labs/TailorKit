import { createContext } from "react";
import type { HostToIframePayload } from "@tailorkit/sandbox/protocol";
import type { NodeStore } from "@tailorkit/client-core";

export interface RemoteViewContext {
  components: Record<string, unknown>;
  dispatch: (payload: HostToIframePayload) => void;
  store: NodeStore;
}

export const RemoteUIContext = createContext<RemoteViewContext | null>(null);
