export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
    }

    const cleanup = () => signal.removeEventListener("abort", abort);
    promise
      .then((value) => {
        cleanup();
        resolve(value);
      })
      .catch((error) => {
        cleanup();
        reject(error);
      });
  });
}

/** Streams can carry cancellation across Workers RPC without serializing an AbortSignal. */
export function cancellationStream(signal: AbortSignal) {
  let cleanup = () => {};

  return new ReadableStream<never>({
    start(controller) {
      const abort = () => {
        cleanup();
        controller.close();
      };
      cleanup = () => signal.removeEventListener("abort", abort);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
      }
    },
    cancel() {
      cleanup();
    },
  });
}
