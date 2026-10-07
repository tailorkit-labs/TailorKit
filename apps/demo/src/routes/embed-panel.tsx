import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { Root } from "tailorkit/react";
import {
  createHandoff,
  decodeState,
  defaultEmbedConfig,
  defaultTheme,
  toCssVars,
} from "#lib/demo-theme";
import { createDemoTailorClient, demoApps } from "#lib/tailorkit";

function TodoIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 5h8" />
      <path d="M13 12h8" />
      <path d="M13 19h8" />
      <path d="m3 17 2 2 4-4" />
      <rect x="3" y="4" width="6" height="6" rx="1" />
    </svg>
  );
}

function MessagesIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      <path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1" />
    </svg>
  );
}

export const Route = createFileRoute("/embed-panel")({
  validateSearch: (search: Record<string, unknown>) => ({
    demo: typeof search.demo === "string" ? search.demo : undefined,
  }),
  component: EmbedPanel,
});

function EmbedPanel() {
  const { demo } = Route.useSearch();
  const handoff =
    (demo ? decodeState(demo) : null) ?? createHandoff(defaultTheme, defaultEmbedConfig);
  const theme = handoff.tailorkitTheme;
  const tailorClient = useMemo(() => createDemoTailorClient(theme), [theme]);
  const { Slot, useViewContext } = tailorClient;
  const activeApp = demoApps.find((app) => app.id === handoff.selectedApp) ?? demoApps[0];
  const cssVars = useMemo(() => toCssVars(theme) as CSSProperties, [theme]);

  useEffect(() => {
    const vars = toCssVars(theme);
    for (const [key, value] of Object.entries(vars)) {
      document.documentElement.style.setProperty(key, value);
    }
  }, [theme]);

  function closePanel() {
    if (typeof window !== "undefined") {
      window.parent.postMessage({ source: "tailorkit-demo", type: "close" }, "*");
    }
  }

  return (
    <Root client={tailorClient} apps={demoApps}>
      <CurrentDemoView useViewContext={useViewContext} />
      <main className="h-screen flex flex-col" style={cssVars}>
        {/* Panel header */}
        <div
          className="flex items-center gap-3 px-4 py-3 flex-shrink-0 border-b"
          style={{
            background: "var(--accent)",
            borderColor: "var(--border)",
            color: "var(--foreground)",
          }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            {activeApp?.id === "messages" ? <MessagesIcon /> : <TodoIcon />}
          </div>
          <span className="flex-1 text-sm font-semibold" style={{ color: "var(--foreground)" }}>
            {activeApp?.name}
          </span>
          <button
            className="w-7 h-7 rounded flex items-center justify-center text-xs border-0 cursor-pointer transition-colors"
            onClick={closePanel}
            style={{ background: "transparent", color: "var(--foreground)" }}
            type="button"
          >
            ✕
          </button>
        </div>

        {/* App content */}
        <div
          className="flex-1 min-h-0 overflow-hidden flex flex-col"
          style={{ background: "var(--background)" }}
        >
          {/* Make the view wrapper fill the panel height */}
          <style>{`[data-tailorkit-view] { display: flex; flex-direction: column; height: 100%; }`}</style>
          {activeApp ? (
            <Slot name="panel" app={activeApp} />
          ) : (
            <div className="p-5 text-sm" style={{ color: "var(--muted-foreground)" }}>
              No app selected
            </div>
          )}
        </div>
      </main>
    </Root>
  );
}

function CurrentDemoView({
  useViewContext,
}: {
  useViewContext: ReturnType<typeof createDemoTailorClient>["useViewContext"];
}) {
  useViewContext("/", { context: {} });
  return null;
}
