declare module "application.js" {
  const app: import("@tailorkit/app/server").ApplicationModule["default"];
  export default app;
  export const migrations: import("@tailorkit/app/server").ApplicationModule["migrations"];
  export const runtimeManifest: import("@tailorkit/app/server").ApplicationModule["runtimeManifest"];
}
