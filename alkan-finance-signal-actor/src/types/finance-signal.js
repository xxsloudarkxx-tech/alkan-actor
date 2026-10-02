/**
 * finance-signal.js — JSDoc type definitions for the public project activity
 * signal and funding-match output.
 *
 * IMPORTANT: this signal is NOT a credit score, not an approval, and not a
 * statement that any funding need exists. See build-finance-signal.js.
 */

export const SIGNAL_VERSION = 'public-activity-v1';

/** @typedef {('low'|'medium'|'high')} ActivityBand */

/**
 * @typedef {Object} ScoreReason
 * @property {string} factor   One of: freshness | evidence | declared_value | business_role | scope
 * @property {string} detail   Human-readable explanation of the awarded points.
 * @property {number} points   Points awarded for this reason.
 */

/**
 * @typedef {Object} PossibleUseCase
 * @property {string} label    One of the allowed, non-factual labels.
 * @property {'unverified_hypothesis'} status
 */

/**
 * @typedef {Object} PublicProjectActivitySignal
 * @property {string} signalVersion
 * @property {number} score                    0..100
 * @property {ActivityBand} band
 * @property {ScoreReason[]} reasons
 * @property {string[]} warnings
 * @property {PossibleUseCase[]} possibleUseCases
 * @property {boolean} financialVerificationRequired  Always true.
 * @property {boolean} manualReviewRequired           Always true.
 */

/**
 * @typedef {Object} FundingMatch
 * @property {'public-signal-only'} status
 * @property {string[]} missingFinancialVerification
 */

export {};
