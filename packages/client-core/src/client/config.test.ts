import { testContract } from "../test-contract";
import { expect, it, vi } from "vite-plus/test";
import { createComponentRegistry, createTailorKitClientConfig } from "./config";

it("wraps each renderer once and shares it with remote component aliases", () => {
  const renderer = { id: "renderer" };
  const wrap = vi.fn((value: typeof renderer) => ({ wrapped: value }));
  const registry = createComponentRegistry({ CustomerCard: renderer, Missing: undefined }, wrap);
  expect(wrap).toHaveBeenCalledOnce();
  expect(registry.CustomerCard).toBe(registry["tailorkit-customer-card"]);
  expect(registry).not.toHaveProperty("Missing");
});

it("builds reusable client configuration without initiating network requests", () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const config = createTailorKitClientConfig({
    contract: testContract(),
    baseUrl: "https://host.test/api/",
    fetch,
  });
  expect(config.theme).toEqual({});
  expect(config.components).toEqual({});
  expect(config.fetchClient?.baseUrl.href).toBe("https://host.test/api/");
  expect(fetch).not.toHaveBeenCalled();
});

it("clears shared app data and sessions through clearCache", async () => {
  let user = "first";
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (input) =>
      Response.json(
        String(input).endsWith("/apps")
          ? [{ id: user }]
          : { token: user, expiresAt: Date.now() + 300_000, url: "https://runtime.test/rpc" },
      ),
    );
  const config = createTailorKitClientConfig({
    contract: testContract(),
    baseUrl: "https://host.test/api/",
    fetch,
  });
  const client = config.fetchClient!;
  const apps = client.apps();
  const session = client.endpoints.getSessionProvider({ id: "app" });
  await apps.fetch();
  await expect(session({ refresh: false })).resolves.toMatchObject({ token: "first" });

  user = "second";
  config.clearCache();
  expect(apps.getSnapshot().data).toBeUndefined();
  await apps.fetch();
  expect(apps.getSnapshot().data).toEqual([{ id: "second" }]);
  await expect(session({ refresh: false })).resolves.toMatchObject({ token: "second" });
  expect(fetch).toHaveBeenCalledTimes(4);
});
