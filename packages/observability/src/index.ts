import { context, propagation, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import type { Attributes, Span, SpanOptions } from "@opentelemetry/api";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { ParentBasedSampler, TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-base";
import { ORPCInstrumentation } from "@orpc/otel";
import { env } from "#env";

interface TelemetryState {
  initializing?: Promise<void>;
  serviceName?: string;
  started: boolean;
}

interface VercelOtelModule {
  registerOTel: (config: {
    attributes?: Attributes;
    instrumentations?: unknown[];
    serviceName: string;
    traceSampler?: unknown;
  }) => void;
}

const stateKey = Symbol.for("tailorkit.observability.state");
const sensitiveAttributePattern =
  /(authorization|cookie|password|secret|token|key|body|headers|email|url)$/iu;

const globalState = globalThis as typeof globalThis & {
  [stateKey]?: TelemetryState;
};

const state = (globalState[stateKey] ??= { started: false });

function isTracingDisabled() {
  return env.TAILORKIT_OTEL_DISABLED || env.NODE_ENV === "test";
}

function resolveServiceName(serviceName?: string) {
  return serviceName ?? env.OTEL_SERVICE_NAME ?? "tailorkit-web";
}

function resolveDeploymentEnvironment() {
  return env.VERCEL_ENV ?? env.NODE_ENV;
}

function resolveServiceVersion() {
  return env.VERCEL_GIT_COMMIT_SHA;
}

function createResourceAttributes(serviceName: string): Attributes {
  return safeAttributes({
    "service.name": serviceName,
    "service.version": resolveServiceVersion(),
    "deployment.environment.name": resolveDeploymentEnvironment(),
    "cloud.region": env.VERCEL_REGION,
    "tailorkit.package": "observability",
  });
}

function resolveSampleRate() {
  const configuredRate = env.TAILORKIT_OTEL_SAMPLE_RATE ?? env.OTEL_TRACES_SAMPLER_ARG;

  if (!configuredRate) {
    return 1;
  }

  const rate = Number(configuredRate);
  if (!Number.isFinite(rate)) {
    return 1;
  }

  return Math.min(Math.max(rate, 0), 1);
}

function createSampler() {
  return new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(resolveSampleRate()),
  });
}

function createInstrumentations() {
  return [
    "auto",
    new ORPCInstrumentation(),
    new PgInstrumentation({
      enhancedDatabaseReporting: false,
      requireParentSpan: false,
      requestHook: (span, queryInfo) => {
        const operation = queryInfo.query.text.trim().split(/\s+/u)[0]?.toLowerCase() ?? "query";
        span.setAttributes(
          safeAttributes({
            "operation.name": `db.${operation}`,
            "resource.name": `postgres ${operation}`,
            "tailorkit.package": "db",
          }),
        );
      },
      responseHook: (span, responseInfo) => {
        span.setAttributes(
          safeAttributes({
            "db.response.rows": responseInfo.data.rowCount,
          }),
        );
      },
    }),
    new HttpInstrumentation({
      requireParentforOutgoingSpans: true,
      requireParentforIncomingSpans: false,
    }),
    new UndiciInstrumentation(),
  ];
}

export async function initializeObservability(serviceName?: string) {
  if (state.started) {
    return;
  }

  if (state.initializing) {
    return state.initializing;
  }

  if (isTracingDisabled()) {
    return;
  }

  const resolvedServiceName = resolveServiceName(serviceName);
  state.serviceName = resolvedServiceName;

  state.initializing = (async () => {
    if (!env.VERCEL) {
      return;
    }

    const { registerOTel } = (await import("@vercel/otel")) as VercelOtelModule;
    registerOTel({
      attributes: createResourceAttributes(resolvedServiceName),
      serviceName: resolvedServiceName,
      traceSampler: createSampler(),
      instrumentations: createInstrumentations(),
    });
  })();

  try {
    await state.initializing;
    state.started = true;
  } catch (error) {
    state.serviceName = undefined;
    throw error;
  } finally {
    state.initializing = undefined;
  }
}

export function shutdownObservability() {
  state.initializing = undefined;
  state.started = false;
  state.serviceName = undefined;
}

export function getTracer(name = "tailorkit") {
  return trace.getTracer(name);
}

export function safeAttributeValue(value: unknown): string | number | boolean | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

export function safeAttributes(attributes: Record<string, unknown> = {}): Attributes {
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([key]) => !sensitiveAttributePattern.test(key))
      .map(([key, value]) => [key, safeAttributeValue(value)])
      .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined),
  );
}

export function setSpanAttributes(attributes: Record<string, unknown>) {
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttributes(safeAttributes(attributes));
  }
}

export function recordException(error: unknown, attributes?: Record<string, unknown>) {
  const span = trace.getActiveSpan();
  if (!span) {
    return;
  }

  if (attributes) {
    span.setAttributes(safeAttributes(attributes));
  }

  if (error instanceof Error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    return;
  }

  span.recordException(String(error));
  span.setStatus({ code: SpanStatusCode.ERROR });
}

export function withSpan<T>(
  name: string,
  optionsOrHandler: SpanOptions | ((span: Span) => Promise<T> | T),
  maybeHandler?: (span: Span) => Promise<T> | T,
): Promise<T> {
  const tracer = getTracer("tailorkit.runtime");
  const options = typeof optionsOrHandler === "function" ? undefined : optionsOrHandler;
  const handler = typeof optionsOrHandler === "function" ? optionsOrHandler : maybeHandler;

  if (!handler) {
    throw new Error("withSpan requires a handler.");
  }

  return tracer.startActiveSpan(name, options ?? {}, async (span) => {
    span.setAttributes(
      safeAttributes({
        "operation.name": name,
        "resource.name": name,
        ...options?.attributes,
      }),
    );

    try {
      const result = await handler(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}

function headersToCarrier(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

export function withRequestSpan<T>(
  request: Request,
  name: string,
  optionsOrHandler: SpanOptions | ((span: Span) => Promise<T> | T),
  maybeHandler?: (span: Span) => Promise<T> | T,
): Promise<T> {
  const carrier = headersToCarrier(request.headers);
  const parentContext = propagation.extract(context.active(), carrier);

  return context.with(parentContext, () => {
    const url = new URL(request.url);
    const options = typeof optionsOrHandler === "function" ? undefined : optionsOrHandler;
    const handler = typeof optionsOrHandler === "function" ? optionsOrHandler : maybeHandler;

    if (!handler) {
      throw new Error("withRequestSpan requires a handler.");
    }

    return withSpan(
      name,
      {
        kind: SpanKind.SERVER,
        ...options,
        attributes: safeAttributes({
          "http.request.method": request.method,
          "url.path": url.pathname,
          ...options?.attributes,
        }),
      },
      handler,
    );
  });
}

export function getTraceId() {
  const span = trace.getSpan(context.active());
  const spanContext = span?.spanContext();
  return spanContext?.traceId;
}

export function sanitizeErrorForLog(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      traceId: getTraceId(),
    };
  }

  return {
    name: "UnknownError",
    message: "Unknown error",
    traceId: getTraceId(),
  };
}
