-- Converted Postgres schema for Supabase from original SQLite schema.sql
-- Timestamps stored as bigint (epoch ms) for compatibility with existing code.

-- settings
CREATE TABLE IF NOT EXISTS settings (
  guild_id text PRIMARY KEY,
  admin_role_id text NOT NULL,
  support_role_id text NOT NULL,
  sales_category_id text NOT NULL,
  support_category_id text NOT NULL,
  log_channel_id text NOT NULL,
  panel_message_id text
);

-- users
CREATE TABLE IF NOT EXISTS users (
  guild_id text NOT NULL,
  user_id text NOT NULL,
  last_ticket_at bigint,
  PRIMARY KEY (guild_id, user_id)
);

-- counters
CREATE TABLE IF NOT EXISTS counters (
  guild_id text NOT NULL,
  type text NOT NULL,
  last_number bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, type)
);

-- tickets
CREATE TABLE IF NOT EXISTS tickets (
  id bigserial PRIMARY KEY,
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  user_id text NOT NULL,
  type text NOT NULL,
  product_id text,
  coupon_id bigint,
  number bigint NOT NULL,
  status text NOT NULL,
  created_at bigint NOT NULL,
  closed_at bigint,
  rating integer,
  terms_accepted_at bigint,
  terms_snapshot text
);

CREATE INDEX IF NOT EXISTS idx_tickets_guild_status ON tickets (guild_id, status);

-- logs
CREATE TABLE IF NOT EXISTS logs (
  id bigserial PRIMARY KEY,
  guild_id text NOT NULL,
  level text NOT NULL,
  message text NOT NULL,
  meta jsonb,
  created_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs (created_at);

-- payments
CREATE TABLE IF NOT EXISTS payments (
  id bigserial PRIMARY KEY,
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  user_id text NOT NULL,
  product_id text NOT NULL,
  provider text NOT NULL,
  provider_payment_id text,
  preference_id text,
  coupon_id bigint,
  order_code text,
  fulfillment_status text NOT NULL DEFAULT 'awaiting_payment',
  delivered_at bigint,
  issue_reason text,
  payment_message_id text,
  status text NOT NULL,
  amount numeric NOT NULL,
  checkout_url text,
  created_at bigint NOT NULL,
  updated_at bigint
);

CREATE INDEX IF NOT EXISTS idx_payments_provider_payment_id ON payments (provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_channel_status ON payments (channel_id, status);

-- panel_messages
CREATE TABLE IF NOT EXISTS panel_messages (
  guild_id text NOT NULL,
  type text NOT NULL,
  channel_id text NOT NULL,
  message_id text NOT NULL,
  updated_at bigint NOT NULL,
  PRIMARY KEY (guild_id, type)
);

-- auto_responses
CREATE TABLE IF NOT EXISTS auto_responses (
  id bigserial PRIMARY KEY,
  guild_id text NOT NULL,
  keywords text NOT NULL,
  response text NOT NULL,
  category text,
  enabled boolean NOT NULL DEFAULT true,
  created_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auto_responses_guild ON auto_responses (guild_id);

-- coupons
CREATE TABLE IF NOT EXISTS coupons (
  id bigserial PRIMARY KEY,
  guild_id text NOT NULL,
  code text NOT NULL UNIQUE,
  discount_type text NOT NULL,
  discount_value numeric NOT NULL,
  max_uses integer,
  used_count integer NOT NULL DEFAULT 0,
  min_amount numeric,
  payment_method text,
  role_id text,
  first_purchase_only integer NOT NULL DEFAULT 0,
  per_user_limit integer,
  product_id text,
  expires_at bigint,
  enabled boolean NOT NULL DEFAULT true,
  created_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_coupons_guild ON coupons (guild_id);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons (code);

-- invite_stats
CREATE TABLE IF NOT EXISTS invite_stats (
  guild_id text NOT NULL,
  user_id text NOT NULL,
  total integer NOT NULL DEFAULT 0,
  current integer NOT NULL DEFAULT 0,
  fake integer NOT NULL DEFAULT 0,
  left_count integer NOT NULL DEFAULT 0,
  redeemed integer NOT NULL DEFAULT 0,
  updated_at bigint NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- invite_joins
CREATE TABLE IF NOT EXISTS invite_joins (
  guild_id text NOT NULL,
  user_id text NOT NULL,
  inviter_id text,
  invite_code text,
  is_fake boolean NOT NULL DEFAULT false,
  joined_at bigint NOT NULL,
  left_at bigint,
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_invite_stats_guild ON invite_stats (guild_id);
CREATE INDEX IF NOT EXISTS idx_invite_joins_inviter ON invite_joins (guild_id, inviter_id);

-- Additional note: Review constraints and types if you rely on specific integer sizes.
-- Run this script from Supabase SQL Editor or via psql connected to your project's DB.
