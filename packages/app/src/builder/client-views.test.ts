import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vite-plus/test";
import { readClientManifest, readClientViews } from "./client-views";

it("reads actual slot declarations, including computed paths, and excludes disabled views", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-client-views-"));
  const filename = path.join(root, "client.js");
  try {
    await writeFile(
      filename,
      `const path = "/detail"; export default { slots: { page: { "/": { component() {} }, [path]: false }, panel: { [path]: { component() {} } } } };`,
    );
    expect(await readClientViews(filename)).toEqual([
      { slot: "page", path: "/" },
      { slot: "panel", path: "/detail" },
    ]);
    await writeFile(filename, "export default { slots: { page: { invalid: {} } } };");
    await expect(readClientViews(filename)).rejects.toThrow("Unable to read app views");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("preserves instance availability and registrations when one view is used in multiple slots", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-instance-manifest-"));
  const filename = path.join(root, "client.js");
  const resolver = "i0123456789abcdef01234567";
  try {
    await writeFile(
      filename,
      `const view = { instances: { resolver: "${resolver}" } }; export default { slots: { "page.links": { "/reports/annual.summary": view }, panel: { "/": view, "/disabled": false } } };`,
    );
    const manifest = await readClientManifest(filename);
    expect(manifest.views).toEqual([
      { slot: "page.links", path: "/reports/annual.summary", instances: true },
      { slot: "panel", path: "/", instances: true },
      { slot: "panel", path: "/disabled", disabled: true },
    ]);
    expect(manifest.instanceResolvers).toEqual([
      { slot: "page.links", path: "/reports/annual.summary", resolver },
      { slot: "panel", path: "/", resolver },
    ]);
    expect(JSON.stringify(manifest.views)).not.toContain(resolver);
    await writeFile(
      filename,
      `export default { slots: { page: { "/": { instances: { resolver: "invalid" } } } } };`,
    );
    await expect(readClientManifest(filename)).rejects.toThrow("Unable to read app views");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
