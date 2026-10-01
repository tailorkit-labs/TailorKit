import z from "zod";

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

const storageRequest = z.strictObject({
  id: z.string().min(1).max(128),
  op: z.enum(["query", "mutate", "subscribe", "cancel"]),
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/u),
  input: z.unknown(),
  apiVersion: z.number().int().positive(),
  requestId: z.uuid().optional(),
});
export type StorageBridgeRequest = z.output<typeof storageRequest>;
const storageResult = z.strictObject({
  id: z.string().min(1).max(128),
  value: z.unknown().optional(),
  error: z.strictObject({ code: z.string(), message: z.string() }).optional(),
  status: z.enum(["connecting", "ready", "reconnecting"]).optional(),
});
export type StorageBridgeResult = z.output<typeof storageResult>;

export const HostToIframePayload = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("backendSessionResult"),
    data: z.strictObject({
      id: z.string().min(1).max(128),
      session: z
        .strictObject({ token: z.string().max(8192), expiresAt: z.number(), url: z.url() })
        .optional(),
      error: z.string().optional(),
    }),
  }),
  z.strictObject({ type: z.literal("storageResult"), data: storageResult }),
  z.strictObject({
    data: z.strictObject({
      appSource: z.string(),
      appUrl: z.string(),
      props: z.record(z.string(), z.unknown()).optional(),
    }),
    type: z.literal("init"),
  }),
  z.strictObject({
    data: z.strictObject({
      args: z.array(z.unknown()).optional(),
      event: z.string(),
      nodeId: z.string(),
    }),
    type: z.literal("dispatchCallback"),
  }),
  z.strictObject({
    data: z.strictObject({ timestamp: z.number() }),
    type: z.literal("animationFrame"),
  }),
]);
export type HostToIframePayload = z.output<typeof HostToIframePayload>;

const RemoteCallbackBindingSchema = z.strictObject({
  callback: z.string(),
  inputCount: z.number(),
  event: z.string(),
});

type RemoteNodeSchemaType = z.ZodType<RemoteNode>;
const RemoteNodeSchema: RemoteNodeSchemaType = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({
      id: z.string(),
      kind: z.literal("text"),
      text: z.string(),
    }),
    z.strictObject({
      children: z.array(RemoteNodeSchema),
      id: z.string(),
      kind: z.literal("fragment"),
    }),
    z.strictObject({
      callbacks: z.array(RemoteCallbackBindingSchema).optional(),
      children: z.array(RemoteNodeSchema),
      id: z.string(),
      kind: z.literal("element"),
      props: z.record(z.string(), z.unknown()),
      type: z.string(),
    }),
  ]),
);

const RemotePatchSchema: z.ZodType<RemotePatch> = z.discriminatedUnion("op", [
  z.strictObject({
    beforeId: z.string().optional(),
    node: RemoteNodeSchema,
    op: z.literal("insert"),
    parentId: z.string(),
  }),
  z.strictObject({
    nodeId: z.string(),
    op: z.literal("remove"),
  }),
  z.strictObject({
    name: z.string(),
    nodeId: z.string(),
    op: z.literal("setProp"),
    value: z.unknown(),
  }),
  z.strictObject({
    name: z.string(),
    nodeId: z.string(),
    op: z.literal("removeProp"),
  }),
  z.strictObject({
    nodeId: z.string(),
    op: z.literal("setText"),
    text: z.string(),
  }),
  z.strictObject({
    callbacks: z.array(RemoteCallbackBindingSchema),
    nodeId: z.string(),
    op: z.literal("setCallbacks"),
  }),
]);

export const IframeToHostPayload = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("backendSessionRequest"),
    data: z.strictObject({ id: z.string().min(1).max(128), refresh: z.boolean() }),
  }),
  z.strictObject({ type: z.literal("storageRequest"), data: storageRequest }),
  z.strictObject({ type: z.literal("ready") }),
  z.strictObject({
    data: z.strictObject({
      revision: z.number(),
      tree: RemoteNodeSchema,
    }),
    type: z.literal("snapshot"),
  }),
  z.strictObject({
    data: z.strictObject({
      patches: z.array(RemotePatchSchema),
      revision: z.number(),
    }),
    type: z.literal("patches"),
  }),
  z.strictObject({
    data: z.strictObject({
      message: z.string(),
    }),
    type: z.literal("error"),
  }),
  z.strictObject({ data: z.strictObject({}), type: z.literal("requestAnimationFrame") }),
]);
export type IframeToHostPayload = z.output<typeof IframeToHostPayload>;
