import { test } from 'node:test';
import assert from 'node:assert/strict';

import { requestWithRetry, parseRetryAfter, computeBackoff } from '../src/util/http.js';

const noSleep = async () => {};
function res(status, { body = '[]', retryAfter = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? retryAfter : null) },
    async json() { return JSON.parse(body); },
    async text() { return body; },
  };
}

test('retries 503 then succeeds on 200', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return calls < 3 ? res(503) : res(200, { body: '[{"ok":true}]' }); };
  const { response, requests } = await requestWithRetry('http://x', { fetchImpl, sleepImpl: noSleep, maxRetries: 4 });
  assert.equal(response.ok, true);
  assert.equal(calls, 3);
  assert.equal(requests, 3);
});

test('retries 429 (rate limited) then succeeds', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return calls < 2 ? res(429, { retryAfter: '0' }) : res(200); };
  const { response } = await requestWithRetry('http://x', { fetchImpl, sleepImpl: noSleep, maxRetries: 4 });
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test('does NOT retry a permanent 400', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return res(400); };
  const { response, requests } = await requestWithRetry('http://x', { fetchImpl, sleepImpl: noSleep, maxRetries: 4 });
  assert.equal(response.status, 400);
  assert.equal(calls, 1);
  assert.equal(requests, 1);
});

test('returns the last response after exhausting retries on 503', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return res(503); };
  const { response, attempts } = await requestWithRetry('http://x', { fetchImpl, sleepImpl: noSleep, maxRetries: 2 });
  assert.equal(response.status, 503);
  assert.equal(calls, 3);   // 1 initial + 2 retries
  assert.equal(attempts, 3);
});

test('recovers from a transient network error', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; if (calls === 1) throw new Error('ECONNRESET'); return res(200); };
  const { response, error } = await requestWithRetry('http://x', { fetchImpl, sleepImpl: noSleep, maxRetries: 2 });
  assert.equal(error, null);
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test('surfaces an error after exhausting retries on network failure', async () => {
  const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const fetchImpl = async () => { throw err; };
  const { response, error } = await requestWithRetry('http://x', { fetchImpl, sleepImpl: noSleep, maxRetries: 1 });
  assert.equal(response, null);
  assert.equal(error.name, 'AbortError');
});

test('parseRetryAfter handles seconds and HTTP dates', () => {
  assert.equal(parseRetryAfter('5'), 5000);
  const now = Date.now();
  const future = new Date(now + 2000).toUTCString();
  const ms = parseRetryAfter(future, now);
  assert.ok(ms >= 0 && ms <= 2000);
  assert.equal(parseRetryAfter(null), null);
});

test('computeBackoff grows and stays within jitter bounds', () => {
  const b0 = computeBackoff(0, 500, () => 0.5);   // 500 * 1 * (0.8+0.2)=500
  const b2 = computeBackoff(2, 500, () => 0.5);   // 500 * 4 = 2000
  assert.ok(b2 > b0);
  const low = computeBackoff(0, 1000, () => 0);   // 0.8x
  const high = computeBackoff(0, 1000, () => 1);  // 1.2x
  assert.equal(low, 800);
  assert.equal(high, 1200);
});
