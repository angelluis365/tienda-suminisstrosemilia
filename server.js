const path = require("path");
const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const { query, withTransaction } = require("./db/connection");
const { sendPaidOrderEmails, sendShippedOrderEmails } = require("./services/mailService");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "").toLowerCase().trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "");
const adminSessions = new Map();
const customerSessions = new Map();
const ORDER_STATUSES = [
  "received",
  "payment_pending",
  "payment_confirmed",
  "preparing",
  "shipped",
  "delivered",
  "cancelled"
];

app.use(express.json({ limit: "15mb" }));
app.use(express.static(process.cwd()));

function parseCookies(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const index = pair.indexOf("=");
      if (index === -1) return acc;
      const key = pair.slice(0, index);
      const value = decodeURIComponent(pair.slice(index + 1));
      acc[key] = value;
      return acc;
    }, {});
}

function createAdminSession(email) {
  const token = crypto.randomBytes(24).toString("hex");
  adminSessions.set(token, { email, createdAt: Date.now() });
  return token;
}

function clearAdminSession(token) {
  if (token) adminSessions.delete(token);
}

function getAdminSession(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies.admin_session;
  return token ? adminSessions.get(token) : null;
}

function createCustomerSession(customer) {
  const token = crypto.randomBytes(24).toString("hex");
  customerSessions.set(token, { ...customer, createdAt: Date.now() });
  return token;
}

function clearCustomerSession(token) {
  if (token) customerSessions.delete(token);
}

function getCustomerSession(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies.customer_session;
  return token ? customerSessions.get(token) : null;
}

function requireAdmin(req, res, next) {
  const session = getAdminSession(req);
  if (!session) {
    return res.status(401).json({ error: "Acceso restringido al administrador." });
  }
  req.admin = session;
  next();
}

function requireCustomer(req, res, next) {
  const session = getCustomerSession(req);
  if (!session) {
    return res.status(401).json({ error: "Debes iniciar sesion como cliente." });
  }
  req.customer = session;
  next();
}

