import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vite-plus/test";
import { buildApp } from "./index";

it("builds separate artifacts and rejects accidental imports of server code", async () => {
  const root = path.resolve(import.meta.dirname, "../../../../examples/apps/backend-todo");
  const client = await readFile(path.join(root, "src/client.ts"), "utf8");
  try {
    await buildApp({ cwd: root });
    const browser = await readFile(path.join(root, ".tailorkit/client.js"), "utf8");
    const server = await readFile(path.join(root, ".tailorkit-server/server.js"), "utf8");
    const refs = await readFile(path.join(root, "src/server.gen.ts"), "utf8");
    expect(server).toContain("tailorkit_receipts");
    expect(browser).not.toContain("tailorkit_receipts");
    expect(browser).not.toContain("Todo does not exist");
    expect(browser).not.toContain("cloudflare:workers");
    expect(browser).not.toContain("jwtVerify");
    expect(browser).not.toContain("SignJWT");
    expect(refs).toContain('import type app from "./server"');
    expect(
      JSON.parse(await readFile(path.join(root, ".tailorkit/tailorkit-upload.json"), "utf8"))
        .assets,
    ).toEqual({ client: "client.js", server: "server.js" });
    await writeFile(path.join(root, "src/client.ts"), 'import "./server";\n' + client);
    await expect(buildApp({ cwd: root })).rejects.toThrow(
      "cannot be imported into a browser bundle",
    );
    await writeFile(
      path.join(root, "src/client.ts"),
      'import "@tailorkit/apps-server/auth";\n' + client,
    );
    await expect(buildApp({ cwd: root })).rejects.toThrow(
      "cannot be imported into a browser bundle",
    );
    await expect(buildApp({ cwd: root, outDir: ".tailorkit-server" })).rejects.toThrow(
      "must not clear server state",
    );
  } finally {
    await writeFile(path.join(root, "src/client.ts"), client);
    await rm(path.join(root, ".tailorkit"), { recursive: true, force: true });
  }
}, 15_000);
