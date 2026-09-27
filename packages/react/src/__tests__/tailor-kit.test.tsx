import { Root, AppView, useApps, useView } from "../index";
import { act, cleanup, render, screen as testingView, waitFor } from "@testing-library/react";
import { createElement, StrictMode } from "react";
import type { ReactNode } from "react";
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createTailorKitServer } from "@tailorkit/core/server";
import type { IframeUiHost } from "@tailorkit/sandbox/host";
import type { HostToIframePayload, RemoteNode } from "@tailorkit/sandbox/protocol";
import { createTailorKitClient } from "../tailor-kit";
import { RemoteViewHost } from "../remote-view";
import type { TailorKitApp } from "../tailor-kit";

const hostRecords: {
  appUrl: string;
  props: Record<string, unknown> | undefined;
  sourceText?: string;
}[] = [];

vi.mock("@tailorkit/sandbox/host", () => ({
  createIframeUiHost: (
    appUrl: string | URL,
    options: { props?: Record<string, unknown>; sourceText?: string } = {},
  ): IframeUiHost => {
    const record = {
      appUrl: appUrl.toString(),
      props: options.props,
      sourceText: options.sourceText,
    };
    hostRecords.push(record);

    const tree: RemoteNode = {
      children: [{ id: `text-${hostRecords.length}`, kind: "text", text: appUrl.toString() }],
      id: `root-${hostRecords.length}`,
      kind: "element",
      props: {},
      type: appUrl.toString().includes("missing-component") ? "MissingComponent" : "Button",
    };
    let listener: (() => void) | null = null;

    return {
      destroy: () => {},
      setProps: (props: Record<string, unknown> | undefined) => {
        record.props = props;
      },
      dispatch: (_payload: HostToIframePayload) => {},
      getSnapshot: () => tree,
      iframe: document.createElement("iframe"),
      mount: () => {
        listener?.();
      },
      subscribe: (nextListener: () => void) => {
        listener = nextListener;
        return () => {
          listener = null;
        };
      },
    } as unknown as IframeUiHost;
  },
}));

const emptySchema: StandardSchemaV1<unknown, Record<never, never>> &
  StandardJSONSchemaV1<unknown, Record<never, never>> = {
  "~standard": {
    jsonSchema: {
      input: () => ({}),
      output: () => ({}),
    },
    validate: (value: unknown) => ({ value: value as Record<never, never> }),
    vendor: "test",
    version: 1,
  },
} as const;

const server = createTailorKitServer({
  slots: {
    panel: { views: ["/", "/home", "/home/detail", "/user"] },
    navbar: { views: ["/"] },
  },
  components: {
    Button: { children: true },
  },
  contexts: {
    "/": emptySchema,
    "/home": emptySchema,
    "/home/detail": emptySchema,
    "/user": emptySchema,
  },
});

const components = {
  Button: ({ children }: { children?: ReactNode }) => createElement("button", null, children),
};

const schema = server.$internal.schema;

function CurrentViewRoute({
  nested,
}: {
  nested: boolean;
  tailor: ReturnType<typeof createTailorKitClient<typeof server>>;
}) {
  useView(
    nested ? "/home/detail" : "/home",
    nested
      ? {
          context: { detail: { id: "profile" } },
        }
      : {
          context: { page: { title: "home" } },
        },
  );

  return <AppView slot="panel" app={{ clientPath: "/apps/todo.js", id: "todo" }} />;
}

function CurrentViewHost({
  nested,
  tailor,
}: {
  nested: boolean;
  tailor: ReturnType<typeof createTailorKitClient<typeof server>>;
}) {
  return (
    <Root client={tailor} apps={[{ clientPath: "/apps/todo.js", id: "todo" }]}>
      <CurrentViewRoute nested={nested} tailor={tailor} />
    </Root>
  );
}

function HomeAppView({
  app,
}: {
  app: TailorKitApp;
  tailor: ReturnType<typeof createTailorKitClient<typeof server>>;
}) {
  useView("/home", { context: { page: { title: "home" } } });
  return <AppView slot="panel" app={app} />;
}

