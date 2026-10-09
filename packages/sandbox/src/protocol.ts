import * as v from "valibot";

// Valibot object schemas also accept arrays; the wire protocol requires objects.
const ObjectInput = v.custom<Record<string, unknown>>(
  (input) => input !== null && typeof input === "object" && !Array.isArray(input),
  "Expected an object",
);
const Props = v.pipe(ObjectInput, v.record(v.string(), v.unknown()));
function strictObject<const TEntries extends v.ObjectEntries>(entries: TEntries) {
  return v.pipe(ObjectInput, v.strictObject(entries));
}

const FiniteNumber = v.pipe(v.number(), v.finite());
const SessionId = v.pipe(v.string(), v.minLength(1), v.maxLength(128));
// Preserve WHATWG URL validation, including non-HTTP absolute URLs.
const SessionUrl = v.pipe(
  v.string(),
  v.check((value) => {
    try {
      new URL(value.trim());
      return true;
    } catch {
      return false;
    }
  }, "Invalid URL"),
  v.transform((value) => value.trim().replace(/[\t\n\r]/gu, "")),
);

export type RemoteNode = RemoteElementNode | RemoteFragmentNode | RemoteTextNode;

export interface RemoteTextNode {
  id: string;
  kind: "text";
  text: string;
}

export interface RemoteFragmentNode {
  children: RemoteNode[];
  id: string;
  kind: "fragment";
}

export interface RemoteElementNode {
  callbacks?: RemoteCallbackBinding[];
  children: RemoteNode[];
  id: string;
  kind: "element";
  props: RemoteProps;
  type: string;
}

export type RemoteProps = Record<string, unknown>;

export interface RemoteCallbackBinding {
  callback: string;
  inputCount: number;
  event: string;
}

export type RemotePatch =
  | {
      beforeId?: string;
      node: RemoteNode;
      op: "insert";
      parentId: string;
    }
  | {
      nodeId: string;
      op: "remove";
    }
  | {
      name: string;
      nodeId: string;
      op: "setProp";
      value: unknown;
    }
  | {
      name: string;
      nodeId: string;
      op: "removeProp";
    }
  | {
      nodeId: string;
      op: "setText";
      text: string;
    }
  | {
      callbacks: RemoteCallbackBinding[];
      nodeId: string;
      op: "setCallbacks";
    };

export const HostToIframePayload = v.pipe(
  ObjectInput,
  v.variant("type", [
    v.strictObject({
      type: v.literal("backendSessionResult"),
      data: strictObject({
        id: SessionId,
        session: v.optional(
          strictObject({
            token: v.pipe(v.string(), v.maxLength(8192)),
            expiresAt: FiniteNumber,
            url: SessionUrl,
          }),
        ),
        error: v.optional(
          strictObject({
            code: v.picklist([
              "BAD_REQUEST",
              "UNAUTHORIZED",
              "FORBIDDEN",
              "NOT_FOUND",
              "CONFLICT",
              "INCOMPATIBLE_VERSION",
              "UNAVAILABLE",
              "INTERNAL_SERVER_ERROR",
            ]),
            message: v.string(),
          }),
        ),
      }),
    }),
    v.strictObject({
      data: strictObject({
        appSource: v.string(),
        appUrl: v.string(),
        props: v.optional(Props),
      }),
      type: v.literal("init"),
    }),
    v.strictObject({
      data: strictObject({
        args: v.optional(v.array(v.unknown())),
        event: v.string(),
        nodeId: v.string(),
      }),
      type: v.literal("dispatchCallback"),
    }),
    v.strictObject({
      data: strictObject({ timestamp: FiniteNumber }),
      type: v.literal("animationFrame"),
    }),
  ]),
);
export type HostToIframePayload = v.InferOutput<typeof HostToIframePayload>;

const RemoteCallbackBindingSchema = strictObject({
  callback: v.string(),
  inputCount: FiniteNumber,
  event: v.string(),
});

type RemoteNodeSchemaType = v.GenericSchema<unknown, RemoteNode>;
const RemoteNodeSchema: RemoteNodeSchemaType = v.lazy(() =>
  v.pipe(
    ObjectInput,
    v.variant("kind", [
      v.strictObject({
        id: v.string(),
        kind: v.literal("text"),
        text: v.string(),
      }),
      v.strictObject({
        children: v.array(RemoteNodeSchema),
        id: v.string(),
        kind: v.literal("fragment"),
      }),
      v.strictObject({
        callbacks: v.optional(v.array(RemoteCallbackBindingSchema)),
        children: v.array(RemoteNodeSchema),
        id: v.string(),
        kind: v.literal("element"),
        props: Props,
        type: v.string(),
      }),
    ]),
  ),
);

const RemotePatchSchema: v.GenericSchema<unknown, RemotePatch> = v.pipe(
  ObjectInput,
  v.variant("op", [
    v.strictObject({
      beforeId: v.optional(v.string()),
      node: RemoteNodeSchema,
      op: v.literal("insert"),
      parentId: v.string(),
    }),
    v.strictObject({
      nodeId: v.string(),
      op: v.literal("remove"),
    }),
    v.strictObject({
      name: v.string(),
      nodeId: v.string(),
      op: v.literal("setProp"),
      value: v.unknown(),
    }),
    v.strictObject({
      name: v.string(),
      nodeId: v.string(),
      op: v.literal("removeProp"),
    }),
    v.strictObject({
      nodeId: v.string(),
      op: v.literal("setText"),
      text: v.string(),
    }),
    v.strictObject({
      callbacks: v.array(RemoteCallbackBindingSchema),
      nodeId: v.string(),
      op: v.literal("setCallbacks"),
    }),
  ]),
);

export const IframeToHostPayload = v.pipe(
  ObjectInput,
  v.variant("type", [
    v.strictObject({
      type: v.literal("backendSessionRequest"),
      data: strictObject({ id: SessionId, refresh: v.boolean() }),
    }),
    v.strictObject({ type: v.literal("ready") }),
    v.strictObject({
      data: strictObject({
        revision: FiniteNumber,
        tree: RemoteNodeSchema,
      }),
      type: v.literal("snapshot"),
    }),
    v.strictObject({
      data: strictObject({
        patches: v.array(RemotePatchSchema),
        revision: FiniteNumber,
      }),
      type: v.literal("patches"),
    }),
    v.strictObject({
      data: strictObject({
        message: v.string(),
      }),
      type: v.literal("error"),
    }),
    v.strictObject({ data: strictObject({}), type: v.literal("requestAnimationFrame") }),
  ]),
);
export type IframeToHostPayload = v.InferOutput<typeof IframeToHostPayload>;
