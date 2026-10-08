import { defineDatabase } from "tailorkit/server";
import { relations } from "./relations";

export const db = defineDatabase({ relations });

export * from "./schema";
