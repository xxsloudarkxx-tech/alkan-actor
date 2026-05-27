/**
 * Alkan Lead Hunter — Configuration Template
 *
 * SETUP INSTRUCTIONS:
 *   1. Copy this file to config.js  (config.js is gitignored)
 *   2. Fill in your real Supabase URL, anon key, and client credentials
 *   3. Never commit config.js to version control
 *
 * SECURITY NOTE:
 *   The anon key is intentionally public — security is enforced by
 *   Supabase Row Level Security (RLS) policies, not by key secrecy.
 */
window.ALKAN_CONFIG = {
  // ── Supabase project credentials ──────────────────────────────────────────
  SUPABASE_URL:      "YOUR_SUPABASE_URL",       // e.g. https://xxxx.supabase.co
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY",  // eyJ...

  // ── Client roster managed by this operator ────────────────────────────────
  // Each entry maps to a Supabase Auth user whose app_metadata.client_id
  // matches the value in the 'leads' table.
  //
  // To add a client:
  //   1. Create a Supabase Auth user for that client
  //   2. Set raw_app_meta_data.client_id via the SQL below (service role only):
  //      UPDATE auth.users
  //        SET raw_app_meta_data = raw_app_meta_data || '{"client_id":"YOUR_ID"}'::jsonb
  //        WHERE email = 'email@example.com';
  //   3. Add the entry here
  CLIENTS: [
    {
      label:    "Client One",
      email:    "operator+client1@example.com",
      password: "YOUR_PASSWORD_1"
    },
    {
      label:    "Client Two",
      email:    "operator+client2@example.com",
      password: "YOUR_PASSWORD_2"
    }
  ],

  // ── Actor / Enrichment backend ─────────────────────────────────────────────
  // The alkan-actor Node.js service provides contact enrichment (owner name,
  // phone, email) by scraping permit portal PDFs server-side.
  // Run `npm start` inside alkan-actor/ to start the service locally.
  //
  // Set ACTOR_BASE_URL to your deployed actor URL in production.
  // Set ACTOR_API_KEY to match the API_KEY value in alkan-actor/.env
  ACTOR_BASE_URL: "https://alkan-actor.onrender.com",  // deployed actor on Render
  ACTOR_API_KEY:  "tu-api-key-aqui",                   // must match API_KEY in alkan-actor/.env

  // ── Demo mode ──────────────────────────────────────────────────────────────
  // When true:  the "Re-seed Demo" button is visible and seedDemoLeads() runs
  //             on first load. Demo leads (id prefix "demo_") are displayed.
  // When false: the button is hidden, seeding is skipped, and demo leads are
  //             filtered out of all views. On first load with DEMO_MODE=false,
  //             any pre-existing demo leads are purged from localStorage.
  DEMO_MODE: false
};
