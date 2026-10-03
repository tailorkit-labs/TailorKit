import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../src/client/core/params.gen.ts", import.meta.url));
const source = await readFile(path, "utf8");

const replacements = [
  [
    "  const map = buildKeyMap(fields);\n\n  function writeSlot",
    '  const map = buildKeyMap(fields);\n  let bodyMode: "mapped" | "raw" | undefined;\n\n  function writeSlot',
  ],
  [
    "  function writeSlot(slot: Slot, key: string, value: unknown): void {\n    let record = params[slot] as Record<string, unknown> | undefined;",
    '  function writeSlot(slot: Slot, key: string, value: unknown): void {\n    if (slot === "body") {\n      if (bodyMode === "raw") {\n        throw new Error("Cannot mix raw and mapped body parameters.");\n      }\n      bodyMode = "mapped";\n    }\n\n    let record = params[slot] as Record<string, unknown> | undefined;',
  ],
  [
    "    record[key] = value;\n  }\n\n  let config",
    '    if (record === null || typeof record !== "object" || Array.isArray(record)) {\n      throw new Error(`Cannot map fields into a non-object ${slot} parameter.`);\n    }\n    record[key] = value;\n  }\n\n  function writeRawSlot(slot: Slot, value: unknown): void {\n    if (slot === "body") {\n      if (bodyMode === "mapped") {\n        throw new Error("Cannot mix raw and mapped body parameters.");\n      }\n      bodyMode = "raw";\n      params.body = value;\n      return;\n    }\n    params[slot] = value as Record<string, unknown>;\n  }\n\n  let config',
  ],
  ["        params.body = arg;", '        writeRawSlot("body", arg);'],
  ["            params[field.map] = value;", "            writeRawSlot(field.map, value);"],
];

let output = source;
for (const [from, to] of replacements) {
  if (!output.includes(from)) {
    throw new Error(
      "openapi-ts output changed; update restore-openapi-params.mjs before generating.",
    );
  }
  output = output.replace(from, to);
}

await writeFile(path, output);
