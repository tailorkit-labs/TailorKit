"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { Badge } from "@tailorkit/ui/badge";
import { Button } from "@tailorkit/ui/button";
import {
  Card,
  CardDescription,
  CardFrame,
  CardFrameFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@tailorkit/ui/card";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@tailorkit/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@tailorkit/ui/dialog";
import { Field, FieldLabel } from "@tailorkit/ui/field";
import { Input } from "@tailorkit/ui/input";
import { Skeleton } from "@tailorkit/ui/skeleton";
import { toastManager } from "@tailorkit/ui/toast";
import { useAppForm } from "@tailorkit/ui/form";
import { ChevronDownIcon, KeyRoundIcon, LaptopIcon, SmartphoneIcon, TrashIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { z } from "zod";

import { AccountLayout } from "#components/account-layout";
import { GoogleIcon } from "#components/google-icon";
import { PageLayout } from "#components/page-layout";
import { authClient } from "#lib/auth-client";
import { client, orpc } from "#lib/orpc";
import { getPreferredLocale, getPreferredTimeZone } from "#lib/preferred-locale";
import { TwoFactorSettings } from "./-two-factor-settings";

export const Route = createFileRoute("/(app)/account/security/")({
  component: SecurityPage,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.query(context.orpc.user.getSession.queryOptions()),
      context.queryClient.query(context.orpc.user.getSocialProviders.queryOptions()),
      context.queryClient.query(context.orpc.user.listAccounts.queryOptions()),
      context.queryClient.query(context.orpc.user.listSessions.queryOptions()),
    ]);

    return { locale: getPreferredLocale(), timeZone: getPreferredTimeZone() };
  },
  validateSearch: z.object({
    error: z.string().optional(),
    error_description: z.string().optional(),
  }),
});

function getDeviceDetails(userAgent?: string | null) {
  if (!userAgent) {
    return { browser: "Unknown browser", isMobile: false, os: "Unknown device" };
  }

  const isMobile = /Android|iPhone|iPad|iPod/iu.test(userAgent);
  let os = "Unknown device";
  let browser = "Unknown browser";

  if (/iPhone|iPad|iPod/iu.test(userAgent)) {
    os = "iOS";
  } else if (/Android/iu.test(userAgent)) {
    os = "Android";
  } else if (/Windows/iu.test(userAgent)) {
    os = "Windows";
  } else if (/Mac OS X|Macintosh/iu.test(userAgent)) {
    os = "macOS";
  } else if (/Linux/iu.test(userAgent)) {
    os = "Linux";
  }

  if (/Edg\//iu.test(userAgent)) {
    browser = "Edge";
  } else if (/Firefox\/|FxiOS\//iu.test(userAgent)) {
    browser = "Firefox";
  } else if (/Chrome\/|CriOS\//iu.test(userAgent)) {
    browser = "Chrome";
  } else if (/Safari\//iu.test(userAgent)) {
    browser = "Safari";
  }

  return { browser, isMobile, os };
}

function formatLastActive(value: Date | string, locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function formatPasskeyCreated(
  value: Date | string | null | undefined,
  locale: string,
  timeZone: string,
) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(new Date(value));
}

