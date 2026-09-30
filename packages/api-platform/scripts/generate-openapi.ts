import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { env } from "#env";

const outputPath = resolve(process.cwd(), process.argv[2] ?? "openapi.json");
const serverUrl = env.OPENAPI_SERVER_URL ?? "https://tailorkit.dev/api/platform";

const generator = new OpenAPIGenerator({
  converters: [new ZodToJsonSchemaConverter()],
});

const { platformRouter } = await import("../src/index");

const spec = await generator.generate(platformRouter, {
  version: "3.1.1",
  base: {
    info: {
      title: "Tailorkit Platform API",
      version: "0.0.0",
    },
    servers: [{ url: serverUrl }],
  },
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(spec, null, 2)}\n`);

console.log(`OpenAPI specification written to ${outputPath}`);
