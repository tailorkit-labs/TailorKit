export type ViewStatus = "ready" | "loading" | "error";

export interface ViewLayer {
  path: string;
  context: unknown;
  status: ViewStatus;
}

export interface ActiveView {
  view: string;
  layers: ViewLayer[];
}

/** Includes the requested path, followed by its parents through the root. */
export function getViewHierarchy(path: string): string[] {
  const hierarchy = [path];
  let current = path;
  while (current !== "/") {
    const separator = current.lastIndexOf("/");
    current = separator <= 0 ? "/" : current.slice(0, separator);
    hierarchy.push(current);
  }
  return hierarchy;
}

export function isViewAncestor(ancestor: string, path: string): boolean {
  return ancestor === "/" || ancestor === path || path.startsWith(`${ancestor}/`);
}

export function getViewDepth(path: string): number {
  return path.split("/").filter(Boolean).length;
}

/** Context supplied to the selected view after combining its registered ancestors. */
export type ResolvedViewProps =
  | { view: string; status: "ready"; context: Record<string, unknown> }
  | { view: string; status: "loading" | "error"; context?: never };

export function composeViewContext(
  selected: string,
  request: { layers: readonly ViewLayer[]; declaredViews: readonly string[] },
): ResolvedViewProps {
  let status: ViewStatus = "ready";
  const context: Record<string, unknown> = {};
  for (const path of getViewHierarchy(selected).toReversed()) {
    const layer = request.layers.find((entry) => entry.path === path);
    if (!layer) {
      if (request.declaredViews.includes(path) || path === selected) {
        status = "error";
      }
      continue;
    }
    if (layer.status === "error") {
      status = "error";
    } else if (layer.status === "loading" && status !== "error") {
      status = "loading";
    }
    if (layer.status !== "ready" || layer.context === undefined) {
      continue;
    }
    if (
      layer.context === null ||
      typeof layer.context !== "object" ||
      Array.isArray(layer.context)
    ) {
      status = "error";
      continue;
    }
    for (const [key, value] of Object.entries(layer.context)) {
      if (Object.hasOwn(context, key)) {
        throw new Error(`Duplicate view context field "${key}".`);
      }
      Object.defineProperty(context, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  const props: ResolvedViewProps =
    status === "ready"
      ? { view: selected, status, context }
      : { view: selected, status, context: undefined };
  return props;
}
