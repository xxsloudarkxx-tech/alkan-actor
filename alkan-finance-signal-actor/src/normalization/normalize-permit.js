/**
 * normalize-permit.js — raw Socrata row → stable NormalizedPermit record.
 *
 * Principles:
 *  - Never invent fields. Anything the source does not provide is null, with a
 *    reason recorded in dataQuality.missingFields.
 *  - The Seattle dataset (76t5-zqzr) exposes ONLY `contractorcompanyname` as an
 *    entity. There is no owner / applicant / architect / FRP field, so those
 *    remain null — we never guess them. This is a feature, not a gap: it keeps
 *    us from mislabeling anyone.
 *  - declaredValue is the official `estprojectcost`; it is a PROJECT value, not
 *    company revenue (see build-finance-signal.js for the guardrails).
 */

import { SCHEMA_VERSION } from '../types/permit.js';
import { SOURCE_SYSTEM, DATASET_ID, JURISDICTION_LABEL, researchLinkFor } from '../sources/seattle-building-permits.js';
import { ROLES, classifyContactRole, makeContact } from './contacts.js';

/** Extract a Socrata URL-type column that may be `{url}` or a plain string. */
function urlValue(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && typeof v.url === 'string') return v.url;
  return null;
}

/** Parse a possibly-string numeric field to a finite number, else null. */
function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function nonEmpty(v) {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * @param {Object} row raw Socrata row
 * @param {Object} [opts]
 * @param {string} [opts.observedAt] ISO-8601 (defaults to now)
 * @returns {import('../types/permit.js').NormalizedPermit}
 */
export function normalizePermit(row, opts = {}) {
  const observedAt = opts.observedAt ?? new Date().toISOString();
  const missingFields = [];
  const warnings = [];

  const permitNumber = nonEmpty(row.permitnum);
  if (!permitNumber) missingFields.push({ field: 'permitNumber', reason: 'source field `permitnum` empty' });

  const permitClass = nonEmpty(row.permitclassmapped) ?? nonEmpty(row.permitclass);
  const permitType = nonEmpty(row.permittypemapped) ?? nonEmpty(row.permittypedesc);
  if (!permitType) missingFields.push({ field: 'permitType', reason: 'source fields `permittypemapped`/`permittypedesc` empty' });

  const status = nonEmpty(row.statuscurrent);
  if (!status) missingFields.push({ field: 'status', reason: 'source field `statuscurrent` empty' });

  const description = nonEmpty(row.description);
  if (!description) missingFields.push({ field: 'description', reason: 'source field `description` empty' });

  const declaredValue = toNumberOrNull(row.estprojectcost);
  if (declaredValue === null) missingFields.push({ field: 'declaredValue', reason: 'source field `estprojectcost` not provided' });

  const line1 = nonEmpty(row.originaladdress1);
  if (!line1) missingFields.push({ field: 'address.line1', reason: 'source field `originaladdress1` empty' });

  const latitude = toNumberOrNull(row.latitude);
  const longitude = toNumberOrNull(row.longitude);

  const sourceUrl = urlValue(row.link);
  const sourceRecordId = nonEmpty(row[':id']) ?? null;
  const sourceUpdatedAt = nonEmpty(row[':updated_at']) ?? null;

  // ── Entities — only contractor is available from this dataset ───────────────
  const contractorName = nonEmpty(row.contractorcompanyname);
  const entities = {
    applicantName: null,
    applicantOrganization: null,
    contractorName: contractorName ?? null,
    contractorLicense: null, // not in dataset; never fabricated
    ownerName: null,
    financiallyResponsibleParty: null,
  };

  // ── Contacts — strictly role-separated ──────────────────────────────────────
  const contacts = [];
  if (contractorName) {
    contacts.push(makeContact({
      role: classifyContactRole('contractor'), // → general_contractor
      name: contractorName,
      source: SOURCE_SYSTEM,
      retrievedAt: observedAt,
      // Explicit structured field, but license not verified → moderate confidence.
      confidence: 0.7,
    }));
  }

  // ── Evidence — point to the official record; EDMS links are research-only ───
  const evidence = [];
  if (sourceUrl) {
    evidence.push({ type: 'official_source_record', url: sourceUrl, source: SOURCE_SYSTEM, retrievedAt: observedAt });
  }
  const researchLink = researchLinkFor(permitNumber);
  if (researchLink) {
    evidence.push({ type: 'research_link', url: researchLink, source: 'seattle_services_portal', retrievedAt: observedAt, note: 'Generated portal search URL — NOT extracted evidence. Document contents were not downloaded.' });
  }

  // ── Data-quality completeness ───────────────────────────────────────────────
  const keyFields = [permitNumber, status, permitType, description, declaredValue !== null, line1];
  const present = keyFields.filter(Boolean).length;
  const completeness = Math.round((present / keyFields.length) * 100) / 100;

  if (!contractorName) warnings.push('No contractor company listed on the public permit (legal entity unresolved).');

  return {
    schemaVersion: SCHEMA_VERSION,
    source: {
      system: SOURCE_SYSTEM,
      datasetId: DATASET_ID,
      jurisdiction: JURISDICTION_LABEL,
      sourceRecordId,
      sourceUrl: sourceUrl ?? null,
      observedAt,
      sourceUpdatedAt,
    },
    permit: {
      permitNumber: permitNumber ?? null,
      permitClass: permitClass ?? null,
      permitType: permitType ?? null,
      status: status ?? null,
      applicationDate: nonEmpty(row.applieddate),
      issueDate: nonEmpty(row.issueddate),
      expirationDate: nonEmpty(row.expiresdate),
      description: description ?? null,
      declaredValue,
      address: {
        line1: line1 ?? null,
        city: nonEmpty(row.originalcity) ?? 'Seattle',
        state: nonEmpty(row.originalstate) ?? 'WA',
        postalCode: nonEmpty(row.originalzip),
        latitude,
        longitude,
      },
    },
    entities,
    contacts,
    evidence,
    dataQuality: {
      completeness,
      missingFields,
      warnings,
    },
  };
}

export { ROLES };
