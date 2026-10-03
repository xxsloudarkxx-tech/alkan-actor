/**
 * main.js — entry point for alkan-finance-signal-actor.
 *
 * Flow:
 *   1. Read + validate input (safe defaults: dryRun=true, sendToAlkan=false).
 *   2. Read secrets from the environment (never from input, never logged).
 *   3. Load incremental checkpoint; derive updatedSince for incremental runs.
 *   4. Retrieve public Seattle permits via the official Socrata API.
 *   5. Normalize → client-side filter → dedupe → build signal + funding match.
 *   6. Push sanitized records to the Apify dataset.
 *   7. If (sendToAlkan && !dryRun && secrets present): deliver signed batches.
 *      Advance the checkpoint ONLY after delivery succeeds.
 *   8. Emit a safe run summary (no PII, no secrets, no full records).
 */

import { Actor } from 'apify';
import { randomUUID } from 'node:crypto';

import { validateInput } from './util/validate.js';
import { logger } from './util/logger.js';
import { fetchPermits, SOURCE_SYSTEM } from './sources/seattle-building-permits.js';
import { normalizePermit } from './normalization/normalize-permit.js';
import { buildFinanceSignal } from './signals/build-finance-signal.js';
import { classifyProjectStage } from './signals/project-stage.js';
import { buildProspectReadiness } from './signals/prospect-readiness.js';
import { extractRelatedProject } from './signals/related-project.js';
import { buildFundingMatch } from './matching/funding-programs.js';
import { buildDatasetRecord, buildDeliveryRecord } from './sanitize/sanitize-record.js';
import { keysForNormalized } from './state/dedupe.js';
import { Checkpoint } from './state/checkpoint.js';
import { sendToAlkan, assertSecureIngestUrl } from './delivery/send-to-alkan.js';
import { isAiEnrichmentEnabled } from './enrichment/ai-enrichment.js';
import { ROLES } from './normalization/contacts.js';

function matchesStatusFilter(normalized, statuses) {
  if (!statuses.length) return true;
  const s = (normalized.permit.status ?? '').toLowerCase();
  return statuses.some((f) => s.includes(String(f).toLowerCase()));
}

function matchesTypeFilter(normalized, types) {
  if (!types.length) return true;
  const t = `${normalized.permit.permitType ?? ''} ${normalized.permit.permitClass ?? ''}`.toLowerCase();
  return types.some((f) => t.includes(String(f).toLowerCase()));
}

