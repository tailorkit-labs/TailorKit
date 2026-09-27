"use client";

import { ChevronLeftIcon } from "lucide-react";
import { Fragment, useRef, useState } from "react";
import { cn } from "@tailorkit/ui";
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
import { Field, FieldDescription, FieldError } from "@tailorkit/ui/field";
import { Logo } from "@tailorkit/ui/logo";
import { OTPField, OTPFieldInput, OTPFieldSeparator } from "@tailorkit/ui/otp-field";
import { toastManager } from "@tailorkit/ui/toast";
import { useAppForm } from "@tailorkit/ui/form";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { z } from "zod";

import { authClient } from "#lib/auth-client";

export const Route = createFileRoute("/(auth)/forgot-password")({
  validateSearch: (search) => ({
    email: search.email as string | undefined,
    return_to: search.return_to as string | undefined,
  }),
  component: RouteComponent,
});

const OTP_LENGTH = 6;
const SLOT_KEYS = Array.from({ length: OTP_LENGTH }, (_, i) => `slot-${i}`);

type Step = "email" | "otp" | "reset";

function RouteComponent() {
  const { email: emailFromSearch, return_to } = useSearch({ from: "/(auth)/forgot-password" });
  const navigate = Route.useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [visible, setVisible] = useState(true);
  const [email, setEmail] = useState(emailFromSearch || "");
  const [otp, setOtp] = useState("");
  const [otpInvalid, setOtpInvalid] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [resending, setResending] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const transition = (nextStep: Step, nextEmail?: string) => {
    setVisible(false);
    setTimeout(() => {
      if (nextEmail !== undefined) {
        setEmail(nextEmail);
      }
      setStep(nextStep);
      setVisible(true);
    }, 150);
  };

  const startResendTimer = () => {
    setResendCountdown(60);
    timerRef.current = setInterval(() => {
      setResendCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const sendOtp = async (targetEmail: string) => {
    const result = await authClient.emailOtp.sendVerificationOtp({
      email: targetEmail,
      type: "forget-password",
    });
    if (result.error) {
      toastManager.add({
        description: result.error.message || "Failed to send code",
        title: "Error",
        type: "error",
      });
      return false;
    }
    startResendTimer();
    return true;
  };

  const emailForm = useAppForm({
    defaultValues: { email: emailFromSearch || "" },
    onSubmit: async ({ value }) => {
      const sent = await sendOtp(value.email);
      if (sent) {
        transition("otp", value.email);
      }
    },
    validators: {
      onSubmit: z.object({ email: z.email("Invalid email address") }),
    },
  });

  const verifyOtp = async (code = otp) => {
    if (!code || code.length < OTP_LENGTH) {
      setOtpInvalid(true);
      return;
    }
    setVerifyingOtp(true);
    const result = await authClient.emailOtp.checkVerificationOtp({
      email,
      otp: code,
      type: "forget-password",
    });
    setVerifyingOtp(false);
    if (result.error) {
      if (result.error.code === "INVALID_OTP" || result.error.code === "OTP_EXPIRED") {
        setOtpInvalid(true);
        setOtp("");
      }
      toastManager.add({
        description: result.error.message || "Failed to verify code",
        title: "Verification failed",
        type: "error",
      });
      return;
    }
    setOtpInvalid(false);
    transition("reset");
  };

  const resetForm = useAppForm({
    defaultValues: { confirmPassword: "", password: "" },
    onSubmit: async ({ value }) => {
      const result = await authClient.emailOtp.resetPassword({
        email,
        otp,
        password: value.password,
      });
      if (result.error) {
        toastManager.add({
          description: result.error.message || "Failed to reset password",
          title: "Reset failed",
          type: "error",
        });
        return;
      }
      toastManager.add({
        description: "Your password has been updated. Please sign in.",
        title: "Password reset",
        type: "success",
      });
      navigate({
        search: { email, return_to },
        to: "/login",
      });
    },
    validators: {
      onSubmit: z
        .object({
          confirmPassword: z.string().min(8, "Password must be at least 8 characters"),
          password: z.string().min(8, "Password must be at least 8 characters"),
        })
        .refine((data) => data.password === data.confirmPassword, {
          message: "Passwords do not match",
          path: ["confirmPassword"],
        }),
    },
  });

  const getTitle = () => {
    if (step === "email") {
      return "Forgot password?";
    }
    if (step === "otp") {
      return "Verify code";
    }
    return "Reset password";
  };

  const getDescription = () => {
    if (step === "email") {
      return "Enter your email and we'll send you a code";
    }
    if (step === "otp") {
      return "Check your email for a reset code";
    }
    return "Choose a new password for your account";
  };

  const contentClass = cn(
    "transition-all duration-150",
    visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1",
  );

  const renderStep = () => {
    if (step === "email") {
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            emailForm.handleSubmit();
          }}
        >
          <CardPanel className="flex flex-col gap-4">
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
          </CardPanel>

          <emailForm.AppForm>
            <CardFooter className="pt-4">
              <emailForm.SubmitButton className="w-full">Send code</emailForm.SubmitButton>
            </CardFooter>
          </emailForm.AppForm>
        </form>
      );
    }

    if (step === "otp") {
      return (
        <>
          <CardPanel className="flex flex-col gap-6">
            <div className="flex flex-col items-center gap-6">
              <Field className="items-center gap-1.5">
                <FieldDescription>Verification code</FieldDescription>
                <OTPField
                  length={OTP_LENGTH}
                  value={otp}
                  onValueChange={(value) => {
                    setOtp(value);
                    setOtpInvalid(false);
                    if (value.length === OTP_LENGTH) {
                      verifyOtp(value);
                    }
                  }}
                  disabled={verifyingOtp}
                  size="lg"
                  className="gap-2.5"
                >
                  {SLOT_KEYS.map((key, index) => (
                    <Fragment key={key}>
                      <OTPFieldInput
                        className="size-11 text-xl leading-11 sm:size-10 sm:text-lg sm:leading-10"
                        aria-invalid={otpInvalid || undefined}
                        aria-label={`Digit ${index + 1} of ${OTP_LENGTH}`}
                      />
                      {index === 2 && <OTPFieldSeparator />}
                    </Fragment>
                  ))}
                </OTPField>
                <FieldDescription>Sent to {email}</FieldDescription>
                {otpInvalid && <FieldError>Invalid or expired code. Please try again.</FieldError>}
                <Button
                  variant="link"
                  size="sm"
                  type="button"
                  onClick={async () => {
                    setResending(true);
                    await sendOtp(email);
                    setResending(false);
                    setOtp("");
                    setOtpInvalid(false);
                  }}
                  disabled={resending || resendCountdown > 0}
                  loading={resending}
                  className="h-auto p-0 text-xs"
                >
                  {resendCountdown > 0 ? `Resend in ${resendCountdown}s` : "Resend code"}
                </Button>
              </Field>
            </div>
          </CardPanel>
          <CardFooter className="pt-4">
            <Button
              className="w-full"
              disabled={otp.length < OTP_LENGTH || verifyingOtp}
              loading={verifyingOtp}
              onClick={() => verifyOtp(otp)}
            >
              Continue
            </Button>
          </CardFooter>
        </>
      );
    }

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          resetForm.handleSubmit();
        }}
      >
        <CardPanel className="flex flex-col gap-4">
          <resetForm.AppField name="password">
            {(field) => (
              <field.SecretTextField label="New password" placeholder="••••••••" autoFocus />
            )}
          </resetForm.AppField>

          <resetForm.AppField name="confirmPassword">
            {(field) => <field.SecretTextField label="Confirm password" placeholder="••••••••" />}
          </resetForm.AppField>
        </CardPanel>

        <resetForm.AppForm>
          <CardFooter className="pt-4">
            <resetForm.SubmitButton className="w-full">Reset password</resetForm.SubmitButton>
          </CardFooter>
        </resetForm.AppForm>
      </form>
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <a className="flex items-center gap-2" href="https://tailorkit.dev/home">
          <Logo className="size-6" />
          <span className="font-semibold text-lg">TailorKit</span>
        </a>
        <CardFrame className="w-full">
          <Card>
            <div className={contentClass}>
              <CardHeader>
                <CardTitle>{getTitle()}</CardTitle>
                <p className="text-muted-foreground text-sm">{getDescription()}</p>
              </CardHeader>
              {renderStep()}
            </div>
          </Card>

          <CardFrameFooter className="relative">
            {step === "email" ? (
              <Button variant={"link"} render={<Link search={{ email, return_to }} to="/login" />}>
                <ChevronLeftIcon />
                Back to sign in
              </Button>
            ) : (
              <Button variant={"link"} render={<Link search={{ email, return_to }} to="/login" />}>
                <ChevronLeftIcon />
                Use a different email
              </Button>
            )}
          </CardFrameFooter>
        </CardFrame>
      </div>
    </div>
  );
}
