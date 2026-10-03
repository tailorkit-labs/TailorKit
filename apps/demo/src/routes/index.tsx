import { createFileRoute } from "@tanstack/react-router";
import { Check, Clipboard, Paintbrush } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { TailorKitTheme } from "tailorkit";
import {
  createHandoff,
  decodeState,
  defaultEmbedConfig,
  defaultTheme,
  encodeState,
  getShadcnTokens,
  mergeTheme,
  shadcnTokenNames,
  toCssVars,
} from "#lib/demo-theme";
import type { DemoAppId, DemoEmbedConfig, DemoHandoff } from "#lib/demo-theme";
import { cn } from "@tailorkit/ui";

function RailTodoIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
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

function RailMessagesIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
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

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({
    demo: typeof search.demo === "string" ? search.demo : undefined,
  }),
  component: DemoPage,
});

type TokenName = (typeof shadcnTokenNames)[number];

const controls: { label: string; name: TokenName }[] = shadcnTokenNames.map((name) => ({
  label: name,
  name,
}));

function DemoPage() {
  const { demo } = Route.useSearch();
  const initial = demo
    ? (decodeState(demo) ?? createHandoff(defaultTheme, defaultEmbedConfig, "todo"))
    : createHandoff(defaultTheme, defaultEmbedConfig, "todo");
  const [theme, setTheme] = useState<TailorKitTheme>(initial.tailorkitTheme);
  const [config, setConfig] = useState<DemoEmbedConfig>(initial.embedConfig);
  const [selectedApp, setSelectedApp] = useState<DemoAppId>(initial.selectedApp);
  const [dark, setDark] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);
  const [jsonText, setJsonText] = useState(() =>
    JSON.stringify(
      createHandoff(initial.tailorkitTheme, initial.embedConfig, initial.selectedApp),
      null,
      2,
    ),
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isEditingJson, setIsEditingJson] = useState(false);
  const [origin, setOrigin] = useState("http://localhost:3000");
  const [syncChannel] = useState(() => createSyncChannel());
  const syncSocketRef = useRef<WebSocket | null>(null);
  const handoff = useMemo(
    () => createHandoff(theme, config, selectedApp),
    [config, selectedApp, theme],
  );
  const json = useMemo(() => JSON.stringify(handoff, null, 2), [handoff]);
  const consoleScript = useMemo(
    () => createConsoleScript(theme, config, origin, syncChannel),
    [config, origin, syncChannel, theme],
  );
  const panelUrl = useMemo(
    () => createPanelUrl(theme, config, selectedApp),
    [config, selectedApp, theme],
  );
  const cssVars = useMemo(() => toCssVars(theme) as CSSProperties, [theme]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // On first visit (no ?demo= in URL), restore from localStorage
  useEffect(() => {
    if (!demo) {
      const saved = decodeState(window.localStorage.getItem("tailorkit-demo"));
      if (saved) {
        setTheme(saved.tailorkitTheme);
        setConfig(saved.embedConfig);
        setSelectedApp(saved.selectedApp);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const encoded = encodeState(handoff);
    window.localStorage.setItem("tailorkit-demo", encoded);
    window.history.replaceState(null, "", `?demo=${encoded}`);
  }, [handoff]);

  useEffect(() => {
    const socket = new WebSocket(createSyncUrl(origin, syncChannel));
    syncSocketRef.current = socket;

    return () => {
      syncSocketRef.current = null;
      socket.close();
    };
  }, [origin, syncChannel]);

  useEffect(() => {
    const payload = JSON.stringify({ handoff, type: "handoff" });
    const socket = syncSocketRef.current;

    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(payload);
      return;
    }

    const sendWhenOpen = () => socket?.send(payload);
    socket?.addEventListener("open", sendWhenOpen, { once: true });
    return () => {
      socket?.removeEventListener("open", sendWhenOpen);
    };
  }, [handoff]);

  useEffect(() => {
    if (!isEditingJson) {
      setJsonText(json);
      setJsonError(null);
    }
  }, [json, isEditingJson]);

  return (
    <main
      className="min-h-screen bg-[color:var(--background)] p-6 text-[color:var(--foreground)]"
      style={cssVars}
    >
      <div className="mx-auto grid w-full max-w-7xl grid-cols-[minmax(22rem,30rem)_1fr] gap-6 max-lg:grid-cols-1">
        <section>
          <div className="mb-6 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md bg-[color:var(--primary)] text-[color:var(--primary-foreground)]">
              <Paintbrush className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="font-semibold text-xl tracking-normal">TailorKit demo setup</h1>
              <p className="text-[color:var(--muted-foreground)] text-sm">
                Configure the injected customer-page panel.
              </p>
            </div>
          </div>

          <div className="space-y-5">
            <Panel title="Demo setup">
              <Field label="Customer label">
                <input
                  aria-label="Customer label"
                  className="h-9 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--input)] px-3 text-sm text-[color:var(--foreground)] outline-none focus:border-[color:var(--ring)]"
                  onChange={(event) =>
                    setConfig((current) => ({ ...current, customerLabel: event.target.value }))
                  }
                  value={config.customerLabel}
                />
              </Field>
              <Field label="Panel width">
                <input
                  aria-label="Panel width"
                  className="h-9 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--input)] px-3 text-sm text-[color:var(--foreground)] outline-none focus:border-[color:var(--ring)]"
                  max={520}
                  min={280}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      width: Number.parseInt(event.target.value, 10) || defaultEmbedConfig.width,
                    }))
                  }
                  type="number"
                  value={config.width}
                />
              </Field>
              <label className="flex items-center gap-2 text-[color:var(--muted-foreground)] text-sm">
                <input
                  aria-label="Reserve customer page space for the rail"
                  checked={config.pushPage}
                  className="size-4 accent-[color:var(--primary)]"
                  onChange={(event) =>
                    setConfig((current) => ({ ...current, pushPage: event.target.checked }))
                  }
                  type="checkbox"
                />
                Reserve customer page space for the rail
              </label>
              <label className="flex items-center gap-2 text-[color:var(--muted-foreground)] text-sm">
                <input
                  aria-label="Show rail border"
                  checked={config.railBorder}
                  className="size-4 accent-[color:var(--primary)]"
                  onChange={(event) =>
                    setConfig((current) => ({ ...current, railBorder: event.target.checked }))
                  }
                  type="checkbox"
                />
                Show rail border
              </label>
              <label className="flex items-center gap-2 text-[color:var(--muted-foreground)] text-sm">
                <input
                  aria-label="Dark mode"
                  checked={dark}
                  className="size-4 accent-[color:var(--primary)]"
                  onChange={(event) => setDark(event.target.checked)}
                  type="checkbox"
                />
                Dark mode
              </label>
            </Panel>

            <Panel title="Theme tokens">
              <div className="grid grid-cols-2 gap-3">
                {controls.map((control) => (
                  <ColorTokenControl
                    key={control.name}
                    label={control.label}
                    name={control.name}
                    theme={theme}
                    onChange={(value) =>
                      setTheme((current) => setToken(current, control.name, value))
                    }
                  />
                ))}
              </div>
            </Panel>

            <button
              className="inline-flex h-9 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--card)] px-3 font-medium text-[color:var(--card-foreground)] text-sm"
              onClick={() => {
                setTheme(defaultTheme);
                setConfig(defaultEmbedConfig);
              }}
              type="button"
            >
              Reset setup
            </button>
          </div>
        </section>

        <section className="space-y-5">
          <Panel title="Sidebar preview">
            <SidebarPreview
              selectedApp={selectedApp}
              onSelectApp={setSelectedApp}
              panelUrl={panelUrl}
              railBorder={config.railBorder}
            />
          </Panel>

          <Panel title="Console script">
            <div className="mb-3 flex gap-2">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-[color:var(--primary)] px-3 font-medium text-[color:var(--primary-foreground)] text-sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(consoleScript);
                  setCopiedScript(true);
                  window.setTimeout(() => setCopiedScript(false), 1200);
                }}
                type="button"
              >
                {copiedScript ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                {copiedScript ? "Copied" : "Copy script"}
              </button>
            </div>
            <pre className="max-h-[34rem] overflow-auto rounded-md bg-[color:var(--popover)] p-3 text-[color:var(--popover-foreground)] text-xs leading-relaxed">
              {consoleScript}
            </pre>
          </Panel>

          <Panel title="LLM handoff JSON">
            <div className="mb-3 flex gap-2">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-[color:var(--primary)] px-3 font-medium text-[color:var(--primary-foreground)] text-sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(jsonText);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1200);
                }}
                type="button"
              >
                {copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                {copied ? "Copied" : "Copy JSON"}
              </button>
            </div>
            {jsonError && (
              <p className="mb-2 rounded-md bg-[color:var(--destructive)] px-3 py-2 text-[color:var(--destructive-foreground)] text-xs">
                {jsonError}
              </p>
            )}
            <textarea
              aria-label="Demo handoff JSON"
              className="max-h-72 min-h-48 w-full resize-y rounded-md bg-[color:var(--popover)] p-3 font-mono text-[color:var(--popover-foreground)] text-xs leading-relaxed outline-none focus:ring-1 focus:ring-[color:var(--ring)]"
              onBlur={() => {
                setIsEditingJson(false);
                try {
                  const parsed = JSON.parse(jsonText) as DemoHandoff;
                  setTheme(parsed.tailorkitTheme);
                  setConfig(parsed.embedConfig);
                  setSelectedApp(parsed.selectedApp);
                  setJsonError(null);
                } catch {
                  setJsonText(json);
                  setJsonError(null);
                }
              }}
              onChange={(e) => {
                setJsonText(e.target.value);
                try {
                  const parsed = JSON.parse(e.target.value) as DemoHandoff;
                  setTheme(parsed.tailorkitTheme);
                  setConfig(parsed.embedConfig);
                  setSelectedApp(parsed.selectedApp);
                  setJsonError(null);
                } catch {
                  setJsonError("Invalid JSON — will revert on blur");
                }
              }}
              onFocus={() => setIsEditingJson(true)}
              spellCheck={false}
              value={jsonText}
            />
          </Panel>

          <Panel title="How to use">
            <div className="space-y-3 text-[color:var(--muted-foreground)] text-sm">
              <p>Open the customer site in a browser tab, paste the console script, and run it.</p>
              <p>
                The script injects the right rail and side panel into that page using these
                TailorKit theme tokens.
              </p>
            </div>
          </Panel>
        </section>
      </div>
    </main>
  );
}

