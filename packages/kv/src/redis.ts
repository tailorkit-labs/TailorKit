import IORedis from "ioredis";
import { withSpan } from "@tailorkit/observability";
import type { GetOptions, KV, MessageHandler, SetOptions, Unsubscribe } from "./types.js";
import { withTimeout } from "./with-timeout.js";

const INCREMENT_WITH_TTL_SCRIPT = `
local value = redis.call("INCR", KEYS[1])
if value == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return value
`;
const CLAIM_UPLOAD_SCRIPT = `
if redis.call("EXISTS", KEYS[2]) == 1 then
  return 0
end
if (redis.call("GET", KEYS[1]) or "") ~= ARGV[1] then
  return 0
end
redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3])
return 1
`;
const SET_PREVIEW_PRESENCE_IF_ACTIVE_SCRIPT = `
if redis.call("EXISTS", KEYS[3]) == 1 then
  return 0
end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("SET", KEYS[2], "1", "EX", ARGV[3])
return 1
`;
const KEEP_PREVIEW_SESSION_IF_DEVELOPER_PRESENT_SCRIPT = `
if redis.call("EXISTS", KEYS[3]) == 1 then
  return 0
end
if redis.call("EXISTS", KEYS[1]) == 1 then
  return 1
end
if redis.call("EXISTS", KEYS[2]) == 0 and ARGV[2] ~= "1" then
  return 1
end
redis.call("SET", KEYS[3], "1", "EX", ARGV[1])
return 0
`;
const PROMOTE_IF_OWNER_AND_NEWER_SCRIPT = `
if redis.call("EXISTS", KEYS[3]) == 1 then
  return 0
end
if redis.call("GET", KEYS[2]) ~= ARGV[1] then
  return 0
end
local current = redis.call("GET", KEYS[1])
if current and cjson.decode(current).revision >= tonumber(ARGV[2]) then
  return 0
end
redis.call("SET", KEYS[1], ARGV[3], "EX", ARGV[4])
redis.call("DEL", KEYS[2])
return 1
`;

async function subscribe(
  redis: IORedis,
  channel: string,
  handler: MessageHandler,
): Promise<Unsubscribe> {
  // Redis connections in subscriber mode cannot execute ordinary commands.
  // Keep the KV client's command connection separate from each subscription.
  const subscriber = redis.duplicate();
  subscriber.on("message", (receivedChannel: string, message: string) => {
    if (receivedChannel === channel) {
      handler(message);
    }
  });

  try {
    await subscriber.subscribe(channel);
  } catch (error) {
    subscriber.disconnect();
    throw error;
  }

  return async () => {
    subscriber.removeAllListeners("message");
    try {
      await subscriber.unsubscribe(channel);
    } finally {
      subscriber.disconnect();
    }
  };
}

