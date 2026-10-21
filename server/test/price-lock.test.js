// Price-lock expiry: a viewed price holds for exactly 10 minutes, then is refused.
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { priceProduct } from '../../shared/pricing.js';
import { clock } from '../src/clock.js';
import { createLock, quoteFromLock } from '../src/services/locks.js';
import { buyNow } from '../src/services/orders.js';
import { setRate } from '../src/services/rates.js';
import { updatePricingRules } from '../src/services/products.js';
import { addItem } from '../src/services/cart.js';
import { MINUTE, newCartId, productBySlug, resetData, setupDb } from './helpers.js';

let pool;
before(async () => (pool = await setupDb()));
beforeEach(() => resetData(pool));
after(() => pool.end());

const cfg = { purityCode: '22K', sizeCode: '12', qty: 1 };

test('a lock is valid for 10 minutes and expires exactly at the 10-minute mark', async () => {
  const ring = await productBySlug(pool, 'aarna-solitaire-ring');
  const { lock } = await createLock(pool, ring.id);
  assert.equal(lock.expiresAt.getTime() - lock.createdAt.getTime(), 10 * MINUTE);

  clock.advance(10 * MINUTE - 1000); // 9:59
  await quoteFromLock(pool, { lockId: lock.id, productId: ring.id, ...cfg });

  clock.advance(1000); // 10:00
  await assert.rejects(quoteFromLock(pool, { lockId: lock.id, productId: ring.id, ...cfg }), { code: 'PRICE_EXPIRED' });
});

test('the locked price holds even when the live rate moves during the lock', async () => {
  const ring = await productBySlug(pool, 'aarna-solitaire-ring');
  const { lock, product } = await createLock(pool, ring.id);
  const seen = priceProduct(product, cfg, lock.ratePaise).totalPaise;

  await setRate(pool, 'gold', 1_400_000); // gold jumps ~12%
  clock.advance(5 * MINUTE);

  const { quote } = await quoteFromLock(pool, { lockId: lock.id, productId: ring.id, ...cfg, expectedUnitPricePaise: seen });
  assert.equal(quote.totalPaise, seen);
});

test('an admin change to making charges does not move a price that is already locked', async () => {
  const ring = await productBySlug(pool, 'aarna-solitaire-ring');
  const { lock, product } = await createLock(pool, ring.id);
  const seen = priceProduct(product, cfg, lock.ratePaise).totalPaise;
  await updatePricingRules(pool, ring.id, { wastageBps: 2000, makingType: 'per_gram', makingValue: 200_000 });
  const { quote } = await quoteFromLock(pool, { lockId: lock.id, productId: ring.id, ...cfg });
  assert.equal(quote.totalPaise, seen);
});

test('buy now succeeds inside the lock and is refused after it expires', async () => {
  const ring = await productBySlug(pool, 'aarna-solitaire-ring');
  const { lock, product } = await createLock(pool, ring.id);
  const seen = priceProduct(product, cfg, lock.ratePaise).totalPaise;

  const order = await buyNow(pool, { lockId: lock.id, productId: ring.id, ...cfg, expectedUnitPricePaise: seen });
  assert.equal(order.totalPaise, seen);

  const second = await createLock(pool, ring.id);
  clock.advance(10 * MINUTE + 1);
  await assert.rejects(
    buyNow(pool, { lockId: second.lock.id, productId: ring.id, ...cfg, expectedUnitPricePaise: seen }),
    { code: 'PRICE_EXPIRED' },
  );
  assert.equal((await productBySlug(pool, 'aarna-solitaire-ring')).stock, 2, 'expired buy-now took no stock');
});

test('add to cart is refused once the product-page lock has expired', async () => {
  const ring = await productBySlug(pool, 'aarna-solitaire-ring');
  const { lock } = await createLock(pool, ring.id);
  clock.advance(11 * MINUTE);
  await assert.rejects(addItem(pool, newCartId(), { lockId: lock.id, productId: ring.id, ...cfg }), {
    code: 'PRICE_EXPIRED',
  });
});

test('a client-side price that disagrees with the server is rejected, never charged', async () => {
  const ring = await productBySlug(pool, 'aarna-solitaire-ring');
  const { lock } = await createLock(pool, ring.id);
  await assert.rejects(
    buyNow(pool, { lockId: lock.id, productId: ring.id, ...cfg, expectedUnitPricePaise: 100 }),
    { code: 'PRICE_MISMATCH' },
  );
});
