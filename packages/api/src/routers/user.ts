import { auth, getSocialProviderAvailability } from "@tailorkit/auth";
import { db } from "@tailorkit/db";
import { account } from "@tailorkit/db/schema/auth";
import { getKV } from "@tailorkit/kv";
import { env } from "#env";
import { and, eq } from "drizzle-orm";
import { publicProcedure, protectedProcedure, requireOrg } from "../procedures";
import z from "zod";
import { validateOrgSlug } from "@tailorkit/db/validate-org-slug";

const MANUAL_ORG_ONBOARDING_MESSAGE =
  "We're currently onboarding users manually. Contact us to create an organisation for your account.";

async function getGitHubUsername(accountId: string, getAccessToken: () => Promise<string | null>) {
  const key = `tailorkit:github-username:${accountId}`;
  let kv: ReturnType<typeof getKV> = null;

  try {
    kv = getKV();
    const cachedUsername = kv ? await kv.get(key, { timeout: 1000 }) : null;
    if (cachedUsername) {
      return cachedUsername;
    }
  } catch {
    // A cache outage should not make account management unavailable.
  }

  const accessToken = await getAccessToken();
  if (!accessToken) {
    return null;
  }

  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${accessToken}`,
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return null;
    }

    const profile: unknown = await response.json();
    if (typeof profile !== "object" || profile === null || !("login" in profile)) {
      return null;
    }

    const username = profile.login;
    if (typeof username !== "string") {
      return null;
    }

    void kv?.set(key, username, { ttl: 86_400 }).catch(() => {});
    return username;
  } catch {
    // Account management should remain available if GitHub is temporarily unavailable.
    return null;
  }
}

export const userRouter = {
  getSocialProviders: publicProcedure.handler(() => getSocialProviderAvailability()),

  getSession: publicProcedure.handler(({ context }) => ({
    session: context.session,
    user: context.user,
  })),

  listAccounts: protectedProcedure.handler(async ({ context }) => {
    const accounts = await auth.api.listUserAccounts({ headers: context.headers });
    const githubAccount = accounts.find((linkedAccount) => linkedAccount.providerId === "github");
    const githubUsername = githubAccount
      ? await getGitHubUsername(githubAccount.id, async () => {
          try {
            const tokens = await auth.api.getAccessToken({
              body: { accountId: githubAccount.id },
              headers: context.headers,
            });
            return tokens.accessToken;
          } catch {
            return null;
          }
        })
      : null;

    return accounts.map((linkedAccount) => ({
      ...linkedAccount,
      githubUsername: linkedAccount.id === githubAccount?.id ? githubUsername : null,
    }));
  }),

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
