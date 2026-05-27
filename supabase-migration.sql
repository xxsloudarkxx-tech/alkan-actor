-- =============================================================================
-- Alkan Lead Hunter — Supabase Migration
-- Run these statements in order in the Supabase SQL Editor
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1: Add columns to the existing 'leads' table
-- (Safe to run multiple times — uses IF NOT EXISTS)
-- -----------------------------------------------------------------------------

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS client_id  TEXT        NOT NULL DEFAULT 'envision_builders',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Create an index for fast per-client queries
CREATE INDEX IF NOT EXISTS idx_leads_client_id ON leads (client_id);

-- -----------------------------------------------------------------------------
-- STEP 2: Backfill existing rows
-- Set all existing rows to 'envision_builders' (the original single client)
-- -----------------------------------------------------------------------------

UPDATE leads
SET client_id = 'envision_builders'
WHERE client_id = '' OR client_id IS NULL;

-- -----------------------------------------------------------------------------
-- STEP 3: Lock down the column after backfill
-- Remove the default so new inserts MUST supply client_id explicitly
-- Add a check constraint so empty strings are rejected
-- -----------------------------------------------------------------------------

ALTER TABLE leads ALTER COLUMN client_id DROP DEFAULT;

ALTER TABLE leads
  ADD CONSTRAINT leads_client_id_nonempty CHECK (client_id <> '');

-- -----------------------------------------------------------------------------
-- STEP 4: Auto-update updated_at on every row change
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leads_updated_at ON leads;

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- STEP 5: Enable Row Level Security
-- DO NOT run this until Supabase Auth is configured and tested (Phase 2)
-- Otherwise all queries will return 0 rows.
-- -----------------------------------------------------------------------------

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- STEP 6: RLS Policies
--
-- Security model:
--   - Each Supabase Auth user has app_metadata.client_id set server-side
--   - RLS uses auth.jwt()->'app_metadata'->>'client_id' as the filter
--   - app_metadata is writable only by the service role (users cannot forge it)
-- -----------------------------------------------------------------------------

-- Drop existing policies if re-running this migration
DROP POLICY IF EXISTS "leads_select_own_client" ON leads;
DROP POLICY IF EXISTS "leads_insert_own_client" ON leads;
DROP POLICY IF EXISTS "leads_update_own_client" ON leads;
DROP POLICY IF EXISTS "leads_delete_own_client" ON leads;

-- SELECT: user sees only their client's leads
CREATE POLICY "leads_select_own_client"
ON leads FOR SELECT
TO authenticated
USING (
  client_id = (auth.jwt() -> 'app_metadata' ->> 'client_id')
);

-- INSERT: user can only insert rows stamped with their own client_id
CREATE POLICY "leads_insert_own_client"
ON leads FOR INSERT
TO authenticated
WITH CHECK (
  client_id = (auth.jwt() -> 'app_metadata' ->> 'client_id')
);

-- UPDATE: user can only update their own client's rows
CREATE POLICY "leads_update_own_client"
ON leads FOR UPDATE
TO authenticated
USING (
  client_id = (auth.jwt() -> 'app_metadata' ->> 'client_id')
)
WITH CHECK (
  client_id = (auth.jwt() -> 'app_metadata' ->> 'client_id')
);

-- DELETE: user can only delete their own client's rows
CREATE POLICY "leads_delete_own_client"
ON leads FOR DELETE
TO authenticated
USING (
  client_id = (auth.jwt() -> 'app_metadata' ->> 'client_id')
);

-- -----------------------------------------------------------------------------
-- STEP 7: Verify RLS is working (run after logging in via the tool)
-- This should return only rows matching your JWT's client_id
-- -----------------------------------------------------------------------------

-- SELECT auth.jwt() -> 'app_metadata' ->> 'client_id' AS my_client_id;
-- SELECT count(*) FROM leads;

-- -----------------------------------------------------------------------------
-- STEP 8: Set app_metadata.client_id on each operator user
-- Run once per user. Replace email and client_id values accordingly.
-- -----------------------------------------------------------------------------

-- UPDATE auth.users
--   SET raw_app_meta_data = raw_app_meta_data || '{"client_id": "envision_builders"}'::jsonb
--   WHERE email = 'andres+envision@alkan.com';

-- UPDATE auth.users
--   SET raw_app_meta_data = raw_app_meta_data || '{"client_id": "acme_corp"}'::jsonb
--   WHERE email = 'andres+acme@alkan.com';


-- -----------------------------------------------------------------------------
-- STEP 9: Remove demo leads (DEMO_MODE cleanup)
-- Run once after setting DEMO_MODE: false in config.js.
-- Demo leads are identified by id values prefixed with 'demo_'.
-- This is safe to run multiple times.
-- -----------------------------------------------------------------------------

-- DELETE FROM leads WHERE id LIKE 'demo_%';
