/**
 * project-stage.js — deterministic classification of a Seattle permit status
 * into a coarse lifecycle stage, plus stage-specific warnings.
 *
 * IMPORTANT: the stage is an OPERATIONAL descriptor only. It must NOT alter any
 * credit/financing conclusion (fundingMatch stays public-signal-only;
 * financialVerificationRequired / manualReviewRequired stay true). An "issued"
 * permit may be more actionable operationally, but it is still not a financing
 * prospect without an identified, verified business entity.
 */

/** @typedef {('pre_application'|'intake'|'review'|'issued'|'active'|'completed'|'inactive'|'unknown')} ProjectStage */

/**
 * @param {string|null|undefined} status official `statuscurrent`
 * @returns {{ stage: ProjectStage, warnings: string[] }}
 */
export function classifyProjectStage(status) {
  const s = (status ?? '').toString().trim();
  const l = s.toLowerCase();
  const warnings = [];
  if (!s) return { stage: 'unknown', warnings: [] };

  /** @type {ProjectStage} */
  let stage;
  if (/ready for intake/.test(l)) {
    stage = 'intake';
    warnings.push('Permit is "Ready for Intake" — not yet submitted for review or issued.');
  } else if (/application completed/.test(l)) {
    stage = 'intake';
    warnings.push('Application completed but the permit is not yet issued.');
  } else if (/correction/.test(l)) {
    stage = 'review';
    warnings.push('Permit has corrections required (in review).');
  } else if (/review/.test(l)) {
    stage = 'review';
    warnings.push('Permit is in review (not yet issued).');
  } else if (/withdrawn/.test(l)) {
    stage = 'inactive';
    warnings.push('Permit was withdrawn (inactive).');
  } else if (/cancell?ed/.test(l)) {
    stage = 'inactive';
    warnings.push('Permit was cancelled (inactive).');
  } else if (/expired/.test(l)) {
    stage = 'inactive';
    warnings.push('Permit is expired (inactive).');
  } else if (/\b(void|revoked|closed|inactive|abandoned|denied)\b/.test(l)) {
    stage = 'inactive';
    warnings.push(`Permit is inactive: "${s}".`);
  } else if (/\b(completed|finaled|final|certificate of occupancy|c of o|co issued)\b/.test(l)) {
    stage = 'completed';
  } else if (/issued/.test(l)) {
    stage = 'issued';
  } else if (/\b(active|under inspection|inspection|in progress|open)\b/.test(l)) {
    stage = 'active';
  } else if (/\b(pre-?application|pre-?app|submitted|received|applied)\b/.test(l)) {
    stage = 'pre_application';
  } else {
    stage = 'unknown';
  }
  return { stage, warnings };
}

/** Operational actionability bonus for prospect readiness (NOT a credit factor). */
export function stageActionabilityBonus(stage) {
  switch (stage) {
    case 'issued':
    case 'active':
      return 20;
    case 'review':
      return 10;
    case 'intake':
      return 5;
    default:
      return 0;
  }
}
