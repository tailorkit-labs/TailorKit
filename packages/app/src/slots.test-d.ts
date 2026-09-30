import { createView, defineClient } from "./index";

const root = createView("/", { component: () => null });
const users = createView("/users", { component: () => null });
defineClient({
  slots: {
    navbar: { "/": root },
    panel: { "/": root, "/users": users },
  },
});
defineClient({ slots: { panel: { "/users": false } } });
// @ts-expect-error Slots are declared by the host.
defineClient({ slots: { unknown: { "/": root } } });
// @ts-expect-error A view must be registered under its own view path.
defineClient({ slots: { panel: { "/": users } } });
// @ts-expect-error View paths must be declared by the host.
createView("/unknown", { component: () => null });

// @ts-expect-error Opt-outs must also reference a declared view.
defineClient({ slots: { panel: { "/unknown": false } } });

// @ts-expect-error Globally declared views are not automatically supported by every slot.
defineClient({ slots: { navbar: { "/users": users } } });
// @ts-expect-error Opt-outs must reference a view supported by this slot too.
defineClient({ slots: { navbar: { "/users": false } } });

createView("/", {
  component: () => null,
  // @ts-expect-error Apps cannot provide loading components for host context.
  loading: () => null,
});
createView("/", {
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
