import { Effect } from "effect";
import artifact from "app-storage-artifact";
import { createStorageDurableObject, createStorageWorker } from "./worker";

// App code stays serialized until the supervisor loads it into an isolated facet.
export class AppStorage extends createStorageDurableObject(
  () => ({ get: () => Effect.succeed(artifact) }),
  true,
) {}

export default createStorageWorker(artifact);
