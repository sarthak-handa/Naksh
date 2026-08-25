-- ============================================
-- NAKSH — Database Setup (Run in Supabase SQL Editor)
-- ============================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Monitored Routes ──
CREATE TABLE IF NOT EXISTS monitored_routes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  origin_place_id TEXT,
  dest_place_id TEXT,
  alert_below INTEGER,           -- Alert when ETA drops below (minutes)
  alert_above INTEGER,           -- Alert when ETA rises above (minutes)
  poll_interval INTEGER DEFAULT 10,  -- Minutes between checks
  last_eta INTEGER,              -- Last known ETA (minutes)
  last_checked TIMESTAMPTZ,      -- Last poll timestamp
  status TEXT DEFAULT 'active',  -- active / paused / cooldown
  cooldown_until TIMESTAMPTZ,    -- Don't re-trigger until this time
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT valid_status CHECK (status IN ('active', 'paused', 'cooldown')),
  CONSTRAINT at_least_one_threshold CHECK (alert_below IS NOT NULL OR alert_above IS NOT NULL)
);

-- ── Push Subscriptions ──
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  keys JSONB NOT NULL,           -- { p256dh, auth }
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Alert History ──
CREATE TABLE IF NOT EXISTS alert_history (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  route_id UUID NOT NULL REFERENCES monitored_routes(id) ON DELETE CASCADE,
  eta_at_trigger INTEGER NOT NULL,
  threshold_crossed TEXT NOT NULL,   -- 'below' or 'above'
  threshold_value INTEGER NOT NULL,
  triggered_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT valid_threshold_type CHECK (threshold_crossed IN ('below', 'above'))
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_routes_user ON monitored_routes(user_id);
CREATE INDEX IF NOT EXISTS idx_routes_status ON monitored_routes(status);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_route ON alert_history(route_id);
CREATE INDEX IF NOT EXISTS idx_alerts_time ON alert_history(triggered_at DESC);

-- ── Row Level Security (RLS) ──
-- Enable RLS on all tables
ALTER TABLE monitored_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_history ENABLE ROW LEVEL SECURITY;

-- Allow anonymous access for MVP (secured by user_id in localStorage)
-- For production, replace with proper auth policies
CREATE POLICY "Allow all operations on monitored_routes"
  ON monitored_routes FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations on push_subscriptions"
  ON push_subscriptions FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations on alert_history"
  ON alert_history FOR ALL
  USING (true)
  WITH CHECK (true);
