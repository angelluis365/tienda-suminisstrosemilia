# Pasarela de pago y correos: que hacer

## 1. Ocultar SEO a compradores

Ya esta hecho. La seccion SEO ahora solo aparece cuando entras como administrador.

## 2. Como montar la pasarela de pago

### Opcion recomendada: Stripe

Es la forma mas rapida de dejar la tarjeta operativa.

Pasos:

1. Crear cuenta en Stripe.
2. Activar la cuenta y completar datos fiscales.
3. Obtener estas claves:
   - clave publica
   - clave secreta
   - webhook secret
4. Crear en el backend una sesion Checkout para cada pedido.
5. Redirigir al cliente a Stripe Checkout.
6. Recibir el webhook de pago correcto.
7. Cuando Stripe confirme el pago:
   - marcar pedido pagado
   - cambiar estado a `payment_confirmed`
   - enviar correos

### Opcion bancaria en España: Redsys

Es mejor si quieres usar tu TPV bancario.

Pasos:

1. Solicitar TPV Virtual a tu banco.
2. Pedir integracion Redsys.
3. Recibir:
   - numero de comercio
   - terminal
   - clave secreta
   - URL de pruebas y produccion
4. Elegir tipo de integracion:
   - redireccion: la mas facil
   - REST o inSite: mas personalizable
5. Enviar los parametros firmados desde tu backend.
6. Recibir la notificacion del resultado.
7. Marcar el pedido como pagado en tu base y enviar correos.

## 3. Correos automaticos

Ya he dejado el backend preparado para correo con Resend.

### Que hace ahora

Cuando un pedido queda pagado:

- envia un correo al comprador
- envia otro a `pedidos@suministrosemilia.com`

Si el pedido es por transferencia:

- no envia el correo de pagado hasta que el admin lo cambie a `Pago confirmado`

## 4. Que te falta configurar

En el archivo `.env`:

```env
STORE_NOTIFICATION_EMAIL=pedidos@suministrosemilia.com
RESEND_API_KEY=
RESEND_FROM_EMAIL=tienda@suministrosemilia.com
```

### Debes poner:

- `RESEND_API_KEY`: tu clave real de Resend
- `RESEND_FROM_EMAIL`: una cuenta de tu dominio verificado

Ejemplo:

```env
RESEND_API_KEY=re_xxxxxxxxxxxxx
RESEND_FROM_EMAIL=Suministros Santa Emilia <tienda@suministrosemilia.com>
```

## 5. Que hacer en Resend

1. Crear cuenta en Resend.
2. Verificar tu dominio.
3. Crear una API key.
4. Poner esa API key en `.env`.
5. Reiniciar el servidor.

## 6. Cuando se envian los correos

### Tarjeta

En la version actual:

- la tarjeta esta en modo demo
- el pedido queda pagado al momento
- se dispara el correo

### Transferencia

En la version actual:

- el pedido entra como pago pendiente
- cuando el administrador cambie el estado a `Pago confirmado`
- se disparan los correos

## 7. Siguiente mejora tecnica

La siguiente fase buena es:

1. Integrar Stripe Checkout real.
2. Añadir webhook de Stripe.
3. Enviar correos solo tras confirmacion real del webhook.
4. Mantener transferencia como flujo manual.
