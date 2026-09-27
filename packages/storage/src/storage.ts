import { env } from "#env";
import { createS3CompatibleStorage } from "./s3.js";
import type { Storage } from "./types.js";

type StorageInstance = Storage<"s3"> | null;

let instance: StorageInstance | undefined;

function createStorage(): StorageInstance {
  if (!env.BLOB_BUCKET) {
    return null;
  }

  return createS3CompatibleStorage({
    bucket: env.BLOB_BUCKET,
    region: env.BLOB_REGION,
    endpoint: env.BLOB_ENDPOINT,
    accessKeyId: env.BLOB_ACCESS_KEY_ID,
    secretAccessKey: env.BLOB_SECRET_ACCESS_KEY,
    forcePathStyle: env.BLOB_FORCE_PATH_STYLE ?? Boolean(env.BLOB_ENDPOINT),
  });
}

export function getStorage(): StorageInstance {
  if (instance !== undefined) {
    return instance;
  }

  instance = createStorage();
  return instance;
}
