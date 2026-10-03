/**
 * contacts.js — entity-safety helpers. Source-agnostic so future jurisdictions
 * reuse the SAME role rules.
 *
 * Hard rules (from the spec):
 *  - Roles MUST stay separate. Owner, Applicant, Architect, Engineer,
 *    Consultant, General contractor, Financially responsible party, Public
 *    document contact, and Decision maker are NEVER merged or treated as
 *    equivalent.
 *  - A person is NEVER labeled owner / GC / decision maker without direct
 *    source evidence. Ambiguous roles collapse to "unknown_public_contact".
 *  - Each contact records its exact displayed role, source, retrieval date,
 *    confidence, and whether it is organizational or personal.
 */

export const ROLES = Object.freeze({
  OWNER: 'owner',
  APPLICANT: 'applicant',
  ARCHITECT: 'architect',
  ENGINEER: 'engineer',
  CONSULTANT: 'consultant',
  GENERAL_CONTRACTOR: 'general_contractor',
  FINANCIALLY_RESPONSIBLE_PARTY: 'financially_responsible_party',
  PUBLIC_DOCUMENT_CONTACT: 'public_document_contact',
  DECISION_MAKER: 'decision_maker',
  UNKNOWN: 'unknown_public_contact',
});

// Exact-ish synonyms → canonical role. Anything not matched is UNKNOWN.
// We deliberately do NOT infer owner / GC / decision_maker from vague terms.
const ROLE_SYNONYMS = new Map([
  ['owner', ROLES.OWNER],
  ['property owner', ROLES.OWNER],
  ['applicant', ROLES.APPLICANT],
  ['applicant organization', ROLES.APPLICANT],
  ['architect', ROLES.ARCHITECT],
  ['engineer', ROLES.ENGINEER],
  ['structural engineer', ROLES.ENGINEER],
  ['consultant', ROLES.CONSULTANT],
  ['design consultant', ROLES.CONSULTANT],
  ['expediter', ROLES.CONSULTANT],
  ['general contractor', ROLES.GENERAL_CONTRACTOR],
  ['gc', ROLES.GENERAL_CONTRACTOR],
  ['contractor', ROLES.GENERAL_CONTRACTOR],
  ['contractor company', ROLES.GENERAL_CONTRACTOR],
  ['financially responsible party', ROLES.FINANCIALLY_RESPONSIBLE_PARTY],
  ['frp', ROLES.FINANCIALLY_RESPONSIBLE_PARTY],
  ['public document contact', ROLES.PUBLIC_DOCUMENT_CONTACT],
  ['document contact', ROLES.PUBLIC_DOCUMENT_CONTACT],
  ['decision maker', ROLES.DECISION_MAKER],
]);

/**
 * Map a raw displayed role string to a canonical role, never promoting an
 * unknown/ambiguous role to owner/GC/decision-maker.
 * @param {string|null|undefined} rawRole
 * @returns {string} canonical role
 */
export function classifyContactRole(rawRole) {
  if (!rawRole || typeof rawRole !== 'string') return ROLES.UNKNOWN;
  const key = rawRole.trim().toLowerCase();
  return ROLE_SYNONYMS.get(key) ?? ROLES.UNKNOWN;
}

const ORG_MARKERS = /\b(llc|l\.l\.c|inc|inc\.|incorporated|corp|corporation|co\b|company|ltd|llp|pllc|lp|construction|constructors|builders?|contracting|contractors?|group|associates|partners|enterprises|services|development|dev\b|architects?|engineering|engineers?|design|studio|homes|properties|realty|holdings)\b/i;

/**
 * Heuristically classify a name as organizational, personal, or unknown.
 * @param {string|null} name
 * @returns {('organizational'|'personal'|'unknown')}
 */
export function classifyContactType(name) {
  if (!name || typeof name !== 'string' || name.trim() === '') return 'unknown';
  if (ORG_MARKERS.test(name)) return 'organizational';
  // Two+ capitalized words with no org marker → likely a person.
  const words = name.trim().split(/\s+/);
  if (words.length >= 2 && words.length <= 4) return 'personal';
  return 'unknown';
}

/**
 * Build a PublicContact with exact role, source, retrieval date, confidence,
 * and organizational/personal classification. PII fields are included here; the
 * sanitizer strips them when includeContacts=false.
 *
 * @param {Object} p
 * @param {string} p.role         canonical role (use classifyContactRole first)
 * @param {string|null} [p.name]
 * @param {string|null} [p.phone]
 * @param {string|null} [p.email]
 * @param {string} p.source
 * @param {string} p.retrievedAt  ISO-8601
 * @param {number} [p.confidence]
 * @returns {import('../types/permit.js').PublicContact}
 */
export function makeContact({ role, name = null, phone = null, email = null, source, retrievedAt, confidence }) {
  const canonicalRole = /** @type {string[]} */ (Object.values(ROLES)).includes(role) ? role : ROLES.UNKNOWN;
  // Default confidence: explicit known role from a structured field = 0.9,
  // unknown role = 0.3.
  const conf = typeof confidence === 'number'
    ? confidence
    : (canonicalRole === ROLES.UNKNOWN ? 0.3 : 0.9);
  return {
    role: canonicalRole,
    source,
    retrievedAt,
    confidence: conf,
    contactType: classifyContactType(name),
    name: name ?? null,
    phone: phone ?? null,
    email: email ?? null,
  };
}
