import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { normalizePermit } from '../src/normalization/normalize-permit.js';
import { buildFinanceSignal } from '../src/signals/build-finance-signal.js';
import { buildFundingMatch } from '../src/matching/funding-programs.js';
import { buildProspectReadiness } from '../src/signals/prospect-readiness.js';
import { classifyProjectStage } from '../src/signals/project-stage.js';
import { extractRelatedProject } from '../src/signals/related-project.js';
import { buildDatasetRecord } from '../src/sanitize/sanitize-record.js';

const OBSERVED = '2026-10-03T12:00:00.000Z';
const schema = JSON.parse(readFileSync(fileURLToPath(new URL('../.actor/dataset_schema.json', import.meta.url)), 'utf8'));
const schemaKeys = new Set(Object.keys(schema.fields.properties));

function buildRecord(row) {
  const n = normalizePermit(row, { observedAt: OBSERVED });
  const signal = buildFinanceSignal(n, { observedAt: OBSERVED, tradeKeywords: ['construction', 'commercial'] });
  const stage = classifyProjectStage(n.permit.status);
  for (const w of stage.warnings) if (!signal.warnings.includes(w)) signal.warnings.push(w);
  const prospectReadiness = buildProspectReadiness(n, { projectStage: stage.stage });
  const relatedProject = extractRelatedProject(n);
  return buildDatasetRecord(n, signal, buildFundingMatch(n), false, { projectStage: stage.stage, prospectReadiness, relatedProject });
}

const ISSUED_ROW = {
  ':id': '7110308-CN', ':updated_at': '2026-10-03T00:00:00.000Z',
  permitnum: '7110308-CN', statuscurrent: 'Issued', permittypemapped: 'Building', permitclassmapped: 'Residential',
  description: 'Construct new one family dwelling per plan (processing under 7085323-CN)',
  estprojectcost: '328443', originaladdress1: '6806 40TH AVE NE', originalzip: '98115',
  latitude: '47.67', longitude: '-122.28', contractorcompanyname: '',
};

test('every dataset-record key is declared in the dataset schema', () => {
  const rec = buildRecord(ISSUED_ROW);
  for (const k of Object.keys(rec)) {
    assert.ok(schemaKeys.has(k), `record key "${k}" is not declared in dataset_schema.json`);
  }
});

test('new corrective fields are present on the record', () => {
  const rec = buildRecord(ISSUED_ROW);
  for (const k of ['projectStage', 'prospectReadinessStatus', 'prospectReadinessScore', 'prospectBlockingReasons', 'referencePermitNumbers', 'possibleSharedDevelopment']) {
    assert.ok(k in rec, `missing field ${k}`);
  }
  assert.equal(rec.projectStage, 'issued');
  assert.deepEqual(rec.referencePermitNumbers, ['7085323-CN']);
});

test('existing safety fields are preserved unchanged', () => {
  const rec = buildRecord(ISSUED_ROW);
  assert.equal(typeof rec.publicActivityScore, 'number');
  assert.ok(['low', 'medium', 'high'].includes(rec.publicActivityBand));
  assert.equal(rec.fundingMatch.status, 'public-signal-only');
  assert.equal(rec.financialVerificationRequired, true);
  assert.equal(rec.manualReviewRequired, true);
});

test('no bank or credit claims are introduced anywhere in the record', () => {
  const rec = buildRecord(ISSUED_ROW);
  const json = JSON.stringify(rec).toLowerCase();
  for (const bad of ['fico', 'credit score', 'creditworthy', 'pre-approved', 'prequalified', 'qualified borrower', 'likely to repay', 'bank balance', 'routing', 'plaid']) {
    assert.ok(!json.includes(bad), `record leaked "${bad}"`);
  }
});

test('an issued permit with no company is not a finance prospect (not_actionable)', () => {
  const rec = buildRecord(ISSUED_ROW); // Issued, but contractorcompanyname empty
  assert.equal(rec.projectStage, 'issued');
  assert.equal(rec.prospectReadinessStatus, 'not_actionable');
  assert.equal(rec.prospectReadinessScore, 0);
});
