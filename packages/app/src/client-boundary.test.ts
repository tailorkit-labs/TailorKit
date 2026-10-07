import { expect, it } from "vite-plus/test";
import { build } from "vite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

it("exports the client API and public contract without importing private runtime code", async () => {
  const modules: string[] = [];
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-client-boundary-"));
  const entry = path.join(root, "entry.js");
  await writeFile(
    entry,
    `export * from ${JSON.stringify(path.resolve(import.meta.dirname, "../../tailorkit/dist/client.js"))}; export { defineServer } from ${JSON.stringify(path.resolve(import.meta.dirname, "../dist/index.js"))}; export { appContract } from ${JSON.stringify(path.resolve(import.meta.dirname, "../dist/protocol.js"))};`,
  );
  try {
    const result = await build({
      configFile: false,
      logLevel: "silent",
      plugins: [
        {
          name: "tailorkit-client-boundary-check",
          generateBundle() {
            modules.push(...this.getModuleIds());
          },
        },
      ],
      build: {
        write: false,
        minify: false,
        lib: { entry, formats: ["es"] },
      },
    });
    expect(modules.some((id) => /\/node_modules\/(?:effect|jose)\//u.test(id))).toBe(false);
    expect(modules.some((id) => id.includes("@orpc/server"))).toBe(false);
    expect(modules.some((id) => /(?:apps-worker|api-utils|app-platform)/u.test(id))).toBe(false);
    expect(modules.some((id) => /\/(?:auth|runtime)\.js$/u.test(id))).toBe(false);
    expect(modules.some((id) => /\/(?:tokens|verifier)\.[jt]s$/u.test(id))).toBe(false);
    expect(modules.some((id) => /\/@tanstack\/(?:store|preact-store)\//u.test(id))).toBe(false);
    expect(modules.some((id) => id.includes("/nanostores/"))).toBe(true);
    const outputs = Array.isArray(result) ? result : [result];
    const browser = outputs
      .flatMap((output) => ("output" in output ? output.output : []))
      .filter((output) => output.type === "chunk")
      .map((output) => output.code)
      .join("\n");
    for (const name of [
      "defineServer",
      "ClientProvider",
      "useQuery",
      "useMutation",
      "useAction",
      "appContract",
    ]) {
      expect(browser).toContain(name);
    }
    expect(browser).not.toContain("node:async_hooks");
    expect(browser).not.toContain("AsyncLocalStorage");
    expect(browser).not.toContain("SignJWT");
    expect(browser).not.toContain("createAppRuntimeVerifier");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
