// Cart behaviour when a lock expires and the price is re-calculated — exercised through the HTTP API.
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { priceProduct } from '../../shared/pricing.js';
import { createApp } from '../src/app.js';
import { clock } from '../src/clock.js';
import { setRate } from '../src/services/rates.js';
import { MINUTE, newCartId, productBySlug, resetData, setupDb } from './helpers.js';

let pool, app;
before(async () => {
  pool = await setupDb();
  app = createApp(pool, { staticDir: '/nonexistent' });
});
beforeEach(() => resetData(pool));
after(() => pool.end());

const SEED_GOLD = 1_245_000;
const ringCfg = { purityCode: '22K', sizeCode: '12' };

/** View the ring, add it to a fresh cart. Returns { cartId, item, product }. */
async function addRing(cartId = newCartId(), qty = 1) {
  const ring = await productBySlug(pool, 'aarna-solitaire-ring');
  const view = await request(app).post(`/api/products/${ring.id}/lock`).expect(201);
  const unit = priceProduct(view.body.product, ringCfg, view.body.lock.ratePaise).totalPaise;
  const res = await request(app)
    .post(`/api/carts/${cartId}/items`)
    .send({ lockId: view.body.lock.id, productId: ring.id, ...ringCfg, qty, expectedUnitPricePaise: unit })
    .expect(201);
  return { cartId, item: res.body.items.at(-1), cart: res.body, product: view.body.product, unit };
}

const getCart = (cartId) => request(app).get(`/api/carts/${cartId}`).expect(200).then((r) => r.body);
const priceAt = (product, rate) => priceProduct(product, ringCfg, rate).totalPaise;

test('an item keeps the price it was added at while its lock runs', async () => {
  const { cartId, unit } = await addRing();
  await setRate(pool, 'gold', 1_300_000);
  clock.advance(9 * MINUTE);
  const cart = await getCart(cartId);
  assert.equal(cart.items[0].unitPricePaise, unit);
  assert.equal(cart.items[0].addedPricePaise, unit);
  assert.equal(cart.items[0].status, 'locked');
  assert.equal(cart.items[0].change, null);
  assert.equal(cart.summary.canCheckout, true);
});

test('price DROP after expiry: new lower price applied automatically, with a note and the old price', async () => {
  const { cartId, unit, product } = await addRing();
  await setRate(pool, 'gold', 1_200_000);
  clock.advance(10 * MINUTE + 1);

  const cart = await getCart(cartId);
  const item = cart.items[0];
  const expected = priceAt(product, 1_200_000);
  assert.ok(expected < unit);
  assert.equal(item.status, 'locked');
  assert.equal(item.change, 'decreased');
  assert.equal(item.unitPricePaise, expected);
  assert.equal(item.previousPricePaise, unit);
  const remaining = new Date(item.lockExpiresAt).getTime() - clock.now().getTime();
  assert.ok(remaining > 9.9 * MINUTE && remaining <= 10 * MINUTE, 'a fresh 10-minute lock starts');
  assert.equal(cart.summary.canCheckout, true);

  const order = await request(app).post(`/api/carts/${cartId}/checkout`).send({ expectedTotalPaise: expected }).expect(201);
  assert.equal(order.body.totalPaise, expected, 'charged the lower price');
});

test('price UNCHANGED after expiry: fresh lock, note says it stayed the same', async () => {
  const { cartId, unit } = await addRing();
  clock.advance(10 * MINUTE + 1);
  const item = (await getCart(cartId)).items[0];
  assert.equal(item.status, 'locked');
  assert.equal(item.change, 'unchanged');
  assert.equal(item.unitPricePaise, unit);
});

test('price RISE after expiry: checkout is blocked until the customer accepts the new price', async () => {
  const { cartId, unit, product } = await addRing();
  await setRate(pool, 'gold', 1_300_000);
  clock.advance(10 * MINUTE + 1);
  const higher = priceAt(product, 1_300_000);

  const cart = await getCart(cartId);
  const item = cart.items[0];
  assert.equal(item.status, 'price_increase');
  assert.equal(item.change, 'increased');
  assert.equal(item.unitPricePaise, unit, 'old price stays until accepted');
  assert.equal(item.previousPricePaise, unit, 'old price shown struck through');
  assert.equal(item.pendingPricePaise, higher);
  assert.equal(cart.summary.awaitingConfirmationCount, 1);
  assert.equal(cart.summary.canCheckout, false);

  // Checkout is refused — at either price.
  for (const expectedTotalPaise of [unit, higher]) {
    const res = await request(app).post(`/api/carts/${cartId}/checkout`).send({ expectedTotalPaise }).expect(409);
    assert.equal(res.body.error.code, 'CART_NEEDS_CONFIRMATION');
    assert.equal(res.body.error.cart.items[0].status, 'price_increase');
  }

  // Accepting a price the customer was not shown is refused.
  const wrong = await request(app)
    .post(`/api/carts/${cartId}/items/${item.id}/accept`)
    .send({ pendingPricePaise: higher - 1 })
    .expect(409);
  assert.equal(wrong.body.error.code, 'PRICE_CHANGED_AGAIN');

  // Accept the shown price -> confirmed, new 10-minute lock, checkout allowed at exactly that price.
  const accepted = await request(app)
    .post(`/api/carts/${cartId}/items/${item.id}/accept`)
    .send({ pendingPricePaise: higher })
    .expect(200);
  assert.equal(accepted.body.items[0].status, 'locked');
  assert.equal(accepted.body.items[0].change, 'accepted');
  assert.equal(accepted.body.items[0].unitPricePaise, higher);
  assert.equal(accepted.body.summary.canCheckout, true);

  const order = await request(app).post(`/api/carts/${cartId}/checkout`).send({ expectedTotalPaise: higher }).expect(201);
  assert.equal(order.body.totalPaise, higher);
});

