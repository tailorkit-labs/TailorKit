const DEFAULT_GET_TIMEOUT_MS = 5_000;

export function withTimeout<T>(
  promise: Promise<T>,
  timeout: number | undefined = DEFAULT_GET_TIMEOUT_MS,
): Promise<T> {
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    return Promise.reject(new TypeError("KV timeout must be a positive integer."));
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`KV get timed out after ${timeout}ms.`)),
      timeout,
    );
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}
