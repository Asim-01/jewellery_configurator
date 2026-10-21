// Price calculation, checked against values worked out by hand (shown in comments).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePrice, priceProduct, purityRatePerGram, roundDiv } from '../../shared/pricing.js';
import { SEED_PRODUCTS } from '../src/seed.js';

test('rounding is half-up to the nearest paisa', () => {
  assert.equal(roundDiv(4, 10), 0n); // 0.4 -> 0
  assert.equal(roundDiv(5, 10), 1n); // 0.5 -> 1
  assert.equal(roundDiv(15, 10), 2n); // 1.5 -> 2
  assert.equal(roundDiv(24, 10), 2n); // 2.4 -> 2
  assert.equal(roundDiv(0, 7), 0n);
});

test('purity rate scales the 999 base rate by fineness / 999', () => {
  // ₹7,992.00 × 916/999 = ₹7,328.00 (exact); × 750/999 = ₹6,000.00 (exact)
  assert.equal(purityRatePerGram(799_200, 916), 732_800);
  assert.equal(purityRatePerGram(799_200, 750), 600_000);
  // ₹4,950.00 × 950/999 = ₹4,707.2072… -> ₹4,707.21
  assert.equal(purityRatePerGram(495_000, 950), 470_721);
});

test('22K gold, per-gram making, no stones', () => {
  /*
   * 24K rate ₹7,992.00/g -> 22K rate = 7,992 × 916/999      = ₹7,328.00/g
   * Metal    7,328.00 × 10.500 g                             = ₹76,944.00
   * Wastage  8% of 76,944.00                                 = ₹6,155.52
   * Making   ₹450/g × 10.500 g                               = ₹4,725.00
   * Stones                                                   = ₹0.00
   * Subtotal 76,944.00 + 6,155.52 + 4,725.00                 = ₹87,824.52
   * GST 3%   2,634.7356                                      -> ₹2,634.74
   * Total                                                    = ₹90,459.26
   */
  const p = calculatePrice({
    baseRatePaise999: 799_200,
    fineness: 916,
    weightMg: 10_500,
    wastageBps: 800,
    making: { type: 'per_gram', value: 45_000 },
  });
  assert.deepEqual(p, {
    purityRatePaise: 732_800,
    metalPaise: 7_694_400,
    wastagePaise: 615_552,
    makingPaise: 472_500,
    stonesPaise: 0,
    subtotalPaise: 8_782_452,
    gstPaise: 263_474,
    totalPaise: 9_045_926,
  });
});

test('sterling silver, percentage making, with stones (half-up rounding on the metal line)', () => {
  /*
   * 999 rate ₹99.90/g -> 925 rate = 99.90 × 925/999          = ₹92.50/g
   * Metal    92.50 × 25.350 g = 2,344.875                    -> ₹2,344.88
   * Wastage  5% of 2,344.88 = 117.244                        -> ₹117.24
   * Making   12% of 2,344.88 = 281.3856                      -> ₹281.39
   * Stones   2 × ₹350.00                                     = ₹700.00
   * Subtotal                                                 = ₹3,443.51
   * GST 3%   103.3053                                        -> ₹103.31
   * Total                                                    = ₹3,546.82
   */
  const p = calculatePrice({
    baseRatePaise999: 9_990,
    fineness: 925,
    weightMg: 25_350,
    wastageBps: 500,
    making: { type: 'percent', value: 1200 },
    stones: [{ name: 'Garnet', count: 2, pricePaise: 35_000 }],
  });
  assert.equal(p.purityRatePaise, 9_250);
  assert.equal(p.metalPaise, 234_488);
  assert.equal(p.wastagePaise, 11_724);
  assert.equal(p.makingPaise, 28_139);
  assert.equal(p.stonesPaise, 70_000);
  assert.equal(p.subtotalPaise, 344_351);
  assert.equal(p.gstPaise, 10_331);
  assert.equal(p.totalPaise, 354_682);
});

test('platinum, flat making', () => {
  /*
   * Pt 950 rate = 4,950 × 950/999 = 4,707.2072               -> ₹4,707.21/g
   * Metal    4,707.21 × 5.600 g = 26,360.376                 -> ₹26,360.38
   * Wastage  6% = 1,581.6228                                 -> ₹1,581.62
   * Making   flat                                            = ₹1,500.00
   * Subtotal                                                 = ₹29,442.00
   * GST 3%                                                   = ₹883.26
   * Total                                                    = ₹30,325.26
   */
  const p = calculatePrice({
    baseRatePaise999: 495_000,
    fineness: 950,
    weightMg: 5_600,
    wastageBps: 600,
    making: { type: 'flat', value: 150_000 },
  });
  assert.equal(p.metalPaise, 2_636_038);
  assert.equal(p.wastagePaise, 158_162);
  assert.equal(p.subtotalPaise, 2_944_200);
  assert.equal(p.gstPaise, 88_326);
  assert.equal(p.totalPaise, 3_032_526);
});

test('seeded product with stones: Aarna Solitaire Ring, 22K, size 12 at ₹12,450/g', () => {
  /*
   * 22K rate = 12,450 × 916/999 = 11,415.6156                 -> ₹11,415.62/g
   * Metal    11,415.62 × 4.200 g = 47,945.604                 -> ₹47,945.60
   * Wastage  10%                                              = ₹4,794.56
   * Making   ₹650/g × 4.2 g                                   = ₹2,730.00
   * Stones   diamond ₹38,500 + 2 × ruby ₹450                  = ₹39,400.00
   * Subtotal                                                  = ₹94,870.16
   * GST 3%   2,846.1048                                       -> ₹2,846.10
   * Total                                                     = ₹97,716.26
   */
  const ring = SEED_PRODUCTS.find((p) => p.slug === 'aarna-solitaire-ring');
  const p = priceProduct(ring, { purityCode: '22K', sizeCode: '12' }, 1_245_000);
  assert.equal(p.purityRatePaise, 1_141_562);
  assert.equal(p.metalPaise, 4_794_560);
  assert.equal(p.wastagePaise, 479_456);
  assert.equal(p.makingPaise, 273_000);
  assert.equal(p.stonesPaise, 3_940_000);
  assert.equal(p.gstPaise, 284_610);
  assert.equal(p.totalPaise, 9_771_626);
});

test('breakdown lines always add up to the total', () => {
  for (const product of SEED_PRODUCTS) {
    for (const purity of product.purities) {
      for (const size of product.sizes) {
        for (const rate of [1, 9_999, 15_237, 1_245_003, 99_999_999]) {
          const p = priceProduct(product, { purityCode: purity.code, sizeCode: size.code }, rate);
          assert.equal(p.metalPaise + p.wastagePaise + p.makingPaise + p.stonesPaise, p.subtotalPaise);
          assert.equal(p.subtotalPaise + p.gstPaise, p.totalPaise);
          for (const v of [p.metalPaise, p.wastagePaise, p.makingPaise, p.gstPaise, p.totalPaise]) {
            assert.ok(Number.isInteger(v));
          }
        }
      }
    }
  }
});

test('rejects unknown configuration and bad inputs', () => {
  const ring = SEED_PRODUCTS[0];
  assert.throws(() => priceProduct(ring, { purityCode: '14K', sizeCode: '12' }, 100), /Unknown purity/);
  assert.throws(() => priceProduct(ring, { purityCode: '22K', sizeCode: '99' }, 100), /Unknown size/);
  assert.throws(() => calculatePrice({ baseRatePaise999: 1.5, fineness: 916, weightMg: 1, wastageBps: 0, making: { type: 'flat', value: 0 } }));
});
