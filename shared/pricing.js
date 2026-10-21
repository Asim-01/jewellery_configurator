// Shared, dependency-free pricing engine.
// Used by the server (source of truth) AND the client (instant breakdown on the
// product page). Because both run the same code with the same locked rate, the
// number the customer sees is the number the server charges.
//
// Units — everything is an integer, never a float:
//   money   -> paise (1 rupee = 100 paise)
//   weight  -> milligrams
//   percent -> basis points (1% = 100 bps)
//   purity  -> fineness in parts per 1000 (22K = 916, sterling = 925)
//
// Rounding: each line of the breakdown is rounded to the nearest paisa,
// half-up, exactly once. Later lines are calculated from the already-rounded
// earlier lines, so the breakdown always adds up to the total on screen.

export const GST_BPS = 300; // 3%
export const LOCK_MINUTES = 10;
export const LOCK_MS = LOCK_MINUTES * 60 * 1000;

/** Integer division rounded half-up. Works for non-negative BigInts. */
export function roundDiv(numerator, denominator) {
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  if (n < 0n || d <= 0n) throw new Error('roundDiv expects non-negative numerator and positive denominator');
  return (n * 2n + d) / (2n * d);
}

const toNum = (big) => {
  const n = Number(big);
  if (!Number.isSafeInteger(n)) throw new Error('Amount exceeds safe integer range');
  return n;
};

/**
 * Price of metal of a given fineness, per gram, in paise.
 * Base rates are quoted for 999 (24K / fine) metal, so 22K = base × 916 / 999.
 */
export function purityRatePerGram(baseRatePaise999, fineness) {
  return toNum(roundDiv(BigInt(baseRatePaise999) * BigInt(fineness), 999n));
}

/**
 * Core calculation. All inputs are integers in the units described above.
 * @returns {{ purityRatePaise, metalPaise, wastagePaise, makingPaise, stonesPaise,
 *             subtotalPaise, gstPaise, totalPaise, lines }}
 */
export function calculatePrice({
  baseRatePaise999,
  fineness,
  weightMg,
  wastageBps,
  making, // { type: 'per_gram' | 'percent' | 'flat', value }  (paise/g | bps | paise)
  stones = [], // [{ name, count, pricePaise }]
}) {
  for (const [k, v] of Object.entries({ baseRatePaise999, fineness, weightMg, wastageBps })) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`${k} must be a non-negative integer`);
  }
  const weight = BigInt(weightMg);

  const purityRatePaise = purityRatePerGram(baseRatePaise999, fineness);
  // value of metal = rate per gram × grams = rate × mg / 1000
  const metalPaise = toNum(roundDiv(BigInt(purityRatePaise) * weight, 1000n));
  // wastage is charged as a % of the metal (equivalently, extra grams of metal)
  const wastagePaise = toNum(roundDiv(BigInt(metalPaise) * BigInt(wastageBps), 10000n));

  let makingPaise;
  switch (making?.type) {
    case 'per_gram':
      makingPaise = toNum(roundDiv(BigInt(making.value) * weight, 1000n));
      break;
    case 'percent':
      makingPaise = toNum(roundDiv(BigInt(metalPaise) * BigInt(making.value), 10000n));
      break;
    case 'flat':
      makingPaise = making.value;
      break;
    default:
      throw new Error(`Unknown making charge type: ${making?.type}`);
  }

  const stonesPaise = stones.reduce((sum, s) => sum + s.pricePaise * s.count, 0);
  const subtotalPaise = metalPaise + wastagePaise + makingPaise + stonesPaise;
  const gstPaise = toNum(roundDiv(BigInt(subtotalPaise) * BigInt(GST_BPS), 10000n));
  const totalPaise = subtotalPaise + gstPaise;

  return {
    purityRatePaise,
    metalPaise,
    wastagePaise,
    makingPaise,
    stonesPaise,
    subtotalPaise,
    gstPaise,
    totalPaise,
  };
}

/**
 * Price a product configuration. `product` is the API shape:
 *   { metal, purities:[{code,label,fineness}], sizes:[{code,label,weightMg}],
 *     wastageBps, makingType, makingValue, stones:[...] }
 */
export function priceProduct(product, { purityCode, sizeCode }, baseRatePaise999) {
  const purity = product.purities.find((p) => p.code === purityCode);
  const size = product.sizes.find((s) => s.code === sizeCode);
  if (!purity) throw new Error(`Unknown purity "${purityCode}" for ${product.slug ?? product.id}`);
  if (!size) throw new Error(`Unknown size "${sizeCode}" for ${product.slug ?? product.id}`);
  const result = calculatePrice({
    baseRatePaise999,
    fineness: purity.fineness,
    weightMg: size.weightMg,
    wastageBps: product.wastageBps,
    making: { type: product.makingType, value: product.makingValue },
    stones: product.stones ?? [],
  });
  return {
    ...result,
    baseRatePaise999,
    fineness: purity.fineness,
    purityLabel: purity.label,
    sizeLabel: size.label,
    weightMg: size.weightMg,
    wastageBps: product.wastageBps,
    makingType: product.makingType,
    makingValue: product.makingValue,
    stones: product.stones ?? [],
  };
}

export function formatINR(paise) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(
    paise / 100,
  );
}

export function formatGrams(mg) {
  return `${(mg / 1000).toFixed(3)} g`;
}

export function formatBps(bps) {
  return `${(bps / 100).toString()}%`;
}
