import { expect, it, vi } from "vite-plus/test";
import type { TailorKitApp } from "../types";
import { createEndpointClient } from "./endpoints";
import { createTailorKitFetchClient } from "./fetch-client";

function session(token: string) {
  return Response.json({
    subjectId: "principal",
    token,
    expiresAt: Date.now() + 300_000,
    url: "https://runtime.test/rpc",
  });
}

const deployedApp: TailorKitApp = { id: "app", currentDeployment: { id: "first" } };
const previewApp: TailorKitApp = {
  ...deployedApp,
  preview: {
    sessionId: "preview",
    expiresAt: new Date().toISOString(),
    websocketUrl: "wss://host.test/preview",
    token: "preview-token",
  },
};

it.each([
  ["deployment", { ...deployedApp, currentDeployment: { id: "second" } }],
  ["preview", previewApp],
])("replaces obsolete %s sessions while held providers follow the current app", async (_, next) => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(session("first"))
    .mockResolvedValueOnce(session("other"))
    .mockResolvedValueOnce(session("second"))
    .mockResolvedValueOnce(session("third"));
  const client = createEndpointClient({ baseUrl: "https://host.test/", fetch: request });
  client.setSubject("principal");
  const held = client.getSessionProvider(deployedApp);
  const other = client.getSessionProvider({ id: "other" });
  await expect(held({ refresh: false })).resolves.toMatchObject({ token: "first" });
  await expect(other({ refresh: false })).resolves.toMatchObject({ token: "other" });
  const current = client.getSessionProvider(next);
  await expect(current({ refresh: false })).resolves.toMatchObject({ token: "second" });
  await expect(held({ refresh: false })).resolves.toMatchObject({ token: "second" });
  expect(client.getSessionProvider(next)).toBe(current);
  await expect(other({ refresh: false })).resolves.toMatchObject({ token: "other" });
  // Revisiting a deployment must not retrieve its previously cached credentials.
  const restored = client.getSessionProvider(deployedApp);
  expect(restored).not.toBe(held);
  await expect(restored({ refresh: false })).resolves.toMatchObject({ token: "third" });
  await expect(current({ refresh: false })).resolves.toMatchObject({ token: "third" });
  expect(request).toHaveBeenCalledTimes(4);
});

it("clears sessions for held consumers through the public client and shares replacement requests", async () => {
  let respond: (response: Response) => void = () => {};
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(session("before"))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    )
    .mockResolvedValueOnce(session("after-again"));
  const fetchClient = createTailorKitFetchClient({ baseUrl: "https://host.test/", fetch: request });
  const client = fetchClient.endpoints;
  client.setSubject("principal");
  const held = client.getSessionProvider(deployedApp);
  await held({ refresh: false });
  fetchClient.clear();
  const pending = held({ refresh: false });
  const fresh = client.getSessionProvider(deployedApp);
  expect(fresh).not.toBe(held);
  const second = fresh({ refresh: false });
  expect(request).toHaveBeenCalledTimes(2);
  respond(session("after"));
  await expect(pending).resolves.toMatchObject({ token: "after" });
  await expect(second).resolves.toMatchObject({ token: "after" });
  fetchClient.clear();
  await expect(held({ refresh: false })).resolves.toMatchObject({ token: "after-again" });
  await expect(fresh({ refresh: false })).resolves.toMatchObject({ token: "after-again" });
  expect(request).toHaveBeenCalledTimes(3);
});

it.each(["clear", "deployment", "preview"])(
  "rejects a late session response after %s invalidates its credentials",
  async (change) => {
    let respond: (response: Response) => void = () => {};
    const request = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            respond = resolve;
          }),
      )
      .mockResolvedValueOnce(session("current"));
    const client = createEndpointClient({ baseUrl: "https://host.test/", fetch: request });
    client.setSubject("principal");
    const held = client.getSessionProvider(deployedApp);
    const pending = held({ refresh: false });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    if (change === "clear") client.clearSessions();
    else
      client.getSessionProvider(
        change === "preview" ? previewApp : { ...deployedApp, currentDeployment: { id: "second" } },
      );
    await expect(held({ refresh: false })).resolves.toMatchObject({ token: "current" });
    respond(session("obsolete"));
    await rejected;
    await expect(held({ refresh: false })).resolves.toMatchObject({ token: "current" });
    expect(request).toHaveBeenCalledTimes(2);
  },
);
