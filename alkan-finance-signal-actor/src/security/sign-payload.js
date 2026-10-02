/**
 * sign-payload.js — HMAC-SHA256 request signing for ALKAN delivery.
 *
 * Signature input:  `${timestamp}.${rawRequestBody}`
 * Algorithm:        HMAC-SHA256 with ALKAN_WEBHOOK_SECRET, hex-encoded.
 *
 * The secret is only used here; it is never logged, never placed in a query
 * string, and never written to a dataset.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Compute the hex HMAC-SHA256 signature over `${timestamp}.${rawBody}`.
 * @param {string} rawBody    exact serialized request body
 * @param {string} secret     ALKAN_WEBHOOK_SECRET
 * @param {number|string} timestamp  Unix seconds
 * @returns {string} lowercase hex signature
 */
export function signPayload(rawBody, secret, timestamp) {
  if (!secret) throw new Error('signPayload: missing secret.');
  const signingInput = `${timestamp}.${rawBody}`;
  return createHmac('sha256', secret).update(signingInput, 'utf8').digest('hex');
}

/**
 * Build the signed delivery headers.
 * @param {Object} p
 * @param {string} p.rawBody
 * @param {string} p.secret
 * @param {string} p.tenantId
 * @param {number} [p.timestamp] Unix seconds (defaults to now)
 * @returns {Object} headers
 */
export function buildSignedHeaders({ rawBody, secret, tenantId, timestamp }) {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const signature = signPayload(rawBody, secret, ts);
  return {
    'Content-Type': 'application/json',
    'X-Alkan-Tenant': tenantId ?? '',
    'X-Alkan-Timestamp': String(ts),
    'X-Alkan-Signature': signature,
  };
}

/**
 * Constant-time verification (for the receiving backend / tests).
 * @returns {boolean}
 */
export function verifySignature({ rawBody, secret, timestamp, signature }) {
  const expected = signPayload(rawBody, secret, timestamp);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature ?? ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
