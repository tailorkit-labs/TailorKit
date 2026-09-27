// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vite-plus/test";
import type { ViewLayer } from "@tailorkit/core/views";
import { assertAppClient, renderClient } from "./resolve-view";
import type { AppClient, ViewRequest } from "./resolve-view";

function viewResolver() {
  const root = document.createElement("div");
  return (client: AppClient, props: ViewRequest) => renderClient(client, props, root);
}

function viewClient() {
  const render = vi.fn();
  const navigation = { component: vi.fn() };
  const general = { component: vi.fn() };
  const detail = { component: vi.fn() };
  return {
    navigation,
    general,
    detail,
    render,
    client: {
      slots: {
        navbar: { "/": navigation },
        panel: { "/users": general, "/users/detail": detail },
      },
      $runtime: { h: (component: unknown, props: unknown) => ({ component, props }), render },
    },
  };
}

const viewLayers: [ViewLayer, ViewLayer, ViewLayer] = [
  { path: "/", context: { workspaceId: "w1" }, status: "ready" },
  { path: "/users", context: { canManageUsers: true }, status: "ready" },
  { path: "/users/detail", context: { userId: "u1" }, status: "ready" },
];

function resolveProps(slot: string, layers: ViewLayer[] = viewLayers) {
  return {
    slot,
    view: "/users/detail",
    layers,
    declaredViews: viewLayers.map((layer) => layer.path),
    supportedViews: slot === "navbar" ? ["/"] : ["/", "/users", "/users/detail"],
  };
}

describe("slot view resolution", () => {
  it("selects one view per slot and composes only its ancestors", () => {
    const resolve = viewResolver();
    const { client, navigation, detail, general, render } = viewClient();
    resolve(client, resolveProps("navbar"));
    expect(render.mock.calls[0]?.[0]).toEqual({
      component: navigation.component,
      props: {
        view: "/",
        status: "ready",
        context: { workspaceId: "w1" },
      },
    });
    resolve(client, resolveProps("panel"));
    expect(render.mock.calls[1]?.[0]).toEqual({
      component: detail.component,
      props: {
        view: "/users/detail",
        status: "ready",
        context: { workspaceId: "w1", canManageUsers: true, userId: "u1" },
      },
    });
    expect(render.mock.calls.some(([node]) => node?.component === general.component)).toBe(false);
  });

  it.each(["loading", "error"] as const)("keeps navbar ready when detail is %s", (status) => {
    const resolve = viewResolver();
    const { client, render } = viewClient();
    const layers = viewLayers.map((layer) =>
      layer.path === "/users/detail" ? { ...layer, status } : layer,
    );
    resolve(client, resolveProps("navbar", layers));
    expect(render.mock.calls[0]?.[0].props.status).toBe("ready");
    resolve(client, resolveProps("panel", layers));
    expect(render.mock.calls[1]?.[0].props).toMatchObject({
      view: "/users/detail",
      status,
      context: undefined,
    });
  });

  it("falls back within a slot using the parent's own readiness", () => {
    const resolve = viewResolver();
    const { client, general, render } = viewClient();
    const fallbackClient = { ...client, slots: { panel: { "/users": general } } };
    resolve(
      fallbackClient,
      resolveProps(
        "panel",
        viewLayers.map((layer) => ({
          ...layer,
          status: layer.path === "/users/detail" ? "error" : "ready",
        })),
      ),
    );
    expect(render.mock.calls[0]?.[0]).toEqual({
      component: general.component,
      props: {
        view: "/users",
        status: "ready",
        context: { workspaceId: "w1", canManageUsers: true },
      },
    });
  });

  it("clears an existing view for unsupported slots and blocked fallback", () => {
    const resolve = viewResolver();
    const { client, render } = viewClient();
    resolve(client, resolveProps("panel"));
    resolve(client, resolveProps("missing"));
    expect(render.mock.calls.at(-1)?.[0]).toBeNull();
    resolve(
      {
        ...client,
        slots: {
          panel: { "/": client.slots.navbar["/"], "/users": false },
        },
      },
      resolveProps("panel"),
    );
    expect(render.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it("does not expose partial context when an ancestor is missing or unavailable", () => {
    const resolve = viewResolver();
    const { client, render } = viewClient();
    resolve(client, resolveProps("panel", viewLayers.slice(1)));
    expect(render.mock.calls.at(-1)?.[0].props).toMatchObject({
      status: "error",
      context: undefined,
    });
    resolve(
      client,
      resolveProps(
        "panel",
        viewLayers.map((layer) => ({
          ...layer,
          status: layer.path === "/" ? "loading" : "ready",
        })),
      ),
    );
    expect(render.mock.calls.at(-1)?.[0].props).toMatchObject({
      status: "loading",
      context: undefined,
    });
  });
});

it("limits matching to supported views while retaining ancestor data", () => {
  const resolve = viewResolver();
  const { client, general, render } = viewClient();
  resolve(client, { ...resolveProps("panel"), supportedViews: ["/users"] });
  expect(render.mock.calls.at(-1)?.[0]).toEqual({
    component: general.component,
    props: {
      view: "/users",
      status: "ready",
      context: { workspaceId: "w1", canManageUsers: true },
    },
  });
  resolve(client, { ...resolveProps("panel"), supportedViews: [] });
  expect(render.mock.calls.at(-1)?.[0]).toBeNull();
});

it.each([null, undefined, { mount: () => {} }])(
  "rejects a module without a standard client (%j)",
  (client) => {
    expect(() => assertAppClient(client)).toThrow("defineClient()");
  },
);

it.each([42, 0, "user", "", true, false, null, ["u1"]])(
  "rejects non-object context %j without exposing partial ancestor data",
  (context) => {
    const resolve = viewResolver();
    const { client, render } = viewClient();
    resolve(client, {
      ...resolveProps("panel"),
      layers: viewLayers.map((layer) =>
        layer.path === "/users/detail" ? { ...layer, context } : layer,
      ),
    });
    expect(render.mock.calls.at(-1)?.[0].props).toEqual({
      view: "/users/detail",
      status: "error",
      context: undefined,
    });
    resolve(client, resolveProps("panel"));
    expect(render.mock.calls.at(-1)?.[0].props).toMatchObject({
      status: "ready",
      context: { workspaceId: "w1", canManageUsers: true, userId: "u1" },
    });
  },
);

it("composes named array fields and omitted optional object contexts", () => {
  const resolve = viewResolver();
  const { client, render } = viewClient();
  resolve(client, {
    ...resolveProps("panel"),
    layers: [
      { path: "/", status: "ready", context: undefined },
      { path: "/users", status: "ready", context: { userIds: ["u1", "u2"] } },
      viewLayers[2],
    ],
  });
  expect(render.mock.calls.at(-1)?.[0].props).toEqual({
    view: "/users/detail",
    status: "ready",
    context: { userIds: ["u1", "u2"], userId: "u1" },
  });
});
