/**
 * sanitize-record.js — produces the sanitized public records that go to the
 * Apify default dataset and to ALKAN delivery.
 *
 * Guarantees:
 *  - NEVER emits bank transactions/balances, Plaid tokens, account/routing
 *    numbers, tax IDs, SSNs, credit scores, uploaded financial documents, or
 *    guessed personal info. (We never collect these; a defensive deep-scrub
 *    strips any such key if one ever appears.)
 *  - When includeContacts=false, phone/email/name are removed but contact role
 *    and source availability are preserved (e.g. businessContactAvailable:true).
 */

import { ROLES } from '../normalization/contacts.js';

// Defensive: keys that must never appear in any emitted record.
const FORBIDDEN_KEYS = new Set([
  'bank_transactions', 'banktransactions', 'bank_balance', 'bankbalance',
  'balances', 'plaid_token', 'plaidtoken', 'account_number', 'accountnumber',
  'routing_number', 'routingnumber', 'tax_id', 'taxid', 'ein', 'ssn',
  'fico', 'fico_score', 'ficoscore', 'credit_score', 'creditscore',
  'documents', 'uploaded_documents',
]);

/** Recursively drop any forbidden keys (defense in depth). */
export function scrubForbidden(value) {
  if (Array.isArray(value)) return value.map(scrubForbidden);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(String(k).toLowerCase())) continue;
      out[k] = scrubForbidden(v);
    }
    return out;
  }
  return value;
}

const BUSINESS_ROLES = new Set([
  ROLES.GENERAL_CONTRACTOR, ROLES.APPLICANT, ROLES.CONSULTANT,
  ROLES.ARCHITECT, ROLES.ENGINEER, ROLES.FINANCIALLY_RESPONSIBLE_PARTY,
]);

/**
 * Sanitize the contacts array. Role/source/availability are always preserved;
 * name/phone/email are removed unless includeContacts=true.
 */
export function sanitizeContacts(contacts = [], includeContacts = false) {
  return contacts.map((c) => {
    const base = {
      role: c.role,
      source: c.source,
      retrievedAt: c.retrievedAt,
      confidence: c.confidence,
      contactType: c.contactType,
      detailsAvailable: Boolean(c.name || c.phone || c.email),
    };
    if (includeContacts) {
      base.name = c.name ?? null;
      base.phone = c.phone ?? null;
      base.email = c.email ?? null;
    }
    return base;
  });
}

function primaryEntityRole(contacts = []) {
  const gc = contacts.find((c) => c.role === ROLES.GENERAL_CONTRACTOR);
  if (gc) return gc.role;
  const biz = contacts.find((c) => BUSINESS_ROLES.has(c.role));
  if (biz) return biz.role;
  if (contacts.length > 0) return contacts[0].role;
  return 'none';
}

function researchLinks(normalized) {
  return (normalized.evidence ?? [])
    .filter((e) => e.type === 'research_link')
    .map((e) => e.url);
}

/**
 * Build the sanitized record pushed to the Apify default dataset.
 * Contains only public project data — no funding-program logic internals.
 *
 * @param {Object} [extras]
 * @param {string} [extras.projectStage]
 * @param {Object} [extras.prospectReadiness]
 * @param {Object} [extras.relatedProject]
 */
export function buildDatasetRecord(normalized, signal, fundingMatch, includeContacts = false, extras = {}) {
  const contacts = normalized.contacts ?? [];
  const businessContactAvailable = contacts.some(
    (c) => c.contactType === 'organizational' || BUSINESS_ROLES.has(c.role),
  );

  const prospect = extras.prospectReadiness ?? null;
  const related = extras.relatedProject ?? { referencePermitNumbers: [], possibleSharedDevelopment: false };

  const record = {
    permitNumber: normalized.permit.permitNumber,
    status: normalized.permit.status,
    projectStage: extras.projectStage ?? 'unknown',
    permitType: normalized.permit.permitType,
    permitClass: normalized.permit.permitClass,
    description: normalized.permit.description,
    declaredProjectValue: normalized.permit.declaredValue,
    address: { ...normalized.permit.address },
    entityRole: primaryEntityRole(contacts),
    businessContactAvailable,
    contacts: sanitizeContacts(contacts, includeContacts),
    publicActivityScore: signal.score,
    publicActivityBand: signal.band,
    // Prospect readiness is SEPARATE from public activity and is NOT a credit,
    // approval, borrower-quality, or repayment measure.
    prospectReadiness: prospect,
    prospectReadinessStatus: prospect?.status ?? null,
    prospectReadinessScore: prospect?.score ?? 0,
    prospectBlockingReasons: prospect?.blockingReasons ?? [],
    reasons: signal.reasons,
    warnings: signal.warnings,
    possibleUseCases: signal.possibleUseCases,
    relatedProject: related,
    referencePermitNumbers: related.referencePermitNumbers ?? [],
    possibleSharedDevelopment: Boolean(related.possibleSharedDevelopment),
    fundingMatch,
    financialVerificationRequired: signal.financialVerificationRequired,
    manualReviewRequired: signal.manualReviewRequired,
    officialSourceUrl: normalized.source.sourceUrl,
    researchLinks: researchLinks(normalized),
    observedAt: normalized.source.observedAt,
  };
  return scrubForbidden(record);
}

/**
 * Build the record delivered to ALKAN. Same sanitized shape plus source
 * identifiers and entity roles (no PII unless includeContacts=true).
 */
export function buildDeliveryRecord(normalized, signal, fundingMatch, includeContacts = false, extras = {}) {
  const base = buildDatasetRecord(normalized, signal, fundingMatch, includeContacts, extras);
  return scrubForbidden({
    ...base,
    source: {
      system: normalized.source.system,
      datasetId: normalized.source.datasetId,
      jurisdiction: normalized.source.jurisdiction,
      sourceRecordId: normalized.source.sourceRecordId,
      sourceUpdatedAt: normalized.source.sourceUpdatedAt,
    },
    entities: includeContacts
      ? normalized.entities
      : {
        // Role availability without naming individuals.
        contractorNamed: Boolean(normalized.entities.contractorName),
        applicantOrganizationNamed: Boolean(normalized.entities.applicantOrganization),
        ownerNamed: Boolean(normalized.entities.ownerName),
      },
    dataQuality: normalized.dataQuality,
  });
}
