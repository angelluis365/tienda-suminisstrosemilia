BEGIN;

CREATE OR REPLACE VIEW v_product_catalog AS
SELECT
  p.id,
  p.name,
  p.slug,
  p.sku,
  c.name AS category_name,
  p.short_description,
  p.description,
  p.sale_price,
  p.stock_quantity,
  p.main_image_url,
  p.is_active
FROM products p
LEFT JOIN categories c ON c.id = p.category_id
WHERE p.is_active = TRUE;

CREATE OR REPLACE VIEW v_sales_summary AS
SELECT
  COUNT(o.id) AS total_orders,
  COALESCE(SUM(o.total_amount), 0) AS total_revenue,
  COALESCE(SUM(o.total_cost), 0) AS total_cost,
  COALESCE(SUM(o.total_profit), 0) AS total_profit
FROM orders o
WHERE o.order_status <> 'cancelled';

CREATE OR REPLACE VIEW v_product_sales AS
SELECT
  oi.product_id,
  oi.product_name,
  oi.product_sku,
  COALESCE(SUM(oi.quantity), 0) AS units_sold,
  COALESCE(SUM(oi.line_total), 0) AS revenue,
  COALESCE(SUM(oi.line_cost), 0) AS cost,
  COALESCE(SUM(oi.line_profit), 0) AS profit
FROM order_items oi
GROUP BY oi.product_id, oi.product_name, oi.product_sku;

CREATE OR REPLACE VIEW v_low_stock_products AS
SELECT
  id,
  name,
  sku,
  stock_quantity,
  min_stock_alert
FROM products
WHERE stock_quantity <= min_stock_alert
ORDER BY stock_quantity ASC, name ASC;

COMMIT;