export function createRedisKV(url: string): KV<"redis"> {
  const redis = new IORedis(url);

  return {
    type: "redis",
    engine: redis,
    get: (key, options?: GetOptions) =>
      withSpan("kv.get", { attributes: { "tailorkit.package": "kv", "kv.type": "redis" } }, () =>
        withTimeout(redis.get(key), options?.timeout),
      ),
    getAndDelete: (key) =>
      withSpan(
        "kv.get_and_delete",
        { attributes: { "tailorkit.package": "kv", "kv.type": "redis" } },
        () => redis.getdel(key),
      ),
    claimUpload: (ownerKey, endedKey, expectedOwner, newOwner, ttl) =>
      withSpan(
        "kv.claim_upload",
        { attributes: { "tailorkit.package": "kv", "kv.type": "redis" } },
        async () => {
          if (!Number.isInteger(ttl) || ttl <= 0) {
            throw new TypeError("KV upload TTL must be a positive integer.");
          }
          return (
            Number(
              await redis.eval(
                CLAIM_UPLOAD_SCRIPT,
                2,
                ownerKey,
                endedKey,
                expectedOwner ?? "",
                newOwner,
                ttl,
              ),
            ) === 1
          );
        },
      ),
    setPreviewPresenceIfActive: (presenceKey, seenKey, endedKey, value, presenceTtl, seenTtl) =>
      withSpan(
        "kv.set_preview_presence_if_active",
        { attributes: { "tailorkit.package": "kv", "kv.type": "redis" } },
        async () =>
          Number(
            await redis.eval(
              SET_PREVIEW_PRESENCE_IF_ACTIVE_SCRIPT,
              3,
              presenceKey,
              seenKey,
              endedKey,
              value,
              presenceTtl,
              seenTtl,
            ),
          ) === 1,
      ),
    keepPreviewSessionIfDeveloperPresent: (
      presenceKey,
      seenKey,
      endedKey,
      endedTtl,
      expireUnseen,
    ) =>
      withSpan(
        "kv.keep_preview_session_if_developer_present",
        { attributes: { "tailorkit.package": "kv", "kv.type": "redis" } },
        async () =>
          Number(
            await redis.eval(
              KEEP_PREVIEW_SESSION_IF_DEVELOPER_PRESENT_SCRIPT,
              3,
              presenceKey,
              seenKey,
              endedKey,
              endedTtl,
              expireUnseen ? "1" : "0",
            ),
          ) === 1,
      ),
    increment: (key, ttl) =>
      withSpan(
        "kv.increment",
        {
          attributes: {
            "tailorkit.package": "kv",
            "kv.type": "redis",
            "kv.ttl_seconds": ttl,
          },
        },
        async () => {
          if (!Number.isInteger(ttl) || ttl <= 0) {
            throw new TypeError("Redis increment TTL must be a positive integer");
          }

          return Number(await redis.eval(INCREMENT_WITH_TTL_SCRIPT, 1, key, ttl));
        },
      ),
    set: async (key, value, options?: SetOptions) => {
      if (options?.ttl) {
        const ttl = options.ttl;
        await withSpan(
          "kv.set",
          {
            attributes: {
              "tailorkit.package": "kv",
              "kv.type": "redis",
              "kv.ttl_seconds": ttl,
            },
          },
          () => redis.setex(key, ttl, value),
        );
      } else {
        await withSpan(
          "kv.set",
          { attributes: { "tailorkit.package": "kv", "kv.type": "redis" } },
          () => redis.set(key, value),
        );
      }
    },
    promoteIfOwnerAndNewer: (pointerKey, ownerKey, endedKey, expectedOwner, value, revision, ttl) =>
      withSpan(
        "kv.promote_if_owner_and_newer",
        { attributes: { "tailorkit.package": "kv", "kv.type": "redis" } },
        async () => {
          if (
            !Number.isSafeInteger(revision) ||
            revision <= 0 ||
            !Number.isInteger(ttl) ||
            ttl <= 0
          ) {
            throw new TypeError("KV revision and TTL must be positive integers.");
          }
          return (
            Number(
              await redis.eval(
                PROMOTE_IF_OWNER_AND_NEWER_SCRIPT,
                3,
                pointerKey,
                ownerKey,
                endedKey,
                expectedOwner,
                revision,
                value,
                ttl,
              ),
            ) === 1
          );
        },
      ),
    delete: async (key) => {
      await withSpan(
        "kv.delete",
        { attributes: { "tailorkit.package": "kv", "kv.type": "redis" } },
        () => redis.del(key),
      );
    },
    publish: (channel, message) =>
      withSpan(
        "kv.publish",
        { attributes: { "tailorkit.package": "kv", "kv.type": "redis" } },
        () => redis.publish(channel, message),
      ),
    subscribe: (channel, handler) =>
      withSpan(
        "kv.subscribe",
        { attributes: { "tailorkit.package": "kv", "kv.type": "redis" } },
        () => subscribe(redis, channel, handler),
      ),
  };
}
