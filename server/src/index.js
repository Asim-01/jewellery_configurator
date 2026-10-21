import { createApp } from './app.js';
import { createPool, migrate } from './db.js';
import { seedIfEmpty } from './seed.js';
import { startRateTicker } from './services/rates.js';

const PORT = Number(process.env.PORT ?? 3000);

async function waitForDb(pool, attempts = 30) {
  for (let i = 1; ; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      console.log(`Waiting for database (${i}/${attempts})…`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

const pool = createPool();
await waitForDb(pool);
await migrate(pool);
if (await seedIfEmpty(pool)) console.log('Seeded sample products and rates');

if (process.env.RATE_TICKER !== 'off') {
  const intervalMs = Number(process.env.RATE_TICK_MS ?? 60_000);
  startRateTicker(pool, { intervalMs });
  console.log(`Live rate ticker on: rates move every ${intervalMs / 1000}s`);
}

createApp(pool).listen(PORT, () => console.log(`Jewellery store on http://localhost:${PORT}`));
