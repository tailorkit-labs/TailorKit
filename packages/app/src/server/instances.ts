import { z } from "zod";
import { action, defineServer, isFunction } from "./functions";
import type { AppDefinition, Functions, Identity } from "./functions";
import { AppError } from "../errors";

interface InstanceResolver {
  slot: string;
  path: string;
  dataSchema: z.ZodType;
  resolve: (context: {
    context: Record<string, unknown>;
    identity: Identity;
    signal: AbortSignal;
    queries: unknown;
  }) => unknown;
}

const addressSchema = z.object({
  slot: z.string().min(1).max(255),
  path: z.string().startsWith("/").max(1024),
});

function registeredQueries(functions: Functions): Functions {
  const queries: Record<string, Functions[string]> = {};
  for (const [name, fn] of Object.entries(functions)) {
    if (isFunction(fn)) {
      if (fn.kind === "query") queries[name] = fn;
    } else {
      const nested = registeredQueries(fn);
      if (Object.keys(nested).length) queries[name] = nested;
    }
  }
  return queries;
}

/** Build-generated actions run through the existing authenticated action runtime. */
export function withInstanceResolvers(
  app: AppDefinition,
  resolvers: readonly InstanceResolver[],
): AppDefinition {
  if (Object.hasOwn(app.functions, "_tailorkit")) {
    throw new Error("The _tailorkit function namespace is reserved by TailorKit.");
  }
  const queries = registeredQueries(app.functions);
  const registry = new Map<
    string,
    Map<string, { resolver: InstanceResolver; result: z.ZodType }>
  >();
  for (const resolver of resolvers) {
    addressSchema.parse(resolver);
    let paths = registry.get(resolver.slot);
    if (!paths) {
      paths = new Map();
      registry.set(resolver.slot, paths);
    }
    if (paths.has(resolver.path)) {
      throw new Error(
        `Duplicate instance resolver for slot "${resolver.slot}" and path "${resolver.path}".`,
      );
    }
    const result = z
      .array(
        z.object({
          key: z.string().min(1),
          metadata: z.record(z.string(), z.unknown()),
          data: resolver.dataSchema,
        }),
      )
      .refine((items) => new Set(items.map((item) => item.key)).size === items.length, {
        message: "Instance keys must be unique",
      });
    paths.set(resolver.path, { resolver, result });
  }
  const instances = {
    resolve: action({
      functions: queries,
      args: addressSchema.extend({ context: z.record(z.string(), z.unknown()) }),
      async handler({ args, identity, signal, queries }) {
        const entry = registry.get(args.slot)?.get(args.path);
        if (!entry) throw new AppError("NOT_FOUND", "Instance resolver not found");
        const value = await entry.resolver.resolve({
          context: args.context,
          identity,
          signal,
          queries,
        });
        const result = entry.result.safeParse(value);
        if (!result.success) throw new AppError("INTERNAL_SERVER_ERROR", "Invalid function result");
        return result.data;
      },
    }),
  };
  // Validate generated functions before attaching the reserved namespace.
  const internal = defineServer({ instances });
  return Object.freeze({
    functions: { ...app.functions, _tailorkit: internal.functions },
  });
}
