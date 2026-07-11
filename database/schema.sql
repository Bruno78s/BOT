-- SQLite Schema for BznX Bot

-- settings
CREATE TABLE IF NOT EXISTS settings (
  guild_id TEXT PRIMARY KEY,
  admin_role_id TEXT NOT NULL,
  support_role_id TEXT NOT NULL,
  sales_category_id TEXT NOT NULL,
  support_category_id TEXT NOT NULL,
  delivery_category_id TEXT,
  log_channel_id TEXT NOT NULL,
  panel_message_id TEXT
);

-- users
CREATE TABLE IF NOT EXISTS users (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_ticket_at INTEGER,
  PRIMARY KEY (guild_id, user_id)
);

-- counters
CREATE TABLE IF NOT EXISTS counters (
  guild_id TEXT NOT NULL,
  type TEXT NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, type)
);

-- tickets
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  product_id TEXT,
  coupon_id INTEGER,
  number INTEGER NOT NULL,
  status TEXT NOT NULL,
  internal_status TEXT NOT NULL DEFAULT 'open',
  claimed_by TEXT,
  last_activity_at INTEGER,
  auto_close_warned_at INTEGER,
  close_reason TEXT,
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  rating INTEGER,
  terms_accepted_at INTEGER,
  terms_snapshot TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickets_guild_status ON tickets(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_channel_id ON tickets(channel_id);
CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id);

-- logs
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  meta TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);

-- payments
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_payment_id TEXT UNIQUE,
  preference_id TEXT,
  coupon_id INTEGER,
  order_code TEXT,
  fulfillment_status TEXT NOT NULL DEFAULT 'awaiting_payment',
  delivered_at INTEGER,
  issue_reason TEXT,
  payment_message_id TEXT,
  pix_copy_code TEXT,
  status TEXT NOT NULL,
  amount REAL NOT NULL,
  checkout_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_payments_provider_payment_id ON payments(provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_channel_status ON payments(channel_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);

-- panel_messages
CREATE TABLE IF NOT EXISTS panel_messages (
  guild_id TEXT NOT NULL,
  type TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, type)
);

-- auto_responses
CREATE TABLE IF NOT EXISTS auto_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  keywords TEXT NOT NULL,
  response TEXT NOT NULL,
  category TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auto_responses_guild ON auto_responses(guild_id);

-- coupons
CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL,
  discount_value REAL NOT NULL,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  min_amount REAL,
  payment_method TEXT,
  role_id TEXT,
  first_purchase_only INTEGER NOT NULL DEFAULT 0,
  per_user_limit INTEGER,
  product_id TEXT,
  expires_at INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_coupons_guild ON coupons(guild_id);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);

-- invite_stats
CREATE TABLE IF NOT EXISTS invite_stats (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  current INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 0,
  fake INTEGER NOT NULL DEFAULT 0,
  invalid INTEGER NOT NULL DEFAULT 0,
  left_count INTEGER NOT NULL DEFAULT 0,
  redeemed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- invite_joins
CREATE TABLE IF NOT EXISTS invite_joins (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  inviter_id TEXT,
  invite_code TEXT,
  is_fake INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  validated_at INTEGER,
  invalid_reason TEXT,
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_invite_stats_guild ON invite_stats(guild_id);
CREATE INDEX IF NOT EXISTS idx_invite_joins_inviter ON invite_joins(guild_id, inviter_id);
