/**
 * http.js — fetch wrapper with timeout, bounded retries, exponential backoff
 * with jitter, and Retry-After support.
 *
 * Patterned after the repo's src/utils/rate-limiter.js (±jitter backoff), kept
 * self-contained. `fetchImpl` and `sleepImpl` are injectable so unit tests run
 * deterministically without touching the network.
 */

const DEFAULT_RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_BACKOFF_BASE_MS = 500;
const MAX_BACKOFF_MS = 30_000;

/** ±20% jitter around ms. */
export function jitter(ms, rng = Math.random) {
  return Math.round(ms * (0.8 + rng() * 0.4));
}

/** Exponential backoff for a given attempt (0-based), with jitter. */
export function computeBackoff(attempt, baseMs = DEFAULT_BACKOFF_BASE_MS, rng = Math.random) {
  const raw = Math.min(baseMs * 2 ** attempt, MAX_BACKOFF_MS);
  return jitter(raw, rng);
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) into ms, or null. */
export function parseRetryAfter(headerValue, now = Date.now()) {
  if (!headerValue) return null;
  const asNum = Number(headerValue);
  if (Number.isFinite(asNum)) return Math.max(0, asNum * 1000);
  const when = Date.parse(headerValue);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - now);
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Perform an HTTP request with timeout and bounded retries.
 *
 * @param {string} url
 * @param {Object} [opts]
 * @param {string} [opts.method='GET']
 * @param {Object} [opts.headers]
 * @param {string} [opts.body]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxRetries]
 * @param {Set<number>|number[]} [opts.retryStatuses]
 * @param {boolean} [opts.respectRetryAfter=true]
 * @param {('follow'|'error'|'manual')} [opts.redirect='follow']
 * @param {Function} [opts.fetchImpl=globalThis.fetch]
 * @param {Function} [opts.sleepImpl]
 * @param {() => number} [opts.rng=Math.random]
 * @returns {Promise<{ response: Response|null, attempts: number, error: Error|null, requests: number }>}
 */
export async function requestWithRetry(url, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    respectRetryAfter = true,
    // 'follow' (default), 'error', or 'manual'. Delivery uses 'error' so a
    // redirect from the ingest endpoint can never resend the signed payload to
    // a different host.
    redirect = 'follow',
    fetchImpl = globalThis.fetch,
    sleepImpl = defaultSleep,
    rng = Math.random,
  } = opts;

  const retrySet = opts.retryStatuses
    ? (opts.retryStatuses instanceof Set ? opts.retryStatuses : new Set(opts.retryStatuses))
    : DEFAULT_RETRY_STATUSES;

  let attempt = 0;
  let requests = 0;
  let lastError = null;

  // Total tries = 1 initial + maxRetries.
  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    requests += 1;
    try {
      const response = await fetchImpl(url, { method, headers, body, redirect, signal: controller.signal });
      clearTimeout(timer);

      if (response.ok || !retrySet.has(response.status)) {
        return { response, attempts: attempt + 1, error: null, requests };
      }

      // Retryable status.
      if (attempt === maxRetries) {
        return { response, attempts: attempt + 1, error: null, requests };
      }
      let waitMs = computeBackoff(attempt, DEFAULT_BACKOFF_BASE_MS, rng);
      if (respectRetryAfter) {
        const ra = parseRetryAfter(response.headers?.get?.('retry-after'));
        if (ra !== null) waitMs = Math.min(Math.max(ra, waitMs), MAX_BACKOFF_MS);
      }
      await sleepImpl(waitMs);
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt === maxRetries) {
        return { response: null, attempts: attempt + 1, error: err, requests };
      }
      await sleepImpl(computeBackoff(attempt, DEFAULT_BACKOFF_BASE_MS, rng));
    }
    attempt += 1;
  }

  return { response: null, attempts: attempt, error: lastError, requests };
}

export const HTTP_DEFAULTS = { DEFAULT_RETRY_STATUSES, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS };
