/**
 * ai-enrichment.js — OPTIONAL future AI enrichment INTERFACE ONLY.
 *
 * This version implements NO paid API calls. ENABLE_AI_ENRICHMENT must be false.
 * The interface documents what a future enricher may accept/return, and enforces
 * the hard prohibitions so it can never be misused.
 *
 * A future enricher MAY accept sanitized public project TEXT and return:
 *   - normalizedScope, possibleTradeCategories, conciseSummary, uncertaintyNotes
 *
 * It MUST NOT: receive bank data, SSNs, or credit scores; infer income; infer
 * race, ethnicity, gender, religion, age, disability, or nationality; approve
 * funding; or assign repayment probability.
 */

export function isAiEnrichmentEnabled() {
  return String(process.env.ENABLE_AI_ENRICHMENT ?? 'false').toLowerCase() === 'true';
}

const BANNED_INPUT_KEYS = new Set([
  'bank', 'bank_transactions', 'balance', 'ssn', 'fico', 'credit_score',
  'income', 'race', 'ethnicity', 'gender', 'religion', 'age', 'disability',
  'nationality', 'plaid_token', 'account_number', 'routing_number', 'tax_id',
]);

/**
 * Validate that an enrichment input carries ONLY sanitized public project text.
 * Throws if any banned key is present.
 * @param {Record<string, any>} input
 * @returns {{ projectText: string }}
 */
export function assertSafeEnrichmentInput(input = {}) {
  for (const k of Object.keys(input)) {
    if (BANNED_INPUT_KEYS.has(String(k).toLowerCase())) {
      throw new Error(`AI enrichment input rejected: forbidden field "${k}".`);
    }
  }
  const projectText = typeof input.projectText === 'string' ? input.projectText : '';
  return { projectText };
}

/**
 * The enrichment entry point. In this version it is a disabled no-op that returns
 * null unless the flag is on — and even then it refuses (no implementation).
 *
 * @param {Object} _input sanitized public project text
 * @returns {Promise<null>} always null in this version
 */
export async function enrich(_input) {
  if (!isAiEnrichmentEnabled()) return null;
  // Flag on but no implementation shipped in this PR — do not call any paid API.
  assertSafeEnrichmentInput(_input);
  throw new Error('AI enrichment is not implemented in this version (no paid API calls are made).');
}

/**
 * @typedef {Object} AiEnrichmentResult
 * @property {string} normalizedScope
 * @property {string[]} possibleTradeCategories
 * @property {string} conciseSummary
 * @property {string[]} uncertaintyNotes
 */
export {};
