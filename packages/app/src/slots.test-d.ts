import { defineView } from "./index";
import { z } from "zod";

const root = defineView({ slot: "navbar", view: "/", component: () => null });
// @ts-expect-error View paths must be declared by the host.
defineView({ slot: "panel", view: "/unknown", component: () => null });

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
const slotName: "page" | "navbar" = Math.random() > 0.5 ? "page" : "navbar";
// @ts-expect-error A union slot cannot bypass the instances requirement.
defineView({ slot: slotName, view: "/", component: () => null });
// File routes infer the slot from the containing directory.
defineView({ view: "/", component: () => null });

// @ts-expect-error Views must select a host context path.
defineView({ slot: "panel", component: () => null });
// @ts-expect-error The positional signature is no longer supported.
defineView("/", { slot: "panel", component: () => null });

defineView({ component: () => null });
