/**
 * seattle-building-permits.js — official Seattle Open Data (Socrata) adapter.
 *
 * Source:  Building Permits, dataset 76t5-zqzr, data.seattle.gov
 *          https://data.seattle.gov/Built-Environment/Building-Permits/76t5-zqzr
 *
 * Field names were verified against live Socrata metadata (41 columns). The
 * repo's src/sources/wa-feeds.js documents the same mappings as VERIFIED.
 *
 * Design notes:
 *  - Uses the Socrata JSON API only. No browser automation, no login, no CAPTCHA,
 *    no EDMS document downloads (research links are generated instead).
 *  - `$select=:*, *` is required to receive the system fields :id and
 *    :updated_at (confirmed against the live API — a bare `*` omits them).
 *  - Deterministic ordering: `:updated_at ASC, permitnum ASC`.
 *  - Server-side filtering is limited to dates/update-time (reliable SoQL);
 *    value/status/type filters are applied client-side in the pipeline.
 *  - Bounded page size, request timeout, and retry/backoff come from http.js.
 *
 * To add Tacoma (or any jurisdiction) later: create a sibling adapter module
 * exporting the same { fetchPermits } shape and wire it into main.js by
 * jurisdiction — do NOT overload this Seattle adapter.
 */

import { requestWithRetry } from '../util/http.js';
import { logger } from '../util/logger.js';

export const DATASET_ID = '76t5-zqzr';
export const SOURCE_SYSTEM = 'seattle_open_data';
export const JURISDICTION_LABEL = 'Seattle DCI';
const BASE_URL = `https://data.seattle.gov/resource/${DATASET_ID}.json`;
const METADATA_URL = `https://data.seattle.gov/api/views/${DATASET_ID}.json`;
const USER_AGENT = 'alkan-finance-signal-actor/1.0 (+https://apify.com; contact: ALKAN)';
const PORTAL_RECORD_URL = 'https://services.seattle.gov/portal/customize/LinkToRecord.aspx?altId=';
const MAX_PAGE_SIZE = 100;

/** Escape a single-quoted SoQL string literal. */
function soqlLiteral(s) {
  return String(s).replace(/'/g, "''");
}

/**
 * Build the SoQL `$where` clause from validated input.
 * Only date / update-time predicates are placed server-side.
 */
export function buildWhereClause({ updatedSince, dateFrom, dateTo }) {
  const conds = [];
  if (updatedSince) conds.push(`:updated_at > '${soqlLiteral(updatedSince)}'`);
  if (dateFrom) conds.push(`applieddate >= '${soqlLiteral(dateFrom)}T00:00:00'`);
  if (dateTo) conds.push(`applieddate <= '${soqlLiteral(dateTo)}T23:59:59'`);
  return conds.join(' AND ');
}

/** Construct a research-only portal URL for a permit number. */
export function researchLinkFor(permitNumber) {
  if (!permitNumber) return null;
  return `${PORTAL_RECORD_URL}${encodeURIComponent(permitNumber)}`;
}

function buildPageUrl({ where, limit, offset }) {
  const params = new URLSearchParams();
  params.set('$select', ':*, *');
  params.set('$order', ':updated_at ASC, permitnum ASC');
  params.set('$limit', String(limit));
  params.set('$offset', String(offset));
  if (where) params.set('$where', where);
  return `${BASE_URL}?${params.toString()}`;
}

/**
 * Fetch the live dataset metadata (column names, last update). Used by the
 * opt-in integration test; safe to call at low volume.
 */
/**
 * @param {{ appToken?: string, fetchImpl?: Function, sleepImpl?: Function }} [deps]
 * @returns {Promise<any>}
 */
export async function fetchDatasetMetadata({ appToken, fetchImpl, sleepImpl } = {}) {
  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
  if (appToken) headers['X-App-Token'] = appToken;
  const { response, error } = await requestWithRetry(METADATA_URL, {
    headers, timeoutMs: 20_000, maxRetries: 2, fetchImpl, sleepImpl,
  });
  if (error || !response || !response.ok) {
    throw new Error(`Socrata metadata fetch failed: ${error?.message ?? response?.status}`);
  }
  return response.json();
}

/**
 * Retrieve raw permit rows, paginating up to maxRecords.
 *
 * @param {any} input validated input (jurisdiction, dates, maxRecords, …)
 * @param {{ appToken?: string, fetchImpl?: Function, sleepImpl?: Function }} [deps]
 * @returns {Promise<{ rows: Object[], estimatedApiRequests: number, pages: number }>}
 */
export async function fetchPermits(input, deps = {}) {
  const { appToken, fetchImpl, sleepImpl } = deps;
  const where = buildWhereClause(input);

  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
  if (appToken) headers['X-App-Token'] = appToken; // token in header, never in query string

  const rows = [];
  let estimatedApiRequests = 0;
  let pages = 0;
  let offset = 0;

  while (rows.length < input.maxRecords) {
    const remaining = input.maxRecords - rows.length;
    const limit = Math.min(remaining, MAX_PAGE_SIZE);
    const url = buildPageUrl({ where, limit, offset });

    const { response, error, requests } = await requestWithRetry(url, {
      headers, timeoutMs: 20_000, maxRetries: 4, fetchImpl, sleepImpl,
    });
    estimatedApiRequests += requests ?? 1;
    pages += 1;

    if (error || !response) {
      throw new Error(`Socrata request failed after retries: ${error?.message ?? 'no response'}`);
    }
    if (!response.ok) {
      // Never echo the URL (it is token-free, but stay conservative) or body.
      throw new Error(`Socrata returned HTTP ${response.status} for dataset ${DATASET_ID}.`);
    }

    const page = await response.json();
    if (!Array.isArray(page) || page.length === 0) break;

    rows.push(...page);
    offset += page.length;
    if (page.length < limit) break; // last page

    logger.debug('Fetched Socrata page', { pages, fetched: rows.length, target: input.maxRecords });
  }

  const trimmed = rows.slice(0, input.maxRecords);
  logger.info('Seattle source retrieval complete', {
    retrieved: trimmed.length, pages, estimatedApiRequests,
  });
  return { rows: trimmed, estimatedApiRequests, pages };
}
