import { useEffect, useState } from 'react';
import { formatINR } from '@shared/pricing.js';
import { api } from '../api.js';

const toRupees = (paise) => (paise / 100).toFixed(2);
const toPaise = (rupees) => Math.round(Number(rupees) * 100);

export default function Admin({ liveRates }) {
  const [token, setToken] = useState(() => localStorage.getItem('adminToken') ?? 'admin');
  const [products, setProducts] = useState([]);
  const [rateInputs, setRateInputs] = useState({});
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api.products().then((ps) =>
      setProducts(
        ps.map((p) => ({
          ...p,
          form: {
            wastagePct: p.wastageBps / 100,
            makingType: p.makingType,
            makingInput: p.makingType === 'percent' ? p.makingValue / 100 : toRupees(p.makingValue),
          },
        })),
      ),
    );
  }, []);
  useEffect(() => localStorage.setItem('adminToken', token), [token]);

  const run = async (fn, ok) => {
    try {
      await fn();
      setMsg({ kind: 'good', text: ok });
    } catch (e) {
      setMsg({ kind: 'bad', text: e.message });
    }
  };

  const setForm = (id, patch) =>
    setProducts((ps) => ps.map((p) => (p.id === id ? { ...p, form: { ...p.form, ...patch } } : p)));

  return (
    <div className="admin">
      <h1>Admin</h1>
      <p className="muted">
        Demo controls. Changes apply to new price locks and to cart items when their lock expires — never to a
        price that is still locked.
      </p>
      <label className="field">
        Admin token <input value={token} onChange={(e) => setToken(e.target.value)} />
      </label>
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}

      <h2>Metal rates (₹ per gram, 999)</h2>
      <div className="admin-rates">
        {['gold', 'silver', 'platinum'].map((m) => (
          <form
            key={m}
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api.admin.setRate(token, m, toPaise(rateInputs[m])), `${m} rate updated`);
            }}
          >
            <span className="cap">{m}</span>
            <small>now {liveRates[m] ? formatINR(liveRates[m]) : '—'}</small>
            <input
              inputMode="decimal"
              placeholder={liveRates[m] ? toRupees(liveRates[m]) : ''}
              value={rateInputs[m] ?? ''}
              onChange={(e) => setRateInputs((r) => ({ ...r, [m]: e.target.value }))}
            />
            <button className="btn small" disabled={!rateInputs[m]}>Set</button>
          </form>
        ))}
      </div>

      <h2>Making-charge rules</h2>
      <div className="admin-rules">
        {products.map((p) => (
          <form
            key={p.id}
            onSubmit={(e) => {
              e.preventDefault();
              const f = p.form;
              run(
                () =>
                  api.admin.setRules(token, p.id, {
                    wastageBps: Math.round(Number(f.wastagePct) * 100),
                    makingType: f.makingType,
                    makingValue:
                      f.makingType === 'percent' ? Math.round(Number(f.makingInput) * 100) : toPaise(f.makingInput),
                  }),
                `${p.name} rules saved`,
              );
            }}
          >
            <b>{p.name}</b>
            <label>
              Wastage %
              <input inputMode="decimal" value={p.form.wastagePct} onChange={(e) => setForm(p.id, { wastagePct: e.target.value })} />
            </label>
            <label>
              Making
              <select value={p.form.makingType} onChange={(e) => setForm(p.id, { makingType: e.target.value })}>
                <option value="per_gram">₹ per gram</option>
                <option value="percent">% of metal</option>
                <option value="flat">₹ flat</option>
              </select>
            </label>
            <label>
              Value
              <input inputMode="decimal" value={p.form.makingInput} onChange={(e) => setForm(p.id, { makingInput: e.target.value })} />
            </label>
            <button className="btn small">Save</button>
          </form>
        ))}
      </div>
    </div>
  );
}
