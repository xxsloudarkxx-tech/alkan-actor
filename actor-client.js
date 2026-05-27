/**
 * actor-client.js — Alkan Lead Hunter client for the alkan-actor enrichment service.
 *
 * Include this file with:
 *   <script src="actor-client.js"></script>
 * AFTER config.js is loaded.
 *
 * Exposes on window:
 *   actorEnrich(permitNumber, jurisdiction) → Promise<EnrichResult>
 *   actorEnrichBatch(leads[])              → Promise<BatchResult>
 *   actorHealth()                          → Promise<boolean>
 *   purgeLocalStorageDemoLeads()           → void
 */
(function () {
  'use strict';

  const cfg = () => window.ALKAN_CONFIG ?? {};

  // ── Enrichment state store (in-memory; mirrored to localStorage) ────────────

  const STORAGE_KEY = 'alkan_enrichment';

  function loadEnrichmentStore() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    } catch {
      return {};
    }
  }

  function saveEnrichmentStore(store) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch { /* quota exceeded — non-fatal */ }
  }

  // store: { [permit_number]: { status, data, error, enriched_at } }
  const store = loadEnrichmentStore();

  function setLeadEnrichment(permitNumber, patch) {
    store[permitNumber] = Object.assign(store[permitNumber] ?? {}, patch);
    saveEnrichmentStore(store);
    window.dispatchEvent(
      new CustomEvent('alkan:enrichment-update', {
        detail: { permitNumber, state: store[permitNumber] },
      })
    );
  }

  function getLeadEnrichment(permitNumber) {
    return store[permitNumber] ?? { status: 'idle', data: null, error: null, enriched_at: null };
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────────

  async function actorFetch(method, path, body, retryOn429 = true) {
    const base = (cfg().ACTOR_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
    const key  = cfg().ACTOR_API_KEY ?? '';

    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
      },
    };
    if (body) opts.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(`${base}${path}`, opts);
    } catch (networkErr) {
      throw Object.assign(new Error('Network error reaching actor'), { code: 'network_error' });
    }

    if (res.status === 429 && retryOn429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '30', 10) * 1000;
      await new Promise((r) => setTimeout(r, retryAfter));
      return actorFetch(method, path, body, false); // one retry
    }

    if (res.status === 500) {
      // Single 3s retry on server error
      await new Promise((r) => setTimeout(r, 3000));
      return actorFetch(method, path, body, false);
    }

    return res;
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Enrich a single permit. Updates the enrichment store and fires
   * 'alkan:enrichment-update' events during the lifecycle.
   *
   * @param {string} permitNumber
   * @param {string} jurisdiction
   * @returns {Promise<{success: boolean, data?: object, error?: string}>}
   */
  async function actorEnrich(permitNumber, jurisdiction) {
    if (!cfg().ACTOR_BASE_URL) {
      return { success: false, error: 'actor_not_configured' };
    }

    // Guard: skip demo leads
    if (String(permitNumber).startsWith('demo_')) {
      return { success: false, error: 'skipped_demo_lead' };
    }

    setLeadEnrichment(permitNumber, { status: 'pending', error: null });

    try {
      const res = await actorFetch('POST', '/enrich', { permit_number: permitNumber, jurisdiction });

      if (!res.ok && res.status !== 200) {
        throw Object.assign(new Error(`HTTP ${res.status}`), { code: `http_${res.status}` });
      }

      const json = await res.json();

      if (json.success) {
        setLeadEnrichment(permitNumber, {
          status: 'success',
          data: json.data,
          error: null,
          enriched_at: json.scraped_at ?? new Date().toISOString(),
        });
      } else {
        setLeadEnrichment(permitNumber, {
          status: 'failed',
          error: json.error ?? 'unknown',
          data: null,
        });
      }

      return json;
    } catch (err) {
      setLeadEnrichment(permitNumber, {
        status: 'failed',
        error: err.code ?? 'network_error',
        data: null,
      });
      return { success: false, error: err.code ?? 'network_error' };
    }
  }

  /**
   * Enrich multiple permits (for Bulk Enrich button).
   * Sends one POST /enrich/batch request; the actor handles sequential rate limiting.
   *
   * @param {{ permit_number: string, jurisdiction: string }[]} leads
   * @returns {Promise<{results: object[]}>}
   */
  async function actorEnrichBatch(leads) {
    if (!cfg().ACTOR_BASE_URL) {
      return { results: leads.map((l) => ({ success: false, error: 'actor_not_configured', ...l })) };
    }

    // Mark all as pending immediately
    for (const l of leads) {
      if (!String(l.permit_number).startsWith('demo_')) {
        setLeadEnrichment(l.permit_number, { status: 'pending', error: null });
      }
    }

    try {
      const filteredLeads = leads.filter((l) => !String(l.permit_number).startsWith('demo_'));
      const res = await actorFetch('POST', '/enrich/batch', { leads: filteredLeads });
      const json = await res.json();

      for (const r of json.results ?? []) {
        if (r.success) {
          setLeadEnrichment(r.permit_number, {
            status: 'success',
            data: r.data,
            error: null,
            enriched_at: r.scraped_at ?? new Date().toISOString(),
          });
        } else {
          setLeadEnrichment(r.permit_number, {
            status: 'failed',
            error: r.error ?? 'unknown',
            data: null,
          });
        }
      }

      return json;
    } catch (err) {
      for (const l of leads) {
        setLeadEnrichment(l.permit_number, { status: 'failed', error: 'network_error' });
      }
      return { results: [] };
    }
  }

  /**
   * Health check — returns true if the actor is reachable.
   * @returns {Promise<boolean>}
   */
  async function actorHealth() {
    try {
      const base = (cfg().ACTOR_BASE_URL ?? '').replace(/\/$/, '');
      if (!base) return false;
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Purges demo leads (id starting with 'demo_') from localStorage.
   * Called on app init when DEMO_MODE === false.
   */
  function purgeLocalStorageDemoLeads() {
    const purgedKey = 'alkan_demo_purge_done';
    if (localStorage.getItem(purgedKey)) return;

    const raw = localStorage.getItem('alkan_leads');
    if (raw) {
      try {
        const leads = JSON.parse(raw);
        const cleaned = leads.filter((l) => !String(l.id ?? '').startsWith('demo_'));
        const removed = leads.length - cleaned.length;
        if (removed > 0) {
          localStorage.setItem('alkan_leads', JSON.stringify(cleaned));
          console.log(`[alkan] Purged ${removed} demo lead(s) from localStorage`);
        }
      } catch { /* corrupt JSON — leave as is */ }
    }

    localStorage.setItem(purgedKey, '1');
  }

  /**
   * Returns the enrichment state for a permit number.
   * @param {string} permitNumber
   * @returns {{ status: string, data: object|null, error: string|null, enriched_at: string|null }}
   */
  function getEnrichmentState(permitNumber) {
    return getLeadEnrichment(permitNumber);
  }

  // ── Demo mode init ───────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    if (!cfg().DEMO_MODE) {
      // Hide Re-seed button
      const btn = document.getElementById('btn-reseed-demo');
      if (btn) btn.style.display = 'none';

      // Purge any lingering demo leads
      purgeLocalStorageDemoLeads();
    }
  });

  // ── Expose on window ─────────────────────────────────────────────────────────
  window.actorEnrich            = actorEnrich;
  window.actorEnrichBatch       = actorEnrichBatch;
  window.actorHealth            = actorHealth;
  window.purgeLocalStorageDemoLeads = purgeLocalStorageDemoLeads;
  window.getEnrichmentState     = getEnrichmentState;
})();