test('if a pending increase is left unaccepted past its own lock, it is re-quoted against the live rate', async () => {
  const { cartId, product } = await addRing();
  await setRate(pool, 'gold', 1_300_000);
  clock.advance(10 * MINUTE + 1);
  const first = (await getCart(cartId)).items[0];

  await setRate(pool, 'gold', 1_350_000);
  clock.advance(10 * MINUTE + 1);
  const second = (await getCart(cartId)).items[0];
  assert.equal(second.pendingPricePaise, priceAt(product, 1_350_000));

  // Accepting the stale (first) pending price is refused.
  await request(app)
    .post(`/api/carts/${cartId}/items/${first.id}/accept`)
    .send({ pendingPricePaise: first.pendingPricePaise })
    .expect(409);
});

test('if the price falls back while an increase is pending, the original price is kept automatically', async () => {
  const { cartId, unit } = await addRing();
  await setRate(pool, 'gold', 1_300_000);
  clock.advance(10 * MINUTE + 1);
  assert.equal((await getCart(cartId)).items[0].status, 'price_increase');

  await setRate(pool, 'gold', SEED_GOLD);
  clock.advance(10 * MINUTE + 1);
  const item = (await getCart(cartId)).items[0];
  assert.equal(item.status, 'locked');
  assert.equal(item.change, 'unchanged');
  assert.equal(item.unitPricePaise, unit);
});

test('OUT OF STOCK: item is flagged and checkout is blocked', async () => {
  const { cartId } = await addRing(newCartId(), 3); // all 3 units
  // someone else buys one
  await pool.query("UPDATE products SET stock = 2 WHERE slug = 'aarna-solitaire-ring'");
  clock.advance(10 * MINUTE + 1);
  const cart = await getCart(cartId);
  assert.equal(cart.items[0].status, 'out_of_stock');
  assert.equal(cart.summary.outOfStockCount, 1);
  assert.equal(cart.summary.canCheckout, false);
  const res = await request(app)
    .post(`/api/carts/${cartId}/checkout`)
    .send({ expectedTotalPaise: cart.items[0].linePaise })
    .expect(409);
  assert.equal(res.body.error.code, 'CART_NEEDS_CONFIRMATION');
});

test('checkout with an expired lock that the customer has not re-viewed is refused, and the cart is refreshed', async () => {
  const { cartId, unit } = await addRing();
  await setRate(pool, 'gold', 1_200_000); // even a drop must be shown before charging
  clock.advance(10 * MINUTE + 1);
  const res = await request(app).post(`/api/carts/${cartId}/checkout`).send({ expectedTotalPaise: unit }).expect(409);
  assert.equal(res.body.error.code, 'CART_NEEDS_CONFIRMATION');
  assert.equal(res.body.error.cart.items[0].change, 'decreased');
  assert.equal((await productBySlug(pool, 'aarna-solitaire-ring')).stock, 3);
});

test('checkout is refused if the total the customer saw differs from the cart', async () => {
  const { cartId, unit } = await addRing();
  const res = await request(app).post(`/api/carts/${cartId}/checkout`).send({ expectedTotalPaise: unit - 1 }).expect(409);
  assert.equal(res.body.error.code, 'PRICE_MISMATCH');
});

test('summary counts confirmed vs awaiting items; checkout only when every item is confirmed', async () => {
  const cartId = newCartId();
  await addRing(cartId);
  clock.advance(5 * MINUTE);
  await addRing(cartId); // second item, locked later
  await setRate(pool, 'gold', 1_300_000);
  clock.advance(5 * MINUTE + 1); // first item's lock expired, second's still running

  const cart = await getCart(cartId);
  assert.deepEqual(cart.items.map((i) => i.status), ['price_increase', 'locked']);
  assert.equal(cart.summary.confirmedCount, 1);
  assert.equal(cart.summary.awaitingConfirmationCount, 1);
  assert.equal(cart.summary.totalPaise, cart.items[1].linePaise);
  assert.equal(cart.summary.totalIfAcceptedPaise, cart.items[1].linePaise + cart.items[0].pendingPricePaise);
  assert.equal(cart.summary.canCheckout, false);

  await request(app)
    .post(`/api/carts/${cartId}/items/${cart.items[0].id}/accept`)
    .send({ pendingPricePaise: cart.items[0].pendingPricePaise })
    .expect(200);
  assert.equal((await getCart(cartId)).summary.canCheckout, true);
});
