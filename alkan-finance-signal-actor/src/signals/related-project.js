/**
 * related-project.js — non-destructive related-project indicator.
 *
 * Extracts explicit parent/reference permit numbers that appear in the official
 * permit description (e.g. "...processing for 3 records under 7085323-CN" or
 * "Complete and Final permit 6694672-CN"). It NEVER merges records, never
 * assumes identical ownership, and never suppresses a record — it only records
 * the relationship evidence so downstream consumers can group if they choose.
 */

// Seattle permit numbers look like 7085323-CN / 6694672-CN / 7102490-DM.
const PERMIT_NUMBER_RE = /\b\d{6,8}-[A-Z]{2,4}\b/g;

/**
 * @param {import('../types/permit.js').NormalizedPermit} normalized
 * @returns {{ referencePermitNumbers: string[], possibleSharedDevelopment: boolean }}
 */
export function extractRelatedProject(normalized) {
  const description = (normalized?.permit?.description ?? '').toUpperCase();
  const self = (normalized?.permit?.permitNumber ?? '').toUpperCase();

  const found = new Set();
  for (const match of description.matchAll(PERMIT_NUMBER_RE)) {
    const pn = match[0];
    if (pn && pn !== self) found.add(pn);
  }

  const referencePermitNumbers = [...found];
  return {
    referencePermitNumbers,
    possibleSharedDevelopment: referencePermitNumbers.length > 0,
  };
}
