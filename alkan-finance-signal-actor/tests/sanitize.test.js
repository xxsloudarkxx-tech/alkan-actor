import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { normalizePermit } from '../src/normalization/normalize-permit.js';
import { buildFinanceSignal } from '../src/signals/build-finance-signal.js';
import { buildFundingMatch } from '../src/matching/funding-programs.js';
import {
  buildDatasetRecord, buildDeliveryRecord, sanitizeContacts, scrubForbidden,
} from '../src/sanitize/sanitize-record.js';

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/seattle-permits.json', import.meta.url)), 'utf8'));
const byId = (id) => fixtures.find((r) => r[':id'] === id);
const OBSERVED = '2026-10-02T12:00:00.000Z';

function build(id, includeContacts) {
  const n = normalizePermit(byId(id), { observedAt: OBSERVED });
  // Inject a phone/email on the GC contact to prove sanitization strips it.
  if (n.contacts[0]) { n.contacts[0].phone = '206-555-0100'; n.contacts[0].email = 'gc@example.com'; }
  const s = buildFinanceSignal(n, { observedAt: OBSERVED });
  const fm = buildFundingMatch(n);
  return { n, s, fm };
}

test('includeContacts=false removes phone/email/name but keeps role + availability', () => {
  const { n } = build('row-A', false);
  const contacts = sanitizeContacts(n.contacts, false);
  assert.equal(contacts[0].role, 'general_contractor');
  assert.equal(contacts[0].detailsAvailable, true);
  assert.equal('phone' in contacts[0], false);
  assert.equal('email' in contacts[0], false);
  assert.equal('name' in contacts[0], false);
});

test('includeContacts=true preserves contact details', () => {
  const { n } = build('row-A', true);
  const contacts = sanitizeContacts(n.contacts, true);
  assert.equal(contacts[0].phone, '206-555-0100');
  assert.equal(contacts[0].email, 'gc@example.com');
});

test('dataset record exposes businessContactAvailable and no PII when includeContacts=false', () => {
  const { n, s, fm } = build('row-A', false);
  const rec = buildDatasetRecord(n, s, fm, false);
  assert.equal(rec.businessContactAvailable, true);
  assert.equal(rec.entityRole, 'general_contractor');
  const json = JSON.stringify(rec);
  assert.ok(!json.includes('206-555-0100'));
  assert.ok(!json.includes('gc@example.com'));
  assert.ok(!json.includes('Evergreen Commercial Builders')); // name stripped
});

test('delivery record hides individual names when includeContacts=false', () => {
  const { n, s, fm } = build('row-A', false);
  const rec = buildDeliveryRecord(n, s, fm, false);
  assert.equal(rec.entities.contractorNamed, true);
  assert.ok(!JSON.stringify(rec).includes('Evergreen Commercial Builders'));
});

test('scrubForbidden strips bank/credit/identity keys at any depth', () => {
  const dirty = {
    permitNumber: 'X',
    ssn: '123-45-6789',
    fico_score: 720,
    nested: { bank_transactions: [1, 2], routing_number: '000', ok: 'keep' },
  };
  const clean = scrubForbidden(dirty);
  assert.equal('ssn' in clean, false);
  assert.equal('fico_score' in clean, false);
  assert.equal('bank_transactions' in clean.nested, false);
  assert.equal('routing_number' in clean.nested, false);
  assert.equal(clean.nested.ok, 'keep');
  assert.equal(clean.permitNumber, 'X');
});

test('scrubForbidden handles forbidden keys inside arrays of objects', () => {
  const dirty = { items: [{ ssn: '1', keep: 'a' }, { routing_number: '2', keep: 'b' }] };
  const clean = scrubForbidden(dirty);
  assert.equal('ssn' in clean.items[0], false);
  assert.equal(clean.items[0].keep, 'a');
  assert.equal('routing_number' in clean.items[1], false);
  assert.equal(clean.items[1].keep, 'b');
});

test('dataset record contains no forbidden financial fields', () => {
  const { n, s, fm } = build('row-A', true);
  const json = JSON.stringify(buildDatasetRecord(n, s, fm, true)).toLowerCase();
  for (const bad of ['ssn', 'fico', 'routing_number', 'account_number', 'plaid', 'bank_balance', 'tax_id']) {
    assert.ok(!json.includes(bad), `dataset record leaked "${bad}"`);
  }
});
