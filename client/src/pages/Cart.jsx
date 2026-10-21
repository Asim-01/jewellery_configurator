import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatINR } from '@shared/pricing.js';
import { api, getCartId, toLocalDeadline } from '../api.js';
import { JewelArt, LockTimer, PriceBreakdown } from '../components.jsx';
import { useCartBadge } from '../hooks.js';

function ItemMessage({ item, onAccept, onRemove, busy }) {
  const old = item.previousPricePaise;
  switch (item.status === 'locked' ? item.change : item.status) {
    case 'decreased':
      return (
        <div className="notice good" role="status">
          <span>
            Price dropped from <s>{formatINR(old)}</s> to <b>{formatINR(item.unitPricePaise)}</b> — the lower price
            has been applied.
          </span>
        </div>
      );
    case 'unchanged':
      return (
        <div className="notice info" role="status">
          <span>Price re-checked against today’s rate — no change.</span>
        </div>
      );
    case 'accepted':
      return (
        <div className="notice info" role="status">
          <span>
            You accepted the new price (was <s>{formatINR(old)}</s>).
          </span>
        </div>
      );
    case 'price_increase':
      return (
        <div className="notice warn" role="alert">
          <span>
            The metal rate has gone up. New price <s>{formatINR(item.unitPricePaise)}</s>{' '}
            <b>{formatINR(item.pendingPricePaise)}</b>. Accept it to keep this item in your order.
          </span>
          <div className="notice-actions">
            <button className="btn small" disabled={busy} onClick={onAccept}>
              Accept {formatINR(item.pendingPricePaise)}
            </button>
            <button className="btn small ghost" disabled={busy} onClick={onRemove}>
              Remove
            </button>
          </div>
        </div>
      );
    case 'out_of_stock':
      return (
        <div className="notice bad" role="alert">
          <span>Sorry — this piece is now out of stock. Remove it to continue to checkout.</span>
          <div className="notice-actions">
            <button className="btn small ghost" disabled={busy} onClick={onRemove}>
              Remove
            </button>
          </div>
        </div>
      );
    default:
      return null;
  }
}

