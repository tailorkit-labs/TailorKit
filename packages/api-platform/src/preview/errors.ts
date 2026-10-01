import { Data } from "effect";

/** Invalid input, an incomplete build, or a lost upload/session lease. */
export class PreviewBuildError extends Data.TaggedError("PreviewBuildError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** An adapter failure, distinct from a rejected build. */
export class PreviewStorageError extends Data.TaggedError("PreviewStorageError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}
