// @vitest-environment happy-dom
import { h, render } from "preact";
import type { ComponentChild } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vite-plus/test";

vi.stubGlobal("__PREACT_VERSION__", "10.29.8");
const { createView, defineClient } = await import("./views");
const roots: HTMLElement[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) render(null, root);
});

function root() {
  const element = document.createElement("div");
  roots.push(element);
  return element;
}

it("supplies instance data and context, updates data, and resets component state when the key changes", async () => {
  const view = createView({
    slot: "page",
    view: "/",
    instances: { resolver: "compiled-resolver" } as never,
    component: (): ComponentChild => {
      const instance = view.useInstance();
      const context = view.useContext();
      const [initialKey] = useState(instance.key);
      return h(
        "span",
        {},
        `${context.workspaceId}:${instance.key}:${JSON.stringify(instance.data)}:${initialKey}`,
      );
    },
  });
  const container = root();
  const show = (key: string, data: unknown) =>
    act(() =>
      render(
        h(view.component, {
          view: "/",
          status: "ready",
          context: { workspaceId: "u1" },
          instance: { key, metadata: {}, data },
        }),
        container,
      ),
    );
  await show("overview", { count: 1 });
  expect(container.textContent).toBe('u1:overview:{"count":1}:overview');
  await show("overview", { count: 2 });
  expect(container.textContent).toBe('u1:overview:{"count":2}:overview');
  await show("summary", null);
  expect(container.textContent).toBe("u1:summary:null:summary");
  await act(() => render(h(view.component, { view: "/", status: "loading" }), container));
  expect(container.textContent).toBe("");
  await show("summary", { count: 3 });
  expect(container.textContent).toBe('u1:summary:{"count":3}:summary');
});

it("keeps ordinary views rendering without an instance", async () => {
  const view = createView({ slot: "navbar", view: "/", component: () => "ordinary" });
  const container = root();
  await act(() =>
    render(
      h(view.component, { view: "/", status: "ready", context: { workspaceId: "w1" } }),
      container,
    ),
  );
  expect(container.textContent).toBe("ordinary");
});

it("reports missing instances and useInstance outside its view", () => {
  const view = createView({
    slot: "page",
    view: "/",
    instances: { resolver: "compiled-resolver" } as never,
    component: () => "never",
  });
  expect(() =>
    render(
      h(view.component, { view: "/", status: "ready", context: { workspaceId: "w1" } }),
      root(),
    ),
  ).toThrow("requires a selected instance");
  function Outside() {
    view.useInstance();
    return null;
  }
  expect(() => render(h(Outside, {}), root())).toThrow("View instance is only available");
});

it("rejects registration under a different slot in JavaScript apps", () => {
  const view = createView({ slot: "navbar", view: "/", component: () => null });
  // @ts-expect-error Exercise runtime validation for untyped registrations.
  expect(() => defineClient({ slots: { panel: { "/": view } } })).toThrow(
    'created for slot "navbar", not "panel"',
  );
});
