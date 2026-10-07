import { createTailorKitServer } from "@tailorkit/core/server";
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
import type { ReactNode } from "react";
import { components, createTailorKitClient } from "../tailorkit";
import type { TailorKitApp } from "../tailorkit";

const typedSchema = <TValue,>(): StandardSchemaV1<unknown, TValue> &
  StandardJSONSchemaV1<unknown, TValue> =>
  ({
    "~standard": {
      jsonSchema: {
        input: () => ({}),
        output: () => ({}),
      },
      validate: (value: unknown) => ({ value: value as TValue }),
      vendor: "test",
      version: 1,
    },
  }) as const satisfies StandardSchemaV1<unknown, TValue> & StandardJSONSchemaV1<unknown, TValue>;

const server = createTailorKitServer({
  scopes: {
    organization: typedSchema<{ orgId: string }>(),
    user: typedSchema<{ userId: string }>(),
  },
  slots: {
    panel: { views: ["/", "/home", "/home/detail", "/user"] },
    navbar: { views: ["/"] },
    page: { views: ["/"], multiple: true },
    single: { views: ["/"], multiple: false },
  },
  components: {
    Button: {},
  },
  views: {
    "/": typedSchema<{ user: { id: string } }>(),
    "/home": typedSchema<{ page: { title: string } }>(),
    "/home/detail": typedSchema<{
      detail: { id: string };
    }>(),
    "/user": typedSchema<{ userId: string }>(),
  },
});

const tailor = createTailorKitClient<typeof server>({ baseUrl: "http://runtime.test" });
const { Slot, useApps, useViews, useSlotInstances, useRegisterView } = tailor;
const app = { clientPath: "/apps/todo.js", id: "todo" };

const childrenServer = createTailorKitServer({
  scopes: { user: typedSchema<{ userId: string }>() },
  components: {
    Button: {
      children: true,
    },
  },
});

const childrenSchema = childrenServer.$internal.schema;

createTailorKitClient<typeof childrenServer>({
  baseUrl: "http://runtime.test",
  components: {
    Button: ({ children }) => {
      const content: ReactNode = children;
      return content;
    },
  },
});

const requiredComponentsServer = createTailorKitServer({
  scopes: { user: typedSchema<{ userId: string }>() },
  components: {
    Button: {},
    Input: {},
  },
});

createTailorKitClient<typeof requiredComponentsServer>({
  baseUrl: "http://runtime.test",
  // @ts-expect-error all server components must have client renderers when components are provided
  components: {
    Button: () => null,
  },
});

components(childrenSchema, {
  Button: ({ props, children }) => {
    const typedProps = props satisfies Record<string, never>;
    const typedChildren: ReactNode = children;
    void typedProps;
    void typedChildren;
    return null;
  },
});

const callbackServer = createTailorKitServer({
  scopes: { user: typedSchema<{ userId: string }>() },
  components: {
    Button: {
      fields: typedSchema<{ variant?: "default" | "secondary" }>(),
      callbacks: {
        onClick: {},
      },
      children: true,
    },
  },
});

components(callbackServer.$internal.schema, {
  Button: ({ props }) => {
    const variant: "default" | "secondary" | undefined = props.variant;
    const onClick: (() => void) | undefined = props.onClick;
    void variant;
    void onClick;
    return null;
  },
});

useRegisterView("/home", {
  context: { page: { title: "Home" } },
});

useRegisterView("/user", { status: "loading" });

useRegisterView("/user", { status: "error" });

// @ts-expect-error invalid view name
useRegisterView("missing", { context: {} });

// @ts-expect-error invalid context shape for selected view
useRegisterView("/user", { context: { page: { title: "Home" } } });

// @ts-expect-error ready matches require context
useRegisterView("/home", {});

// @ts-expect-error loading views cannot expose partial context
useRegisterView("/user", { status: "loading", context: { userId: "user_1" } });

useApps();
useApps({ scopes: ["organization", "user"] });
// @ts-expect-error cache timing is not exposed by hooks
useApps({ staleTime: 0 });
// @ts-expect-error cache timing is not exposed by hooks
useApps({ gcTime: 0 });
// @ts-expect-error selected scopes must be declared by the server
useApps({ scopes: ["unknown"] });

