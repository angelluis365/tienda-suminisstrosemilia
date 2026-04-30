const currency = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const API = {
  products: "/api/products",
  adminProducts: "/api/admin/products",
  customers: "/api/admin/customers",
  orders: "/api/admin/orders",
  stats: "/api/admin/stats",
  customerOrders: "/api/customer/orders",
  adminShipping: "/api/admin/shipping",
  adminInvoicing: "/api/admin/invoicing"
};

const ORDER_STATUS_OPTIONS = [
  { value: "received", label: "Recibido" },
  { value: "payment_pending", label: "Pago pendiente" },
  { value: "payment_confirmed", label: "Pago confirmado" },
  { value: "preparing", label: "Preparando" },
  { value: "shipped", label: "Enviado" },
  { value: "delivered", label: "Entregado" },
  { value: "cancelled", label: "Cancelado" }
];

const emptyStats = {
  totalRevenue: 0,
  totalCost: 0,
  totalProfit: 0,
  totalUnits: 0,
  byProduct: []
};

const state = {
  products: [],
  adminProducts: [],
  customers: [],
  orders: [],
  customerOrders: [],
  shippingQuote: {
    subtotal: 0,
    taxAmount: 0,
    vatExempt: false,
    shippingCost: 0,
    total: 0,
    freeShippingThreshold: 0,
    amountUntilFreeShipping: 0,
    totalWeightKg: 0,
    totalVolumeM3: 0,
    matchedRate: ""
  },
  shippingAdmin: {
    settings: { freeShippingThreshold: 0 },
    rates: []
  },
  invoiceAdmin: {
    prefix: "Factura",
    seriesCode: "H",
    lastSequence: 132,
    fiscalSuffix: "26"
  },
  activeProduct: null,
  shipmentEditingOrderId: null,
  adminSession: {
    authenticated: false,
    email: null
  },
  customerSession: {
    authenticated: false,
    customer: null
  },
  stats: { ...emptyStats }
};

let cart = [];

function qs(selector) {
  return document.querySelector(selector);
}

function qsa(selector) {
  return [...document.querySelectorAll(selector)];
}

function money(value) {
  return currency.format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "La operacion no se pudo completar.");
  }
  return data;
}

function productImage(product) {
  if (product.image) {
    return `<img src="${product.image}" alt="${escapeHtml(product.name)}" />`;
  }
  return `<span>${escapeHtml(product.category)}<br />${escapeHtml(product.sku)}</span>`;
}

function getFilteredProducts() {
  const search = qs("#search-products").value.trim().toLowerCase();
  const category = qs("#category-filter").value;
  const priceFilter = qs("#price-filter")?.value || "";
  const stockFilter = qs("#stock-filter")?.value || "";
  const sortValue = qs("#sort-products")?.value || "featured";

  const products = state.products
    .filter((product) => {
      const haystack = `${product.name} ${product.sku} ${product.category}`.toLowerCase();
      const matchesText = !search || haystack.includes(search);
      const matchesCategory = !category || product.category === category;
      const matchesStock = stockFilter !== "in-stock" || product.stock > 0;
      const matchesPrice =
        !priceFilter ||
        (priceFilter === "0-25" && product.salePrice <= 25) ||
        (priceFilter === "25-100" && product.salePrice > 25 && product.salePrice <= 100) ||
        (priceFilter === "100-500" && product.salePrice > 100 && product.salePrice <= 500) ||
        (priceFilter === "500+" && product.salePrice > 500);
      return matchesText && matchesCategory && matchesStock && matchesPrice;
    })
    .slice();

  if (sortValue === "name-asc") products.sort((a, b) => a.name.localeCompare(b.name, "es"));
  if (sortValue === "price-asc") products.sort((a, b) => a.salePrice - b.salePrice);
  if (sortValue === "price-desc") products.sort((a, b) => b.salePrice - a.salePrice);
  if (sortValue === "stock-desc") products.sort((a, b) => b.stock - a.stock);
  if (sortValue === "featured") {
    products.sort((a, b) => {
      const stockScore = Math.sign(b.stock - a.stock);
      if (stockScore !== 0) return stockScore;
      return a.category.localeCompare(b.category, "es");
    });
  }

  return products;
}

function setAdminVisibility(authenticated) {
  state.adminSession.authenticated = authenticated;
  qs("#panel").hidden = !authenticated;
  qs("#admin-nav-link").hidden = !authenticated;
  qs("#seo").hidden = !authenticated;
  qs("#seo-nav-link").hidden = !authenticated;
  qs("#admin-logout-button").hidden = !authenticated;
  qs("#admin-status").hidden = !authenticated;
  qs("#admin-account-note").hidden = !authenticated;
  qs("#customer-area-shell").hidden = authenticated;
  if (authenticated) {
    qs("#admin-login-message").textContent = `Sesion iniciada como ${state.adminSession.email}.`;
  }
}

function setAccountView(view) {
  qsa(".account-view-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.accountView === view);
  });
  qsa(".account-view-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `account-view-${view}`);
  });
}

function setCustomerSection(section) {
  qsa(".customer-section-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.customerSection === section);
  });
  qsa(".customer-section-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `customer-section-${section}`);
  });
}

function setCustomerVisibility(authenticated) {
  state.customerSession.authenticated = authenticated;
  qs("#customer-logout-button").hidden = !authenticated;
  qs("#account-view-dashboard-button").hidden = !authenticated;
  qs("#customer-session-card").hidden = !authenticated;
  const checkoutFields = qs("#checkout-form").elements;
  checkoutFields.username.required = !authenticated;
  checkoutFields.password.required = !authenticated;
  checkoutFields.username.readOnly = authenticated;
  checkoutFields.password.readOnly = authenticated;
  if (authenticated) {
    checkoutFields.password.value = "";
    checkoutFields.password.placeholder = "Sesion activa";
  } else {
    checkoutFields.password.placeholder = "";
  }
  if (authenticated && state.customerSession.customer) {
    qs("#customer-login-message").textContent = `Sesion iniciada como ${state.customerSession.customer.fullName}.`;
    qs("#customer-session-chip").textContent = "Cliente activo";
    qs("#customer-session-summary").textContent =
      `${state.customerSession.customer.fullName}${state.customerSession.customer.companyName ? ` - ${state.customerSession.customer.companyName}` : ""}. Puedes revisar tus pedidos y repetir compras con tus datos ya guardados.`;
    renderCustomerDashboard(state.customerSession.customer);
    if (!state.adminSession.authenticated) {
      setAccountView("dashboard");
      setCustomerSection("overview");
    }
  } else if (!state.adminSession.authenticated) {
    setAccountView("login");
  }
}

