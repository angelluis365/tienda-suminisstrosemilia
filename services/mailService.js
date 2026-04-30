const { Resend } = require("resend");

const resendApiKey = process.env.RESEND_API_KEY || "";
const fromEmail = process.env.RESEND_FROM_EMAIL || "";
const storeNotificationEmail = process.env.STORE_NOTIFICATION_EMAIL || "pedidos@suministrosemilia.com";

const resend = resendApiKey ? new Resend(resendApiKey) : null;

function money(value) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(value || 0));
}

function orderLinesHtml(items) {
  return `
    <ul>
      ${items
        .map(
          (item) => `
            <li><strong>${item.name}</strong> (${item.sku}) - ${item.quantity} x ${money(item.salePrice || item.unitSalePrice)}</li>
          `
        )
        .join("")}
    </ul>
  `;
}

function orderCustomerEmail(order) {
  return {
    subject: `Pedido ${order.orderNumber} confirmado`,
    html: `
      <h2>Gracias por tu compra en Suministros Santa Emilia SL</h2>
      <p>Tu pedido <strong>${order.orderNumber}</strong> ha quedado confirmado.</p>
      <p><strong>Forma de pago:</strong> ${order.paymentMethod}</p>
      <p><strong>Estado:</strong> ${order.statusLabel}</p>
      <p><strong>Subtotal:</strong> ${money(order.subtotal)}</p>
      <p><strong>IVA:</strong> ${order.vatExempt ? "Exento" : money(order.taxAmount)}</p>
      <p><strong>Transporte:</strong> ${money(order.shippingCost)}</p>
      <p><strong>Total:</strong> ${money(order.total)}</p>
      <h3>Productos</h3>
      ${orderLinesHtml(order.items)}
      <p>Puedes consultar el estado de tu pedido desde la tienda con tu numero de pedido y tu correo electronico.</p>
    `
  };
}

function orderStoreEmail(order) {
  return {
    subject: `Nuevo pedido pagado ${order.orderNumber}`,
    html: `
      <h2>Nuevo pedido pagado</h2>
      <p><strong>Pedido:</strong> ${order.orderNumber}</p>
      <p><strong>Cliente:</strong> ${order.customerName}</p>
      <p><strong>Correo:</strong> ${order.customerEmail}</p>
      <p><strong>Telefono:</strong> ${order.customerPhone || ""}</p>
      <p><strong>Forma de pago:</strong> ${order.paymentMethod}</p>
      <p><strong>Subtotal:</strong> ${money(order.subtotal)}</p>
      <p><strong>IVA:</strong> ${order.vatExempt ? "Exento" : money(order.taxAmount)}</p>
      <p><strong>Transporte:</strong> ${money(order.shippingCost)}</p>
      <p><strong>Total:</strong> ${money(order.total)}</p>
      <h3>Productos</h3>
      ${orderLinesHtml(order.items)}
      <h3>Direccion de envio</h3>
      <p>
        ${order.shippingStreet}<br />
        ${order.shippingProperty || ""}<br />
        ${order.shippingCity}, ${order.shippingProvince}, ${order.shippingCountry}
      </p>
    `
  };
}

function shippedCustomerEmail(order) {
  return {
    subject: `Pedido ${order.orderNumber} enviado`,
    html: `
      <h2>Tu pedido ya ha salido</h2>
      <p>El pedido <strong>${order.orderNumber}</strong> ha sido enviado.</p>
      <p><strong>Estado:</strong> ${order.statusLabel}</p>
      <p><strong>Transportista:</strong> ${order.carrierName || "Pendiente de asignar"}</p>
      <p><strong>Tracking:</strong> ${order.trackingNumber || "Pendiente"}</p>
      ${
        order.trackingUrl
          ? `<p><a href="${order.trackingUrl}" target="_blank" rel="noreferrer">Seguir envio</a></p>`
          : ""
      }
      <p>Puedes consultar el estado de tu pedido desde la tienda con tu numero de pedido y tu correo electronico.</p>
    `
  };
}

function shippedStoreEmail(order) {
  return {
    subject: `Pedido ${order.orderNumber} expedido`,
    html: `
      <h2>Pedido expedido</h2>
      <p><strong>Pedido:</strong> ${order.orderNumber}</p>
      <p><strong>Cliente:</strong> ${order.customerName}</p>
      <p><strong>Correo:</strong> ${order.customerEmail}</p>
      <p><strong>Transportista:</strong> ${order.carrierName || ""}</p>
      <p><strong>Tracking:</strong> ${order.trackingNumber || ""}</p>
      ${
        order.trackingUrl
          ? `<p><strong>URL tracking:</strong> <a href="${order.trackingUrl}" target="_blank" rel="noreferrer">${order.trackingUrl}</a></p>`
          : ""
      }
    `
  };
}

async function sendEmail({ to, subject, html }) {
  if (!resend || !fromEmail) {
    console.log("[mail] envio omitido: falta RESEND_API_KEY o RESEND_FROM_EMAIL");
    return { skipped: true };
  }

  const response = await resend.emails.send({
    from: fromEmail,
    to: Array.isArray(to) ? to : [to],
    subject,
    html
  });

  if (response.error) {
    throw new Error(response.error.message || "Error enviando correo");
  }

  return response.data;
}

async function sendPaidOrderEmails(order) {
  const customerMail = orderCustomerEmail(order);
  const storeMail = orderStoreEmail(order);

  await Promise.all([
    sendEmail({
      to: order.customerEmail,
      subject: customerMail.subject,
      html: customerMail.html
    }),
    sendEmail({
      to: storeNotificationEmail,
      subject: storeMail.subject,
      html: storeMail.html
    })
  ]);
}

async function sendShippedOrderEmails(order) {
  const customerMail = shippedCustomerEmail(order);
  const storeMail = shippedStoreEmail(order);

  await Promise.all([
    sendEmail({
      to: order.customerEmail,
      subject: customerMail.subject,
      html: customerMail.html
    }),
    sendEmail({
      to: storeNotificationEmail,
      subject: storeMail.subject,
      html: storeMail.html
    })
  ]);
}

module.exports = {
  sendPaidOrderEmails,
  sendShippedOrderEmails
};
