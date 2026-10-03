import { AppWindowIcon, KeyRoundIcon, SettingsIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarHeaderRow,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@tailorkit/ui/sidebar";
import { Link, useRouterState } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { orpc } from "#lib/orpc";

import { OrgSwitcher } from "./org-switcher";
import { SidebarBackButton } from "./sidebar-back-button";
import { SidebarBrand } from "./sidebar-brand";
import { SidebarUserMenu } from "./sidebar-user-menu";

interface ProjectSidebarProps {
  orgSlug: string;
  projectSlug: string;
}

export function ProjectSidebar({ orgSlug, projectSlug }: ProjectSidebarProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const base = `/${orgSlug}/${projectSlug}`;
  const isActive = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
  const { data: project } = useSuspenseQuery(
    orpc.project.get.queryOptions({ input: { orgSlug, projectSlug } }),
  );

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarHeaderRow>
          <SidebarBrand />
        </SidebarHeaderRow>
        <OrgSwitcher orgSlug={orgSlug} />
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarGroup>
          <SidebarBackButton label={project.name} params={{ orgSlug }} to="/$orgSlug/~/projects" />
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={isActive(`${base}/apps`)}
                render={<Link params={{ orgSlug, projectSlug }} to="/$orgSlug/$projectSlug/apps" />}
              >
                <AppWindowIcon />
                <span>Apps</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={isActive(`${base}/settings/api-keys`)}
                render={
                  <Link
                    params={{ orgSlug, projectSlug }}
                    to="/$orgSlug/$projectSlug/settings/api-keys"
                  />
                }
              >
                <KeyRoundIcon />
                <span>API keys</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={pathname === `${base}/settings`}
                render={
                  <Link params={{ orgSlug, projectSlug }} to="/$orgSlug/$projectSlug/settings" />
                }
              >
                <SettingsIcon />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarUserMenu />
      </SidebarFooter>
    </Sidebar>
  );
}
