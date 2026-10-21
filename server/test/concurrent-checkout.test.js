// Two customers try to buy the last unit at the same moment: exactly one succeeds.
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { priceProduct } from '../../shared/pricing.js';
import { addItem, checkout } from '../src/services/cart.js';
import { createLock } from '../src/services/locks.js';
import { buyNow } from '../src/services/orders.js';
import { newCartId, productBySlug, resetData, setupDb } from './helpers.js';

let pool;
before(async () => (pool = await setupDb()));
beforeEach(() => resetData(pool));
after(() => pool.end());

const necklaceCfg = { purityCode: '22K', sizeCode: '16', qty: 1 };

async function cartWithNecklace() {
  const necklace = await productBySlug(pool, 'meher-temple-necklace');
  const { lock } = await createLock(pool, necklace.id);
  const cartId = newCartId();
  const cart = await addItem(pool, cartId, { lockId: lock.id, productId: necklace.id, ...necklaceCfg });
  return { cartId, total: cart.summary.totalPaise };
}

const orderCount = async () => (await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n;
const outcomes = (results) => ({
  ok: results.filter((r) => r.status === 'fulfilled').length,
  soldOut: results.filter((r) => r.status === 'rejected' && r.reason.code === 'OUT_OF_STOCK').length,
  other: results.filter((r) => r.status === 'rejected' && r.reason.code !== 'OUT_OF_STOCK').map((r) => r.reason),
});

test('two simultaneous cart checkouts for the last unit: exactly one wins', async () => {
  assert.equal((await productBySlug(pool, 'meher-temple-necklace')).stock, 1);
  const a = await cartWithNecklace();
  const b = await cartWithNecklace();

  const results = await Promise.allSettled([
    checkout(pool, a.cartId, { expectedTotalPaise: a.total }),
    checkout(pool, b.cartId, { expectedTotalPaise: b.total }),
  ]);

  const o = outcomes(results);
  assert.deepEqual(o.other, []);
  assert.equal(o.ok, 1, 'exactly one order succeeds');
  assert.equal(o.soldOut, 1, 'the other is told it sold out');
  assert.equal((await productBySlug(pool, 'meher-temple-necklace')).stock, 0);
  assert.equal(await orderCount(), 1);

  // The loser's cart is returned refreshed, with the item marked out of stock.
  const loser = results.find((r) => r.status === 'rejected').reason;
  assert.equal(loser.details.cart.items[0].status, 'out_of_stock');
  assert.equal(loser.details.cart.summary.canCheckout, false);
});

test('repeated races are always safe (20 rounds, 2 buyers each)', async () => {
  for (let round = 0; round < 20; round++) {
    await resetData(pool);
    const a = await cartWithNecklace();
    const b = await cartWithNecklace();
    const o = outcomes(
      await Promise.allSettled([
        checkout(pool, a.cartId, { expectedTotalPaise: a.total }),
        checkout(pool, b.cartId, { expectedTotalPaise: b.total }),
      ]),
    );
    assert.equal(o.ok, 1, `round ${round}`);
    assert.equal(o.soldOut, 1, `round ${round}`);
    assert.equal(await orderCount(), 1, `round ${round}`);
  }
});

test('15 simultaneous Buy-now requests for a 3-unit piece: exactly 3 orders, stock ends at 0', async () => {
  const ring = await productBySlug(pool, 'aarna-solitaire-ring');
  assert.equal(ring.stock, 3);
  const cfg = { purityCode: '18K', sizeCode: '10', qty: 1 };
  const buyers = await Promise.all(
    Array.from({ length: 15 }, async () => {
      const { lock, product } = await createLock(pool, ring.id);
      return { lockId: lock.id, expected: priceProduct(product, cfg, lock.ratePaise).totalPaise };
    }),
  );
  const o = outcomes(
    await Promise.allSettled(
      buyers.map((b) => buyNow(pool, { lockId: b.lockId, productId: ring.id, ...cfg, expectedUnitPricePaise: b.expected })),
    ),
  );
  assert.deepEqual(o.other, []);
  assert.equal(o.ok, 3);
  assert.equal(o.soldOut, 12);
  assert.equal((await productBySlug(pool, 'aarna-solitaire-ring')).stock, 0);
  assert.equal(await orderCount(), 3);
});

test('cart checkout racing a Buy-now for the last unit: exactly one wins', async () => {
  const necklace = await productBySlug(pool, 'meher-temple-necklace');
  const a = await cartWithNecklace();
  const { lock, product } = await createLock(pool, necklace.id);
  const expected = priceProduct(product, necklaceCfg, lock.ratePaise).totalPaise;

  const o = outcomes(
    await Promise.allSettled([
      checkout(pool, a.cartId, { expectedTotalPaise: a.total }),
      buyNow(pool, { lockId: lock.id, productId: necklace.id, ...necklaceCfg, expectedUnitPricePaise: expected }),
    ]),
  );
  assert.equal(o.ok, 1);
  assert.equal(o.soldOut, 1);
  assert.equal(await orderCount(), 1);
});

test('a double-clicked checkout of the same cart places only one order', async () => {
  const a = await cartWithNecklace();
  const results = await Promise.allSettled([
    checkout(pool, a.cartId, { expectedTotalPaise: a.total }),
    checkout(pool, a.cartId, { expectedTotalPaise: a.total }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await orderCount(), 1);
});