describe("tailorKitClient React adapter", () => {
  it("recreates the sandbox when a complete preview source revision changes", () => {
    const { rerender } = render(
      <RemoteViewHost
        appUrl="https://host.test/client.js"
        sourceText="one"
        components={{ Button: () => null }}
      />,
    );
    expect(hostRecords.at(-1)?.sourceText).toBe("one");
    rerender(
      <RemoteViewHost
        appUrl="https://host.test/client.js"
        sourceText="two"
        components={{ Button: () => null }}
      />,
    );
    expect(hostRecords.at(-1)?.sourceText).toBe("two");
    expect(hostRecords).toHaveLength(2);
  });
  beforeEach(() => {
    hostRecords.length = 0;
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        assetsBaseUrl: "http://assets.test/",
        schema: schema.serialize(),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps a preview subscription when an inline app is rendered again", async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) =>
      Promise.resolve(
        input instanceof URL && input.pathname.endsWith("/preview/metadata")
          ? new Response(null, { status: 503 })
          : Response.json({ assetsBaseUrl: "http://assets.test/", schema: schema.serialize() }),
      ),
    );
    class PreviewSocket extends EventTarget {
      static instances: PreviewSocket[] = [];
      closed = false;
      readonly protocol: string;

      constructor(_url: string, protocol: string) {
        super();
        this.protocol = protocol;
        PreviewSocket.instances.push(this);
      }

      close() {
        this.closed = true;
        this.dispatchEvent(new Event("close"));
      }
    }
    vi.stubGlobal("WebSocket", PreviewSocket);
    const tailor = createTailorKitClient<typeof server>({
      baseUrl: "http://runtime.test/api/tailorkit",
      components,
    });
    const suppliedApps: TailorKitApp[] = [];
    const content = (token: string) => (
      <Root client={tailor} apps={suppliedApps}>
        <HomeAppView
          tailor={tailor}
          app={{
            id: "preview",
            clientPath: "/apps/preview.js",
            preview: {
              sessionId: "session",
              expiresAt: "later",
              websocketUrl: "wss://platform.test/preview",
              token,
            },
          }}
        />
      </Root>
    );
    const view = render(content("initial-token"));
    await waitFor(() => expect(PreviewSocket.instances).toHaveLength(1));
    const socket = PreviewSocket.instances[0];
    view.rerender(content("updated-token"));
    expect(PreviewSocket.instances).toHaveLength(1);
    expect(socket?.closed).toBe(false);
    socket?.close();
    await waitFor(() => expect(PreviewSocket.instances).toHaveLength(2), { timeout: 2500 });
    expect(PreviewSocket.instances[1]?.protocol).toBe("updated-token");
    view.unmount();
    expect(PreviewSocket.instances[1]?.closed).toBe(true);
  });

  it("fetches and caches apps", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json([{ id: "todo", name: "Todo" }]));
    const tailor = createTailorKitClient<typeof server>({
      baseUrl: "http://runtime.test/api/tailorkit",
      components,
    });

    function AppList() {
      const { data, status } = useApps();
      return createElement("p", null, `${status}:${(data ?? []).map((app) => app.id).join(",")}`);
    }

    render(
      <Root client={tailor}>
        <AppList />
        <AppList />
      </Root>,
    );

    await waitFor(() => {
      expect(testingView.getAllByText("ready:todo")).toHaveLength(2);
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      new URL("apps", "http://runtime.test/api/tailorkit/"),
    );
  });

  it("derives the hierarchy from the current view and reuses its extended context", async () => {
    const tailor = createTailorKitClient<typeof server>({
      baseUrl: "http://runtime.test",
      components,
    });

    const view = render(<CurrentViewHost nested tailor={tailor} />);

    await waitFor(() => {
      expect(hostRecords.at(-1)?.props).toMatchObject({
        layers: [
          {
            context: { detail: { id: "profile" } },
            path: "/home/detail",
            status: "ready",
          },
        ],
      });
    });

    await act(() => {
      view.rerender(<CurrentViewHost nested={false} tailor={tailor} />);
    });

    await waitFor(() => {
      expect(hostRecords.at(-1)?.props).toMatchObject({
        layers: [
          {
            context: { page: { title: "home" } },
            path: "/home",
            status: "ready",
          },
        ],
      });
    });
  });

  it("publishes loading and error states without stale context", async () => {
    const tailor = createTailorKitClient<typeof server>({
      baseUrl: "http://runtime.test",
      components,
    });

    function Route({ status }: { status: "error" | "loading" }) {
      useView("/home/detail", { status });
      return <AppView slot="panel" app={{ clientPath: "/apps/todo.js", id: "todo" }} />;
    }

    const view = render(
      <Root client={tailor} apps={[{ clientPath: "/apps/todo.js", id: "todo" }]}>
        <Route status="loading" />
      </Root>,
    );

    await waitFor(() => {
      expect(hostRecords.at(-1)?.props).toMatchObject({
        layers: [{ context: undefined, path: "/home/detail", status: "loading" }],
      });
    });

    view.rerender(
      <Root client={tailor} apps={[{ clientPath: "/apps/todo.js", id: "todo" }]}>
        <Route status="error" />
      </Root>,
    );

    await waitFor(() => {
      expect(hostRecords.at(-1)?.props).toMatchObject({
        layers: [{ context: undefined, path: "/home/detail", status: "error" }],
      });
    });
  });

  it("renders the current match for multiple direct app props", async () => {
    hostRecords.length = 0;
    const tailor = createTailorKitClient<typeof server>({
      baseUrl: "http://runtime.test",
      components,
    });

    function Route() {
      useView("/home", { context: { page: { title: "home" } } });
      return (
        <>
          <AppView slot="panel" app={{ clientPath: "/apps/b.js", id: "b" }} />
          <AppView
            slot="panel"
            app={{
              currentDeployment: { id: "deployment_1" },
              id: "a",
              projectId: "project_1",
            }}
          />
        </>
      );
    }

    render(
      <Root
        client={tailor}
        apps={[
          { clientPath: "/apps/b.js", id: "b" },
          {
            currentDeployment: { id: "deployment_1" },
            id: "a",
            projectId: "project_1",
          },
        ]}
      >
        <Route />
      </Root>,
    );

    await waitFor(() => {
      expect(hostRecords).toHaveLength(2);
    });
    expect(hostRecords.map((record) => record.appUrl)).toEqual([
      "http://runtime.test/apps/b.js",
      "http://assets.test/projects/project_1/apps/a/deployments/deployment_1/files/client.js",
    ]);
    expect(hostRecords.map((record) => (record.props?.layers as unknown[])?.[0])).toEqual([
      { context: { page: { title: "home" } }, path: "/home", status: "ready" },
      { context: { page: { title: "home" } }, path: "/home", status: "ready" },
    ]);
  });

  it("renders an explicit view override without a registered current view", async () => {
    const tailor = createTailorKitClient<typeof server>({
      baseUrl: "http://runtime.test",
      components,
    });

    render(
      <Root client={tailor}>
        <AppView
          slot="panel"
          app={{ clientPath: "/apps/todo.js", id: "todo" }}
          context={{ userId: "user_1" }}
          view="/user"
        />
      </Root>,
    );

    await waitFor(() => {
      expect(hostRecords.at(-1)?.props).toMatchObject({
        layers: [
          {
            context: { userId: "user_1" },
            path: "/user",
            status: "ready",
          },
        ],
      });
    });
  });

  it("warns when multiple hooks register views at the same hierarchy depth", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tailor = createTailorKitClient<typeof server>({
      baseUrl: "http://runtime.test",
      components,
    });

    function HomeRoute() {
      useView("/home", { context: { page: { title: "home" } } });
      return null;
    }

    function UserRoute() {
      useView("/user", { context: { userId: "user_1" } });
      return <AppView slot="panel" app={{ clientPath: "/apps/todo.js", id: "todo" }} />;
    }

    render(
      <Root client={tailor} apps={[{ clientPath: "/apps/todo.js", id: "todo" }]}>
        <HomeRoute />
        <UserRoute />
      </Root>,
    );

    await waitFor(() => {
      expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('"/home", "/user"'));
    });
  });

  it("passes primitive theme tokens into mounted views", async () => {
    const tailor = createTailorKitClient<typeof server>({
      baseUrl: "http://runtime.test",
      components,
      theme: {
        tokens: {
          background: {
            surface: "var(--card)",
          },
        },
      },
    });

    render(
      <Root client={tailor} apps={[{ clientPath: "/apps/todo.js", id: "todo" }]}>
        <HomeAppView app={{ clientPath: "/apps/todo.js", id: "todo" }} tailor={tailor} />
      </Root>,
    );

    await waitFor(() => {
      expect(hostRecords).toHaveLength(1);
    });
    expect(document.querySelector("[data-tailorkit-theme-style]")?.textContent).toContain(
      "--tailorkit-background-surface: var(--card);",
    );
  });

  it("renders missing component errors inside the app container", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const tailor = createTailorKitClient<typeof server>({
      baseUrl: "http://runtime.test",
    });

    render(
      <Root client={tailor} apps={[{ clientPath: "/apps/todo.js", id: "todo" }]}>
        <HomeAppView app={{ clientPath: "/apps/todo.js", id: "todo" }} tailor={tailor} />
      </Root>,
    );

    await waitFor(() => {
      expect(testingView.getByText('TailorKit component "Button" is not registered.')).toBeTruthy();
    });
    expect(consoleError).toHaveBeenCalled();
  });

  it("clears a missing component error when switching apps", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const tailor = createTailorKitClient<typeof server>({
      baseUrl: "http://runtime.test",
      components,
    });

    const view = render(
      <Root client={tailor} apps={[{ clientPath: "/apps/missing-component.js", id: "bad" }]}>
        <HomeAppView
          app={{ clientPath: "/apps/missing-component.js", id: "bad" }}
          tailor={tailor}
        />
      </Root>,
    );

    await waitFor(() => {
      expect(
        testingView.getByText('TailorKit component "MissingComponent" is not registered.'),
      ).toBeTruthy();
    });

    await act(() => {
      view.rerender(
        <Root client={tailor} apps={[{ clientPath: "/apps/email.js", id: "email" }]}>
          <HomeAppView app={{ clientPath: "/apps/email.js", id: "email" }} tailor={tailor} />
        </Root>,
      );
    });

    await waitFor(() => {
      expect(
        testingView.queryByText('TailorKit component "MissingComponent" is not registered.'),
      ).toBeNull();
      expect(testingView.getByRole("button").textContent).toContain("/apps/email.js");
    });
  });
});

