import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  eventDedupeKey, permitKey, normalizePermitNumber, normalizeSourceUpdatedAt, keysForNormalized,
} from '../src/state/dedupe.js';
import { Checkpoint } from '../src/state/checkpoint.js';
import { normalizePermit } from '../src/normalization/normalize-permit.js';

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/seattle-permits.json', import.meta.url)), 'utf8'));
const byId = (id) => fixtures.find((r) => r[':id'] === id);

test('event dedupe key is stable for identical inputs', () => {
  const a = eventDedupeKey('seattle', '6900001-CN', '2026-09-28T10:00:00.000Z');
  const b = eventDedupeKey('seattle', '6900001-CN', '2026-09-28T10:00:00.000Z');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('two identical source records produce ONE event key', () => {
  const n1 = normalizePermit(byId('row-A'));
  const n2 = normalizePermit({ ...byId('row-A') }); // identical copy
  assert.equal(keysForNormalized(n1, 'seattle').eventKey, keysForNormalized(n2, 'seattle').eventKey);
});

test('a changed update timestamp produces a NEW event key but SAME permit key', () => {
  const base = byId('row-A');
  const updated = { ...base, ':updated_at': '2026-09-29T10:00:00.000Z' };
  const n1 = normalizePermit(base);
  const n2 = normalizePermit(updated);
  const k1 = keysForNormalized(n1, 'seattle');
  const k2 = keysForNormalized(n2, 'seattle');
  assert.notEqual(k1.eventKey, k2.eventKey);       // new event
  assert.equal(k1.permitKey, k2.permitKey);        // same underlying permit
});

test('permit number normalization is case/space-insensitive', () => {
  assert.equal(normalizePermitNumber('  6900001-cn '), '6900001-CN');
  assert.equal(permitKey('seattle', '6900001-cn'), permitKey('SEATTLE', '6900001-CN '));
});

test('source timestamp normalization canonicalizes ISO', () => {
  assert.equal(normalizeSourceUpdatedAt('2026-09-28T10:00:00Z'), '2026-09-28T10:00:00.000Z');
  assert.equal(normalizeSourceUpdatedAt(null), '');
});

// ── Checkpoint ────────────────────────────────────────────────────────────────
function fakeStore() {
  const map = new Map();
  return {
    data: map,
    async getValue(k) { return map.has(k) ? map.get(k) : null; },
    async setValue(k, v) { map.set(k, v); },
  };
}

test('checkpoint persists processed hashes and prunes by retention', async () => {
  const store = fakeStore();
  const cp = new Checkpoint(store, { retentionMs: 1000, now: 10_000 });
  await cp.load();
  cp.markProcessed('hash-1');
  assert.ok(cp.isProcessed('hash-1'));
  await cp.commit({});
  // Reload with a clock far in the future → old hash pruned.
  const cp2 = new Checkpoint(store, { retentionMs: 1000, now: 20_000 });
  await cp2.load();
  assert.equal(cp2.isProcessed('hash-1'), false);
});

test('cursor only advances on explicit observe + commit', async () => {
  const store = fakeStore();
  const cp = new Checkpoint(store, { now: 1 });
  await cp.load();
  // Commit without observing → cursor stays null (models a failed-delivery commit).
  await cp.commit({});
  assert.equal(cp.state.lastSourceUpdatedAt, null);
  // Now observe + commit → cursor advances.
  cp.observeSourceUpdatedAt('2026-09-28T10:00:00.000Z');
  await cp.commit({});
  assert.equal(cp.state.lastSourceUpdatedAt, '2026-09-28T10:00:00.000Z');
});
