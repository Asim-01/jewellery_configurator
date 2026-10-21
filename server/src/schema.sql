-- Idempotent schema. Applied on every server start.

CREATE TABLE IF NOT EXISTS metal_rates (
  id                  BIGSERIAL PRIMARY KEY,
  metal               TEXT NOT NULL CHECK (metal IN ('gold', 'silver', 'platinum')),
  rate_paise_per_gram BIGINT NOT NULL CHECK (rate_paise_per_gram > 0), -- for 999 fine metal
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS metal_rates_latest ON metal_rates (metal, id DESC);

CREATE TABLE IF NOT EXISTS products (
  id           SERIAL PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT 'ring',
  metal        TEXT NOT NULL CHECK (metal IN ('gold', 'silver', 'platinum')),
  purities     JSONB NOT NULL, -- [{code,label,fineness}]
  sizes        JSONB NOT NULL, -- [{code,label,weightMg}]
  wastage_bps  INT NOT NULL CHECK (wastage_bps >= 0),
  making_type  TEXT NOT NULL CHECK (making_type IN ('per_gram', 'percent', 'flat')),
  making_value BIGINT NOT NULL CHECK (making_value >= 0),
  stones       JSONB NOT NULL DEFAULT '[]', -- [{name,count,pricePaise}]
  stock        INT NOT NULL CHECK (stock >= 0)  -- the CHECK is a last line of defence against overselling
);

-- A price lock taken when a customer views a product: a snapshot of the metal
-- rate, valid for 10 minutes. Prices are always recomputed server-side from it.
CREATE TABLE IF NOT EXISTS price_locks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  INT NOT NULL REFERENCES products(id),
  rate_id     BIGINT NOT NULL REFERENCES metal_rates(id),
  rate_paise  BIGINT NOT NULL,
  product_snapshot JSONB NOT NULL, -- pricing rules at view time, so an admin edit can't move a locked price
  created_at  TIMESTAMPTZ NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS carts (
  id         UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cart_items (
  id                 SERIAL PRIMARY KEY,
  cart_id            UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id         INT NOT NULL REFERENCES products(id),
  purity_code        TEXT NOT NULL,
  size_code          TEXT NOT NULL,
  qty                INT NOT NULL CHECK (qty > 0),
  -- the price the customer has agreed to, and its lock
  unit_price_paise   BIGINT NOT NULL,
  breakdown          JSONB NOT NULL,
  lock_expires_at    TIMESTAMPTZ NOT NULL,
  added_price_paise  BIGINT NOT NULL,          -- price when first added (shown on the cart)
  -- state after the lock expires
  status             TEXT NOT NULL DEFAULT 'locked'
                     CHECK (status IN ('locked', 'price_increase', 'out_of_stock')),
  change             TEXT CHECK (change IN ('decreased', 'unchanged', 'increased', 'accepted')),
  previous_price_paise BIGINT,                 -- for the struck-through price
  pending_price_paise  BIGINT,                 -- a higher price awaiting acceptance
  pending_breakdown    JSONB,
  pending_expires_at   TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cart_items_cart ON cart_items (cart_id);

CREATE TABLE IF NOT EXISTS orders (
  id           SERIAL PRIMARY KEY,
  total_paise  BIGINT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('cart', 'buy_now')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id               SERIAL PRIMARY KEY,
  order_id         INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       INT NOT NULL REFERENCES products(id),
  purity_code      TEXT NOT NULL,
  size_code        TEXT NOT NULL,
  qty              INT NOT NULL,
  unit_price_paise BIGINT NOT NULL,
  breakdown        JSONB NOT NULL
);
