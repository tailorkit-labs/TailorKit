import { defineView, defineClient } from "./index";
import { z } from "zod";

const root = defineView({ slot: "navbar", view: "/", component: () => null });
const panelRoot = defineView({ slot: "panel", view: "/", component: () => null });
const users = defineView({ slot: "panel", view: "/users", component: () => null });
defineClient({
  slots: {
    navbar: { "/": root },
    panel: { "/": panelRoot, "/users": users },
  },
});
defineClient({ slots: { panel: { "/users": false } } });
// @ts-expect-error Slots are declared by the host.
defineClient({ slots: { unknown: { "/": root } } });
// @ts-expect-error A view must be registered under its own view path.
defineClient({ slots: { panel: { "/": users } } });
// @ts-expect-error View paths must be declared by the host.
defineView({ slot: "panel", view: "/unknown", component: () => null });

// @ts-expect-error Opt-outs must also reference a declared view.
defineClient({ slots: { panel: { "/unknown": false } } });

// @ts-expect-error Globally declared views are not automatically supported by every slot.
defineClient({ slots: { navbar: { "/users": users } } });
// @ts-expect-error Opt-outs must reference a view supported by this slot too.
defineClient({ slots: { navbar: { "/users": false } } });

defineView({
  slot: "navbar",
  view: "/",
  component: () => null,
  // @ts-expect-error Apps cannot provide loading components for host context.
  loading: () => null,
});
defineView({
  slot: "navbar",
  view: "/",
  component: () => null,
  // @ts-expect-error Apps cannot provide error components for host context.
  error: () => null,
});

// Internal loading and error states remain valid without context.
root.component({ view: "/", status: "loading" });
root.component({ view: "/", status: "error" });
root.component({ view: "/", status: "ready", context: { workspaceId: "w1" } });
// @ts-expect-error Non-ready states must not expose context.
root.component({ view: "/", status: "loading", context: { workspaceId: "w1" } });
// @ts-expect-error Non-ready states must not expose context.
root.component({ view: "/", status: "error", context: { workspaceId: "w1" } });

// @ts-expect-error Multi-instance slots require instances in defineView.
defineView({ slot: "page", view: "/", component: () => null });
defineView({
  slot: "panel",
  view: "/",
  component: () => null,
  // @ts-expect-error Single-instance slots reject instances.
  instances: { dataSchema: z.object({}), resolve: () => [] },
});
defineView({
  slot: "navbar",
  view: "/",
  component: () => null,
  // @ts-expect-error An omitted multiple flag also rejects instances.
  instances: { dataSchema: z.object({}), resolve: () => [] },
});
// @ts-expect-error The slot must support the view path.
defineView({ slot: "navbar", view: "/users", component: () => null });
// @ts-expect-error Views cannot be registered under another slot.
defineClient({ slots: { panel: { "/": root } } });
const slotName: "page" | "navbar" = Math.random() > 0.5 ? "page" : "navbar";
// @ts-expect-error A union slot cannot bypass the instances requirement.
defineView({ slot: slotName, view: "/", component: () => null });
// File routes infer the slot from the containing directory.
defineView({ view: "/", component: () => null });

// @ts-expect-error Views must select a host context path.
defineView({ slot: "panel", component: () => null });
// @ts-expect-error The positional signature is no longer supported.
defineView("/", { slot: "panel", component: () => null });

// @ts-expect-error Rewriting a single-instance view's slot cannot bypass the resolver requirement.
defineClient({ slots: { page: { "/": { ...panelRoot, slot: "page" } } } });

const page = defineView({
  slot: "page",
  view: "/",
  component: () => null,
  instances: { dataSchema: z.object({}), resolve: () => [] },
});
defineClient({ slots: { page: { "/": page, "/users": false } } });
// @ts-expect-error Rewriting a multi-instance view's slot cannot add a resolver to a single-instance slot.
defineClient({ slots: { panel: { "/": { ...page, slot: "panel" } } } });
// @ts-expect-error An omitted multiple flag rejects resolvers during registration too.
defineClient({ slots: { navbar: { "/": { ...page, slot: "navbar" } } } });
const { instances: _resolver, ...pageWithoutResolver } = page;
// @ts-expect-error Multi-instance registrations cannot omit their resolver.
defineClient({ slots: { page: { "/": pageWithoutResolver } } });

defineView({ component: () => null });
