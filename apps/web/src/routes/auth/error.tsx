import { buttonVariants } from "@tailorkit/ui/button";
import {
  Card,
  CardFrame,
  CardFrameFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@tailorkit/ui/card";
import { Logo } from "@tailorkit/ui/logo";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/auth/error")({
  validateSearch: z.object({
    error: z.string().optional(),
  }),
  component: AuthErrorPage,
});

const messages: Record<string, string> = {
  no_code: "The sign-in request was cancelled or did not complete.",
  state_mismatch: "Your sign-in session expired. Please try again.",
  state_not_found: "Your sign-in session expired. Please try again.",
};

function AuthErrorPage() {
  const { error } = Route.useSearch();
  const message = error ? messages[error] : undefined;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <a className="flex items-center gap-2" href="https://tailorkit.dev/home">
          <Logo className="size-6" />
          <span className="font-semibold text-lg">TailorKit</span>
        </a>

        <CardFrame className="w-full">
          <Card>
            <CardHeader>
              <CardTitle>We couldn't complete sign in</CardTitle>
            </CardHeader>
            <CardPanel className="flex flex-col gap-4">
              <p className="text-muted-foreground text-sm">
                {message ?? "Something went wrong while signing you in. Please try again."}
              </p>
              <a
                aria-label="Back to sign in"
                className={buttonVariants({ className: "w-full" })}
                href="/login"
              >
                Back to sign in
              </a>
            </CardPanel>
          </Card>

          <CardFrameFooter className="relative">
            <p className="text-center text-muted-foreground text-sm">
              If this keeps happening, contact support.
            </p>
          </CardFrameFooter>
        </CardFrame>
      </div>
    </div>
  );
}
