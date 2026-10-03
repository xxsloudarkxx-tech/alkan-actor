# alkan-finance-signal-actor

A **private** [Apify](https://apify.com) Actor that retrieves **public** Seattle
construction permit records, normalizes them, derives a transparent and fully
explainable **public project activity signal**, and (optionally) delivers safe,
signed financing‑prospect signals to ALKAN's private ingestion endpoint.

It is built in JavaScript (ESM, Node ≥ 20) to match the conventions of the
`alkan-actor` repository. It uses **only the official Socrata Open Data API** —
no browser automation, no logins, no CAPTCHA solving, no document scraping.

---

## 1. What this Actor does

- Queries the official Seattle **Building Permits** dataset (`76t5-zqzr`) through
  the Socrata JSON API, by application date and/or source update time.
- Normalizes each permit into a stable, versioned record (`schemaVersion 1.0`).
- Computes a deterministic **public project activity signal** (0–100 + band)
  where **every awarded point carries a human‑readable reason**.
- Generates **non‑factual** financing *use‑case hypotheses* (clearly marked
  `unverified_hypothesis`).
- Sanitizes records (removes contact PII unless explicitly requested; strips any
  financial/identity fields defensively).
- Deduplicates with stable hashes and keeps an incremental checkpoint.
- Optionally delivers HMAC‑signed batches to ALKAN.

## 2. What this Actor does **NOT** do

It does **not**:

- Determine creditworthiness, approve/reject financing, or estimate credit scores.
- Infer bank deposits, balances, or revenue.
- Guess that a company needs financing, or that one is a "qualified borrower".
- Scrape personal bank information, connect to Plaid, or touch any bank.
- Label a permit holder as a borrower, or expose private scoring logic publicly.
- Use the phrases *pre‑approved*, *creditworthy*, *guaranteed funding*,
  *qualified borrower*, or *likely to repay*. (A test asserts their absence.)

Product language is deliberately constrained to: *public project activity
signal*, *potential financing use case*, *ready for manual review*, and
*financial verification required*.

## 3. Official source

- **Dataset:** Building Permits — Seattle DCI
- **Dataset ID:** `76t5-zqzr`
- **Page:** https://data.seattle.gov/Built-Environment/Building-Permits/76t5-zqzr
- **API:** `https://data.seattle.gov/resource/76t5-zqzr.json`

Field names were verified against live Socrata metadata (41 columns). Only
fields that actually exist are mapped; anything absent becomes `null` with a
reason in `dataQuality.missingFields`. Notably, this dataset exposes **only**
`contractorcompanyname` as an entity — there is **no** owner/applicant/architect
field — so those are never fabricated.

## 4. Input examples

Minimal:

```json
{ "jurisdiction": "seattle" }
```

Full (defaults shown):

```json
{
  "jurisdiction": "seattle",
  "dateFrom": "2026-09-01",
  "dateTo": "2026-10-02",
  "updatedSince": null,
  "permitStatuses": [],
  "permitTypes": [],
  "tradeKeywords": ["construction","remodel","tenant improvement","commercial","roof","drywall","electrical","mechanical","concrete"],
  "minDeclaredValue": 0,
  "maxRecords": 100,
  "allowBackfill": false,
  "includeContacts": false,
  "sendToAlkan": false,
  "dryRun": true
}
```

**Validation rules:** `jurisdiction` must be `"seattle"`; `dateFrom` ≤ `dateTo`;
date range ≤ 90 days unless `allowBackfill: true`; `maxRecords` defaults to 100,
hard‑capped at 500; `minDeclaredValue` ≥ 0; invalid dates and negative amounts
are rejected. `dryRun` defaults `true`, `sendToAlkan`/`includeContacts` default
`false`.

## 5. Output example

Each dataset item is a sanitized public record (abridged):

```json
{
  "permitNumber": "7019405-CN",
  "status": "Corrections Required",
  "permitType": "Building",
  "permitClass": "Residential",
  "description": "Construct deck addition to single family residence per plans.",
  "declaredProjectValue": 12632,
  "address": { "line1": "4564 36TH AVE W", "city": "SEATTLE", "state": "WA", "postalCode": "98199", "latitude": 47.6628, "longitude": -122.4032 },
  "entityRole": "none",
  "businessContactAvailable": false,
  "publicActivityScore": 48,
  "publicActivityBand": "medium",
  "reasons": [
    { "factor": "freshness", "detail": "Most recent public activity was 0 day(s) ago.", "points": 25 },
    { "factor": "evidence", "detail": "Official permit number present (+5).", "points": 5 },
    { "factor": "declared_value", "detail": "Official declared PROJECT value of $12,632 is in the $1–$24,999 band (project value, not company revenue) (+3).", "points": 3 }
  ],
  "warnings": ["Legal entity is unresolved on the public record."],
  "possibleUseCases": [{ "label": "Use of funds not established", "status": "unverified_hypothesis" }],
  "fundingMatch": { "status": "public-signal-only", "missingFinancialVerification": ["time_in_business","average_monthly_deposits","credit_requirement","existing_obligations","authorized_applicant_identity"] },
  "financialVerificationRequired": true,
  "manualReviewRequired": true,
  "officialSourceUrl": "https://services.seattle.gov/portal/customize/LinkToRecord.aspx?altId=7019405-CN",
  "researchLinks": ["https://services.seattle.gov/portal/customize/LinkToRecord.aspx?altId=7019405-CN"],
  "observedAt": "2026-10-02T13:53:46.228Z"
}
```

A safe run summary is also written to the key‑value store key `RUN_SUMMARY`.

## 6. Dry‑run instructions

Dry‑run is the **default** (`dryRun: true`, `sendToAlkan: false`): the Actor
pushes sanitized records to the Apify dataset and never delivers to ALKAN, and
never advances the delivery checkpoint.

Local dry‑run with 10 records:

```bash
mkdir -p storage/key_value_stores/default
cat > storage/key_value_stores/default/INPUT.json <<'JSON'
{ "jurisdiction": "seattle", "dateFrom": "2026-09-01", "dateTo": "2026-10-02", "maxRecords": 10, "dryRun": true, "sendToAlkan": false }
JSON
npm start
```

Sample verified run (no token): `retrieved 10, normalized 10, delivered 0,
estimatedApiRequests 1`. Output appears under `storage/datasets/default/`.

## 7. Local development

```bash
npm install          # installs `apify` (runtime dep)
npm run lint         # syntax lint (node --check on every module)
npm test             # unit tests (Node built-in test runner; no network)
npm run test:integration   # OPT-IN live Socrata test (hits the network)
npm start            # run the Actor locally (reads storage/.../INPUT.json)
```

Tests use fixtures (`tests/fixtures/seattle-permits.json`), not live endpoints.
The one live integration test is **skipped by default** and only runs when
`RUN_SOCRATA_INTEGRATION=1` is set.

> Test runner: this Actor is kept dependency‑light (only `apify` at runtime), so
> it uses Node's built‑in `node:test` instead of adding Jest/Vitest. This is a
> deliberate deviation from the repo's root Jest setup.

## 8. Apify deployment

> Nothing is deployed automatically. Run these yourself when ready.

```bash
npm install -g apify-cli     # if not installed
apify login
# from this directory:
apify push                   # builds the Docker image and uploads the Actor
```

Then, in the Apify Console, set the **secret environment variables** (Section 9)
and keep the Actor **private**.

## Apify deployment from Git

This Actor lives in the `alkan-finance-signal-actor/` **subdirectory** of a larger
repository. When deploying from Git, Apify must be pointed at that subdirectory —
**not** the repository root.

### Testing the pull-request branch

Use this Git source URL:

```
https://github.com/xxsloudarkxx-tech/alkan-actor#feature/alkan-finance-signal-actor-pr:alkan-finance-signal-actor
```

In this URL (the part after `#` is `branch:subdirectory`):

- `feature/alkan-finance-signal-actor-pr` is the Git branch.
- `alkan-finance-signal-actor` is the source subdirectory **and** the Docker build
  context.
- Selecting the repository **root is incorrect** — the root is not an Actor.
- A correct build uses `alkan-finance-signal-actor/Dockerfile` (base image
  `apify/actor-node:20`, dependencies installed with **npm**).
- A correct run starts `node src/main.js` (the Actor entry point).
- The build/run logs **must not** show Next.js, `pnpm`, `next.config.ts`, or
  `localhost:3000`. Those indicate Apify is building the wrong source (the
  repository root) rather than this subdirectory.

### After merging to main

Once the pull request is merged, use:

```
https://github.com/xxsloudarkxx-tech/alkan-actor#main:alkan-finance-signal-actor
```

Only the **branch segment** changes (`feature/alkan-finance-signal-actor-pr` →
`main`); the `:alkan-finance-signal-actor` subdirectory stays the same.

### Safe first run

Trigger a **newly created build** and run it with exactly this input:

```json
{
  "allowBackfill": false,
  "dateFrom": "2026-09-25",
  "dateTo": "2026-10-02",
  "dryRun": true,
  "includeContacts": false,
  "jurisdiction": "seattle",
  "maxRecords": 10,
  "sendToAlkan": false
}
```

This run:

- retrieves at most **10** public records;
- does **not** include contacts;
- does **not** deliver records to ALKAN;
- does **not** perform a backfill;
- must use a **newly created build** (so the corrected Git source takes effect).

### Troubleshooting

If the logs show **Next.js**, **pnpm**, **`next.config.ts`**, or
**`localhost:3000`**, stop the run and correct the Git source URL so it targets
the `alkan-finance-signal-actor` subdirectory (as shown above). Do **not** install
pnpm and do **not** modify the repository-root application.

## 9. Required secrets

Set these as Actor **secret environment variables** (never in run input, never
committed). See `.env.example`.

| Variable | Required for | Notes |
|---|---|---|
| `SOCRATA_APP_TOKEN` | Higher rate limits | Optional; the Actor works without it at low volume. Sent as the `X-App-Token` header, never in the query string. |
| `ALKAN_INGEST_URL` | Delivery | HTTPS endpoint. If missing → stays in dry‑run. |
| `ALKAN_WEBHOOK_SECRET` | Delivery | HMAC key. If missing → stays in dry‑run. |
| `ALKAN_TENANT_ID` | Delivery | Sent as `X-Alkan-Tenant`. |
| `ENABLE_AI_ENRICHMENT` | (future) | Must be `false`; no paid AI calls in this version. |

Secrets are never logged, never placed in query strings, and never written to a
dataset. If `ALKAN_INGEST_URL` or `ALKAN_WEBHOOK_SECRET` is missing while
delivery is requested, the Actor emits a safe warning and continues in dry‑run.

## 10. Incremental‑run behavior

State is stored in the Actor key‑value store (`INCREMENTAL_STATE`):

- `lastSourceUpdatedAt` — cursor; advanced **only** after processing **and**
  required delivery succeed.
- `lastOffset` — last completed page offset (safe resume).
- `processed` — event hashes seen within a bounded retention window (30 days,
  capped at 50k entries, pruned on load/commit).

Modes:

- **Fresh run** — provide `dateFrom`/`dateTo`.
- **Incremental run** — omit the date window; the stored cursor is used as
  `updatedSince`.
- **Explicit backfill** — set `allowBackfill: true` for a > 90‑day window.
- **Safe retry after partial failure** — confirmed‑delivered batches are
  recorded so a 2xx record is never resent; a failed delivery **fails the run
  and does not advance the cursor**.

## 11. Webhook signature verification

Each delivery request carries:

```
Content-Type: application/json
X-Alkan-Tenant: <ALKAN_TENANT_ID>
X-Alkan-Timestamp: <unix seconds>
X-Alkan-Signature: <hex HMAC-SHA256>
```

The signature is `HMAC_SHA256(secret, "<timestamp>.<rawBody>")`, hex‑encoded.

**Receiving backend (Node / TypeScript) verification example:**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_SKEW_SECONDS = 300; // reject stale/replayed requests

export function verifyAlkanSignature(opts: {
  rawBody: string;              // the EXACT raw request body bytes, pre-JSON.parse
  secret: string;              // ALKAN_WEBHOOK_SECRET
  timestampHeader: string;     // X-Alkan-Timestamp
  signatureHeader: string;     // X-Alkan-Signature
}): boolean {
  const ts = Number(opts.timestampHeader);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > MAX_SKEW_SECONDS) return false;

  const expected = createHmac('sha256', opts.secret)
    .update(`${ts}.${opts.rawBody}`, 'utf8')
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(opts.signatureHeader ?? '', 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
```

> Capture the **raw** body before parsing (e.g. `express.raw({ type: '*/*' })`),
> because re‑serializing parsed JSON can change bytes and break the signature.

The payload shape is:

```json
{ "event": "public_finance_signals.discovered", "schemaVersion": "1.0", "runId": "...", "source": "seattle_open_data", "generatedAt": "...", "records": [] }
```

## 12. Data retention limitations

- Dedupe hashes are retained for ~30 days (bounded window, 50k cap) — long‑term
  dedupe across months is not guaranteed; rely on the `lastSourceUpdatedAt`
  cursor for incremental correctness.
- The Actor stores no PII beyond what the public permit exposes, and only when
  `includeContacts: true`.
- The public Apify dataset is sanitized; it never contains bank data, credit
  scores, tax IDs, SSNs, Plaid tokens, or private scoring logic.

## 13. Financial and legal disclaimer

This Actor produces **public‑records intelligence only**. The *public project
activity signal* is **not** a credit score, not an offer of credit, and not a
statement that any person or business needs or qualifies for financing. Nothing
here constitutes personalized financial or investment advice. All financing
decisions require independent **financial verification** and **manual review**.
Use of public permit data must comply with the data provider's terms and
applicable fair‑lending, privacy, and consumer‑protection laws.

## 14. How this Actor connects to ALKAN

When `sendToAlkan: true` **and** `dryRun: false` **and** both `ALKAN_INGEST_URL`
and `ALKAN_WEBHOOK_SECRET` are set, sanitized records are POSTed to
`ALKAN_INGEST_URL` in HMAC‑signed batches (≤ 50 records, 15s timeout, transient
retries only). The default dataset always receives the sanitized public records
regardless of delivery. This is a separate, additive pipeline — it does not
modify the existing Accela enrichment Actor or any production schema.

## 15. Why the activity signal is not a credit score

The score is a **transparent sum of public‑project factors** — record freshness,
evidence completeness, declared *project* value, identified business role, and
construction scope — each contributing points with an attached reason. It uses
**no** financial, behavioral, or protected‑class data; it cannot and does not
estimate repayment probability or creditworthiness. `declaredProjectValue` is a
project cost, explicitly **not** company revenue.

## 16. Known limitations of permit information

- The dataset lists only the **contractor** entity; owners/applicants/architects
  are not present and are never inferred.
- Declared value (`estprojectcost`) is self‑reported and sometimes absent or `0`.
- Contractor license is **not** verified (no L&I lookup in this version) — a
  warning is emitted whenever a GC is named.
- Status/date semantics vary; "freshness" uses the most recent of source update,
  issue, or application date.
- Public/institutional projects are flagged but not excluded.

## 17. Adding Tacoma later (as a separate source adapter)

1. Create `src/sources/tacoma-building-permits.js` exporting the **same shape**
   as the Seattle adapter: `fetchPermits(input, deps)` plus `SOURCE_SYSTEM`,
   `DATASET_ID`, `JURISDICTION_LABEL`, and a `researchLinkFor()`.
2. Verify the real Tacoma dataset ID and **actual field names** against live
   metadata before mapping (do not guess — the repo's `wa-feeds.js` documents
   this "verify before enabling" rule).
3. Add a `normalize-permit` variant or parameterize the field map; keep role
   separation identical.
4. Register `"tacoma"` in `src/util/validate.js` (`SUPPORTED_JURISDICTIONS`) and
   branch by jurisdiction in `src/main.js`.
5. **Do not** overload the Seattle adapter — one adapter per jurisdiction.

---

### Repository fit

This Actor is self‑contained (so Apify can deploy its directory), and mirrors the
established patterns in `alkan-actor` — PII‑scrubbing logger, backoff‑with‑jitter
HTTP, typed errors, and the verified Socrata field mappings from
`src/sources/wa-feeds.js`. It adds a new pipeline without modifying the existing
Accela enrichment Actor, Supabase schemas, or any production data.
