import { readFile, writeFile } from "node:fs/promises";

const file = new URL("../src/client/core/serverSentEvents.gen.ts", import.meta.url);
const source = await readFile(file, "utf8");
// Fetch can error the body before abort cancels its reader. Handle the rejected
// cancellation promise so Ctrl+C never becomes an unhandled rejection.
const output = source.replace("reader.cancel();", "void reader.cancel().catch(() => {});");
if (output !== source) await writeFile(file, output);