function renderCustomerDashboard(customer) {
  if (!customer) return;
  qs("#account-card-name").textContent = customer.companyName
    ? `${customer.fullName} - ${customer.companyName}`
    : customer.fullName;
  qs("#account-card-email").textContent = `${customer.email} · ${customer.phone}`;
  qs("#account-card-shipping").textContent = customer.shippingStreet;
  qs("#account-card-shipping-extra").textContent = `${customer.shippingProperty ? `${customer.shippingProperty} · ` : ""}${customer.shippingCity}, ${customer.shippingProvince}, ${customer.shippingCountry}`;
  qs("#account-card-billing").textContent = customer.billingStreet;
  qs("#account-card-billing-extra").textContent = `${customer.billingProperty ? `${customer.billingProperty} · ` : ""}${customer.billingCity}, ${customer.billingProvince}, ${customer.billingCountry}`;
  qs("#account-card-shipping-address").textContent = customer.shippingStreet;
  qs("#account-card-shipping-address-extra").textContent = `${customer.shippingProperty ? `${customer.shippingProperty} · ` : ""}${customer.shippingCity}, ${customer.shippingProvince}, ${customer.shippingCountry}`;
  qs("#account-card-billing-address").textContent = customer.billingStreet;
  qs("#account-card-billing-address-extra").textContent = `${customer.billingProperty ? `${customer.billingProperty} · ` : ""}${customer.billingCity}, ${customer.billingProvince}, ${customer.billingCountry}`;
}

function refreshCategoryFilter() {
  const select = qs("#category-filter");
  const previous = select.value;
  const categories = [...new Set(state.products.map((product) => product.category))].sort();
  select.innerHTML = `<option value="">Todas</option>${categories
    .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
    .join("")}`;
  select.value = categories.includes(previous) ? previous : "";
}

function renderFamilyGrid() {
  const grid = qs("#family-grid");
  const families = [...new Set(state.products.map((product) => product.category))]
    .slice(0, 6)
    .map((category) => ({
      category,
      count: state.products.filter((product) => product.category === category).length
    }));

  grid.innerHTML = families
    .map(
      (family) => `
        <button class="family-card" type="button" data-family="${escapeHtml(family.category)}">
          <span>${family.count} productos</span>
          <strong>${escapeHtml(family.category)}</strong>
        </button>
      `
    )
    .join("");

  qsa("[data-family]").forEach((button) => {
    button.addEventListener("click", () => {
      qs("#category-filter").value = button.dataset.family;
      renderProducts();
      qs("#catalogo").scrollIntoView({ behavior: "smooth" });
    });
  });
}

function renderFeaturedProducts() {
  const grid = qs("#featured-grid");
  const featured = state.products
    .filter((product) => product.stock > 0)
    .sort((a, b) => b.stock - a.stock || a.salePrice - b.salePrice)
    .slice(0, 4);

  grid.innerHTML = featured
    .map(
      (product) => `
        <article class="featured-card">
          <button class="featured-card-media" type="button" data-open-product="${product.id}">
            ${product.image ? `<img src="${product.image}" alt="${escapeHtml(product.name)}" />` : productImage(product)}
          </button>
          <div class="featured-card-copy">
            <div class="product-meta">
              <span class="chip">${escapeHtml(product.category)}</span>
              <span class="chip">Stock ${product.stock}</span>
            </div>
            <h3>${escapeHtml(product.name)}</h3>
            <div class="featured-card-actions">
              <strong class="price">${money(product.salePrice)}</strong>
              <button class="text-button" type="button" data-open-product="${product.id}">Ver ficha</button>
            </div>
          </div>
        </article>
      `
    )
    .join("");

  qsa('[data-open-product]').forEach((button) => {
    button.addEventListener("click", () => openProductDialog(button.dataset.openProduct));
  });
}

function renderProducts() {
  const grid = qs("#product-grid");
  const products = getFilteredProducts();

  grid.innerHTML = products
    .map(
      (product) => `
        <article class="product-card">
          <button class="product-image" type="button" data-open-product="${product.id}">${productImage(product)}</button>
          <div class="product-body">
            <div class="product-meta">
              <span class="chip">${escapeHtml(product.category)}</span>
              <span class="chip">${escapeHtml(product.sku)}</span>
              <span class="chip">Stock: ${product.stock}</span>
            </div>
            <h3>${escapeHtml(product.name)}</h3>
            <p>${escapeHtml(product.description)}</p>
            <strong class="price">${money(product.salePrice)}</strong>
            <div class="product-tax-note">${product.vatRate}% IVA segun destino</div>
            <div class="product-qty-control">
              <button class="text-button" type="button" data-open-product="${product.id}">Ver ficha</button>
              <label>
                Cantidad
                <input type="number" min="1" max="${product.stock}" value="1" data-product-qty="${product.id}" ${product.stock <= 0 ? "disabled" : ""} />
              </label>
              <button class="button button-primary" type="button" data-add="${product.id}" ${product.stock <= 0 ? "disabled" : ""}>
                ${product.stock <= 0 ? "Sin stock" : "Añadir"}
              </button>
            </div>
          </div>
        </article>
      `
    )
    .join("");

  qsa("[data-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const quantityInput = qs(`[data-product-qty="${button.dataset.add}"]`);
      const quantity = Number(quantityInput?.value || 1);
      addToCart(button.dataset.add, quantity);
    });
  });

  qsa('[data-open-product]').forEach((button) => {
    button.addEventListener("click", () => openProductDialog(button.dataset.openProduct));
  });
}

function addToCart(productId, quantity = 1) {
  const product = state.products.find((item) => item.id === productId);
  if (!product || product.stock <= 0) return;
  const requested = Math.max(1, Number(quantity || 1));
  const line = cart.find((item) => item.productId === productId);
  const quantityInCart = line ? line.quantity : 0;
  if (quantityInCart + requested > product.stock) {
    alert(`Solo hay ${product.stock} unidades disponibles de ${product.name}.`);
    return;
  }
  if (line) {
    line.quantity += requested;
  } else {
    cart.push({ productId, quantity: requested });
  }
  renderCart();
  refreshShippingQuote().catch(console.error);
}

