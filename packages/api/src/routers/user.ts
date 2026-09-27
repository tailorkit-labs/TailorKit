import { auth } from "@tailorkit/auth";
import { db } from "@tailorkit/db";
import { account } from "@tailorkit/db/schema/auth";
import { env } from "#env";
import { and, eq } from "drizzle-orm";
import { publicProcedure, protectedProcedure, requireOrg } from "../procedures";
import z from "zod";
import { validateOrgSlug } from "@tailorkit/db/validate-org-slug";

const MANUAL_ORG_ONBOARDING_MESSAGE =
  "We're currently onboarding users manually. Contact us to create an organisation for your account.";

export const userRouter = {
  getSession: publicProcedure.handler(({ context }) => ({
    session: context.session,
    user: context.user,
  })),

  listAccounts: protectedProcedure.handler(({ context }) =>
    auth.api.listUserAccounts({ headers: context.headers }),
  ),

  linkSocial: protectedProcedure
    .input(
      z.object({
        callbackURL: z.string().optional(),
        errorCallbackURL: z.string().optional(),
        provider: z.enum(["github", "google"]),
      }),
    )
    .handler(({ input, context }) =>
      auth.api.linkSocialAccount({ body: input, headers: context.headers }),
    ),

  unlinkAccount: protectedProcedure
    .input(z.object({ accountId: z.string() }))
    .handler(async ({ input, context, errors }) => {
      const accounts = await auth.api.listUserAccounts({ headers: context.headers });
      const passkeys = await db.query.passkey.findMany({
        columns: { id: true },
        where: { userId: context.user.id },
      });

      if (accounts.length + passkeys.length <= 1) {
        throw errors.BAD_REQUEST({ message: "You must keep at least one sign-in method." });
      }

      const [deletedAccount] = await db
        .delete(account)
        .where(and(eq(account.id, input.accountId), eq(account.userId, context.user.id)))
        .returning({ id: account.id });

      if (!deletedAccount) {
        throw errors.BAD_REQUEST({ message: "Account not found." });
      }

      return { status: true };
    }),

  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(1),
        revokeOtherSessions: z.boolean().optional(),
      }),
    )
    .handler(({ input, context }) =>
      auth.api.changePassword({ body: input, headers: context.headers }),
    ),

  listSessions: protectedProcedure.handler(({ context }) =>
    auth.api.listSessions({ headers: context.headers }),
  ),

  revokeSession: protectedProcedure
    .input(z.object({ token: z.string() }))
    .handler(({ input, context }) =>
      auth.api.revokeSession({ body: input, headers: context.headers }),
    ),

  revokeOtherSessions: protectedProcedure.handler(({ context }) =>
    auth.api.revokeOtherSessions({ headers: context.headers }),
  ),

  enableTwoFactor: protectedProcedure
    .input(z.object({ method: z.literal("totp"), password: z.string() }))
    .handler(({ input, context }) =>
      auth.api.enableTwoFactor({ body: input, headers: context.headers }),
    ),

  verifyTotp: protectedProcedure
    .input(z.object({ code: z.string().length(6) }))
    .handler(({ input, context }) =>
      auth.api.verifyTOTP({ body: input, headers: context.headers }),
    ),

  disableTwoFactor: protectedProcedure
    .input(z.object({ password: z.string() }))
    .handler(({ input, context }) =>
      auth.api.disableTwoFactor({ body: input, headers: context.headers }),
    ),

  generateBackupCodes: protectedProcedure
    .input(z.object({ password: z.string() }))
    .handler(({ input, context }) =>
      auth.api.generateBackupCodes({ body: input, headers: context.headers }),
    ),

  getOrgs: protectedProcedure.handler(async ({ context }) => {
    const orgs = await db.query.organization.findMany({
      where: {
        members: { userId: context.user.id },
      },
    });

    return orgs;
  }),

  getOrg: protectedProcedure
    .input(z.union([z.object({ orgId: z.string() }), z.object({ orgSlug: z.string() })]))
    .use(requireOrg())
    .handler(({ context }) => context.org),

  checkOrgSlug: protectedProcedure
    .input(z.object({ slug: z.string().min(2).max(48) }))
    .handler(async ({ input, errors }) => {
      const result = validateOrgSlug(input.slug);
      if (!result.valid) {
        throw errors.BAD_REQUEST({ message: result.reason });
      }

      const existingOrg = await db.query.organization.findFirst({
        columns: { id: true },
        where: { slug: input.slug },
      });

      return { available: !existingOrg };
    }),

  createOrg: protectedProcedure
    .input(z.object({ name: z.string().min(1), slug: z.string().min(2).max(48) }))
    .handler(async ({ input, context, errors }) => {
      if (env.VERCEL_ENV === "production") {
        throw errors.FORBIDDEN({ message: MANUAL_ORG_ONBOARDING_MESSAGE });
      }

      const result = validateOrgSlug(input.slug);
      if (!result.valid) {
        throw errors.BAD_REQUEST({ message: result.reason });
      }

      const existingOrg = await db.query.organization.findFirst({
        columns: { id: true },
        where: { slug: input.slug },
      });

      if (existingOrg) {
        throw errors.BAD_REQUEST({ message: "This organisation slug is already taken." });
      }

      const org = await auth.api.createOrganization({
        body: { name: input.name, slug: input.slug, userId: context.user.id },
      });

      return org;
    }),

  getPendingInvitations: protectedProcedure.handler(async ({ context }) => {
    const invitations = await db.query.invitation.findMany({
      where: { email: context.user.email, status: "pending", expiresAt: { gt: new Date() } },
      with: { organization: true },
    });
    return invitations;
  }),

  acceptInvitation: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .handler(({ input, context }) =>
      auth.api.acceptInvitation({
        body: { invitationId: input.invitationId },
        headers: context.headers,
      }),
    ),

  rejectInvitation: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .handler(({ input, context }) =>
      auth.api.rejectInvitation({
        body: { invitationId: input.invitationId },
        headers: context.headers,
      }),
    ),
};