function CartItem({ item, serverTime, receivedAt, onChanged, onExpire }) {
  const [busy, setBusy] = useState(false);
  const cartId = getCartId();
  const run = async (fn) => {
    setBusy(true);
    try {
      onChanged(await fn());
    } catch (err) {
      if (err.body?.cart) onChanged(err.body.cart, err.message);
    } finally {
      setBusy(false);
    }
  };

  const pending = item.status === 'price_increase';
  const deadline = toLocalDeadline(pending ? item.pendingExpiresAt : item.lockExpiresAt, serverTime, receivedAt);
  const shown = pending ? item.pendingBreakdown : item.breakdown;

  return (
    <li className={`cart-item status-${item.status}`}>
      <Link to={`/products/${item.product.slug}`} className={`thumb metal-${item.product.metal}`}>
        <JewelArt category={item.product.category} metal={item.product.metal} size={88} hasStones={item.breakdown.stones?.length > 0} />
      </Link>
      <div className="ci-body">
        <div className="ci-top">
          <div>
            <Link to={`/products/${item.product.slug}`} className="ci-name">{item.product.name}</Link>
            <p className="ci-meta">
              {item.purityLabel} · {item.sizeLabel} · Qty {item.qty}
            </p>
            <p className="ci-added">Added at {formatINR(item.addedPricePaise)}</p>
          </div>
          <div className="ci-price">
            {item.previousPricePaise != null && item.previousPricePaise !== item.unitPricePaise && !pending && (
              <s>{formatINR(item.previousPricePaise)}</s>
            )}
            <b className={pending ? 'muted' : ''}>{formatINR(item.unitPricePaise * item.qty)}</b>
          </div>
        </div>

        {item.status !== 'out_of_stock' && (
          <LockTimer
            deadline={deadline}
            onExpire={onExpire}
            label={pending ? 'New price held for' : 'Price locked for'}
          />
        )}
        <ItemMessage
          item={item}
          busy={busy}
          onAccept={() => run(() => api.acceptPrice(cartId, item.id, item.pendingPricePaise))}
          onRemove={() => run(() => api.removeItem(cartId, item.id))}
        />
        <div className="ci-foot">
          <details>
            <summary>Price breakdown{pending ? ' (new price)' : ''}</summary>
            <PriceBreakdown b={shown} metal={item.product.metal} />
          </details>
          {item.status === 'locked' && (
            <button className="link-btn" disabled={busy} onClick={() => run(() => api.removeItem(cartId, item.id))}>
              Remove
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export default function Cart() {
  const navigate = useNavigate();
  const { setCart: setBadge } = useCartBadge();
  const [state, setState] = useState(null); // { cart, receivedAt }
  const [message, setMessage] = useState(null);
  const [placing, setPlacing] = useState(false);
  const refreshTimer = useRef(null);

  const apply = useCallback(
    (cart, msg = null) => {
      setState({ cart, receivedAt: Date.now() });
      setBadge(cart);
      setMessage(msg);
    },
    [setBadge],
  );

  const load = useCallback(async () => {
    try {
      const cart = await api.cart(getCartId());
      setState({ cart, receivedAt: Date.now() });
      setBadge(cart);
    } catch (err) {
      setMessage(err.message);
    }
  }, [setBadge]);

  useEffect(() => {
    load();
  }, [load]);

  // When any lock runs out, ask the server to re-price (debounced so simultaneous expiries cause one call).
  const onExpire = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(load, 400);
  }, [load]);
  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  if (!state) return <p className="page-msg">{message ?? 'Loading your cart…'}</p>;
  const { cart, receivedAt } = state;
  const { summary } = cart;

  const checkout = async () => {
    setPlacing(true);
    try {
      const order = await api.checkout(getCartId(), summary.totalPaise);
      setBadge(null);
      navigate(`/orders/${order.id}`);
    } catch (err) {
      if (err.body?.cart) apply(err.body.cart, err.message);
      else setMessage(err.message);
      setPlacing(false);
    }
  };

  if (cart.items.length === 0) {
    return (
      <div className="empty">
        <h1>Your cart is empty</h1>
        <p>Prices are calculated live from today’s metal rates.</p>
        <Link to="/" className="btn">Browse pieces</Link>
      </div>
    );
  }

  const blockers = [];
  if (summary.awaitingConfirmationCount)
    blockers.push(`${summary.awaitingConfirmationCount} item${summary.awaitingConfirmationCount > 1 ? 's need' : ' needs'} price confirmation`);
  if (summary.outOfStockCount)
    blockers.push(`${summary.outOfStockCount} item${summary.outOfStockCount > 1 ? 's are' : ' is'} out of stock`);

  return (
    <div className="cart-page">
      <h1>Your cart</h1>
      {message && <div className="notice bad page-notice">{message}</div>}
      <div className="cart-grid">
        <ul className="cart-list">
          {cart.items.map((item) => (
            <CartItem
              key={item.id}
              item={item}
              serverTime={cart.serverTime}
              receivedAt={receivedAt}
              onChanged={apply}
              onExpire={onExpire}
            />
          ))}
        </ul>

        <aside className="summary">
          <h2>Order summary</h2>
          <dl>
            <div>
              <dt>Confirmed items</dt>
              <dd>
                {summary.confirmedCount} of {cart.items.length}
              </dd>
            </div>
            {summary.awaitingConfirmationCount > 0 && (
              <div className="warn-row">
                <dt>Awaiting your confirmation</dt>
                <dd>{summary.awaitingConfirmationCount}</dd>
              </div>
            )}
            {summary.outOfStockCount > 0 && (
              <div className="bad-row">
                <dt>Out of stock</dt>
                <dd>{summary.outOfStockCount}</dd>
              </div>
            )}
            <div className="grand">
              <dt>
                Total <small>incl. GST{blockers.length ? ', confirmed items only' : ''}</small>
              </dt>
              <dd>{formatINR(summary.totalPaise)}</dd>
            </div>
            {summary.awaitingConfirmationCount > 0 && (
              <p className="if-accepted">
                {formatINR(summary.totalIfAcceptedPaise)} if you accept the new price
                {summary.awaitingConfirmationCount > 1 ? 's' : ''}
              </p>
            )}
          </dl>
          <button className="btn wide" disabled={!summary.canCheckout || placing} onClick={checkout}>
            {placing ? 'Placing order…' : `Checkout · ${formatINR(summary.totalPaise)}`}
          </button>
          {blockers.length > 0 && <p className="blockers">Checkout is paused: {blockers.join(' and ')}.</p>}
          <p className="fineprint">You will be charged exactly the total shown. Each price is held for 10 minutes.</p>
        </aside>
      </div>
    </div>
  );
}
