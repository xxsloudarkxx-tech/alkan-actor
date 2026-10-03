/**
 * prospect-readiness.js — deterministic "is there an actionable business behind
 * this permit?" signal, kept SEPARATE from publicActivityScore.
 *
 * This is NOT creditworthiness, approval probability, borrower quality, or
 * likelihood to repay. It only measures whether a verifiable business entity
 * with an explicit, supported role is associated with the public permit.
 *
 * Rules (from the corrective spec):
 *  - No explicit business entity → not_actionable, score 0,
 *    blockingReasons includes the required sentence.
 *  - Explicit applicant organization, not verified as contractor →
 *    research_required, score capped at 40.
 *  - Explicit contractor organization with a supported role →
 *    identifiable_business; score may consider role evidence and permit stage.
 *  - Project VALUE must never increase this score by itself. A high-value
 *    project with no business entity stays not_actionable.
 */

import { ROLES } from '../normalization/contacts.js';
import { stageActionabilityBonus } from './project-stage.js';

const RESEARCH_MAX = 40;
const NO_ENTITY_BLOCKER = 'No verified business entity associated with the permit.';

/**
 * @param {import('../types/permit.js').NormalizedPermit} normalized
 * @param {Object} [opts]
 * @param {string} [opts.projectStage] stage from classifyProjectStage()
 * @returns {{ status: ('not_actionable'|'research_required'|'identifiable_business'), score: number, reasons: string[], blockingReasons: string[] }}
 */
export function buildProspectReadiness(normalized, opts = {}) {
  const stage = opts.projectStage ?? 'unknown';
  const contacts = normalized?.contacts ?? [];
  const reasons = [];
  const blockingReasons = [];

  const gcOrg = contacts.find((c) => c.role === ROLES.GENERAL_CONTRACTOR && c.contactType === 'organizational');
  const gcAny = contacts.find((c) => c.role === ROLES.GENERAL_CONTRACTOR);
  const applicantOrg = contacts.find((c) => c.role === ROLES.APPLICANT && c.contactType === 'organizational');

  // ── Identifiable business: explicit contractor organization with a role ─────
  if (gcOrg) {
    let score = 50;
    reasons.push('Explicit contractor organization with a supported general-contractor role (+50).');
    const bonus = stageActionabilityBonus(stage);
    if (bonus > 0) {
      score += bonus;
      reasons.push(`Permit is operationally actionable at stage "${stage}" (+${bonus}).`);
    }
    if ((gcOrg.confidence ?? 0) >= 0.7) {
      score += 10;
      reasons.push('Contractor role comes from an explicit official permit field (+10).');
    }
    score = Math.min(100, score);
    return { status: 'identifiable_business', score, reasons, blockingReasons };
  }

  // ── Research required: an applicant organization, but NOT a verified contractor
  if (applicantOrg) {
    let score = 20;
    reasons.push('Explicit applicant organization is named (+20).');
    const bonus = stageActionabilityBonus(stage);
    if (bonus > 0) {
      score += bonus;
      reasons.push(`Permit is operationally actionable at stage "${stage}" (+${bonus}).`);
    }
    score = Math.min(RESEARCH_MAX, score); // capped at 40
    blockingReasons.push('Business entity is an applicant, not a verified contractor.');
    return { status: 'research_required', score, reasons, blockingReasons };
  }

  // A general contractor named but not clearly an organization is still not a
  // verified business entity — treat as not actionable but note it.
  if (gcAny) {
    blockingReasons.push('A contractor name appears but it is not resolved to a verified business entity.');
  }

  // ── Not actionable: no explicit business entity ─────────────────────────────
  blockingReasons.push(NO_ENTITY_BLOCKER);
  return { status: 'not_actionable', score: 0, reasons, blockingReasons };
}

export { NO_ENTITY_BLOCKER };
