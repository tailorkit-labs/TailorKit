import { createTailorKitServer } from "@tailorkit/core/server";
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
import type { ReactNode } from "react";
import { components, createTailorKitClient } from "../tailorkit";

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
const { AppView, useApps, useView } = tailor;
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

useView("/home", {
  context: { page: { title: "Home" } },
});

useView("/user", { status: "loading" });

useView("/user", { status: "error" });

// @ts-expect-error invalid view name
useView("missing", { context: {} });

// @ts-expect-error invalid context shape for selected view
useView("/user", { context: { page: { title: "Home" } } });

// @ts-expect-error ready matches require context
useView("/home", {});

// @ts-expect-error loading views cannot expose partial context
useView("/user", { status: "loading", context: { userId: "user_1" } });

<AppView slot="panel" app={app} />;

<AppView slot="panel" app={app} view="/home" context={{ page: { title: "Home" } }} />;

<AppView slot="panel" app={app} view="/user" status="loading" />;

<AppView slot="panel" app={app} view="/user" status="error" />;

// @ts-expect-error invalid view name
<AppView slot="panel" app={app} view="missing" context={{}} />;

// @ts-expect-error invalid context shape for selected view
<AppView slot="panel" app={app} view="/user" context={{ page: { title: "Home" } }} />;

// @ts-expect-error ready app views require context when view is provided
<AppView slot="panel" app={app} view="/home" />;

// @ts-expect-error loading app views cannot expose context
<AppView slot="panel" app={app} view="/user" status="loading" context={{ userId: "user_1" }} />;

useApps();
useApps({ scopes: ["organization", "user"] });
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

// @ts-expect-error Unknown host slot.
<AppView app={app} slot="missing" />;

// @ts-expect-error The navbar supports root only, despite /user being globally declared.
<AppView app={app} slot="navbar" view="/user" context={{ userId: "u1" }} />;
<AppView app={app} slot="navbar" view="/" context={{ user: { id: "u1" } }} />;

// @ts-expect-error The former object-only hook signature is not supported.
useView({ view: "/user", context: { userId: "u1" } });
