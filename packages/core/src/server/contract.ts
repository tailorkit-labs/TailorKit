import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ContractAction, ContractActions, TailorKitContract } from "../schema/contract";
import type {
  ActionHandler,
  ActionTree,
  ImplementedAction,
  InferActionOutput,
} from "../schema/actions";
import { createTailorKitServer } from "./handler";
import type { ContextDefinitions, SlotDefinitions } from "../schema/views";
import type { MaybePromise } from "../schema/shared";
import type {
  TailorKitHandlerOptions,
  TailorKitServerBaseOptions,
  TailorKitServerInputOptions,
} from "./types";

export type ContractScopes<TContract extends TailorKitContract> = {
  [TName in keyof TContract["scopes"]]: StandardSchemaV1.InferInput<TContract["scopes"][TName]>;
};

export type ActionImplementations<TActions extends ContractActions, TContext = never> = {
  [TName in keyof TActions]: TActions[TName] extends ContractAction<infer TInput, infer TOutput>
    ? ActionHandler<TInput, TOutput, TContext, InferActionOutput<TActions[TName]>>
    : TActions[TName] extends ContractActions
      ? ActionImplementations<TActions[TName], TContext>
      : never;
};

type ImplementedActions<TActions extends ContractActions, TContext> = {
  [TName in keyof TActions]: TActions[TName] extends ContractAction<infer TInput, infer TOutput>
    ? ImplementedAction<TInput, TOutput, TContext, InferActionOutput<TActions[TName]>>
    : TActions[TName] extends ContractActions
      ? ImplementedActions<TActions[TName], TContext>
      : never;
};

type AuthenticationResult<TContract extends TailorKitContract> = MaybePromise<{
  scopes: Partial<ContractScopes<TContract>>;
  actionContext?: unknown;
} | null>;
type ActionContext<TResult> =
  NonNullable<Awaited<TResult>> extends { actionContext: infer TContext } ? TContext : never;

function implementActions(
  definitions: ContractActions,
  implementations: unknown,
  prefix = "",
): ActionTree {
  if (!implementations || typeof implementations !== "object") {
    if (Object.keys(definitions).length)
      throw new Error(`Missing action implementations${prefix ? ` for "${prefix}"` : ""}.`);
    return {};
  }
  const handlers = implementations as Record<string, unknown>;
  for (const name of Object.keys(handlers)) {
    if (!Object.hasOwn(definitions, name))
      throw new Error(`Action "${prefix}${name}" is not declared in the contract.`);
  }
  const result: ActionTree = {};
  for (const [name, definition] of Object.entries(definitions)) {
    const handler = handlers[name];
    if (definition.$tailorkitActionDefinition === true) {
      if (typeof handler !== "function")
        throw new Error(`Missing implementation for action "${prefix}${name}".`);
      result[name] = {
        $tailorkitAction: true,
        definition: (definition as ContractAction).definition,
        handler: handler as ImplementedAction["handler"],
      };
    } else {
      result[name] = implementActions(definition as ContractActions, handler, `${prefix}${name}.`);
    }
  }
  return result;
}

/** Implement a shared contract with private handlers and authentication. */
export function createServer<
  const TContract extends TailorKitContract,
  TResult extends AuthenticationResult<TContract> = AuthenticationResult<TContract>,
>(
  options: Omit<TailorKitServerBaseOptions<TContract["scopes"]>, "scopes"> & {
    contract: TContract;
    authenticate?: (options: { request: Request }) => TResult;
  } & (keyof TContract["actions"] extends never
      ? { actions?: ActionImplementations<TContract["actions"], ActionContext<TResult>> }
      : { actions: ActionImplementations<TContract["actions"], ActionContext<TResult>> }),
) {
  const { contract, authenticate, actions, ...configuration } = options;
  const implemented = implementActions(contract.actions, actions) as ImplementedActions<
    TContract["actions"],
    ActionContext<TResult>
  >;
  type InternalOptions = TailorKitServerInputOptions & {
    views: ContextDefinitions;
    slots: SlotDefinitions;
    actions: ActionTree;
  };
  // The shared contract checks these definitions; the internal server receives bound handlers.
  const server = createTailorKitServer<InternalOptions>({
    ...configuration,
    components: contract.components,
    views: contract.views,
    slots: contract.slots,
    scopes: contract.scopes,
    actions: implemented,
  } as unknown as Parameters<typeof createTailorKitServer<InternalOptions>>[0]);
  return {
    ...server,
    contract,
    handler(
      request: Request,
      handlerOptions?: TailorKitHandlerOptions<
        ActionContext<TResult>,
        Partial<ContractScopes<TContract>>
      >,
    ) {
      const authentication = handlerOptions?.authenticate ?? authenticate;
      if (!authentication)
        throw new Error("Supply authenticate to createServer or to its handler.");
      return server.handler(request, { authenticate: authentication } as Parameters<
        typeof server.handler
      >[1]);
    },
  };
}
