import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Building2Icon, MailIcon, ShieldIcon, UserIcon } from "lucide-react";
import type { ReactNode } from "react";

import { HeaderActionsProvider } from "#components/header-actions";
import { SidebarLayoutHeader } from "#components/sidebar-layout-header";
import { SidebarBackButton } from "#components/sidebar/sidebar-back-button";
import { SidebarBrand } from "#components/sidebar/sidebar-brand";
import { SidebarUserMenu } from "#components/sidebar/sidebar-user-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarHeaderRow,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from "@tailorkit/ui/sidebar";
import { orpc } from "#lib/orpc";

export function AccountSidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isActive = (path: string) => pathname === path;

  const { data: orgs } = useQuery(orpc.user.getOrgs.queryOptions());
  const activeOrgSlug =
    typeof window !== "undefined" ? (sessionStorage.getItem("active-org-id") ?? "") : "";
  const backOrg = orgs?.find((org) => org.slug === activeOrgSlug) ?? orgs?.[0];

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarHeaderRow>
          <SidebarBrand />
        </SidebarHeaderRow>
        <SidebarBackButton
          label="Account"
          params={backOrg?.slug ? { orgSlug: backOrg.slug } : undefined}
          to={backOrg?.slug ? "/$orgSlug/~/projects" : "/"}
        />
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={isActive("/account/profile")}
                render={<Link to="/account/profile" />}
              >
                <UserIcon />
                <span>Profile</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={isActive("/account/security")}
                render={<Link to="/account/security" />}
              >
                <ShieldIcon />
                <span>Security</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={isActive("/account/organizations")}
                render={<Link to="/account/organizations" />}
              >
                <Building2Icon />
                <span>Organisations</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={isActive("/account/invites")}
                render={<Link to="/account/invites" />}
              >
                <MailIcon />
                <span>Invites</span>
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

export function AccountLayout({ children }: { children?: ReactNode }) {
  return (
    <HeaderActionsProvider>
      <SidebarProvider>
        <AccountSidebar />
        <SidebarInset>
          <SidebarLayoutHeader />
          <main className="flex flex-1 flex-col gap-4 p-4">{children ?? <Outlet />}</main>
        </SidebarInset>
      </SidebarProvider>
    </HeaderActionsProvider>
  );
}