function updateCartQuantity(productId, quantity) {
  const product = state.products.find((item) => item.id === productId);
  const line = cart.find((item) => item.productId === productId);
  if (!product || !line) return;
  const normalized = Math.max(1, Math.min(product.stock, Number(quantity || 1)));
  line.quantity = normalized;
  renderCart();
  refreshShippingQuote().catch(console.error);
}

function renderCart() {
  const items = qs("#cart-items");
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => {
    const product = state.products.find((entry) => entry.id === item.productId);
    return sum + (product ? product.salePrice * item.quantity : 0);
  }, 0);
  const shippingCost = cart.length ? Number(state.shippingQuote.shippingCost || 0) : 0;
  const taxAmount = cart.length ? Number(state.shippingQuote.taxAmount || 0) : 0;
  const total = cart.length ? Number(state.shippingQuote.total || subtotal) : subtotal;

  qs("#cart-count").textContent = count;
  qs("#cart-subtotal").textContent = money(subtotal);
  qs("#cart-tax").textContent = state.shippingQuote.vatExempt ? "Exento" : money(taxAmount);
  qs("#cart-shipping").textContent = money(shippingCost);
  qs("#cart-total").textContent = money(total);
  const shippingHint = qs("#shipping-auto-hint");
  if (shippingHint) {
    if (!cart.length) {
      shippingHint.textContent = "El transporte se calcula automaticamente cuando añades productos.";
    } else if (state.shippingQuote.shippingCost === 0 && state.shippingQuote.freeShippingThreshold > 0 && subtotal >= state.shippingQuote.freeShippingThreshold) {
      shippingHint.textContent = `Envio gratis aplicado a partir de ${money(state.shippingQuote.freeShippingThreshold)}.`;
    } else if (state.shippingQuote.matchedRate) {
      const remaining = Number(state.shippingQuote.amountUntilFreeShipping || 0);
      shippingHint.textContent =
        remaining > 0
          ? `Tarifa ${state.shippingQuote.matchedRate}. Te faltan ${money(remaining)} para envio gratis.`
          : `Tarifa ${state.shippingQuote.matchedRate}.`;
    } else {
      shippingHint.textContent = "El transporte se calcula automaticamente.";
    }
  }
  items.innerHTML =
    cart.length === 0
      ? `<p class="form-note">El carrito esta vacio.</p>`
      : cart
          .map((item) => {
            const product = state.products.find((entry) => entry.id === item.productId);
            if (!product) return "";
            return `
              <div class="cart-line">
                <span>
                  <strong>${escapeHtml(product.name)}</strong><br />
                  ${money(product.salePrice)} por unidad
                </span>
                <div class="cart-line-actions">
                  <div class="cart-qty-control">
                    <button class="text-button" type="button" data-step-down="${product.id}">-</button>
                    <input type="number" min="1" max="${product.stock}" value="${item.quantity}" data-cart-qty="${product.id}" />
                    <button class="text-button" type="button" data-step-up="${product.id}">+</button>
                  </div>
                  <button class="text-button" type="button" data-remove="${product.id}">Quitar</button>
                </div>
              </div>
            `;
          })
          .join("");

  qsa("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      cart = cart.filter((item) => item.productId !== button.dataset.remove);
      renderCart();
    });
  });

  qsa("[data-cart-qty]").forEach((input) => {
    input.addEventListener("change", () => updateCartQuantity(input.dataset.cartQty, input.value));
  });

  qsa("[data-step-down]").forEach((button) => {
    button.addEventListener("click", () => {
      const line = cart.find((item) => item.productId === button.dataset.stepDown);
      if (!line) return;
      updateCartQuantity(button.dataset.stepDown, Math.max(1, line.quantity - 1));
    });
  });

  qsa("[data-step-up]").forEach((button) => {
    button.addEventListener("click", () => {
      const line = cart.find((item) => item.productId === button.dataset.stepUp);
      const product = state.products.find((item) => item.id === button.dataset.stepUp);
      if (!line || !product) return;
      updateCartQuantity(button.dataset.stepUp, Math.min(product.stock, line.quantity + 1));
    });
  });
}

function renderProductsTable() {
  qs("#products-table").innerHTML = `
    <thead>
      <tr>
        <th>Producto</th><th>SKU</th><th>Categoria</th><th>Stock</th><th>Peso</th><th>Volumen</th><th>IVA</th><th>Compra privado</th><th>Venta publico</th><th>Margen</th><th>Acciones</th>
      </tr>
    </thead>
    <tbody>
      ${state.adminProducts
        .map(
          (product) => `
            <tr>
              <td>${escapeHtml(product.name)}</td>
              <td>${escapeHtml(product.sku)}</td>
              <td>${escapeHtml(product.category)}</td>
              <td class="${product.stock <= 3 ? "danger" : ""}">${product.stock}</td>
              <td>${product.weightKg.toFixed(2)} kg</td>
              <td>${product.volumeM3.toFixed(3)} m3</td>
              <td>${product.vatRate}%</td>
              <td>${money(product.costPrice)}</td>
              <td>${money(product.salePrice)}</td>
              <td>${money(product.salePrice - product.costPrice)}</td>
              <td>
                <button class="text-button" type="button" data-edit-product="${product.id}">Editar</button>
                <button class="text-button" type="button" data-delete-product="${product.id}">Borrar</button>
              </td>
            </tr>
          `
        )
        .join("")}
    </tbody>
  `;

  qsa("[data-edit-product]").forEach((button) => {
    button.addEventListener("click", () => fillProductForm(button.dataset.editProduct));
  });
  qsa("[data-delete-product]").forEach((button) => {
    button.addEventListener("click", async () => {
      await apiFetch(`${API.adminProducts}/${button.dataset.deleteProduct}`, { method: "DELETE" });
      await loadAllData();
    });
  });
}

