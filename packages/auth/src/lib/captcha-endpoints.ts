// Include email OTP because TailorKit uses it for verification and recovery.
export const captchaEndpoints = [
  "/sign-up/email",
  "/sign-in/email",
  "/sign-in/social",
  "/request-password-reset",
  "/sign-in/email-otp",
  "/email-otp/send-verification-otp",
  "/email-otp/request-password-reset",
  // Better Auth still exposes this deprecated alias for OTP recovery.
  "/forget-password/email-otp",
  "/email-otp/check-verification-otp",
  "/email-otp/reset-password",
];
