export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code ?? 'UNKNOWN';
    this.body = body?.error ?? {};
  }
}

async function request(method, url, body, headers = {}) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  products: () => request('GET', '/products'),
  rates: () => request('GET', '/rates'),
  lock: (slug) => request('POST', `/products/${slug}/lock`),
  buyNow: (payload) => request('POST', '/buy-now', payload),
  cart: (cartId) => request('GET', `/carts/${cartId}`),
  addToCart: (cartId, payload) => request('POST', `/carts/${cartId}/items`, payload),
  removeItem: (cartId, itemId) => request('DELETE', `/carts/${cartId}/items/${itemId}`),
  acceptPrice: (cartId, itemId, pendingPricePaise) =>
    request('POST', `/carts/${cartId}/items/${itemId}/accept`, { pendingPricePaise }),
  checkout: (cartId, expectedTotalPaise) => request('POST', `/carts/${cartId}/checkout`, { expectedTotalPaise }),
  order: (id) => request('GET', `/orders/${id}`),
  admin: {
    setRate: (token, metal, ratePaise) => request('PUT', `/admin/rates/${metal}`, { ratePaise }, { 'x-admin-token': token }),
    setRules: (token, id, rules) =>
      request('PUT', `/admin/products/${id}/pricing-rules`, rules, { 'x-admin-token': token }),
  },
};

/** Anonymous cart id, kept in localStorage. */
export function getCartId() {
  let id = localStorage.getItem('cartId');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('cartId', id);
  }
  return id;
}

/** Convert a server timestamp to the local clock, correcting for clock skew. */
export function toLocalDeadline(isoExpiresAt, isoServerTime, receivedAtMs = Date.now()) {
  const skew = Date.parse(isoServerTime) - receivedAtMs;
  return Date.parse(isoExpiresAt) - skew;
}
