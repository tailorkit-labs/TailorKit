"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BlocksIcon, XIcon } from "lucide-react";
import type { DemoUser } from "@examples/shared";
import { signOutDemoUser } from "@examples/shared";
import { Button } from "@tailorkit/ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@tailorkit/ui/select";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@tailorkit/ui/sidebar";
import type { TailorKitApp } from "tailorkit/react";
import { AppSidebar } from "@/components/app-sidebar";
import {
  TailorKitProvider,
  RenderSlot,
  useApps,
  useViewContext,
  useViews,
} from "@/lib/tailorkit-client";

type Apps = NonNullable<ReturnType<typeof useApps>["data"]>;

function TailorKitShellWithApps({ children, user }: { children: ReactNode; user: DemoUser }) {
  const router = useRouter();
  const { data: apps, isPending } = useApps();
  const [currentApp, setCurrentApp] = useState<TailorKitApp | null>(null);

  async function signOut() {
    await signOutDemoUser();
    router.refresh();
  }

  return (
    <TailorKitShellContent
      apps={apps ?? []}
      currentApp={currentApp}
      isLoading={isPending}
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
  isLoading,
  onSelectApp,
  signOut,
  user,
}: {
  apps: Apps;
  children: ReactNode;
  currentApp: TailorKitApp | null;
  isLoading: boolean;
  onSelectApp: (app: TailorKitApp | null) => void;
  signOut: () => Promise<void>;
  user: DemoUser;
}) {
  useViewContext("/", { context: { user } });

  return (
    <SidebarProvider className="isolate">
      <AppSidebar signOut={signOut} user={user} />
      <SidebarInset className="me-14">
        <header className="flex h-14 items-center border-b px-4 md:hidden">
          <SidebarTrigger />
          <span className="ml-2 font-medium text-sm">Northwind CRM</span>
        </header>
        <main className="mx-auto w-full max-w-6xl p-6">{children}</main>
      </SidebarInset>
      <TailorKitSlot app={currentApp} onClose={() => onSelectApp(null)} />
      <TailorKitAppList
        apps={apps}
        currentApp={currentApp}
        isLoading={isLoading}
        onSelect={onSelectApp}
      />
    </SidebarProvider>
  );
}

function TailorKitAppList({
  apps,
  currentApp,
  isLoading,
  onSelect,
}: {
  apps: Apps;
  currentApp: TailorKitApp | null;
  isLoading: boolean;
  onSelect: (app: TailorKitApp | null) => void;
}) {
  return (
    <aside className="fixed inset-y-0 right-0 z-30 w-14 border-l bg-background/95 backdrop-blur">
      <div aria-label="TailorKit apps" className="flex h-full flex-col items-center gap-2 py-3">
        <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <BlocksIcon aria-hidden="true" />
        </div>
        {apps.map((app) => {
          const label = app.name ?? app.id;
          const isSelected = currentApp?.id === app.id;

          return (
            <Button
              aria-label={`Open ${label}`}
              aria-pressed={isSelected}
              data-state={isSelected ? "open" : "closed"}
              key={app.id}
              onClick={() => onSelect(isSelected ? null : app)}
              size="icon"
              title={label}
              type="button"
              variant={isSelected ? "secondary" : "outline"}
            >
              {label.charAt(0).toUpperCase()}
            </Button>
          );
        })}
        {!isLoading && apps.length === 0 ? (
          <span className="mt-auto [writing-mode:vertical-rl] text-muted-foreground text-xs">
            No apps installed
          </span>
        ) : null}
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
      className="fixed top-4 right-16 bottom-4 z-40 flex w-[min(420px,calc(100vw-5rem))] flex-col overflow-hidden rounded-xl border bg-background shadow-xl"
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
  return app.views?.some((view) => view.slot === "page" && !view.disabled) ? (
    <TailorKitPageInstances app={app} />
  ) : (
    <RenderSlot slot="panel" app={app} />
  );
}

function TailorKitPageInstances({ app }: { app: TailorKitApp }) {
  const { data: allInstances, isPending, error, fetch } = useViews({ slot: "page" });
  const instances = allInstances?.filter((instance) => instance.app.id === app.id);
  const [instanceKey, setInstanceKey] = useState<string | null>(null);
  const selected = instances?.find((instance) => instance.key === instanceKey) ?? instances?.[0];
  const items = (instances ?? []).map((instance) => ({
    value: instance.key,
    label: typeof instance.metadata.title === "string" ? instance.metadata.title : instance.key,
  }));

  if (isPending) return <p>Loading views…</p>;
  if (error) return <p role="alert">{error.message}</p>;
  if (!selected) return <p>No instances available.</p>;

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
          <Button type="button" variant="outline" onClick={() => void fetch()}>
            Refresh
          </Button>
        </div>
      )}
      <RenderSlot slot="page" app={app} instanceKey={selected.key} />
    </>
  );
}

export function TailorKitShell(props: Parameters<typeof TailorKitShellWithApps>[0]) {
  return (
    <TailorKitProvider>
      <TailorKitShellWithApps {...props} />
    </TailorKitProvider>
  );
}
