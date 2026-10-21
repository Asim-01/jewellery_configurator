import { createContext, useContext, useEffect, useRef, useState } from 'react';

/** Milliseconds remaining until a local deadline, ticking every 250ms. Calls onExpire once. */
export function useCountdown(deadlineMs, onExpire) {
  const [remaining, setRemaining] = useState(() => (deadlineMs ? Math.max(0, deadlineMs - Date.now()) : 0));
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    if (!deadlineMs) return undefined;
    let fired = false;
    const tick = () => {
      const r = Math.max(0, deadlineMs - Date.now());
      setRemaining(r);
      if (r === 0 && !fired) {
        fired = true;
        expireRef.current?.();
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadlineMs]);

  return remaining;
}

export function formatClock(ms) {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Live metal rates via server-sent events. */
export function useLiveRates() {
  const [rates, setRates] = useState({});
  const [lastChange, setLastChange] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/rates')
      .then((r) => r.json())
      .then((r) => alive && setRates(Object.fromEntries(Object.entries(r).map(([m, v]) => [m, v.ratePaise]))))
      .catch(() => {});
    const es = new EventSource('/api/rates/stream');
    es.addEventListener('rate', (e) => {
      const ev = JSON.parse(e.data);
      setRates((prev) => {
        setLastChange({ metal: ev.metal, from: prev[ev.metal], to: ev.ratePaise, at: Date.now() });
        return { ...prev, [ev.metal]: ev.ratePaise };
      });
    });
    return () => {
      alive = false;
      es.close();
    };
  }, []);
  return { rates, lastChange };
}

export const CartContext = createContext({ count: 0, setCart: () => {} });
export const useCartBadge = () => useContext(CartContext);