describe("view registries", () => {
  beforeEach(() => {
    hostRecords.length = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json({ schema: schema.serialize() })),
    );
  });
  afterEach(cleanup);

  function Layers({ detail = true }: { detail?: boolean }) {
    useView("/", { context: { user: { id: "u1" } } });
    useView("/home", { context: { page: { title: "Home" } } });
    return (
      <>
        {detail ? <Detail /> : null}
        <AppView slot="navbar" app={{ id: "nav", clientPath: "/nav.js" }} />
        <AppView slot="panel" app={{ id: "panel", clientPath: "/panel.js" }} />
      </>
    );
  }
  function Detail() {
    useView("/home/detail", { status: "loading" });
    return null;
  }

  it("publishes the same active chain to simultaneous slots and removes unmounted layers", async () => {
    const client = createTailorKitClient<typeof server>({
      baseUrl: "http://runtime.test",
      components,
    });
    const view = render(
      <Root client={client}>
        <Layers />
      </Root>,
    );
    await waitFor(() => expect(hostRecords).toHaveLength(2));
    expect(hostRecords.map((record) => record.props?.slot)).toEqual(["navbar", "panel"]);
    expect(hostRecords[0]?.props).toMatchObject({
      view: "/home/detail",
      layers: [
        { path: "/", context: { user: { id: "u1" } }, status: "ready" },
        { path: "/home", context: { page: { title: "Home" } }, status: "ready" },
        { path: "/home/detail", status: "loading" },
      ],
    });
    view.rerender(
      <Root client={client}>
        <Layers detail={false} />
      </Root>,
    );
    await waitFor(() => expect(hostRecords.at(-1)?.props?.view).toBe("/home"));
    expect(hostRecords.at(-1)?.props?.layers).toHaveLength(2);
    expect(hostRecords).toHaveLength(2); // Context changes must not remount either slot.
  });

  it("isolates roots sharing a client and survives Strict Mode effect replay", async () => {
    const client = createTailorKitClient<typeof server>({
      baseUrl: "http://runtime.test",
      components,
    });
    function OtherRoute() {
      useView("/user", { context: { userId: "other" } });
      return <AppView slot="panel" app={{ id: "other", clientPath: "/other.js" }} />;
    }
    render(
      <StrictMode>
        <Root client={client}>
          <Layers />
        </Root>
        <Root client={client}>
          <OtherRoute />
        </Root>
      </StrictMode>,
    );
    await waitFor(() =>
      expect(hostRecords.some((record) => record.appUrl.endsWith("other.js"))).toBe(true),
    );
    const other = hostRecords.find((record) => record.appUrl.endsWith("other.js"));
    expect(other?.props).toMatchObject({
      view: "/user",
      layers: [{ path: "/user", context: { userId: "other" } }],
    });
    expect(other?.props?.layers).toHaveLength(1);
    expect(hostRecords.find((record) => record.appUrl.endsWith("panel.js"))?.props?.view).toBe(
      "/home/detail",
    );
  });
});

