const DEFAULT_TIMEOUT_MS = 10000;

type FetchWithTimeoutOptions = RequestInit & {
  timeoutMs?: number;
  next?: {
    revalidate?: number | false;
    tags?: string[];
  };
};

export async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: FetchWithTimeoutOptions = {}
) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: externalSignal, ...requestInit } = init;
  const controller = new AbortController();
  let timedOut = false;

  const abortWithReason = (reason?: unknown) => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };

  const timeoutId = setTimeout(() => {
    timedOut = true;
    abortWithReason();
  }, timeoutMs);

  let externalAbortHandler: (() => void) | undefined;
  if (externalSignal) {
    if (externalSignal.aborted) {
      abortWithReason(externalSignal.reason);
    } else {
      externalAbortHandler = () => abortWithReason(externalSignal.reason);
      externalSignal.addEventListener("abort", externalAbortHandler);
    }
  }

  try {
    return await fetch(input, {
      ...requestInit,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError" && timedOut) {
      const timeoutError = new Error(`Request timed out after ${timeoutMs}ms`);
      timeoutError.name = "AbortError";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (externalAbortHandler && externalSignal) {
      externalSignal.removeEventListener("abort", externalAbortHandler);
    }
  }
}

export { DEFAULT_TIMEOUT_MS };