async function run() {
  const startedAt = Date.now();
  await Actor.init();

  const rawInput = (await Actor.getInput()) ?? {};
  const input = validateInput(rawInput);
  logger.info('Input validated', {
    jurisdiction: input.jurisdiction,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    updatedSince: input.updatedSince,
    maxRecords: input.maxRecords,
    includeContacts: input.includeContacts,
    sendToAlkan: input.sendToAlkan,
    dryRun: input.dryRun,
  });

  if (isAiEnrichmentEnabled()) {
    logger.warning('ENABLE_AI_ENRICHMENT=true but AI enrichment is not implemented in this version; skipping (no paid API calls).');
  }

  // ── Secrets (environment only) ──────────────────────────────────────────────
  const appToken = process.env.SOCRATA_APP_TOKEN || undefined;
  const ingestUrl = process.env.ALKAN_INGEST_URL || '';
  const webhookSecret = process.env.ALKAN_WEBHOOK_SECRET || '';
  const tenantId = process.env.ALKAN_TENANT_ID || '';

  // ── Delivery eligibility ────────────────────────────────────────────────────
  let deliveryEligible = input.sendToAlkan && !input.dryRun;
  if (deliveryEligible && (!ingestUrl || !webhookSecret)) {
    logger.warning('Delivery requested but ALKAN_INGEST_URL or ALKAN_WEBHOOK_SECRET is missing — continuing in dry-run (no delivery).');
    deliveryEligible = false;
  }
  if (deliveryEligible) {
    try {
      assertSecureIngestUrl(ingestUrl);
    } catch (err) {
      logger.warning(`Delivery disabled: ${err.message} — continuing in dry-run (no delivery).`);
      deliveryEligible = false;
    }
  }
  if (!appToken) {
    logger.info('SOCRATA_APP_TOKEN not set — using anonymous low-volume access.');
  }

  // ── Checkpoint / incremental cursor ─────────────────────────────────────────
  const kvStore = await Actor.openKeyValueStore();
  const checkpoint = new Checkpoint(kvStore);
  await checkpoint.load();

  const hasDateWindow = Boolean(input.dateFrom || input.dateTo);
  const effectiveUpdatedSince = input.updatedSince
    ?? (hasDateWindow ? null : checkpoint.state.lastSourceUpdatedAt);
  if (effectiveUpdatedSince && !input.updatedSince && !hasDateWindow) {
    logger.info('Incremental run using stored checkpoint cursor.');
  }

  // ── Retrieve ────────────────────────────────────────────────────────────────
  const { rows, estimatedApiRequests } = await fetchPermits(
    { ...input, updatedSince: effectiveUpdatedSince },
    { appToken },
  );

  // ── Process ─────────────────────────────────────────────────────────────────
  const observedAt = new Date().toISOString();
  const seenEventKeys = new Set(); // in-run dedupe
  const deliveryItems = [];
  const summary = {
    retrieved: rows.length,
    normalized: 0,
    duplicatesSkipped: 0,
    highActivity: 0,
    mediumActivity: 0,
    lowActivity: 0,
    missingEntity: 0,
    unclearRole: 0,
    identifiableBusiness: 0,
    researchRequired: 0,
    notActionable: 0,
    delivered: 0,
    deliveryFailed: 0,
    estimatedApiRequests,
    durationMs: 0,
  };

  for (const row of rows) {
    const normalized = normalizePermit(row, { observedAt });

    // Client-side filters.
    if (normalized.permit.declaredValue !== null && normalized.permit.declaredValue < input.minDeclaredValue) continue;
    if (input.minDeclaredValue > 0 && normalized.permit.declaredValue === null) continue;
    if (!matchesStatusFilter(normalized, input.permitStatuses)) continue;
    if (!matchesTypeFilter(normalized, input.permitTypes)) continue;

    const { eventKey } = keysForNormalized(normalized, input.jurisdiction);

    // In-run dedupe (criterion: two identical source records → one event).
    if (seenEventKeys.has(eventKey)) { summary.duplicatesSkipped += 1; continue; }
    seenEventKeys.add(eventKey);

    // Cross-run dedupe (only meaningful when we persist a checkpoint, i.e. delivery mode).
    if (deliveryEligible && checkpoint.isProcessed(eventKey)) { summary.duplicatesSkipped += 1; continue; }

    const signal = buildFinanceSignal(normalized, { observedAt, tradeKeywords: input.tradeKeywords });
    const fundingMatch = buildFundingMatch(normalized);

    // Deterministic lifecycle stage + prospect readiness (both SEPARATE from the
    // public activity score; neither is a credit/financing conclusion).
    const stage = classifyProjectStage(normalized.permit.status);
    for (const w of stage.warnings) if (!signal.warnings.includes(w)) signal.warnings.push(w);
    const prospectReadiness = buildProspectReadiness(normalized, { projectStage: stage.stage });
    const relatedProject = extractRelatedProject(normalized);
    const extras = { projectStage: stage.stage, prospectReadiness, relatedProject };

    // Stats.
    summary.normalized += 1;
    if (signal.band === 'high') summary.highActivity += 1;
    else if (signal.band === 'medium') summary.mediumActivity += 1;
    else summary.lowActivity += 1;
    if (!normalized.entities.contractorName && !normalized.entities.applicantOrganization) summary.missingEntity += 1;
    if ((normalized.contacts ?? []).some((c) => c.role === ROLES.UNKNOWN)) summary.unclearRole += 1;
    if (prospectReadiness.status === 'identifiable_business') summary.identifiableBusiness += 1;
    else if (prospectReadiness.status === 'research_required') summary.researchRequired += 1;
    else summary.notActionable += 1;

    // Dataset (sanitized public record).
    const datasetRecord = buildDatasetRecord(normalized, signal, fundingMatch, input.includeContacts, extras);
    await Actor.pushData(datasetRecord);

    // Queue for delivery.
    const deliveryRecord = buildDeliveryRecord(normalized, signal, fundingMatch, input.includeContacts, extras);
    deliveryItems.push({ key: eventKey, record: deliveryRecord, sourceUpdatedAt: normalized.source.sourceUpdatedAt });
  }

  // ── Delivery ────────────────────────────────────────────────────────────────
  if (deliveryEligible && deliveryItems.length > 0) {
    const runId = Actor.getEnv()?.actorRunId ?? process.env.APIFY_ACTOR_RUN_ID ?? randomUUID();
    const result = await sendToAlkan(deliveryItems, {
      ingestUrl, secret: webhookSecret, tenantId, runId, source: SOURCE_SYSTEM,
    });

    summary.delivered = result.delivered;
    summary.deliveryFailed = result.failed;

    // Mark delivered keys processed so confirmed 2xx records are never resent.
    const deliveredSet = new Set(result.deliveredKeys);
    for (const it of deliveryItems) {
      if (deliveredSet.has(it.key)) checkpoint.markProcessed(it.key);
    }

    if (!result.ok) {
      // Persist processed hashes (dedupe) but DO NOT advance the cursor.
      await checkpoint.commit({}); // commit without observing newest cursor
      summary.durationMs = Date.now() - startedAt;
      logger.error('Run summary (delivery failed)', summary);
      await Actor.setValue('RUN_SUMMARY', summary);
      // Fail the run — do not advance the successful checkpoint.
      throw new Error(`ALKAN delivery failed on batch ${result.error?.batch} (${result.error?.code}). Checkpoint cursor not advanced.`);
    }

    // Success: advance the cursor to the newest delivered source update.
    for (const it of deliveryItems) {
      if (deliveredSet.has(it.key)) checkpoint.observeSourceUpdatedAt(it.sourceUpdatedAt);
    }
    await checkpoint.commit({});
    logger.info('Checkpoint advanced after successful delivery.');
  } else if (deliveryEligible) {
    logger.info('No records to deliver.');
  } else {
    logger.info('Dry-run (or delivery not configured): pushed to dataset only, checkpoint not advanced.');
  }

  summary.durationMs = Date.now() - startedAt;
  logger.info('Run summary', summary);
  await Actor.setValue('RUN_SUMMARY', summary);

  await Actor.exit();
}

run().catch(async (err) => {
  // Never include secrets; message is already safe.
  logger.error(`Actor failed: ${err.message}`);
  await Actor.fail(`Actor failed: ${err.message}`);
});