const workspaceServer = createTailorKitServer({
  scopes: { workspace: typedSchema<{ workspaceId: string }>() },
  components: {},
});
const workspaceClient = createTailorKitClient<typeof workspaceServer>({
  baseUrl: "http://runtime.test",
});
workspaceClient.useApps({ scopes: ["workspace"] });
// @ts-expect-error scope names belong to the client that declared them
workspaceClient.useApps({ scopes: ["organization"] });

// @ts-expect-error The former object-only hook signature is not supported.
useRegisterView({ view: "/user", context: { userId: "u1" } });

useViews();
useViews({ scopes: ["organization"], appIds: ["todo"], slot: "panel" });
// @ts-expect-error cache timing is not exposed by hooks
useViews({ staleTime: 0 });
// @ts-expect-error cache timing is not exposed by hooks
useViews({ gcTime: 0 });
// @ts-expect-error scope names must be declared by this server
useViews({ scopes: ["unknown"] });
// @ts-expect-error slots must be declared by this server
useViews({ slot: "missing" });

const instances = useSlotInstances({ slot: "panel" });
// @ts-expect-error cache timing is not exposed by hooks
useSlotInstances({ slot: "panel", staleTime: 0 });
// @ts-expect-error cache timing is not exposed by hooks
useSlotInstances({ slot: "panel", gcTime: 0 });
const instanceKey: string | undefined = instances.data?.[0]?.key;
const instanceData: unknown = instances.data?.[0]?.data;
void instanceKey;
void instanceData;
// @ts-expect-error slots must be declared by this server
useSlotInstances({ slot: "missing" });
const instanceApp: TailorKitApp | undefined = instances.data?.[0]?.app;
void instanceApp;
// @ts-expect-error app selection is no longer accepted
useSlotInstances({ app, slot: "panel" });
// @ts-expect-error a slot must be supplied
useSlotInstances({});

<Slot app={app} name="panel" />;
<Slot app={app} name="navbar" />;
// @ts-expect-error slots must be declared by the host
<Slot app={app} name="missing" />;
// @ts-expect-error managed slots do not accept an explicit view
<Slot app={app} name="panel" view="/home" />;
// @ts-expect-error managed slots do not expose a fallback prop
<Slot app={app} name="panel" fallback={null} />;

<Slot.Controlled
  app={app}
  name="panel"
  view="/home"
  status="ready"
  context={{ user: { id: "u1" }, page: { title: "Home" } }}
/>;
<Slot.Controlled
  app={app}
  name="panel"
  view="/home/detail"
  status="ready"
  context={{ user: { id: "u1" }, page: { title: "Home" }, detail: { id: "d1" } }}
/>;
<Slot.Controlled
  app={app}
  name="navbar"
  view="/"
  status="ready"
  context={{ user: { id: "u1" } }}
/>;
<Slot.Controlled app={app} name="panel" view="/user" status="loading" />;
<Slot.Controlled app={app} name="panel" view="/user" status="error" />;

// @ts-expect-error controlled slots require an explicit view and status
<Slot.Controlled app={app} name="panel" />;
// @ts-expect-error controlled slots require status even with ready context
<Slot.Controlled app={app} name="panel" view="/" context={{ user: { id: "u1" } }} />;
// @ts-expect-error ready controlled slots require context
<Slot.Controlled app={app} name="panel" view="/home" status="ready" />;
<Slot.Controlled
  app={app}
  name="panel"
  view="/home"
  status="ready"
  // @ts-expect-error controlled slots require ancestor context as well as their own fields
  context={{ page: { title: "Home" } }}
/>;
<Slot.Controlled
  app={app}
  name="panel"
  view="/user"
  status="ready"
  // @ts-expect-error combined context must have the correct field types
  context={{ user: { id: "u1" }, userId: 1 }}
/>;
// @ts-expect-error loading controlled slots cannot expose partial context
<Slot.Controlled
  app={app}
  name="panel"
  view="/user"
  status="loading"
  context={{ user: { id: "u1" }, userId: "u1" }}
