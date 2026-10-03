import { Separator } from "@tailorkit/ui/separator";
import { SidebarTrigger, useSidebar } from "@tailorkit/ui/sidebar";
import { Spin } from "@tailorkit/ui/spin";
import { toastManager } from "@tailorkit/ui/toast";

import { NavBreadcrumb } from "#components/nav-breadcrumb";
import { useHeaderActions } from "#components/header-actions";
import { authClient } from "#lib/auth-client";
import { useTheme } from "#lib/theme";

export function SidebarLayoutHeader() {
  const { open } = useSidebar();
  const { actions } = useHeaderActions();
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <header className="flex h-13 shrink-0 items-center gap-2 border-b px-4">
      {/* Mobile: always show trigger to open sheet */}
      <SidebarTrigger className="-ml-1 lg:hidden" />
      <Separator className="h-4 lg:hidden" orientation="vertical" />
      {/* Desktop: only show trigger when sidebar is collapsed */}
      {!open && (
        <>
          <SidebarTrigger className="-ml-1 hidden lg:flex" />
          <Separator className="hidden h-4 lg:block" orientation="vertical" />
        </>
      )}
      <NavBreadcrumb />
      <div className="ml-auto flex items-center gap-2">
        {actions}
        <Spin
          aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} theme`}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          toggled={resolvedTheme === "dark"}
          onClick={() => {
            const nextTheme = resolvedTheme === "dark" ? "light" : "dark";
            setTheme(nextTheme);
            void authClient
              .updateUser({ theme: nextTheme } as Parameters<typeof authClient.updateUser>[0])
              .then((result) => {
                if (result.error) {
                  toastManager.add({
                    description: result.error.message || "Failed to update theme",
                    title: "Theme not saved",
                    type: "error",
                  });
                }
              })
              .catch(() => {
                toastManager.add({
                  description: "Failed to update theme",
                  title: "Theme not saved",
                  type: "error",
                });
              });
          }}
        />
      </div>
    </header>
  );
}
