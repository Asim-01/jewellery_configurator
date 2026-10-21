import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './errors.js';
import { acceptPrice, addItem, checkout, getCart, removeItem } from './services/cart.js';
import { createLock } from './services/locks.js';
import { buyNow, getOrder } from './services/orders.js';
import { getProduct, listProducts, updatePricingRules } from './services/products.js';
import { getAllCurrentRates, rateEvents, setRate } from './services/rates.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

export function createApp(pool, { adminToken = process.env.ADMIN_TOKEN ?? 'admin', staticDir } = {}) {
  const app = express();
  app.use(express.json());
  const api = express.Router();

  api.get('/health', (_req, res) => res.json({ ok: true }));

  // --- rates ---------------------------------------------------------------
  api.get('/rates', wrap(async (_req, res) => res.json(await getAllCurrentRates(pool))));

  // Server-sent events: live rate changes pushed to product & cart pages.
  api.get('/rates/stream', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const send = (e) => res.write(`event: rate\ndata: ${JSON.stringify(e)}\n\n`);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    rateEvents.on('rate', send);
    req.on('close', () => {
      clearInterval(ping);
      rateEvents.off('rate', send);
    });
  });

  // --- products & price locks ---------------------------------------------
  api.get('/products', wrap(async (_req, res) => res.json(await listProducts(pool))));
  api.get('/products/:idOrSlug', wrap(async (req, res) => res.json(await getProduct(pool, req.params.idOrSlug))));
  // Viewing a product takes a 10-minute price lock.
  api.post('/products/:idOrSlug/lock', wrap(async (req, res) => res.status(201).json(await createLock(pool, req.params.idOrSlug))));

  api.post('/buy-now', wrap(async (req, res) => res.status(201).json(await buyNow(pool, req.body ?? {}))));

  // --- cart ----------------------------------------------------------------
  api.get('/carts/:cartId', wrap(async (req, res) => res.json(await getCart(pool, req.params.cartId))));
  api.post('/carts/:cartId/items', wrap(async (req, res) => res.status(201).json(await addItem(pool, req.params.cartId, req.body ?? {}))));
  api.delete('/carts/:cartId/items/:itemId', wrap(async (req, res) =>
    res.json(await removeItem(pool, req.params.cartId, Number(req.params.itemId)))));
  api.post('/carts/:cartId/items/:itemId/accept', wrap(async (req, res) =>
    res.json(await acceptPrice(pool, req.params.cartId, Number(req.params.itemId), req.body?.pendingPricePaise))));
  api.post('/carts/:cartId/checkout', wrap(async (req, res) =>
    res.status(201).json(await checkout(pool, req.params.cartId, req.body ?? {}))));

  api.get('/orders/:id', wrap(async (req, res) => res.json(await getOrder(pool, Number(req.params.id)))));

  // --- admin (optional extra) ---------------------------------------------
  const requireAdmin = (req, _res, next) =>
    req.get('x-admin-token') === adminToken ? next() : next(new AppError(401, 'UNAUTHORISED', 'Admin token required'));
  api.put('/admin/products/:id/pricing-rules', requireAdmin, wrap(async (req, res) =>
    res.json(await updatePricingRules(pool, Number(req.params.id), req.body ?? {}))));
  api.put('/admin/rates/:metal', requireAdmin, wrap(async (req, res) =>
    res.json(await setRate(pool, req.params.metal, req.body?.ratePaise))));

  app.use('/api', api);

  // Serve the built React app (production / docker).
  const dist = staticDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.details } });
    }
    if (err?.message && /must be|Unknown|Invalid/.test(err.message)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: err.message } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });

  return app;
}
