import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
import { createTailorKitServer } from "@tailorkit/core/server";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Root, Slot } from "../index";
import { createTailorKitClient } from "../tailorkit";

const requests: { appUrl: string; props: Record<string, unknown> }[] = [];
vi.mock("../remote-view", () => ({
  RemoteViewHost: (request: { appUrl: string; props: Record<string, unknown> }) => {
    requests.push(request);
    return null;
  },
}));

const typedSchema = <T,>(): StandardSchemaV1<unknown, T> & StandardJSONSchemaV1<unknown, T> => ({
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => ({ value: value as T }),
    jsonSchema: { input: () => ({}), output: () => ({}) },
  },
});
const server = createTailorKitServer({
  components: {},
  scopes: { user: typedSchema<{ id: string }>() },
  slots: {
    panel: { views: ["/", "/customers", "/customers/detail"] },
    navbar: { views: ["/"] },
  },
  views: {
    "/": typedSchema<{ user: { id: string } }>(),
    "/customers": typedSchema<{ canEdit: boolean }>(),
    "/customers/detail": typedSchema<{ customer: { id: string } }>(),
  },
});
const client = createTailorKitClient<typeof server>({ baseUrl: "https://host.test/api/" });
const app = { id: "test", clientPath: "/client.js" };

beforeEach(() => {
  requests.length = 0;
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ schema: server.$internal.schema.serialize() }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Context({ detail = true }: { detail?: boolean }) {
  client.useRegisterView("/", { context: { user: { id: "registered" } } });
  client.useRegisterView("/customers", { context: { canEdit: true } });
  return detail ? <Detail /> : null;
}
function Detail() {
  client.useRegisterView("/customers/detail", { status: "loading" });
  return null;
}

describe("Slot", () => {
  it("uses the registered hierarchy and removes unmounted contexts", async () => {
    const contents = (detail: boolean) => (
      <Root client={client}>
        <Context detail={detail} />
        <client.Slot app={app} name="panel" />
      </Root>
    );
    const result = render(contents(true));
    await waitFor(() =>
      expect(requests.at(-1)?.props).toMatchObject({
        slot: "panel",
        view: "/customers/detail",
        layers: [
          { path: "/", context: { user: { id: "registered" } }, status: "ready" },
          { path: "/customers", context: { canEdit: true }, status: "ready" },
          { path: "/customers/detail", status: "loading" },
        ],
      }),
    );
    result.rerender(contents(false));
    await waitFor(() =>
      expect(requests.at(-1)?.props).toMatchObject({
        view: "/customers",
        layers: [
          { path: "/", context: { user: { id: "registered" } }, status: "ready" },
          { path: "/customers", context: { canEdit: true }, status: "ready" },
        ],
      }),
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("renders nothing and does not fetch before a context is registered", () => {
    const { container } = render(
      <Root client={client}>
        <client.Slot app={app} name="panel" />
      </Root>,
    );
    expect(container.childElementCount).toBe(0);
    expect(requests).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("shares metadata across slots and isolates roots during Strict Mode", async () => {
    render(
      <StrictMode>
        <Root client={client}>
          <Context />
          <Slot app={app} name="panel" />
          <Slot app={app} name="navbar" />
        </Root>
        <Root client={client}>
          <Slot app={{ id: "other", clientPath: "/other.js" }} name="panel" />
        </Root>
      </StrictMode>,
    );
    await waitFor(() => expect(requests.some(({ props }) => props.slot === "navbar")).toBe(true));
    expect(requests.every(({ appUrl }) => appUrl === "https://host.test/client.js")).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("Slot.Controlled", () => {
  it("renders supplied combined context without registrations and keeps equivalent context stable", async () => {
    const contents = (id: string) => (
      <Root client={client}>
        <client.Slot.Controlled
          app={app}
          name="panel"
          view="/customers/detail"
          status="ready"
          context={{ user: { id: "explicit" }, canEdit: false, customer: { id } }}
        />
      </Root>
    );
    const result = render(contents("c1"));
    await waitFor(() =>
      expect(requests.at(-1)?.props).toMatchObject({
        controlled: true,
        slot: "panel",
        view: "/customers/detail",
        status: "ready",
        context: { user: { id: "explicit" }, canEdit: false, customer: { id: "c1" } },
      }),
    );
    expect(requests.at(-1)?.props).not.toHaveProperty("layers");
    const initial = requests.at(-1)?.props;
    result.rerender(contents("c1"));
    expect(requests.at(-1)?.props).toBe(initial);
    result.rerender(contents("c2"));
    await waitFor(() =>
      expect(requests.at(-1)?.props.context).toMatchObject({ customer: { id: "c2" } }),
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not inherit or react to registered context", async () => {
    const contents = (detail: boolean) => (
      <Root client={client}>
        <Context detail={detail} />
        <client.Slot.Controlled
          app={app}
          name="panel"
          view="/customers"
          status="ready"
          context={{ user: { id: "explicit" }, canEdit: false }}
        />
      </Root>
    );
    const result = render(contents(true));
    await waitFor(() =>
      expect(requests.at(-1)?.props.context).toEqual({ user: { id: "explicit" }, canEdit: false }),
    );
    const initial = requests.at(-1)?.props;
    await act(() => result.rerender(contents(false)));
    expect(requests.at(-1)?.props).toBe(initial);
  });

  it("drops ready context when explicitly switched to loading or error", async () => {
    const contents = (status: "ready" | "loading" | "error") => (
      <Root client={client}>
        {status === "ready" ? (
          <client.Slot.Controlled
            app={app}
            name="navbar"
            view="/"
            status="ready"
            context={{ user: { id: "u1" } }}
          />
        ) : (
          <client.Slot.Controlled app={app} name="navbar" view="/" status={status} />
        )}
      </Root>
    );
    const result = render(contents("ready"));
    await waitFor(() => expect(requests.at(-1)?.props.status).toBe("ready"));
    for (const status of ["loading", "error"] as const) {
      result.rerender(contents(status));
      await waitFor(() =>
        expect(requests.at(-1)?.props).toMatchObject({ status, context: undefined }),
      );
    }
  });
});

it.each(["managed", "controlled"] as const)("rejects a %s Slot under the wrong client", (mode) => {
  const other = createTailorKitClient<typeof server>({ baseUrl: "https://other.test/api/" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() =>
    render(
      <Root client={other}>
        {mode === "managed" ? (
          <client.Slot app={app} name="panel" />
        ) : (
          <client.Slot.Controlled app={app} name="panel" view="/customers" status="loading" />
        )}
      </Root>,
    ),
  ).toThrow(
    `${mode === "managed" ? "Slot" : "Slot.Controlled"} was created for a different TailorKit client`,
  );
});

const instanceApp = { ...app, views: [{ slot: "navbar", path: "/", instances: true as const }] };
const overview = { key: "overview", metadata: { title: "Overview" }, data: { reportId: "r1" } };
const summary = { key: "summary", metadata: { title: "Summary" }, data: { reportId: "r2" } };

it("resolves the key and sends a complete controlled instance through the renderer", async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/backend/session"))
      return Response.json({
        token: "token",
        expiresAt: Date.now() + 300_000,
        url: "https://runtime.test/rpc",
      });
    if (url.endsWith("/actions"))
      return new Promise((resolve) => {
        finish = resolve;
      });
    return Response.json({ schema: server.$internal.schema.serialize() });
  });
  const content = (key: string) => (
    <Root client={client}>
      <Context detail={false} />
      <client.Slot app={instanceApp} name="navbar" instanceKey={key} />
    </Root>
  );
  const view = render(content("overview"));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Loading view…"));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(requests).toHaveLength(0);
  await act(async () => finish(Response.json({ json: [overview, summary] })));
  await waitFor(() =>
    expect(requests.at(-1)?.props).toMatchObject({
      controlled: true,
      slot: "navbar",
      view: "/",
      status: "ready",
      context: { user: { id: "registered" } },
      instance: overview,
    }),
  );
  expect(requests.at(-1)?.props).not.toHaveProperty("layers");
  const initialProps = requests.at(-1)?.props;
  view.rerender(content("overview"));
  expect(requests.at(-1)?.props).toBe(initialProps);
  view.rerender(content("summary"));
  await waitFor(() => expect(requests.at(-1)?.props.instance).toEqual(summary));
  expect(fetch.mock.calls.filter(([input]) => String(input).endsWith("/actions"))).toHaveLength(1);
  view.rerender(content("missing"));
  expect(screen.getByRole("alert").textContent).toBe('View instance "missing" is unavailable.');
  view.rerender(content("overview"));
  await waitFor(() => expect(requests.at(-1)?.props.instance).toEqual(overview));
});

it("reports resolver failures and missing keys without mounting stale instances", async () => {
  vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/backend/session"))
      return Response.json({
        token: "token",
        expiresAt: Date.now() + 300_000,
        url: "https://runtime.test/rpc",
      });
    if (url.endsWith("/actions"))
      return Response.json(
        { json: { code: "FORBIDDEN", message: "No reports available", defined: false } },
        { status: 403 },
      );
    return Response.json({ schema: server.$internal.schema.serialize() });
  });
  render(
    <Root client={client}>
      <Context />
      <client.Slot app={instanceApp} name="navbar" instanceKey="overview" />
    </Root>,
  );
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("No reports available"));
  expect(requests).toHaveLength(0);
});

it("requires a key for a dynamic managed view", async () => {
  render(
    <Root client={client}>
      <Context />
      <client.Slot app={instanceApp} name="navbar" />
    </Root>,
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Pass instanceKey to Slot"),
  );
  expect(requests).toHaveLength(0);
});

it.each([false, true])(
  "checks instance support without composing invalid context (dynamic: %s)",
  async (dynamic) => {
    function DuplicateContext() {
      client.useRegisterView("/", { context: { user: { id: "registered" } } });
      const context = { canEdit: true, user: { id: "duplicate" } };
      client.useRegisterView("/customers", { context });
      return null;
    }
    const appWithViews = {
      ...app,
      views: [
        { slot: "panel", path: "/customers", ...(dynamic ? { instances: true as const } : {}) },
      ],
    };
    render(
      <Root client={client}>
        <DuplicateContext />
        <client.Slot app={appWithViews} name="panel" />
      </Root>,
    );
    if (dynamic) {
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toContain("Pass instanceKey to Slot"),
      );
      expect(requests).toHaveLength(0);
    } else {
      await waitFor(() =>
        expect(requests.at(-1)?.props).toMatchObject({
          view: "/customers",
          layers: [
            { path: "/", context: { user: { id: "registered" } }, status: "ready" },
            {
              path: "/customers",
              context: { canEdit: true, user: { id: "duplicate" } },
              status: "ready",
            },
          ],
        }),
      );
      expect(screen.queryByRole("alert")).toBeNull();
    }
  },
);

it("passes supplied instances without resolving them and clears them while loading", async () => {
  const content = (instance: typeof overview, status: "ready" | "loading") => (
    <Root client={client}>
      {status === "ready" ? (
        <client.Slot.Controlled
          app={instanceApp}
          name="navbar"
          view="/"
          status="ready"
          context={{ user: { id: "explicit" } }}
          instance={instance}
        />
      ) : (
        <client.Slot.Controlled app={instanceApp} name="navbar" view="/" status="loading" />
      )}
    </Root>
  );
  const view = render(content(overview, "ready"));
  await waitFor(() => expect(requests.at(-1)?.props.instance).toEqual(overview));
  view.rerender(content(summary, "ready"));
  await waitFor(() => expect(requests.at(-1)?.props.instance).toEqual(summary));
  view.rerender(content(summary, "loading"));
  expect(requests.at(-1)?.props).not.toHaveProperty("instance");
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

it("reports a missing controlled instance and recovers when one is supplied", async () => {
  const content = (instance?: typeof overview) => (
    <Root client={client}>
      <client.Slot.Controlled
        app={instanceApp}
        name="navbar"
        view="/"
        status="ready"
        context={{ user: { id: "explicit" } }}
        instance={instance}
      />
    </Root>
  );
  const view = render(content());
  expect(screen.getByRole("alert").textContent).toContain("Pass instance to Slot.Controlled");
  expect(requests).toHaveLength(0);
  view.rerender(content(overview));
  await waitFor(() => expect(requests.at(-1)?.props.instance).toEqual(overview));
});