it("replaces the root store only when the normalized endpoint changes", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = new URL(input.toString());
    return Promise.resolve(
      Response.json(
        url.pathname.endsWith("/apps") ? [{ id: url.hostname }] : { schema: schema.serialize() },
      ),
    );
  });
  function Contents() {
    const { data } = useApps();
    useView("/user", { context: { userId: "u1" } });
    return (
      <>
        <span>{data?.[0]?.id}</span>
        <AppView slot="panel" app={{ id: "test", clientPath: "client.js" }} />
      </>
    );
  }
  const client = (baseUrl: string | URL) =>
    createTailorKitClient<typeof server>({ baseUrl, components });
  const view = render(
    <Root client={client("http://first.test/api")}>
      <Contents />
    </Root>,
  );
  await waitFor(() => expect(testingView.getByText("first.test")).toBeTruthy());
  const count = fetchMock.mock.calls.length;
  view.rerender(
    <Root client={client(new URL("http://first.test/api/"))}>
      <Contents />
    </Root>,
  );
  expect(fetchMock.mock.calls).toHaveLength(count);
  view.rerender(
    <Root client={client("http://second.test/api")}>
      <Contents />
    </Root>,
  );
  await waitFor(() => expect(testingView.getByText("second.test")).toBeTruthy());
  await waitFor(() => expect(hostRecords.at(-1)?.appUrl).toBe("http://second.test/api/client.js"));
  expect(hostRecords.at(-1)?.props?.view).toBe("/user");
  view.unmount();
});

