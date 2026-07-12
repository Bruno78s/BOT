-- Postgres/Supabase reference schema for BznX Bot.
-- Runtime uses SQLite locally; keep this file for VPS/Supabase migrations when needed.

CREATE TABLE IF NOT EXISTS moderation_cases (
  id text PRIMARY KEY,
  guild_id text NOT NULL,
  action text NOT NULL,
  target_id text,
  target_tag text,
  moderator_id text,
  moderator_tag text,
  reason text NOT NULL,
  created_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_moderation_cases_guild_target ON moderation_cases (guild_id, target_id);

CREATE TABLE IF NOT EXISTS moderation_warnings (
  id bigserial PRIMARY KEY,
  guild_id text NOT NULL,
  user_id text NOT NULL,
  moderator_id text NOT NULL,
  reason text NOT NULL,
  created_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_moderation_warnings_user ON moderation_warnings (guild_id, user_id);

CREATE TABLE IF NOT EXISTS moderation_strikes (
  id bigserial PRIMARY KEY,
  guild_id text NOT NULL,
  user_id text NOT NULL,
  moderator_id text,
  reason text NOT NULL,
  source text,
  active integer NOT NULL DEFAULT 1,
  created_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_moderation_strikes_user ON moderation_strikes (guild_id, user_id, active);

CREATE TABLE IF NOT EXISTS customer_profiles (
  guild_id text NOT NULL,
  user_id text NOT NULL,
  total_spent numeric NOT NULL DEFAULT 0,
  total_orders integer NOT NULL DEFAULT 0,
  total_tickets integer NOT NULL DEFAULT 0,
  failed_payments integer NOT NULL DEFAULT 0,
  vip_until bigint,
  blacklisted integer NOT NULL DEFAULT 0,
  notes text,
  last_order_at bigint,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_profiles_spent ON customer_profiles (guild_id, total_spent);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS abandoned_warned_at bigint;
