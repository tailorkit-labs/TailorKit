import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { S3ClientConfig } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { withSpan } from "@tailorkit/observability";
import type {
  CreateDownloadUrlInput,
  CreateDownloadUrlOutput,
  CreateUploadUrlInput,
  CreateUploadUrlOutput,
  DeleteObjectInput,
  HeadObjectInput,
  HeadObjectOutput,
  Storage,
} from "./types.js";

export interface S3CompatibleStorageOptions {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

function createS3Client(options: S3CompatibleStorageOptions): S3Client {
  const config: S3ClientConfig = {
    region: options.region ?? "auto",
    endpoint: options.endpoint,
    forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
  };

  if (options.accessKeyId && options.secretAccessKey) {
    config.credentials = {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    };
  }

  return new S3Client(config);
}

export function createS3CompatibleStorage(options: S3CompatibleStorageOptions): Storage<"s3"> {
  const client = createS3Client(options);

  return {
    type: "s3",
    head: async (input: HeadObjectInput): Promise<HeadObjectOutput> => {
      const result = await withSpan(
        "storage.head",
        { attributes: { "tailorkit.package": "storage", "storage.type": "s3" } },
        () =>
          client.send(
            new HeadObjectCommand({
              Bucket: options.bucket,
              ChecksumMode: "ENABLED",
              Key: input.key,
            }),
          ),
      );

      return {
        key: input.key,
        contentType: result.ContentType,
        contentEncoding: result.ContentEncoding,
        contentLength: result.ContentLength,
        checksumSha256: result.ChecksumSHA256,
        etag: result.ETag,
        metadata: result.Metadata,
      };
    },
    delete: async (input: DeleteObjectInput): Promise<void> => {
      await withSpan(
        "storage.delete",
        { attributes: { "tailorkit.package": "storage", "storage.type": "s3" } },
        () =>
          client.send(
            new DeleteObjectCommand({
              Bucket: options.bucket,
              Key: input.key,
            }),
          ),
      );
    },
    createUploadUrl: async (input: CreateUploadUrlInput): Promise<CreateUploadUrlOutput> => {
      const command = new PutObjectCommand({
        Bucket: options.bucket,
        Key: input.key,
        ChecksumSHA256: input.checksumSha256,
        ContentType: input.contentType,
        ContentEncoding: input.contentEncoding,
        Metadata: input.metadata,
      });

      return {
        key: input.key,
        uploadUrl: await withSpan(
          "storage.create_upload_url",
          {
            attributes: {
              "tailorkit.package": "storage",
              "storage.type": "s3",
              "storage.expires_seconds": input.expiresInSeconds ?? 300,
            },
          },
          () =>
            getSignedUrl(client, command, {
              expiresIn: input.expiresInSeconds ?? 300,
              // The upload contract sends this checksum as a header. Keep it
              // signed there instead of also hoisting it into the query string.
              unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
              signableHeaders: new Set(["content-type", "content-encoding"]),
            }),
        ),
        headers: {
          ...(input.contentType ? { "content-type": input.contentType } : {}),
          ...(input.contentEncoding ? { "content-encoding": input.contentEncoding } : {}),
          ...(input.checksumSha256 ? { "x-amz-checksum-sha256": input.checksumSha256 } : {}),
        },
      };
    },
    createDownloadUrl: async (input: CreateDownloadUrlInput): Promise<CreateDownloadUrlOutput> => {
      const command = new GetObjectCommand({
        Bucket: options.bucket,
        Key: input.key,
      });

      return {
        key: input.key,
        url: await withSpan(
          "storage.create_download_url",
          {
            attributes: {
              "tailorkit.package": "storage",
              "storage.type": "s3",
              "storage.expires_seconds": input.expiresInSeconds ?? 300,
            },
          },
          () =>
            getSignedUrl(client, command, {
              expiresIn: input.expiresInSeconds ?? 300,
            }),
        ),
      };
    },
  };
}
