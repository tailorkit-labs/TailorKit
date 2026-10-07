import type { DemoUser } from "@examples/shared";
import { Button } from "@tailorkit/ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@tailorkit/ui/select";
import { SidebarInset, SidebarProvider } from "@tailorkit/ui/sidebar";
import { XIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { Root } from "tailorkit/react";
import type { TailorKitApp } from "tailorkit/react";
import { AppSidebar } from "#components/app-sidebar";
import tailor, { Slot, useApps, useRegisterView, useSlotInstances } from "#lib/tailorkit-client";

type Apps = NonNullable<ReturnType<typeof useApps>["data"]>;

function TailorKitShellWithApps({
  children,
  user,
  signOut,
}: {
  children: ReactNode;
  signOut: () => Promise<void>;
  user: DemoUser;
}) {
  const { data: apps } = useApps();
  const [currentApp, setCurrentApp] = useState<TailorKitApp | null>(null);

  return (
    <TailorKitShellContent
      apps={apps ?? []}
      currentApp={currentApp}
      onSelectApp={setCurrentApp}
      signOut={signOut}
      user={user}
    >
      {children}
    </TailorKitShellContent>
  );
}

function TailorKitShellContent({
  apps,
  children,
  currentApp,
  onSelectApp,
  signOut,
  user,
}: {
  apps: Apps;
  children: ReactNode;
  currentApp: TailorKitApp | null;
  onSelectApp: (app: TailorKitApp | null) => void;
  signOut: () => Promise<void>;
  user: DemoUser;
}) {
  useRegisterView("/", { context: { user } });

  return (
    <SidebarProvider>
      <AppSidebar signOut={signOut} user={user} />
      <SidebarInset className="me-12">
        <main className="mx-auto w-full max-w-6xl p-6">{children}</main>
      </SidebarInset>
      <TailorKitSlot app={currentApp} onClose={() => onSelectApp(null)} />
      <TailorKitAppList apps={apps} currentApp={currentApp} onSelect={onSelectApp} />
    </SidebarProvider>
  );
}

function TailorKitAppList({
  apps,
  currentApp,
  onSelect,
}: {
  apps: Apps;
  currentApp: TailorKitApp | null;
  onSelect: (app: TailorKitApp | null) => void;
}) {
  return (
    <aside className="pr-2">
      <div aria-label="Apps" className="flex h-full flex-col items-center justify-center gap-2">
        {apps.map((app) => {
          const label = app.name ?? app.id;
          const isSelected = currentApp?.id === app.id;

          return (
            <Button
              aria-expanded={isSelected}
              aria-pressed={isSelected}
              data-state={isSelected ? "open" : "closed"}
              key={app.id}
              onClick={() => onSelect(isSelected ? null : app)}
              title={label}
              type="button"
              variant="outline"
            >
              {label.charAt(0)}
            </Button>
          );
        })}
      </div>
    </aside>
  );
}

function TailorKitSlot({ app, onClose }: { app: TailorKitApp | null; onClose: () => void }) {
  if (!app) {
    return null;
  }

  return (
    <aside
      className="fixed top-4 right-16 bottom-4 z-40 flex w-[min(420px,calc(100vw-5rem))] flex-col overflow-hidden rounded-lg border bg-background shadow-lg"
      data-app-id={app.id}
    >
      <header className="flex items-center justify-between border-b p-3">
        <span className="truncate font-medium text-sm">{app.name ?? app.id}</span>
        <Button
          aria-label="Close app panel"
          onClick={onClose}
          size="icon"
          type="button"
          variant="ghost"
        >
          <XIcon aria-hidden="true" />
        </Button>
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-4">
        <TailorKitSlotContent key={app.id} app={app} />
      </main>
    </aside>
  );
}

function TailorKitSlotContent({ app }: { app: TailorKitApp }) {
  const { data: instances, isPending, error, refetch } = useSlotInstances({ app, slot: "panel" });
  const [instanceKey, setInstanceKey] = useState<string | null>(null);
  const selected = instances?.find((instance) => instance.key === instanceKey) ?? instances?.[0];
  const items = (instances ?? []).map((instance) => ({
    value: instance.key,
    label: typeof instance.metadata.title === "string" ? instance.metadata.title : instance.key,
  }));

  if (isPending) return <p>Loading views…</p>;
  if (error) return <p role="alert">{error.message}</p>;

  return (
    <>
      {selected && (
        <div className="mb-4 flex items-center gap-2">
          <Select items={items} value={selected.key} onValueChange={setInstanceKey}>
            <SelectTrigger aria-label="View instance">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            Refresh
          </Button>
        </div>
      )}
      <Slot name="panel" app={app} instanceKey={selected?.key} />
    </>
  );
}

export function TailorKitShell(props: Parameters<typeof TailorKitShellWithApps>[0]) {
  return (
    <Root client={tailor}>
      <TailorKitShellWithApps {...props} />
    </Root>
  );
}
