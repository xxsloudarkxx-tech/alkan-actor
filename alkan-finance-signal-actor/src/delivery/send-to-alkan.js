/**
 * send-to-alkan.js — signed, batched delivery to ALKAN's private ingestion
 * endpoint.
 *
 *  - Max 50 records per batch.
 *  - 15s timeout per request.
 *  - Retries transient failures (408, 429, 5xx) with backoff; NEVER retries a
 *    permanent 4xx (except 408/429).
 *  - Never logs the full signed payload; logs only batch index, run id, response
 *    status, and a safe error code.
 *  - Returns which event keys were confirmed delivered (2xx) so the caller can
 *    avoid resending them, and stops on the first permanent failure so the run
 *    can fail without advancing the cursor.
 */

import { requestWithRetry } from '../util/http.js';
import { buildSignedHeaders } from '../security/sign-payload.js';
import { logger } from '../util/logger.js';

export const MAX_BATCH_SIZE = 50;
const DELIVERY_TIMEOUT_MS = 15_000;
const DELIVERY_RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
export const EVENT_NAME = 'public_finance_signals.discovered';

/** Split an array into fixed-size chunks. */
export function chunk(arr, size = MAX_BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Enforce a secure transport for the ingest URL. HTTPS is required; plain HTTP
 * is only tolerated for localhost (local development/testing). Throws otherwise
 * so a signed payload + tenant header can never be sent over plaintext.
 * @param {string} rawUrl
 * @returns {URL}
 */
export function assertSecureIngestUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('sendToAlkan: ALKAN_INGEST_URL is not a valid URL.');
  }
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost)) {
    throw new Error('sendToAlkan: ALKAN_INGEST_URL must use HTTPS (plain HTTP is allowed only for localhost).');
  }
  return url;
}

/**
 * Deliver sanitized records to ALKAN.
 *
 * @param {Array<{ key: string, record: Object }>} items
 * @param {Object} cfg
 * @param {string} cfg.ingestUrl
 * @param {string} cfg.secret
 * @param {string} cfg.tenantId
 * @param {string} cfg.runId
 * @param {string} cfg.source
 * @param {Function} [cfg.fetchImpl]
 * @param {Function} [cfg.sleepImpl]
 * @param {number} [cfg.timestamp] fixed Unix seconds (tests)
 * @returns {Promise<{ ok: boolean, delivered: number, failed: number, deliveredKeys: string[], error: (null|{batch:number,code:string}) }>}
 */
export async function sendToAlkan(items, cfg) {
  const { ingestUrl, secret, tenantId, runId, source, fetchImpl, sleepImpl, timestamp } = cfg;
  if (!ingestUrl || !secret) {
    throw new Error('sendToAlkan: ingestUrl and secret are required (should be checked before calling).');
  }
  assertSecureIngestUrl(ingestUrl);

  const batches = chunk(items, MAX_BATCH_SIZE);
  const deliveredKeys = [];
  let delivered = 0;

  for (let b = 0; b < batches.length; b += 1) {
    const batch = batches[b];
    const payload = {
      event: EVENT_NAME,
      schemaVersion: '1.0',
      runId,
      source,
      generatedAt: new Date().toISOString(),
      records: batch.map((it) => it.record),
    };
    const rawBody = JSON.stringify(payload);
    const headers = buildSignedHeaders({ rawBody, secret, tenantId, timestamp });

    const { response, error } = await requestWithRetry(ingestUrl, {
      method: 'POST',
      headers,
      body: rawBody,
      timeoutMs: DELIVERY_TIMEOUT_MS,
      maxRetries: 4,
      retryStatuses: DELIVERY_RETRY_STATUSES,
      // Never follow a redirect for a signed request — a 3xx from the ingest
      // endpoint must not resend the signed payload to another host.
      redirect: 'error',
      fetchImpl,
      sleepImpl,
    });

    if (response && response.ok) {
      delivered += batch.length;
      for (const it of batch) deliveredKeys.push(it.key);
      // Safe logging only: no payload, no record contents.
      logger.info('ALKAN delivery batch ok', { batch: b + 1, totalBatches: batches.length, runId, status: response.status, records: batch.length });
      continue;
    }

    // Permanent failure or exhausted retries → stop.
    const code = response ? `http_${response.status}` : (error?.name === 'AbortError' ? 'timeout' : 'network_error');
    logger.error('ALKAN delivery batch failed', { batch: b + 1, totalBatches: batches.length, runId, code });
    return {
      ok: false,
      delivered,
      failed: items.length - delivered,
      deliveredKeys,
      error: { batch: b + 1, code },
    };
  }

  return { ok: true, delivered, failed: 0, deliveredKeys, error: null };
}
