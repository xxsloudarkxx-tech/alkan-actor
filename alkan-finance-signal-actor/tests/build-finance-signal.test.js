import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { normalizePermit } from '../src/normalization/normalize-permit.js';
import {
  buildFinanceSignal, scoreFreshness, scoreEvidence, scoreDeclaredValue,
  scoreBusinessRole, scoreScope, buildPossibleUseCases,
} from '../src/signals/build-finance-signal.js';
import { buildFundingMatch } from '../src/matching/funding-programs.js';

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/seattle-permits.json', import.meta.url)), 'utf8'));
const byId = (id) => fixtures.find((r) => r[':id'] === id);
const OBSERVED = '2026-10-02T12:00:00.000Z';
const TRADES = ['construction', 'remodel', 'tenant improvement', 'commercial', 'roof', 'drywall', 'electrical', 'mechanical', 'concrete'];

function sig(id) {
  const n = normalizePermit(byId(id), { observedAt: OBSERVED });
  return buildFinanceSignal(n, { observedAt: OBSERVED, tradeKeywords: TRADES });
}

test('exact activity score for the complete high-activity record', () => {
  const n = normalizePermit(byId('row-A'), { observedAt: OBSERVED });
  assert.equal(scoreFreshness(n, OBSERVED).points, 25); // updated 4 days ago
  assert.equal(scoreEvidence(n).points, 20);            // all 4 sub-items
  assert.equal(scoreDeclaredValue(n).points, 20);       // $2.5M
  assert.equal(scoreBusinessRole(n).points, 20);        // contractor org + explicit role
  assert.equal(scoreScope(n, TRADES).points, 15);       // new commercial
  const s = buildFinanceSignal(n, { observedAt: OBSERVED, tradeKeywords: TRADES });
  assert.equal(s.score, 100);
  assert.equal(s.band, 'high');
});

test('every awarded point has a traceable reason (points > 0)', () => {
  const s = sig('row-A');
  assert.ok(s.reasons.length >= 5);
  for (const r of s.reasons) {
    assert.ok(typeof r.detail === 'string' && r.detail.length > 0);
    assert.ok(r.points > 0);
    assert.ok(['freshness', 'evidence', 'declared_value', 'business_role', 'scope'].includes(r.factor));
  }
  const sumPoints = s.reasons.reduce((a, r) => a + r.points, 0);
  assert.equal(sumPoints, s.score);
});

test('declared value is described as project value, NOT revenue', () => {
  const s = sig('row-A');
  const valueReason = s.reasons.find((r) => r.factor === 'declared_value');
  assert.ok(valueReason.detail.includes('project value, not company revenue'));
  // No reason anywhere describes value as revenue.
  for (const r of s.reasons) {
    assert.ok(!/\brevenue of\b|\bcompany revenue of\b/i.test(r.detail));
  }
});

test('financing use cases are only unverified hypotheses', () => {
  const s = sig('row-A');
  assert.ok(s.possibleUseCases.length > 0);
  for (const u of s.possibleUseCases) {
    assert.equal(u.status, 'unverified_hypothesis');
  }
  const labels = s.possibleUseCases.map((u) => u.label);
  assert.ok(labels.includes('Materials working capital may be relevant'));
});

test('possible use cases fall back to "use of funds not established"', () => {
  const out = buildPossibleUseCases({ scopePoints: 0, matchedTrades: [], declaredValue: null });
  assert.equal(out.length, 1);
  assert.equal(out[0].label, 'Use of funds not established');
  assert.equal(out[0].status, 'unverified_hypothesis');
});

test('funding match is always public-signal-only with 5 missing items', () => {
  const n = normalizePermit(byId('row-A'), { observedAt: OBSERVED });
  const fm = buildFundingMatch(n);
  assert.equal(fm.status, 'public-signal-only');
  assert.equal(fm.missingFinancialVerification.length, 5);
  assert.ok(fm.missingFinancialVerification.includes('average_monthly_deposits'));
});

test('cancelled permit produces an inactive-status warning', () => {
  const s = sig('row-D');
  assert.ok(s.warnings.some((w) => /not active/i.test(w) && /Cancelled/i.test(w)));
});

test('missing declared value produces an absent-value warning', () => {
  const s = sig('row-C');
  assert.ok(s.warnings.some((w) => /declared project value is absent/i.test(w)));
});

test('public/institutional project is flagged', () => {
  const s = sig('row-G');
  assert.ok(s.warnings.some((w) => /public or institutional/i.test(w)));
});

test('signal always requires financial verification and manual review', () => {
  const s = sig('row-A');
  assert.equal(s.financialVerificationRequired, true);
  assert.equal(s.manualReviewRequired, true);
});

test('NO banned financing language appears anywhere in the signal', () => {
  const banned = ['pre-approved', 'preapproved', 'creditworthy', 'guaranteed funding', 'qualified borrower', 'likely to repay', 'prequalified', 'pre-qualified'];
  for (const id of ['row-A', 'row-B', 'row-C', 'row-D', 'row-G']) {
    const json = JSON.stringify(sig(id)).toLowerCase();
    for (const phrase of banned) assert.ok(!json.includes(phrase), `found banned phrase "${phrase}" in ${id}`);
  }
});
