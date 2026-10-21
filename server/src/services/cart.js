import { priceProduct } from '../../../shared/pricing.js';
import { lockMs as LOCK_MS } from '../config.js';
import { clock } from '../clock.js';
import { withTx } from '../db.js';
import { AppError, badRequest, notFound } from '../errors.js';
import { quoteFromLock } from './locks.js';
import { commitOrder } from './orders.js';
import { mapProduct } from './products.js';
import { getAllCurrentRates } from './rates.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const assertCartId = (id) => {
  if (!UUID_RE.test(String(id))) throw badRequest('Invalid cart id');
};
const plus = (date, ms) => new Date(date.getTime() + ms);

// ---------------------------------------------------------------------------
// Re-pricing after a lock expires
// ---------------------------------------------------------------------------

/**
 * Decide what should happen to one cart item right now. Pure function: returns
 * the column changes to apply, or null if nothing changes.
 *
 *  - not enough stock               -> out_of_stock (cannot be checked out)
 *  - lock still valid               -> nothing
 *  - lock expired, price lower      -> apply new price automatically, note "decreased"
 *  - lock expired, price the same   -> fresh lock, note "unchanged"
 *  - lock expired, price higher     -> price_increase: customer must accept (old price kept until then)
 *  - pending increase itself expired-> re-quote again against the then-live rate
 */
export function reconcileItem(item, product, liveRatePaise, now) {
  if (product.stock < item.qty) {
    if (item.status === 'out_of_stock') return null;
    return { status: 'out_of_stock', pending_price_paise: null, pending_breakdown: null, pending_expires_at: null };
  }

  const needsQuote =
    item.status === 'out_of_stock' ||
    (item.status === 'locked' && item.lock_expires_at <= now) ||
    (item.status === 'price_increase' && item.pending_expires_at <= now);
  if (!needsQuote) return null;

  const quote = priceProduct(product, { purityCode: item.purity_code, sizeCode: item.size_code }, liveRatePaise);
  const oldPrice = item.unit_price_paise;
  const newPrice = quote.totalPaise;

  if (newPrice > oldPrice) {
    return {
      status: 'price_increase',
      change: 'increased',
      previous_price_paise: oldPrice,
      pending_price_paise: newPrice,
      pending_breakdown: quote,
      pending_expires_at: plus(now, LOCK_MS),
    };
  }
  return {
    status: 'locked',
    change: newPrice < oldPrice ? 'decreased' : 'unchanged',
    previous_price_paise: oldPrice,
    unit_price_paise: newPrice,
    breakdown: quote,
    lock_expires_at: plus(now, LOCK_MS),
    pending_price_paise: null,
    pending_breakdown: null,
    pending_expires_at: null,
  };
}

const JSON_COLS = new Set(['breakdown', 'pending_breakdown']);

async function updateItem(client, id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => (JSON_COLS.has(k) && fields[k] != null ? JSON.stringify(fields[k]) : fields[k]));
  await client.query(`UPDATE cart_items SET ${sets} WHERE id = $1`, [id, ...values]);
}

async function loadItemsForUpdate(client, cartId) {
  const { rows } = await client.query(
    `SELECT ci.*, row_to_json(p) AS product
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
      WHERE ci.cart_id = $1 ORDER BY ci.id FOR UPDATE OF ci`,
    [cartId],
  );
  return rows;
}

