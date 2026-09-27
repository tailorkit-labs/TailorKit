import type { Redis as UpstashRedis } from "@upstash/redis";
import type IORedis from "ioredis";

export interface SetOptions {
  ttl?: number; // seconds
}

export interface GetOptions {
  /** Maximum wait in milliseconds. Defaults to 5 seconds. */
  timeout?: number;
}

/** Stops a Redis channel subscription and releases its underlying connection. */
export type Unsubscribe = () => Promise<void>;

/**
 * Pub/sub is used for short-lived, best-effort signals such as preview
 * traffic. Consumers must still be able to recover their state from durable
 * storage after reconnecting, because Redis does not retain published values.
 */
export type MessageHandler = (message: string) => void;

export type KVType = "upstash" | "redis";

type KVEngine<T extends KVType> = T extends "upstash" ? UpstashRedis : IORedis;

export interface KV<T extends KVType = KVType> {
  readonly type: T;
  engine: KVEngine<T>;
  get: (key: string, options?: GetOptions) => Promise<string | null>;
  getAndDelete: (key: string) => Promise<string | null>;
  /** Claim or renew an upload marker only if it still matches the observed owner and the session is active. */
  claimUpload: (
    ownerKey: string,
    endedKey: string,
    expectedOwner: string | null,
    newOwner: string,
    ttl: number,
  ) => Promise<boolean>;
  /** Atomically renew the developer lease and seen marker unless the session ended. */
  setPreviewPresenceIfActive: (
    presenceKey: string,
    seenKey: string,
    endedKey: string,
    value: string,
    presenceTtl: number,
    seenTtl: number,
  ) => Promise<boolean>;
  /** Atomically end a previously connected session only when its lease is absent. */
  keepPreviewSessionIfDeveloperPresent: (
    presenceKey: string,
    seenKey: string,
    endedKey: string,
    endedTtl: number,
    expireUnseen?: boolean,
  ) => Promise<boolean>;
  increment: (key: string, ttl: number) => Promise<number>;
  set: (key: string, value: string, options?: SetOptions) => Promise<void>;
  /** Atomically promote the owned upload if its revision advances the pointer. */
  promoteIfOwnerAndNewer: (
    pointerKey: string,
    ownerKey: string,
    endedKey: string,
    expectedOwner: string,
    value: string,
    revision: number,
    ttl: number,
  ) => Promise<boolean>;
  delete: (key: string) => Promise<void>;
  publish: (channel: string, message: string) => Promise<number>;
  subscribe: (channel: string, handler: MessageHandler) => Promise<Unsubscribe>;
}
