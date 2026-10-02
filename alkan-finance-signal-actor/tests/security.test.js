import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { signPayload, buildSignedHeaders, verifySignature } from '../src/security/sign-payload.js';
import { scrub } from '../src/util/logger.js';

const SECRET = 'test-webhook-secret';
const BODY = JSON.stringify({ event: 'public_finance_signals.discovered', records: [{ permitNumber: 'X' }] });
const TS = 1_759_000_000;

test('signPayload matches an independent HMAC-SHA256 over `timestamp.body`', () => {
  const expected = createHmac('sha256', SECRET).update(`${TS}.${BODY}`, 'utf8').digest('hex');
  assert.equal(signPayload(BODY, SECRET, TS), expected);
});

test('signature changes when the body changes', () => {
  const a = signPayload(BODY, SECRET, TS);
  const b = signPayload(`${BODY} `, SECRET, TS);
  assert.notEqual(a, b);
});

test('verifySignature accepts a correct signature and rejects a wrong one', () => {
  const sigHex = signPayload(BODY, SECRET, TS);
  assert.equal(verifySignature({ rawBody: BODY, secret: SECRET, timestamp: TS, signature: sigHex }), true);
  assert.equal(verifySignature({ rawBody: BODY, secret: SECRET, timestamp: TS, signature: 'deadbeef' }), false);
  assert.equal(verifySignature({ rawBody: BODY, secret: 'wrong', timestamp: TS, signature: sigHex }), false);
});

test('buildSignedHeaders includes required ALKAN headers', () => {
  const h = buildSignedHeaders({ rawBody: BODY, secret: SECRET, tenantId: 'tenant-123', timestamp: TS });
  assert.equal(h['Content-Type'], 'application/json');
  assert.equal(h['X-Alkan-Tenant'], 'tenant-123');
  assert.equal(h['X-Alkan-Timestamp'], String(TS));
  assert.equal(h['X-Alkan-Signature'], signPayload(BODY, SECRET, TS));
});

test('signPayload throws without a secret (never signs with empty secret)', () => {
  assert.throws(() => signPayload(BODY, '', TS));
});

test('logger scrubbing redacts secret and signature keys', () => {
  const scrubbed = scrub({
    secret: 'super-secret',
    token: 'abc',
    signature: 'deadbeef',
    nested: { api_key: 'k', safe: 'ok' },
    status: 200,
  });
  assert.equal(scrubbed.secret, '[REDACTED]');
  assert.equal(scrubbed.token, '[REDACTED]');
  assert.equal(scrubbed.signature, '[REDACTED]');
  assert.equal(scrubbed.nested.api_key, '[REDACTED]');
  assert.equal(scrubbed.nested.safe, 'ok');
  assert.equal(scrubbed.status, 200);
});
