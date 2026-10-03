/**
 * checkpoint.js — incremental state in the Actor key-value store.
 *
 * Stores:
 *  - lastSourceUpdatedAt : last successfully processed+delivered source update ts
 *  - lastOffset          : last completed page offset (for safe resume)
 *  - processed           : { hash: epochMs } seen within the retention window
 *
 * The checkpoint is advanced ONLY after processing AND any required delivery
 * complete — never mid-run. This makes retries after partial failure safe.
 *
 * `store` is any object with async getValue(key) / setValue(key, value), e.g.
 * an Apify KeyValueStore. It is injectable for tests (see tests/dedupe.test.js).
 */

const STATE_KEY = 'INCREMENTAL_STATE';
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_PROCESSED_ENTRIES = 50_000;

export class Checkpoint {
  /**
   * @param {{ getValue: Function, setValue: Function }} store
   * @param {Object} [opts]
   * @param {number} [opts.retentionMs]
   * @param {number} [opts.now] fixed clock for tests
   */
  constructor(store, opts = {}) {
    this.store = store;
    this.retentionMs = opts.retentionMs ?? DEFAULT_RETENTION_MS;
    this._now = opts.now ?? null;
    this.state = { lastSourceUpdatedAt: null, lastOffset: 0, processed: {} };
    this._committedProcessedCount = 0;
  }

  now() {
    return this._now ?? Date.now();
  }

  async load() {
    const stored = await this.store.getValue(STATE_KEY);
    if (stored && typeof stored === 'object') {
      this.state = {
        lastSourceUpdatedAt: stored.lastSourceUpdatedAt ?? null,
        lastOffset: stored.lastOffset ?? 0,
        processed: stored.processed ?? {},
      };
    }
    this._prune();
    return this.state;
  }

  _prune() {
    const cutoff = this.now() - this.retentionMs;
    const entries = Object.entries(this.state.processed)
      .filter(([, ts]) => ts >= cutoff)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_PROCESSED_ENTRIES);
    this.state.processed = Object.fromEntries(entries);
  }

  isProcessed(hash) {
    return Object.prototype.hasOwnProperty.call(this.state.processed, hash);
  }

  /** Record a hash as processed in the in-memory window (not yet persisted). */
  markProcessed(hash) {
    this.state.processed[hash] = this.now();
  }

  /** The newest source-update timestamp seen this run, for advancing the cursor. */
  observeSourceUpdatedAt(ts) {
    if (!ts) return;
    if (!this.state.lastSourceUpdatedAt || new Date(ts) > new Date(this.state.lastSourceUpdatedAt)) {
      this._pendingSourceUpdatedAt = ts;
    }
  }

  /**
   * Persist the checkpoint. Call ONLY after processing + required delivery
   * succeed. Advances lastSourceUpdatedAt to the newest observed value.
   * @param {{ lastOffset?: number }} [opts]
   */
  async commit({ lastOffset } = {}) {
    if (this._pendingSourceUpdatedAt) {
      this.state.lastSourceUpdatedAt = this._pendingSourceUpdatedAt;
    }
    if (typeof lastOffset === 'number') this.state.lastOffset = lastOffset;
    this._prune();
    await this.store.setValue(STATE_KEY, this.state);
    this._committedProcessedCount = Object.keys(this.state.processed).length;
    return this.state;
  }
}

export const CHECKPOINT_CONSTANTS = { STATE_KEY, DEFAULT_RETENTION_MS, MAX_PROCESSED_ENTRIES };
