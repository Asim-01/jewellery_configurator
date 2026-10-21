import { priceProduct } from '../../../shared/pricing.js';
import { notFound } from '../errors.js';
import { getAllCurrentRates } from './rates.js';

export function mapProduct(r) {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    category: r.category,
    metal: r.metal,
    purities: r.purities,
    sizes: r.sizes,
    wastageBps: r.wastage_bps,
    makingType: r.making_type,
    makingValue: Number(r.making_value),
    stones: r.stones,
    stock: r.stock,
  };
}

export async function listProducts(db) {
  const [{ rows }, rates] = await Promise.all([db.query('SELECT * FROM products ORDER BY id'), getAllCurrentRates(db)]);
  return rows.map(mapProduct).map((p) => {
    // "From" price: cheapest purity at the smallest size, at the live rate.
    const prices = p.purities.map(
      (pu) => priceProduct(p, { purityCode: pu.code, sizeCode: p.sizes[0].code }, rates[p.metal].ratePaise).totalPaise,
    );
    return { ...p, fromPricePaise: Math.min(...prices) };
  });
}

export async function getProduct(db, idOrSlug, { forUpdate = false } = {}) {
  const byId = /^\d+$/.test(String(idOrSlug));
  const { rows } = await db.query(
    `SELECT * FROM products WHERE ${byId ? 'id' : 'slug'} = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [byId ? Number(idOrSlug) : idOrSlug],
  );
  if (!rows[0]) throw notFound('Product');
  return mapProduct(rows[0]);
}

const MAKING_TYPES = ['per_gram', 'percent', 'flat'];

/** Optional extra: admin can change making-charge / wastage rules. Applies to future price calculations. */
export async function updatePricingRules(db, id, { wastageBps, makingType, makingValue }) {
  if (!Number.isInteger(wastageBps) || wastageBps < 0 || wastageBps > 5000) throw new Error('wastageBps must be 0–5000');
  if (!MAKING_TYPES.includes(makingType)) throw new Error(`makingType must be one of ${MAKING_TYPES.join(', ')}`);
  if (!Number.isSafeInteger(makingValue) || makingValue < 0) throw new Error('makingValue must be a non-negative integer');
  const { rows } = await db.query(
    `UPDATE products SET wastage_bps = $2, making_type = $3, making_value = $4 WHERE id = $1 RETURNING *`,
    [id, wastageBps, makingType, makingValue],
  );
  if (!rows[0]) throw notFound('Product');
  return mapProduct(rows[0]);
}
