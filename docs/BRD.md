# Business Requirements Document (BRD)

**Project:** Live-Rate Jewellery Configurator, Cart & Checkout
**Version:** 1.0 · **Date:** 21 October 2026
**Type:** Full-stack take-home assignment (React · Node.js · PostgreSQL)

---

## 1. Purpose

Jewellery prices are not fixed. They move with the market rate of gold, silver and platinum, which can change every few minutes. This application lets a customer configure a piece of jewellery, see exactly how its price is built up, and buy it, while guaranteeing two things:

1. **The customer is never charged a different amount from the one they last saw.**
2. **A piece with limited stock can never be sold twice**, even if two customers try to buy the last unit at the same moment.

## 2. Background and problem

| Problem | Business impact |
|---|---|
| Metal rates move during a customer's visit | The price on screen may no longer match the cost, causing either loss to the business or a surprise charge to the customer |
| Customers don't trust opaque jewellery pricing | Abandoned purchases; complaints about hidden making charges or wastage |
| Stock is very limited (often 1–3 units per design) | Overselling leads to cancelled orders, refunds and reputational damage |

## 3. Objectives

| # | Objective | Measure of success |
|---|---|---|
| O1 | Price every piece correctly from the live rate | Calculations match hand-worked values to the paisa |
| O2 | Show a full, transparent price breakdown | Every component (metal, wastage, making, stones, GST) visible to the customer |
| O3 | Hold a quoted price for a fair, fixed window | Price held for exactly 10 minutes, with a visible countdown |
| O4 | Handle rate changes honestly | Customer told whether price went up, down, stayed the same, or the item sold out |
| O5 | Never oversell | Proven by automated test: two simultaneous buyers of the last unit → exactly one order |
| O6 | Never charge an unconfirmed price | Checkout blocked while any price change is unconfirmed or any item is out of stock |

## 4. Scope

### In scope
- Product listing, product page (configurator), cart page, order confirmation
- Live price calculation and breakdown
- 10-minute price lock on viewing a product and on adding to cart
- Re-pricing after lock expiry, with up / down / same / out-of-stock handling
- *Add to cart* and *Buy now*
- Concurrency-safe checkout
- Sample data (4 products), automated tests, one-command setup, documentation
- **Optional extras (delivered):** gold/silver/platinum rates changing every minute and pushed live to open pages; admin page to change rates and making-charge rules

### Out of scope
- Customer accounts / login, saved addresses
- Real payment gateway (placing the order stands in for payment)
- Shipping, invoicing, returns
- Real market-rate feed (rates are simulated)
- Admin authentication beyond a shared token

## 5. Stakeholders and users

| Role | Interest |
|---|---|
| **Customer** | Configure a piece, understand the price, buy with confidence |
| **Store owner / admin** | Correct pricing, no overselling, control over making-charge rules |
| **Assessor / reviewer** | Correct calculation, proven safe checkout, code quality, documentation |

## 6. Pricing rules (business definition)

A piece's price is built from these components, in this order:

| Component | Rule |
|---|---|
| **Metal rate** | Market rate per gram for pure (999) metal |
| **Purity rate** | Metal rate × fineness ÷ 999 (e.g. 22K = 916, 18K = 750, sterling silver = 925, Pt 950) |
| **Metal value** | Purity rate × weight of the piece |
| **Wastage** | A percentage of metal value, set per product |
| **Making charges** | Set per product, one of: ₹ per gram · % of metal value · flat amount |
| **Stones** | Sum of (stone price × count) |
| **Subtotal** | Metal + wastage + making + stones |
| **GST** | 3% of subtotal |
| **Total** | Subtotal + GST |

**Rounding:** each line is rounded to the nearest paisa (half-up) once; the subtotal and total are sums of the rounded lines, so the breakdown always adds up exactly to the total shown.

## 7. Functional requirements

### 7.1 Product page

| ID | Requirement | Priority |
|---|---|---|
| FR-1 | Customer can choose **purity** (where the product offers more than one) | Must |
| FR-2 | Customer can choose **size / weight** | Must |
| FR-3 | Price breakdown updates **instantly** on every change | Must |
| FR-4 | A **10-minute price lock** starts when the product is viewed, with a visible countdown | Must |
| FR-5 | When the lock expires, the price is re-calculated at the live rate and the customer is told if it went up, down, stayed the same, or sold out | Must |
| FR-6 | If the price went **up**, the customer must explicitly accept it before adding to cart or buying; the old price is shown struck through | Must |
| FR-7 | If the price went **down**, the new price applies automatically with a note | Must |
| FR-8 | **Add to cart** adds the item at the price shown | Must |
| FR-9 | **Buy now** places an order immediately and handles: success, expired price, out of stock | Must |
| FR-10 | Stock level shown ("Only 1 piece left", "Sold out") | Should |

### 7.2 Cart page

