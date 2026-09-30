import { platformArtifacts } from "./artifact-source";
import { createStorageDurableObject, createStorageWorker } from "./worker";

export class AppStorage extends createStorageDurableObject(platformArtifacts) {}
export default createStorageWorker();
