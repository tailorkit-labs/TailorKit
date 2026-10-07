import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { Root, createTailorKitClient } from "../index";
import type { UseViewsOptions } from "../index";

import { createTailorKitServer } from "@tailorkit/core/server";
const scope = {
  "~standard": {
    version: 1 as const,
    vendor: "test",
    jsonSchema: { input: () => ({}), output: () => ({}) },
    validate: () => ({ value: {} }),
  },
};
const server = createTailorKitServer({
  scopes: { user: scope, organization: scope },
  components: {},
  views: { "/": scope, "/detail": scope },
  slots: { page: { views: ["/"] }, panel: { views: ["/detail"] } },
});
const client = createTailorKitClient<typeof server>({
  baseUrl: "https://host.test/api/tailorkit/",
});
const apps = [
  {
    id: "a",
    scope: { name: "user" },
    views: [
      { slot: "page", path: "/", instances: true as const },
      { slot: "panel", path: "/detail" },
      { slot: "page", path: "/disabled", disabled: true as const },
    ],
  },
  { id: "b", scope: { name: "organization" }, views: [{ slot: "page", path: "/" }] },
  { id: "legacy" },
];

afterEach(() => {
  cleanup();
  client.fetchClient?.clear();
  vi.restoreAllMocks();
});

it("shares cached discovery across roots and refreshes stale data on remount", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(Response.json(apps)));
  function Apps() {
    const result = client.useApps();
    return (
      <span>
        {result.status}:{result.data?.length}
      </span>
    );
  }
  const first = render(
    <Root client={client}>
      <Apps />
    </Root>,
  );
  await waitFor(() => expect(screen.getByText("ready:3")).toBeTruthy());
  const second = render(
    <Root client={client}>
      <Apps />
    </Root>,
  );
  expect(fetch).toHaveBeenCalledOnce();
  first.unmount();
  second.unmount();
  const fresh = render(
    <Root client={client}>
      <Apps />
    </Root>,
  );
  expect(screen.getByText("ready:3")).toBeTruthy();
  expect(fetch).toHaveBeenCalledOnce();
  fresh.unmount();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30_001);
  render(
    <Root client={client}>
      <Apps />
    </Root>,
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
});

function Views({
  options = {},
}: {
  options?: UseViewsOptions<"user" | "organization", "page" | "panel">;
}) {
  const { data, status, error, refetch } = client.useViews(options);
  return (
    <button onClick={() => void refetch()}>
      {error?.message ??
        `${status}:${data?.map((view) => `${view.app.id}/${view.slot}${view.path}`).join(",") ?? ""}`}
    </button>
  );
}

it("shares one request with useApps, intersects local filters, and never refetches on filter changes", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(apps));
  function Apps() {
    const { data } = client.useApps({ scopes: ["user"] });
    return <p>{data?.map((app) => app.id).join(",")}</p>;
  }
  const content = (options?: UseViewsOptions<"user" | "organization", "page" | "panel">) => (
    <StrictMode>
      <Root client={client}>
        <Apps />
        <Views options={options} />
      </Root>
    </StrictMode>
  );
  const view = render(content());
  await waitFor(() =>
    expect(screen.getByText("ready:a/page/,a/panel/detail,b/page/")).toBeTruthy(),
  );
  expect(screen.getByText("a")).toBeTruthy();
  view.rerender(content({ scopes: ["user", "organization"], appIds: ["b"], slot: "page" }));
  expect(screen.getByText("ready:b/page/")).toBeTruthy();
  view.rerender(content({ scopes: ["user"], appIds: ["b"] }));
  expect(screen.getByText("ready:")).toBeTruthy();
  view.rerender(content({ scopes: [] }));
  expect(screen.getByText("ready:")).toBeTruthy();
  view.rerender(content({ appIds: [] }));
  expect(screen.getByText("ready:")).toBeTruthy();
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    new URL("https://host.test/api/tailorkit/apps"),
    expect.objectContaining({ signal: expect.any(AbortSignal), credentials: "same-origin" }),
  );
});

it("discovers supplied views without fetching and updates them when supplied apps change", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const view = render(
    <Root client={client} apps={apps}>
      <Views />
    </Root>,
  );
  expect(screen.getByText("ready:a/page/,a/panel/detail,b/page/")).toBeTruthy();
  view.rerender(
    <Root client={client} apps={[]}>
      <Views />
    </Root>,
  );
  await waitFor(() => expect(screen.getByText("ready:")).toBeTruthy());
  expect(fetch).not.toHaveBeenCalled();
});

it("exposes discovery errors and refetch refreshes both hooks", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockResolvedValueOnce(Response.json(apps));
  function Apps() {
    const { data } = client.useApps();
    return <p>{data?.length}</p>;
  }
  render(
    <Root client={client}>
      <Views />
      <Apps />
    </Root>,
  );
  await waitFor(() => expect(screen.getByText(/Unable to fetch TailorKit apps/u)).toBeTruthy());
  await act(() => screen.getByRole("button").click());
  await waitFor(() =>
    expect(screen.getByText("ready:a/page/,a/panel/detail,b/page/")).toBeTruthy(),
  );
  expect(screen.getByText("3")).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("gives distinct stable identities to views from different apps and slots", () => {
  const identities: string[][] = [];
  function Capture() {
    identities.push(client.useViews().data?.map((view) => view.id) ?? []);
    return null;
  }
  const view = render(
    <Root client={client} apps={apps}>
      <Capture />
    </Root>,
  );
  expect(new Set(identities[0]).size).toBe(3);
  view.rerender(
    <Root client={client} apps={[...apps]}>
      <Capture />
    </Root>,
  );
  expect(identities.at(-1)).toEqual(identities[0]);
});

it("rejects useViews under another client's Root", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const other = createTailorKitClient({ baseUrl: "https://other.test/api/" });
  expect(() =>
    render(
      <Root client={other}>
        <Views />
      </Root>,
    ),
  ).toThrow("useViews was created for a different TailorKit client");
});

it("exposes instance support from the shared app manifest without another request", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(apps));
  function Capture() {
    const { data } = client.useViews();
    return <p>{data?.map((view) => String(view.instances)).join(",")}</p>;
  }
  render(
    <Root client={client}>
      <Capture />
    </Root>,
  );
  await waitFor(() => expect(screen.getByText("true,undefined,undefined")).toBeTruthy());
  expect(fetch).toHaveBeenCalledTimes(1);
});