| ID | Requirement | Priority |
|---|---|---|
| FR-11 | Each item shows the **price it was added at** | Must |
| FR-12 | Each item has **its own countdown** | Must |
| FR-13 | Price-change messages appear **inline on the affected item** | Must |
| FR-14 | Price drop: applied automatically, note shown, old price struck through | Must |
| FR-15 | Price rise: old price struck through next to new; **Accept** button; item not checkout-ready until accepted | Must |
| FR-16 | Out of stock: item flagged; customer asked to remove it | Must |
| FR-17 | Total makes clear **how many items still need price confirmation** | Must |
| FR-18 | **Checkout button disabled** until every item is confirmed and in stock | Must |

### 7.3 Checkout

| ID | Requirement | Priority |
|---|---|---|
| FR-19 | An order can **never** be placed while any item has an unconfirmed price change or is out of stock | Must |
| FR-20 | The customer is charged **exactly** the total last shown | Must |
| FR-21 | If two customers try to buy the last unit at the same time, **exactly one succeeds** | Must |
| FR-22 | The unsuccessful customer is told the item has sold out | Must |

### 7.4 Optional extras

| ID | Requirement | Status |
|---|---|---|
| FR-23 | Metal rate changes automatically every minute | Delivered |
| FR-24 | Rate changes are pushed live to open product and cart pages | Delivered |
| FR-25 | Admin can change making-charge and wastage rules | Delivered |

## 8. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | **Correctness:** no floating-point money arithmetic; all amounts held as whole paise |
| NFR-2 | **Integrity:** stock can never go negative (enforced in code and by a database constraint) |
| NFR-3 | **Responsiveness:** pages usable on phone (≈390px), tablet and desktop |
| NFR-4 | **Setup:** runs with a single command |
| NFR-5 | **Testability:** automated tests for price calculation, lock expiry, simultaneous orders, cart price changes |
| NFR-6 | **Trust:** server always recalculates prices; it never accepts a price sent by the browser |
| NFR-7 | **Accessibility:** clear status messages, keyboard-usable controls, reduced-motion respected |

## 9. Business rules

| ID | Rule |
|---|---|
| BR-1 | A price lock lasts **10 minutes**. |
| BR-2 | Viewing a product starts a lock. Adding to cart starts a **fresh** 10-minute lock at the price the customer was looking at. |
| BR-3 | A lock captures both the metal rate and the product's pricing rules, so an admin change cannot alter a price that is already locked. |
| BR-4 | Price decreases are applied automatically; price increases require explicit acceptance. |
| BR-5 | An accepted price is only valid if it is exactly the price the customer was shown. |
| BR-6 | Stock is reserved only when an order is placed, not when an item is added to cart. |
| BR-7 | Stock is per design: one physical piece can be finished to the chosen purity and size. |
| BR-8 | GST is a flat 3% of the subtotal (as specified in the brief). |

## 10. Assumptions and constraints

- Rates are quoted per gram for 999-fine metal.
- Wastage is a percentage of metal value.
- In reality, Indian jewellery GST is 3% on goods and 5% on separately invoiced making charges; the brief specifies a flat 3%, which is what is implemented.
- Carts are anonymous (identified by a random ID stored in the browser).
- Quantity is 1 per add on the product page (pieces are mostly unique); the API supports larger quantities.
- Expected effort: 2–3 hours.

## 11. Acceptance criteria

| # | Criterion | How it is verified |
|---|---|---|
| AC-1 | Prices match hand-calculated values | `pricing.test.js` (hand workings in comments) |
| AC-2 | Lock valid at 9:59, expired at 10:00 | `price-lock.test.js` |
| AC-3 | Two simultaneous orders for last unit → one success | `concurrent-checkout.test.js` (also 20 repeated rounds, 15 parallel buyers) |
| AC-4 | Price drop auto-applied; rise needs accept; checkout blocked until confirmed | `cart-price-change.test.js` |
| AC-5 | Sample data has ≥3 products, one with stones, one with a single unit | Seed data: Aarna Solitaire Ring (stones), Meher Temple Necklace (1 unit) |
| AC-6 | Runs with one command | `docker compose up --build` |
| AC-7 | README covers assumptions, running, rounding, future work | `README.md` |

## 12. Sample data

| Product | Metal / purity | Making rule | Stones | Stock |
|---|---|---|---|---|
| Aarna Solitaire Ring | Gold 22K / 18K | ₹650 per gram | Diamond 0.25 ct + 2 rubies | 3 |
| Meher Temple Necklace | Gold 22K | 14% of metal | — | **1** |
| Kaya Silver Anklet | Silver 925 / 999 | ₹850 flat | — | 2 |
| Ira Platinum Band | Platinum 950 | ₹900 per gram | — | 1 |

## 13. Future enhancements

- Reserve stock when added to cart (with expiry)
- Idempotency keys so a network retry can never create a duplicate order
- Real payment gateway with stock held during payment
- Real market-rate feed and an audit trail of the rate used per order
- Separate GST rates for metal and making charges; hallmark (HUID) details
- Customer accounts and secured admin
