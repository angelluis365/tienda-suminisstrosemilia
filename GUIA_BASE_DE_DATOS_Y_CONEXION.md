# Guia paso a paso para dejar operativa la web con base de datos real

Esta guia parte de la web actual de `Suministros Santa Emilia SL` y te lleva hasta una instalacion operativa con base de datos PostgreSQL y conexion real entre la web y el servidor.

## 1. Que tienes ahora mismo

La web actual funciona en el navegador y guarda datos en `localStorage`:

- productos
- compradores
- pedidos
- stock
- estadisticas

Eso sirve para demo y validacion visual, pero no para produccion.

## 2. Que necesitas para produccion

Necesitas 4 piezas:

1. Frontend: la web que ve el cliente.
2. Backend: un servidor que reciba peticiones y hable con la base de datos.
3. Base de datos: PostgreSQL.
4. Pasarela de pago: Stripe o Redsys.

## 3. Archivos SQL que ya te he dejado preparados

En esta carpeta:

- [database/postgresql/01_schema.sql](/Users/angelluisabujamartinez/Documents/New%20project/database/postgresql/01_schema.sql)
- [database/postgresql/02_seed.sql](/Users/angelluisabujamartinez/Documents/New%20project/database/postgresql/02_seed.sql)
- [database/postgresql/03_views.sql](/Users/angelluisabujamartinez/Documents/New%20project/database/postgresql/03_views.sql)

Orden de importacion:

1. `01_schema.sql`
2. `02_seed.sql`
3. `03_views.sql`

## 4. Que crea la base de datos

### Tablas principales

- `app_users`: usuarios administradores y clientes.
- `customers`: datos completos del comprador.
- `categories`: categorias de producto.
- `products`: productos con SKU, descripcion, precios y stock.
- `product_images`: fotos del producto.
- `orders`: cabecera del pedido.
- `order_items`: lineas del pedido.
- `payments`: pagos por tarjeta o transferencia.
- `order_status_history`: historial de estados del pedido.
- `inventory_movements`: movimientos de stock.

### Vistas listas para usar

- `v_product_catalog`: catalogo publico.
- `v_sales_summary`: resumen total de ventas, coste y beneficio.
- `v_product_sales`: ventas por producto.
- `v_low_stock_products`: alertas de stock bajo.

## 5. Como crear la base de datos en PostgreSQL

### Opcion A: desde pgAdmin

1. Instala PostgreSQL y pgAdmin.
2. Abre pgAdmin.
3. Crea una base nueva llamada `santa_emilia_shop`.
4. Abre el Query Tool.
5. Ejecuta `01_schema.sql`.
6. Ejecuta `02_seed.sql`.
7. Ejecuta `03_views.sql`.

### Opcion B: desde terminal

Primero crea la base:

```bash
createdb santa_emilia_shop
```

Despues importa los archivos:

```bash
psql -d santa_emilia_shop -f database/postgresql/01_schema.sql
psql -d santa_emilia_shop -f database/postgresql/02_seed.sql
psql -d santa_emilia_shop -f database/postgresql/03_views.sql
```

## 6. Que debes cambiar antes de usarla

En `02_seed.sql` hay dos usuarios de ejemplo. Cambia estas claves:

- `CAMBIAR_POR_HASH_BCRYPT_ADMIN`
- `CAMBIAR_POR_HASH_BCRYPT_CLIENTE`

Nunca guardes claves en texto plano.

## 7. Como se engancha la web con la base de datos

La pagina web no debe hablar directamente con PostgreSQL. El flujo correcto es:

1. La web hace una llamada HTTP al backend.
2. El backend valida los datos.
3. El backend consulta o modifica PostgreSQL.
4. El backend devuelve JSON.
5. La web pinta el resultado.

## 8. Endpoints que necesita el backend

### Catalogo

- `GET /api/products`
- `GET /api/products/:slug`

