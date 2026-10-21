import pg from 'pg';
import { readFile } from 'node:fs/promises';

// BIGINT columns come back as strings by default; all our amounts fit safely in a JS number.
pg.types.setTypeParser(20, (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`BIGINT ${v} exceeds safe integer range`);
  return n;
});

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  return new pg.Pool({ connectionString, max: 20 });
}

export async function migrate(pool) {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}

/** Run fn inside a transaction on a dedicated connection. */
export async function withTx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
