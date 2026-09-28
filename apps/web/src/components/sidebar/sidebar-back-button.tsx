import { ChevronLeftIcon } from "lucide-react";
import type { LinkProps } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { buttonVariants } from "@tailorkit/ui/button";

type SidebarBackButtonProps = LinkProps & { label: string };

export function SidebarBackButton({ label, ...props }: SidebarBackButtonProps) {
  return (
    <Link
      className={buttonVariants({
        className:
          "mb-1 w-full px-2.5 text-center text-sidebar-accent-foreground/75 hover:text-sidebar-accent-foreground",
        size: "lg",
        variant: "ghost",
      })}
      {...props}
    >
      <ChevronLeftIcon aria-hidden="true" data-icon="inline-start" />
      <span className="grow truncate">{label}</span>
      <span className="size-4" aria-hidden="true" />
    </Link>
  );
}
