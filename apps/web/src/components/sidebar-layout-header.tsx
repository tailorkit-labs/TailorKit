import { Separator } from "@tailorkit/ui/separator";
import { SidebarTrigger, useSidebar } from "@tailorkit/ui/sidebar";
import { Spin } from "@tailorkit/ui/spin";

import { NavBreadcrumb } from "#components/nav-breadcrumb";
import { useHeaderActions } from "#components/header-actions";
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
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        />
      </div>
    </header>
  );
}
