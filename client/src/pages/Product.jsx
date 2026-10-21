import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatINR, priceProduct } from '@shared/pricing.js';
import { api, getCartId, toLocalDeadline } from '../api.js';
import { JewelArt, LockTimer, PriceBreakdown } from '../components.jsx';
import { useCartBadge } from '../hooks.js';

export default function Product({ liveRates }) {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { setCart } = useCartBadge();

  const [session, setSession] = useState(null); // { lock, product, deadline, total }
  const [cfg, setCfg] = useState(null); // { purityCode, sizeCode }
  const [notice, setNotice] = useState(null); // { kind, text, from?, to? }
  const [needsAccept, setNeedsAccept] = useState(false);
  const [busy, setBusy] = useState(null); // 'cart' | 'buy' | 'lock'
  const [loadError, setLoadError] = useState(null);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const priceFor = (s, c) => (s && c ? priceProduct(s.product, c, s.lock.ratePaise) : null);
  const breakdown = useMemo(() => priceFor(session, cfg), [session, cfg]);

  /** Take a fresh price lock. If we had one before, explain how the price moved. */
  const relock = useCallback(
    async (reason) => {
      setBusy('lock');
      try {
        const res = await api.lock(slug);
        const deadline = toLocalDeadline(res.lock.expiresAt, res.serverTime);
        const next = {
          ...res,
          deadline,
          total: Date.parse(res.lock.expiresAt) - Date.parse(res.lock.createdAt),
        };
        const c = cfgRef.current ?? { purityCode: res.product.purities[0].code, sizeCode: res.product.sizes[0].code };
        const prev = sessionRef.current;
        if (prev && reason) {
          const before = priceFor(prev, c).totalPaise;
          const after = priceFor(next, c).totalPaise;
          if (res.product.stock === 0) {
            setNotice({ kind: 'bad', text: 'This piece has just sold out.' });
          } else if (after > before) {
            setNeedsAccept(true);
            setNotice({ kind: 'warn', text: 'The metal rate has gone up. Please accept the new price to continue.', from: before, to: after });
          } else if (after < before) {
            setNeedsAccept(false);
            setNotice({ kind: 'good', text: 'Good news — the price has dropped. The lower price has been applied.', from: before, to: after });
          } else {
            setNotice({ kind: 'info', text: 'Price re-checked — it hasn’t changed. Locked for another 10 minutes.' });
          }
        }
        setSession(next);
        if (!cfgRef.current) setCfg(c);
        setLoadError(null);
      } catch (err) {
        setLoadError(err.message);
      } finally {
        setBusy(null);
      }
    },
    [slug],
  );

  useEffect(() => {
    setSession(null);
    setCfg(null);
    setNotice(null);
    setNeedsAccept(false);
    relock(null);
  }, [slug, relock]);

  if (loadError && !session) return <p className="page-msg">Could not load this piece: {loadError}</p>;
  if (!session || !breakdown) return <p className="page-msg">Loading…</p>;

  const { product, lock } = session;
  const soldOut = product.stock === 0;
  const blocked = soldOut || needsAccept || busy != null;

  const payload = () => ({
    lockId: lock.id,
    productId: product.id,
    ...cfg,
    qty: 1,
    expectedUnitPricePaise: breakdown.totalPaise,
  });

  const handleConflict = (err) => {
    if (err.code === 'OUT_OF_STOCK') {
      setSession((s) => ({ ...s, product: { ...s.product, stock: 0 } }));
      setNotice({ kind: 'bad', text: err.message });
    } else if (err.code === 'PRICE_EXPIRED' || err.code === 'PRICE_MISMATCH') {
      relock('expired');
    } else {
      setNotice({ kind: 'bad', text: err.message });
    }
  };

  const addToCart = async () => {
    setBusy('cart');
    try {
      const cart = await api.addToCart(getCartId(), payload());
      setCart(cart);
      setNotice({ kind: 'good', text: 'Added to your cart at this price.', link: true });
    } catch (err) {
      handleConflict(err);
    } finally {
      setBusy(null);
    }
  };

  const buyNow = async () => {
    setBusy('buy');
    try {
      const order = await api.buyNow(payload());
      navigate(`/orders/${order.id}`);
    } catch (err) {
      handleConflict(err);
      setBusy(null);
    }
  };

  // Changing the configuration makes the old "was" price meaningless, so drop it.
  const choose = (patch) => {
    setCfg((c) => ({ ...c, ...patch }));
    setNotice((n) => n && { ...n, from: null });
  };

  const liveRate = liveRates[product.metal];
  const rateDelta = liveRate ? liveRate - lock.ratePaise : 0;

  return (
    <div className="product">
      <Link to="/" className="back">← All pieces</Link>
      <div className="product-grid">
        <section className="gallery">
          <div className={`art-frame metal-${product.metal}`}>
            <JewelArt category={product.category} metal={product.metal} size={280} hasStones={product.stones.length > 0} />
          </div>
          <p className="desc">{product.description}</p>
        </section>

        <section className="config">
          <p className="eyebrow">{product.metal} · {product.category}</p>
          <h1>{product.name}</h1>
          <p className={`stock ${product.stock <= 1 ? 'low' : ''}`}>
            {soldOut ? 'Sold out' : product.stock === 1 ? 'Only 1 piece left' : `${product.stock} pieces in stock`}
          </p>

          <div className="price-head">
            {notice?.from != null && <s className="was">{formatINR(notice.from)}</s>}
            <span className="price">{formatINR(breakdown.totalPaise)}</span>
            <span className="incl">incl. 3% GST</span>
          </div>
          {!soldOut && <LockTimer deadline={session.deadline} total={session.total} onExpire={() => relock('expired')} />}
          {liveRate && rateDelta !== 0 && (
            <p className="live-hint">
              Live {product.metal} rate is now {formatINR(liveRate)}/g ({rateDelta > 0 ? '▲' : '▼'} vs your locked{' '}
              {formatINR(lock.ratePaise)}). Your price holds until the lock ends.
            </p>
          )}

          {notice && (
            <div className={`notice ${notice.kind}`} role="status">
              <span>{notice.text}</span>
              {notice.link && <Link to="/cart">View cart →</Link>}
              {needsAccept && notice.kind === 'warn' && (
                <button
                  className="btn small"
                  onClick={() => {
                    setNeedsAccept(false);
                    setNotice({ kind: 'info', text: 'New price accepted.' });
                  }}
                >
                  Accept new price
                </button>
              )}
            </div>
          )}

          <fieldset className="choice">
            <legend>Purity</legend>
            {product.purities.map((p) => (
              <button
                key={p.code}
                className={cfg.purityCode === p.code ? 'on' : ''}
                aria-pressed={cfg.purityCode === p.code}
                onClick={() => choose({ purityCode: p.code })}
              >
                {p.label}
              </button>
            ))}
          </fieldset>
          <fieldset className="choice">
            <legend>{product.category === 'ring' ? 'Ring size' : 'Length'} &amp; weight</legend>
            {product.sizes.map((s) => (
              <button
                key={s.code}
                className={cfg.sizeCode === s.code ? 'on' : ''}
                aria-pressed={cfg.sizeCode === s.code}
                onClick={() => choose({ sizeCode: s.code })}
              >
                {s.label}
                <small>{(s.weightMg / 1000).toFixed(2)} g</small>
              </button>
            ))}
          </fieldset>

          <div className="actions">
            <button className="btn ghost" disabled={blocked} onClick={addToCart}>
              {busy === 'cart' ? 'Adding…' : 'Add to cart'}
            </button>
            <button className="btn" disabled={blocked} onClick={buyNow}>
              {busy === 'buy' ? 'Placing order…' : soldOut ? 'Sold out' : 'Buy now'}
            </button>
          </div>

          <details className="bd-wrap" open>
            <summary>Price breakdown</summary>
            <PriceBreakdown b={breakdown} metal={product.metal} />
          </details>
        </section>
      </div>
    </div>
  );
}
