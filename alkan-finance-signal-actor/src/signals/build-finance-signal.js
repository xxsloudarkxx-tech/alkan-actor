/**
 * build-finance-signal.js — deterministic, fully explainable "public project
 * activity signal".
 *
 * THIS IS NOT A CREDIT SCORE. It does not determine creditworthiness, approve
 * or reject financing, estimate credit scores, infer deposits/revenue, or claim
 * any funding need exists. It scores only PUBLIC project factors, and every
 * awarded point carries a human-readable reason.
 *
 * Score range 0..100. Bands: 70-100 high, 40-69 medium, 0-39 low.
 */

import { SIGNAL_VERSION } from '../types/finance-signal.js';
import { ROLES } from './../normalization/contacts.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const INACTIVE_STATUS_RE = /\b(expired|withdrawn|cancell?ed|void|closed|inactive|abandoned|revoked)\b/i;
const PUBLIC_ENTITY_RE = /\b(city of|county|public school|school district|university|college|department of|municipal|state of|port of|housing authority|transit|sound transit|federal|\bva\b|veterans affairs)\b/i;

const NEW_COMMERCIAL_RE = /\b(new commercial|commercial construction|new construction|new building|ground[- ]up|core and shell|shell building|major alteration|substantial alteration|establish (a )?new)\b/i;
const TI_REMODEL_RE = /\b(tenant improvement|tenant improvements|\bt\.?i\.?\b|build[- ]?out|remodel|renovation|substantial remodel|interior alteration|rehabilitation|retrofit)\b/i;

// Allowed financing use-case labels. These may ONLY be emitted when a future
// source supplies explicit supporting evidence (invoice/receivable/completed work
// awaiting payment, or a verified business role with matching public evidence).
// They are NEVER inferred from permit-only signals (value/freshness/description/
// address/status/construction keywords).
const USE_CASE_LABELS = {
  materials_working_capital: 'Materials working capital may be relevant',
  payroll_mobilization: 'Payroll or mobilization financing may be relevant',
  equipment_financing: 'Equipment financing may be relevant',
  accounts_receivable: 'Accounts receivable financing may be relevant',
};

// ── Factor A: Record freshness (max 25) ──────────────────────────────────────
export function scoreFreshness(normalized, observedAtIso) {
  const observed = new Date(observedAtIso ?? normalized.source.observedAt ?? Date.now()).getTime();
  const candidates = [
    normalized.source.sourceUpdatedAt,
    normalized.permit.issueDate,
    normalized.permit.applicationDate,
  ].map((d) => (d ? new Date(d).getTime() : NaN)).filter((t) => Number.isFinite(t));

  if (candidates.length === 0) {
    return { points: 0, reason: { factor: 'freshness', detail: 'No usable activity date on the record.', points: 0 } };
  }
  const mostRecent = Math.max(...candidates);
  const days = Math.max(0, Math.floor((observed - mostRecent) / MS_PER_DAY));

  let points;
  if (days <= 14) points = 25;
  else if (days <= 30) points = 18;
  else if (days <= 60) points = 10;
  else if (days <= 90) points = 5;
  else points = 0;

  return {
    points,
    reason: { factor: 'freshness', detail: `Most recent public activity was ${days} day(s) ago.`, points },
  };
}

// ── Factor B: Project evidence completeness (max 20) ──────────────────────────
export function scoreEvidence(normalized) {
  const reasons = [];
  let points = 0;
  const p = normalized.permit;

  if (p.permitNumber) { points += 5; reasons.push({ factor: 'evidence', detail: 'Official permit number present (+5).', points: 5 }); }
  if (p.status) { points += 5; reasons.push({ factor: 'evidence', detail: `Official status present: "${p.status}" (+5).`, points: 5 }); }
  if (p.description) { points += 5; reasons.push({ factor: 'evidence', detail: 'Official project description present (+5).', points: 5 }); }

  const addr = p.address ?? {};
  const verifiableAddress = Boolean(addr.line1) && (Boolean(addr.postalCode) || (addr.latitude !== null && addr.longitude !== null));
  if (verifiableAddress) { points += 5; reasons.push({ factor: 'evidence', detail: 'Verifiable address present (street + ZIP/geocode) (+5).', points: 5 }); }

  return { points, reasons };
}

