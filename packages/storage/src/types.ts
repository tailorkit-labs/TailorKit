export type StorageType = "s3";

export type StorageBody = Blob | Buffer | Uint8Array | ArrayBuffer | ReadableStream;

export interface PutObjectInput {
  key: string;
  body: StorageBody;
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export interface PutObjectOutput {
  key: string;
  url?: string;
  contentType?: string;
  size?: number;
  etag?: string;
}

export interface HeadObjectInput {
  key: string;
}

export interface HeadObjectOutput {
  key: string;
  contentEncoding?: string;
  contentType?: string;
  contentLength?: number;
  checksumSha256?: string;
  etag?: string;
  metadata?: Record<string, string>;
}

export interface DeleteObjectInput {
  key: string;
}

export interface CreateUploadUrlInput {
  key: string;
  contentEncoding?: string;
  checksumSha256?: string;
  contentType?: string;
  expiresInSeconds?: number;
  metadata?: Record<string, string>;
}

export interface CreateUploadUrlOutput {
  key: string;
  uploadUrl: string;
  headers?: Record<string, string>;
}

export interface UploadToUrlInput {
  uploadUrl: string;
  body: StorageBody;
  headers?: Record<string, string>;
  contentType?: string;
  maxBytes?: number;
}

export interface CreateDownloadUrlInput {
  key: string;
  expiresInSeconds?: number;
}

export interface CreateDownloadUrlOutput {
  key: string;
  url: string;
}

export interface Storage<T extends StorageType = StorageType> {
  readonly type: T;
  head: (input: HeadObjectInput) => Promise<HeadObjectOutput>;
  delete: (input: DeleteObjectInput) => Promise<void>;
  createUploadUrl: (input: CreateUploadUrlInput) => Promise<CreateUploadUrlOutput>;
  createDownloadUrl: (input: CreateDownloadUrlInput) => Promise<CreateDownloadUrlOutput>;
}
