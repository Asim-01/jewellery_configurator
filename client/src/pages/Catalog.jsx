import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatINR } from '@shared/pricing.js';
import { api } from '../api.js';
import { JewelArt } from '../components.jsx';

export default function Catalog({ liveRates }) {
  const [products, setProducts] = useState(null);
  const [error, setError] = useState(null);

  // Re-fetch "from" prices whenever a live rate changes.
  const rateKey = JSON.stringify(liveRates);
  useEffect(() => {
    api.products().then(setProducts).catch((e) => setError(e.message));
  }, [rateKey]);

  if (error) return <p className="page-msg">{error}</p>;
  if (!products) return <p className="page-msg">Loading…</p>;

  return (
    <>
      <section className="hero">
        <p className="eyebrow">Priced live from today’s rates</p>
        <h1>Every rupee, accounted for.</h1>
        <p>
          Choose the purity and size, and see exactly what you pay for metal, wastage, making, stones and GST. Your
          price is held for 10 minutes.
        </p>
      </section>
      <ul className="catalog">
        {products.map((p) => (
          <li key={p.id}>
            <Link to={`/products/${p.slug}`} className="card">
              <div className={`art-frame metal-${p.metal}`}>
                <JewelArt category={p.category} metal={p.metal} size={150} hasStones={p.stones.length > 0} />
                {p.stock <= 1 && <span className="tag">{p.stock === 0 ? 'Sold out' : 'Last piece'}</span>}
              </div>
              <div className="card-body">
                <p className="eyebrow">
                  {p.metal}
                  {p.stones.length > 0 ? ' · with stones' : ''}
                </p>
                <h2>{p.name}</h2>
                <p className="from">from {formatINR(p.fromPricePaise)}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
