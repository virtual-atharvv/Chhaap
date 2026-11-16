-- Schema for Chhaap (PostgreSQL)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tenancy & Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
  txn_fee_bps INT NOT NULL DEFAULT 300, -- 3%
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shops (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  city VARCHAR(100) NOT NULL DEFAULT 'Lucknow',
  phone VARCHAR(20),
  gst_no VARCHAR(50),
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'pending', 'active', 'suspended'
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
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  pairing_code VARCHAR(6),
  pairing_code_expires_at TIMESTAMPTZ,
  version VARCHAR(50),
  last_seen_at TIMESTAMPTZ,
  os VARCHAR(50),
  status VARCHAR(50) NOT NULL DEFAULT 'offline',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS printers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  system_name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  capabilities JSONB NOT NULL DEFAULT '{"color":true,"duplex":true,"papers":["A4","A3"]}',
  status VARCHAR(50) NOT NULL DEFAULT 'online', -- 'online','offline','paper_out','error','busy'
  last_status_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pricing
CREATE TABLE IF NOT EXISTS rate_cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  printer_id UUID REFERENCES printers(id) ON DELETE SET NULL,
  paper_size VARCHAR(20) NOT NULL,
  color_mode VARCHAR(20) NOT NULL,
  sides VARCHAR(20) NOT NULL,
  price_per_page_paise INT NOT NULL,
  min_order_paise INT NOT NULL DEFAULT 500
);

CREATE TABLE IF NOT EXISTS addons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL, -- 'spiral','lamination','staple','binding'
  price_paise INT NOT NULL
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  token VARCHAR(8) NOT NULL, -- human pickup code e.g. 'B-047'
  customer_phone VARCHAR(20),
  customer_email VARCHAR(255),
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

CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  storage_key VARCHAR(500) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime VARCHAR(100) NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 VARCHAR(64) NOT NULL,
  scan_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  converted_pdf_key VARCHAR(500),
  preview_keys JSONB DEFAULT '[]',
  delete_after TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  razorpay_order_id VARCHAR(100) UNIQUE NOT NULL,
  razorpay_payment_id VARCHAR(100) UNIQUE,
  status VARCHAR(50) NOT NULL DEFAULT 'created',
  method VARCHAR(50),
  amount_paise INT NOT NULL,
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  amount_paise INT NOT NULL,
  reason VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  razorpay_refund_id VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Print Jobs
CREATE TABLE IF NOT EXISTS print_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  printer_id UUID REFERENCES printers(id) ON DELETE SET NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending','dispatched','printing','done','failed','cancelled'
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  dispatched_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SaaS Subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  plan_id VARCHAR(50) REFERENCES plans(id),
  razorpay_sub_id VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  current_period_end TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

-- Events & Audits (Append-only)
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
  type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(50) NOT NULL DEFAULT 'razorpay',
  event_id VARCHAR(255) UNIQUE NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for high-frequency queries
CREATE INDEX IF NOT EXISTS idx_orders_shop_status_created ON orders (shop_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_print_jobs_printer_status ON print_jobs (printer_id, status);
CREATE INDEX IF NOT EXISTS idx_files_delete_after ON files (delete_after) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agents_shop_status ON agents (shop_id, status);
