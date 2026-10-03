import { Logo } from "@tailorkit/ui/logo";
import { Spin } from "@tailorkit/ui/components/spin";
import { Link } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";

import { NavbarAuth } from "#components/navbar-auth";
import { gitConfig } from "#lib/shared";

interface SiteNavbarProps {
  children?: ReactNode;
  docs?: boolean;
}

export function SiteNavbar({ children, docs = false }: SiteNavbarProps) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <header
      className={
        docs
          ? "docs-site-navbar sticky [grid-area:header] flex flex-col top-(--fd-docs-row-1) z-30 bg-fd-background/80 backdrop-blur-lg layout:[--fd-header-height:--spacing(30)] sm:layout:[--fd-header-height:--spacing(24)]"
          : "sticky top-0 z-40"
      }
      data-docs-navbar={docs || undefined}
      id={docs ? "nd-subnav" : "nd-nav"}
    >
      <div
        data-header-body={docs ? "" : undefined}
        className={docs ? undefined : "border-b bg-fd-background/80"}
      >
        <nav
          aria-label="Main navigation"
          className="mx-auto flex h-20 w-full max-w-[97rem] flex-wrap items-center px-4 sm:h-14 sm:flex-nowrap"
        >
          <Link className="inline-flex items-center gap-2.5 font-semibold" to="/home">
            <span className="flex items-center space-x-2">
              <Logo className="size-[1em]" />
              <span>TailorKit</span>
            </span>
          </Link>
          <Link
            className="ms-2 inline-flex items-center gap-1 p-2 text-sm text-fd-muted-foreground transition-colors hover:text-fd-accent-foreground"
            to="/docs"
          >
            Docs
          </Link>
          <div className="flex h-10 flex-1 basis-full items-center justify-end gap-1.5 sm:h-auto sm:basis-auto">
            <NavbarAuth />
            <a
              aria-label="GitHub"
              className="inline-flex size-8 items-center justify-center rounded-md text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
              href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
              rel="noreferrer noopener"
              target="_blank"
            >
              <svg aria-hidden="true" className="size-4.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 .297a12 12 0 0 0-3.795 23.385c.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.333-1.755-1.333-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23a11.45 11.45 0 0 1 6 0c2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57A12.003 12.003 0 0 0 12 .297Z" />
              </svg>
            </a>
            <Spin
              aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} theme`}
              className="flex size-8 text-xl items-center justify-center rounded-md text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            />
          </div>
        </nav>
      </div>
      {children}
    </header>
  );
}
