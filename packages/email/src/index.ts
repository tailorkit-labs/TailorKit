import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { render } from "@react-email/render";
import { getBaseUrl } from "@tailorkit/env";
import { env } from "#env";
import { withSpan } from "@tailorkit/observability";
import { createTransport } from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import type SESTransport from "nodemailer/lib/ses-transport";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { BetterAuthOtpTemplate, betterAuthEmailSubjects } from "./templates/better-auth";
import type { BetterAuthEmailType } from "./templates/better-auth";
import { InvitationTemplate } from "./templates/better-auth/invitation";

export interface SendEmailInput {
  from?: string;
  html: string;
  replyTo?: string;
  subject: string;
  text?: string;
  to: string;
}

export interface SendBetterAuthOtpInput {
  email: string;
  otp: string;
  type: BetterAuthEmailType;
}

export interface SendOrganizationInvitationEmailInput {
  email: string;
  invitationId: string;
  inviterName?: string;
  organizationName: string;
  role?: string | null;
}

let cachedTransporter: Mail | undefined;

const hasSesCredentials = () => Boolean(env.EMAIL_ACCESS_KEY_ID && env.EMAIL_SECRET_ACCESS_KEY);

const resolveSesRegion = () => env.EMAIL_REGION ?? "us-east-1";

const createSmtpTransport = (smtpUrl: string) => createTransport(smtpUrl);

const resolveSmtpUrl = () => {
  if (!env.EMAIL_SMTP_URL) {
    throw new Error("EMAIL_SMTP_URL is required when EMAIL_PROVIDER is smtp.");
  }

  return env.EMAIL_SMTP_URL;
};

const resolveSesCredentials = () => {
  if (!(env.EMAIL_ACCESS_KEY_ID && env.EMAIL_SECRET_ACCESS_KEY)) {
    throw new Error(
      "EMAIL_ACCESS_KEY_ID and EMAIL_SECRET_ACCESS_KEY are required when EMAIL_PROVIDER is ses.",
    );
  }

  return {
    accessKeyId: env.EMAIL_ACCESS_KEY_ID,
    secretAccessKey: env.EMAIL_SECRET_ACCESS_KEY,
  };
};

const createSesTransport = () => {
  const sesClient = new SESv2Client({
    credentials: resolveSesCredentials(),
    region: resolveSesRegion(),
  });

  const options: SESTransport.Options = {
    SES: { SendEmailCommand, sesClient },
  };

  return createTransport(options);
};

const getTransporter = () => {
  cachedTransporter ??= (() => {
    if (env.EMAIL_PROVIDER === "smtp") {
      return createSmtpTransport(resolveSmtpUrl());
    }

    if (env.EMAIL_PROVIDER === "ses" && hasSesCredentials()) {
      return createSesTransport();
    }

    throw new Error("Email transport requires EMAIL_PROVIDER with matching credentials.");
  })();

  return cachedTransporter;
};

const resolveFrom = (type?: BetterAuthEmailType) => {
  if (type) {
    return env.EMAIL_FROM_AUTH ?? env.EMAIL_FROM;
  }

  return env.EMAIL_FROM;
};

const renderBetterAuthOtpEmail = async ({
  otp,
  type,
}: Pick<SendBetterAuthOtpInput, "otp" | "type">) => {
  const component = BetterAuthOtpTemplate({ logoBaseUrl: getBaseUrl(env), otp, type });

  return {
    html: await render(component),
    text: await render(component, { plainText: true }),
  };
};

export const sendEmail = async ({ from, html, replyTo, subject, text, to }: SendEmailInput) => {
  const transporter = getTransporter();
  const message: SMTPTransport.MailOptions = {
    from: from ?? resolveFrom(),
    html,
    replyTo: replyTo ?? env.EMAIL_REPLY_TO,
    subject,
    text,
    to,
  };

  await withSpan(
    "email.send",
    {
      attributes: {
        "tailorkit.package": "email",
        "email.provider": env.EMAIL_PROVIDER,
      },
    },
    () => transporter.sendMail(message),
  );
};

export const sendBetterAuthOtpEmail = async ({ email, otp, type }: SendBetterAuthOtpInput) => {
  const { html, text } = await withSpan(
    "email.render_better_auth_otp",
    {
      attributes: {
        "tailorkit.package": "email",
        "email.template": "better_auth_otp",
        "email.otp_type": type,
      },
    },
    () => renderBetterAuthOtpEmail({ otp, type }),
  );

  await sendEmail({
    from: resolveFrom(type),
    html,
    replyTo: env.EMAIL_REPLY_TO,
    subject: betterAuthEmailSubjects[type],
    text,
    to: email,
  });
};

export const sendOrganizationInvitationEmail = async ({
  email,
  invitationId,
  inviterName,
  organizationName,
  role,
}: SendOrganizationInvitationEmailInput) => {
  const acceptUrl = new URL("/account/invites", getBaseUrl(env));
  acceptUrl.searchParams.set("invitationId", invitationId);

  const component = InvitationTemplate({
    acceptUrl: acceptUrl.toString(),
    inviterName,
    logoBaseUrl: getBaseUrl(env),
    organizationName,
    role: role ?? "member",
  });

  const rendered = await withSpan(
    "email.render_invitation",
    {
      attributes: {
        "tailorkit.package": "email",
        "email.template": "organization_invitation",
      },
    },
    async () => ({
      html: await render(component),
      text: await render(component, { plainText: true }),
    }),
  );

  await sendEmail({
    from: env.EMAIL_FROM_INVITE ?? env.EMAIL_FROM_AUTH ?? env.EMAIL_FROM,
    html: rendered.html,
    replyTo: env.EMAIL_REPLY_TO,
    subject: `${inviterName ?? "Someone"} invited you to join ${organizationName}`,
    text: rendered.text,
    to: email,
  });
};

export { BetterAuthOtpTemplate, InvitationTemplate };
export type { BetterAuthEmailType };
