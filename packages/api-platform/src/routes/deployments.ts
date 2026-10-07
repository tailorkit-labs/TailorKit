import { getRuntimeBundle, publishRuntimeMetadata } from "./runtime";
import { openapi } from "@orpc/openapi";
import { ORPCError } from "@orpc/server";
import { maxDeploymentBytes } from "@tailorkit/asset-delivery";
import {
  logoContentTypes,
  maxLogoBytes,
  validateLogoAsset,
} from "@tailorkit/asset-delivery/logo-validation";
import type { LogoContentType } from "@tailorkit/asset-delivery/logo-validation";
import { db } from "@tailorkit/db";
import {
  app,
  AppDeployment,
  appDeployment,
  AppDeploymentFile,
  appDeploymentFile,
} from "@tailorkit/db/schema/apps";
import type { Scope } from "@tailorkit/db/schema/scope";
import { and, eq } from "drizzle-orm";
import z from "zod";
import { paginatedOutput, paginationQuery } from "../pagination";
import { o, protectedRouter, requireApp, requireAppInScopes } from "../procedures";
import { setSpanAttributes } from "@tailorkit/observability";
import { createPublicId } from "../public-id";
import type { Context } from "../context";
import {
  canonicalizeScope,
  canonicalizeScopes,
  scopeMatches,
  scopeSchema,
  scopesSchema,
} from "../scope";

const uploadUrlExpiresInSeconds = 15 * 60;
const logoInspectionTimeoutMs = 10_000;
const logoExtensionByContentType = {
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
} as const;
const logoContentType = z.enum(logoContentTypes);

const deploymentFileMetadataShape = {
  checksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/iu)
    .transform((checksum) => checksum.toLowerCase()),
};

const createDeploymentAssetInput = z.object({
  ...deploymentFileMetadataShape,
  contentLength: z.number().int().min(1),
  contentType: z.literal("application/javascript"),
  encoding: z.enum(["utf-8", "gzip"]),
  objectKey: z.literal("client.js"),
});

const createDeploymentServerInput = createDeploymentAssetInput.extend({
  objectKey: z.literal("server.js"),
  contentLength: z.number().int().min(1).max(maxDeploymentBytes),
});

const createDeploymentLogoInput = z.object({
  ...deploymentFileMetadataShape,
  contentLength: z.number().int().min(1).max(maxLogoBytes),
  contentType: logoContentType,
});

const createDeploymentInput = z
  .object({
    appId: z.string(),
    assets: z.tuple([createDeploymentAssetInput]),
    server: createDeploymentServerInput.optional(),
    logos: z
      .object({
        dark: createDeploymentLogoInput.optional(),
        light: createDeploymentLogoInput.optional(),
      })
      .optional(),
    views: AppDeployment.shape.views.optional(),
    scope: scopeSchema,
  })
  .refine(
    ({ assets }) =>
      assets.reduce((total, asset) => total + asset.contentLength, 0) <= maxDeploymentBytes,
    { message: `Combined client assets cannot exceed ${maxDeploymentBytes} bytes.` },
  );

const deploymentAssetUpload = z.object({
  file: AppDeploymentFile,
  headers: z.record(z.string(), z.string()).optional(),
  uploadUrl: z.url(),
});

const deploymentLogoUpload = deploymentAssetUpload.extend({
  file: AppDeploymentFile.extend({ contentType: logoContentType }),
  uploadUrl: z.url().optional(),
});

const deploymentLogoUploads = z.object({
  dark: deploymentLogoUpload.optional(),
  light: deploymentLogoUpload.optional(),
});

function isNotFound(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    value.name === "NoSuchKey" ||
    value.name === "NotFound" ||
    value.$metadata?.httpStatusCode === 404
  );
}

