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
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...requestInit } = init;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...requestInit,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export { DEFAULT_TIMEOUT_MS };
