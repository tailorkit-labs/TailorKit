import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { withAppAssetUrl } from "./asset-url";

const env = vi.hoisted(() => ({
  ASSET_BASE_URL: undefined as string | undefined,
  ASSET_DOMAIN: "tailorkit.app",
  NODE_ENV: "production" as "development" | "production",
  PORT: undefined as number | undefined,
}));
vi.mock("../../api-utils/src/env.ts", () => ({ env }));

const projectId = "22222222-2222-4222-8222-222222222222";
const appId = "33333333-3333-4333-8333-333333333333";
const deploymentId = "44444444-4444-4444-8444-444444444444";
const appPublicId = "app000000001";
const deploymentPublicId = "deploy000001";

describe("hosted asset URLs", () => {
  afterEach(() => {
    env.ASSET_BASE_URL = undefined;
    env.NODE_ENV = "production";
  });

  it("uses stable team, project, app and deployment identifiers", () => {
    const app = {
      id: appId,
      publicId: appPublicId,
      currentDeployment: {
        id: deploymentId,
        appId,
        publicId: deploymentPublicId,
        status: "published" as const,
        clientEntryFileId: "55555555-5555-4555-8555-555555555555",
        logoDarkPath: "logo-dark.svg",
        logoLightPath: "logo-light.webp",
        errorMessage: null,
        publishedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
    expect(withAppAssetUrl(app, "abc123def45678", projectId).clientPath).toBe(
      `https://abc123def45678.tailorkit.app/p/${projectId}/a/${appPublicId}/d/${deploymentPublicId}/client.js`,
    );
    expect(withAppAssetUrl(app, "abc123def45678", projectId).logoPaths).toEqual({
      dark: `https://abc123def45678.tailorkit.app/p/${projectId}/a/${appPublicId}/d/${deploymentPublicId}/logo-dark.svg`,
      light: `https://abc123def45678.tailorkit.app/p/${projectId}/a/${appPublicId}/d/${deploymentPublicId}/logo-light.webp`,
    });
  });

  it("uses app-scoped URLs for content-addressed logos", () => {
    const logoHash = "b".repeat(64);
    const app = {
      publicId: appPublicId,
      currentDeployment: {
        publicId: deploymentPublicId,
        status: "published" as const,
        clientEntryFileId: "55555555-5555-4555-8555-555555555555",
        logoDarkPath: `logos/${logoHash}.svg`,
        logoLightPath: null,
      },
    };

    expect(withAppAssetUrl(app, "abc123def45678", projectId).logoPaths).toEqual({
      dark: `https://abc123def45678.tailorkit.app/p/${projectId}/a/${appPublicId}/logos/${logoHash}.svg`,
    });
  });

  it("uses the same-origin Node route in local development", () => {
    env.NODE_ENV = "development";
    const app = {
      publicId: appPublicId,
      currentDeployment: {
        id: deploymentId,
        appId,
        publicId: deploymentPublicId,
        status: "published" as const,
        clientEntryFileId: "55555555-5555-4555-8555-555555555555",
        errorMessage: null,
        publishedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
    expect(withAppAssetUrl(app, "abc123def45678", projectId).clientPath).toBe(
      `http://localhost:3000/api/assets/t/abc123def45678/p/${projectId}/a/${appPublicId}/d/${deploymentPublicId}/client.js`,
    );
  });

  it("supports the Node asset route in self-hosted production", () => {
    env.ASSET_BASE_URL = "https://tailorkit.example.com/api/assets/";
    const app = {
      publicId: appPublicId,
      currentDeployment: {
        id: deploymentId,
        appId,
        publicId: deploymentPublicId,
        status: "published" as const,
        clientEntryFileId: "55555555-5555-4555-8555-555555555555",
        errorMessage: null,
        publishedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
    expect(withAppAssetUrl(app, "abc123def45678", projectId).clientPath).toBe(
      `https://tailorkit.example.com/api/assets/t/abc123def45678/p/${projectId}/a/${appPublicId}/d/${deploymentPublicId}/client.js`,
    );
  });

  it("does not expose incomplete deployments", () => {
    const deployment = {
      id: deploymentId,
      appId,
      publicId: deploymentPublicId,
      status: "uploading" as const,
      clientEntryFileId: null,
      errorMessage: null,
      publishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(
      withAppAssetUrl(
        { currentDeployment: deployment, publicId: appPublicId },
        "abc123def45678",
        projectId,
      ).clientPath,
    ).toBeUndefined();
  });
});
