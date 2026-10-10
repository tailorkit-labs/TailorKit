import { AppError } from "./errors";

import type { Invocation } from "@tailorkit/app/protocol";
import type { AppDefinition, Identity, FunctionKind } from "@tailorkit/app/server";

export type Functions = AppDefinition["functions"];
type RegisteredFunction = Exclude<Functions[string], Functions>;
export function isFunction(value: Functions[string]): value is RegisteredFunction {
  return typeof value.kind === "string" && typeof value.handler === "function";
}

export function resolveFunction(
  functions: Functions,
  name: string,
): RegisteredFunction | undefined {
  let current: RegisteredFunction | Functions = functions;
  for (const part of name.split(".")) {
    if (isFunction(current) || !Object.hasOwn(current, part)) {
      return;
    }
    const next: RegisteredFunction | Functions | undefined = current[part];
    if (!next) {
      return;
    }
    current = next;
  }
  return isFunction(current) ? current : undefined;
}

function freezeIdentity(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeIdentity(child);
  Object.freeze(value);
}

export function prepareFunction(
  app: AppDefinition,
  input: Invocation,
  identity: Identity,
  kind: FunctionKind,
) {
  if (identity.expiresAt <= Date.now()) {
    throw new AppError("UNAUTHORIZED", "App token expired");
  }
  freezeIdentity(identity);
  const fn = resolveFunction(app.functions, input.name);
  if (!fn || fn.kind !== kind) {
    throw new AppError("NOT_FOUND", "App function not found");
  }
  const args = fn.args.safeParse(input.args);
  if (!args.success) {
    throw new AppError("BAD_REQUEST", "Invalid function arguments");
  }
  return { fn, args: args.data };
}

/** Validate serialization before a mutation can commit or an action can return. */
export function functionValue(fn: RegisteredFunction, value: unknown): unknown {
  if (fn.result) {
    const result = fn.result.safeParse(value);
    if (!result.success) {
      throw new AppError("INTERNAL_SERVER_ERROR", "Invalid function result");
    }
    value = result.data;
  }
  const serialized = JSON.stringify(value ?? null);
  return JSON.parse(serialized);
}
