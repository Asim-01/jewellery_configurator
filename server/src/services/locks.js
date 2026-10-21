import { priceProduct } from '../../../shared/pricing.js';
import { lockMs as LOCK_MS } from '../config.js';
import { clock } from '../clock.js';
import { AppError, badRequest } from '../errors.js';
import { getCurrentRate } from './rates.js';
import { getProduct } from './products.js';

const mapLock = (r) => ({
  id: r.id,
  productId: r.product_id,
  ratePaise: r.rate_paise,
  product: r.product_snapshot,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
});

/**
 * Called when a customer views a product: snapshot the live rate for 10 minutes.
 * The client prices any purity/size combination against this snapshot instantly.
 */
export async function createLock(db, productIdOrSlug) {
  const product = await getProduct(db, productIdOrSlug);
  const rate = await getCurrentRate(db, product.metal);
  const now = clock.now();
  const { rows } = await db.query(
    `INSERT INTO price_locks (product_id, rate_id, rate_paise, product_snapshot, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [product.id, rate.id, rate.ratePaise, JSON.stringify(product), now, new Date(now.getTime() + LOCK_MS)],
  );
  return { lock: mapLock(rows[0]), product, serverTime: now.toISOString() };
}

/**
 * Validate a lock and price a configuration against it (server-side, never trusting the client's number).
 * Throws PRICE_EXPIRED / PRICE_MISMATCH / OUT_OF_STOCK.
 */
export async function quoteFromLock(db, { lockId, productId, purityCode, sizeCode, qty, expectedUnitPricePaise }) {
  if (!Number.isInteger(qty) || qty < 1) throw badRequest('qty must be a positive integer');
  const { rows } = await db.query('SELECT * FROM price_locks WHERE id = $1', [lockId]);
  const lock = rows[0] && mapLock(rows[0]);
  if (!lock || lock.productId !== Number(productId)) throw badRequest('Invalid price lock');

  if (lock.expiresAt <= clock.now()) {
    throw new AppError(409, 'PRICE_EXPIRED', 'Your price lock has expired. Please review the latest price.');
  }

  const product = await getProduct(db, lock.productId); // live row, for stock
  let quote;
  try {
    // price with the rules + rate captured when the customer viewed the product
    quote = priceProduct(lock.product, { purityCode, sizeCode }, lock.ratePaise);
  } catch (err) {
    throw badRequest(err.message);
  }

  if (expectedUnitPricePaise != null && expectedUnitPricePaise !== quote.totalPaise) {
    throw new AppError(409, 'PRICE_MISMATCH', 'The price has changed since it was shown. Please review.', {
      unitPricePaise: quote.totalPaise,
    });
  }
  if (product.stock < qty) {
    throw new AppError(409, 'OUT_OF_STOCK', `Sorry, ${product.name} is out of stock.`, { stock: product.stock });
  }
  return { lock, product, quote };
}
