# Backend de la tienda: arranque rapido

## 1. Crear el archivo de entorno

Haz una copia de:

- [`.env.example`](/Users/angelluisabujamartinez/Documents/New%20project/.env.example)

como:

- `.env`

Y rellena al menos:

```env
PORT=3000
PGHOST=localhost
PGPORT=5432
PGDATABASE=santa_emilia_shop
PGUSER=postgres
PGPASSWORD=TU_PASSWORD_REAL
```

## 2. Instalar dependencias

```bash
npm install
```

## 3. Arrancar el backend

Modo normal:

```bash
npm start
```

Modo desarrollo:

```bash
npm run dev
```

La web quedara servida desde:

- `http://localhost:3000`

## 4. API disponible

- `GET /api/health`
- `GET /api/products`
- `GET /api/admin/products`
- `POST /api/admin/products`
- `PUT /api/admin/products/:id`
- `DELETE /api/admin/products/:id`
- `GET /api/admin/customers`
- `GET /api/admin/orders`
- `PATCH /api/admin/orders/:id/status`
- `GET /api/admin/stats`
- `POST /api/orders`
- `GET /api/orders/:orderNumber?email=...`

## 5. Notas importantes

- La tarjeta esta en modo demo de backend, no cobra de verdad todavia.
- La transferencia se registra como pago pendiente.
- Las fotos se pueden guardar como URL o en base64 en esta fase inicial.
- El frontend ya no depende de `localStorage` para productos, pedidos, clientes ni estadisticas.

## 6. Siguiente mejora recomendada

La siguiente fase natural es añadir:

- login real de administrador
- login real de clientes
- Stripe o Redsys
- subida de imagenes a almacenamiento externo
- correos automaticos de pedido
