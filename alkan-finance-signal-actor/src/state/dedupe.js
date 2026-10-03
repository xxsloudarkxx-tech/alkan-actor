/**
 * dedupe.js — stable deduplication keys.
 *
 *   eventDedupeKey = sha256( jurisdiction | normPermitNumber | normSourceUpdatedAt )
 *   permitKey      = sha256( jurisdiction | normPermitNumber )
 *
 * The event key changes when the source update timestamp changes, so an updated
 * record produces a NEW event (re-processed), while two identical source records
 * collapse to one.
 */

import { createHash } from 'node:crypto';

/** Normalize a permit number: trim, uppercase, collapse internal whitespace. */
export function normalizePermitNumber(pn) {
  if (pn === null || pn === undefined) return '';
  return String(pn).trim().toUpperCase().replace(/\s+/g, '');
}

/** Normalize a source update timestamp to canonical ISO, or '' when absent. */
export function normalizeSourceUpdatedAt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts).trim() : d.toISOString();
}

function sha256(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Event-level key — changes when the source update timestamp changes. */
export function eventDedupeKey(jurisdiction, permitNumber, sourceUpdatedAt) {
  const parts = [
    String(jurisdiction ?? '').trim().toLowerCase(),
    normalizePermitNumber(permitNumber),
    normalizeSourceUpdatedAt(sourceUpdatedAt),
  ];
  return sha256(parts.join('|'));
}

/** Entity-independent permit key — stable across updates. */
export function permitKey(jurisdiction, permitNumber) {
  const parts = [
    String(jurisdiction ?? '').trim().toLowerCase(),
    normalizePermitNumber(permitNumber),
  ];
  return sha256(parts.join('|'));
}

/** Convenience: derive both keys from a normalized record. */
export function keysForNormalized(normalized, jurisdiction) {
  const pn = normalized.permit.permitNumber;
  return {
    eventKey: eventDedupeKey(jurisdiction, pn, normalized.source.sourceUpdatedAt),
    permitKey: permitKey(jurisdiction, pn),
  };
}
