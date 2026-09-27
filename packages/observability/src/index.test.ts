import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  initializeObservability,
  safeAttributes,
  safeAttributeValue,
  shutdownObservability,
} from "./index";

const registerOTel = vi.fn();
const mockEnv = vi.hoisted(() => ({
  NODE_ENV: "development" as "development" | "production" | "test",
  OTEL_SERVICE_NAME: undefined as string | undefined,
  OTEL_TRACES_SAMPLER_ARG: undefined as string | undefined,
  TAILORKIT_OTEL_DISABLED: false,
  TAILORKIT_OTEL_SAMPLE_RATE: undefined as string | undefined,
  VERCEL: undefined as string | undefined,
  VERCEL_ENV: undefined as "production" | "preview" | "development" | undefined,
  VERCEL_GIT_COMMIT_SHA: undefined as string | undefined,
  VERCEL_REGION: undefined as string | undefined,
}));

vi.mock("@vercel/otel", () => ({
  registerOTel,
}));

vi.mock("#env", () => ({
  env: mockEnv,
}));

describe("observability helpers", () => {
  afterEach(async () => {
    Object.assign(mockEnv, {
      NODE_ENV: "development",
      OTEL_SERVICE_NAME: undefined,
      OTEL_TRACES_SAMPLER_ARG: undefined,
      TAILORKIT_OTEL_DISABLED: false,
      TAILORKIT_OTEL_SAMPLE_RATE: undefined,
      VERCEL: undefined,
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
      VERCEL_REGION: undefined,
    });
    registerOTel.mockReset();
    await shutdownObservability();
  });

  it("drops sensitive attributes", () => {
    expect(
      safeAttributes({
        "auth.token": "secret",
        "http.method": "GET",
        "request.headers": "cookie=value",
        "storage.key": "projects/id/file.js",
      }),
    ).toEqual({
      "http.method": "GET",
    });
  });

  it("normalizes safe primitive values", () => {
    expect(safeAttributeValue(new Date("2026-01-01T00:00:00.000Z"))).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(safeAttributeValue(42)).toBe(42);
  });

  it("can be disabled in tests without registering an SDK", async () => {
    mockEnv.TAILORKIT_OTEL_DISABLED = true;
    await expect(initializeObservability("test-service")).resolves.toBeUndefined();
  });

  it("deduplicates concurrent initialization", async () => {
    mockEnv.NODE_ENV = "production";
    mockEnv.VERCEL = "1";
    mockEnv.VERCEL_ENV = "preview";
    mockEnv.VERCEL_GIT_COMMIT_SHA = "abc123";
    mockEnv.TAILORKIT_OTEL_SAMPLE_RATE = "0.25";

    await Promise.all([
      initializeObservability("test-service"),
      initializeObservability("test-service"),
      initializeObservability("test-service"),
    ]);

    expect(registerOTel).toHaveBeenCalledTimes(1);
    expect(registerOTel).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({
          "deployment.environment.name": "preview",
          "service.name": "test-service",
          "service.version": "abc123",
        }),
        instrumentations: expect.arrayContaining(["auto"]),
        serviceName: "test-service",
      }),
    );
  });

  it("resets initialization state after registration failure", async () => {
    mockEnv.NODE_ENV = "production";
    mockEnv.VERCEL = "1";
    registerOTel.mockImplementationOnce(() => {
      throw new Error("registration failed");
    });

    await expect(initializeObservability("test-service")).rejects.toThrow("registration failed");
    await expect(initializeObservability("test-service")).resolves.toBeUndefined();

    expect(registerOTel).toHaveBeenCalledTimes(2);
  });
});