it("retains equivalent explicit context identity and publishes changed values", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(Response.json({ schema: schema.serialize() })),
  );
  const client = createTailorKitClient<typeof server>({
    baseUrl: "http://runtime.test",
    components,
  });
  const content = (userId: string) => (
    <Root client={client}>
      <AppView
        slot="panel"
        view="/user"
        context={{ userId }}
        app={{ id: "test", clientPath: "/client.js" }}
      />
    </Root>
  );
  const view = render(content("u1"));
  await waitFor(() => expect(hostRecords.at(-1)?.props?.view).toBe("/user"));
  const initialProps = hostRecords.at(-1)?.props;
  view.rerender(content("u1"));
  expect(hostRecords.at(-1)?.props).toBe(initialProps);
  view.rerender(content("u2"));
  await waitFor(() =>
    expect(hostRecords.at(-1)?.props?.layers).toEqual([
      { path: "/user", context: { userId: "u2" }, status: "ready" },
    ]),
  );
  view.unmount();
});

describe("supplied app discovery", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  function Apps() {
    const { data, status, refetch } = useApps();
    return (
      <button onClick={() => void refetch()}>
        {status}:{data?.map((app) => app.id).join(",")}
      </button>
    );
  }
  const client = createTailorKitClient({ baseUrl: "https://apps.test/api/" });

  it("uses supplied apps for discovery, including updates and empty lists, without fetching", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const view = render(
      <Root client={client} apps={[{ id: "first" }]}>
        <Apps />
      </Root>,
    );
    expect(testingView.getByText("ready:first")).toBeTruthy();
    await act(() => testingView.getByRole("button").click());
    view.rerender(
      <Root client={client} apps={[{ id: "second" }]}>
        <Apps />
      </Root>,
    );
    await waitFor(() => expect(testingView.getByText("ready:second")).toBeTruthy());
    view.rerender(
      <Root client={client} apps={[]}>
        <Apps />
      </Root>,
    );
    await waitFor(() => expect(testingView.getByText("ready:")).toBeTruthy());
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ignores an in-flight fetch when apps are supplied and resumes fetching when removed", async () => {
    let resolveRequest!: (response: Response) => void;
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRequest = resolve;
          }),
      )
      .mockResolvedValue(Response.json([{ id: "fresh" }]));
    const view = render(
      <Root client={client}>
        <Apps />
      </Root>,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    view.rerender(
      <Root client={client} apps={[{ id: "provided" }]}>
        <Apps />
      </Root>,
    );
    await waitFor(() => expect(testingView.getByText("ready:provided")).toBeTruthy());
    await act(() => {
      resolveRequest(Response.json([{ id: "stale" }]));
    });
    expect(testingView.getByText("ready:provided")).toBeTruthy();
    view.rerender(
      <Root client={client}>
        <Apps />
      </Root>,
    );
    await waitFor(() => expect(testingView.getByText("ready:fresh")).toBeTruthy());
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
