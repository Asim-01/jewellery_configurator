// Sample data. Seeded only when the products table is empty, so restarts keep orders/stock.

export const SEED_RATES = {
  gold: 1_245_000, // ₹12,450.00 / g (999)
  silver: 15_200, //  ₹152.00 / g (999)
  platinum: 495_000, // ₹4,950.00 / g (999)
};

export const SEED_PRODUCTS = [
  {
    slug: 'aarna-solitaire-ring',
    name: 'Aarna Solitaire Ring',
    category: 'ring',
    description: 'A single brilliant-cut diamond held in a six-prong crown, flanked by two rubies.',
    metal: 'gold',
    purities: [
      { code: '22K', label: '22K (916)', fineness: 916 },
      { code: '18K', label: '18K (750)', fineness: 750 },
    ],
    sizes: [
      { code: '10', label: 'Size 10', weightMg: 3850 },
      { code: '12', label: 'Size 12', weightMg: 4200 },
      { code: '14', label: 'Size 14', weightMg: 4550 },
    ],
    wastageBps: 1000, // 10%
    makingType: 'per_gram',
    makingValue: 65_000, // ₹650 / g
    stones: [
      { name: 'Diamond 0.25 ct (VS-GH)', count: 1, pricePaise: 3_850_000 },
      { name: 'Ruby 2 mm', count: 2, pricePaise: 45_000 },
    ],
    stock: 3,
  },
  {
    slug: 'meher-temple-necklace',
    name: 'Meher Temple Necklace',
    category: 'necklace',
    description: 'Hand-finished temple work with a Lakshmi pendant. One piece only.',
    metal: 'gold',
    purities: [{ code: '22K', label: '22K (916)', fineness: 916 }],
    sizes: [
      { code: '16', label: '16 inch', weightMg: 32400 },
      { code: '18', label: '18 inch', weightMg: 36200 },
    ],
    wastageBps: 1200, // 12%
    makingType: 'percent',
    makingValue: 1400, // 14% of metal value
    stones: [],
    stock: 1, // the single-unit piece
  },
  {
    slug: 'kaya-anklet',
    name: 'Kaya Silver Anklet',
    category: 'anklet',
    description: 'Fine-link anklet with tiny ghungroo bells. Sold as a single anklet.',
    metal: 'silver',
    purities: [
      { code: '925', label: 'Sterling (925)', fineness: 925 },
      { code: '999', label: 'Fine silver (999)', fineness: 999 },
    ],
    sizes: [
      { code: 'S', label: '9.5 inch', weightMg: 22000 },
      { code: 'M', label: '10.5 inch', weightMg: 24500 },
    ],
    wastageBps: 500, // 5%
    makingType: 'flat',
    makingValue: 85_000, // ₹850 per piece
    stones: [],
    stock: 2,
  },
  {
    slug: 'ira-platinum-band',
    name: 'Ira Platinum Band',
    category: 'ring',
    description: 'A comfort-fit 950 platinum band with a brushed centre line.',
    metal: 'platinum',
    purities: [{ code: '950', label: 'Pt 950', fineness: 950 }],
    sizes: [
      { code: '14', label: 'Size 14', weightMg: 5200 },
      { code: '16', label: 'Size 16', weightMg: 5600 },
      { code: '18', label: 'Size 18', weightMg: 6000 },
    ],
    wastageBps: 600,
    makingType: 'per_gram',
    makingValue: 90_000,
    stones: [],
    stock: 1,
  },
];

export async function seedIfEmpty(pool) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM products');
  if (rows[0].n > 0) return false;
  await seed(pool);
  return true;
}

export async function seed(pool, products = SEED_PRODUCTS, rates = SEED_RATES) {
  for (const [metal, rate] of Object.entries(rates)) {
    await pool.query('INSERT INTO metal_rates (metal, rate_paise_per_gram) VALUES ($1, $2)', [metal, rate]);
  }
  for (const p of products) {
    await pool.query(
      `INSERT INTO products (slug, name, description, category, metal, purities, sizes,
                             wastage_bps, making_type, making_value, stones, stock)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        p.slug,
        p.name,
        p.description,
        p.category,
        p.metal,
        JSON.stringify(p.purities),
        JSON.stringify(p.sizes),
        p.wastageBps,
        p.makingType,
        p.makingValue,
        JSON.stringify(p.stones),
        p.stock,
      ],
    );
  }
}
