-- =============================================================================
-- Alkan Lead Hunter — Migration v2: Permit & Enrichment columns
-- Run in Supabase SQL Editor AFTER supabase-migration.sql (v1)
-- Safe to run multiple times — all statements use IF NOT EXISTS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Add permit_number and jurisdiction columns
-- These allow the actor enrichment service to look up the permit
-- -----------------------------------------------------------------------------

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS permit_number TEXT,
  ADD COLUMN IF NOT EXISTS jurisdiction  TEXT DEFAULT 'seattle';

CREATE INDEX IF NOT EXISTS idx_leads_permit_number ON leads (permit_number)
  WHERE permit_number IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Optional: enrichment cache columns
-- These store the last actor result directly in Supabase so data survives
-- browser refreshes and is visible to all team members (not just localStorage)
-- NOTE: enrichment_data is a JSONB blob from the actor's /enrich response
-- -----------------------------------------------------------------------------

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS score           SMALLINT,
  ADD COLUMN IF NOT EXISTS golden_lead     BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS enrichment_data JSONB,
  ADD COLUMN IF NOT EXISTS enriched_at     TIMESTAMPTZ;

-- -----------------------------------------------------------------------------
-- Verify: check your columns
-- -----------------------------------------------------------------------------

-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'leads'
-- ORDER BY ordinal_position;
