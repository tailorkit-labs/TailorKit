"use client";

import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { Button } from "@tailorkit/ui/button";
import {
  Card,
  CardFooter,
  CardFrame,
  CardFrameFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@tailorkit/ui/card";
import { Logo } from "@tailorkit/ui/logo";
import { cn } from "@tailorkit/ui";
import { useAppForm } from "@tailorkit/ui/form";
import { ArrowLeftIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";

import { authClient } from "#lib/auth-client";
import { GoogleIcon } from "#components/google-icon";
import { orpc } from "#lib/orpc";
import { getAuthErrorCallbackUrl, getSameOriginUrl } from "#lib/safe-return-url";

export const Route = createFileRoute("/(auth)/sign-up")({
  validateSearch: z.object({
    email: z.string().optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
    return_to: z.string().optional(),
  }),
  component: RouteComponent,
});

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 shrink-0 fill-current">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

type Step = "email" | "details";

function RouteComponent() {
  const {
    email: emailFromSearch,
    error,
    error_description,
    return_to,
  } = useSearch({ from: "/(auth)/sign-up" });
  const navigate = Route.useNavigate();
  const socialProvidersQuery = useQuery(orpc.user.getSocialProviders.queryOptions());
  const [step, setStep] = useState<Step>("email");
  const [visible, setVisible] = useState(true);
  const [email, setEmail] = useState(emailFromSearch || "");
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [socialPending, setSocialPending] = useState<"github" | "google" | null>(null);

  const transition = (nextStep: Step, nextEmail?: string) => {
    setVisible(false);
    setDetailsError(null);
    setTimeout(() => {
      if (nextEmail !== undefined) {
        setEmail(nextEmail);
      }
      setStep(nextStep);
      setVisible(true);
    }, 150);
  };

  const emailForm = useAppForm({
    defaultValues: { email: emailFromSearch || "" },
    onSubmit: async ({ value }) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      transition("details", value.email);
    },
    validators: {
      onSubmit: z.object({ email: z.email("Invalid email address") }),
    },
  });

  const detailsForm = useAppForm({
    defaultValues: { name: "", password: "" },
    onSubmit: async ({ value }) => {
      setDetailsError(null);
      await authClient.signUp.email(
        { email, name: value.name, password: value.password },
        {
          onError: (error) => {
            setDetailsError(error.error.message || error.error.statusText || "Sign up failed");
          },
          onSuccess: () => {
            navigate({ search: { email, return_to }, to: "/verify-email" });
          },
        },
      );
    },
    validators: {
      onSubmit: z.object({
        name: z.string().min(2, "Name must be at least 2 characters"),
        password: z.string().min(12, "Password must be at least 12 characters"),
      }),
    },
  });

  const signUpWithSocial = async (provider: "github" | "google") => {
    const providerName = provider === "google" ? "Google" : "GitHub";
    setSocialError(null);
    setSocialPending(provider);

    try {
      const callbackURL =
        getSameOriginUrl(return_to, window.location.origin) ?? window.location.origin;
      const result = await authClient.signIn.social({
        callbackURL,
        errorCallbackURL: getAuthErrorCallbackUrl("/sign-up", return_to, window.location.origin),
        provider,
      });

      if (result.error) {
        setSocialError(
          result.error.message || result.error.statusText || `${providerName} sign up failed`,
        );
        setSocialPending(null);
      }
    } catch {
      setSocialError(`${providerName} sign up failed`);
      setSocialPending(null);
    }
  };

  const contentClass = cn(
    "transition-all duration-150",
    visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1",
  );

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
              <CardTitle>Create your account</CardTitle>
            </CardHeader>

            <div className={contentClass}>
              {step === "email" ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    emailForm.handleSubmit();
                  }}
                >
                  <CardPanel className="flex flex-col gap-4">
                    {(socialError || error_description || error) && (
                      <p className="text-destructive text-sm" role="alert">
                        {socialError || error_description || error}
                      </p>
                    )}
                    {(socialProvidersQuery.data?.google || socialProvidersQuery.data?.github) && (
                      <>
                        <div className="flex flex-col gap-2">
                          {socialProvidersQuery.data.github && (
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full"
                              disabled={socialPending !== null && socialPending !== "github"}
                              loading={socialPending === "github"}
                              onClick={() => void signUpWithSocial("github")}
                            >
                              <GitHubIcon />
                              Continue with GitHub
                            </Button>
                          )}
                          {socialProvidersQuery.data.google && (
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full"
                              disabled={socialPending !== null && socialPending !== "google"}
                              loading={socialPending === "google"}
                              onClick={() => void signUpWithSocial("google")}
                            >
                              <GoogleIcon className="size-4 shrink-0" />
                              Continue with Google
                            </Button>
                          )}
                        </div>

                        <div className="after:border-border relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
                          <span className="bg-card text-muted-foreground relative z-10 px-2 text-xs">
                            OR
                          </span>
                        </div>
                      </>
                    )}

                    <emailForm.AppField name="email">
                      {(field) => (
                        <field.TextField
                          label="Email"
                          type="email"
                          placeholder="you@example.com"
                          autoFocus
                        />
                      )}
                    </emailForm.AppField>

                    <emailForm.AppForm>
                      <emailForm.SubmitButton className="w-full">Continue</emailForm.SubmitButton>
                    </emailForm.AppForm>
                  </CardPanel>
                </form>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    detailsForm.handleSubmit();
                  }}
                >
                  <CardPanel className="flex flex-col gap-4">
                    <button
                      type="button"
                      onClick={() => transition("email")}
                      className="flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
                    >
                      <ArrowLeftIcon className="size-3.5" />
                      <span>{email}</span>
                    </button>

                    {detailsError && <detailsForm.FormError>{detailsError}</detailsForm.FormError>}

                    <detailsForm.AppField name="name">
                      {(field) => (
                        <field.TextField label="Name" placeholder="Your name" autoFocus />
                      )}
                    </detailsForm.AppField>

                    <detailsForm.AppField name="password">
                      {(field) => (
                        <field.SecretTextField
                          description="Password must be at least 12 characters"
                          label="Password"
                          placeholder="••••••••"
                        />
                      )}
                    </detailsForm.AppField>
                  </CardPanel>

                  <detailsForm.AppForm>
                    <CardFooter className="pt-4">
                      <detailsForm.SubmitButton className="w-full">
                        Create Account
                      </detailsForm.SubmitButton>
                    </CardFooter>
                  </detailsForm.AppForm>
                </form>
              )}
            </div>
          </Card>

          <CardFrameFooter className="relative">
            <p className="text-muted-foreground text-sm">
              Already have an account?{" "}
              <Link
                search={{ email, return_to }}
                to="/login"
                className="text-foreground hover:underline underline-offset-4"
              >
                Sign in
              </Link>
            </p>
          </CardFrameFooter>
        </CardFrame>
      </div>
    </div>
  );
}
