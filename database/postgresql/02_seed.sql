BEGIN;

INSERT INTO app_users (id, role, email, password_hash)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin', 'admin@suministrossantaemilia.com', 'CAMBIAR_POR_HASH_BCRYPT_ADMIN'),
  ('22222222-2222-2222-2222-222222222222', 'customer', 'cliente1@example.com', 'CAMBIAR_POR_HASH_BCRYPT_CLIENTE')
ON CONFLICT (email) DO NOTHING;

INSERT INTO customers (
  id, user_id, full_name, dni, phone, email, street_address, property_details, city, province, country
)
VALUES
  (
    '33333333-3333-3333-3333-333333333333',
    '22222222-2222-2222-2222-222222222222',
    'Cliente Ejemplo',
    '12345678Z',
    '+34600000000',
    'cliente1@example.com',
    'Calle Ejemplo 12',
    'Piso 2 Puerta B',
    'Getafe',
    'Madrid',
    'España'
  )
ON CONFLICT (email) DO NOTHING;

INSERT INTO categories (id, name, slug)
VALUES
  ('44444444-4444-4444-4444-444444444441', 'Seguridad', 'seguridad'),
  ('44444444-4444-4444-4444-444444444442', 'Filtros', 'filtros'),
  ('44444444-4444-4444-4444-444444444443', 'Baterias', 'baterias'),
  ('44444444-4444-4444-4444-444444444444', 'Pintura', 'pintura')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO products (
  id, category_id, name, slug, sku, short_description, description, purchase_price, sale_price, stock_quantity, main_image_url
)
VALUES
  (
    '55555555-5555-5555-5555-555555555551',
    '44444444-4444-4444-4444-444444444441',
    'Camara IP profesional exterior',
    'camara-ip-profesional-exterior',
    'SSE-SEG-001',
    'Camara de red para uso profesional.',
    'Camara de red para vigilancia exterior con vision nocturna y carcasa resistente.',
    118.00,
    189.00,
    12,
    '/images/products/camara-ip-profesional-exterior.jpg'
  ),
  (
    '55555555-5555-5555-5555-555555555552',
    '44444444-4444-4444-4444-444444444442',
    'Filtro industrial premium',
    'filtro-industrial-premium',
    'SSE-FIL-014',
    'Filtro de alto rendimiento.',
    'Filtro de alto rendimiento para mantenimiento profesional y reposicion rapida.',
    24.50,
    42.90,
    38,
    '/images/products/filtro-industrial-premium.jpg'
  ),
  (
    '55555555-5555-5555-5555-555555555553',
    '44444444-4444-4444-4444-444444444443',
    'Bateria 12V alta capacidad',
    'bateria-12v-alta-capacidad',
    'SSE-BAT-120',
    'Bateria para instalaciones y maquinaria.',
    'Bateria fiable para instalaciones, maquinaria ligera y necesidades de energia.',
    61.00,
    95.00,
    20,
    '/images/products/bateria-12v-alta-capacidad.jpg'
  )
ON CONFLICT (sku) DO NOTHING;

INSERT INTO product_images (product_id, image_url, alt_text, sort_order)
VALUES
  ('55555555-5555-5555-5555-555555555551', '/images/products/camara-ip-profesional-exterior.jpg', 'Camara IP profesional exterior', 1),
  ('55555555-5555-5555-5555-555555555552', '/images/products/filtro-industrial-premium.jpg', 'Filtro industrial premium', 1),
  ('55555555-5555-5555-5555-555555555553', '/images/products/bateria-12v-alta-capacidad.jpg', 'Bateria 12V alta capacidad', 1)
ON CONFLICT DO NOTHING;

INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_type, notes)
VALUES
  ('55555555-5555-5555-5555-555555555551', 'in', 12, 'seed', 'Stock inicial'),
  ('55555555-5555-5555-5555-555555555552', 'in', 38, 'seed', 'Stock inicial'),
  ('55555555-5555-5555-5555-555555555553', 'in', 20, 'seed', 'Stock inicial');

COMMIT;
