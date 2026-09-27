import { ORPCError } from "@orpc/server";
import {
  cliAuthApprove,
  cliAuthDeny,
  cliAuthPoll,
  cliAuthStart,
} from "@tailorkit/client-platform/client";
import { z } from "zod";
import { getTailorKitScope, o, requireCliDeployToken, requireHostAuth } from "../procedures";

const runPlatformCliAuthRequest = async <T>(request: Promise<T>): Promise<T> => {
  try {
    return await request;
  } catch (error) {
    if (typeof error === "string" && error.toLowerCase() === "unauthorized") {
      throw new ORPCError("UNAUTHORIZED", {
        message: "TailorKit platform rejected the host project key. Check TAILORKIT_PROJECT_KEY.",
      });
    }

    throw error;
  }
};

export const cliAuthRouter = {
  approve: o
    .use(requireHostAuth)
    .input(z.object({ userCode: z.string().min(1) }))
    .handler(
      async ({ context, input }) =>
        await runPlatformCliAuthRequest(
          cliAuthApprove({
            body: {
              scope: getTailorKitScope(context),
              userCode: input.userCode,
            },
            client: context.platform,
            headers: context.platformHeaders,
          }),
        ),
    ),
  deny: o
    .use(requireHostAuth)
    .input(z.object({ userCode: z.string().min(1) }))
    .handler(
      async ({ context, input }) =>
        await runPlatformCliAuthRequest(
          cliAuthDeny({
            body: {
              userCode: input.userCode,
            },
            client: context.platform,
            headers: context.platformHeaders,
          }),
        ),
    ),
  poll: o.input(z.object({ deviceCode: z.string().min(1) })).handler(
    async ({ context, input }) =>
      await runPlatformCliAuthRequest(
        cliAuthPoll({
          body: {
            deviceCode: input.deviceCode,
          },
          client: context.platform,
          headers: context.platformHeaders,
        }),
      ),
  ),
  start: o.input(z.object({})).handler(
    async ({ context }) =>
      await runPlatformCliAuthRequest(
        cliAuthStart({
          body: {},
          client: context.platform,
          headers: context.platformHeaders,
        }),
      ),
  ),
  verifyToken: o
    .input(z.object({}))
    .use(requireCliDeployToken)
    .handler(({ context }) => ({ scope: getTailorKitScope(context) })),
};
