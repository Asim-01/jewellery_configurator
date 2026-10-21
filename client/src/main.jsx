import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
import { formatINR } from '@shared/pricing.js';
import { api, getCartId } from './api.js';
import { CartContext, useLiveRates } from './hooks.js';
import Admin from './pages/Admin.jsx';
import Cart from './pages/Cart.jsx';
import Catalog from './pages/Catalog.jsx';
import Order from './pages/Order.jsx';
import Product from './pages/Product.jsx';
import './styles.css';

function RateTicker({ rates, lastChange }) {
  const flash = lastChange && Date.now() - lastChange.at < 4000 ? lastChange : null;
  return (
    <div className="ticker" aria-label="Live metal rates per gram (999)">
      <span className="live-dot" aria-hidden="true" /> Live rates / g
      {['gold', 'silver', 'platinum'].map((m) =>
        rates[m] ? (
          <span key={m} className={`rate ${flash?.metal === m ? (flash.to > flash.from ? 'up' : 'down') : ''}`}>
            <em>{m}</em> {formatINR(rates[m])}
          </span>
        ) : null,
      )}
    </div>
  );
}

function App() {
  const { rates, lastChange } = useLiveRates();
  const [cart, setCart] = useState(null);
  useEffect(() => {
    api.cart(getCartId()).then(setCart).catch(() => {});
  }, []);
  const ctx = useMemo(() => ({ count: cart?.summary?.itemCount ?? 0, setCart }), [cart]);

  return (
    <CartContext.Provider value={ctx}>
      <header className="top">
        <div className="top-inner">
          <Link to="/" className="brand">
            Sona <span>&amp;</span> Co.
          </Link>
          <nav>
            <NavLink to="/cart" className="cart-link">
              Cart{ctx.count > 0 && <b>{ctx.count}</b>}
            </NavLink>
          </nav>
        </div>
        <RateTicker rates={rates} lastChange={lastChange} />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Catalog liveRates={rates} />} />
          <Route path="/products/:slug" element={<Product liveRates={rates} />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/orders/:id" element={<Order />} />
          <Route path="/admin" element={<Admin liveRates={rates} />} />
        </Routes>
      </main>
      <footer>
        Prices include 3% GST · <Link to="/admin">Admin</Link>
      </footer>
    </CartContext.Provider>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
