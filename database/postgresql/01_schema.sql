BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'customer')),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  full_name VARCHAR(200) NOT NULL,
  dni VARCHAR(30) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  street_address VARCHAR(255) NOT NULL,
  property_details VARCHAR(255),
  city VARCHAR(120) NOT NULL,
  province VARCHAR(120) NOT NULL,
  country VARCHAR(120) NOT NULL DEFAULT 'España',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL UNIQUE,
  slug VARCHAR(140) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(240) NOT NULL UNIQUE,
  sku VARCHAR(80) NOT NULL UNIQUE,
  short_description VARCHAR(280),
  description TEXT NOT NULL,
  purchase_price NUMERIC(12,2) NOT NULL CHECK (purchase_price >= 0),
  sale_price NUMERIC(12,2) NOT NULL CHECK (sale_price >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  min_stock_alert INTEGER NOT NULL DEFAULT 3 CHECK (min_stock_alert >= 0),
  main_image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  alt_text VARCHAR(255),
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(30) NOT NULL UNIQUE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  payment_method VARCHAR(30) NOT NULL CHECK (payment_method IN ('card', 'bank_transfer')),
  payment_status VARCHAR(30) NOT NULL CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  order_status VARCHAR(30) NOT NULL CHECK (order_status IN ('received', 'payment_pending', 'payment_confirmed', 'preparing', 'shipped', 'delivered', 'cancelled')),
  subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
  shipping_cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  total_cost NUMERIC(12,2) NOT NULL CHECK (total_cost >= 0),
  total_profit NUMERIC(12,2) NOT NULL CHECK (total_profit >= 0),
  shipping_name VARCHAR(200) NOT NULL,
  shipping_phone VARCHAR(50) NOT NULL,
  shipping_email VARCHAR(255) NOT NULL,
  shipping_street VARCHAR(255) NOT NULL,
  shipping_property VARCHAR(255),
  shipping_city VARCHAR(120) NOT NULL,
  shipping_province VARCHAR(120) NOT NULL,
  shipping_country VARCHAR(120) NOT NULL,
  tracking_number VARCHAR(120),
  customer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name VARCHAR(200) NOT NULL,
  product_sku VARCHAR(80) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_sale_price NUMERIC(12,2) NOT NULL CHECK (unit_sale_price >= 0),
  unit_purchase_price NUMERIC(12,2) NOT NULL CHECK (unit_purchase_price >= 0),
  line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0),
  line_cost NUMERIC(12,2) NOT NULL CHECK (line_cost >= 0),
  line_profit NUMERIC(12,2) NOT NULL CHECK (line_profit >= 0)
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  provider_reference VARCHAR(255),
  payment_method VARCHAR(30) NOT NULL CHECK (payment_method IN ('card', 'bank_transfer')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'EUR',
  status VARCHAR(30) NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL CHECK (status IN ('received', 'payment_pending', 'payment_confirmed', 'preparing', 'shipped', 'delivered', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  movement_type VARCHAR(20) NOT NULL CHECK (movement_type IN ('in', 'out', 'adjustment')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reference_type VARCHAR(30),
  reference_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_status ON orders(order_status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_id ON inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_users_updated_at ON app_users;
CREATE TRIGGER trg_app_users_updated_at
BEFORE UPDATE ON app_users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;
CREATE TRIGGER trg_customers_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
