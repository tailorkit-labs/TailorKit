import { Outlet, createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

import { SidebarLayoutHeader } from "#components/sidebar-layout-header";
import { HeaderActionsProvider } from "#components/header-actions";

import { FolderIcon, SettingsIcon, UsersIcon } from "lucide-react";
import {
  SidebarInset,
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarHeaderRow,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarPanel,
  SidebarPanelTrigger,
  SidebarPanels,
  SidebarSeparator,
} from "@tailorkit/ui/sidebar";

import { OrgSwitcher } from "#components/sidebar/org-switcher";
import { SidebarBrand } from "#components/sidebar/sidebar-brand";
import { SidebarUserMenu } from "#components/sidebar/sidebar-user-menu";

export const Route = createFileRoute("/(app)/$orgSlug/~/(org)")({
  component: OrgLayout,
});

interface AppSidebarProps {
  orgSlug: string;
}

export function AppSidebar({ orgSlug }: AppSidebarProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
  const orgBase = `/${orgSlug}/~`;
  const onSettingsPath = pathname.startsWith(`${orgBase}/settings`);

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarHeaderRow>
          <SidebarBrand />
        </SidebarHeaderRow>
        <OrgSwitcher orgSlug={orgSlug} />
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarPanels defaultPanel={onSettingsPath ? "settings" : "main"}>
        <SidebarPanel name="main">
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Platform</SidebarGroupLabel>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={isActive(`${orgBase}/projects`)}
                    render={<Link params={{ orgSlug }} to="/$orgSlug/~/projects" />}
                  >
                    <FolderIcon />
                    <span>Projects</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarPanelTrigger isActive={onSettingsPath} target="settings">
                    <SettingsIcon />
                    <span className="grow">Settings</span>
                  </SidebarPanelTrigger>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
        </SidebarPanel>

        <SidebarPanel name="settings">
          <SidebarContent>
            <SidebarGroup>
              <SidebarPanelTrigger target="main" back>
                <span className="grow">Settings</span>
              </SidebarPanelTrigger>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={pathname === `${orgBase}/settings`}
                    render={<Link params={{ orgSlug }} to="/$orgSlug/~/settings" />}
                  >
                    <SettingsIcon />
                    <span>General</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={isActive(`${orgBase}/settings/members`)}
                    render={<Link params={{ orgSlug }} to="/$orgSlug/~/settings/members" />}
                  >
                    <UsersIcon />
                    <span>Members</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
        </SidebarPanel>
      </SidebarPanels>

      <SidebarFooter>
        <SidebarUserMenu />
      </SidebarFooter>
    </Sidebar>
  );
}

function OrgLayout() {
  const { orgSlug } = Route.useParams();

  useEffect(() => {
    sessionStorage.setItem("active-org-id", orgSlug);
    window.cookieStore.set({
      name: "active-org-id",
      value: orgSlug,
      path: "/",
    });
  }, [orgSlug]);

  return (
    <HeaderActionsProvider>
      <SidebarProvider>
        <AppSidebar orgSlug={orgSlug} />
        <SidebarInset>
          <SidebarLayoutHeader />
          <main className="flex flex-1 flex-col gap-4 p-4">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </HeaderActionsProvider>
  );
}