### Clientes y acceso

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/customers/me`

### Pedidos

- `POST /api/orders`
- `GET /api/orders/:orderNumber`
- `PATCH /api/orders/:orderId/status`

### Admin

- `POST /api/admin/products`
- `PUT /api/admin/products/:id`
- `DELETE /api/admin/products/:id`
- `GET /api/admin/stats`

### Pagos

- `POST /api/payments/create-card-session`
- `POST /api/payments/bank-transfer`
- `POST /api/payments/webhook`

## 9. Ejemplo real de funcionamiento

### Alta de producto

1. En el panel admin rellenas nombre, SKU, categoria, stock, compra y venta.
2. La web envia un `POST /api/admin/products`.
3. El backend guarda el producto en `products`.
4. Si hay foto, la sube a almacenamiento y guarda la URL en `main_image_url`.

### Compra

1. El cliente mete productos en el carrito.
2. La web envia un `POST /api/orders`.
3. El backend:
   - comprueba stock
   - crea o recupera el cliente
   - crea el pedido en `orders`
   - crea lineas en `order_items`
   - descuenta stock en `products`
   - registra movimientos en `inventory_movements`
4. Si el pago es tarjeta, crea sesion en Stripe o Redsys.
5. Si el pago es transferencia, guarda `payment_status = pending`.

### Seguimiento

1. El cliente consulta el pedido con numero y correo.
2. La web llama a `GET /api/orders/:orderNumber?email=...`
3. El backend devuelve el estado actual.

## 10. Que hay que cambiar en la web actual

Ahora mismo `app.js` guarda todo en navegador. Para hacerla operativa hay que sustituir esa parte por llamadas `fetch()`.

### Lo que debes reemplazar

- carga de productos desde `localStorage`
- guardado de clientes
- generacion de pedidos
- consulta de seguimiento
- estadisticas del panel

### Ejemplo de carga de catalogo

```js
async function loadProductsFromApi() {
  const response = await fetch("/api/products");
  const products = await response.json();
  state.products = products;
  renderCategories();
  renderProducts();
}
```

### Ejemplo de creacion de pedido

```js
async function createOrder(payload) {
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("No se pudo crear el pedido");
  }

  return response.json();
}
```

## 11. Estructura minima recomendada del backend

Puedes montarlo con Laravel, Node.js o Django. Si quieres ir rapido, te recomiendo:

- Backend: Node.js + Express
- ORM: Prisma o Knex
- Base de datos: PostgreSQL
- Pago tarjeta: Stripe
- Correo: Resend, Brevo o SMTP del hosting

Estructura minima:

- `server.js`
- `routes/products.js`
- `routes/orders.js`
- `routes/auth.js`
- `routes/admin.js`
- `services/paymentService.js`
- `services/mailService.js`
- `db/connection.js`

## 12. Orden exacto para ponerla en marcha

1. Contratar hosting o VPS.
2. Instalar PostgreSQL.
3. Crear la base `santa_emilia_shop`.
4. Importar los 3 archivos SQL.
5. Crear backend con API REST.
6. Conectar backend a PostgreSQL.
7. Sustituir en la web el `localStorage` por `fetch`.
8. Configurar subida de fotos.
9. Conectar Stripe o Redsys.
10. Configurar correos transaccionales.
11. Activar HTTPS.
12. Probar compras, stock y cambios de estado.
13. Publicar dominio real.

## 13. Comandos SQL utiles

Ver productos:

```sql
SELECT * FROM v_product_catalog;
```

Ver pedidos:

```sql
SELECT order_number, order_status, payment_status, total_amount
FROM orders
ORDER BY created_at DESC;
```

Ver estadisticas:

```sql
SELECT * FROM v_sales_summary;
```

Ver stock bajo:

```sql
SELECT * FROM v_low_stock_products;
```

## 14. Importante sobre pagos

La web actual no cobra de verdad. Solo simula el flujo. Para que cobre de verdad:

- Stripe: debes crear cuenta, claves API, webhook y pantalla de confirmacion.
- Redsys: debes pedir alta al banco, recibir parametros de comercio y configurar firma.

## 15. Recomendacion final

Lo mas sensato para que quede operativa de verdad es hacer la siguiente fase:

1. Mantener esta web como base visual.
2. Crear backend real.
3. Importar esta base PostgreSQL.
4. Conectar pagos.
5. Hacer pruebas completas antes de abrir ventas.

Si quieres, el siguiente paso natural es que te cree directamente el backend completo para esta web con Node.js + Express + PostgreSQL y te deje la conexion ya hecha.