function renderCustomersTable() {
  qs("#customers-table").innerHTML = `
    <thead>
      <tr>
        <th>Cliente</th><th>Fiscal</th><th>Contacto</th><th>Entrega</th><th>Facturacion</th><th>Pedidos</th>
      </tr>
    </thead>
    <tbody>
      ${
        state.customers.length === 0
          ? `<tr><td colspan="6">Todavia no hay compradores registrados.</td></tr>`
          : state.customers
              .map(
                (customer) => `
                  <tr>
                    <td>${escapeHtml(customer.fullName)}${customer.companyName ? `<br />${escapeHtml(customer.companyName)}` : ""}</td>
                    <td>${escapeHtml(customer.cif || customer.dni)}</td>
                    <td>${escapeHtml(customer.email)}<br />${escapeHtml(customer.phone)}</td>
                    <td>${escapeHtml(customer.shippingStreet)}<br />${escapeHtml(customer.shippingProperty)} ${escapeHtml(customer.shippingCity)}, ${escapeHtml(customer.shippingProvince)}, ${escapeHtml(customer.shippingCountry)}</td>
                    <td>${escapeHtml(customer.billingStreet)}<br />${escapeHtml(customer.billingProperty)} ${escapeHtml(customer.billingCity)}, ${escapeHtml(customer.billingProvince)}, ${escapeHtml(customer.billingCountry)}</td>
                    <td>${customer.totalOrders}</td>
                  </tr>
                `
              )
              .join("")
      }
    </tbody>
  `;
}

