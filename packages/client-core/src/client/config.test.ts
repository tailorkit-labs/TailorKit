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
  const config = createTailorKitClientConfig({ baseUrl: "https://host.test/api/", fetch });
  expect(config.theme).toEqual({});
  expect(config.components).toEqual({});
  expect(config.fetchClient?.baseUrl.href).toBe("https://host.test/api/");
  expect(fetch).not.toHaveBeenCalled();
});
