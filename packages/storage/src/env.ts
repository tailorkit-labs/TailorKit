import * as z from "zod";
import { createEnv, warnIfMissing } from "@tailorkit/env";

export const env = createEnv({
  scope: "storage",
  schema: {
    BLOB_BUCKET: z.string().min(1).optional(),
    BLOB_ENDPOINT: z.url().optional(),
    BLOB_REGION: z.string().min(1).optional(),
    BLOB_FORCE_PATH_STYLE: z.stringbool().optional(),
    BLOB_ACCESS_KEY_ID: z.string().min(1).optional(),
    BLOB_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  },
});

if (env.BLOB_BUCKET) {
  warnIfMissing("storage", {
    BLOB_ACCESS_KEY_ID: env.BLOB_ACCESS_KEY_ID,
    BLOB_SECRET_ACCESS_KEY: env.BLOB_SECRET_ACCESS_KEY,
  });
}