async function hasMatchingLogo(
  storage: Context["storage"],
  logo: z.output<typeof createDeploymentLogoInput>,
  objectKey: string,
) {
  try {
    const object = await storage.head({ key: objectKey });
    return (
      object.contentLength === logo.contentLength &&
      object.contentType === logo.contentType &&
      object.checksumSha256 === hexToBase64(logo.checksum)
    );
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

export function mapReturnedFilesByAssetPath<
  TAsset extends { asset: { objectKey: string }; fileId: string },
  TFile extends { id: string },
>(assets: readonly TAsset[], files: readonly TFile[]) {
  const fileById = new Map(files.map((file) => [file.id, file]));

  return new Map(
    assets.map(({ asset, fileId }) => {
      const file = fileById.get(fileId);
      if (!file) {
        throw new ORPCError("BAD_REQUEST", { message: "Failed to resolve deployment asset." });
      }
      return [asset.objectKey, file] as const;
    }),
  );
}

const requireDeployment = o.middleware(
  async ({ next, context }, input: { deploymentId: string; scope?: Scope; scopes?: Scope[] }) => {
    setSpanAttributes({
      "tailorkit.middleware": "require_deployment",
      "tailorkit.package": "api-platform",
      "tailorkit.resource_type": "deployment",
    });

    const deploymentWithApp = await db.query.appDeployment.findFirst({
      where: {
        id: input.deploymentId,
      },
      with: {
        app: true,
      },
    });
    const deploymentApp = deploymentWithApp?.app;

    let requestedScopes: Scope[];
    try {
      requestedScopes = input.scope
        ? [canonicalizeScope(input.scope).scope]
        : canonicalizeScopes(input.scopes).map(({ scope }) => scope);
    } catch {
      throw new ORPCError("BAD_REQUEST", { message: "Invalid deployment scope." });
    }

    let storedScope: ReturnType<typeof canonicalizeScope> | null = null;
    if (deploymentApp) {
      try {
        const canonicalScope = canonicalizeScope(deploymentApp.scope);
        if (canonicalScope.scopeKey !== deploymentApp.scopeKey) {
          throw new TypeError("Deployment app scope key does not match its stored scope.");
        }
        storedScope = canonicalScope;
      } catch (error) {
        console.warn("Deployment app has an invalid stored scope.", {
          appId: deploymentApp.id,
          deploymentId: input.deploymentId,
          error,
        });
      }
    }
    const scopeMatchesApp =
      storedScope !== null &&
      requestedScopes.some((scope) => scopeMatches(storedScope.scope, scope));

    if (
      !deploymentWithApp ||
      !deploymentApp ||
      deploymentApp.projectId !== context.project.id ||
      !scopeMatchesApp
    ) {
      throw new ORPCError("NOT_FOUND", { message: "Deployment not found." });
    }

    const { app: _app, ...deployment } = deploymentWithApp;
    void _app;

    return next({ context: { ...context, app: deploymentApp, deployment } });
  },
);

function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return Buffer.from(bytes).toString("base64");
}

const listAppDeployments = protectedRouter
  .meta(
    openapi({
      path: "/deployments/list",
      method: "POST",
    }),
  )
  .input(
    z.object({
      body: paginationQuery.extend({ appId: z.string(), scopes: scopesSchema }),
    }),
  )
  .output(paginatedOutput(AppDeployment))
  .use(requireAppInScopes.adaptInput(({ body: { appId, scopes } }) => ({ appId, scopes })))
  .handler(async ({ context, input }) => {
    const { page, pageSize } = input.body;
    const deployments = await db.query.appDeployment.findMany({
      where: {
        appId: context.app.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      limit: pageSize + 1,
      offset: (page - 1) * pageSize,
    });

    return {
      body: {
        items: deployments.slice(0, pageSize),
        pagination: {
          hasMore: deployments.length > pageSize,
          page,
          pageSize,
        },
      },
    };
  });

const getAppDeployment = protectedRouter
  .meta(
    openapi({
      path: "/deployments/{deploymentId}/lookup",
      method: "POST",
    }),
  )
  .input(
    z.object({
      params: z.object({ deploymentId: z.string() }),
      body: z.object({ scopes: scopesSchema }),
    }),
  )
  .output(z.object({ body: AppDeployment }))
  .use(
    requireDeployment.adaptInput(({ params: { deploymentId }, body: { scopes } }) => ({
      deploymentId,
      scopes,
    })),
  )
  .handler(({ context }) => ({ body: context.deployment }));

const createAppDeployment = protectedRouter
  .meta(
    openapi({
      path: "/deployments",
      method: "POST",
    }),
  )
  .input(
    z.object({
      body: createDeploymentInput,
    }),
  )
  .output(
    z.object({
      body: z.object({
        assets: z.array(deploymentAssetUpload),
        server: deploymentAssetUpload.optional(),
        deployment: AppDeployment,
        logos: deploymentLogoUploads.optional(),
      }),
    }),
  )
  .use(requireApp.adaptInput(({ body: { appId, scope } }) => ({ appId, scope })))
  .handler(async ({ context, input }) => {
    const deploymentId = crypto.randomUUID();
    const deploymentPublicId = createPublicId();
    const requestedLogos = Object.entries(input.body.logos ?? {}).map(([variant, logo]) => ({
      asset: {
        ...logo,
        encoding: null,
        objectKey: `logos/${logo.checksum}.${logoExtensionByContentType[logo.contentType]}`,
      },
      variant,
    }));
    const uniqueLogoAssets = [
      ...new Map(requestedLogos.map(({ asset }) => [asset.objectKey, asset])).values(),
    ];
    const requestedAssets = [
      ...input.body.assets.map((asset) => ({ asset, kind: "client" as const })),
      ...(input.body.server ? [{ asset: input.body.server, kind: "server" as const }] : []),
      ...uniqueLogoAssets.map((asset) => ({ asset, kind: "logo" as const })),
    ];
    const assets = await Promise.all(
      requestedAssets.map(async ({ asset, kind }) => {
        const fileId = crypto.randomUUID();
        const appBaseKey = `teams/${context.organization.publicId}/projects/${context.project.id}/apps/${context.app.publicId}`;
        const objectKey =
          kind === "logo"
            ? `${appBaseKey}/${asset.objectKey}`
            : `${appBaseKey}/deployments/${deploymentPublicId}/${kind}/${asset.objectKey}`;
        const shouldReuse =
          kind === "logo" && (await hasMatchingLogo(context.storage, asset, objectKey));
        const uploadUrl = shouldReuse
          ? undefined
          : await context.storage.createUploadUrl({
              checksumSha256: hexToBase64(asset.checksum),
              contentType: asset.contentType,
              contentEncoding: asset.encoding === "gzip" ? "gzip" : undefined,
              expiresInSeconds: uploadUrlExpiresInSeconds,
              key: objectKey,
              metadata:
                kind === "logo"
                  ? { appId: context.app.id, checksum: asset.checksum }
                  : { appDeploymentId: deploymentId, appId: context.app.id, fileId },
            });
        return { asset, fileId, objectKey, uploadUrl };
      }),
    );

    const created = await db.transaction(async (tx) => {
      const [deployment] = await tx
        .insert(appDeployment)
        .values({
          id: deploymentId,
          appId: context.app.id,
          publicId: deploymentPublicId,
          status: "uploading",
          views: input.body.views ?? [],
        })
        .returning();

      if (!deployment) {
        throw new ORPCError("BAD_REQUEST", { message: "Failed to create deployment." });
      }

      const files = await tx
        .insert(appDeploymentFile)
        .values(
          assets.map(({ asset, fileId, objectKey }) => ({
            id: fileId,
            appDeploymentId: deployment.id,
            checksum: asset.checksum,
            contentLength: asset.contentLength,
            contentType: asset.contentType,
            encoding: asset.encoding,
            objectKey,
          })),
        )
        .returning();

      if (files.length !== assets.length) {
        throw new ORPCError("BAD_REQUEST", { message: "Failed to create deployment asset." });
      }

      const fileByAssetPath = mapReturnedFilesByAssetPath(assets, files);
      const logoDarkPath = requestedLogos.find(({ variant }) => variant === "dark")?.asset
        .objectKey;
      const logoLightPath = requestedLogos.find(({ variant }) => variant === "light")?.asset
        .objectKey;

      const [updatedDeployment] = await tx
        .update(appDeployment)
        .set({
          clientEntryFileId: fileByAssetPath.get("client.js")?.id,
          logoDarkFileId: logoDarkPath ? fileByAssetPath.get(logoDarkPath)?.id : undefined,
          logoLightFileId: logoLightPath ? fileByAssetPath.get(logoLightPath)?.id : undefined,
          logoDarkPath,
          logoLightPath,
        })
        .where(eq(appDeployment.id, deployment.id))
        .returning();

      if (!updatedDeployment) {
        throw new ORPCError("BAD_REQUEST", { message: "Failed to update deployment asset." });
      }

      return { createdDeployment: updatedDeployment, createdFiles: files };
    });
    const { createdDeployment, createdFiles } = created;
    const createdFileById = new Map(createdFiles.map((file) => [file.id, file]));
    const uploadedAssetByName = new Map(
      assets.map(({ asset, fileId, uploadUrl }) => {
        const file = createdFileById.get(fileId);
        if (!file) {
          throw new ORPCError("BAD_REQUEST", { message: "Failed to resolve deployment asset." });
        }
        return [
          asset.objectKey,
          {
            file,
            headers: uploadUrl?.headers,
            uploadUrl: uploadUrl?.uploadUrl,
          },
        ] as const;
      }),
    );
    const uploadedAssets = input.body.assets.map((asset) => {
      const upload = uploadedAssetByName.get(asset.objectKey);
      if (!upload?.uploadUrl) {
        throw new ORPCError("BAD_REQUEST", { message: "Failed to resolve deployment asset." });
      }
      return { ...upload, uploadUrl: upload.uploadUrl };
    });
    const serverUpload = input.body.server ? uploadedAssetByName.get("server.js") : undefined;
    if (input.body.server && !serverUpload?.uploadUrl) {
      throw new ORPCError("BAD_REQUEST", { message: "Failed to create server upload URL." });
    }
    const uploadedLogos = Object.fromEntries(
      requestedLogos.map(({ asset, variant }) => {
        const upload = uploadedAssetByName.get(asset.objectKey);
        if (!upload) {
          throw new ORPCError("BAD_REQUEST", { message: "Failed to resolve deployment asset." });
        }
        return [variant, upload];
      }),
    );

    return {
      body: {
        assets: uploadedAssets,
        ...(serverUpload?.uploadUrl
          ? { server: { ...serverUpload, uploadUrl: serverUpload.uploadUrl } }
          : {}),
        deployment: createdDeployment,
        ...(Object.keys(uploadedLogos).length > 0 ? { logos: uploadedLogos } : {}),
      },
    };
  });

const publishAppDeployment = protectedRouter
  .meta(
    openapi({
      path: "/deployments/{deploymentId}",
      method: "POST",
    }),
  )
  .input(
    z.object({
      body: z.object({
        scope: scopeSchema,
        rollout: z.boolean().optional().default(true),
      }),
      params: z.object({ deploymentId: z.string() }),
    }),
  )
  .output(z.object({ body: AppDeployment }))
  .use(
    requireDeployment.adaptInput(({ body: { scope }, params: { deploymentId } }) => ({
      deploymentId,
      scope,
    })),
  )
  .handler(async ({ context, input }) => {
    const { deployment } = context;
    const files = await db.query.appDeploymentFile.findMany({
      where: {
        appDeploymentId: deployment.id,
      },
    });

    if (files.length === 0) {
      throw new ORPCError("BAD_REQUEST", { message: "Deployment has no files to publish." });
    }

    await db
      .update(appDeployment)
      .set({ status: "verifying" })
      .where(eq(appDeployment.id, deployment.id));

    for (const file of files) {
      await db
        .update(appDeploymentFile)
        .set({ status: "verifying" })
        .where(eq(appDeploymentFile.id, file.id));

      try {
        const object = await context.storage.head({ key: file.objectKey });
        const contentLength = object.contentLength;

        if (contentLength !== file.contentLength) {
          throw new Error("Uploaded file content length does not match deployment record.");
        }

        if (object.contentType !== file.contentType) {
          throw new Error("Uploaded file content type does not match deployment record.");
        }

        if (
          (object.contentEncoding ?? undefined) !== (file.encoding === "gzip" ? "gzip" : undefined)
        ) {
          throw new Error("Uploaded file content encoding does not match deployment record.");
        }

        if (!file.checksum || object.checksumSha256 !== hexToBase64(file.checksum)) {
          throw new Error("Uploaded file checksum does not match deployment record.");
        }

        if (file.contentType !== "application/javascript") {
          const download = await context.storage.createDownloadUrl({
            key: file.objectKey,
            expiresInSeconds: 60,
          });
          const downloadUrl = new URL(download.url);
          if (downloadUrl.protocol !== "https:") {
            throw new Error("Logo download URL must use HTTPS.");
          }
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), logoInspectionTimeoutMs);
          try {
            const response = await fetch(downloadUrl, {
              redirect: "error",
              signal: controller.signal,
            });
            if (!response.ok) {
              throw new Error("Failed to inspect uploaded logo.");
            }
            validateLogoAsset(
              new Uint8Array(await response.arrayBuffer()),
              file.contentType as LogoContentType,
            );
          } finally {
            clearTimeout(timeout);
          }
        }

        await db
          .update(appDeploymentFile)
          .set({ status: "verified" })
          .where(eq(appDeploymentFile.id, file.id));
      } catch (error) {
        await db
          .update(appDeploymentFile)
          .set({ status: "failed" })
          .where(eq(appDeploymentFile.id, file.id));
        await db
          .update(appDeployment)
          .set({ status: "uploading" })
          .where(eq(appDeployment.id, deployment.id));

        throw new ORPCError("BAD_REQUEST", {
          message: error instanceof Error ? error.message : "Failed to verify deployment file.",
        });
      }
    }

    const [publishedDeployment] = await db
      .update(appDeployment)
      .set({ status: "published" })
      .where(eq(appDeployment.id, deployment.id))
      .returning();

    if (!publishedDeployment) {
      throw new ORPCError("BAD_REQUEST", { message: "Failed to publish deployment." });
    }

    if (input.body.rollout) {
      await db
        .update(app)
        .set({ currentDeploymentId: publishedDeployment.id })
        .where(and(eq(app.id, context.app.id), eq(app.projectId, context.project.id)));
      const server = files.find((file) => file.objectKey.endsWith("/server/server.js"));
      if (server?.checksum) {
        await publishRuntimeMetadata(
          {
            projectId: context.project.id,
            appId: context.app.id,
            deploymentId: publishedDeployment.id,
            objectKey: server.objectKey,
            checksum: server.checksum,
            contentLength: server.contentLength,
            contentEncoding: server.encoding === "gzip" ? "gzip" : undefined,
          },
          context.app.publicId,
        );
      }
    }

    return { body: publishedDeployment };
  });

export const deploymentRouter = o.router({
  list: listAppDeployments,
  get: getAppDeployment,
  create: createAppDeployment,
  publish: publishAppDeployment,
  runtime: getRuntimeBundle,
});
