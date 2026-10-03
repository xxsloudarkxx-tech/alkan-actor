/**
 * logger.js — small logger with PII/secret scrubbing.
 *
 * Mirrors the scrubbing approach of the repo's src/utils/logger.js, but kept
 * self-contained (no pino dependency) so the Actor ships with only `apify`.
 * Uses Apify's `log` when available, falling back to console.
 *
 * Fields that MUST NOT appear in logs are redacted recursively on every call.
 */

let apifyLog = null;
try {
  // Lazy import keeps the logger usable in unit tests without the Apify runtime.
  ({ log: apifyLog } = await import('apify'));
} catch {
  apifyLog = null;
}

const REDACT_KEYS = new Set([
  // Contact PII
  'name', 'ownername', 'owner_name', 'applicantname', 'contractorname',
  'phone', 'email', 'mailingaddress', 'mailing_address', 'owners_rep',
  'architect_name', 'financiallyresponsibleparty',
  // Secrets
  'socrata_app_token', 'socrataapptoken', 'alkan_webhook_secret',
  'alkanwebhooksecret', 'secret', 'token', 'authorization', 'signature',
  'x-alkan-signature', 'password', 'apikey', 'api_key',
]);

/** Recursively redact PII/secret-named keys. Values are never serialized raw. */
export function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (REDACT_KEYS.has(String(k).toLowerCase())) out[k] = '[REDACTED]';
      else out[k] = scrub(v);
    }
    return out;
  }
  return value;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL ?? 'info').toLowerCase()] ?? 20;

function emit(level, msg, data) {
  if (LEVELS[level] < threshold) return;
  const safe = data === undefined ? undefined : scrub(data);
  if (apifyLog && typeof apifyLog[level] === 'function') {
    apifyLog[level](msg, safe);
  } else {
    const line = safe === undefined ? msg : `${msg} ${JSON.stringify(safe)}`;
    // eslint-disable-next-line no-console
    (console[level] ?? console.log)(line);
  }
}

export const logger = {
  debug: (m, d) => emit('debug', m, d),
  info: (m, d) => emit('info', m, d),
  warning: (m, d) => emit('warn', m, d),
  warn: (m, d) => emit('warn', m, d),
  error: (m, d) => emit('error', m, d),
};

export default logger;