function ActiveSessions({ locale, timeZone }: { locale: string; timeZone: string }) {
  const queryClient = useQueryClient();
  const { data: sessionData } = useQuery(orpc.user.getSession.queryOptions());
  const currentSession = sessionData?.session ?? null;
  const { data: sessions, error, isPending } = useQuery(orpc.user.listSessions.queryOptions());

  const revokeMutation = useMutation({
    mutationFn: (token: string) => client.user.revokeSession({ token }),
    onError: (mutationError) => {
      toastManager.add({
        description: mutationError.message,
        title: "Couldn't sign out session",
        type: "error",
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries(orpc.user.listSessions.queryOptions());
      toastManager.add({
        description: "The session has been signed out.",
        title: "Session ended",
        type: "success",
      });
    },
  });

  const revokeOtherMutation = useMutation({
    mutationFn: () => client.user.revokeOtherSessions(),
    onError: (mutationError) => {
      toastManager.add({
        description: mutationError.message,
        title: "Couldn't sign out other sessions",
        type: "error",
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries(orpc.user.listSessions.queryOptions());
      toastManager.add({
        description: "All other devices have been signed out.",
        title: "Other sessions ended",
        type: "success",
      });
    },
  });

  const sortedSessions = sessions
    ? [
        ...sessions.filter((session) => session.token === currentSession?.token),
        ...sessions.filter((session) => session.token !== currentSession?.token),
      ]
    : undefined;

  let sessionsContent: ReactNode;
  if (isPending) {
    sessionsContent = <ActiveSessionsSkeleton />;
  } else if (error) {
    sessionsContent = (
      <p className="px-4 py-6 text-destructive-foreground text-sm">
        Active sessions could not be loaded. Please try again.
      </p>
    );
  } else if (!sortedSessions?.length) {
    sessionsContent = (
      <p className="px-4 py-6 text-muted-foreground text-sm">No active sessions found.</p>
    );
  } else {
    sessionsContent = sortedSessions.map((session) => {
      const device = getDeviceDetails(session.userAgent);
      const isCurrent = session.token === currentSession?.token;
      const DeviceIcon = device.isMobile ? SmartphoneIcon : LaptopIcon;

      return (
        <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center" key={session.id}>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
              <DeviceIcon aria-hidden="true" className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-sm">
                  {device.os}, {device.browser}
                </p>
                {isCurrent ? <Badge variant="secondary">Current</Badge> : null}
              </div>
              <p className="mt-0.5 text-muted-foreground text-sm">
                Last active {formatLastActive(session.updatedAt, locale, timeZone)}
              </p>
            </div>
          </div>

          {!isCurrent ? (
            <Button
              className="self-start sm:self-center"
              loading={revokeMutation.isPending && revokeMutation.variables === session.token}
              onClick={() => revokeMutation.mutate(session.token)}
              size="sm"
              type="button"
              variant="destructive-outline"
            >
              Sign out
            </Button>
          ) : null}
        </div>
      );
    });
  }

  return (
    <CardFrame className="w-full">
      <Card>
        <CardHeader>
          <CardTitle className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>Active sessions</span>
            <Button
              disabled={!sortedSessions?.some((session) => session.token !== currentSession?.token)}
              loading={revokeOtherMutation.isPending}
              onClick={() => revokeOtherMutation.mutate()}
              size="sm"
              type="button"
              variant="destructive-outline"
            >
              Sign out others
            </Button>
          </CardTitle>
          <CardDescription>Manage the devices currently signed in to your account.</CardDescription>
        </CardHeader>

        <CardPanel className="pt-0">
          <div className="divide-y overflow-hidden rounded-xl border">{sessionsContent}</div>
        </CardPanel>
      </Card>
    </CardFrame>
  );
}

function ActiveSessionsSkeleton() {
  return Array.from({ length: 3 }, (_, index) => (
    <div
      className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center"
      key={`session-skeleton-${index}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-52" />
        </div>
      </div>
      <Skeleton className="h-7 w-16 self-start sm:self-center" />
    </div>
  ));
}

function LinkedAccountsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-xl border p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
          <GoogleIcon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">Google</p>
          <Skeleton className="mt-1 h-4 w-28" />
        </div>
        <Skeleton className="h-7 w-12" />
      </div>
      <div className="flex items-center gap-3 rounded-xl border p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
          <GitHubIcon />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">GitHub</p>
          <Skeleton className="mt-1 h-4 w-28" />
        </div>
        <Skeleton className="h-7 w-12" />
      </div>
      <div className="flex items-center gap-3 rounded-xl border p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
          <KeyRoundIcon aria-hidden="true" className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">Passkeys</p>
          <div className="mt-1 py-2 sm:py-1.5">
            <Skeleton className="h-4 w-44" />
          </div>
        </div>
        <Skeleton className="h-8 w-16 sm:h-7" />
      </div>
    </div>
  );
}

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
    <path
      fill="currentColor"
      d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.49 0-.24-.01-1.05-.01-1.91-2.78.62-3.37-1.21-3.37-1.21-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1.01.07 1.54 1.06 1.54 1.06.9 1.57 2.35 1.12 2.93.86.09-.67.35-1.12.64-1.38-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.38 9.38 0 0 1 12 6.93a9.4 9.4 0 0 1 2.5.35c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9 0 1.38-.01 2.49-.01 2.83 0 .27.18.59.69.49A10.26 10.26 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z"
    />
  </svg>
);

// eslint-disable-next-line complexity -- This page coordinates independent account-security controls.
function SecurityPage() {
  const { error, error_description } = useSearch({ from: "/(app)/account/security/" });
  const { locale, timeZone } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const [linkPending, setLinkPending] = useState<"github" | "google" | null>(null);
  const [unlinkPending, setUnlinkPending] = useState<string | null>(null);
  const [passkeyDialogOpen, setPasskeyDialogOpen] = useState(false);
  const [passkeyName, setPasskeyName] = useState("");
  const [passkeysOpen, setPasskeysOpen] = useState(false);
  const [passkeyPending, setPasskeyPending] = useState<string | null>(null);
  const socialProvidersQuery = useQuery(orpc.user.getSocialProviders.queryOptions());
  const accountsQuery = useQuery(orpc.user.listAccounts.queryOptions());
  const passkeysQuery = useQuery({
    queryFn: async () => {
      const result = await authClient.passkey.listUserPasskeys();
      if (result.error) {
        throw new Error(result.error.message || "Failed to load passkeys");
      }
      return result.data;
    },
    queryKey: ["passkeys"],
  });
  const sessionQuery = useQuery(orpc.user.getSession.queryOptions());
  const googleAccount = accountsQuery.data?.find((account) => account.providerId === "google");
  const githubAccount = accountsQuery.data?.find((account) => account.providerId === "github");
  const hasCredentialAccount = accountsQuery.data?.some(
    (account) => account.providerId === "credential",
  );
  const passkeys = passkeysQuery.data ?? [];
  const signInMethodCount = (accountsQuery.data?.length ?? 0) + passkeys.length;
  const canUnlinkGoogle = Boolean(googleAccount && signInMethodCount > 1);
  const canUnlinkGitHub = Boolean(githubAccount && signInMethodCount > 1);
  let githubStatus = "Sign in with GitHub";

  if (githubAccount) {
    githubStatus = githubAccount.githubUsername
      ? `@${githubAccount.githubUsername}`
      : "GitHub account linked";
  }

  const linkSocial = async (provider: "github" | "google") => {
    const providerName = provider === "google" ? "Google" : "GitHub";
    setLinkPending(provider);
    try {
      const result = await client.user.linkSocial({
        callbackURL: "/account/security",
        errorCallbackURL: "/account/security",
        provider,
      });
      if (result.url) {
        window.location.assign(result.url);
      }
    } catch (requestError) {
      setLinkPending(null);
      toastManager.add({
        description:
          requestError instanceof Error ? requestError.message : `Failed to link ${providerName}`,
        title: "Error",
        type: "error",
      });
    }
  };

  const unlinkSocial = async (accountId: string | undefined, provider: "github" | "google") => {
    if (!accountId || signInMethodCount <= 1 || unlinkPending !== null) {
      return;
    }

    const providerName = provider === "google" ? "Google" : "GitHub";
    setUnlinkPending(accountId);
    try {
      await client.user.unlinkAccount({ accountId });
      setUnlinkPending(null);
    } catch (requestError) {
      setUnlinkPending(null);
      toastManager.add({
        description:
          requestError instanceof Error ? requestError.message : `Failed to unlink ${providerName}`,
        title: "Error",
        type: "error",
      });
      return;
    }

    await queryClient.invalidateQueries(orpc.user.listAccounts.queryOptions());
    toastManager.add({
      description: `${providerName} has been unlinked from your account.`,
      title: "Account unlinked",
      type: "success",
    });
  };

  const addPasskey = async () => {
    const name = passkeyName.trim();
    if (!name) {
      return;
    }

    setPasskeyPending("add");
    setPasskeyDialogOpen(false);
    try {
      const result = await authClient.passkey.addPasskey({ name });
      if (result.error) {
        toastManager.add({
          description: result.error.message || "Failed to add passkey",
          title: "Couldn't add passkey",
          type: "error",
        });
        return;
      }

      setPasskeysOpen(true);
      await queryClient.invalidateQueries({ queryKey: ["passkeys"] });
      setPasskeyName("");
      toastManager.add({
        description: "You can now sign in with this passkey.",
        title: "Passkey added",
        type: "success",
      });
    } catch (requestError) {
      toastManager.add({
        description: requestError instanceof Error ? requestError.message : "Failed to add passkey",
        title: "Couldn't add passkey",
        type: "error",
      });
    } finally {
      setPasskeyPending(null);
    }
  };

  const deletePasskey = async (id: string) => {
    setPasskeyPending(id);
    try {
      const result = await authClient.passkey.deletePasskey({ id });
      if (result.error) {
        toastManager.add({
          description: result.error.message || "Failed to remove passkey",
          title: "Couldn't remove passkey",
          type: "error",
        });
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ["passkeys"] });
      toastManager.add({
        description: "The passkey has been removed from your account.",
        title: "Passkey removed",
        type: "success",
      });
    } catch (requestError) {
      toastManager.add({
        description:
          requestError instanceof Error ? requestError.message : "Failed to remove passkey",
        title: "Couldn't remove passkey",
        type: "error",
      });
    } finally {
      setPasskeyPending(null);
    }
  };

  const form = useAppForm({
    defaultValues: { currentPassword: "", newPassword: "", newPasswordRepeat: "" },
    onSubmit: async ({ value }) => {
      try {
        await client.user.changePassword({
          currentPassword: value.currentPassword,
          newPassword: value.newPassword,
          revokeOtherSessions: true,
        });
      } catch (requestError) {
        toastManager.add({
          description:
            requestError instanceof Error ? requestError.message : "Failed to update password",
          title: "Error",
          type: "error",
        });
        return;
      }

      toastManager.add({
        description: "Your password has been updated.",
        title: "Password updated",
        type: "success",
      });
      form.reset();
    },
    validators: {
      onSubmit: z
        .object({
          currentPassword: z.string().min(1, "Current password is required"),
          newPassword: z.string().min(10, "Password must be at least 10 characters"),
          newPasswordRepeat: z.string().min(10, "Confirm password is required"),
        })
        .refine((data) => data.newPassword === data.newPasswordRepeat, {
          message: "Passwords do not match",
          path: ["newPasswordRepeat"],
        }),
    },
  });

  return (
    <AccountLayout>
      <PageLayout description="Update your password and keep your account secure." title="Security">
        <div className="flex flex-col gap-6">
          <TwoFactorSettings
            hasCredentialAccount={hasCredentialAccount === true}
            isLoading={accountsQuery.isPending || sessionQuery.isPending}
            sessionError={accountsQuery.error ?? sessionQuery.error ?? null}
            sessionUser={sessionQuery.data?.user}
          />

          <CardFrame className="w-full">
            <Card>
              <CardHeader>
                <CardTitle>Change password</CardTitle>
              </CardHeader>

              <form
                id="change-password-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  form.handleSubmit();
                }}
              >
                <CardPanel className="flex flex-col gap-4 max-w-lg">
                  <form.AppField name="currentPassword">
                    {(field) => (
                      <field.SecretTextField label="Current password" placeholder="••••••••" />
                    )}
                  </form.AppField>

                  <form.AppField name="newPassword">
                    {(field) => (
                      <field.SecretTextField label="New password" placeholder="••••••••" />
                    )}
                  </form.AppField>

                  <form.AppField name="newPasswordRepeat">
                    {(field) => (
                      <field.SecretTextField label="Confirm new password" placeholder="••••••••" />
                    )}
                  </form.AppField>
                </CardPanel>
              </form>
            </Card>

            <CardFrameFooter className="flex justify-end relative">
              <form.AppForm>
                <form.SubmitButton form="change-password-form" size="sm">
                  Update password
                </form.SubmitButton>
              </form.AppForm>
            </CardFrameFooter>
          </CardFrame>

          <CardFrame className="w-full">
            <Card>
              <CardHeader>
                <CardTitle>Linked accounts</CardTitle>
                <p className="text-muted-foreground text-sm">
                  Connect an external account for another way to sign in.
                </p>
              </CardHeader>

              <CardPanel>
                {(error_description || error || accountsQuery.error || passkeysQuery.error) && (
                  <p className="mb-4 text-destructive text-sm" role="alert">
                    {error_description ||
                      error ||
                      accountsQuery.error?.message ||
                      passkeysQuery.error?.message}
                  </p>
                )}

                {accountsQuery.isPending || passkeysQuery.isPending ? (
                  <LinkedAccountsSkeleton />
                ) : (
                  <div className="flex flex-col gap-3">
                    {(googleAccount || socialProvidersQuery.data?.google) && (
                      <div className="flex items-center gap-3 rounded-xl border p-4">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
                          <GoogleIcon className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm">Google</p>
                          <p className="text-muted-foreground text-sm">
                            {googleAccount ? "Connected" : "Sign in with Google"}
                          </p>
                        </div>

                        {googleAccount ? (
                          <Button
                            disabled={!canUnlinkGoogle || unlinkPending !== null}
                            loading={unlinkPending === googleAccount.id}
                            onClick={() => void unlinkSocial(googleAccount.id, "google")}
                            size="sm"
                            title={
                              canUnlinkGoogle
                                ? "Unlink Google"
                                : "Google cannot be unlinked because it is your only sign-in method"
                            }
                            variant="destructive-outline"
                          >
                            Unlink
                          </Button>
                        ) : (
                          <Button
                            disabled={linkPending !== null && linkPending !== "google"}
                            loading={linkPending === "google"}
                            onClick={() => void linkSocial("google")}
                            size="sm"
                            variant="outline"
                          >
                            Link
                          </Button>
                        )}
                      </div>
                    )}

                    {(githubAccount || socialProvidersQuery.data?.github) && (
                      <div className="flex items-center gap-3 rounded-xl border p-4">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
                          <GitHubIcon />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm">GitHub</p>
                          <p className="text-muted-foreground text-sm">{githubStatus}</p>
                        </div>

                        {githubAccount ? (
                          <Button
                            disabled={!canUnlinkGitHub || unlinkPending !== null}
                            loading={unlinkPending === githubAccount.id}
                            onClick={() => void unlinkSocial(githubAccount.id, "github")}
                            size="sm"
                            title={
                              canUnlinkGitHub
                                ? "Unlink GitHub"
                                : "GitHub cannot be unlinked because it is your only sign-in method"
                            }
                            variant="destructive-outline"
                          >
                            Unlink
                          </Button>
                        ) : (
                          <Button
                            disabled={linkPending !== null && linkPending !== "github"}
                            loading={linkPending === "github"}
                            onClick={() => void linkSocial("github")}
                            size="sm"
                            variant="outline"
                          >
                            Link
                          </Button>
                        )}
                      </div>
                    )}

                    <Collapsible
                      className="rounded-xl border"
                      onOpenChange={setPasskeysOpen}
                      open={passkeysOpen}
                    >
                      <div className="flex items-center gap-3 p-4">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
                          <KeyRoundIcon aria-hidden="true" className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm">Passkeys</p>
                          {passkeys.length ? (
                            <CollapsibleTrigger
                              className="justify-start gap-1.5 px-0 py-0 font-normal text-muted-foreground hover:bg-transparent data-panel-open:[&_svg]:rotate-180 data-pressed:bg-transparent"
                              render={<Button variant="ghost" />}
                            >
                              {passkeys.length} passkey{passkeys.length === 1 ? "" : "s"} registered
                              <ChevronDownIcon
                                aria-hidden="true"
                                className="size-4 transition-transform"
                              />
                            </CollapsibleTrigger>
                          ) : (
                            <p className="text-muted-foreground text-sm">No passkeys registered</p>
                          )}
                        </div>
                        <Button
                          disabled={passkeyPending !== null}
                          loading={passkeyPending === "add"}
                          onClick={() => setPasskeyDialogOpen(true)}
                          size="sm"
                          variant="outline"
                        >
                          Add
                        </Button>
                      </div>

                      {passkeys.length ? (
                        <CollapsiblePanel>
                          <div className="border-t px-4 pl-16">
                            {passkeys.map((passkey) => {
                              const createdAt = formatPasskeyCreated(
                                passkey.createdAt,
                                locale,
                                timeZone,
                              );

                              return (
                                <div
                                  className="flex items-center gap-3 border-b py-4 last:border-b-0"
                                  key={passkey.id}
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium text-sm">
                                      {passkey.name || "Passkey"}
                                    </p>
                                    {createdAt ? (
                                      <p className="text-muted-foreground text-sm">
                                        Created {createdAt}
                                      </p>
                                    ) : null}
                                  </div>
                                  <Button
                                    aria-label={`Remove ${passkey.name || "passkey"}`}
                                    disabled={signInMethodCount <= 1 || passkeyPending !== null}
                                    loading={passkeyPending === passkey.id}
                                    onClick={() => void deletePasskey(passkey.id)}
                                    size="icon-sm"
                                    title={
                                      signInMethodCount > 1
                                        ? "Remove passkey"
                                        : "Add another sign-in method before removing this passkey"
                                    }
                                    variant="ghost"
                                  >
                                    <TrashIcon aria-hidden="true" />
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        </CollapsiblePanel>
                      ) : null}
                    </Collapsible>
                  </div>
                )}
              </CardPanel>
            </Card>
          </CardFrame>

          <Dialog
            onOpenChange={(open) => {
              if (passkeyPending === null) {
                setPasskeyDialogOpen(open);
                if (!open) {
                  setPasskeyName("");
                }
              }
            }}
            open={passkeyDialogOpen}
          >
            <DialogPopup className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add a passkey</DialogTitle>
                <DialogDescription>
                  Give this device a name so you can recognise it later.
                </DialogDescription>
              </DialogHeader>
              <form
                className="contents"
                id="add-passkey-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addPasskey();
                }}
              >
                <DialogPanel>
                  <Field>
                    <FieldLabel htmlFor="passkey-name">Passkey name</FieldLabel>
                    <Input
                      autoFocus
                      id="passkey-name"
                      onChange={(event) => setPasskeyName(event.target.value)}
                      placeholder="e.g. MacBook Pro"
                      value={passkeyName}
                    />
                  </Field>
                </DialogPanel>
                <DialogFooter>
                  <DialogClose render={<Button size="sm" type="button" variant="outline" />}>
                    Cancel
                  </DialogClose>
                  <Button
                    disabled={!passkeyName.trim() || passkeyPending !== null}
                    form="add-passkey-form"
                    loading={passkeyPending === "add"}
                    size="sm"
                    type="submit"
                  >
                    Add passkey
                  </Button>
                </DialogFooter>
              </form>
            </DialogPopup>
          </Dialog>

          <ActiveSessions locale={locale} timeZone={timeZone} />
        </div>
      </PageLayout>
    </AccountLayout>
  );
}