function SidebarPreview({
  panelUrl,
  selectedApp,
  onSelectApp,
  railBorder,
}: {
  panelUrl: string;
  selectedApp: DemoAppId;
  onSelectApp: (app: DemoAppId) => void;
  railBorder: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-[color:var(--border)] bg-[color:var(--muted)]">
      <div className="relative h-[34rem] overflow-hidden">
        <div className="h-full min-w-0 bg-[color:var(--background)] p-6 pr-20">
          <div className="mb-6 h-7 w-36 rounded bg-[color:var(--muted)]" />
          <div className="grid gap-3">
            <div className="h-24 rounded border border-[color:var(--border)] bg-[color:var(--card)]" />
            <div className="h-24 rounded border border-[color:var(--border)] bg-[color:var(--card)]" />
            <div className="h-24 rounded border border-[color:var(--border)] bg-[color:var(--card)]" />
          </div>
        </div>
        <iframe
          className={cn(
            "absolute inset-y-0 right-14 z-10 h-full w-[min(22rem,calc(100%-3.5rem))] border-[color:var(--border)] bg-[color:var(--background)]",
            railBorder ? "border-l" : "border-0",
          )}
          src={panelUrl}
          title="TailorKit panel preview"
        />
        <aside className="absolute inset-y-0 right-0 z-20 flex w-14 flex-col items-center justify-center gap-3 border-[color:var(--sidebar-border)] border-l bg-[color:var(--sidebar)] py-4">
          <button
            className="flex size-10 cursor-pointer items-center justify-center rounded-md border-0"
            onClick={() => onSelectApp("todo")}
            style={
              selectedApp === "todo"
                ? {
                    background: "var(--sidebar-accent)",
                    border: "1px solid var(--sidebar-border)",
                    color: "var(--sidebar-accent-foreground)",
                  }
                : {
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    color: "var(--muted-foreground)",
                  }
            }
            type="button"
          >
            <RailTodoIcon />
          </button>
          <button
            className="flex size-10 cursor-pointer items-center justify-center rounded-md border-0"
            onClick={() => onSelectApp("messages")}
            style={
              selectedApp === "messages"
                ? {
                    background: "var(--sidebar-accent)",
                    border: "1px solid var(--sidebar-border)",
                    color: "var(--sidebar-accent-foreground)",
                  }
                : {
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    color: "var(--muted-foreground)",
                  }
            }
            type="button"
          >
            <RailMessagesIcon />
          </button>
        </aside>
      </div>
    </div>
  );
}