function renderOrdersTable() {
  qs("#orders-table").innerHTML = `
    <thead>
      <tr>
        <th>Pedido</th><th>Comprador</th><th>Productos</th><th>Pago</th><th>Envio</th><th>IVA</th><th>Total</th><th>Beneficio</th><th>Estado</th><th>Acciones</th>
      </tr>
    </thead>
    <tbody>
      ${
        state.orders.length === 0
          ? `<tr><td colspan="10">Todavia no hay pedidos.</td></tr>`
          : state.orders
              .map(
                (order) => `
                  <tr>
                    <td>${escapeHtml(order.orderNumber)}<br />${new Date(order.createdAt).toLocaleString("es-ES")}</td>
                    <td>${escapeHtml(order.customerName)}<br />${escapeHtml(order.customerEmail)}</td>
                    <td>${order.items.map((item) => `${escapeHtml(item.name)} x ${item.quantity}`).join("<br />")}</td>
                    <td>${escapeHtml(order.paymentMethod)}</td>
                    <td>
                      ${money(order.shippingCost)}
                      ${order.carrierName ? `<br /><span class="table-subtle">${escapeHtml(order.carrierName)}</span>` : ""}
                      ${order.trackingNumber ? `<br /><span class="table-subtle">${escapeHtml(order.trackingNumber)}</span>` : ""}
                    </td>
                    <td>${order.vatExempt ? "Exento" : money(order.taxAmount)}</td>
                    <td>${money(order.total)}</td>
                    <td>${money(order.profit)}</td>
                    <td>
                      <select class="status-select" data-status="${order.id}">
                        ${ORDER_STATUS_OPTIONS.map(
                          (status) =>
                            `<option value="${status.value}" ${status.value === order.orderStatus ? "selected" : ""}>${status.label}</option>`
                        ).join("")}
                      </select>
                    </td>
                    <td>
                      <button class="text-button" type="button" data-manage-shipment="${order.id}">Expedicion</button>
                      ${
                        order.invoiceNumber
                          ? `<a class="text-link" href="/api/admin/orders/${encodeURIComponent(order.id)}/invoice" target="_blank" rel="noreferrer">Factura</a>`
                          : `<span class="table-subtle">Sin factura</span>`
                      }
                    </td>
                  </tr>
                `
              )
              .join("")
      }
    </tbody>
  `;

  qsa("[data-status]").forEach((select) => {
    select.addEventListener("change", async () => {
      await apiFetch(`/api/admin/orders/${select.dataset.status}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: select.value })
      });
      await loadAllData();
    });
  });

  qsa("[data-manage-shipment]").forEach((button) => {
    button.addEventListener("click", () => fillShipmentForm(button.dataset.manageShipment));
  });
}

function renderStats() {
  qs("#stat-revenue").textContent = money(state.stats.totalRevenue);
  qs("#stat-cost").textContent = money(state.stats.totalCost);
  qs("#stat-profit").textContent = money(state.stats.totalProfit);
  qs("#stat-units").textContent = state.stats.totalUnits;

  qs("#stats-table").innerHTML = `
    <thead><tr><th>Producto</th><th>SKU</th><th>Vendidos</th><th>Stock actual</th><th>Ingresos</th><th>Beneficio</th></tr></thead>
    <tbody>
      ${
        state.stats.byProduct.length === 0
          ? `<tr><td colspan="6">Todavia no hay ventas registradas.</td></tr>`
          : state.stats.byProduct
              .map(
                (row) => `
                  <tr>
                    <td>${escapeHtml(row.productName)}</td>
                    <td>${escapeHtml(row.sku)}</td>
                    <td>${row.unitsSold}</td>
                    <td>${row.stock}</td>
                    <td>${money(row.revenue)}</td>
                    <td>${money(row.profit)}</td>
                  </tr>
                `
              )
              .join("")
      }
    </tbody>
  `;
}

function renderCustomerOrders() {
  qs("#customer-orders-table").innerHTML = `
    <thead>
      <tr>
        <th>Pedido</th><th>Fecha</th><th>Pago</th><th>Envio</th><th>IVA</th><th>Estado</th><th>Total</th><th>Productos</th><th>Documentos</th>
      </tr>
    </thead>
    <tbody>
      ${
        state.customerOrders.length === 0
          ? `<tr><td colspan="9">Todavia no tienes pedidos.</td></tr>`
          : state.customerOrders
              .map(
                (order) => `
                  <tr>
                    <td>${escapeHtml(order.orderNumber)}</td>
                    <td>${new Date(order.createdAt).toLocaleString("es-ES")}</td>
                    <td>${escapeHtml(order.paymentMethod)}</td>
                    <td>
                      ${money(order.shippingCost)}
                      ${order.carrierName ? `<br /><span class="table-subtle">${escapeHtml(order.carrierName)}</span>` : ""}
                      ${
                        order.trackingNumber
                          ? order.trackingUrl
                            ? `<br /><a class="text-link" href="${escapeHtml(order.trackingUrl)}" target="_blank" rel="noreferrer">${escapeHtml(order.trackingNumber)}</a>`
                            : `<br /><span class="table-subtle">${escapeHtml(order.trackingNumber)}</span>`
                          : ""
                      }
                    </td>
                    <td>${order.vatExempt ? "Exento" : money(order.taxAmount)}</td>
                    <td>${escapeHtml(order.statusLabel)}</td>
                    <td>${money(order.total)}</td>
                    <td>${order.items.map((item) => `${escapeHtml(item.name)} x ${item.quantity}`).join("<br />")}</td>
                    <td>
                      ${
                        order.invoiceNumber
                          ? `<a class="text-link" href="/api/customer/orders/${encodeURIComponent(order.orderNumber)}/invoice" target="_blank" rel="noreferrer">Descargar factura</a>`
                          : `<span class="table-subtle">Pendiente</span>`
                      }
                    </td>
                  </tr>
                `
              )
              .join("")
      }
    </tbody>
  `;
}

function openProductDialog(productId) {
  const product = state.products.find((item) => item.id === productId);
  const dialog = qs("#product-dialog");
  if (!product || !dialog) return;
  state.activeProduct = product;
  qs("#product-dialog-media").innerHTML = product.image
    ? `<img src="${product.image}" alt="${escapeHtml(product.name)}" />`
    : productImage(product);
  qs("#product-dialog-meta").innerHTML = `
    <span class="chip">${escapeHtml(product.category)}</span>
    <span class="chip">${escapeHtml(product.sku)}</span>
    <span class="chip">Stock ${product.stock}</span>
  `;
  qs("#product-dialog-title").textContent = product.name;
  qs("#product-dialog-description").textContent = product.description;
  qs("#product-dialog-price").textContent = money(product.salePrice);
  qs("#product-dialog-tax").textContent = `${product.vatRate}% IVA segun destino`;
  qs("#product-dialog-stock").innerHTML = product.stock > 0 ? `<span class="chip">Disponible</span>` : `<span class="chip">Sin stock</span>`;
  const qty = qs("#product-dialog-qty");
  qty.value = "1";
  qty.max = String(Math.max(product.stock, 1));
  qty.disabled = product.stock <= 0;
  qs("#product-dialog-add").disabled = product.stock <= 0;
  dialog.showModal();
}

function closeProductDialog() {
  qs("#product-dialog")?.close();
  state.activeProduct = null;
}

function renderShippingAdmin() {
  const thresholdForm = qs("#shipping-settings-form");
  if (thresholdForm) {
    thresholdForm.elements.freeShippingThreshold.value = state.shippingAdmin.settings.freeShippingThreshold ?? 0;
  }

  qs("#shipping-rates-table").innerHTML = `
    <thead>
      <tr>
        <th>Tarifa</th><th>Peso max.</th><th>Volumen max.</th><th>Precio</th><th>Orden</th><th>Acciones</th>
      </tr>
    </thead>
    <tbody>
      ${
        state.shippingAdmin.rates.length === 0
          ? `<tr><td colspan="6">Todavia no hay tarifas de transporte.</td></tr>`
          : state.shippingAdmin.rates
              .map(
                (rate) => `
                  <tr>
                    <td>${escapeHtml(rate.name)}</td>
                    <td>${Number(rate.maxWeightKg).toFixed(2)} kg</td>
                    <td>${Number(rate.maxVolumeM3).toFixed(3)} m3</td>
                    <td>${money(rate.price)}</td>
                    <td>${rate.sortOrder}</td>
                    <td>
                      <button class="text-button" type="button" data-edit-rate="${rate.id}">Editar</button>
                      <button class="text-button" type="button" data-delete-rate="${rate.id}">Borrar</button>
                    </td>
                  </tr>
                `
              )
              .join("")
      }
    </tbody>
  `;

  qsa("[data-edit-rate]").forEach((button) => {
    button.addEventListener("click", () => {
      const rate = state.shippingAdmin.rates.find((item) => item.id === button.dataset.editRate);
      if (!rate) return;
      const form = qs("#shipping-rate-form").elements;
      form.id.value = rate.id;
      form.name.value = rate.name;
      form.maxWeightKg.value = rate.maxWeightKg;
      form.maxVolumeM3.value = rate.maxVolumeM3;
      form.price.value = rate.price;
      form.sortOrder.value = rate.sortOrder;
      qs("#tab-shipping").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  qsa("[data-delete-rate]").forEach((button) => {
    button.addEventListener("click", async () => {
      await apiFetch(`/api/admin/shipping/rates/${button.dataset.deleteRate}`, { method: "DELETE" });
      await loadAllData();
    });
  });
}

function renderInvoiceAdmin() {
  const form = qs("#invoice-settings-form");
  if (!form) return;
  form.elements.prefix.value = state.invoiceAdmin.prefix || "Factura";
  form.elements.seriesCode.value = state.invoiceAdmin.seriesCode || "H";
  form.elements.lastSequence.value = state.invoiceAdmin.lastSequence ?? 132;
  form.elements.fiscalSuffix.value = state.invoiceAdmin.fiscalSuffix || "26";
  const previewSequence = String(Number(state.invoiceAdmin.lastSequence || 0) + 1).padStart(4, "0");
  qs("#invoice-settings-preview").textContent = `${state.invoiceAdmin.prefix}_${state.invoiceAdmin.seriesCode}-${previewSequence}/${state.invoiceAdmin.fiscalSuffix}`;
}

async function refreshShippingQuote() {
  if (cart.length === 0) {
    state.shippingQuote = {
      subtotal: 0,
      taxAmount: 0,
      vatExempt: false,
      shippingCost: 0,
      total: 0,
      freeShippingThreshold: state.shippingAdmin.settings.freeShippingThreshold || 0,
      amountUntilFreeShipping: 0,
      totalWeightKg: 0,
      totalVolumeM3: 0,
      matchedRate: ""
    };
    renderCart();
    return;
  }

  try {
    state.shippingQuote = await apiFetch("/api/shipping/quote", {
      method: "POST",
      body: JSON.stringify({
        items: cart.map((item) => ({ productId: item.productId, quantity: item.quantity })),
        country: qs('#checkout-form [name="shippingCountry"]')?.value || "España"
      })
    });
  } catch (error) {
    state.shippingQuote = {
      subtotal: 0,
      taxAmount: 0,
      vatExempt: false,
      shippingCost: 0,
      total: 0,
      freeShippingThreshold: 0,
      amountUntilFreeShipping: 0,
      totalWeightKg: 0,
      totalVolumeM3: 0,
      matchedRate: error.message
    };
  }
  renderCart();
}

function fillProductForm(productId) {
  const product = state.adminProducts.find((item) => item.id === productId);
  if (!product) return;
  const form = qs("#product-form");
  const fields = form.elements;
  fields.id.value = product.id;
  fields.name.value = product.name;
  fields.sku.value = product.sku;
  fields.category.value = product.category;
  fields.stock.value = product.stock;
  fields.costPrice.value = product.costPrice;
  fields.salePrice.value = product.salePrice;
  fields.vatRate.value = product.vatRate;
  fields.weightKg.value = product.weightKg;
  fields.volumeM3.value = product.volumeM3;
  fields.description.value = product.description;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function fillShipmentForm(orderId) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return;
  state.shipmentEditingOrderId = orderId;
  const fields = qs("#shipment-form").elements;
  fields.orderId.value = order.id;
  fields.orderNumber.value = order.orderNumber;
  fields.carrierName.value = order.carrierName || "";
  fields.trackingNumber.value = order.trackingNumber || "";
  fields.trackingUrl.value = order.trackingUrl || "";
  fields.shippedAt.value = order.shippedAt ? new Date(order.shippedAt).toISOString().slice(0, 16) : "";
  fields.markAsShipped.checked = order.orderStatus !== "shipped" ? true : false;
  qs("#shipment-form").scrollIntoView({ behavior: "smooth", block: "center" });
}

function toggleCompanyFields(form, isCompany) {
  form.querySelectorAll(".company-field").forEach((field) => {
    field.hidden = !isCompany;
    const input = field.querySelector("input");
    if (!isCompany && input) input.value = "";
  });
}

function fillCustomerForms(customer) {
  if (!customer) return;
  const checkout = qs("#checkout-form").elements;
  const customerType = customer.companyName ? "empresa" : "particular";
  checkout.customerType.value = customerType;
  checkout.username.value = customer.username || customer.email.split("@")[0];
  checkout.companyName.value = customer.companyName || "";
  checkout.cif.value = customer.cif || "";
  checkout.fullName.value = customer.fullName || "";
  checkout.dni.value = customer.dni || "";
  checkout.email.value = customer.email || "";
  checkout.phone.value = customer.phone || "";
  checkout.shippingStreet.value = customer.shippingStreet || "";
  checkout.shippingProperty.value = customer.shippingProperty || "";
  checkout.shippingCity.value = customer.shippingCity || "";
  checkout.shippingProvince.value = customer.shippingProvince || "";
  checkout.shippingCountry.value = customer.shippingCountry || "España";
  checkout.billingStreet.value = customer.billingStreet || "";
  checkout.billingProperty.value = customer.billingProperty || "";
  checkout.billingCity.value = customer.billingCity || "";
  checkout.billingProvince.value = customer.billingProvince || "";
  checkout.billingCountry.value = customer.billingCountry || "España";
  toggleCompanyFields(qs("#checkout-form"), Boolean(customer.companyName));

  const profile = qs("#customer-profile-form")?.elements;
  if (profile) {
    profile.customerType.value = customerType;
    profile.username.value = customer.username || customer.email.split("@")[0];
    profile.companyName.value = customer.companyName || "";
    profile.cif.value = customer.cif || "";
    profile.fullName.value = customer.fullName || "";
    profile.dni.value = customer.dni || "";
    profile.email.value = customer.email || "";
    profile.phone.value = customer.phone || "";
    profile.password.value = "";
    profile.shippingStreet.value = customer.shippingStreet || "";
    profile.shippingProperty.value = customer.shippingProperty || "";
    profile.shippingCity.value = customer.shippingCity || "";
    profile.shippingProvince.value = customer.shippingProvince || "";
    profile.shippingCountry.value = customer.shippingCountry || "España";
    profile.billingStreet.value = customer.billingStreet || "";
    profile.billingProperty.value = customer.billingProperty || "";
    profile.billingCity.value = customer.billingCity || "";
    profile.billingProvince.value = customer.billingProvince || "";
    profile.billingCountry.value = customer.billingCountry || "España";
    toggleCompanyFields(qs("#customer-profile-form"), Boolean(customer.companyName));
  }

  renderCustomerDashboard(customer);
}

async function fileToDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

async function loadAllData() {
  state.products = await apiFetch(API.products);

  if (state.adminSession.authenticated) {
    const [adminProducts, customers, orders, stats, shippingAdmin, invoiceAdmin] = await Promise.all([
      apiFetch(API.adminProducts),
      apiFetch(API.customers),
      apiFetch(API.orders),
      apiFetch(API.stats),
      apiFetch(API.adminShipping),
      apiFetch(API.adminInvoicing)
    ]);
    state.adminProducts = adminProducts;
    state.customers = customers;
    state.orders = orders;
    state.stats = stats;
    state.shippingAdmin = shippingAdmin;
    state.invoiceAdmin = invoiceAdmin;
  } else {
    state.adminProducts = [];
    state.customers = [];
    state.orders = [];
    state.stats = { ...emptyStats };
    state.shippingAdmin = { settings: { freeShippingThreshold: 0 }, rates: [] };
    state.invoiceAdmin = { prefix: "Factura", seriesCode: "H", lastSequence: 132, fiscalSuffix: "26" };
  }

  if (state.customerSession.authenticated) {
    state.customerOrders = await apiFetch(API.customerOrders);
    renderCustomerOrders();
  } else {
    state.customerOrders = [];
    qs("#customer-orders-table").innerHTML = "";
  }

  refreshCategoryFilter();
  renderFamilyGrid();
  renderFeaturedProducts();
  renderProducts();
  renderCart();
  renderStats();
  if (state.adminSession.authenticated) {
    renderProductsTable();
    renderCustomersTable();
    renderOrdersTable();
    renderShippingAdmin();
    renderInvoiceAdmin();
  }
  await refreshShippingQuote();
}

async function handleProductSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = form.elements;
  const id = fields.id.value;
  const imageFile = fields.image.files[0];
  const current = state.adminProducts.find((item) => item.id === id);
  const image = imageFile ? await fileToDataUrl(imageFile) : current?.image || "";
  const payload = {
    name: fields.name.value.trim(),
    sku: fields.sku.value.trim(),
    category: fields.category.value.trim(),
    stock: Number(fields.stock.value),
    costPrice: Number(fields.costPrice.value),
    salePrice: Number(fields.salePrice.value),
    vatRate: Number(fields.vatRate.value || 0),
    weightKg: Number(fields.weightKg.value || 0),
    volumeM3: Number(fields.volumeM3.value || 0),
    description: fields.description.value.trim(),
    image
  };

  if (id) {
    await apiFetch(`${API.adminProducts}/${id}`, { method: "PUT", body: JSON.stringify(payload) });
  } else {
    await apiFetch(API.adminProducts, { method: "POST", body: JSON.stringify(payload) });
  }

  form.reset();
  fields.id.value = "";
  await loadAllData();
}

function collectCustomerPayload(form) {
  const fields = form.elements;
  return {
    customerType: fields.customerType?.value || "particular",
    username: fields.username.value.trim(),
    companyName: fields.companyName?.value.trim() || "",
    cif: fields.cif?.value.trim() || "",
    fullName: fields.fullName.value.trim(),
    dni: fields.dni.value.trim(),
    email: fields.email.value.trim(),
    phone: fields.phone.value.trim(),
    password: fields.password.value,
    shippingStreet: fields.shippingStreet.value.trim(),
    shippingProperty: fields.shippingProperty.value.trim(),
    shippingCity: fields.shippingCity.value.trim(),
    shippingProvince: fields.shippingProvince.value.trim(),
    shippingCountry: fields.shippingCountry.value.trim(),
    billingStreet: fields.billingStreet.value.trim(),
    billingProperty: fields.billingProperty.value.trim(),
    billingCity: fields.billingCity.value.trim(),
    billingProvince: fields.billingProvince.value.trim(),
    billingCountry: fields.billingCountry.value.trim()
  };
}

async function handleCustomerRegister(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = qs("#customer-register-message");
  try {
    const payload = collectCustomerPayload(form);
    const result = await apiFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.customerSession = { authenticated: true, customer: result.customer };
    setCustomerVisibility(true);
    fillCustomerForms(result.customer);
    form.reset();
    message.textContent = "Cuenta creada y sesion iniciada.";
    await loadAllData();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function handleCustomerLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = qs("#customer-login-message");
  try {
    const result = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        identifier: form.identifier.value.trim(),
        password: form.password.value
      })
    });
    state.customerSession = { authenticated: true, customer: result.customer };
    setCustomerVisibility(true);
    fillCustomerForms(result.customer);
    form.reset();
    await loadAllData();
    qs("#customer-session-card").scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    message.textContent = error.message;
  }
}

async function handleCustomerLogout() {
  await apiFetch("/api/auth/logout", { method: "POST" });
  state.customerSession = { authenticated: false, customer: null };
  setCustomerVisibility(false);
  qs("#customer-login-message").textContent = "Sesion de cliente cerrada.";
  qs("#customer-profile-message").textContent = "";
  await loadAllData();
}

async function handleCustomerProfileUpdate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = qs("#customer-profile-message");
  try {
    const payload = collectCustomerPayload(form);
    const result = await apiFetch("/api/customer/profile", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    state.customerSession = { authenticated: true, customer: result.customer };
    setCustomerVisibility(true);
    fillCustomerForms(result.customer);
    message.textContent = "Datos actualizados correctamente.";
    await loadAllData();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function handleShippingSettingsSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = qs("#shipping-settings-message");
  try {
    await apiFetch("/api/admin/shipping/settings", {
      method: "PUT",
      body: JSON.stringify({
        freeShippingThreshold: Number(form.freeShippingThreshold.value || 0)
      })
    });
    message.textContent = "Umbral de envio gratis actualizado.";
    await loadAllData();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function handleInvoiceSettingsSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = qs("#invoice-settings-message");
  try {
    await apiFetch(API.adminInvoicing, {
      method: "PUT",
      body: JSON.stringify({
        prefix: form.prefix.value.trim(),
        seriesCode: form.seriesCode.value.trim(),
        lastSequence: Number(form.lastSequence.value || 0),
        fiscalSuffix: form.fiscalSuffix.value.trim()
      })
    });
    message.textContent = "Serie de facturacion actualizada.";
    await loadAllData();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function handleShippingRateSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = form.elements;
  const message = qs("#shipping-rate-message");
  const payload = {
    name: fields.name.value.trim(),
    maxWeightKg: Number(fields.maxWeightKg.value || 0),
    maxVolumeM3: Number(fields.maxVolumeM3.value || 0),
    price: Number(fields.price.value || 0),
    sortOrder: Number(fields.sortOrder.value || 0)
  };

  try {
    if (fields.id.value) {
      await apiFetch(`/api/admin/shipping/rates/${fields.id.value}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      message.textContent = "Tarifa de transporte actualizada.";
    } else {
      await apiFetch("/api/admin/shipping/rates", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      message.textContent = "Tarifa de transporte creada.";
    }
    form.reset();
    fields.id.value = "";
    await loadAllData();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function handleShipmentSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = form.elements;
  const message = qs("#shipment-message");
  try {
    await apiFetch(`/api/admin/orders/${fields.orderId.value}/shipment`, {
      method: "PATCH",
      body: JSON.stringify({
        carrierName: fields.carrierName.value.trim(),
        trackingNumber: fields.trackingNumber.value.trim(),
        trackingUrl: fields.trackingUrl.value.trim(),
        shippedAt: fields.shippedAt.value || null,
        markAsShipped: fields.markAsShipped.checked
      })
    });
    message.textContent = "Expedicion actualizada correctamente.";
    await loadAllData();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function handleCheckout(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = qs("#checkout-message");
  if (cart.length === 0) {
    message.textContent = "Añade al menos un producto al carrito.";
    return;
  }

  try {
    const payload = {
      customer: collectCustomerPayload(form),
      paymentMethod: form.paymentMethod.value,
      items: cart.map((item) => ({ productId: item.productId, quantity: item.quantity }))
    };

    const order = await apiFetch("/api/orders", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    cart = [];
    renderCart();
    message.textContent =
      order.paymentMethod === "Transferencia"
        ? `Pedido ${order.orderNumber} creado. Queda pendiente de recibir la transferencia.`
        : `Pedido ${order.orderNumber} creado. Pago con tarjeta confirmado en modo backend demo.`;

    const session = await apiFetch("/api/auth/session");
    state.customerSession = session;
    setCustomerVisibility(session.authenticated);
    if (session.customer) fillCustomerForms(session.customer);
    await loadAllData();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function handleAdminLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = qs("#admin-login-message");
  try {
    const result = await apiFetch("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        email: form.email.value.trim(),
        password: form.password.value
      })
    });
    state.adminSession = { authenticated: true, email: result.email };
    setAdminVisibility(true);
    form.reset();
    await loadAllData();
    qs("#panel").scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    message.textContent = error.message;
    setAdminVisibility(false);
  }
}

async function handleAdminLogout() {
  await apiFetch("/api/admin/logout", { method: "POST" });
  state.adminSession = { authenticated: false, email: null };
  setAdminVisibility(false);
  qs("#admin-login-message").textContent = "Sesion de administrador cerrada.";
  await loadAllData();
}

async function handleTracking(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const result = qs("#track-result");
  try {
    const order = await apiFetch(
      `/api/orders/${encodeURIComponent(form.orderId.value.trim())}?email=${encodeURIComponent(form.email.value.trim())}`
    );
    result.classList.add("active");
    result.innerHTML = `
      <h3>Pedido ${escapeHtml(order.orderNumber)}</h3>
      <div class="order-status">
        <span class="chip">${escapeHtml(order.statusLabel)}</span>
        <span class="chip">${escapeHtml(order.paymentMethod)}</span>
        <span class="chip">${order.vatExempt ? "IVA exento" : `IVA ${money(order.taxAmount)}`}</span>
        <span class="chip">Transporte: ${money(order.shippingCost)}</span>
        <span class="chip">${money(order.total)}</span>
      </div>
      ${
        order.carrierName || order.trackingNumber
          ? `<p class="track-meta">
              ${order.carrierName ? `<strong>${escapeHtml(order.carrierName)}</strong>` : ""}
              ${
                order.trackingNumber
                  ? order.trackingUrl
                    ? ` · <a class="text-link" href="${escapeHtml(order.trackingUrl)}" target="_blank" rel="noreferrer">${escapeHtml(order.trackingNumber)}</a>`
                    : ` · ${escapeHtml(order.trackingNumber)}`
                  : ""
              }
            </p>`
          : ""
      }
      <p>${order.items.map((item) => `${escapeHtml(item.name)} x ${item.quantity}`).join(", ")}</p>
      ${
        order.invoiceNumber
          ? `<p><a class="text-link" href="/api/orders/${encodeURIComponent(order.orderNumber)}/invoice?email=${encodeURIComponent(
              form.email.value.trim()
            )}" target="_blank" rel="noreferrer">Descargar factura</a></p>`
          : ""
      }
    `;
  } catch (error) {
    result.classList.add("active");
    result.innerHTML = `<strong>No encontramos ese pedido.</strong><p>${escapeHtml(error.message)}</p>`;
  }
}

function setupTabs() {
  qsa(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      qsa(".tab").forEach((item) => item.classList.remove("active"));
      qsa(".admin-panel").forEach((panel) => panel.classList.remove("active"));
      tab.classList.add("active");
      qs(`#tab-${tab.dataset.tab}`).classList.add("active");
    });
  });
}

