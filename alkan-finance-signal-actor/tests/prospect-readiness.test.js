import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizePermit } from '../src/normalization/normalize-permit.js';
import { buildProspectReadiness, NO_ENTITY_BLOCKER } from '../src/signals/prospect-readiness.js';
import { classifyProjectStage } from '../src/signals/project-stage.js';
import { ROLES } from '../src/normalization/contacts.js';

const OBSERVED = '2026-10-03T12:00:00.000Z';

// Real-run anomaly: $38M demolition with NO contractor company.
const BIG_NO_COMPANY = {
  ':id': 'row-dm', ':updated_at': '2026-10-03T00:00:00.000Z',
  permitnum: '7102490-DM', statuscurrent: 'Ready for Intake',
  permittypemapped: 'Demolition', permitclassmapped: 'Non-Residential',
  description: 'Demolish medical office building [AVANT CHIROPRACTIC] per plan.',
  estprojectcost: '38000000', originaladdress1: '3611 WOODLAND PARK AVE N',
  originalzip: '98103', latitude: '47.65', longitude: '-122.34', contractorcompanyname: '',
};

function prospectFor(row) {
  const n = normalizePermit(row, { observedAt: OBSERVED });
  const stage = classifyProjectStage(n.permit.status).stage;
  return buildProspectReadiness(n, { projectStage: stage });
}

test('$38M permit with no company stays prospectReadiness score 0', () => {
  const p = prospectFor(BIG_NO_COMPANY);
  assert.equal(p.score, 0);
});

test('a permit with no company is not_actionable with the required blocking reason', () => {
  const p = prospectFor(BIG_NO_COMPANY);
  assert.equal(p.status, 'not_actionable');
  assert.ok(p.blockingReasons.includes(NO_ENTITY_BLOCKER));
});

test('project value never creates an identifiable business (value is irrelevant here)', () => {
  const lowValue = { ...BIG_NO_COMPANY, estprojectcost: '1' };
  const highValue = { ...BIG_NO_COMPANY, estprojectcost: '999999999' };
  const a = prospectFor(lowValue);
  const b = prospectFor(highValue);
  assert.equal(a.status, 'not_actionable');
  assert.equal(b.status, 'not_actionable');
  assert.equal(a.score, 0);
  assert.equal(b.score, 0); // 1000x the value changes nothing
});

test('explicit contractor organization with a supported role → identifiable_business', () => {
  const row = {
    ':id': 'row-gc', ':updated_at': '2026-10-03T00:00:00.000Z',
    permitnum: '6900001-CN', statuscurrent: 'Issued', permittypemapped: 'New',
    permitclassmapped: 'Commercial', description: 'New commercial construction per plan.',
    estprojectcost: '2500000', originaladdress1: '500 PINE ST', originalzip: '98101',
    latitude: '47.61', longitude: '-122.33', contractorcompanyname: 'Evergreen Commercial Builders LLC',
  };
  const p = prospectFor(row);
  assert.equal(p.status, 'identifiable_business');
  assert.ok(p.score > 0);
  assert.ok(p.reasons.length > 0);
});

test('applicant organization (not a verified contractor) → research_required, capped at 40', () => {
  const normalizedLike = {
    permit: { status: 'Reviews In Process', description: '', permitNumber: 'X-CN' },
    contacts: [{ role: ROLES.APPLICANT, contactType: 'organizational', confidence: 0.9 }],
    entities: {},
  };
  const p = buildProspectReadiness(/** @type {any} */ (normalizedLike), { projectStage: 'review' });
  assert.equal(p.status, 'research_required');
  assert.ok(p.score <= 40, `score ${p.score} must be <= 40`);
  assert.ok(p.blockingReasons.some((b) => /not a verified contractor/i.test(b)));
});

test('prospectReadiness is never described in credit/approval/borrower terms', () => {
  const p = prospectFor(BIG_NO_COMPANY);
  const json = JSON.stringify(p).toLowerCase();
  for (const bad of ['credit', 'creditworthy', 'approv', 'borrower', 'repay', 'prequalif', 'fico']) {
    assert.ok(!json.includes(bad), `prospectReadiness leaked "${bad}"`);
  }
});
