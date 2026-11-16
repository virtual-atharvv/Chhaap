-- Chhaap PostgreSQL schema (idempotent migration; safe to run repeatedly)
-- All money columns are integer paise. Never use floats for money.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Tenancy & Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(20) UNIQUE,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'owner', -- 'owner', 'staff', 'admin'
  password_hash VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plans (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  price_paise INT NOT NULL DEFAULT 0,
  limits JSONB NOT NULL DEFAULT '{}',
  txn_fee_bps INT NOT NULL DEFAULT 300,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  city VARCHAR(100) NOT NULL DEFAULT 'Lucknow',
  phone VARCHAR(20),
  gst_no VARCHAR(50),
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  plan_id VARCHAR(50) REFERENCES plans(id) DEFAULT 'starter',
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shop_members (
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'staff',
  PRIMARY KEY (shop_id, user_id)
);

-- Devices
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  pairing_code VARCHAR(255), -- SHA-256 hash of the 6-digit pairing code
  pairing_code_expires_at TIMESTAMPTZ,
  pairing_attempts INT NOT NULL DEFAULT 0,
  version VARCHAR(50),
  last_seen_at TIMESTAMPTZ,
  os VARCHAR(50),
  status VARCHAR(50) NOT NULL DEFAULT 'offline',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS printers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  system_name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  capabilities JSONB NOT NULL DEFAULT '{"color":true,"duplex":true,"papers":["A4","A3"]}',
  status VARCHAR(50) NOT NULL DEFAULT 'online',
  last_status_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One printer row per (agent, system printer).
CREATE UNIQUE INDEX IF NOT EXISTS idx_printers_agent_system
  ON printers (agent_id, system_name);

-- Pricing
CREATE TABLE IF NOT EXISTS rate_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  printer_id UUID REFERENCES printers(id) ON DELETE SET NULL,
  paper_size VARCHAR(20) NOT NULL,
  color_mode VARCHAR(20) NOT NULL,
  sides VARCHAR(20) NOT NULL,
  price_per_page_paise INT NOT NULL,
  min_order_paise INT NOT NULL DEFAULT 500,
  UNIQUE (shop_id, paper_size, color_mode, sides)
);

CREATE TABLE IF NOT EXISTS addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  price_paise INT NOT NULL
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  token VARCHAR(8) NOT NULL,
  public_token VARCHAR(64) NOT NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'web',
  customer_phone VARCHAR(20),
  customer_email VARCHAR(255),
  customer_wa_id VARCHAR(50),
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  subtotal_paise INT NOT NULL DEFAULT 0,
  fee_paise INT NOT NULL DEFAULT 100,
  gst_paise INT NOT NULL DEFAULT 0,
  total_paise INT NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour')
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS public_token VARCHAR(64);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel VARCHAR(20) NOT NULL DEFAULT 'web';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_wa_id VARCHAR(50);
UPDATE orders SET public_token = encode(gen_random_bytes(24), 'hex')
  WHERE public_token IS NULL;
ALTER TABLE orders ALTER COLUMN public_token SET NOT NULL;

CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  storage_key VARCHAR(500) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime VARCHAR(100) NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 VARCHAR(64) NOT NULL,
  scan_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  converted_pdf_key VARCHAR(500),
  preview_keys JSONB DEFAULT '[]',
  page_count INT NOT NULL DEFAULT 1,
  classification JSONB NOT NULL DEFAULT '[]',
  delete_after TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Files may be uploaded and analysed before an order exists.
ALTER TABLE files ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE files ADD COLUMN IF NOT EXISTS page_count INT NOT NULL DEFAULT 1;
ALTER TABLE files ADD COLUMN IF NOT EXISTS classification JSONB NOT NULL DEFAULT '[]';
ALTER TABLE files ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  settings JSONB NOT NULL DEFAULT '{}',
  page_count INT NOT NULL DEFAULT 1,
  colour_pages INT NOT NULL DEFAULT 0,
  bw_pages INT NOT NULL DEFAULT 1,
  sheets INT NOT NULL DEFAULT 1,
  line_total_paise INT NOT NULL DEFAULT 0,
  printer_id UUID REFERENCES printers(id) ON DELETE SET NULL
);

-- Payments & Refunds
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  razorpay_order_id VARCHAR(100) UNIQUE NOT NULL,
  razorpay_payment_id VARCHAR(100) UNIQUE,
  payment_link_id VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'created',
  method VARCHAR(50),
  amount_paise INT NOT NULL,
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_link_id VARCHAR(100);

CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  amount_paise INT NOT NULL,
  reason VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  razorpay_refund_id VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Print Jobs
CREATE TABLE IF NOT EXISTS print_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  printer_id UUID REFERENCES printers(id) ON DELETE SET NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  dispatched_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- WhatsApp Integration Tables
CREATE TABLE IF NOT EXISTS wa_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_id VARCHAR(50) NOT NULL,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  state VARCHAR(50) NOT NULL DEFAULT 'IDLE',
  lang VARCHAR(20) NOT NULL DEFAULT 'hinglish',
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  context JSONB NOT NULL DEFAULT '{}',
  last_inbound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS wa_sessions_active_idx
  ON wa_sessions(wa_id) WHERE state <> 'DONE';

CREATE TABLE IF NOT EXISTS wa_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wamid VARCHAR(255) UNIQUE,
  direction VARCHAR(10) NOT NULL,
  wa_id VARCHAR(50) NOT NULL,
  type VARCHAR(50) NOT NULL,
  payload JSONB,
  status VARCHAR(50),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wa_status_events (
  wamid VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (wamid, status)
);

CREATE TABLE IF NOT EXISTS wa_optouts (
  wa_id VARCHAR(50) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes (phone, expires_at DESC);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notification dedupe: one notification row per (order, event).
CREATE TABLE IF NOT EXISTS notification_log (
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (order_id, event)
);

-- Audit & Webhooks
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
  type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(50) NOT NULL DEFAULT 'razorpay',
  event_id VARCHAR(255) UNIQUE NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_orders_shop_status ON orders (shop_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_public_token ON orders (public_token);
CREATE INDEX IF NOT EXISTS idx_orders_wa_id ON orders (customer_wa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_delete_after ON files (delete_after) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs (status, dispatched_at);
CREATE INDEX IF NOT EXISTS idx_events_created ON events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_messages_created ON wa_messages (created_at DESC);

-- Seed a starter plan so shop plan_id references resolve.
INSERT INTO plans (id, name, price_paise, limits, txn_fee_bps)
VALUES ('starter', 'Starter', 0, '{"printers":1,"ordersPerMonth":150}', 300)
ON CONFLICT (id) DO NOTHING;
