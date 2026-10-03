import { useQuery } from "@tanstack/react-query";

import { Button } from "@tailorkit/ui/button";
import { Skeleton } from "@tailorkit/ui/skeleton";

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

const sessionQueryKey = ["auth", "session"] as const;

async function getSession(): Promise<DocsSession> {
  const response = await fetch("/api/auth/get-session", {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  if (!(response.ok && response.headers.get("content-type")?.includes("application/json"))) {
    return null;
  }

  return (await response.json()) as DocsSession;
}

export function NavbarAuth() {
  const { data: session, isPending } = useQuery({
    enabled: typeof window !== "undefined",
    queryFn: getSession,
    queryKey: sessionQueryKey,
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (isPending) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading authentication"
        className="flex items-center gap-2"
        role="status"
      >
        <Skeleton className="h-8 w-13" />
        <Skeleton className="h-8 w-16" />
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" render={<a aria-label="Login" href={authLinks.login} />}>
          Login
        </Button>
        <Button size="sm" render={<a aria-label="Sign up" href={authLinks.signUp} />}>
          Sign up
        </Button>
      </div>
    );
  }

  return (
    <Button size="sm" render={<a aria-label="Dashboard" href={authLinks.dashboard} />}>
      Dashboard
    </Button>
  );
}
