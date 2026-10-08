import { createContext, h, render } from "preact";
import type { ComponentChildren, ComponentType } from "preact";
import { useContext } from "preact/hooks";
import type { TailorKitClientWithMeta, ViewInstance } from "./views";

declare const __PREACT_VERSION__: string;

export interface ShellProps {
  children?: ComponentChildren;
}

export interface RouteDefinition {
  readonly shellComponent: ComponentType<ShellProps>;
}

/** Define the shell in an app or slot root.tsx. */
export function defineRoute(options: RouteDefinition): RouteDefinition {
  if (typeof options.shellComponent !== "function") {
    throw new TypeError("defineRoute requires a shellComponent.");
  }
  return Object.freeze({ shellComponent: options.shellComponent });
}

const Outlet = createContext<ComponentChildren>(undefined);

/** Render the next layout or selected view inside a root shell or layout. */
export function Route() {
  const children = useContext(Outlet);
  if (children === undefined) {
    throw new Error("Route must be rendered inside a root or layout.");
  }
  return children;
}

function Shell({ shell, children }: ShellProps & { shell: ComponentType<ShellProps> }) {
  return h(Outlet.Provider, { value: children }, h(shell, { children }));
}

export interface RouteModule {
  filename: string;
  definition: unknown;
}

export interface FileViewModule extends RouteModule {
  slot: string;
}

export interface FileLayoutModule extends RouteModule {
  slot: string;
  path: string;
}

interface FileViewProps {
  view: string;
  status: "ready" | "loading" | "error";
  context?: unknown;
  instance?: ViewInstance;
}

interface FileViewDefinition {
  component: ComponentType<FileViewProps>;
  path: string;
  slot: string;
  instances?: { resolver: string };
}

function shellComponent(module: RouteModule, root: boolean): ComponentType<ShellProps> {
  const definition = module.definition;
  if (!root && typeof definition === "function") {
    return definition as ComponentType<ShellProps>;
  }
  if (
    definition &&
    typeof definition === "object" &&
    "shellComponent" in definition &&
    typeof definition.shellComponent === "function"
  ) {
    return definition.shellComponent as ComponentType<ShellProps>;
  }
  throw new TypeError(
    `${module.filename} must default-export ${root ? "defineRoute({ shellComponent })" : "a layout component or defineRoute({ shellComponent })"}.`,
  );
}

/** The app builder generates this registration; apps only export their files.
 * @internal
 */
export function createFileClient(options: {
  root?: RouteModule;
  roots: (RouteModule & { slot: string })[];
  layouts: FileLayoutModule[];
  views: FileViewModule[];
}): TailorKitClientWithMeta {
  const rootShell = options.root ? shellComponent(options.root, true) : undefined;
  const slotShells = new Map(options.roots.map((root) => [root.slot, shellComponent(root, true)]));
  const layouts = options.layouts.map((layout) => ({
    ...layout,
    shell: shellComponent(layout, false),
  }));
  const definitions: Record<string, Record<string, FileViewDefinition>> = Object.create(null);
  for (const module of options.views) {
    const view = module.definition as FileViewDefinition | undefined;
    if (
      !view ||
      typeof view.component !== "function" ||
      typeof view.path !== "string" ||
      !view.path.startsWith("/")
    ) {
      throw new TypeError(`${module.filename} must default-export defineView(...).`);
    }
    if (view.slot !== module.slot) {
      throw new Error(
        `${module.filename} declares slot "${view.slot}" but is in "${module.slot}".`,
      );
    }
    const slot = (definitions[module.slot] ??= Object.create(null));
    if (Object.hasOwn(slot, view.path)) {
      throw new Error(
        `Duplicate view "${view.path}" in slot "${module.slot}" (${module.filename}).`,
      );
    }
    slot[view.path] = view;
  }
  const slots: Record<string, Record<string, FileViewDefinition>> = Object.create(null);
  for (const [slot, views] of Object.entries(definitions)) {
    const slotLayouts = layouts
      .filter((layout) => layout.slot === slot)
      .toSorted(
        (a, b) =>
          a.path.split("/").filter(Boolean).length - b.path.split("/").filter(Boolean).length,
      );
    const paths = new Set<string>();
    for (const layout of slotLayouts) {
      if (paths.has(layout.path)) {
        throw new Error(`Duplicate layout "${layout.path}" in slot "${slot}".`);
      }
      paths.add(layout.path);
    }
    // Every view in this slot uses the same component identity, so shared shells
    // and layouts survive navigation. The leaf view still has its own identity.
    const SlotRoute = (props: FileViewProps) => {
      const view = views[props.view];
      if (!view) {
        return null;
      }
      let child: ComponentChildren = h(Outlet.Provider, { value: null }, h(view.component, props));
      const matching = slotLayouts.filter(
        (layout) =>
          layout.path === "/" ||
          props.view === layout.path ||
          props.view.startsWith(`${layout.path}/`),
      );
      for (const layout of matching.toReversed()) {
        child = h(Shell, { key: layout.path, shell: layout.shell, children: child });
      }
      const shell = slotShells.get(slot);
      return shell ? h(Shell, { shell, children: child }) : child;
    };
    slots[slot] = Object.fromEntries(
      Object.entries(views).map(([path, view]) => [path, { ...view, component: SlotRoute }]),
    );
  }
  const Root = rootShell
    ? ({ children }: ShellProps) => h(Shell, { shell: rootShell, children })
    : undefined;
  // Filesystem slots cannot be represented by a source-level generic. The
  // deployment manifest is checked against the host's supported slots/views.
  return {
    $meta: { preactVersion: __PREACT_VERSION__ },
    $runtime: {
      h,
      render: (vnode, parent) =>
        render(vnode && Root ? h(Root, { children: vnode }) : vnode, parent),
    },
    slots: slots as TailorKitClientWithMeta["slots"],
  };
}
