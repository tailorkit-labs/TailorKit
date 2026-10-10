"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { demoUsers, signInDemoUser } from "@examples/shared";
import { Button } from "@tailorkit/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tailorkit/ui/card";
import { tailor } from "@/lib/tailorkit-client";

export function AuthScreen() {
  const router = useRouter();
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  async function signIn(userId: string) {
    setPendingUserId(userId);

    try {
      await signInDemoUser(userId);
      tailor.fetchClient?.clear();
      router.refresh();
    } finally {
      setPendingUserId(null);
    }
  }

  return (
    <main className="grid min-h-svh place-items-center p-6">
      <Card className="w-full max-w-md rounded-xl">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Building2 aria-hidden="true" />
          </div>
          <CardTitle>Northwind CRM</CardTitle>
          <CardDescription>
            Sign in to explore a Next.js host application extended by TailorKit.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {demoUsers.map((user) => (
            <Button
              key={user.id}
              loading={pendingUserId === user.id}
              onClick={() => void signIn(user.id)}
              size="lg"
              type="button"
            >
              Continue as {user.name}
            </Button>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
