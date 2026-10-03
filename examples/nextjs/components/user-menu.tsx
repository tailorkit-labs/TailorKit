"use client";

import { LogOutIcon } from "lucide-react";
import type { DemoUser } from "@examples/shared";
import { Avatar, AvatarFallback, AvatarImage } from "@tailorkit/ui/avatar";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@tailorkit/ui/menu";

function getInitials(label: string) {
  return (
    label
      .split(/[\s-]+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "A"
  );
}

export function UserMenu({ signOut, user }: { signOut: () => Promise<void>; user: DemoUser }) {
  return (
    <div className="min-w-0 flex-1">
      <Menu>
        <MenuTrigger className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent">
          <Avatar>
            <AvatarImage alt={user.name} src={user.profileImageUrl} />
            <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0">
            <span className="block truncate font-medium text-sm">{user.name}</span>
            <span className="block truncate text-muted-foreground text-xs">{user.email}</span>
          </span>
        </MenuTrigger>
        <MenuPopup align="start" className="w-56" side="top">
          <MenuItem closeOnClick onClick={() => void signOut()} variant="destructive">
            <LogOutIcon aria-hidden="true" />
            Sign out
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
}
