import { rm } from "node:fs/promises";
await rm(new URL("../.tailorkit/state", import.meta.url), { recursive: true, force: true });
