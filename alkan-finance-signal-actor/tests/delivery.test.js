import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sendToAlkan, chunk, MAX_BATCH_SIZE, assertSecureIngestUrl } from '../src/delivery/send-to-alkan.js';
import { signPayload } from '../src/security/sign-payload.js';
import { Checkpoint } from '../src/state/checkpoint.js';

const noSleep = async () => {};
const CFG = { ingestUrl: 'https://ingest.example/alkan', secret: 's3cr3t', tenantId: 'tenant-1', runId: 'run-1', source: 'seattle_open_data', sleepImpl: noSleep, timestamp: 1_759_000_000 };

function res(status) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, async json() { return {}; }, async text() { return ''; } };
}
function items(n) {
  return Array.from({ length: n }, (_, i) => ({ key: `k${i}`, record: { permitNumber: `P${i}` } }));
}

test('batches at 50 records and delivers all on 2xx', async () => {
  const bodies = [];
  const fetchImpl = async (_url, opts) => { bodies.push(opts.body); return res(200); };
  const out = await sendToAlkan(items(60), { ...CFG, fetchImpl });
  assert.equal(out.ok, true);
  assert.equal(out.delivered, 60);
  assert.equal(out.deliveredKeys.length, 60);
  assert.equal(bodies.length, 2); // 50 + 10
});

test('signs each batch body with HMAC over `timestamp.body`', async () => {
  /** @type {any} */ let seenHeaders; /** @type {any} */ let seenBody;
  const fetchImpl = async (_url, opts) => { seenHeaders = opts.headers; seenBody = opts.body; return res(200); };
  await sendToAlkan(items(1), { ...CFG, fetchImpl });
  assert.equal(seenHeaders['X-Alkan-Tenant'], 'tenant-1');
  assert.equal(seenHeaders['X-Alkan-Timestamp'], String(CFG.timestamp));
  assert.equal(seenHeaders['X-Alkan-Signature'], signPayload(seenBody, CFG.secret, CFG.timestamp));
});

test('retries a transient 503 then succeeds', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return calls < 2 ? res(503) : res(200); };
  const out = await sendToAlkan(items(1), { ...CFG, fetchImpl });
  assert.equal(out.ok, true);
  assert.equal(calls, 2);
});

test('does NOT retry a permanent 400 and reports failure', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return res(400); };
  const out = await sendToAlkan(items(3), { ...CFG, fetchImpl });
  assert.equal(out.ok, false);
  assert.equal(calls, 1);          // no retry on 400
  assert.equal(out.delivered, 0);
  assert.equal(out.error.code, 'http_400');
});

test('stops at the first failing batch and reports delivered-so-far', async () => {
  let call = 0;
  // First batch (50) ok, second batch fails 400.
  const fetchImpl = async () => { call += 1; return call === 1 ? res(200) : res(400); };
  const out = await sendToAlkan(items(60), { ...CFG, fetchImpl });
  assert.equal(out.ok, false);
  assert.equal(out.delivered, 50);          // first batch confirmed
  assert.equal(out.deliveredKeys.length, 50);
  assert.equal(out.error.batch, 2);
});

test('failed delivery does NOT advance the checkpoint cursor', async () => {
  const store = (() => { const m = new Map(); return { async getValue(k) { return m.get(k) ?? null; }, async setValue(k, v) { m.set(k, v); } }; })();
  const cp = new Checkpoint(store);
  await cp.load();

  const fetchImpl = async () => res(500); // always fails
  const out = await sendToAlkan(items(2), { ...CFG, fetchImpl });
  assert.equal(out.ok, false);

  // Model main.js behavior on failure: mark delivered keys processed (none here),
  // commit WITHOUT observing a new cursor.
  for (const it of items(2)) if (out.deliveredKeys.includes(it.key)) cp.markProcessed(it.key);
  await cp.commit({});
  assert.equal(cp.state.lastSourceUpdatedAt, null); // cursor NOT advanced
});

test('chunk helper splits correctly', () => {
  assert.equal(chunk(items(120)).length, 3);
  assert.equal(MAX_BATCH_SIZE, 50);
});

test('rejects a non-HTTPS ingest URL (except localhost)', () => {
  assert.throws(() => assertSecureIngestUrl('http://ingest.example/alkan'), /must use HTTPS/);
  assert.throws(() => assertSecureIngestUrl('not-a-url'), /not a valid URL/);
  assert.doesNotThrow(() => assertSecureIngestUrl('https://ingest.example/alkan'));
  assert.doesNotThrow(() => assertSecureIngestUrl('http://localhost:3000/ingest'));
  assert.doesNotThrow(() => assertSecureIngestUrl('http://127.0.0.1:3000/ingest'));
});

test('sendToAlkan refuses a plaintext ingest URL before any request', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return res(200); };
  await assert.rejects(
    () => sendToAlkan(items(1), { ...CFG, ingestUrl: 'http://ingest.example/alkan', fetchImpl }),
    /must use HTTPS/,
  );
  assert.equal(called, false); // never attempted a plaintext POST
});

test('a redirect on a signed request is treated as a failure (not followed)', async () => {
  // undici rejects with a TypeError when redirect:'error' meets a 3xx.
  const fetchImpl = async () => { throw Object.assign(new TypeError('unexpected redirect'), { name: 'TypeError' }); };
  const out = await sendToAlkan(items(2), { ...CFG, fetchImpl });
  assert.equal(out.ok, false);
  assert.equal(out.delivered, 0);
  assert.equal(out.deliveredKeys.length, 0);
});
