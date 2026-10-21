# Live-Rate Jewellery Configurator, Cart & Checkout

A small jewellery store where every price is calculated live from the current gold / silver / platinum rate, held for 10 minutes, and re-checked when the hold runs out. Stock is tiny (often a single piece), so checkout is built to be safe when two people buy the last unit at the same moment.

**Stack:** React 18 (Vite) · Node 22 + Express · PostgreSQL 16 · Docker Compose

| Document | What's in it |
|---|---|
| [Business Requirements (BRD)](docs/BRD.md) | Objectives, scope, pricing and business rules, functional requirements, acceptance criteria |
| [Technical Documentation](docs/DOCUMENTATION.md) | Architecture, flow diagrams, cart state machine, data model, full API reference, error codes |
| [Handover](docs/HANDOVER.md) | How to run, test and demo it, configuration, troubleshooting (incl. Windows/WSL), maintenance |

---

## Run it

```bash
docker compose up --build
```

Open **http://localhost:3000**. The database is created, migrated and seeded on first start.

Run the tests (uses a separate `jewellery_test` database in the same Postgres container):

```bash
docker compose run --rm --build test
```

Handy switches for a demo (all optional):

| Variable | Default | Effect |
|---|---|---|
| `PRICE_LOCK_SECONDS` | *(10 min)* | Shorten the lock, e.g. `PRICE_LOCK_SECONDS=30 docker compose up --build`, to watch expiry happen |
| `RATE_TICKER` | `on` | `off` freezes metal rates |
| `RATE_TICK_MS` | `60000` | How often the simulated rate moves |
| `ADMIN_TOKEN` | `admin` | Token for the `/admin` page |

The fastest way to see every cart state: open `/admin` in a second tab, set a short lock, add items, then push the gold rate up or down before the lock ends.

<details>
<summary>Running without Docker</summary>

Needs Node 22+ and a local PostgreSQL.

```bash
createdb jewellery && createdb jewellery_test
npm run install:all
DATABASE_URL=postgres://postgres@localhost:5432/jewellery npm run dev:server   # API on :3000
npm run dev:client                                                             # UI on :5173 (proxies /api)
TEST_DATABASE_URL=postgres://postgres@localhost:5432/jewellery_test npm run test:local
```
</details>

---

## How the price is calculated

All arithmetic happens in one dependency-free module, [`shared/pricing.js`](shared/pricing.js), which the **server and the browser both import**. The product page uses it to update the breakdown instantly as the customer changes purity or size; the server runs the same code to decide what to charge, and never trusts a price sent by the browser.

```
purity rate   = 999 rate × fineness / 999          e.g. 22K → × 916/999
metal         = purity rate × weight
wastage       = metal × wastage %
making        = ₹/gram × weight  |  % of metal  |  flat amount     (set per product)
stones        = Σ stone price × count
subtotal      = metal + wastage + making + stones
GST           = subtotal × 3%
total         = subtotal + GST
```

### Rounding approach

