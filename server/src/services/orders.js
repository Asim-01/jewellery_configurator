import { withTx } from '../db.js';
import { AppError } from '../errors.js';
import { quoteFromLock } from './locks.js';

/**
 * The one place stock is taken. Must be called inside a transaction.
 *
 * Safety under concurrency: the decrement is a single conditional UPDATE
 * (`... WHERE stock >= qty`). In PostgreSQL the second of two concurrent
 * UPDATEs on the same row blocks on the first's row lock, then re-checks the
 * WHERE clause against the committed row. So if two customers race for the last
 * unit, the loser sees stock = 0, updates zero rows, and we abort its whole
 * transaction. Products are locked in id order to avoid deadlocks between
 * multi-item carts. The CHECK (stock >= 0) constraint is a final backstop.
 *
 * @param lines [{ productId, productName, purityCode, sizeCode, qty, unitPricePaise, breakdown }]
 */
export async function commitOrder(client, lines, source) {
  const qtyByProduct = new Map();
  for (const l of lines) qtyByProduct.set(l.productId, (qtyByProduct.get(l.productId) ?? 0) + l.qty);

  for (const productId of [...qtyByProduct.keys()].sort((a, b) => a - b)) {
    const qty = qtyByProduct.get(productId);
    const { rowCount } = await client.query(
      'UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2',
      [productId, qty],
    );
    if (rowCount === 0) {
      const name = lines.find((l) => l.productId === productId)?.productName ?? 'This item';
      throw new AppError(409, 'OUT_OF_STOCK', `Sorry, ${name} has just sold out.`, { productId });
    }
  }

  const totalPaise = lines.reduce((sum, l) => sum + l.unitPricePaise * l.qty, 0);
  const { rows } = await client.query(
    'INSERT INTO orders (total_paise, source) VALUES ($1, $2) RETURNING id, total_paise, created_at',
    [totalPaise, source],
  );
  const order = rows[0];
  for (const l of lines) {
    await client.query(
      `INSERT INTO order_items (order_id, product_id, purity_code, size_code, qty, unit_price_paise, breakdown)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [order.id, l.productId, l.purityCode, l.sizeCode, l.qty, l.unitPricePaise, JSON.stringify(l.breakdown)],
    );
  }
  return { id: order.id, totalPaise: order.total_paise, createdAt: order.created_at, source };
}

/** Buy now: straight from the product page's price lock to an order. */
export async function buyNow(pool, { lockId, productId, purityCode, sizeCode, qty = 1, expectedUnitPricePaise }) {
  return withTx(pool, async (client) => {
    const { product, quote } = await quoteFromLock(client, {
      lockId,
      productId,
      purityCode,
      sizeCode,
      qty,
      expectedUnitPricePaise,
    });
    return commitOrder(
      client,
      [
        {
          productId: product.id,
          productName: product.name,
          purityCode,
          sizeCode,
          qty,
          unitPricePaise: quote.totalPaise,
          breakdown: quote,
        },
      ],
      'buy_now',
    );
  });
}

export async function getOrder(db, id) {
  const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Order not found');
  const items = await db.query(
    `SELECT oi.*, p.name, p.slug, p.metal, p.category FROM order_items oi
       JOIN products p ON p.id = oi.product_id WHERE order_id = $1 ORDER BY oi.id`,
    [id],
  );
  return {
    id: rows[0].id,
    totalPaise: rows[0].total_paise,
    source: rows[0].source,
    createdAt: rows[0].created_at,
    items: items.rows.map((r) => ({
      productId: r.product_id,
      name: r.name,
      slug: r.slug,
      metal: r.metal,
      category: r.category,
      qty: r.qty,
      unitPricePaise: r.unit_price_paise,
      breakdown: r.breakdown,
    })),
  };
}
