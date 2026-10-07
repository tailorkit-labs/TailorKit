import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tailorkitUploadManifestSchema } from "./upload-manifest";
import type { InstanceRegistration } from "./instances";

// Inspect the developer's bundled client in a short-lived build process, never on the platform.
const inspectClient = `
import { readFile } from "node:fs/promises";
const source = await readFile(process.argv[1], "utf8");
const { default: client } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
if (!client?.slots || typeof client.slots !== "object") throw new Error("Client must default-export defineClient(...)");
const instanceResolvers = [];
const views = Object.entries(client.slots).flatMap(([slot, definitions]) =>
  Object.entries(definitions).flatMap(([path, view]) => {
    if (view === false) return [{ slot, path, disabled: true }];
    const resolver = view?.instances?.resolver;
    if (resolver !== undefined) instanceResolvers.push({ slot, path, resolver });
    return [{ slot, path, ...(resolver !== undefined ? { instances: true } : {}) }];
  })
);
process.stdout.write("\\nTAILORKIT_VIEWS=" + JSON.stringify({ views, instanceResolvers }));
process.exit(0);
`;

export async function readClientViews(filename: string) {
  return (await readClientManifest(filename)).views.filter((view) => !view.disabled);
}

export async function readClientManifest(filename: string) {
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--input-type=module", "--eval", inspectClient, filename],
      { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const result = stdout.slice(
      stdout.lastIndexOf("\nTAILORKIT_VIEWS=") + "\nTAILORKIT_VIEWS=".length,
    );
    const manifest = JSON.parse(result) as { views: unknown; instanceResolvers: unknown };
    const views = tailorkitUploadManifestSchema.shape.views.unwrap().parse(manifest.views);
    if (
      !Array.isArray(manifest.instanceResolvers) ||
      manifest.instanceResolvers.some(
        (ref) =>
          !ref ||
          typeof ref !== "object" ||
          typeof ref.slot !== "string" ||
          typeof ref.path !== "string" ||
          typeof ref.resolver !== "string" ||
          !/^i[0-9a-f]{24}$/u.test(ref.resolver),
      )
    ) {
      throw new Error("Invalid instance resolver references");
    }
    return { views, instanceResolvers: manifest.instanceResolvers as InstanceRegistration[] };
  } catch (error) {
    throw new Error(
      "Unable to read app views during the build. Keep browser-only side effects inside components or effects, and default-export defineClient(...).",
      { cause: error },
    );
  }
}