function setupCompanyToggles() {
  ["#customer-register-form", "#checkout-form", "#customer-profile-form"].forEach((selector) => {
    const form = qs(selector);
    const select = form?.elements.customerType;
    if (!form || !select) return;
    toggleCompanyFields(form, select.value === "empresa");
    select.addEventListener("change", () => toggleCompanyFields(form, select.value === "empresa"));
  });
}

function setupCustomerViews() {
  qsa(".account-view-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.accountView === "dashboard" && !state.customerSession.authenticated) return;
      setAccountView(button.dataset.accountView);
    });
  });

  qsa(".customer-section-button").forEach((button) => {
    button.addEventListener("click", () => setCustomerSection(button.dataset.customerSection));
  });
}

function setupEvents() {
  qs("#search-products").addEventListener("input", renderProducts);
  qs("#category-filter").addEventListener("change", renderProducts);
  qs("#price-filter").addEventListener("change", renderProducts);
  qs("#stock-filter").addEventListener("change", renderProducts);
  qs("#sort-products").addEventListener("change", renderProducts);
  qs("#product-form").addEventListener("submit", (event) => {
    handleProductSubmit(event).catch((error) => alert(error.message));
  });
  qs("#checkout-form").addEventListener("submit", handleCheckout);
  qs("#track-form").addEventListener("submit", handleTracking);
  qs("#admin-login-form").addEventListener("submit", handleAdminLogin);
  qs("#customer-login-form").addEventListener("submit", handleCustomerLogin);
  qs("#customer-register-form").addEventListener("submit", handleCustomerRegister);
  qs("#customer-profile-form").addEventListener("submit", handleCustomerProfileUpdate);
  qs("#shipping-settings-form").addEventListener("submit", handleShippingSettingsSubmit);
  qs("#invoice-settings-form").addEventListener("submit", handleInvoiceSettingsSubmit);
  qs("#shipping-rate-form").addEventListener("submit", handleShippingRateSubmit);
  qs("#shipment-form").addEventListener("submit", handleShipmentSubmit);
  qs('#checkout-form [name="shippingCountry"]').addEventListener("input", () => refreshShippingQuote().catch(console.error));
  qs("#product-dialog-close").addEventListener("click", closeProductDialog);
  qs("#product-dialog-add").addEventListener("click", () => {
    if (!state.activeProduct) return;
    addToCart(state.activeProduct.id, Number(qs("#product-dialog-qty").value || 1));
    closeProductDialog();
  });
  qs("#product-dialog").addEventListener("click", (event) => {
    if (event.target === qs("#product-dialog")) closeProductDialog();
  });
  qs("#admin-logout-button").addEventListener("click", () => handleAdminLogout().catch(console.error));
  qs("#header-admin-logout").addEventListener("click", () => handleAdminLogout().catch(console.error));
  qs("#customer-logout-button").addEventListener("click", () => handleCustomerLogout().catch(console.error));
  qs("#clear-cart").addEventListener("click", () => {
    cart = [];
    refreshShippingQuote().catch(console.error);
  });
  qs("#cart-open").addEventListener("click", () => {
    qs("#comprar").scrollIntoView({ behavior: "smooth" });
  });
  setupCompanyToggles();
  setupCustomerViews();
}

async function bootstrap() {
  setupTabs();
  setupEvents();
  try {
    const [adminSession, customerSession] = await Promise.all([
      apiFetch("/api/admin/session"),
      apiFetch("/api/auth/session")
    ]);
    state.adminSession = adminSession;
    state.customerSession = customerSession;
    setAdminVisibility(adminSession.authenticated);
    setCustomerVisibility(customerSession.authenticated);
    if (customerSession.customer) fillCustomerForms(customerSession.customer);
    await loadAllData();
  } catch (error) {
    console.error(error);
    qs("#product-grid").innerHTML = `<p class="form-note">No se pudo conectar con el backend. Arranca el servidor Node y revisa la conexion con PostgreSQL.</p>`;
  }
}

bootstrap();
