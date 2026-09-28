import { useEffect, useState } from "react";

import { buttonVariants } from "@tailorkit/ui/button";

type DocsSession = {
  user?: {
    email?: string | null;
    image?: string | null;
    name?: string | null;
  } | null;
} | null;

const authLinks = {
  dashboard: "/",
  login: "/login",
  signUp: "/sign-up",
};

export function NavbarAuth() {
  const [session, setSession] = useState<DocsSession>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const response = await fetch("/api/auth/get-session", {
          credentials: "include",
          headers: {
            Accept: "application/json",
          },
        });

        if (!(response.ok && response.headers.get("content-type")?.includes("application/json"))) {
          return;
        }

        const nextSession = (await response.json()) as DocsSession;

        if (!cancelled) {
          setSession(nextSession);
        }
      } catch {
        if (!cancelled) {
          setSession(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  if (isLoading) {
    return <div className="h-8 w-28" />;
  }

  if (!session?.user) {
    return (
      <div className="flex items-center gap-2">
        <a
          aria-label="Login"
          className={buttonVariants({ size: "sm", variant: "ghost" })}
          href={authLinks.login}
        >
          Login
        </a>
        <a aria-label="Sign up" className={buttonVariants({ size: "sm" })} href={authLinks.signUp}>
          Sign up
        </a>
      </div>
    );
  }

  return (
    <a aria-label="Dashboard" className={buttonVariants({ size: "sm" })} href={authLinks.dashboard}>
      Dashboard
    </a>
  );
}
