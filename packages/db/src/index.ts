import { env } from "#env";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";

import { relations } from "./relations";

export function createDb(): NodePgDatabase<typeof relations> {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to create a database connection.");
  }

  return drizzle(env.DATABASE_URL, { relations });
}

let dbInstance: NodePgDatabase<typeof relations> | undefined;

function getDb(): NodePgDatabase<typeof relations> {
  return (dbInstance ??= createDb());
}

const dbTarget = {} as NodePgDatabase<typeof relations>;
type BoundMethod = (...args: never[]) => unknown;
const boundMethods = new Map<PropertyKey, { method: BoundMethod; bound: BoundMethod }>();

export const db = new Proxy(dbTarget, {
  get(target, property) {
    const instance = getDb();
    const targetDescriptor = Reflect.getOwnPropertyDescriptor(target, property);

    // Preserve Proxy invariants for non-configurable target properties.
    if (targetDescriptor?.configurable === false) {
      if ("value" in targetDescriptor && targetDescriptor.writable === false) {
        return targetDescriptor.value;
      }
      if ("get" in targetDescriptor && targetDescriptor.get === undefined) {
        return;
      }
    }

    const value = Reflect.get(instance, property, instance);
    if (typeof value !== "function") {
      return value;
    }

    const method = value as BoundMethod;
    const cached = boundMethods.get(property);
    if (cached?.method === method) {
      return cached.bound;
    }

    const bound = method.bind(instance);
    boundMethods.set(property, { method, bound });
    return bound;
  },
  set(target, property, value) {
    const instance = getDb();
    const succeeded = Reflect.set(instance, property, value, instance);
    if (!succeeded) {
      return false;
    }

    boundMethods.delete(property);
    if (Reflect.getOwnPropertyDescriptor(target, property)) {
      return Reflect.set(target, property, value, target);
    }
    return true;
  },
  has(_target, property) {
    return Reflect.has(getDb(), property);
  },
  ownKeys(_target) {
    return Reflect.ownKeys(getDb());
  },
  getOwnPropertyDescriptor(target, property) {
    const targetDescriptor = Reflect.getOwnPropertyDescriptor(target, property);
    if (targetDescriptor?.configurable === false || !Reflect.isExtensible(target)) {
      return targetDescriptor;
    }

    const descriptor = Reflect.getOwnPropertyDescriptor(getDb(), property);
    return descriptor ? { ...descriptor, configurable: true } : undefined;
  },
  defineProperty(target, property, descriptor) {
    const succeeded = Reflect.defineProperty(getDb(), property, descriptor);
    if (!succeeded) {
      return false;
    }

    boundMethods.delete(property);
    return Reflect.defineProperty(target, property, descriptor);
  },
  deleteProperty(target, property) {
    const targetDescriptor = Reflect.getOwnPropertyDescriptor(target, property);
    if (targetDescriptor?.configurable === false) {
      return false;
    }

    const succeeded = Reflect.deleteProperty(getDb(), property);
    if (!succeeded) {
      return false;
    }

    boundMethods.delete(property);
    return targetDescriptor ? Reflect.deleteProperty(target, property) : true;
  },
  getPrototypeOf(target) {
    return Reflect.getPrototypeOf(Reflect.isExtensible(target) ? getDb() : target);
  },
  setPrototypeOf(target, prototype) {
    const instance = getDb();
    if (!Reflect.setPrototypeOf(instance, prototype)) {
      return false;
    }
    return Reflect.setPrototypeOf(target, prototype);
  },
  isExtensible(target) {
    return Reflect.isExtensible(target);
  },
  preventExtensions(target) {
    const instance = getDb();
    if (!Reflect.preventExtensions(instance)) {
      return false;
    }

    for (const property of Reflect.ownKeys(instance)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(instance, property);
      if (descriptor && !Reflect.defineProperty(target, property, descriptor)) {
        return false;
      }
    }

    Reflect.setPrototypeOf(target, Reflect.getPrototypeOf(instance));
    return Reflect.preventExtensions(target);
  },
});

export { isOrgSlugReserved } from "./validate-org-slug";