// ── Factor C: Declared project value (max 20) ─────────────────────────────────
export function scoreDeclaredValue(normalized) {
  const v = normalized.permit.declaredValue;
  if (v === null || v === undefined || v <= 0) {
    return { points: 0, reason: null };
  }
  let points;
  let bandLabel;
  if (v >= 500_000) { points = 20; bandLabel = '$500,000+'; }
  else if (v >= 100_000) { points = 15; bandLabel = '$100,000–$499,999'; }
  else if (v >= 25_000) { points = 8; bandLabel = '$25,000–$99,999'; }
  else { points = 3; bandLabel = '$1–$24,999'; }

  return {
    points,
    reason: {
      factor: 'declared_value',
      // NEVER described as revenue — this is the official declared PROJECT value.
      detail: `Official declared PROJECT value of $${v.toLocaleString('en-US')} is in the ${bandLabel} band (project value, not company revenue) (+${points}).`,
      points,
    },
  };
}

// ── Factor D: Identified business role (max 20) ───────────────────────────────
export function scoreBusinessRole(normalized) {
  const contacts = normalized.contacts ?? [];
  const gc = contacts.find((c) => c.role === ROLES.GENERAL_CONTRACTOR);
  const applicantOrg = contacts.find((c) => c.role === ROLES.APPLICANT && c.contactType === 'organizational');
  const designOrg = contacts.find((c) => [ROLES.CONSULTANT, ROLES.ARCHITECT, ROLES.ENGINEER].includes(c.role));
  const unclearPerson = contacts.find((c) => c.role === ROLES.UNKNOWN && c.contactType === 'personal');

  if (gc && gc.contactType === 'organizational') {
    return { points: 20, reason: { factor: 'business_role', detail: 'Contractor business with an explicit general-contractor role is named (+20).', points: 20 } };
  }
  if (gc) {
    // GC named but not clearly a business entity.
    return { points: 12, reason: { factor: 'business_role', detail: 'General-contractor role named (entity type unclear) (+12).', points: 12 } };
  }
  if (applicantOrg) {
    return { points: 12, reason: { factor: 'business_role', detail: 'Applicant organization with an explicit role is named (+12).', points: 12 } };
  }
  if (designOrg) {
    return { points: 6, reason: { factor: 'business_role', detail: 'Consultant / design organization named (+6).', points: 6 } };
  }
  if (unclearPerson) {
    return { points: 2, reason: { factor: 'business_role', detail: 'A person with an unclear role is named (+2).', points: 2 } };
  }
  return { points: 0, reason: { factor: 'business_role', detail: 'No identified business entity on the record.', points: 0 } };
}

// ── Factor E: Construction scope (max 15) ─────────────────────────────────────
export function scoreScope(normalized, tradeKeywords = []) {
  const p = normalized.permit;
  const text = `${p.description ?? ''} ${p.permitType ?? ''} ${p.permitClass ?? ''}`.toLowerCase();
  const matchedTrades = tradeKeywords
    .map((k) => String(k).toLowerCase().trim())
    .filter((k) => k && text.includes(k));

  if (NEW_COMMERCIAL_RE.test(text)) {
    return { points: 15, reason: { factor: 'scope', detail: 'Scope reads as new commercial construction or major alteration (+15).', points: 15 }, matchedTrades };
  }
  if (TI_REMODEL_RE.test(text)) {
    return { points: 10, reason: { factor: 'scope', detail: 'Scope reads as tenant improvement or substantial remodeling (+10).', points: 10 }, matchedTrades };
  }
  if (matchedTrades.length > 0) {
    return { points: 6, reason: { factor: 'scope', detail: `Trade-specific scope matched: ${matchedTrades.join(', ')} (+6).`, points: 6 }, matchedTrades };
  }
  return { points: 0, reason: { factor: 'scope', detail: 'Administrative or unclear scope (0).', points: 0 }, matchedTrades };
}

// ── Possible financing use cases (non-factual hypotheses only) ────────────────
/**
 * Permit data ALONE is never sufficient to hypothesize a financing use case.
 * A specific label (materials / payroll / equipment / accounts-receivable) is
 * emitted ONLY when `supportingEvidence` carries an explicit item for it from a
 * future source — e.g. an invoice, a receivable, completed work awaiting
 * payment, or a verified business role with matching public evidence. We do NOT
 * infer these from construction keywords, value, freshness, description, address
 * or status. With no such evidence (the permit-only case) the result is the
 * single "Use of funds not established" hypothesis.
 *
 * @param {Object} [opts]
 * @param {Array<{category: string}>} [opts.supportingEvidence]
 * @returns {import('../types/finance-signal.js').PossibleUseCase[]}
 */