/** Re-price every expired item in the cart (in one transaction). */
async function reconcileCart(client, cartId) {
  const now = clock.now();
  const rows = await loadItemsForUpdate(client, cartId);
  if (!rows.length) return;
  const rates = await getAllCurrentRates(client);
  for (const row of rows) {
    const product = mapProduct(row.product);
    const changes = reconcileItem(row, product, rates[product.metal].ratePaise, now);
    if (changes) await updateItem(client, row.id, changes);
  }
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

async function readCart(db, cartId) {
  const { rows } = await db.query(
    `SELECT ci.*, row_to_json(p) AS product
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
      WHERE ci.cart_id = $1 ORDER BY ci.id`,
    [cartId],
  );
  const items = rows.map((r) => {
    const product = mapProduct(r.product);
    return {
      id: r.id,
      product: { id: product.id, slug: product.slug, name: product.name, metal: product.metal, category: product.category },
      stock: product.stock,
      purityCode: r.purity_code,
      sizeCode: r.size_code,
      purityLabel: r.breakdown.purityLabel,
      sizeLabel: r.breakdown.sizeLabel,
      qty: r.qty,
      status: r.status,
      change: r.change,
      addedPricePaise: r.added_price_paise,
      unitPricePaise: r.unit_price_paise,
      linePaise: r.unit_price_paise * r.qty,
      breakdown: r.breakdown,
      lockExpiresAt: r.lock_expires_at,
      previousPricePaise: r.previous_price_paise,
      pendingPricePaise: r.pending_price_paise,
      pendingBreakdown: r.pending_breakdown,
      pendingExpiresAt: r.pending_expires_at,
    };
  });

  const confirmed = items.filter((i) => i.status === 'locked');
  const awaiting = items.filter((i) => i.status === 'price_increase');
  const outOfStock = items.filter((i) => i.status === 'out_of_stock');
  return {
    id: cartId,
    items,
    summary: {
      itemCount: items.reduce((n, i) => n + i.qty, 0),
      confirmedCount: confirmed.length,
      awaitingConfirmationCount: awaiting.length,
      outOfStockCount: outOfStock.length,
      totalPaise: confirmed.reduce((s, i) => s + i.linePaise, 0),
      // what the total would be if every pending increase were accepted
      totalIfAcceptedPaise:
        confirmed.reduce((s, i) => s + i.linePaise, 0) +
        awaiting.reduce((s, i) => s + i.pendingPricePaise * i.qty, 0),
      canCheckout: items.length > 0 && awaiting.length === 0 && outOfStock.length === 0,
    },
    serverTime: clock.now().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function getCart(pool, cartId) {
  assertCartId(cartId);
  await withTx(pool, (client) => reconcileCart(client, cartId));
  return readCart(pool, cartId);
}

export async function addItem(pool, cartId, { lockId, productId, purityCode, sizeCode, qty = 1, expectedUnitPricePaise }) {
  assertCartId(cartId);
  await withTx(pool, async (client) => {
    const { product, quote } = await quoteFromLock(client, {
      lockId,
      productId,
      purityCode,
      sizeCode,
      qty,
      expectedUnitPricePaise,
    });
    await client.query('INSERT INTO carts (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [cartId]);
    // A fresh 10-minute lock starts when the item is added, at the price the customer just saw.
    const now = clock.now();
    await client.query(
      `INSERT INTO cart_items (cart_id, product_id, purity_code, size_code, qty, unit_price_paise,
                               breakdown, lock_expires_at, added_price_paise)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$6)`,
      [cartId, product.id, purityCode, sizeCode, qty, quote.totalPaise, JSON.stringify(quote), plus(now, LOCK_MS)],
    );
  });
  return getCart(pool, cartId);
}

export async function removeItem(pool, cartId, itemId) {
  assertCartId(cartId);
  await pool.query('DELETE FROM cart_items WHERE id = $1 AND cart_id = $2', [itemId, cartId]);
  return getCart(pool, cartId);
}

/**
 * Accept a price increase. The client must echo the price it showed, so a customer
 * can never accept a number they didn't see (e.g. if the pending quote expired
 * and was re-quoted between render and click).
 */
export async function acceptPrice(pool, cartId, itemId, shownPendingPricePaise) {
  assertCartId(cartId);
  const outcome = await withTx(pool, async (client) => {
    await reconcileCart(client, cartId);
    const { rows } = await client.query('SELECT * FROM cart_items WHERE id = $1 AND cart_id = $2 FOR UPDATE', [
      itemId,
      cartId,
    ]);
    const item = rows[0];
    if (!item) throw notFound('Cart item');
    if (item.status !== 'price_increase') return 'nothing_to_accept';
    if (item.pending_price_paise !== shownPendingPricePaise) return 'stale';
    await updateItem(client, item.id, {
      status: 'locked',
      change: 'accepted',
      previous_price_paise: item.unit_price_paise,
      unit_price_paise: item.pending_price_paise,
      breakdown: item.pending_breakdown,
      lock_expires_at: plus(clock.now(), LOCK_MS),
      pending_price_paise: null,
      pending_breakdown: null,
      pending_expires_at: null,
    });
    return 'accepted';
  });
  const cart = await readCart(pool, cartId);
  if (outcome === 'stale') {
    throw new AppError(409, 'PRICE_CHANGED_AGAIN', 'The price changed again. Please review the new price.', { cart });
  }
  return cart;
}

const CART_CONFLICTS = new Set(['CART_NEEDS_CONFIRMATION', 'OUT_OF_STOCK', 'PRICE_MISMATCH']);

/**
 * Place an order for the whole cart.
 * Rejected (409, with the refreshed cart attached) if any item's lock has expired,
 * any item has an unaccepted increase or is out of stock, or the total differs
 * from what the customer was shown.
 */
export async function checkout(pool, cartId, { expectedTotalPaise } = {}) {
  assertCartId(cartId);
  try {
    return await withTx(pool, async (client) => {
      // Row-locking the cart lines also serialises double-clicked checkouts of the same cart.
      const rows = await loadItemsForUpdate(client, cartId);
      if (!rows.length) throw new AppError(400, 'EMPTY_CART', 'Your cart is empty.');

      const now = clock.now();
      const blocked = rows.filter((r) => r.status !== 'locked' || r.lock_expires_at <= now);
      if (blocked.length) {
        throw new AppError(409, 'CART_NEEDS_CONFIRMATION', 'Some prices need your attention before checkout.');
      }

      const lines = rows.map((r) => ({
        productId: r.product_id,
        productName: r.product.name,
        purityCode: r.purity_code,
        sizeCode: r.size_code,
        qty: r.qty,
        unitPricePaise: r.unit_price_paise,
        breakdown: r.breakdown,
      }));
      const total = lines.reduce((s, l) => s + l.unitPricePaise * l.qty, 0);
      if (expectedTotalPaise == null || expectedTotalPaise !== total) {
        throw new AppError(409, 'PRICE_MISMATCH', 'Your cart total has changed. Please review before paying.');
      }

      const order = await commitOrder(client, lines, 'cart');
      await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
      return order;
    });
  } catch (err) {
    if (err instanceof AppError && CART_CONFLICTS.has(err.code)) {
      err.details = { ...err.details, cart: await getCart(pool, cartId) };
    }
    throw err;
  }
}
