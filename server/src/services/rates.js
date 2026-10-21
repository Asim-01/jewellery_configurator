import { EventEmitter } from 'node:events';
import { clock } from '../clock.js';

export const METALS = ['gold', 'silver', 'platinum'];

/** Emits 'rate' events ({ metal, ratePaise, at }) — consumed by the SSE endpoint. */
export const rateEvents = new EventEmitter();
rateEvents.setMaxListeners(0);

export async function getCurrentRate(db, metal) {
  const { rows } = await db.query(
    'SELECT id, rate_paise_per_gram AS rate, created_at FROM metal_rates WHERE metal = $1 ORDER BY id DESC LIMIT 1',
    [metal],
  );
  if (!rows[0]) throw new Error(`No rate configured for ${metal}`);
  return { id: rows[0].id, ratePaise: rows[0].rate, updatedAt: rows[0].created_at };
}

export async function getAllCurrentRates(db) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (metal) metal, id, rate_paise_per_gram AS rate, created_at
       FROM metal_rates ORDER BY metal, id DESC`,
  );
  return Object.fromEntries(rows.map((r) => [r.metal, { id: r.id, ratePaise: r.rate, updatedAt: r.created_at }]));
}

export async function setRate(db, metal, ratePaise) {
  if (!METALS.includes(metal)) throw new Error(`Unknown metal ${metal}`);
  if (!Number.isSafeInteger(ratePaise) || ratePaise <= 0) throw new Error('Rate must be a positive integer (paise)');
  const { rows } = await db.query(
    'INSERT INTO metal_rates (metal, rate_paise_per_gram) VALUES ($1, $2) RETURNING id, created_at',
    [metal, ratePaise],
  );
  const event = { metal, ratePaise, id: rows[0].id, at: clock.now().toISOString() };
  rateEvents.emit('rate', event);
  return event;
}

/**
 * Optional extra: random-walk every metal by up to ±maxBps every intervalMs.
 * Returns a stop() function.
 */
export function startRateTicker(pool, { intervalMs = 60_000, maxBps = 40, log = console } = {}) {
  const tick = async () => {
    try {
      const rates = await getAllCurrentRates(pool);
      for (const metal of METALS) {
        if (!rates[metal]) continue;
        const bps = Math.round((Math.random() * 2 - 1) * maxBps);
        const next = Math.max(1, Math.round((rates[metal].ratePaise * (10_000 + bps)) / 10_000));
        await setRate(pool, metal, next);
      }
    } catch (err) {
      log.error?.('rate ticker failed', err);
    }
  };
  const handle = setInterval(tick, intervalMs);
  handle.unref?.();
  return () => clearInterval(handle);
}
