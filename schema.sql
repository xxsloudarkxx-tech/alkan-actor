-- Run this in Supabase SQL Editor

-- Users table
CREATE TABLE IF NOT EXISTS bot_users (
  telegram_id TEXT PRIMARY KEY,
  name TEXT,
  business_name TEXT,
  trade TEXT,
  state TEXT,
  license_number TEXT,
  currency TEXT DEFAULT 'USD',
  language TEXT DEFAULT 'en',
  plan TEXT DEFAULT 'free',
  docs_used INT DEFAULT 0,
  plan_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Documents table
CREATE TABLE IF NOT EXISTS bot_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id TEXT REFERENCES bot_users(telegram_id),
  type TEXT,
  number TEXT,
  client_name TEXT,
  amount NUMERIC,
  content TEXT,
  pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Appointments table
CREATE TABLE IF NOT EXISTS bot_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id TEXT REFERENCES bot_users(telegram_id),
  type TEXT,
  client_name TEXT,
  address TEXT,
  scheduled_at TIMESTAMPTZ,
  reminder_24h_sent BOOL DEFAULT FALSE,
  reminder_2h_sent BOOL DEFAULT FALSE,
  related_doc_id UUID REFERENCES bot_documents(id),
  notes TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shopping lists table (WA only)
CREATE TABLE IF NOT EXISTS bot_shopping_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id TEXT REFERENCES bot_users(telegram_id),
  list_number TEXT,
  project_name TEXT,
  related_doc_id UUID REFERENCES bot_documents(id),
  related_appointment_id UUID REFERENCES bot_appointments(id),
  items JSONB,
  total_estimated NUMERIC,
  store_suggestion TEXT,
  state TEXT DEFAULT 'WA',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE bot_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_shopping_lists ENABLE ROW LEVEL SECURITY;

-- Note: For server-to-server access with service_role key, RLS policies are optional.
-- If using anon key from the bot, create policies or use service_role key instead.
