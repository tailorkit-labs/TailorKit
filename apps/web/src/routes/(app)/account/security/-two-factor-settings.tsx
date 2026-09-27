import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Checkbox } from "@tailorkit/ui/checkbox";
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
import { Frame, FrameFooter, FramePanel } from "@tailorkit/ui/frame";
import { Input } from "@tailorkit/ui/input";
import { OTPField, OTPFieldInput, OTPFieldSeparator } from "@tailorkit/ui/otp-field";
import { Skeleton } from "@tailorkit/ui/skeleton";
import { toastManager } from "@tailorkit/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@tailorkit/ui/tooltip";
import { QRCodeSVG } from "qrcode.react";
import { CopyIcon, DownloadIcon } from "lucide-react";
import { Fragment, useRef, useState } from "react";
import type { ReactNode } from "react";

import { client, orpc } from "#lib/orpc";

const OTP_LENGTH = 6;
const OTP_SLOT_KEYS = Array.from({ length: OTP_LENGTH }, (_, index) => `slot-${index}`);

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getTotpSecret(totpURI: string) {
  try {
    return new URL(totpURI).searchParams.get("secret") ?? totpURI;
  } catch {
    return totpURI;
  }
}

function TwoFactorSetupDialog({
  backupCodes,
  backupCodesSaved,
  code,
  enabling,
  error,
  onBackupCodesSavedChange,
  onBackToQr,
  onCopyBackupCodes,
  onCopyTotpSecret,
  onDownloadBackupCodes,
  onEnable,
  onOpenChange,
  onPasswordChange,
  onVerify,
  onContinueToVerification,
  open,
  password,
  setCode,
  showVerificationStep,
  totpURI,
  verifying,
}: {
  backupCodes: string[];
  backupCodesSaved: boolean;
  code: string;
  enabling: boolean;
  error: string | null;
  onBackupCodesSavedChange: (saved: boolean) => void;
  onBackToQr: () => void;
  onCopyBackupCodes: () => Promise<void>;
  onCopyTotpSecret: () => Promise<void>;
  onDownloadBackupCodes: () => void;
  onEnable: () => void;
  onOpenChange: (open: boolean) => void;
  onPasswordChange: (password: string) => void;
  onVerify: (code: string) => void;
  onContinueToVerification: () => void;
  open: boolean;
  password: string;
  setCode: (code: string) => void;
  showVerificationStep: boolean;
  totpURI: string | null;
  verifying: boolean;
}) {
  let title = "Set up two-factor authentication";
  let description = "Confirm your password to begin.";
  let panelContent: ReactNode = (
    <Field>
      <FieldLabel>Password</FieldLabel>
      <Input
        autoComplete="current-password"
        onChange={(event) => onPasswordChange(event.target.value)}
        type="password"
        value={password}
      />
    </Field>
  );
  let action: ReactNode = (
    <>
      <DialogClose render={<Button size="sm" type="button" variant="ghost" />}>Cancel</DialogClose>
      <Button
        disabled={!password}
        loading={enabling}
        onClick={() => void onEnable()}
        size="sm"
        type="button"
      >
        Continue
      </Button>
    </>
  );

  if (totpURI && !showVerificationStep) {
    const totpSecret = getTotpSecret(totpURI);
    title = "Set Up Authenticator App";
    description =
      "Scan the QR code with your authenticator app, then continue to enter the six-digit code.";
    panelContent = (
      <div className="flex flex-col items-center gap-4">
        <div className="bg-white p-3">
          <QRCodeSVG
            imageSettings={{
              excavate: true,
              height: 32,
              src: "/brand/mark-qr.svg",
              width: 32,
            }}
            includeMargin
            level="H"
            size={192}
            value={totpURI}
          />
        </div>
        <div className="flex w-full items-center justify-center gap-2 py-3">
          <code className="max-w-[calc(100%-2rem)] truncate font-mono text-muted-foreground text-sm tracking-[0.12em]">
            {totpSecret}
          </code>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="Copy setup key"
                  onClick={() => void onCopyTotpSecret()}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                />
              }
            >
              <CopyIcon />
            </TooltipTrigger>
            <TooltipPopup>Copy setup key</TooltipPopup>
          </Tooltip>
        </div>
      </div>
    );
    action = (
      <>
        <DialogClose render={<Button size="sm" type="button" variant="ghost" />}>
          Cancel
        </DialogClose>
        <Button onClick={onContinueToVerification} size="sm" type="button">
          Continue
        </Button>
      </>
    );
  }

  if (totpURI && showVerificationStep) {
    title = "Verify authenticator app";
    description = "Enter the six-digit code from your authenticator app to finish setup.";
    panelContent = (
      <Field className="items-center gap-5 py-4">
        <FieldLabel>Verification code</FieldLabel>
        <OTPField
          autoComplete="one-time-code"
          className="gap-2.5"
          length={OTP_LENGTH}
          onValueChange={(value) => {
            setCode(value);
            if (value.length === OTP_LENGTH) {
              onVerify(value);
            }
          }}
          disabled={verifying}
          size="lg"
          value={code}
        >
          {OTP_SLOT_KEYS.map((key, index) => (
            <Fragment key={key}>
              <OTPFieldInput
                aria-label={`Digit ${index + 1} of ${OTP_LENGTH}`}
                className="size-16 text-3xl leading-16 sm:size-14 sm:text-2xl sm:leading-14"
              />
              {index === 2 ? <OTPFieldSeparator /> : null}
            </Fragment>
          ))}
        </OTPField>
      </Field>
    );
    action = (
      <>
        <Button onClick={onBackToQr} size="sm" type="button" variant="outline">
          Back
        </Button>
        <Button
          disabled={code.length !== OTP_LENGTH || verifying}
          loading={verifying}
          onClick={() => onVerify(code)}
          size="sm"
          type="button"
        >
          Set up authenticator app
        </Button>
      </>
    );
  }

  if (backupCodes.length) {
    title = "Save recovery codes";
    description =
      "These codes are your backup way into your account if you lose access to your authenticator app. Save them somewhere secure outside this browser.";
    panelContent = (
      <div className="flex flex-col gap-6">
        <Frame>
          <FramePanel className="grid grid-cols-1 gap-x-12 gap-y-5 rounded-b-none border-b-0 p-6 font-mono text-base sm:grid-cols-2 sm:p-8">
            {backupCodes.map((backupCode) => (
              <code key={backupCode}>{backupCode}</code>
            ))}
          </FramePanel>
          <FrameFooter className="flex justify-end gap-1 py-2">
            <Button
              onClick={() => void onCopyBackupCodes()}
              size="sm"
              type="button"
              variant="ghost"
            >
              <CopyIcon />
              Copy
            </Button>
            <Button onClick={onDownloadBackupCodes} size="sm" type="button" variant="ghost">
              <DownloadIcon />
              Download
            </Button>
          </FrameFooter>
        </Frame>
        <Field className="flex-row items-start gap-3">
          <Checkbox
            checked={backupCodesSaved}
            id="backup-codes-saved"
            onCheckedChange={(checked) => onBackupCodesSavedChange(checked === true)}
          />
          <FieldLabel className="leading-5" htmlFor="backup-codes-saved">
            I saved these recovery codes somewhere I can access if I lose my device.
          </FieldLabel>
        </Field>
      </div>
    );
    action = (
      <DialogClose render={<Button disabled={!backupCodesSaved} size="sm" type="button" />}>
        I’ve saved these codes
      </DialogClose>
    );
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup
        className={totpURI || backupCodes.length ? "max-w-2xl" : "max-w-md"}
        showCloseButton={!backupCodes.length}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-6">
          {panelContent}
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>{action}</DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function TwoFactorStatus({
  isLoading,
  sessionError,
}: {
  isLoading: boolean;
  sessionError: Error | null;
}) {
  if (isLoading) {
    return null;
  }

  if (sessionError) {
    return (
      <p className="text-destructive text-sm" role="alert">
        Security settings could not be loaded. Please refresh and try again.
      </p>
    );
  }

  return null;
}

export function TwoFactorSettings({
  hasCredentialAccount,
  isLoading,
  sessionUser,
  sessionError,
}: {
  hasCredentialAccount: boolean;
  isLoading: boolean;
  sessionUser: { email?: string | null; twoFactorEnabled?: boolean | null } | null | undefined;
  sessionError: Error | null;
}) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpURI, setTotpURI] = useState<string | null>(null);
  const [pendingBackupCodes, setPendingBackupCodes] = useState<string[]>([]);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [backupCodesSaved, setBackupCodesSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [verificationStep, setVerificationStep] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [regeneratePassword, setRegeneratePassword] = useState("");
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const verificationInProgressRef = useRef(false);

  const isEnabled = sessionUser?.twoFactorEnabled === true;
  const isReady = !isLoading && !sessionError;
  let description: ReactNode =
    "Use an authenticator app to add a second step whenever you sign in.";

  if (isLoading) {
    description = <Skeleton aria-hidden="true" className="h-10 w-full max-w-[30rem] sm:h-5" />;
  } else if (isEnabled) {
    description = "Your account is protected with an authenticator app.";
  }

  const enableMutation = useMutation({
    mutationFn: () => client.user.enableTwoFactor({ method: "totp", password }),
    onError: (requestError) => {
      setError(
        getErrorMessage(requestError, "Unable to start authenticator setup. Please try again."),
      );
    },
    onMutate: () => setError(null),
    onSuccess: (result) => {
      if (result.method !== "totp") {
        setError("Unable to start authenticator setup. Please try again.");
        return;
      }

      setPendingBackupCodes(result.backupCodes ?? []);
      setTotpURI(result.totpURI ?? null);
      setPassword("");
    },
  });

  const verifyMutation = useMutation({
    mutationFn: (verificationCode: string) => client.user.verifyTotp({ code: verificationCode }),
    onError: (requestError) => {
      setError(
        getErrorMessage(
          requestError,
          "That code is not valid. Try the current code from your app.",
        ),
      );
    },
    onMutate: () => setError(null),
    onSuccess: async () => {
      setCode("");
      setTotpURI(null);
      setBackupCodes(pendingBackupCodes);
      setBackupCodesSaved(false);
      setVerificationStep(false);
      setPendingBackupCodes([]);
      toastManager.add({
        description: "Authenticator-app verification is now required whenever you sign in.",
        title: "Two-factor authentication enabled",
        type: "success",
      });
      await queryClient.invalidateQueries(orpc.user.getSession.queryOptions());
    },
    onSettled: () => {
      verificationInProgressRef.current = false;
    },
  });

  const verifyCode = (verificationCode: string) => {
    if (verificationCode.length !== OTP_LENGTH || verificationInProgressRef.current) {
      return;
    }

    verificationInProgressRef.current = true;
    verifyMutation.mutate(verificationCode);
  };

  const disableMutation = useMutation({
    mutationFn: () => client.user.disableTwoFactor({ password }),
    onError: (requestError) => {
      setError(getErrorMessage(requestError, "Unable to disable two-factor authentication."));
    },
    onMutate: () => setError(null),
    onSuccess: async () => {
      setPassword("");
      toastManager.add({
        description: "Authenticator-app verification is no longer required.",
        title: "Two-factor authentication disabled",
        type: "success",
      });
      await queryClient.invalidateQueries(orpc.user.getSession.queryOptions());
      setDisableOpen(false);
    },
  });

  const resetSetup = () => {
    setPassword("");
    setCode("");
    setTotpURI(null);
    setPendingBackupCodes([]);
    setBackupCodes([]);
    setBackupCodesSaved(false);
    setError(null);
    setVerificationStep(false);
  };

  const handleSetupOpenChange = (open: boolean) => {
    if (!open && backupCodes.length > 0 && !backupCodesSaved) {
      return;
    }

    setSetupOpen(open);
    if (!open) {
      resetSetup();
    }
  };

  const handleDisableOpenChange = (open: boolean) => {
    setDisableOpen(open);
    if (!open) {
      setPassword("");
      setError(null);
    }
  };

  const handleRegenerateOpenChange = (open: boolean) => {
    setRegenerateOpen(open);
    if (!open) {
      setRegeneratePassword("");
      setRegenerateError(null);
    }
  };

  const copyTotpSecret = async () => {
    if (!totpURI) {
      return;
    }

    try {
      await navigator.clipboard.writeText(getTotpSecret(totpURI));
      toastManager.add({ title: "Setup key copied", type: "success" });
    } catch {
      setError("Unable to copy the setup key. Please try again.");
    }
  };

  const copyBackupCodes = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      toastManager.add({ title: "Recovery codes copied", type: "success" });
    } catch {
      setError("Unable to copy the recovery codes. Please try again.");
    }
  };

  const downloadBackupCodes = () => {
    const downloadURL = URL.createObjectURL(
      new Blob([backupCodes.join("\n")], { type: "text/plain" }),
    );
    const link = document.createElement("a");
    link.download = "recovery-codes.txt";
    link.href = downloadURL;
    link.click();
    setTimeout(() => URL.revokeObjectURL(downloadURL), 0);
    toastManager.add({ title: "Recovery codes downloaded", type: "success" });
  };

  const regenerateMutation = useMutation({
    mutationFn: () => client.user.generateBackupCodes({ password: regeneratePassword }),
    onError: (requestError) => {
      setRegenerateError(getErrorMessage(requestError, "Unable to regenerate recovery codes."));
    },
    onMutate: () => setRegenerateError(null),
    onSuccess: (result) => {
      setBackupCodes(result.backupCodes);
      setBackupCodesSaved(false);
      handleRegenerateOpenChange(false);
      setSetupOpen(true);
      toastManager.add({
        description: "Your previous recovery codes no longer work.",
        title: "Recovery codes regenerated",
        type: "success",
      });
    },
  });

  return (
    <CardFrame className="w-full">
      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>

        <CardPanel className="flex max-w-lg flex-col gap-4">
          <TwoFactorStatus isLoading={isLoading} sessionError={sessionError} />

          {isReady && !hasCredentialAccount && (
            <>
              <p className="text-muted-foreground text-sm">
                Create a password before enabling two-factor authentication. This ensures your
                authenticator is an additional factor, not the only credential protecting this
                account.
              </p>
              <Button
                className="w-fit"
                onClick={() => {
                  window.location.assign(
                    `/forgot-password?email=${encodeURIComponent(sessionUser?.email ?? "")}&return_to=/account/security`,
                  );
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                Create a password
              </Button>
            </>
          )}
        </CardPanel>
      </Card>

      {isLoading ? (
        <CardFrameFooter className="flex justify-end">
          <Skeleton className="h-7 w-24" />
        </CardFrameFooter>
      ) : null}

      {isReady && hasCredentialAccount && (
        <CardFrameFooter className="flex flex-wrap justify-end gap-2">
          {isEnabled ? (
            <>
              <Button
                onClick={() => setRegenerateOpen(true)}
                size="sm"
                type="button"
                variant="outline"
              >
                Regenerate codes
              </Button>
              <Button
                onClick={() => setDisableOpen(true)}
                size="sm"
                type="button"
                variant="destructive-outline"
              >
                Disable 2FA
              </Button>
            </>
          ) : (
            <Button onClick={() => setSetupOpen(true)} size="sm" type="button">
              Enable 2FA
            </Button>
          )}
        </CardFrameFooter>
      )}

      <TwoFactorSetupDialog
        backupCodes={backupCodes}
        backupCodesSaved={backupCodesSaved}
        code={code}
        enabling={enableMutation.isPending}
        error={error}
        onBackupCodesSavedChange={setBackupCodesSaved}
        onBackToQr={() => setVerificationStep(false)}
        onCopyBackupCodes={copyBackupCodes}
        onCopyTotpSecret={copyTotpSecret}
        onDownloadBackupCodes={downloadBackupCodes}
        onEnable={() => enableMutation.mutate()}
        onOpenChange={handleSetupOpenChange}
        onPasswordChange={setPassword}
        onVerify={verifyCode}
        open={setupOpen}
        password={password}
        setCode={(value) => {
          setCode(value);
          setError(null);
        }}
        showVerificationStep={verificationStep}
        onContinueToVerification={() => setVerificationStep(true)}
        totpURI={totpURI}
        verifying={verifyMutation.isPending}
      />

      <DisableTwoFactorDialog
        disabling={disableMutation.isPending}
        error={error}
        onDisable={() => disableMutation.mutate()}
        onOpenChange={handleDisableOpenChange}
        onPasswordChange={setPassword}
        open={disableOpen}
        password={password}
      />

      <RegenerateBackupCodesDialog
        error={regenerateError}
        loading={regenerateMutation.isPending}
        onOpenChange={handleRegenerateOpenChange}
        onPasswordChange={setRegeneratePassword}
        onRegenerate={() => regenerateMutation.mutate()}
        open={regenerateOpen}
        password={regeneratePassword}
      />
    </CardFrame>
  );
}

function RegenerateBackupCodesDialog({
  error,
  loading,
  onOpenChange,
  onPasswordChange,
  onRegenerate,
  open,
  password,
}: {
  error: string | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onPasswordChange: (password: string) => void;
  onRegenerate: () => void;
  open: boolean;
  password: string;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Regenerate recovery codes</DialogTitle>
          <DialogDescription>
            Your current recovery codes will stop working. Enter your password to generate a new
            set.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Field>
            <FieldLabel>Password</FieldLabel>
            <Input
              autoComplete="current-password"
              onChange={(event) => onPasswordChange(event.target.value)}
              type="password"
              value={password}
            />
          </Field>
          {error ? (
            <p className="mt-3 text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button size="sm" type="button" variant="ghost" />}>
            Cancel
          </DialogClose>
          <Button
            disabled={!password}
            loading={loading}
            onClick={() => void onRegenerate()}
            size="sm"
            type="button"
          >
            Regenerate codes
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function DisableTwoFactorDialog({
  disabling,
  error,
  onDisable,
  onOpenChange,
  onPasswordChange,
  open,
  password,
}: {
  disabling: boolean;
  error: string | null;
  onDisable: () => void;
  onOpenChange: (open: boolean) => void;
  onPasswordChange: (password: string) => void;
  open: boolean;
  password: string;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Disable two-factor authentication</DialogTitle>
          <DialogDescription>
            Enter your password to remove authenticator-app protection.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Field>
            <FieldLabel>Password</FieldLabel>
            <Input
              autoComplete="current-password"
              onChange={(event) => onPasswordChange(event.target.value)}
              type="password"
              value={password}
            />
          </Field>
          {error ? (
            <p className="mt-3 text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button size="sm" type="button" variant="ghost" />}>
            Cancel
          </DialogClose>
          <Button
            disabled={!password}
            loading={disabling}
            onClick={() => void onDisable()}
            size="sm"
            type="button"
            variant="destructive-outline"
          >
            Disable 2FA
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
