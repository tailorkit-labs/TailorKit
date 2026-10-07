import { atom, computed } from "nanostores";
import type { RemoteNode } from "@tailorkit/sandbox/protocol";

type Listener = () => void;

const childIds = (children: RemoteNode[]): string => children.map((c) => c.id).join(",");

const nodeSignature = (node: RemoteNode): string => {
  if (node.kind === "text") {
    return `text:${node.text}`;
  }
  if (node.kind === "fragment") {
    return `frag:${childIds(node.children)}`;
  }
  // For elements: type + child IDs + serialized props + callback bindings
  const propsStr = JSON.stringify(node.props);
  const callbacksStr = (node.callbacks ?? [])
    .map((binding) => `${binding.callback}:${binding.event}:${binding.inputCount}`)
    .join(",");
  return `elem:${node.type}|${childIds(node.children)}|${propsStr}|${callbacksStr}`;
};

const flattenTree = (node: RemoteNode, out: Map<string, RemoteNode>): void => {
  out.set(node.id, node);
  if (node.kind === "text") {
    return;
  }
  for (const child of node.children) {
    flattenTree(child, out);
  }
};

export interface NodeSnapshot {
  nodes: Map<string, RemoteNode>;
  rootId: string | null;
}

export class NodeStore {
  readonly state = atom<NodeSnapshot>({ nodes: new Map(), rootId: null });
  private signatures = new Map<string, string>();

  clear(): void {
    this.signatures.clear();
    this.state.set({ nodes: new Map(), rootId: null });
  }

  setSnapshot(tree: RemoteNode): void {
    const previous = this.state.get();
    const next = new Map<string, RemoteNode>();
    flattenTree(tree, next);
    let changed = previous.rootId !== tree.id || previous.nodes.size !== next.size;

    for (const [id, node] of next) {
      const signature = nodeSignature(node);
      const previousNode = previous.nodes.get(id);
      if (previousNode && this.signatures.get(id) === signature) {
        // Keep unchanged node snapshots stable for framework selectors.
        next.set(id, previousNode);
      } else {
        changed = true;
        this.signatures.set(id, signature);
      }
    }

    for (const id of this.signatures.keys()) {
      if (!next.has(id)) {
        this.signatures.delete(id);
      }
    }

    if (changed) {
      this.state.set({ nodes: next, rootId: tree.id });
    }
  }

  getRootId(): string | null {
    return this.state.get().rootId;
  }

  getNode(id: string): RemoteNode | null {
    return this.state.get().nodes.get(id) ?? null;
  }

  subscribe(id: string, listener: Listener): () => void {
    const node = computed(this.state, (snapshot) => snapshot.nodes.get(id) ?? null);
    return node.listen(listener);
  }

  subscribeRoot(listener: Listener): () => void {
    const root = computed(this.state, (snapshot) => snapshot.rootId);
    return root.listen(listener);
  }
}
