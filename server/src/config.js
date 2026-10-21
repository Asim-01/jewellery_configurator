import { LOCK_MS } from '../../shared/pricing.js';

// 10 minutes per the brief. PRICE_LOCK_SECONDS lets a reviewer shorten it to watch expiry happen.
export const lockMs = process.env.PRICE_LOCK_SECONDS ? Number(process.env.PRICE_LOCK_SECONDS) * 1000 : LOCK_MS;
