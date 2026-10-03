import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizePermit } from '../src/normalization/normalize-permit.js';
import { extractRelatedProject } from '../src/signals/related-project.js';
import { buildFinanceSignal } from '../src/signals/build-finance-signal.js';
import { buildFundingMatch } from '../src/matching/funding-programs.js';
import { buildDatasetRecord } from '../src/sanitize/sanitize-record.js';

const OBSERVED = '2026-10-03T12:00:00.000Z';
const base = (over) => ({
  ':id': over.permitnum, ':updated_at': '2026-10-03T00:00:00.000Z',
  statuscurrent: 'Issued', permittypemapped: 'Building', permitclassmapped: 'Residential',
  originaladdress1: '1 MAIN ST', originalzip: '98101', latitude: '47.6', longitude: '-122.3',
  ...over,
});

test('extracts a referenced parent permit number from the description', () => {
  const n = normalizePermit(base({
    permitnum: '7110308-CN',
    description: 'Construct new Middle one family dwelling per plan (Review and processing for 3 records under 7085323-CN)',
  }), { observedAt: OBSERVED });
  const r = extractRelatedProject(n);
  assert.deepEqual(r.referencePermitNumbers, ['7085323-CN']);
  assert.equal(r.possibleSharedDevelopment, true);
});

test('a self-reference is not reported, and no reference → not shared', () => {
  const selfRef = normalizePermit(base({
    permitnum: '7110407-CN',
    description: 'Construct WEST one-family dwelling. Review and processing for (3) construction records under 7110407-CN.',
  }), { observedAt: OBSERVED });
  const a = extractRelatedProject(selfRef);
  assert.deepEqual(a.referencePermitNumbers, []);
  assert.equal(a.possibleSharedDevelopment, false);

  const none = normalizePermit(base({
    permitnum: '7102490-DM', description: 'Demolish medical office building per plan.',
  }), { observedAt: OBSERVED });
  const b = extractRelatedProject(none);
  assert.deepEqual(b.referencePermitNumbers, []);
  assert.equal(b.possibleSharedDevelopment, false);
});

test('related permits remain SEPARATE dataset records (no merge, relationship preserved)', () => {
  const rows = [
    base({ permitnum: '7110308-CN', description: 'Construct Middle dwelling under 7085323-CN' }),
    base({ permitnum: '7110310-CN', description: 'Construct East dwelling under 7085323-CN' }),
  ];
  const records = rows.map((row) => {
    const n = normalizePermit(row, { observedAt: OBSERVED });
    const signal = buildFinanceSignal(n, { observedAt: OBSERVED });
    const related = extractRelatedProject(n);
    return buildDatasetRecord(n, signal, buildFundingMatch(n), false, { relatedProject: related, projectStage: 'issued' });
  });
  // Two inputs → two separate records (never merged).
  assert.equal(records.length, 2);
  assert.equal(records[0].permitNumber, '7110308-CN');
  assert.equal(records[1].permitNumber, '7110310-CN');
  // Each preserves the shared-development relationship evidence.
  assert.deepEqual(records[0].referencePermitNumbers, ['7085323-CN']);
  assert.deepEqual(records[1].referencePermitNumbers, ['7085323-CN']);
  assert.equal(records[0].possibleSharedDevelopment, true);
});
