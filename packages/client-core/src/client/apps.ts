import type { TailorKitApp } from "../types";

export function matchesApp(
  app: TailorKitApp,
  scopes?: readonly string[],
  appIds?: readonly string[],
): boolean {
  return (
    (scopes === undefined || (app.scope !== undefined && scopes.includes(app.scope.name))) &&
    (appIds === undefined || appIds.includes(app.id))
  );
}
