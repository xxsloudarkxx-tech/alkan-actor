/**
 * funding-programs.js — preliminary funding-program matching.
 *
 * Hard rule: public permit data CANNOT satisfy financial requirements
 * (monthly bank deposits, FICO, existing debt, overdrafts, ownership
 * verification, ability to repay). Therefore every match is ALWAYS
 * "public-signal-only" and lists the missing financial verification items.
 *
 * Program minimums are supplied by an administrator in a rules file
 * (see programs.example.json). We never hardcode approval claims and never name
 * a specific lender in public dataset output.
 */

/** The verification items public permit data can never satisfy. */
export const MISSING_FINANCIAL_VERIFICATION = Object.freeze([
  'time_in_business',
  'average_monthly_deposits',
  'credit_requirement',
  'existing_obligations',
  'authorized_applicant_identity',
]);

/**
 * @typedef {Object} FundingProgram
 * @property {string} programId
 * @property {string[]} requiredFields   Financial fields the program needs.
 * @property {Array} rules               Admin-supplied rule objects (opaque here).
 */

/**
 * Compute the funding match for a record. By design this is always
 * public-signal-only regardless of the loaded programs.
 *
 * @param {import('../types/permit.js').NormalizedPermit} _normalized
 * @param {FundingProgram[]} [programs]
 * @returns {import('../types/finance-signal.js').FundingMatch}
 */
export function buildFundingMatch(_normalized, programs = []) {
  // Programs are accepted for forward-compatibility (and to validate shape), but
  // public data can never clear their financial minimums.
  void programs;
  return {
    status: 'public-signal-only',
    missingFinancialVerification: [...MISSING_FINANCIAL_VERIFICATION],
  };
}

/** Minimal shape validation for an admin-supplied programs rules file. */
export function validatePrograms(programs) {
  if (!Array.isArray(programs)) throw new Error('programs rules file must be an array.');
  for (const p of programs) {
    if (!p || typeof p.programId !== 'string') throw new Error('each program needs a string programId.');
    if (!Array.isArray(p.requiredFields)) throw new Error(`program ${p.programId}: requiredFields must be an array.`);
    if (!Array.isArray(p.rules)) throw new Error(`program ${p.programId}: rules must be an array.`);
  }
  return true;
}
