# Puesta en marcha de la tienda online

Esta primera version deja preparada una tienda funcional en navegador para Suministros Santa Emilia SL. Permite catalogo, compradores, pedidos, stock, seguimiento y estadisticas. Los datos se guardan en `localStorage`, por lo que sirve como prototipo operativo, demo comercial o base visual. Para vender en produccion hay que conectar backend, base de datos y pasarela real.

## 1. Probar la web en local

1. Abre `index.html` en el navegador.
2. Entra en el bloque "Panel privado de tienda".
3. Crea o edita productos con SKU, foto, descripcion, precio de compra, precio publico y stock.
4. Desde "Catalogo" añade productos al carrito.
5. En "Compra" rellena los datos del comprador y genera el pedido.
6. Consulta el pedido en "Seguimiento" con el numero generado y el correo.

## 2. Datos que ya gestiona

- Productos: nombre, SKU, categoria, foto, descripcion, stock, precio de compra privado y precio de venta publico.
- Compradores: nombre, DNI/NIF, telefono, correo, usuario, clave, calle, inmueble, poblacion, provincia y pais.
- Pedidos: numero automatico, productos, cantidades, forma de pago, total, coste, beneficio y estado.
- Estados: recibido, pago pendiente, pago confirmado, preparando, enviado, entregado y cancelado.
- Estadisticas: facturacion, coste, beneficio, unidades vendidas y ventas por producto.

## 3. Para dejarla totalmente operativa

### Dominio y hosting

1. Comprar o configurar el dominio definitivo, por ejemplo `suministrossantaemilia.com`.
2. Contratar hosting con SSL incluido.
3. Subir `index.html`, `styles.css`, `app.js`, `robots.txt`, `sitemap.xml`, `politica-cookies.html` y la carpeta `public`.
4. Activar HTTPS obligatorio.
5. Revisar que el dominio real coincide con el `canonical`, `robots.txt` y `sitemap.xml`.

### Backend y base de datos real

Para produccion no conviene guardar pedidos y claves en el navegador. Hay que crear un servidor con:

- Base de datos PostgreSQL o MySQL.
- Tabla `products` para productos, fotos, SKU, stock y precios.
- Tabla `customers` para compradores.
- Tabla `orders` para pedidos.
- Tabla `order_items` para lineas de pedido.
- Tabla `users` con claves cifradas, nunca en texto plano.
- Panel privado con acceso de administrador.

### Pasarela de pago

Opciones recomendadas:

- Stripe: tarjeta bancaria, Apple Pay, Google Pay y confirmacion automatica.
- Redsys: pasarela bancaria habitual en España.
- Transferencia: mostrar IBAN, concepto con numero de pedido y marcar como pagado cuando se reciba.

Flujo recomendado:

1. El comprador confirma el carrito.
2. El servidor crea el pedido.
3. Si paga con tarjeta, se redirige a Stripe o Redsys.
4. La pasarela confirma el pago mediante webhook.
5. El pedido cambia a "Pago confirmado".
6. El comprador recibe correo con el estado.

### Correos automaticos

Configurar envio de email para:

- Alta de usuario.
- Pedido recibido.
- Pago confirmado o transferencia pendiente.
- Pedido en preparacion.
- Pedido enviado.
- Pedido entregado.

### Legal y seguridad

Antes de vender:

- Aviso legal.
- Politica de privacidad.
- Politica de cookies.
- Condiciones de compra.
- Politica de devoluciones.
- Cumplimiento RGPD.
- Cifrado HTTPS.
- Claves con hash seguro.
- Copias de seguridad.

## 4. SEO inicial

Ya se ha preparado:

- Titulo y descripcion SEO.
- Open Graph para compartir.
- Etiquetas `canonical`, `robots` y `theme-color`.
- Schema.org tipo `Store`.
- `robots.txt`.
- `sitemap.xml`.
- Estructura con encabezados claros.

Para mejorar posicionamiento real:

1. Crear paginas indexables por categoria.
2. Crear URL propia para cada producto.
3. Escribir descripciones originales.
4. Optimizar fotos con nombres descriptivos y peso bajo.
5. Registrar la web en Google Search Console.
6. Enviar el sitemap.
7. Conseguir enlaces de proveedores, directorios B2B y fichas locales.
8. Mantener blog o seccion de oportunidades con contenidos utiles.

## 5. Siguiente fase tecnica recomendada

Convertir esta version estatica en una aplicacion con:

- Frontend: Next.js o Laravel Blade.
- Backend: Laravel, Node.js/NestJS o Django.
- Base de datos: PostgreSQL.
- Pagos: Stripe o Redsys.
- Imagenes: almacenamiento S3 compatible o hosting propio.
- Admin: acceso privado con roles.
- Facturacion: generacion de factura PDF por pedido.
