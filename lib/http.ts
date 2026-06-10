// Shared fetch helper with retry + backoff for all API connectors.
// Handles transient failures (429 Too Many Requests, 5xx) and honours the
// `Retry-After` header that Microsoft Graph, Business Central and Jira all send.
//
// This is connector infrastructure — page requests never call it directly.

export interface RetryOptions {
  /** Max attempts including the first try. Default 4. */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff. Default 500. */
  baseDelayMs?: number;
  /** Cap on any single backoff wait in ms. Default 20_000. */
  maxDelayMs?: number;
  /** Per-request timeout in ms. Default 30_000. */
  timeoutMs?: number;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse a Retry-After header (seconds or HTTP-date) into milliseconds. */
function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds)) return Math.max(0, asSeconds * 1000);
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

/**
 * fetch() with automatic retry on transient errors and an abort-based timeout.
 * Non-retryable responses (e.g. 401, 404, 410) are returned to the caller as-is
 * so the connector can surface the real error instead of looping.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: RetryOptions = {}
): Promise<Response> {
  const {
    maxAttempts = 4,
    baseDelayMs = 500,
    maxDelayMs = 20_000,
    timeoutMs = 30_000,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (res.ok || !RETRYABLE_STATUS.has(res.status)) return res;

      // Retryable status — back off and try again unless we're out of attempts.
      if (attempt === maxAttempts) return res;
      const wait = retryAfterMs(res) ?? Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await sleep(wait);
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt === maxAttempts) break;
      await sleep(Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Request failed after ${maxAttempts} attempts: ${url}`);
}
