import { createPool, migrate } from '../src/db.js';
import { seed } from '../src/seed.js';
import { clock } from '../src/clock.js';
import { randomUUID } from 'node:crypto';

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/jewellery_test';

export const MINUTE = 60_000;

/** Fresh schema + seed data for every test file. */
export async function setupDb() {
  const pool = createPool(TEST_DB_URL);
  await pool.query(`DROP TABLE IF EXISTS order_items, orders, cart_items, carts, price_locks, products, metal_rates CASCADE`);
  await migrate(pool);
  await seed(pool);
  return pool;
}

export async function resetData(pool) {
  clock.reset();
  await pool.query(`TRUNCATE order_items, orders, cart_items, carts, price_locks, products, metal_rates RESTART IDENTITY CASCADE`);
  await seed(pool);
}

export async function productBySlug(pool, slug) {
  const { rows } = await pool.query('SELECT id, stock, metal FROM products WHERE slug = $1', [slug]);
  return rows[0];
}

export const newCartId = () => randomUUID();
