import { ORPCError } from "@orpc/server";
import { hashSecret } from "@tailorkit/api-utils/hashing";
import { db } from "@tailorkit/db";
import { cliAuthSession, cliToken } from "@tailorkit/db/schema/cli-auth";
import { env } from "#env";
import { and, eq, gt } from "drizzle-orm";
import { randomBytes, randomInt } from "node:crypto";
import z from "zod";
import { o, protectedRouter } from "../procedures";

const deviceCodeBytes = 32;
const deployTokenBytes = 32;
const userCodeLength = 9;
const userCodeSections = 3;
const authExpiresInMilliseconds = 5 * 60 * 1000; // 5 minutes
const tokenExpiresInMilliseconds = 12 * 60 * 60 * 1000; // 12 hours

// Skip out some characters to avoid confusion with similar characters (e.g. 0/O, 1/I, etc.)
const userCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function hashCliSecret(value: string): string {
  if (!env.AUTH_SECRET) {
    throw new Error("AUTH_SECRET is required for CLI auth secret hashing.");
  }

  return hashSecret(value, env.AUTH_SECRET);
}

function generateSecret(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function generateUserCode(): string {
  let code = "";

  for (let index = 0; index < userCodeLength; index += 1) {
    code += userCodeAlphabet.charAt(randomInt(userCodeAlphabet.length));
  }

  const sectionLength = Math.floor(userCodeLength / userCodeSections);

  const sections = [];
  for (let i = 0; i < userCodeSections; i += 1) {
    sections.push(code.slice(i * sectionLength, (i + 1) * sectionLength));
  }

  return sections.join("-");
}

function normalizeUserCode(userCode: string): string {
  return userCode.trim().replaceAll("-", "").toUpperCase();
}

const startCliAuth = protectedRouter
  .route({
    path: "/start",
    method: "POST",
  })
  .input(z.object({ body: z.object({}) }))
  .output(
    z.object({
      body: z.object({
        deviceCode: z.string(),
        expiresAt: z.date(),
        userCode: z.string(),
      }),
    }),
  )
  .handler(async ({ context }) => {
    const deviceCode = generateSecret(deviceCodeBytes);
    const userCode = generateUserCode();
    const expiresAt = new Date(Date.now() + authExpiresInMilliseconds);

    await db.insert(cliAuthSession).values({
      deviceCodeHash: hashCliSecret(deviceCode),
      expiresAt,
      projectId: context.project.id,
      userCodeHash: hashCliSecret(normalizeUserCode(userCode)),
    });

    return {
      body: {
        deviceCode,
        expiresAt,
        userCode,
      },
    };
  });

const approveCliAuth = protectedRouter
  .route({
    path: "/approve",
    method: "POST",
  })
  .input(
    z.object({
      body: z.object({
        scopeId: z.string().min(1),
        userCode: z.string().min(1),
      }),
    }),
  )
  .output(z.object({ body: z.object({ id: z.string() }) }))
  .handler(async ({ context, input }) => {
    const [session] = await db
      .update(cliAuthSession)
      .set({
        scopeId: input.body.scopeId,
        status: "approved",
      })
      .where(
        and(
          eq(cliAuthSession.projectId, context.project.id),
          eq(cliAuthSession.userCodeHash, hashCliSecret(normalizeUserCode(input.body.userCode))),
          eq(cliAuthSession.status, "pending"),
          gt(cliAuthSession.expiresAt, new Date()),
        ),
      )
      .returning({ id: cliAuthSession.id });

    if (!session) {
      throw new ORPCError("NOT_FOUND", { message: "CLI auth session not found." });
    }

    return { body: session };
  });

const denyCliAuth = protectedRouter
  .route({
    path: "/deny",
    method: "POST",
  })
  .input(z.object({ body: z.object({ userCode: z.string().min(1) }) }))
  .output(z.object({ body: z.object({ id: z.string() }) }))
  .handler(async ({ context, input }) => {
    const [session] = await db
      .update(cliAuthSession)
      .set({ status: "denied" })
      .where(
        and(
          eq(cliAuthSession.projectId, context.project.id),
          eq(cliAuthSession.userCodeHash, hashCliSecret(normalizeUserCode(input.body.userCode))),
          eq(cliAuthSession.status, "pending"),
          gt(cliAuthSession.expiresAt, new Date()),
        ),
      )
      .returning({ id: cliAuthSession.id });

    if (!session) {
      throw new ORPCError("NOT_FOUND", { message: "CLI auth session not found." });
    }

    return { body: session };
  });

const pollCliAuth = protectedRouter
  .route({
    path: "/poll",
    method: "POST",
  })
  .input(z.object({ body: z.object({ deviceCode: z.string().min(1) }) }))
  .output(
    z.object({
      body: z.discriminatedUnion("status", [
        z.object({ status: z.literal("pending") }),
        z.object({ status: z.literal("denied") }),
        z.object({
          deployToken: z.string(),
          scopeId: z.string(),
          status: z.literal("approved"),
        }),
        z.object({ status: z.literal("expired") }),
      ]),
    }),
  )
  .handler(async ({ context, input }) => {
    const deviceCodeHash = hashCliSecret(input.body.deviceCode);
    const now = new Date();
    const session = await db.query.cliAuthSession.findFirst({
      where: {
        deviceCodeHash,
        projectId: context.project.id,
      },
    });

    if (!session) {
      throw new ORPCError("NOT_FOUND", { message: "CLI auth session not found." });
    }

    await db
      .update(cliAuthSession)
      .set({ lastPolledAt: new Date() })
      .where(eq(cliAuthSession.id, session.id));

    if (session.expiresAt.getTime() <= now.getTime()) {
      return { body: { status: "expired" as const } };
    }

    if (session.status === "denied") {
      return { body: { status: "denied" as const } };
    }

    if (session.status === "pending") {
      return { body: { status: "pending" as const } };
    }

    if (!session.scopeId) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Approved CLI auth session is missing scopeId.",
      });
    }

    const deployToken = generateSecret(deployTokenBytes);
    const deletedSession = await db.transaction(async (tx) => {
      const [consumedSession] = await tx
        .delete(cliAuthSession)
        .where(
          and(
            eq(cliAuthSession.id, session.id),
            eq(cliAuthSession.projectId, context.project.id),
            eq(cliAuthSession.status, "approved"),
            gt(cliAuthSession.expiresAt, now),
          ),
        )
        .returning();

      if (!consumedSession) {
        return null;
      }

      if (!consumedSession.scopeId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Approved CLI auth session is missing scopeId.",
        });
      }
      const scopeId = consumedSession.scopeId;

      await tx.insert(cliToken).values({
        expiresAt: new Date(now.getTime() + tokenExpiresInMilliseconds),
        projectId: context.project.id,
        scopeId,
        tokenHash: hashCliSecret(deployToken),
      });

      return { ...consumedSession, scopeId };
    });

    if (!deletedSession) {
      throw new ORPCError("NOT_FOUND", { message: "CLI auth session not found." });
    }

    return {
      body: {
        deployToken,
        scopeId: deletedSession.scopeId,
        status: "approved" as const,
      },
    };
  });

const verifyCliAuthToken = protectedRouter
  .route({
    path: "/verify-token",
    method: "POST",
  })
  .input(z.object({ body: z.object({ deployToken: z.string().min(1) }) }))
  .output(z.object({ body: z.object({ scopeId: z.string() }) }))
  .handler(async ({ context, input }) => {
    const token = await db.query.cliToken.findFirst({
      where: {
        tokenHash: hashCliSecret(input.body.deployToken),
        projectId: context.project.id,
      },
    });

    if (!token || token.expiresAt.getTime() <= Date.now() || token.revokedAt) {
      throw new ORPCError("UNAUTHORIZED", { message: "Invalid CLI deploy token." });
    }

    await db.update(cliToken).set({ lastUsedAt: new Date() }).where(eq(cliToken.id, token.id));

    return { body: { scopeId: token.scopeId } };
  });

export const cliAuthRouter = o.prefix("/cli-auth").router({
  approve: approveCliAuth,
  deny: denyCliAuth,
  poll: pollCliAuth,
  start: startCliAuth,
  verifyToken: verifyCliAuthToken,
});
