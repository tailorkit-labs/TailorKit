import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Schema } from "../../schema/index";
import { getTailorKitContext, o, requireHostAuth } from "../procedures";

const validateSchema = async <T>(schema: Schema | undefined, value: unknown): Promise<T> => {
  if (schema === undefined) {
    return value as T;
  }

  const result = await schema["~standard"].validate(value);
  if ("issues" in result) {
    throw new ORPCError("BAD_REQUEST", { message: "Invalid TailorKit payload" });
  }

  return result.value as T;
};

export const actionRouter = {
  execute: o
    .use(requireHostAuth)
    .input(z.object({ input: z.unknown().optional(), path: z.string() }))
    .handler(async ({ context, input }) => {
      const implementation = context.actions.get(input.path);

      if (implementation === undefined) {
        throw new ORPCError("NOT_FOUND", { message: "Action not found" });
      }

      const actionInput = await validateSchema(implementation.definition.input, input.input);
      const output = await implementation.handler({
        context: getTailorKitContext(context).actionContext,
        input: actionInput,
      });

      return validateSchema(implementation.definition.output, output);
    }),
};