- **No floating point anywhere.** Money is integer **paise**, weight is integer **milligrams**, percentages are integer **basis points**, purity is **fineness** (parts per thousand). Intermediate products use `BigInt`.
- **Each line is rounded once, to the nearest paisa, half-up** — the purity rate per gram, metal, wastage, making and GST.
- **Later lines are computed from already-rounded earlier lines**, and subtotal/total are plain sums. So the breakdown on screen always adds up exactly to the total, to the paisa. (Rounding only the final total would give a "correct" total whose lines don't add up, which customers notice.)
- The purity rate per gram is rounded before multiplying by weight, matching how jewellers display "today's 22K rate".

The tests check this against values worked out by hand (the workings are in the comments of [`server/test/pricing.test.js`](server/test/pricing.test.js)), including a case where the half-up rule decides the answer (₹2,344.875 → ₹2,344.88).

---

## Price lock

| Moment | What happens |
|---|---|
| Customer opens a product | Server takes a **price lock**: a snapshot of the live rate *and* the product's pricing rules, valid 10 minutes. The page shows a countdown. |
| Customer changes purity / size | Price recalculated instantly in the browser against the locked rate. |
| Add to cart / Buy now | Server re-prices from the lock. If the lock has expired → `PRICE_EXPIRED`; if the browser's number disagrees → `PRICE_MISMATCH`. Never charged. |
| Item added to cart | It keeps that exact price and gets **its own fresh 10-minute lock**. |
| A lock runs out | The page re-checks against the live rate and says whether the price went **down** (applied automatically, old price struck through), **stayed the same**, went **up** (customer must press *Accept*; old price struck through next to the new one), or the piece is **out of stock**. |

On the cart, a price increase does not replace the agreed price until accepted. The pending higher price has its own 10-minute hold; if it lapses it is re-quoted, and an *Accept* only succeeds if it names the exact price the customer was shown (`PRICE_CHANGED_AGAIN` otherwise).

## Safe checkout

Checkout runs in one transaction ([`server/src/services/cart.js`](server/src/services/cart.js), [`orders.js`](server/src/services/orders.js)):

1. `SELECT … FOR UPDATE` on the cart's rows, so a double-clicked checkout can't run twice.
2. Refuse (409) if any item has an expired lock, an unaccepted increase or is out of stock. The response carries the refreshed cart so the page can show why.
3. Refuse if the total differs from what the browser displayed.
4. Take stock with a single conditional statement per product, in id order:
   ```sql
   UPDATE products SET stock = stock - $qty WHERE id = $id AND stock >= $qty
   ```
   If two buyers race for the last unit, Postgres makes the second `UPDATE` wait for the first's row lock, then re-evaluates `stock >= 1` against the committed row. It matches nothing, so that transaction is rolled back and the customer is told it sold out. A `CHECK (stock >= 0)` constraint is a backstop.
5. Write the order at the locked prices and empty the cart.

Buy now goes through the same `commitOrder` function.

## Tests

`29 tests, 4 files`, run against a real Postgres (no mocks for the parts that matter):

- **`pricing.test.js`** — hand-calculated cases for gold / silver / platinum, all three making-charge types, stones, half-up rounding, and an exhaustive "lines add up to the total" check over every seeded configuration.
- **`price-lock.test.js`** — valid at 9:59, refused at 10:00; locked price holds while the live rate moves and while an admin changes making charges; expired Buy-now and Add-to-cart are refused and take no stock.
- **`concurrent-checkout.test.js`** — two carts check out the last necklace simultaneously: exactly one order, stock 0, loser's cart marked out of stock. Repeated for 20 rounds; also 15 parallel Buy-nows for 3 units (exactly 3 succeed), cart-vs-Buy-now, and a double-clicked checkout.
- **`cart-price-change.test.js`** — over HTTP: price drop auto-applied, unchanged, increase blocks checkout until accepted, accepting a stale price is refused, pending increase re-quoted, out-of-stock blocks checkout, expired-lock checkout refused, summary counts.

Lock expiry is tested by moving an injectable application clock, not by sleeping.

## Sample data

| Piece | Metal | Notes |
|---|---|---|
| Aarna Solitaire Ring | Gold 22K / 18K, 3 sizes | **Has stones** (diamond + 2 rubies), per-gram making, 3 in stock |
| Meher Temple Necklace | Gold 22K, 2 lengths | **Single unit in stock**, making as % of metal |
| Kaya Silver Anklet | Silver 925 / 999 | Flat making charge |
| Ira Platinum Band | Pt 950, 3 sizes | Single unit |

## Optional extras (done)

- **Live rates.** Rates random-walk every minute (±0.4%) and are pushed to every open page over Server-Sent Events. The header ticker flashes on change; the product page shows the live rate next to the locked one, and catalogue "from" prices refresh. Locked prices are never touched by a tick.
- **Admin** at `/admin`: set metal rates and change wastage / making-charge rules per product. New rules apply to new locks and to cart items when they are re-priced; a lock already taken keeps the rules it was taken with.

## Assumptions

- Rates are quoted for **999 fineness**; other purities scale by fineness/999.
- **Wastage** is a % of the metal value. **GST is 3% on the whole subtotal**, as the brief says (in reality Indian jewellery GST is 3% on goods and 5% on separately-invoiced making charges).
- **Stock is per design**, not per purity/size combination: one physical piece can be finished to the chosen spec.
- The product-page lock and the cart lock are separate: adding to cart starts a fresh 10 minutes at the price the customer was looking at, as long as the product-page lock was still valid.
- A **price drop** found at checkout time is still shown before charging (the customer must see the new total), but needs no acceptance.
- If the price goes up and later falls back to or below the agreed price before the customer accepts, the item returns to confirmed automatically.
- Carts are anonymous (a UUID in `localStorage`); no accounts or payment gateway. "Order placed" stands in for payment.
- Quantity is fixed at 1 on the product page (pieces are mostly unique); the API supports any quantity.

## With more time

- **Reserve stock** when an item is added to cart (with a TTL) instead of only at checkout, and show "someone else is looking at this".
- **Idempotency keys** on checkout / Buy now so a network retry can never create a second order.
- A real **payment step**, with stock held during the payment window and released on failure.
- Persist **rate source and audit trail** (which rate snapshot every order used) and fetch real rates from a feed.
- Separate GST rates for metal vs. making, HUID / hallmark fields, stone certificates.
- Browser tests (Playwright) for the countdown and inline messages; accessibility pass with a screen reader.
- Auth for admin and customer accounts; cart merge on login.
- Push cart re-pricing to the client over the same SSE channel rather than per-item timers.

## Layout

```
shared/pricing.js         pricing engine used by server and client
server/src/
  app.js                  routes
  services/locks.js       price locks (view → lock → quote)
  services/cart.js        cart re-pricing state machine, accept, checkout
  services/orders.js      commitOrder (the only place stock is taken), Buy now
  services/rates.js       rates + live ticker + SSE events
  schema.sql, seed.js
server/test/              node:test suites
client/src/pages/         Catalog, Product, Cart, Order, Admin
```
