import { createView, defineClient } from "./index";
import { z } from "zod";

const root = createView("/", { slot: "navbar", component: () => null });
const panelRoot = createView("/", { slot: "panel", component: () => null });
const users = createView("/users", { slot: "panel", component: () => null });
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
createView("/unknown", { slot: "panel", component: () => null });

// @ts-expect-error Opt-outs must also reference a declared view.
defineClient({ slots: { panel: { "/unknown": false } } });

// @ts-expect-error Globally declared views are not automatically supported by every slot.
defineClient({ slots: { navbar: { "/users": users } } });
// @ts-expect-error Opt-outs must reference a view supported by this slot too.
defineClient({ slots: { navbar: { "/users": false } } });

createView("/", {
  slot: "navbar",
  component: () => null,
  // @ts-expect-error Apps cannot provide loading components for host context.
  loading: () => null,
});
createView("/", {
  slot: "navbar",
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

// @ts-expect-error Multi-instance slots require instances in createView.
createView("/", { slot: "page", component: () => null });
createView("/", {
  slot: "panel",
  component: () => null,
  // @ts-expect-error Single-instance slots reject instances.
  instances: { dataSchema: z.object({}), resolve: () => [] },
});
createView("/", {
  slot: "navbar",
  component: () => null,
  // @ts-expect-error An omitted multiple flag also rejects instances.
  instances: { dataSchema: z.object({}), resolve: () => [] },
});
// @ts-expect-error The slot must support the view path.
createView("/users", { slot: "navbar", component: () => null });
// @ts-expect-error Views cannot be registered under another slot.
defineClient({ slots: { panel: { "/": root } } });
const slotName: "page" | "navbar" = Math.random() > 0.5 ? "page" : "navbar";
// @ts-expect-error A union slot cannot bypass the instances requirement.
createView("/", { slot: slotName, component: () => null });
// @ts-expect-error Views must select a slot to enforce the host's multiplicity.
createView("/", { component: () => null });
