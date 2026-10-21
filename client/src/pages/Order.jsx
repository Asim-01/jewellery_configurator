import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatINR } from '@shared/pricing.js';
import { api } from '../api.js';

export default function Order() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.order(id).then(setOrder).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="page-msg">{error}</p>;
  if (!order) return <p className="page-msg">Loading…</p>;

  return (
    <div className="order">
      <p className="eyebrow">Order #{order.id} confirmed</p>
      <h1>Thank you — it’s yours.</h1>
      <ul>
        {order.items.map((i, idx) => (
          <li key={idx}>
            <span>
              {i.name} <small>{i.breakdown.purityLabel} · {i.breakdown.sizeLabel} · Qty {i.qty}</small>
            </span>
            <b>{formatINR(i.unitPricePaise * i.qty)}</b>
          </li>
        ))}
        <li className="grand">
          <span>Charged</span>
          <b>{formatINR(order.totalPaise)}</b>
        </li>
      </ul>
      <Link to="/" className="btn">Continue shopping</Link>
    </div>
  );
}
