import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { normalizePermit } from '../src/normalization/normalize-permit.js';
import { classifyContactRole, classifyContactType, makeContact, ROLES } from '../src/normalization/contacts.js';

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/seattle-permits.json', import.meta.url)), 'utf8'));
const byId = (id) => fixtures.find((r) => r[':id'] === id);
const OBSERVED = '2026-10-02T12:00:00.000Z';

test('normalizes a complete source record', () => {
  const n = normalizePermit(byId('row-A'), { observedAt: OBSERVED });
  assert.equal(n.schemaVersion, '1.0');
  assert.equal(n.permit.permitNumber, '6900001-CN');
  assert.equal(n.permit.status, 'Issued');
  assert.equal(n.permit.permitType, 'New');
  assert.equal(n.permit.declaredValue, 2500000);
  assert.equal(n.permit.address.line1, '500 PINE ST');
  assert.equal(n.permit.address.city, 'Seattle');
  assert.equal(n.permit.address.postalCode, '98101');
  assert.equal(n.entities.contractorName, 'Evergreen Commercial Builders LLC');
  assert.equal(n.source.system, 'seattle_open_data');
  assert.equal(n.source.datasetId, '76t5-zqzr');
  assert.equal(n.source.sourceRecordId, 'row-A');
  assert.equal(n.source.sourceUpdatedAt, '2026-09-28T10:00:00.000Z');
  assert.ok(n.source.sourceUrl.includes('LinkToRecord'));
  assert.equal(n.dataQuality.completeness, 1);
  // Contractor contact is a general_contractor, NEVER owner/applicant.
  assert.equal(n.contacts.length, 1);
  assert.equal(n.contacts[0].role, ROLES.GENERAL_CONTRACTOR);
});

test('never fabricates owner/applicant when the source lacks them', () => {
  const n = normalizePermit(byId('row-A'), { observedAt: OBSERVED });
  assert.equal(n.entities.ownerName, null);
  assert.equal(n.entities.applicantName, null);
  assert.equal(n.entities.applicantOrganization, null);
  assert.equal(n.entities.contractorLicense, null); // not in dataset → never invented
});

test('missing applicant organization / contractor is recorded, not guessed', () => {
  const n = normalizePermit(byId('row-B'), { observedAt: OBSERVED });
  assert.equal(n.entities.contractorName, null);
  assert.equal(n.contacts.length, 0);
  assert.ok(n.dataQuality.warnings.some((w) => /contractor/i.test(w)));
});

test('missing declared value yields null + a missing-field reason', () => {
  const n = normalizePermit(byId('row-C'), { observedAt: OBSERVED });
  assert.equal(n.permit.declaredValue, null);
  assert.ok(n.dataQuality.missingFields.some((m) => m.field === 'declaredValue'));
});

test('normalized record never stores a "revenue" field', () => {
  const n = normalizePermit(byId('row-A'), { observedAt: OBSERVED });
  const json = JSON.stringify(n).toLowerCase();
  assert.ok(!json.includes('revenue'));
});

// ── Entity-safety: role separation ──────────────────────────────────────────
test('consultant is not treated as contractor', () => {
  assert.equal(classifyContactRole('consultant'), ROLES.CONSULTANT);
  assert.notEqual(classifyContactRole('consultant'), ROLES.GENERAL_CONTRACTOR);
});

test('owner is not treated as applicant', () => {
  assert.equal(classifyContactRole('owner'), ROLES.OWNER);
  assert.equal(classifyContactRole('applicant'), ROLES.APPLICANT);
  assert.notEqual(classifyContactRole('owner'), classifyContactRole('applicant'));
});

test('unknown / ambiguous role collapses to unknown_public_contact (never promoted)', () => {
  assert.equal(classifyContactRole('primary point of contact'), ROLES.UNKNOWN);
  assert.equal(classifyContactRole(''), ROLES.UNKNOWN);
  assert.equal(classifyContactRole(null), ROLES.UNKNOWN);
  // A person with an unknown role is never auto-labeled owner/GC/decision maker.
  const c = makeContact({ role: classifyContactRole('mystery'), name: 'Jane Smith', source: 's', retrievedAt: OBSERVED });
  assert.equal(c.role, ROLES.UNKNOWN);
  assert.equal(c.contactType, 'personal');
});

test('contact type classification (organizational vs personal)', () => {
  assert.equal(classifyContactType('Evergreen Commercial Builders LLC'), 'organizational');
  assert.equal(classifyContactType('John Doe'), 'personal');
  assert.equal(classifyContactType(''), 'unknown');
});