function Panel({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-4 text-[color:var(--card-foreground)]">
      <h2 className="mb-3 font-semibold text-sm">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="block">
      <span className="mb-1 block font-medium text-[color:var(--muted-foreground)] text-xs">
        {label}
      </span>
      {children}
    </label>
  );
}

function ColorTokenControl({
  label,
  name,
  onChange,
  theme,
}: {
  label: string;
  name: TokenName;
  onChange: (value: string) => void;
  theme: TailorKitTheme;
}) {
  const value = getShadcnTokens(theme)[name];

  return (
    <label className="block">
      <span className="mb-1 block font-medium text-[color:var(--muted-foreground)] text-xs">
        {label}
      </span>
      <div className="flex h-9 items-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--input)] px-2 text-[color:var(--foreground)]">
        <input
          aria-label={label}
          className="size-5 shrink-0 cursor-pointer border-0 bg-transparent p-0"
          onChange={(event) => onChange(event.target.value)}
          type="color"
          value={toColorInput(value)}
        />
        <input
          aria-label={`${label} token value`}
          className="min-w-0 flex-1 border-0 bg-transparent font-mono text-xs outline-none"
          onChange={(event) => onChange(event.target.value)}
          value={value}
        />
      </div>
    </label>
  );
}

function setToken(theme: TailorKitTheme, name: TokenName, value: string): TailorKitTheme {
  return mergeTheme(theme, {
    tokens: {
      shadcn: { [name]: value },
    } as TailorKitTheme["tokens"] & { shadcn: Partial<Record<TokenName, string>> },
  });
}