async function initializeRuntimeSchema() {
  await query("ALTER TABLE app_users ADD COLUMN IF NOT EXISTS username VARCHAR(120)");
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'app_users_username_unique'
      ) THEN
        ALTER TABLE app_users ADD CONSTRAINT app_users_username_unique UNIQUE (username);
      END IF;
    END $$;
  `);
  await query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name VARCHAR(200)");
  await query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS cif VARCHAR(30)");
  await query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_street VARCHAR(255)");
  await query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_property VARCHAR(255)");
  await query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_city VARCHAR(120)");
  await query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_province VARCHAR(120)");
  await query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_country VARCHAR(120)");
  await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(10,3) NOT NULL DEFAULT 0");
  await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS volume_m3 NUMERIC(12,6) NOT NULL DEFAULT 0");
  await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2) NOT NULL DEFAULT 21");
  await query(`
    CREATE TABLE IF NOT EXISTS shipping_settings (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      free_shipping_threshold NUMERIC(12,2) NOT NULL DEFAULT 120,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    INSERT INTO shipping_settings (id, free_shipping_threshold, is_active)
    VALUES (1, 120, TRUE)
    ON CONFLICT (id) DO NOTHING
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS shipping_rates (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      max_weight_kg NUMERIC(10,3) NOT NULL,
      max_volume_m3 NUMERIC(12,6) NOT NULL,
      price NUMERIC(12,2) NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    INSERT INTO shipping_rates (name, max_weight_kg, max_volume_m3, price, sort_order, is_active)
    SELECT seed.name, seed.max_weight_kg, seed.max_volume_m3, seed.price, seed.sort_order, TRUE
    FROM (
      VALUES
        ('Ligero', 2.000, 0.020000, 4.95, 10),
        ('Estandar', 5.000, 0.050000, 6.95, 20),
        ('Medio', 10.000, 0.100000, 9.95, 30),
        ('Voluminoso', 20.000, 0.200000, 14.95, 40),
        ('Especial', 9999.000, 9999.000000, 24.95, 999)
    ) AS seed(name, max_weight_kg, max_volume_m3, price, sort_order)
    WHERE NOT EXISTS (SELECT 1 FROM shipping_rates)
  `);
  await query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_name VARCHAR(160)");
  await query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(160)");
  await query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_url TEXT");
  await query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ");
  await query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(80)");
  await query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_issued_at TIMESTAMPTZ");
  await query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0");
  await query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS vat_exempt BOOLEAN NOT NULL DEFAULT FALSE");
  await query(`
    CREATE TABLE IF NOT EXISTS invoice_settings (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      prefix VARCHAR(40) NOT NULL DEFAULT 'Factura',
      series_code VARCHAR(20) NOT NULL DEFAULT 'H',
      last_sequence INTEGER NOT NULL DEFAULT 132,
      fiscal_suffix VARCHAR(10) NOT NULL DEFAULT '26',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    INSERT INTO invoice_settings (id, prefix, series_code, last_sequence, fiscal_suffix)
    VALUES (1, 'Factura', 'H', 132, '26')
    ON CONFLICT (id) DO NOTHING
  `);
}

function slugify(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mapProduct(row) {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    category: row.category_name || "Sin categoria",
    description: row.description,
    shortDescription: row.short_description,
    salePrice: Number(row.sale_price),
    costPrice: row.purchase_price == null ? null : Number(row.purchase_price),
    vatRate: Number(row.vat_rate || 0),
    stock: Number(row.stock_quantity),
    weightKg: Number(row.weight_kg || 0),
    volumeM3: Number(row.volume_m3 || 0),
    image: row.main_image_url || ""
  };
}

function normalizeCountry(country) {
  return String(country || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

const AFRICAN_COUNTRIES = new Set([
  "argelia", "algeria", "angola", "benin", "botsuana", "botswana", "burkina faso", "burundi",
  "cabo verde", "cape verde", "camerun", "cameroon", "chad", "comoras", "comoros",
  "costa de marfil", "cote d'ivoire", "djibouti", "egipto", "egypt", "eritrea", "esuatini",
  "swaziland", "etiopia", "ethiopia", "gabon", "gambia", "ghana", "guinea", "guinea ecuatorial",
  "equatorial guinea", "guinea-bissau", "guinea bissau", "kenia", "kenya", "lesoto", "lesotho",
  "liberia", "libia", "libya", "madagascar", "malaui", "malawi", "mali", "marruecos", "morocco",
  "mauricio", "mauritius", "mauritania", "mozambique", "namibia", "niger", "nigeria",
  "republica centroafricana", "central african republic", "republica democratica del congo",
  "democratic republic of the congo", "republica del congo", "republic of the congo", "ruanda", "rwanda",
  "santo tome y principe", "sao tome and principe", "senegal", "seychelles", "sierra leona", "sierra leone",
  "somalia", "sudafrica", "south africa", "sudan", "sudan del sur", "south sudan", "tanzania", "togo",
  "tunisia", "tunez", "uganda", "zambia", "zimbabue", "zimbabwe"
]);

function isVatExemptCountry(country) {
  const normalized = normalizeCountry(country);
  return AFRICAN_COUNTRIES.has(normalized);
}

async function getShippingSettingsWith(executor) {
  const result = await executor(
    `
      SELECT free_shipping_threshold
      FROM shipping_settings
      WHERE is_active = TRUE
      ORDER BY id ASC
      LIMIT 1
    `
  );
  const row = result.rows[0] || { free_shipping_threshold: 120 };
  return {
    freeShippingThreshold: Number(row.free_shipping_threshold || 0)
  };
}

async function getShippingRatesWith(executor) {
  const result = await executor(
    `
      SELECT id, name, max_weight_kg, max_volume_m3, price, sort_order
      FROM shipping_rates
      WHERE is_active = TRUE
      ORDER BY sort_order ASC, max_weight_kg ASC, max_volume_m3 ASC
    `
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    name: row.name,
    maxWeightKg: Number(row.max_weight_kg || 0),
    maxVolumeM3: Number(row.max_volume_m3 || 0),
    price: Number(row.price || 0),
    sortOrder: Number(row.sort_order || 0)
  }));
}

async function calculateShippingQuoteWith(executor, items, subtotal) {
  const settings = await getShippingSettingsWith(executor);
  const normalizedSubtotal = Number(subtotal || 0);
  const totals = items.reduce(
    (acc, item) => {
      acc.totalWeightKg += Number(item.weightKg || 0) * Number(item.quantity || 0);
      acc.totalVolumeM3 += Number(item.volumeM3 || 0) * Number(item.quantity || 0);
      return acc;
    },
    { totalWeightKg: 0, totalVolumeM3: 0 }
  );

  if (normalizedSubtotal >= settings.freeShippingThreshold && settings.freeShippingThreshold > 0) {
    return {
      shippingCost: 0,
      subtotal: normalizedSubtotal,
      total: normalizedSubtotal,
      totalWeightKg: totals.totalWeightKg,
      totalVolumeM3: totals.totalVolumeM3,
      freeShippingThreshold: settings.freeShippingThreshold,
      isFree: true,
      matchedRate: "Envio gratis"
    };
  }

  const rates = await getShippingRatesWith(executor);
  const matchedRate =
    rates.find((rate) => totals.totalWeightKg <= rate.maxWeightKg && totals.totalVolumeM3 <= rate.maxVolumeM3) ||
    rates[rates.length - 1] ||
    null;
  const shippingCost = matchedRate ? matchedRate.price : 0;

  return {
    shippingCost,
    subtotal: normalizedSubtotal,
    total: normalizedSubtotal + shippingCost,
    totalWeightKg: totals.totalWeightKg,
    totalVolumeM3: totals.totalVolumeM3,
    freeShippingThreshold: settings.freeShippingThreshold,
    amountUntilFreeShipping: Math.max(0, settings.freeShippingThreshold - normalizedSubtotal),
    isFree: shippingCost === 0,
    matchedRate: matchedRate?.name || "Sin tarifa"
  };
}

async function calculateCheckoutQuoteWith(executor, items, destinationCountry, subtotal) {
  const shippingQuote = await calculateShippingQuoteWith(executor, items, subtotal);
  const vatExempt = isVatExemptCountry(destinationCountry);
  const taxAmount = vatExempt
    ? 0
    : items.reduce(
        (sum, item) =>
          sum + Number(item.salePrice || 0) * Number(item.quantity || 0) * (Number(item.vatRate || 0) / 100),
        0
      );

  return {
    ...shippingQuote,
    destinationCountry,
    vatExempt,
    taxAmount,
    total: Number(subtotal || 0) + shippingQuote.shippingCost + taxAmount
  };
}

function mapOrderStatus(status) {
  const labels = {
    received: "Recibido",
    payment_pending: "Pago pendiente",
    payment_confirmed: "Pago confirmado",
    preparing: "Preparando",
    shipped: "Enviado",
    delivered: "Entregado",
    cancelled: "Cancelado"
  };
  return labels[status] || status;
}

function mapPaymentMethod(method) {
  return method === "bank_transfer" ? "Transferencia" : "Tarjeta";
}

function money(value) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(value || 0));
}

function mapCustomer(row) {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username || "",
    fullName: row.full_name,
    companyName: row.company_name || "",
    cif: row.cif || "",
    dni: row.dni,
    phone: row.phone,
    email: row.email,
    shippingStreet: row.street_address,
    shippingProperty: row.property_details || "",
    shippingCity: row.city,
    shippingProvince: row.province,
    shippingCountry: row.country,
    billingStreet: row.billing_street || row.street_address,
    billingProperty: row.billing_property || "",
    billingCity: row.billing_city || row.city,
    billingProvince: row.billing_province || row.province,
    billingCountry: row.billing_country || row.country
  };
}

async function getOrderEmailPayload(orderId) {
  const orderResult = await query(
    `
      SELECT o.order_number, o.subtotal, o.shipping_cost, o.total_amount, o.shipping_name, o.shipping_phone, o.shipping_email,
             o.tax_amount, o.vat_exempt, o.shipping_street, o.shipping_property, o.shipping_city, o.shipping_province,
             o.shipping_country, o.payment_method, o.order_status, o.carrier_name, o.tracking_number, o.tracking_url, c.full_name
      FROM orders o
      INNER JOIN customers c ON c.id = o.customer_id
      WHERE o.id = $1
    `,
    [orderId]
  );
  const order = orderResult.rows[0];
  if (!order) return null;

  const itemsResult = await query(
    `
      SELECT product_name, product_sku, quantity, unit_sale_price
      FROM order_items
      WHERE order_id = $1
      ORDER BY product_name ASC
    `,
    [orderId]
  );

  return {
    orderNumber: order.order_number,
    customerName: order.full_name,
    customerEmail: order.shipping_email,
    customerPhone: order.shipping_phone,
    paymentMethod: mapPaymentMethod(order.payment_method),
    statusLabel: mapOrderStatus(order.order_status),
    subtotal: Number(order.subtotal || 0),
    taxAmount: Number(order.tax_amount || 0),
    vatExempt: Boolean(order.vat_exempt),
    shippingCost: Number(order.shipping_cost || 0),
    total: Number(order.total_amount),
    carrierName: order.carrier_name || "",
    trackingNumber: order.tracking_number || "",
    trackingUrl: order.tracking_url || "",
    shippingStreet: order.shipping_street,
    shippingProperty: order.shipping_property || "",
    shippingCity: order.shipping_city,
    shippingProvince: order.shipping_province,
    shippingCountry: order.shipping_country,
    items: itemsResult.rows.map((item) => ({
      name: item.product_name,
      sku: item.product_sku,
      quantity: Number(item.quantity),
      salePrice: Number(item.unit_sale_price)
    }))
  };
}

async function getInvoiceSettingsWith(executor) {
  const result = await executor(
    `
      SELECT prefix, series_code, last_sequence, fiscal_suffix
      FROM invoice_settings
      WHERE id = 1
    `
  );
  const row = result.rows[0] || {
    prefix: "Factura",
    series_code: "H",
    last_sequence: 132,
    fiscal_suffix: "26"
  };
  const normalizedPrefix = row.prefix === "Factura_H" && row.series_code === "H" ? "Factura" : row.prefix;
  return {
    prefix: normalizedPrefix,
    seriesCode: row.series_code,
    lastSequence: Number(row.last_sequence || 0),
    fiscalSuffix: row.fiscal_suffix
  };
}

async function nextInvoiceNumber(executor) {
  const settings = await getInvoiceSettingsWith(executor);
  const nextSequence = settings.lastSequence + 1;
  const padded = String(nextSequence).padStart(4, "0");
  return {
    invoiceNumber: `${settings.prefix}_${settings.seriesCode}-${padded}/${settings.fiscalSuffix}`,
    nextSequence
  };
}

async function ensureInvoiceForOrder(client, orderId) {
  const current = await client.query(
    "SELECT id, invoice_number, payment_status FROM orders WHERE id = $1",
    [orderId]
  );
  const row = current.rows[0];
  if (!row) return null;
  if (row.invoice_number) return row.invoice_number;
  if (row.payment_status !== "paid") return null;

  const { invoiceNumber, nextSequence } = await nextInvoiceNumber((sql, params) => client.query(sql, params));
  await client.query(
    `
      UPDATE orders
      SET invoice_number = $1,
          invoice_issued_at = COALESCE(invoice_issued_at, NOW())
      WHERE id = $2
    `,
    [invoiceNumber, orderId]
  );
  await client.query(
    `
      UPDATE invoice_settings
      SET last_sequence = $1,
          updated_at = NOW()
      WHERE id = 1
    `,
    [nextSequence]
  );
  return invoiceNumber;
}

async function getInvoicePayloadByOrderNumber({ orderNumber, email, customerUserId }) {
  const params = [orderNumber];
  let accessCondition = "";
  if (customerUserId) {
    params.push(customerUserId);
    accessCondition = "AND c.user_id = $2";
  } else {
    params.push(String(email || "").toLowerCase().trim());
    accessCondition = "AND LOWER(o.shipping_email) = $2";
  }

  const orderResult = await query(
    `
      SELECT o.*, c.full_name, c.company_name, c.cif, c.dni, c.email AS customer_email, c.phone,
             c.billing_street, c.billing_property, c.billing_city, c.billing_province, c.billing_country
      FROM orders o
      INNER JOIN customers c ON c.id = o.customer_id
      WHERE o.order_number = $1 ${accessCondition}
    `,
    params
  );
  const order = orderResult.rows[0];
  if (!order || !order.invoice_number) return null;

  const itemsResult = await query(
    `
      SELECT product_name, product_sku, quantity, unit_sale_price, line_total, unit_sale_price,
             COALESCE(p.vat_rate, 0) AS vat_rate
      FROM order_items
      LEFT JOIN products p ON p.id = order_items.product_id
      WHERE order_id = $1
      ORDER BY product_name ASC
    `,
    [order.id]
  );

  return {
    invoiceNumber: order.invoice_number,
    invoiceIssuedAt: order.invoice_issued_at || order.created_at,
    orderNumber: order.order_number,
    customerName: order.full_name,
    companyName: order.company_name || "",
    cif: order.cif || "",
    dni: order.dni || "",
    customerEmail: order.customer_email,
    customerPhone: order.phone || "",
    billingStreet: order.billing_street || order.shipping_street,
    billingProperty: order.billing_property || "",
    billingCity: order.billing_city || order.shipping_city,
    billingProvince: order.billing_province || order.shipping_province,
    billingCountry: order.billing_country || order.shipping_country,
    subtotal: Number(order.subtotal || 0),
    taxAmount: Number(order.tax_amount || 0),
    vatExempt: Boolean(order.vat_exempt),
    shippingCost: Number(order.shipping_cost || 0),
    total: Number(order.total_amount || 0),
    items: itemsResult.rows.map((item) => ({
      name: item.product_name,
      sku: item.product_sku,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_sale_price),
      lineTotal: Number(item.line_total),
      vatRate: Number(item.vat_rate || 0)
    }))
  };
}

function renderInvoiceHtml(invoice) {
  const issued = new Date(invoice.invoiceIssuedAt).toLocaleDateString("es-ES");
  const customerDoc = invoice.companyName ? `CIF ${invoice.cif}` : `DNI ${invoice.dni}`;
  return `<!doctype html>
  <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Factura ${invoice.invoiceNumber}</title>
      <style>
        body { font-family: Inter, Arial, sans-serif; color: #171717; margin: 40px; }
        .head, .meta, table, .totals { width: 100%; }
        .head { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 32px; }
        h1, h2, h3, p { margin: 0; }
        h1 { font-size: 28px; margin-bottom: 6px; }
        h2 { font-size: 16px; margin-bottom: 8px; }
        .muted { color: #5f5a56; }
        .panel { border: 1px solid #ddd4ca; border-radius: 10px; padding: 18px; }
        table { border-collapse: collapse; margin-top: 24px; }
        th, td { border-bottom: 1px solid #ece6de; padding: 10px 8px; text-align: left; }
        th:last-child, td:last-child { text-align: right; }
        .totals { margin-top: 20px; }
        .totals td { padding: 6px 0; border: 0; }
        .totals td:last-child { text-align: right; font-weight: 700; }
        .strong { font-weight: 800; }
      </style>
    </head>
    <body>
      <div class="head">
        <div>
          <h1>Suministros Santa Emilia SL</h1>
          <p class="muted">C/ Calidad, 34 - Edif. 1 Nave 8 Pol. Ind. Los Olivos</p>
          <p class="muted">Getafe - 28906 - Madrid - España</p>
          <p class="muted">NIF: B87809968</p>
          <p class="muted">pedidos@suministrosemilia.com</p>
        </div>
        <div class="panel">
          <h2>Factura</h2>
          <p><strong>${invoice.invoiceNumber}</strong></p>
          <p class="muted">Fecha: ${issued}</p>
          <p class="muted">Pedido: ${invoice.orderNumber}</p>
        </div>
      </div>
      <div class="head">
        <div class="panel" style="flex:1">
          <h2>Cliente</h2>
          <p class="strong">${invoice.companyName || invoice.customerName}</p>
          ${invoice.companyName ? `<p>${invoice.customerName}</p>` : ""}
          <p>${customerDoc}</p>
          <p>${invoice.customerEmail}</p>
          <p>${invoice.customerPhone}</p>
        </div>
        <div class="panel" style="flex:1">
          <h2>Facturación</h2>
          <p>${invoice.billingStreet}</p>
          ${invoice.billingProperty ? `<p>${invoice.billingProperty}</p>` : ""}
          <p>${invoice.billingCity}, ${invoice.billingProvince}</p>
          <p>${invoice.billingCountry}</p>
        </div>
      </div>
      <table>
        <thead>
          <tr><th>Producto</th><th>SKU</th><th>Ud.</th><th>Precio</th><th>IVA</th><th>Importe</th></tr>
        </thead>
        <tbody>
          ${invoice.items
            .map(
              (item) => `<tr>
                <td>${item.name}</td>
                <td>${item.sku}</td>
                <td>${item.quantity}</td>
                <td>${money(item.unitPrice)}</td>
                <td>${invoice.vatExempt ? "Exento" : `${item.vatRate}%`}</td>
                <td>${money(item.lineTotal)}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
      <table class="totals">
        <tr><td>Subtotal</td><td>${money(invoice.subtotal)}</td></tr>
        <tr><td>${invoice.vatExempt ? "IVA" : "IVA productos"}</td><td>${invoice.vatExempt ? "Exento" : money(invoice.taxAmount)}</td></tr>
        <tr><td>Transporte</td><td>${money(invoice.shippingCost)}</td></tr>
        <tr><td class="strong">Total</td><td>${money(invoice.total)}</td></tr>
      </table>
    </body>
  </html>`;
}

async function ensureCategory(client, categoryName) {
  const slug = slugify(categoryName);
  const existing = await client.query("SELECT id FROM categories WHERE slug = $1", [slug]);
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await client.query(
    "INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id",
    [categoryName, slug]
  );
  return inserted.rows[0].id;
}

async function getCustomerByUserId(userId) {
  const result = await query(
    `
      SELECT c.*, u.username
      FROM customers c
      LEFT JOIN app_users u ON u.id = c.user_id
      WHERE c.user_id = $1
    `,
    [userId]
  );
  return result.rows[0] ? mapCustomer(result.rows[0]) : null;
}

async function createOrUpdateCustomerAccount(client, customer, existingUserId = null) {
  let userId = existingUserId;
  const normalizedEmail = customer.email.toLowerCase();

  if (!userId) {
    const existingUser = await client.query(
      "SELECT id FROM app_users WHERE LOWER(email) = $1 OR LOWER(username) = LOWER($2)",
      [normalizedEmail, customer.username]
    );
    if (existingUser.rows[0]) {
      userId = existingUser.rows[0].id;
      if (customer.password) {
        const passwordHash = await bcrypt.hash(customer.password, 10);
        await client.query(
          "UPDATE app_users SET email = $1, username = $2, password_hash = $3 WHERE id = $4",
          [normalizedEmail, customer.username, passwordHash, userId]
        );
      }
    } else {
      const passwordHash = await bcrypt.hash(customer.password, 10);
      const insertedUser = await client.query(
        `
          INSERT INTO app_users (role, email, username, password_hash)
          VALUES ('customer', $1, $2, $3)
          RETURNING id
        `,
        [normalizedEmail, customer.username, passwordHash]
      );
      userId = insertedUser.rows[0].id;
    }
  }

  const existingCustomer = await client.query("SELECT id FROM customers WHERE user_id = $1 OR LOWER(email) = $2", [
    userId,
    normalizedEmail
  ]);

  const values = [
    userId,
    customer.fullName,
    customer.dni,
    customer.phone,
    normalizedEmail,
    customer.shippingStreet,
    customer.shippingProperty || "",
    customer.shippingCity,
    customer.shippingProvince,
    customer.shippingCountry,
    customer.companyName || "",
    customer.cif || "",
    customer.billingStreet,
    customer.billingProperty || "",
    customer.billingCity,
    customer.billingProvince,
    customer.billingCountry
  ];

  let customerId;
  if (existingCustomer.rows[0]) {
    customerId = existingCustomer.rows[0].id;
    await client.query(
      `
        UPDATE customers
        SET user_id = $1, full_name = $2, dni = $3, phone = $4, email = $5,
            street_address = $6, property_details = $7, city = $8, province = $9, country = $10,
            company_name = $11, cif = $12, billing_street = $13, billing_property = $14,
            billing_city = $15, billing_province = $16, billing_country = $17
        WHERE id = $18
      `,
      [...values, customerId]
    );
  } else {
    const insertedCustomer = await client.query(
      `
        INSERT INTO customers (
          user_id, full_name, dni, phone, email, street_address, property_details, city, province, country,
          company_name, cif, billing_street, billing_property, billing_city, billing_province, billing_country
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING id
      `,
      values
    );
    customerId = insertedCustomer.rows[0].id;
  }

  return { userId, customerId };
}

async function nextOrderNumber(client) {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const result = await client.query(
    "SELECT COUNT(*)::int AS count FROM orders WHERE order_number LIKE $1",
    [`SSE-${stamp}-%`]
  );
  const seq = String(result.rows[0].count + 1).padStart(3, "0");
  return `SSE-${stamp}-${seq}`;
}

app.get("/api/admin/session", (req, res) => {
  const session = getAdminSession(req);
  res.json({ authenticated: Boolean(session), email: session?.email || null });
});

app.post("/api/admin/login", async (req, res) => {
  const email = String(req.body.email || "").toLowerCase().trim();
  const password = String(req.body.password || "");
  if (!email || !password) {
    return res.status(400).json({ error: "Introduce correo y contraseña." });
  }

  let authenticated = false;
  if (ADMIN_EMAIL && ADMIN_PASSWORD && email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    authenticated = true;
  } else {
    const result = await query(
      "SELECT email, password_hash FROM app_users WHERE role = 'admin' AND LOWER(email) = $1 AND is_active = TRUE",
      [email]
    );
    const admin = result.rows[0];
    if (admin?.password_hash && !admin.password_hash.startsWith("CAMBIAR_")) {
      authenticated = await bcrypt.compare(password, admin.password_hash);
    }
  }

  if (!authenticated) {
    return res.status(401).json({ error: "Credenciales de administrador incorrectas." });
  }

  const token = createAdminSession(email);
  res.setHeader("Set-Cookie", `admin_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
  res.json({ ok: true, email });
});

app.post("/api/admin/logout", (req, res) => {
  const cookies = parseCookies(req.headers.cookie || "");
  clearAdminSession(cookies.admin_session);
  res.setHeader("Set-Cookie", "admin_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax");
  res.json({ ok: true });
});

app.get("/api/auth/session", async (req, res) => {
  const session = getCustomerSession(req);
  res.json({ authenticated: Boolean(session), customer: session || null });
});

app.post("/api/auth/register", async (req, res) => {
  const customer = req.body;
  if (!customer.email || !customer.password || !customer.fullName || !customer.username) {
    return res.status(400).json({ error: "Faltan datos obligatorios para el alta." });
  }

  const sessionPayload = await withTransaction(async (client) => {
    const account = await createOrUpdateCustomerAccount(client, customer);
    const createdCustomer = await client.query(
      `
        SELECT c.*, u.username
        FROM customers c
        LEFT JOIN app_users u ON u.id = c.user_id
        WHERE c.id = $1
      `,
      [account.customerId]
    );
    return mapCustomer(createdCustomer.rows[0]);
  });

  const token = createCustomerSession(sessionPayload);
  res.setHeader("Set-Cookie", `customer_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
  res.status(201).json({ ok: true, customer: sessionPayload });
});

app.post("/api/auth/login", async (req, res) => {
  const identifier = String(req.body.identifier || "").trim();
  const password = String(req.body.password || "");
  if (!identifier || !password) {
    return res.status(400).json({ error: "Introduce usuario o email y contraseña." });
  }

  const result = await query(
    `
      SELECT id, email, username, password_hash
      FROM app_users
      WHERE role = 'customer' AND (LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)) AND is_active = TRUE
    `,
    [identifier]
  );
  const user = result.rows[0];
  if (!user) {
    return res.status(401).json({ error: "Cliente no encontrado." });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: "Contraseña incorrecta." });
  }

  const customer = await getCustomerByUserId(user.id);
  if (!customer) {
    return res.status(404).json({ error: "No hay ficha de cliente asociada a esta cuenta." });
  }

  const token = createCustomerSession(customer);
  res.setHeader("Set-Cookie", `customer_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
  res.json({ ok: true, customer });
});

app.post("/api/auth/logout", (req, res) => {
  const cookies = parseCookies(req.headers.cookie || "");
  clearCustomerSession(cookies.customer_session);
  res.setHeader("Set-Cookie", "customer_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax");
  res.json({ ok: true });
});

app.get("/api/payment-options", (_req, res) => {
  res.json({
    card: {
      enabled: false,
      provider: "Stripe o Redsys",
      message: "La tarjeta esta en modo demo hasta configurar la pasarela real."
    },
    bankTransfer: {
      enabled: true,
      message: "La transferencia queda como pago pendiente hasta confirmacion."
    }
  });
});

app.get("/api/health", async (_req, res) => {
  const result = await query("SELECT NOW() AS now");
  res.json({ ok: true, databaseTime: result.rows[0].now });
});

app.get("/api/products", async (_req, res) => {
  const result = await query(
    `
      SELECT p.id, p.name, p.sku, c.name AS category_name, p.description, p.short_description,
             p.sale_price, p.stock_quantity, p.main_image_url, p.weight_kg, p.volume_m3, p.vat_rate
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = TRUE
      ORDER BY p.created_at DESC
    `
  );
  res.json(result.rows.map(mapProduct));
});

app.post("/api/shipping/quote", async (req, res) => {
  const { items, country } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.json({
      subtotal: 0,
      shippingCost: 0,
      total: 0,
      totalWeightKg: 0,
      totalVolumeM3: 0,
      freeShippingThreshold: 0,
      amountUntilFreeShipping: 0,
      isFree: false,
      matchedRate: "Sin productos"
    });
  }

  const normalizedItems = [];
  for (const item of items) {
    const productResult = await query(
      `
        SELECT id, sale_price, stock_quantity, weight_kg, volume_m3
               , vat_rate
        FROM products
        WHERE id = $1 AND is_active = TRUE
      `,
      [item.productId]
    );
    const product = productResult.rows[0];
    if (!product) {
      return res.status(404).json({ error: "Uno de los productos no existe." });
    }

    const quantity = Math.max(1, Number(item.quantity || 1));
    if (quantity > Number(product.stock_quantity)) {
      return res.status(400).json({ error: "No hay stock suficiente para calcular el envio." });
    }

    normalizedItems.push({
      productId: product.id,
      quantity,
      salePrice: Number(product.sale_price || 0),
      vatRate: Number(product.vat_rate || 0),
      weightKg: Number(product.weight_kg || 0),
      volumeM3: Number(product.volume_m3 || 0)
    });
  }

  const subtotal = normalizedItems.reduce((sum, item) => sum + item.salePrice * item.quantity, 0);
  const quote = await calculateCheckoutQuoteWith((sql, params) => query(sql, params), normalizedItems, country, subtotal);
  res.json(quote);
});

app.get("/api/customer/orders", requireCustomer, async (req, res) => {
  const result = await query(
    `
      SELECT o.*
      FROM orders o
      INNER JOIN customers c ON c.id = o.customer_id
      WHERE c.user_id = $1
      ORDER BY o.created_at DESC
    `,
    [req.customer.userId]
  );

  const orders = await Promise.all(
    result.rows.map(async (row) => {
      const itemsResult = await query(
        "SELECT product_name, product_sku, quantity, unit_sale_price FROM order_items WHERE order_id = $1 ORDER BY product_name ASC",
        [row.id]
      );
      return {
        orderNumber: row.order_number,
        createdAt: row.created_at,
        paymentMethod: mapPaymentMethod(row.payment_method),
        statusLabel: mapOrderStatus(row.order_status),
        subtotal: Number(row.subtotal || 0),
        taxAmount: Number(row.tax_amount || 0),
        vatExempt: Boolean(row.vat_exempt),
        shippingCost: Number(row.shipping_cost || 0),
        total: Number(row.total_amount),
        carrierName: row.carrier_name || "",
        trackingNumber: row.tracking_number || "",
        trackingUrl: row.tracking_url || "",
        shippedAt: row.shipped_at,
        invoiceNumber: row.invoice_number || "",
        invoiceIssuedAt: row.invoice_issued_at,
        items: itemsResult.rows.map((item) => ({
          name: item.product_name,
          sku: item.product_sku,
          quantity: Number(item.quantity),
          salePrice: Number(item.unit_sale_price)
        }))
      };
    })
  );

  res.json(orders);
});

app.put("/api/customer/profile", requireCustomer, async (req, res) => {
  const customerPayload = {
    ...req.body,
    email: req.body.email?.toLowerCase(),
    username: req.body.username || req.customer.email.split("@")[0],
    password: req.body.password || undefined
  };

  const result = await withTransaction(async (client) => {
    const account = await createOrUpdateCustomerAccount(client, customerPayload, req.customer.userId);
    const updatedCustomer = await client.query(
      `
        SELECT c.*, u.username
        FROM customers c
        LEFT JOIN app_users u ON u.id = c.user_id
        WHERE c.id = $1
      `,
      [account.customerId]
    );
    return mapCustomer(updatedCustomer.rows[0]);
  });

  const oldCookies = parseCookies(req.headers.cookie || "");
  clearCustomerSession(oldCookies.customer_session);
  const token = createCustomerSession(result);
  res.setHeader("Set-Cookie", `customer_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
  res.json({ ok: true, customer: result });
});

app.get("/api/admin/products", requireAdmin, async (_req, res) => {
  const result = await query(
    `
      SELECT p.id, p.name, p.sku, c.name AS category_name, p.description, p.short_description,
             p.purchase_price, p.sale_price, p.stock_quantity, p.main_image_url, p.weight_kg, p.volume_m3, p.vat_rate
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.created_at DESC
    `
  );
  res.json(result.rows.map(mapProduct));
});

app.post("/api/admin/products", requireAdmin, async (req, res) => {
  const { name, sku, category, description, costPrice, salePrice, stock, image, weightKg, volumeM3, vatRate } = req.body;
  if (!name || !sku || !category || !description) {
    return res.status(400).json({ error: "Faltan campos obligatorios del producto." });
  }

  const product = await withTransaction(async (client) => {
    const categoryId = await ensureCategory(client, category);
    const slug = slugify(`${name}-${sku}`);
    const inserted = await client.query(
      `
        INSERT INTO products (
          category_id, name, slug, sku, short_description, description,
          purchase_price, sale_price, stock_quantity, main_image_url, weight_kg, volume_m3, vat_rate
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id
      `,
      [
        categoryId,
        name,
        slug,
        sku,
        description.slice(0, 280),
        description,
        Number(costPrice || 0),
        Number(salePrice || 0),
        Number(stock || 0),
        image || null,
        Number(weightKg || 0),
        Number(volumeM3 || 0),
        Number(vatRate || 0)
      ]
    );

    if (Number(stock || 0) > 0) {
      await client.query(
        `
          INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_type, notes)
          VALUES ($1, 'in', $2, 'admin', 'Alta inicial de producto')
        `,
        [inserted.rows[0].id, Number(stock)]
      );
    }

    return inserted.rows[0];
  });

  res.status(201).json({ ok: true, id: product.id });
});

app.put("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, sku, category, description, costPrice, salePrice, stock, image, weightKg, volumeM3, vatRate } = req.body;

  const updated = await withTransaction(async (client) => {
    const currentResult = await client.query("SELECT stock_quantity FROM products WHERE id = $1", [id]);
    const current = currentResult.rows[0];
    if (!current) return null;

    const categoryId = await ensureCategory(client, category);
    const slug = slugify(`${name}-${sku}`);

    await client.query(
      `
        UPDATE products
        SET category_id = $1, name = $2, slug = $3, sku = $4, short_description = $5, description = $6,
            purchase_price = $7, sale_price = $8, stock_quantity = $9, main_image_url = $10,
            weight_kg = $11, volume_m3 = $12, vat_rate = $13
        WHERE id = $14
      `,
      [
        categoryId,
        name,
        slug,
        sku,
        description.slice(0, 280),
        description,
        Number(costPrice || 0),
        Number(salePrice || 0),
        Number(stock || 0),
        image || null,
        Number(weightKg || 0),
        Number(volumeM3 || 0),
        Number(vatRate || 0),
        id
      ]
    );

    const diff = Number(stock || 0) - Number(current.stock_quantity);
    if (diff !== 0) {
      await client.query(
        `
          INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_type, reference_id, notes)
          VALUES ($1, $2, $3, 'admin', $4, 'Ajuste manual de stock')
        `,
        [id, diff > 0 ? "in" : "adjustment", Math.abs(diff), id]
      );
    }

    return { id };
  });

  if (!updated) {
    return res.status(404).json({ error: "Producto no encontrado." });
  }

  res.json({ ok: true });
});

app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const deleted = await query("DELETE FROM products WHERE id = $1", [req.params.id]);
  if (deleted.rowCount === 0) {
    return res.status(404).json({ error: "Producto no encontrado." });
  }
  res.json({ ok: true });
});

app.get("/api/admin/customers", requireAdmin, async (_req, res) => {
  const result = await query(
    `
      SELECT c.*,
             COUNT(o.id)::int AS total_orders
      FROM customers c
      LEFT JOIN orders o ON o.customer_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `
  );
  res.json(
    result.rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      companyName: row.company_name || "",
      cif: row.cif || "",
      dni: row.dni,
      phone: row.phone,
      email: row.email,
      shippingStreet: row.street_address,
      shippingProperty: row.property_details || "",
      shippingCity: row.city,
      shippingProvince: row.province,
      shippingCountry: row.country,
      billingStreet: row.billing_street || row.street_address,
      billingProperty: row.billing_property || "",
      billingCity: row.billing_city || row.city,
      billingProvince: row.billing_province || row.province,
      billingCountry: row.billing_country || row.country,
      totalOrders: Number(row.total_orders)
    }))
  );
});

app.get("/api/admin/orders", requireAdmin, async (_req, res) => {
  const result = await query(
    `
      SELECT o.*, c.full_name, c.email
      FROM orders o
      INNER JOIN customers c ON c.id = o.customer_id
      ORDER BY o.created_at DESC
    `
  );

  const orders = await Promise.all(
    result.rows.map(async (row) => {
      const itemsResult = await query(
        `
          SELECT product_name, product_sku, quantity, unit_sale_price
          FROM order_items
          WHERE order_id = $1
          ORDER BY product_name ASC
        `,
        [row.id]
      );
      return {
        id: row.id,
        orderNumber: row.order_number,
        createdAt: row.created_at,
        customerName: row.full_name,
        customerEmail: row.email,
        paymentMethod: mapPaymentMethod(row.payment_method),
        orderStatus: row.order_status,
        orderStatusLabel: mapOrderStatus(row.order_status),
        paymentStatus: row.payment_status,
        subtotal: Number(row.subtotal || 0),
        taxAmount: Number(row.tax_amount || 0),
        vatExempt: Boolean(row.vat_exempt),
        shippingCost: Number(row.shipping_cost || 0),
        total: Number(row.total_amount),
        cost: Number(row.total_cost),
        profit: Number(row.total_profit),
        carrierName: row.carrier_name || "",
        trackingNumber: row.tracking_number || "",
        trackingUrl: row.tracking_url || "",
        shippedAt: row.shipped_at,
        invoiceNumber: row.invoice_number || "",
        invoiceIssuedAt: row.invoice_issued_at,
        items: itemsResult.rows.map((item) => ({
          name: item.product_name,
          sku: item.product_sku,
          quantity: Number(item.quantity),
          salePrice: Number(item.unit_sale_price)
        }))
      };
    })
  );

  res.json(orders);
});

app.patch("/api/admin/orders/:id/status", requireAdmin, async (req, res) => {
  const { status } = req.body;
  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: "Estado no valido." });
  }

  const paymentStatus = status === "payment_pending" ? "pending" : status === "cancelled" ? "failed" : undefined;

  const result = await withTransaction(async (client) => {
    const current = await client.query("SELECT id FROM orders WHERE id = $1", [req.params.id]);
    if (!current.rows[0]) return null;

    await client.query(
      `
        UPDATE orders
        SET order_status = $1,
            payment_status = COALESCE($2, payment_status)
        WHERE id = $3
      `,
      [status, paymentStatus, req.params.id]
    );

    await client.query(
      "INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)",
      [req.params.id, status, "Cambio de estado desde administracion"]
    );

    if (status === "payment_confirmed") {
      await ensureInvoiceForOrder(client, req.params.id);
    }

    return { id: req.params.id };
  });

  if (!result) {
    return res.status(404).json({ error: "Pedido no encontrado." });
  }

  if (status === "payment_confirmed") {
    const payload = await getOrderEmailPayload(req.params.id);
    if (payload) {
      sendPaidOrderEmails(payload).catch((error) => {
        console.error("Error enviando correos tras confirmacion manual:", error);
      });
    }
  }

  res.json({ ok: true });
});

