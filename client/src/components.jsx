import { formatBps, formatGrams, formatINR } from '@shared/pricing.js';
import { formatClock, useCountdown } from './hooks.js';

const METAL_TONES = {
  gold: ['#f3d68a', '#c99a3b', '#8a6421'],
  silver: ['#f2f3f5', '#b9bec7', '#7d838d'],
  platinum: ['#eef0f2', '#c7ccd2', '#8f969e'],
};

/** Simple illustrated piece — no external images needed. */
export function JewelArt({ category, metal, size = 160, hasStones = false }) {
  const [hi, mid, lo] = METAL_TONES[metal] ?? METAL_TONES.gold;
  const id = `g-${metal}-${category}`;
  return (
    <svg viewBox="0 0 160 160" width={size} height={size} role="img" aria-label={`${metal} ${category}`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={hi} />
          <stop offset=".55" stopColor={mid} />
          <stop offset="1" stopColor={lo} />
        </linearGradient>
      </defs>
      {category === 'ring' && (
        <>
          <ellipse cx="80" cy="96" rx="44" ry="40" fill="none" stroke={`url(#${id})`} strokeWidth="11" />
          {hasStones ? (
            <>
              <path d="M66 52 L80 34 L94 52 L80 64 Z" fill="#e9f3ff" stroke="#9fb5cc" strokeWidth="1.5" />
              <circle cx="60" cy="58" r="5" fill="#b3263a" />
              <circle cx="100" cy="58" r="5" fill="#b3263a" />
            </>
          ) : (
            <ellipse cx="80" cy="96" rx="44" ry="40" fill="none" stroke={lo} strokeOpacity=".35" strokeWidth="1.5" />
          )}
        </>
      )}
      {category === 'necklace' && (
        <>
          <path d="M28 30 Q80 130 132 30" fill="none" stroke={`url(#${id})`} strokeWidth="6" />
          {[0.2, 0.35, 0.5, 0.65, 0.8].map((t) => {
            const x = (1 - t) ** 2 * 28 + 2 * (1 - t) * t * 80 + t * t * 132;
            const y = (1 - t) ** 2 * 30 + 2 * (1 - t) * t * 130 + t * t * 30;
            return <circle key={t} cx={x} cy={y + 4} r="6" fill={`url(#${id})`} />;
          })}
          <path d="M80 82 L96 104 L80 132 L64 104 Z" fill={`url(#${id})`} stroke={lo} strokeWidth="1.5" />
        </>
      )}
      {category === 'anklet' && (
        <>
          <ellipse cx="80" cy="80" rx="54" ry="30" fill="none" stroke={`url(#${id})`} strokeWidth="5" strokeDasharray="6 4" />
          {[40, 60, 80, 100, 120].map((x) => (
            <circle key={x} cx={x} cy={x === 80 ? 116 : x === 60 || x === 100 ? 112 : 104} r="5" fill={`url(#${id})`} />
          ))}
        </>
      )}
    </svg>
  );
}

export const Money = ({ paise, className }) => <span className={className}>{formatINR(paise)}</span>;

const makingLabel = (b) =>
  b.makingType === 'per_gram'
    ? `${formatINR(b.makingValue)}/g × ${formatGrams(b.weightMg)}`
    : b.makingType === 'percent'
      ? `${formatBps(b.makingValue)} of metal`
      : 'flat';

export function PriceBreakdown({ b, metal }) {
  return (
    <dl className="breakdown">
      <div>
        <dt>
          Metal <small>{b.purityLabel} · {formatGrams(b.weightMg)} @ {formatINR(b.purityRatePaise)}/g</small>
        </dt>
        <dd>{formatINR(b.metalPaise)}</dd>
      </div>
      <div>
        <dt>
          Wastage <small>{formatBps(b.wastageBps)} of metal</small>
        </dt>
        <dd>{formatINR(b.wastagePaise)}</dd>
      </div>
      <div>
        <dt>
          Making charges <small>{makingLabel(b)}</small>
        </dt>
        <dd>{formatINR(b.makingPaise)}</dd>
      </div>
      {b.stones?.length > 0 && (
        <div>
          <dt>
            Stones{' '}
            <small>{b.stones.map((s) => `${s.count} × ${s.name}`).join(', ')}</small>
          </dt>
          <dd>{formatINR(b.stonesPaise)}</dd>
        </div>
      )}
      <div className="sub">
        <dt>Subtotal</dt>
        <dd>{formatINR(b.subtotalPaise)}</dd>
      </div>
      <div>
        <dt>GST <small>3%</small></dt>
        <dd>{formatINR(b.gstPaise)}</dd>
      </div>
      <div className="grand">
        <dt>Total</dt>
        <dd>{formatINR(b.totalPaise)}</dd>
      </div>
      <p className="rate-note">
        Based on {metal.charAt(0).toUpperCase() + metal.slice(1)} 999 at {formatINR(b.baseRatePaise999)}/g
      </p>
    </dl>
  );
}

export function LockTimer({ deadline, onExpire, label = 'Price locked for', total = 600_000 }) {
  const remaining = useCountdown(deadline, onExpire);
  const urgent = remaining < 60_000;
  const pct = Math.min(100, (remaining / total) * 100);
  return (
    <div className={`lock ${urgent ? 'urgent' : ''} ${remaining === 0 ? 'expired' : ''}`} role="timer" aria-live="off">
      <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
        <rect x="4" y="9" width="12" height="9" rx="2" fill="currentColor" />
        <path d="M7 9V6.5a3 3 0 0 1 6 0V9" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
      <span>{remaining === 0 ? 'Lock expired — re-checking price…' : `${label} ${formatClock(remaining)}`}</span>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}
