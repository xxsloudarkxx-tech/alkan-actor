import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateInput, InputValidationError, CONSTANTS } from '../src/util/validate.js';

test('applies safe defaults', () => {
  const v = validateInput({ jurisdiction: 'seattle' });
  assert.equal(v.dryRun, true);
  assert.equal(v.sendToAlkan, false);
  assert.equal(v.includeContacts, false);
  assert.equal(v.maxRecords, CONSTANTS.DEFAULT_MAX_RECORDS);
  assert.equal(v.minDeclaredValue, 0);
  assert.deepEqual(v.permitStatuses, []);
});

test('rejects unknown jurisdiction', () => {
  assert.throws(() => validateInput({ jurisdiction: 'tacoma' }), InputValidationError);
  assert.throws(() => validateInput({ jurisdiction: 'portland' }), /Unsupported jurisdiction/);
});

test('rejects invalid dates', () => {
  assert.throws(() => validateInput({ jurisdiction: 'seattle', dateFrom: '2026-13-40' }), /Invalid dateFrom/);
  assert.throws(() => validateInput({ jurisdiction: 'seattle', dateFrom: 'not-a-date' }), /Invalid dateFrom/);
  assert.throws(() => validateInput({ jurisdiction: 'seattle', dateFrom: '2026-02-31' }), /Invalid dateFrom/);
});

test('rejects dateFrom after dateTo', () => {
  assert.throws(
    () => validateInput({ jurisdiction: 'seattle', dateFrom: '2026-10-02', dateTo: '2026-09-01' }),
    /must not be after/,
  );
});

test('enforces the 90-day range unless allowBackfill is set', () => {
  const tooWide = { jurisdiction: 'seattle', dateFrom: '2026-01-01', dateTo: '2026-06-01' };
  assert.throws(() => validateInput(tooWide), /exceeds the 90-day maximum/);
  const ok = validateInput({ ...tooWide, allowBackfill: true });
  assert.equal(ok.allowBackfill, true);
  assert.equal(ok.dateFrom, '2026-01-01');
});

test('clamps maxRecords to the hard cap of 500', () => {
  assert.equal(validateInput({ jurisdiction: 'seattle', maxRecords: 10000 }).maxRecords, 500);
  assert.equal(validateInput({ jurisdiction: 'seattle', maxRecords: 50 }).maxRecords, 50);
});

test('rejects negative monetary values and non-positive maxRecords', () => {
  assert.throws(() => validateInput({ jurisdiction: 'seattle', minDeclaredValue: -1 }), /minDeclaredValue/);
  assert.throws(() => validateInput({ jurisdiction: 'seattle', maxRecords: 0 }), /maxRecords/);
});

test('normalizes ISO updatedSince and date-only window', () => {
  const v = validateInput({ jurisdiction: 'seattle', updatedSince: '2026-09-01T00:00:00Z', dateFrom: '2026-09-01', dateTo: '2026-09-30' });
  assert.equal(v.updatedSince, '2026-09-01T00:00:00.000Z');
  assert.equal(v.dateFrom, '2026-09-01');
  assert.equal(v.dateTo, '2026-09-30');
});
