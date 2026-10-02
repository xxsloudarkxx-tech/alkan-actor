/**
 * validate.js — small explicit input validator (no Zod dependency, by design).
 *
 * Implements every validation rule from the Actor spec and returns a fully
 * defaulted, normalized input object. Throws InputValidationError on any
 * violation so the Actor fails fast with a clear, safe message.
 */

export class InputValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'InputValidationError';
    this.code = code;
  }
}

const SUPPORTED_JURISDICTIONS = new Set(['seattle']);
const MAX_RECORDS_HARD_CAP = 500;
const DEFAULT_MAX_RECORDS = 100;
const MAX_RANGE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a YYYY-MM-DD date (UTC midnight). Returns Date or null if invalid. */
export function parseDateOnly(s) {
  if (typeof s !== 'string' || !DATE_ONLY_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Guard against JS rollover (e.g. 2026-02-31 -> March).
  if (d.toISOString().slice(0, 10) !== s) return null;
  return d;
}

/** Parse an ISO-8601 timestamp. Returns Date or null if invalid. */
export function parseIso(s) {
  if (typeof s !== 'string' || s.trim() === '') return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asBool(v, dflt) {
  if (v === undefined || v === null) return dflt;
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return dflt;
}

function asArray(v, dflt) {
  if (v === undefined || v === null) return dflt;
  if (!Array.isArray(v)) {
    throw new InputValidationError('Expected an array value.', 'invalid_array');
  }
  return v;
}

/**
 * Validate and normalize raw Actor input.
 * @param {Object} raw
 * @returns {Object} normalized input with all defaults applied
 */
export function validateInput(raw = {}) {
  const input = raw ?? {};

  // ── jurisdiction ──────────────────────────────────────────────────────────
  const jurisdiction = (input.jurisdiction ?? 'seattle');
  if (typeof jurisdiction !== 'string' || !SUPPORTED_JURISDICTIONS.has(jurisdiction)) {
    throw new InputValidationError(
      `Unsupported jurisdiction "${jurisdiction}". Only "seattle" is supported in this version.`,
      'unsupported_jurisdiction',
    );
  }

  // ── dates ─────────────────────────────────────────────────────────────────
  let dateFrom = null;
  let dateTo = null;
  if (input.dateFrom !== undefined && input.dateFrom !== null && input.dateFrom !== '') {
    dateFrom = parseDateOnly(input.dateFrom);
    if (!dateFrom) {
      throw new InputValidationError(`Invalid dateFrom "${input.dateFrom}" (expected YYYY-MM-DD).`, 'invalid_date');
    }
  }
  if (input.dateTo !== undefined && input.dateTo !== null && input.dateTo !== '') {
    dateTo = parseDateOnly(input.dateTo);
    if (!dateTo) {
      throw new InputValidationError(`Invalid dateTo "${input.dateTo}" (expected YYYY-MM-DD).`, 'invalid_date');
    }
  }
  if (dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime()) {
    throw new InputValidationError('dateFrom must not be after dateTo.', 'date_range_inverted');
  }

  let updatedSince = null;
  if (input.updatedSince !== undefined && input.updatedSince !== null && input.updatedSince !== '') {
    updatedSince = parseIso(input.updatedSince);
    if (!updatedSince) {
      throw new InputValidationError(`Invalid updatedSince "${input.updatedSince}" (expected ISO-8601).`, 'invalid_date');
    }
  }

  const allowBackfill = asBool(input.allowBackfill, false);
  if (dateFrom && dateTo) {
    const rangeDays = (dateTo.getTime() - dateFrom.getTime()) / MS_PER_DAY;
    if (rangeDays > MAX_RANGE_DAYS && !allowBackfill) {
      throw new InputValidationError(
        `Date range of ${Math.round(rangeDays)} days exceeds the ${MAX_RANGE_DAYS}-day maximum. Set allowBackfill=true for an explicit backfill.`,
        'range_too_large',
      );
    }
  }

  // ── numeric fields ──────────────────────────────────────────────────────────
  let maxRecords = input.maxRecords === undefined || input.maxRecords === null
    ? DEFAULT_MAX_RECORDS
    : Number(input.maxRecords);
  if (!Number.isFinite(maxRecords) || maxRecords < 1) {
    throw new InputValidationError('maxRecords must be a positive integer.', 'invalid_max_records');
  }
  maxRecords = Math.min(Math.floor(maxRecords), MAX_RECORDS_HARD_CAP);

  let minDeclaredValue = input.minDeclaredValue === undefined || input.minDeclaredValue === null
    ? 0
    : Number(input.minDeclaredValue);
  if (!Number.isFinite(minDeclaredValue) || minDeclaredValue < 0) {
    throw new InputValidationError('minDeclaredValue must be a number >= 0.', 'invalid_monetary');
  }

  // ── arrays ───────────────────────────────────────────────────────────────
  const permitStatuses = asArray(input.permitStatuses, []).map((s) => String(s));
  const permitTypes = asArray(input.permitTypes, []).map((s) => String(s));
  const tradeKeywords = asArray(input.tradeKeywords, []).map((s) => String(s));

  // ── booleans with safe defaults ────────────────────────────────────────────
  const includeContacts = asBool(input.includeContacts, false);
  const sendToAlkan = asBool(input.sendToAlkan, false);
  const dryRun = asBool(input.dryRun, true);

  return {
    jurisdiction,
    dateFrom: dateFrom ? dateFrom.toISOString().slice(0, 10) : null,
    dateTo: dateTo ? dateTo.toISOString().slice(0, 10) : null,
    updatedSince: updatedSince ? updatedSince.toISOString() : null,
    permitStatuses,
    permitTypes,
    tradeKeywords,
    minDeclaredValue,
    maxRecords,
    allowBackfill,
    includeContacts,
    sendToAlkan,
    dryRun,
  };
}

export const CONSTANTS = { MAX_RECORDS_HARD_CAP, DEFAULT_MAX_RECORDS, MAX_RANGE_DAYS };
