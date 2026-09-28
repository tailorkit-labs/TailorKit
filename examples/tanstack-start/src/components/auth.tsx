import { Button } from "@tailorkit/ui/button";
import { demoUsers } from "@examples/shared";

import { useAuthSession } from "#lib/auth-client";

export function AuthScreen() {
  const session = useAuthSession();

  async function signIn(userId: string) {
    await session.signIn(userId);
    window.location.reload();
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      {demoUsers.map((user) => (
        <Button
          className="justify-start py-3"
          key={user.id}
          onClick={() => void signIn(user.id)}
          size="lg"
        >
          Sign in as {user.name}
        </Button>
      ))}
    </div>
  );
}
