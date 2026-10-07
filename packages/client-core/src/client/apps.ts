import type { TailorKitApp, TailorKitView } from "../types";

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

export function listViews(apps: TailorKitApp[]): TailorKitView[] {
  return apps.flatMap((app) =>
    (app.views ?? [])
      .filter((view) => !view.disabled)
      .map(({ slot, path, instances }) => ({
        id: JSON.stringify([app.id, slot, path]),
        ...(instances ? { instances } : {}),
        app,
        slot,
        path,
      })),
  );
}