app.patch("/api/admin/orders/:id/shipment", requireAdmin, async (req, res) => {
  const { carrierName, trackingNumber, trackingUrl, shippedAt, markAsShipped } = req.body;
  const finalShippedAt = shippedAt || (markAsShipped ? new Date().toISOString() : null);

  const result = await withTransaction(async (client) => {
    const current = await client.query(
      "SELECT id, order_status FROM orders WHERE id = $1",
      [req.params.id]
    );
    if (!current.rows[0]) return null;

    const nextStatus = markAsShipped ? "shipped" : current.rows[0].order_status;
    await client.query(
      `
        UPDATE orders
        SET carrier_name = $1,
            tracking_number = $2,
            tracking_url = $3,
            shipped_at = COALESCE($4::timestamptz, shipped_at),
            order_status = $5
        WHERE id = $6
      `,
      [
        carrierName?.trim() || null,
        trackingNumber?.trim() || null,
        trackingUrl?.trim() || null,
        finalShippedAt,
        nextStatus,
        req.params.id
      ]
    );

    await ensureInvoiceForOrder(client, req.params.id);

    await client.query(
      "INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)",
      [
        req.params.id,
        nextStatus,
        `Datos de expedicion actualizados${carrierName ? ` (${carrierName})` : ""}`
      ]
    );

    return { ok: true };
  });

  if (!result) {
    return res.status(404).json({ error: "Pedido no encontrado." });
  }

  if (markAsShipped) {
    const payload = await getOrderEmailPayload(req.params.id);
    if (payload) {
      sendShippedOrderEmails(payload).catch((error) => {
        console.error("Error enviando correos tras expedicion:", error);
      });
    }
  }

  res.json({ ok: true });
});

