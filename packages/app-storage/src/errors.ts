export type StorageErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INCOMPATIBLE_VERSION"
  | "INTERNAL_SERVER_ERROR"
  | "UNAVAILABLE";
export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string = code) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}
export function storageError(error: unknown): StorageError {
  if (error instanceof StorageError) {
    return error;
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code);
    if (
      [
        "UNAUTHORIZED",
        "FORBIDDEN",
        "BAD_REQUEST",
        "NOT_FOUND",
        "CONFLICT",
        "INCOMPATIBLE_VERSION",
        "UNAVAILABLE",
      ].includes(code)
    ) {
      return new StorageError(
        code as StorageErrorCode,
        "message" in error ? String(error.message) : code,
      );
    }
  }
  return new StorageError("INTERNAL_SERVER_ERROR", "Storage operation failed");
}
