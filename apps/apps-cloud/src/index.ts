import artifact from "app-storage-artifact";
import { createStorageDurableObject, createStorageWorker } from "./worker";

// App code stays serialized until the supervisor loads it into an isolated facet.
export class AppStorage extends createStorageDurableObject(artifact) {}

export default artifact.codeHash === "unconfigured"
  ? {
      fetch: () =>
        new Response("Configure an app storage artifact and trusted host keys first.", {
          status: 503,
        }),
    }
  : createStorageWorker(artifact);