app.get("/api/admin/orders/:id/invoice", requireAdmin, async (req, res) => {
  await withTransaction(async (client) => {
    await ensureInvoiceForOrder(client, req.params.id);
  });
  const result = await query("SELECT order_number, shipping_email FROM orders WHERE id = $1", [req.params.id]);
  const row = result.rows[0];
  if (!row) {
    return res.status(404).send("Factura no disponible.");
  }
  const invoice = await getInvoicePayloadByOrderNumber({ orderNumber: row.order_number, email: row.shipping_email });
  if (!invoice) {
    return res.status(404).send("Factura no disponible.");
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename=\"${invoice.invoiceNumber}.html\"`);
  res.send(renderInvoiceHtml(invoice));
});

app.get("/api/admin/shipping", requireAdmin, async (_req, res) => {
  const [settings, rates] = await Promise.all([
    getShippingSettingsWith((sql, params) => query(sql, params)),
    getShippingRatesWith((sql, params) => query(sql, params))
  ]);
  res.json({ settings, rates });
});

app.get("/api/admin/invoicing", requireAdmin, async (_req, res) => {
  const settings = await getInvoiceSettingsWith((sql, params) => query(sql, params));
  res.json(settings);
});

app.put("/api/admin/invoicing", requireAdmin, async (req, res) => {
  const prefix = String(req.body.prefix || "Factura_H").trim() || "Factura_H";
  const seriesCode = String(req.body.seriesCode || "H").trim() || "H";
  const lastSequence = Math.max(0, Number(req.body.lastSequence || 0));
  const fiscalSuffix = String(req.body.fiscalSuffix || "26").trim() || "26";

  await query(
    `
      UPDATE invoice_settings
      SET prefix = $1,
          series_code = $2,
          last_sequence = $3,
          fiscal_suffix = $4,
          updated_at = NOW()
      WHERE id = 1
    `,
    [prefix, seriesCode, lastSequence, fiscalSuffix]
  );

  res.json({ ok: true });
});

app.put("/api/admin/shipping/settings", requireAdmin, async (req, res) => {
  const freeShippingThreshold = Math.max(0, Number(req.body.freeShippingThreshold || 0));
  await query(
    `
      UPDATE shipping_settings
      SET free_shipping_threshold = $1,
          updated_at = NOW()
      WHERE id = 1
    `,
    [freeShippingThreshold]
  );
  res.json({ ok: true });
});

app.post("/api/admin/shipping/rates", requireAdmin, async (req, res) => {
  const { name, maxWeightKg, maxVolumeM3, price, sortOrder } = req.body;
  if (!name) {
    return res.status(400).json({ error: "La tarifa necesita un nombre." });
  }
  const result = await query(
    `
      INSERT INTO shipping_rates (name, max_weight_kg, max_volume_m3, price, sort_order, is_active, updated_at)
      VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
      RETURNING id
    `,
    [name.trim(), Number(maxWeightKg || 0), Number(maxVolumeM3 || 0), Number(price || 0), Number(sortOrder || 0)]
  );
  res.status(201).json({ ok: true, id: String(result.rows[0].id) });
});

app.put("/api/admin/shipping/rates/:id", requireAdmin, async (req, res) => {
  const { name, maxWeightKg, maxVolumeM3, price, sortOrder } = req.body;
  const result = await query(
    `
      UPDATE shipping_rates
      SET name = $1,
          max_weight_kg = $2,
          max_volume_m3 = $3,
          price = $4,
          sort_order = $5,
          updated_at = NOW()
      WHERE id = $6
    `,
    [name.trim(), Number(maxWeightKg || 0), Number(maxVolumeM3 || 0), Number(price || 0), Number(sortOrder || 0), req.params.id]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Tarifa no encontrada." });
  }
  res.json({ ok: true });
});

app.delete("/api/admin/shipping/rates/:id", requireAdmin, async (req, res) => {
  const result = await query("DELETE FROM shipping_rates WHERE id = $1", [req.params.id]);
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Tarifa no encontrada." });
  }
  res.json({ ok: true });
});

