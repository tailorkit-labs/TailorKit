import { storageError } from "@tailorkit/app-storage/runtime";

export async function readBounded(
  response: { body: ReadableStream<Uint8Array> | null },
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) throw new Error("Missing download body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Download exceeds its allowed size");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function errorResponse(error: unknown) {
  const failure = storageError(error);
  const status = {
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    BAD_REQUEST: 400,
    NOT_FOUND: 404,
    CONFLICT: 409,
    INCOMPATIBLE_VERSION: 409,
    UNAVAILABLE: 503,
    INTERNAL_SERVER_ERROR: 500,
  }[failure.code];
  return Response.json({ code: failure.code, message: failure.message }, { status });
}
/** Enforce stream expiry outside untrusted app code, including an app that ignores our runtime. */
export function authenticatedResponse(response: Response, expiresAt: number): Response {
  if (!response.body) {
    return response;
  }
  const reader = response.body.getReader();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setTimeout(
        () => {
          if (stopped) {
            return;
          }
          stopped = true;
          // End the stream cleanly so the host SDK reconnects with a renewed token.
          controller.close();
          void reader.cancel().catch(() => {});
        },
        Math.max(0, expiresAt - Date.now()),
      );
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (stopped) {
          return;
        }
        if (chunk.done) {
          stopped = true;
          clearTimeout(timer);
          controller.close();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        if (!stopped) {
          stopped = true;
          clearTimeout(timer);
          controller.error(error);
        }
      }
    },
    async cancel() {
      stopped = true;
      clearTimeout(timer);
      await reader.cancel();
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