export function buildPossibleUseCases({ supportingEvidence = [] } = {}) {
  /** @param {string} label @returns {import('../types/finance-signal.js').PossibleUseCase} */
  const H = (label) => ({ label, status: 'unverified_hypothesis' });
  const out = [];

  for (const ev of Array.isArray(supportingEvidence) ? supportingEvidence : []) {
    const label = USE_CASE_LABELS[ev?.category];
    if (label) out.push(H(label));
  }

  if (out.length === 0) out.push(H('Use of funds not established'));

  // De-duplicate by label.
  const seen = new Set();
  return out.filter((u) => (seen.has(u.label) ? false : seen.add(u.label)));
}

// ── Warnings ──────────────────────────────────────────────────────────────────
function buildWarnings(normalized, { businessRole }) {
  const warnings = [];
  const contacts = normalized.contacts ?? [];
  const gc = contacts.find((c) => c.role === ROLES.GENERAL_CONTRACTOR);
  const designOrg = contacts.find((c) => [ROLES.CONSULTANT, ROLES.ARCHITECT, ROLES.ENGINEER].includes(c.role));
  const hasUnknownRole = contacts.some((c) => c.role === ROLES.UNKNOWN);

  if (gc && (gc.confidence ?? 0) < 1) warnings.push('General contractor is unconfirmed (no license verification performed).');
  if (!normalized.entities.contractorName && !normalized.entities.applicantOrganization) {
    warnings.push('Legal entity is unresolved on the public record.');
  }
  if (hasUnknownRole) warnings.push('At least one public contact has an unclear role.');
  if (normalized.permit.declaredValue === null) warnings.push('Declared project value is absent.');
  if (normalized.permit.status && INACTIVE_STATUS_RE.test(normalized.permit.status)) {
    warnings.push(`Permit status indicates it is not active: "${normalized.permit.status}".`);
  }
  if (normalized.entities.ownerName && normalized.entities.applicantName
      && normalized.entities.ownerName !== normalized.entities.applicantName) {
    warnings.push('Owner and applicant are represented by different entities.');
  }
  const scopeText = `${normalized.permit.description ?? ''} ${normalized.entities.applicantOrganization ?? ''}`;
  if (PUBLIC_ENTITY_RE.test(scopeText)) warnings.push('The project appears to be public or institutional.');
  if (designOrg && !gc) warnings.push('The record describes consultants/design professionals but no contractor.');

  // Carry forward normalization data-quality warnings (deduped).
  for (const w of normalized.dataQuality?.warnings ?? []) {
    if (!warnings.includes(w)) warnings.push(w);
  }
  return warnings;
}

/**
 * Build the complete public project activity signal for a normalized record.
 * @param {import('../types/permit.js').NormalizedPermit} normalized
 * @param {Object} [opts]
 * @param {string} [opts.observedAt]
 * @param {string[]} [opts.tradeKeywords]
 * @param {Array<{category: string}>} [opts.supportingEvidence]
 * @returns {import('../types/finance-signal.js').PublicProjectActivitySignal}
 */
export function buildFinanceSignal(normalized, opts = {}) {
  const observedAt = opts.observedAt ?? normalized.source.observedAt;
  const tradeKeywords = opts.tradeKeywords ?? [];

  const freshness = scoreFreshness(normalized, observedAt);
  const evidence = scoreEvidence(normalized);
  const value = scoreDeclaredValue(normalized);
  const role = scoreBusinessRole(normalized);
  const scope = scoreScope(normalized, tradeKeywords);

  const reasons = [
    freshness.reason,
    ...evidence.reasons,
    value.reason,
    role.reason,
    scope.reason,
  ].filter((r) => r && r.points > 0);

  const score = Math.min(
    100,
    freshness.points + evidence.points + value.points + role.points + scope.points,
  );

  /** @type {import('../types/finance-signal.js').ActivityBand} */
  let band;
  if (score >= 70) band = 'high';
  else if (score >= 40) band = 'medium';
  else band = 'low';

  const warnings = buildWarnings(normalized, { businessRole: role });
  // Permit-only records carry no supporting financial evidence, so this yields
  // only the "Use of funds not established" hypothesis.
  const possibleUseCases = buildPossibleUseCases({ supportingEvidence: opts.supportingEvidence });

  return {
    signalVersion: SIGNAL_VERSION,
    score,
    band,
    reasons,
    warnings,
    possibleUseCases,
    financialVerificationRequired: true,
    manualReviewRequired: true,
  };
}