app.get("/api/admin/stats", requireAdmin, async (_req, res) => {
  const summary = await query("SELECT * FROM v_sales_summary");
  const productSales = await query(
    `
      SELECT vps.*, p.stock_quantity
      FROM v_product_sales vps
      LEFT JOIN products p ON p.id = vps.product_id
      ORDER BY units_sold DESC, product_name ASC
    `
  );

  const totals = summary.rows[0] || {
    total_orders: 0,
    total_revenue: 0,
    total_cost: 0,
    total_profit: 0
  };

  res.json({
    totalOrders: Number(totals.total_orders),
    totalRevenue: Number(totals.total_revenue),
    totalCost: Number(totals.total_cost),
    totalProfit: Number(totals.total_profit),
    totalUnits: productSales.rows.reduce((sum, row) => sum + Number(row.units_sold), 0),
    byProduct: productSales.rows.map((row) => ({
      productId: row.product_id,
      productName: row.product_name,
      sku: row.product_sku,
      unitsSold: Number(row.units_sold),
      stock: Number(row.stock_quantity || 0),
      revenue: Number(row.revenue),
      cost: Number(row.cost),
      profit: Number(row.profit)
    }))
  });
});

app.post("/api/orders", async (req, res) => {
  const { customer, items, paymentMethod } = req.body;
  if (!customer || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Faltan datos para crear el pedido." });
  }
  if (!customer.email || !customer.fullName || !customer.shippingStreet || !customer.billingStreet) {
    return res.status(400).json({ error: "Completa los datos del cliente, entrega y facturacion." });
  }

  const order = await withTransaction(async (client) => {
    const activeCustomerSession = getCustomerSession(req);
    const normalizedCustomer = {
      ...customer,
      email: customer.email.toLowerCase(),
      username: customer.username || customer.email.split("@")[0],
      shippingStreet: customer.shippingStreet,
      shippingProperty: customer.shippingProperty || "",
      shippingCity: customer.shippingCity,
      shippingProvince: customer.shippingProvince,
      shippingCountry: customer.shippingCountry,
      billingStreet: customer.billingStreet,
      billingProperty: customer.billingProperty || "",
      billingCity: customer.billingCity,
      billingProvince: customer.billingProvince,
      billingCountry: customer.billingCountry,
      companyName: customer.companyName || "",
      cif: customer.cif || ""
    };

    const account = await createOrUpdateCustomerAccount(client, normalizedCustomer, activeCustomerSession?.userId || null);
    const userId = account.userId;
    const customerId = account.customerId;

    const orderItems = [];
    for (const item of items) {
      const productResult = await client.query(
        `
          SELECT id, name, sku, sale_price, purchase_price, stock_quantity, weight_kg, volume_m3, vat_rate
          FROM products
          WHERE id = $1 AND is_active = TRUE
        `,
        [item.productId]
      );
      const product = productResult.rows[0];
      if (!product) {
        throw new Error("Uno de los productos no existe.");
      }
      if (Number(product.stock_quantity) < Number(item.quantity)) {
        throw new Error(`Stock insuficiente para ${product.name}.`);
      }
      orderItems.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        quantity: Number(item.quantity),
        salePrice: Number(product.sale_price),
        purchasePrice: Number(product.purchase_price),
        vatRate: Number(product.vat_rate || 0),
        weightKg: Number(product.weight_kg || 0),
        volumeM3: Number(product.volume_m3 || 0)
      });
    }

    const subtotal = orderItems.reduce((sum, item) => sum + item.salePrice * item.quantity, 0);
    const totalCost = orderItems.reduce((sum, item) => sum + item.purchasePrice * item.quantity, 0);
    const checkoutQuote = await calculateCheckoutQuoteWith(
      (sql, params) => client.query(sql, params),
      orderItems,
      normalizedCustomer.shippingCountry,
      subtotal
    );
    const normalizedShippingCost = checkoutQuote.shippingCost;
    const taxAmount = checkoutQuote.taxAmount;
    const totalAmount = checkoutQuote.total;
    const totalProfit = subtotal + normalizedShippingCost - totalCost;
    const orderNumber = await nextOrderNumber(client);
    const normalizedPaymentMethod = paymentMethod === "Transferencia" ? "bank_transfer" : "card";
    const paymentStatus = normalizedPaymentMethod === "bank_transfer" ? "pending" : "paid";
    const orderStatus = normalizedPaymentMethod === "bank_transfer" ? "payment_pending" : "payment_confirmed";

    const insertedOrder = await client.query(
      `
        INSERT INTO orders (
          order_number, customer_id, user_id, payment_method, payment_status, order_status,
          subtotal, tax_amount, vat_exempt, shipping_cost, total_amount, total_cost, total_profit,
          shipping_name, shipping_phone, shipping_email, shipping_street,
          shipping_property, shipping_city, shipping_province, shipping_country
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        RETURNING id, order_number, order_status, payment_status, subtotal, tax_amount, vat_exempt, shipping_cost, total_amount
      `,
      [
        orderNumber,
        customerId,
        userId,
        normalizedPaymentMethod,
        paymentStatus,
        orderStatus,
        subtotal,
        taxAmount,
        checkoutQuote.vatExempt,
        normalizedShippingCost,
        totalAmount,
        totalCost,
        totalProfit,
        customer.fullName,
        customer.phone,
        normalizedCustomer.email,
        normalizedCustomer.shippingStreet,
        normalizedCustomer.shippingProperty || "",
        normalizedCustomer.shippingCity,
        normalizedCustomer.shippingProvince,
        normalizedCustomer.shippingCountry
      ]
    );
    const orderRow = insertedOrder.rows[0];

    for (const item of orderItems) {
      await client.query(
        `
          INSERT INTO order_items (
            order_id, product_id, product_name, product_sku, quantity,
            unit_sale_price, unit_purchase_price, line_total, line_cost, line_profit
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          orderRow.id,
          item.productId,
          item.name,
          item.sku,
          item.quantity,
          item.salePrice,
          item.purchasePrice,
          item.salePrice * item.quantity,
          item.purchasePrice * item.quantity,
          (item.salePrice - item.purchasePrice) * item.quantity
        ]
      );

      await client.query(
        "UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2",
        [item.quantity, item.productId]
      );
      await client.query(
        `
          INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_type, reference_id, notes)
          VALUES ($1, 'out', $2, 'order', $3, 'Venta de producto')
        `,
        [item.productId, item.quantity, orderRow.id]
      );
    }

    await client.query(
      `
        INSERT INTO payments (order_id, provider, payment_method, amount, status, paid_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        orderRow.id,
        normalizedPaymentMethod === "bank_transfer" ? "manual_transfer" : "demo_card",
        normalizedPaymentMethod,
        totalAmount,
        paymentStatus,
        paymentStatus === "paid" ? new Date() : null
      ]
    );

    await client.query(
      "INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)",
      [orderRow.id, orderStatus, "Pedido creado desde la tienda online"]
    );

    if (paymentStatus === "paid") {
      await ensureInvoiceForOrder(client, orderRow.id);
      const refreshedOrder = await client.query(
        "SELECT invoice_number, invoice_issued_at FROM orders WHERE id = $1",
        [orderRow.id]
      );
      orderRow.invoice_number = refreshedOrder.rows[0]?.invoice_number || null;
      orderRow.invoice_issued_at = refreshedOrder.rows[0]?.invoice_issued_at || null;
    }

    return {
      id: orderRow.id,
      orderNumber: orderRow.order_number,
      status: orderRow.order_status,
      statusLabel: mapOrderStatus(orderRow.order_status),
      paymentStatus: orderRow.payment_status,
      paymentMethod: mapPaymentMethod(normalizedPaymentMethod),
      subtotal: Number(orderRow.subtotal || 0),
      taxAmount: Number(orderRow.tax_amount || 0),
      vatExempt: Boolean(orderRow.vat_exempt),
      shippingCost: Number(orderRow.shipping_cost || 0),
      total: Number(orderRow.total_amount),
      totalWeightKg: checkoutQuote.totalWeightKg,
      totalVolumeM3: checkoutQuote.totalVolumeM3,
      matchedRate: checkoutQuote.matchedRate,
      freeShippingThreshold: checkoutQuote.freeShippingThreshold,
      invoiceNumber: orderRow.invoice_number || "",
      invoiceIssuedAt: orderRow.invoice_issued_at || null,
      customerName: normalizedCustomer.fullName,
      customerEmail: normalizedCustomer.email,
      customerPhone: normalizedCustomer.phone,
      shippingStreet: normalizedCustomer.shippingStreet,
      shippingProperty: normalizedCustomer.shippingProperty || "",
      shippingCity: normalizedCustomer.shippingCity,
      shippingProvince: normalizedCustomer.shippingProvince,
      shippingCountry: normalizedCustomer.shippingCountry,
      items: orderItems.map((item) => ({
        name: item.name,
        sku: item.sku,
        quantity: item.quantity,
        salePrice: item.salePrice
      }))
    };
  });

  if (order.paymentStatus === "paid") {
    sendPaidOrderEmails(order).catch((error) => {
      console.error("Error enviando correos tras pago:", error);
    });
  }

  if (!getCustomerSession(req)) {
    const persistedCustomer = await query(
      `
        SELECT c.*, u.username
        FROM customers c
        LEFT JOIN app_users u ON u.id = c.user_id
        WHERE LOWER(c.email) = $1
      `,
      [customer.email.toLowerCase()]
    );
    if (persistedCustomer.rows[0]) {
      const payload = mapCustomer(persistedCustomer.rows[0]);
      const token = createCustomerSession(payload);
      res.setHeader("Set-Cookie", `customer_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
    }
  }

  res.status(201).json(order);
});

app.get("/api/orders/:orderNumber", async (req, res) => {
  const email = String(req.query.email || "").toLowerCase().trim();
  const result = await query(
    `
      SELECT o.*, c.full_name
      FROM orders o
      INNER JOIN customers c ON c.id = o.customer_id
      WHERE o.order_number = $1 AND LOWER(o.shipping_email) = $2
    `,
    [req.params.orderNumber, email]
  );
  const row = result.rows[0];
  if (!row) {
    return res.status(404).json({ error: "Pedido no encontrado." });
  }

  const itemsResult = await query(
    `
      SELECT product_name, quantity
      FROM order_items
      WHERE order_id = $1
      ORDER BY product_name ASC
    `,
    [row.id]
  );

  res.json({
    orderNumber: row.order_number,
    customerName: row.full_name,
    paymentMethod: mapPaymentMethod(row.payment_method),
    paymentStatus: row.payment_status,
    status: row.order_status,
    statusLabel: mapOrderStatus(row.order_status),
    subtotal: Number(row.subtotal || 0),
    taxAmount: Number(row.tax_amount || 0),
    vatExempt: Boolean(row.vat_exempt),
    shippingCost: Number(row.shipping_cost || 0),
    total: Number(row.total_amount),
    carrierName: row.carrier_name || "",
    trackingNumber: row.tracking_number || "",
    trackingUrl: row.tracking_url || "",
    shippedAt: row.shipped_at,
    invoiceNumber: row.invoice_number || "",
    invoiceIssuedAt: row.invoice_issued_at,
    items: itemsResult.rows.map((item) => ({
      name: item.product_name,
      quantity: Number(item.quantity)
    }))
  });
});

app.get("/api/customer/orders/:orderNumber/invoice", requireCustomer, async (req, res) => {
  await withTransaction(async (client) => {
    const current = await client.query("SELECT id FROM orders WHERE order_number = $1", [req.params.orderNumber]);
    if (current.rows[0]) {
      await ensureInvoiceForOrder(client, current.rows[0].id);
    }
  });
  const invoice = await getInvoicePayloadByOrderNumber({
    orderNumber: req.params.orderNumber,
    customerUserId: req.customer.userId
  });
  if (!invoice) {
    return res.status(404).send("Factura no disponible.");
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename=\"${invoice.invoiceNumber}.html\"`);
  res.send(renderInvoiceHtml(invoice));
});

app.get("/api/orders/:orderNumber/invoice", async (req, res) => {
  await withTransaction(async (client) => {
    const current = await client.query("SELECT id FROM orders WHERE order_number = $1", [req.params.orderNumber]);
    if (current.rows[0]) {
      await ensureInvoiceForOrder(client, current.rows[0].id);
    }
  });
  const invoice = await getInvoicePayloadByOrderNumber({
    orderNumber: req.params.orderNumber,
    email: req.query.email
  });
  if (!invoice) {
    return res.status(404).send("Factura no disponible.");
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename=\"${invoice.invoiceNumber}.html\"`);
  res.send(renderInvoiceHtml(invoice));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || "Error interno del servidor." });
});

async function startServer() {
  await initializeRuntimeSchema();
  app.listen(PORT, () => {
    console.log(`Suministros Santa Emilia backend escuchando en http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("No se pudo arrancar el servidor:", error);
  process.exit(1);
});