function toColorInput(value: string) {
  return /^#[\da-f]{6}$/iu.test(value) ? value : getShadcnTokens(defaultTheme).foreground;
}

function createConsoleScript(
  theme: TailorKitTheme,
  config: DemoEmbedConfig,
  origin: string,
  syncChannel: string,
) {
  const payload = {
    customerLabel: config.customerLabel,
    defaultOpen: config.defaultOpen,
    pushPage: config.pushPage,
    railBorder: config.railBorder,
    theme,
    width: config.width,
  };

  return `await import("${origin}/embed.js").then(({ openTailorKitDemo }) =>
  openTailorKitDemo({
    ...${JSON.stringify(payload, null, 2)},
    syncChannel: "${syncChannel}"
  })
);`;
}

function createPanelUrl(theme: TailorKitTheme, config: DemoEmbedConfig, selectedApp: DemoAppId) {
  const state = encodeState(createHandoff(theme, config, selectedApp));
  return `/embed-panel?demo=${state}`;
}

function createSyncChannel() {
  return globalThis.crypto?.randomUUID?.() ?? `demo-${Date.now().toString(36)}`;
}

function createSyncUrl(origin: string, channel: string) {
  const url = new URL("/tailorkit-demo-sync", origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("channel", channel);
  return url.toString();
}
