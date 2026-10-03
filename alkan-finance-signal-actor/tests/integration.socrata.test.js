import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchPermits, fetchDatasetMetadata, buildWhereClause } from '../src/sources/seattle-building-permits.js';
import { normalizePermit } from '../src/normalization/normalize-permit.js';
import { buildFinanceSignal } from '../src/signals/build-finance-signal.js';

// Opt-in ONLY: set RUN_SOCRATA_INTEGRATION=1 to hit the live Socrata API.
// Skipped by default so CI/unit runs never touch the network.
const RUN = process.env.RUN_SOCRATA_INTEGRATION === '1';

test('buildWhereClause produces SoQL for updatedSince + date window', () => {
  const where = buildWhereClause({ updatedSince: '2026-09-01T00:00:00.000Z', dateFrom: '2026-09-01', dateTo: '2026-09-30' });
  assert.ok(where.includes(":updated_at > '2026-09-01T00:00:00.000Z'"));
  assert.ok(where.includes("applieddate >= '2026-09-01T00:00:00'"));
  assert.ok(where.includes("applieddate <= '2026-09-30T23:59:59'"));
});

test('live Socrata metadata exposes expected columns', { skip: !RUN }, async () => {
  const meta = await fetchDatasetMetadata({ appToken: process.env.SOCRATA_APP_TOKEN });
  const cols = (meta.columns ?? []).map((c) => c.fieldName);
  for (const f of ['permitnum', 'estprojectcost', 'statuscurrent', 'applieddate', 'contractorcompanyname']) {
    assert.ok(cols.includes(f), `missing expected column ${f}`);
  }
});

test('live Socrata fetch → normalize → signal (maxRecords=5)', { skip: !RUN }, async () => {
  const input = { jurisdiction: 'seattle', updatedSince: null, dateFrom: null, dateTo: null, maxRecords: 5 };
  const { rows } = await fetchPermits(input, { appToken: process.env.SOCRATA_APP_TOKEN });
  assert.ok(rows.length > 0 && rows.length <= 5);
  const n = normalizePermit(rows[0]);
  assert.equal(n.source.datasetId, '76t5-zqzr');
  const s = buildFinanceSignal(n, { tradeKeywords: ['construction', 'commercial'] });
  assert.ok(s.score >= 0 && s.score <= 100);
  assert.equal(s.financialVerificationRequired, true);
});
