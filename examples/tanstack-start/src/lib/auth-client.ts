import type { DemoUser } from "@examples/shared";
import { getDemoAuthSession, signInDemoUser, signOutDemoUser } from "@examples/shared";
import { useCallback, useEffect, useState } from "react";
import { tailor } from "./tailorkit-client";

interface AuthState {
  data: { user: DemoUser } | null;
  isPending: boolean;
}

export function useAuthSession(): AuthState & {
  signIn: (userId: string) => Promise<void>;
  signOut: () => Promise<void>;
} {
  const [state, setState] = useState<AuthState>({ data: null, isPending: true });

  useEffect(() => {
    let isMounted = true;

    void getDemoAuthSession()
      .then(({ user }) => {
        if (isMounted) {
          setState({ data: user ? { user } : null, isPending: false });
        }
      })
      .catch(() => {
        if (isMounted) {
          setState({ data: null, isPending: false });
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const signIn = useCallback(async (userId: string) => {
    const { user } = await signInDemoUser(userId);
    tailor.clearCache();
    setState({ data: user ? { user } : null, isPending: false });
  }, []);

  const signOut = useCallback(async () => {
    await signOutDemoUser();
    tailor.clearCache();
    setState({ data: null, isPending: false });
  }, []);

  return { ...state, signIn, signOut };
}
