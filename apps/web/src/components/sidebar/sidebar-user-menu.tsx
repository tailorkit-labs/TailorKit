import {
  BookOpenIcon,
  ChevronsUpDownIcon,
  ExternalLinkIcon,
  HomeIcon,
  LaptopMinimalIcon,
  LogOutIcon,
  MoonIcon,
  SunIcon,
  UserIcon,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@tailorkit/ui/avatar";
import { Button } from "@tailorkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tailorkit/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@tailorkit/ui/toggle-group";
import { Link } from "@tanstack/react-router";
import { toastManager } from "@tailorkit/ui/toast";

import { authClient } from "#lib/auth-client";
import { fallbackTheme, getUserTheme, isAppTheme, useTheme } from "#lib/theme";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "#lib/orpc.ts";

export function SidebarUserMenu() {
  const { data: session } = useQuery(orpc.user.getSession.queryOptions());
  const { setTheme, theme } = useTheme();

  const name = session?.user?.name ?? "User";
  const email = session?.user?.email ?? "";
  const image = session?.user?.image ?? undefined;
  const selectedTheme = theme ?? getUserTheme(session?.user) ?? fallbackTheme;
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="w-full" render={<Button variant={"ghost"} />}>
        <Avatar className="size-6 rounded-lg">
          {image && <AvatarImage alt={name} src={image} />}
          <AvatarFallback className="rounded-lg text-xs">{initials}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col text-left text-sm leading-tight">
          <span className="truncate font-medium">{name}</span>
        </div>
        <ChevronsUpDownIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56" side="top">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex items-center gap-2 px-1 py-1.5">
              <Avatar className="size-6 rounded-lg">
                {image && <AvatarImage alt={name} src={image} />}
                <AvatarFallback className="rounded-lg text-xs">{initials}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col text-sm leading-tight">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-muted-foreground text-xs">{email}</span>
              </div>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link to="/account/profile" />}>
            <UserIcon />
            Account
          </DropdownMenuItem>
          <DropdownMenuItem
            render={
              <a href="https://tailorkit.dev/home" rel="noopener" target="_blank">
                <HomeIcon />
                <span className="w-full">Homepage</span>
                <ExternalLinkIcon />
              </a>
            }
          />
          <DropdownMenuItem
            render={
              <a href="https://tailorkit.dev/docs" rel="noopener" target="_blank">
                <BookOpenIcon />
                <span className="w-full">Documentation</span>
                <ExternalLinkIcon />
              </a>
            }
          />
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem closeOnClick={false} className="p-0 data-highlighted:bg-transparent">
          <div className="flex w-full items-center justify-between gap-3">
            <p className="px-2 text-sm">Theme</p>
            <ToggleGroup
              aria-label="Theme"
              size="sm"
              value={[selectedTheme]}
              variant="default"
              onValueChange={(value) => {
                const nextTheme = value[0];

                if (!isAppTheme(nextTheme)) {
                  return;
                }

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
            >
              <ToggleGroupItem aria-label="System theme" title="System" value="system">
                <LaptopMinimalIcon />
              </ToggleGroupItem>
              <ToggleGroupItem aria-label="Light theme" title="Light" value="light">
                <SunIcon />
              </ToggleGroupItem>
              <ToggleGroupItem aria-label="Dark theme" title="Dark" value="dark">
                <MoonIcon />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link preload={false} to="/logout" />} variant="destructive">
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
