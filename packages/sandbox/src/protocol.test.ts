import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";
import { HostToIframePayload, IframeToHostPayload } from "./protocol.js";
import type { RemoteNode, RemotePatch } from "./protocol.js";

const text = { id: "text", kind: "text", text: "Hello" } satisfies RemoteNode;
const callback = { callback: "onClick", event: "click", inputCount: 1 };
const tree = {
  children: [
    {
      callbacks: [callback],
      children: [text],
      id: "button",
      kind: "element",
      props: { disabled: false, custom: undefined },
      type: "Button",
    },
  ],
  id: "root",
  kind: "fragment",
} satisfies RemoteNode;
const patches = [
  { beforeId: "text", node: tree, op: "insert", parentId: "root" },
  { nodeId: "text", op: "remove" },
  { name: "custom", nodeId: "button", op: "setProp", value: undefined },
  { name: "disabled", nodeId: "button", op: "removeProp" },
  { nodeId: "text", op: "setText", text: "Updated" },
  { callbacks: [callback], nodeId: "button", op: "setCallbacks" },
] satisfies RemotePatch[];

describe("sandbox protocol", () => {
  it.each([
    {
      type: "backendSessionResult",
      data: {
        id: "session",
        session: { token: "jwt", expiresAt: 123, url: "https://runtime.test/rpc" },
      },
    },
    {
      type: "backendSessionResult",
      data: { id: "session", error: { code: "UNAVAILABLE", message: "Unavailable" } },
    },
    {
      type: "init",
      data: { appSource: "// app", appUrl: "app.js", props: { arbitrary: undefined } },
    },
    {
      type: "dispatchCallback",
      data: { args: [undefined, null, { custom: true }], event: "click", nodeId: "button" },
    },
    { type: "dispatchCallback", data: { event: "click", nodeId: "button" } },
    { type: "animationFrame", data: { timestamp: 1.5 } },
  ] satisfies HostToIframePayload[])("accepts host message $type", (payload) => {
    expect(v.parse(HostToIframePayload, payload)).toEqual(payload);
  });

  it.each([
    { type: "backendSessionRequest", data: { id: "session", refresh: true } },
    { type: "ready" },
    { type: "snapshot", data: { revision: 1, tree } },
    { type: "patches", data: { revision: 2, patches } },
    { type: "error", data: { message: "Failure" } },
    { type: "requestAnimationFrame", data: {} },
  ] satisfies IframeToHostPayload[])("accepts iframe message $type", (payload) => {
    expect(v.parse(IframeToHostPayload, payload)).toEqual(payload);
  });

  it.each([
    { type: "ready", extra: true },
    { type: "backendSessionRequest", data: { id: "session", refresh: true, appId: "forged" } },
    {
      type: "snapshot",
      data: { revision: 1, tree: { ...tree, children: [{ ...text, extra: true }] } },
    },
    { type: "patches", data: { revision: 1, patches: [{ ...patches[0], extra: true }] } },
    {
      type: "patches",
      data: {
        revision: 1,
        patches: [
          { callbacks: [{ ...callback, extra: true }], nodeId: "button", op: "setCallbacks" },
        ],
      },
    },
    { type: "requestAnimationFrame", data: { extra: true } },
    { type: "snapshot", data: { revision: "1", tree } },
    { type: "snapshot", data: { revision: 1, tree: { ...text, kind: "unknown" } } },
    { type: "patches", data: { revision: 1, patches: [{ op: "unknown", nodeId: "text" }] } },
    {
      type: "patches",
      data: { revision: 1, patches: [{ name: "custom", nodeId: "button", op: "setProp" }] },
    },
  ])("rejects malformed iframe message %#", (payload) => {
    expect(v.safeParse(IframeToHostPayload, payload).success).toBe(false);
  });

  it("rejects arrays wherever the protocol requires an object", () => {
    const ready = Object.assign([], { type: "ready" });
    expect(v.safeParse(IframeToHostPayload, ready).success).toBe(false);
    expect(
      v.safeParse(IframeToHostPayload, { type: "requestAnimationFrame", data: [] }).success,
    ).toBe(false);
    expect(
      v.safeParse(IframeToHostPayload, {
        type: "snapshot",
        data: { revision: 1, tree: Object.assign([], text) },
      }).success,
    ).toBe(false);
    expect(
      v.safeParse(IframeToHostPayload, {
        type: "patches",
        data: { revision: 1, patches: [Object.assign([], patches[1])] },
      }).success,
    ).toBe(false);
    expect(
      v.safeParse(IframeToHostPayload, {
        type: "patches",
        data: {
          revision: 1,
          patches: [
            { nodeId: "button", op: "setCallbacks", callbacks: [Object.assign([], callback)] },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      v.safeParse(HostToIframePayload, {
        type: "init",
        data: { appSource: "// app", appUrl: "app.js", props: [] },
      }).success,
    ).toBe(false);
    expect(
      v.safeParse(HostToIframePayload, {
        type: "animationFrame",
        data: Object.assign([], { timestamp: 1 }),
      }).success,
    ).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity])("rejects non-finite numbers: %s", (value) => {
    expect(
      v.safeParse(HostToIframePayload, { type: "animationFrame", data: { timestamp: value } })
        .success,
    ).toBe(false);
    expect(
      v.safeParse(HostToIframePayload, {
        type: "backendSessionResult",
        data: {
          id: "session",
          session: { token: "jwt", expiresAt: value, url: "https://runtime.test" },
        },
      }).success,
    ).toBe(false);
    expect(
      v.safeParse(IframeToHostPayload, { type: "snapshot", data: { revision: value, tree } })
        .success,
    ).toBe(false);
    expect(
      v.safeParse(IframeToHostPayload, {
        type: "patches",
        data: {
          revision: 1,
          patches: [
            {
              callbacks: [{ ...callback, inputCount: value }],
              nodeId: "button",
              op: "setCallbacks",
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it.each(["", "s".repeat(129)])("rejects out-of-bounds session IDs", (id) => {
    expect(
      v.safeParse(HostToIframePayload, { type: "backendSessionResult", data: { id } }).success,
    ).toBe(false);
    expect(
      v.safeParse(IframeToHostPayload, {
        type: "backendSessionRequest",
        data: { id, refresh: false },
      }).success,
    ).toBe(false);
  });

  it("enforces session token limits and strict session fields", () => {
    const session = { token: "t".repeat(8192), expiresAt: 123, url: "https://runtime.test" };
    const payload = { type: "backendSessionResult", data: { id: "s".repeat(128), session } };
    expect(v.safeParse(HostToIframePayload, payload).success).toBe(true);
    expect(
      v.safeParse(HostToIframePayload, {
        ...payload,
        data: { ...payload.data, session: { ...session, token: "t".repeat(8193) } },
      }).success,
    ).toBe(false);
    expect(
      v.safeParse(HostToIframePayload, {
        ...payload,
        data: { ...payload.data, session: { ...session, extra: true } },
      }).success,
    ).toBe(false);
    expect(
      v.safeParse(HostToIframePayload, {
        ...payload,
        data: { ...payload.data, error: { code: "UNKNOWN", message: "Failure" } },
      }).success,
    ).toBe(false);
  });

  it.each([
    "https://runtime.test/rpc",
    "mailto:user@example.test",
    "custom:session",
    "  https://run\ntime.test/rpc  ",
  ])("preserves absolute URL validation: %s", (url) => {
    const payload = {
      type: "backendSessionResult",
      data: { id: "session", session: { token: "jwt", expiresAt: 123, url } },
    };
    expect(v.parse(HostToIframePayload, payload)).toEqual({
      ...payload,
      data: {
        ...payload.data,
        session: { ...payload.data.session, url: url.trim().replace(/[\t\n\r]/gu, "") },
      },
    });
  });

  it.each(["/rpc", "invalid", "https://"])("rejects invalid session URLs: %s", (url) => {
    expect(
      v.safeParse(HostToIframePayload, {
        type: "backendSessionResult",
        data: { id: "session", session: { token: "jwt", expiresAt: 123, url } },
      }).success,
    ).toBe(false);
  });
});
