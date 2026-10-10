import { afterEach, expect, it, vi } from "vite-plus/test";
import { createDeploymentClient } from "./deployment-client";

afterEach(() => vi.restoreAllMocks());

it("verifies, creates apps, and publishes using only the platform and the CLI token", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response("{}", {
        headers: { "content-type": "application/json" },
      }),
  );
  const client = createDeploymentClient("approved-token");
  await client.verify();
  await client.apps.create({ name: "App", description: null });
  await client.deployments.create({
    appId: "app-one",
    assets: [
      {
        checksum: "a".repeat(64),
        contentLength: 10,
        contentType: "application/javascript",
        encoding: "gzip",
        objectKey: "client.js",
      },
    ],
  });
  await client.deployments.publish({ deploymentId: "deployment-one", rollout: true });
  const requests = fetch.mock.calls.map(([input]) => input as Request);
  expect(requests.map((request) => request.url)).toEqual([
    "https://tailorkit.dev/api/platform/cli/verify",
    "https://tailorkit.dev/api/platform/cli/apps",
    "https://tailorkit.dev/api/platform/cli/deployments",
    "https://tailorkit.dev/api/platform/cli/deployments/deployment-one",
  ]);
  for (const request of requests) {
    expect(request.headers.get("authorization")).toBe("Bearer approved-token");
    expect(await request.json()).not.toHaveProperty("scope");
  }
});

it("preserves actionable platform error messages and codes", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json(
      {
        code: "UNAUTHORIZED",
        message: "Invalid CLI deploy token.",
      },
      { status: 401 },
    ),
  );
  await expect(createDeploymentClient("expired").verify()).rejects.toMatchObject({
    message: "Invalid CLI deploy token.",
    code: "UNAUTHORIZED",
  });
});