/>;
// @ts-expect-error the navbar only supports root
<Slot.Controlled app={app} name="navbar" view="/user" status="loading" />;
// @ts-expect-error unknown views cannot be rendered
<Slot.Controlled app={app} name="panel" view="/missing" status="loading" />;

const optionalContextServer = createTailorKitServer({
  components: {},
  scopes: { user: typedSchema<{ userId: string }>() },
  slots: { panel: { views: ["/detail"] } },
  views: {
    "/": typedSchema<{ workspaceId: string } | undefined>(),
    "/detail": typedSchema<{ detailId: string }>(),
  },
});
const OptionalSlot = createTailorKitClient<typeof optionalContextServer>({
  baseUrl: "http://runtime.test",
}).Slot;
<OptionalSlot.Controlled
  app={app}
  name="panel"
  view="/detail"
  status="ready"
  context={{ detailId: "d1" }}
/>;
<OptionalSlot.Controlled
  app={app}
  name="panel"
  view="/detail"
  status="ready"
  context={{ workspaceId: "w1", detailId: "d1" }}
/>;

const unionContextServer = createTailorKitServer({
  components: {},
  scopes: { user: typedSchema<{ userId: string }>() },
  slots: { panel: { views: ["/detail"] } },
  views: {
    "/": typedSchema<{ kind: "user"; userId: string } | { kind: "organization"; orgId: string }>(),
    "/detail": typedSchema<{ detailId: string }>(),
  },
});
const UnionSlot = createTailorKitClient<typeof unionContextServer>({
  baseUrl: "http://runtime.test",
}).Slot;
<UnionSlot.Controlled
  app={app}
  name="panel"
  view="/detail"
  status="ready"
  context={{ kind: "user", userId: "u1", detailId: "d1" }}
/>;
<UnionSlot.Controlled
  app={app}
  name="panel"
  view="/detail"
  status="ready"
  context={{ kind: "organization", orgId: "o1", detailId: "d1" }}
/>;

<Slot app={app} name="page" instanceKey="overview" />;
// @ts-expect-error Multi-instance slots require a key.
<Slot app={app} name="page" />;
// @ts-expect-error Single-instance slots reject a key (omitted flag).
<Slot app={app} name="panel" instanceKey="overview" />;
// @ts-expect-error Single-instance slots reject a key (explicit false).
<Slot app={app} name="single" instanceKey="overview" />;
const suppliedInstance = {
  key: "overview",
  metadata: { title: "Overview" },
  data: { reportId: "r1" },
};
<Slot.Controlled
  app={app}
  name="page"
  view="/"
  status="ready"
  context={{ user: { id: "u1" } }}
  instance={suppliedInstance}
/>;
// @ts-expect-error loading slots cannot expose stale instance data
<Slot.Controlled app={app} name="page" view="/" status="loading" instance={suppliedInstance} />;
<Slot.Controlled
  app={app}
  name="page"
  view="/"
  status="ready"
  context={{ user: { id: "u1" } }}
  // @ts-expect-error a controlled slot receives an instance, not a key to resolve
  instanceKey="overview"
/>;
// @ts-expect-error instance keys are strings
<Slot app={app} name="page" instanceKey={123} />;

// @ts-expect-error Ready multi-instance controlled slots require an instance.
<Slot.Controlled app={app} name="page" view="/" status="ready" context={{ user: { id: "u1" } }} />;
// @ts-expect-error Ready single-instance slots reject an instance.
<Slot.Controlled
  app={app}
  name="navbar"
  view="/"
  status="ready"
  context={{ user: { id: "u1" } }}
  instance={suppliedInstance}
/>;
// @ts-expect-error Explicit false also rejects an instance.
<Slot.Controlled
  app={app}
  name="single"
  view="/"
  status="ready"
  context={{ user: { id: "u1" } }}
  instance={suppliedInstance}
/>;
<Slot.Controlled app={app} name="page" view="/" status="loading" />;
<Slot.Controlled app={app} name="page" view="/" status="error" />;
const slotName: "page" | "navbar" = Math.random() > 0.5 ? "page" : "navbar";
// @ts-expect-error A union slot name cannot bypass the key requirement.
<Slot app={app} name={slotName} />;
