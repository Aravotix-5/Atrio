import { Router } from 'express';
import { many } from '../db/pool.js';
import { getPublicCatalog } from '../services/catalog.js';
import { priceSelection } from '../services/pricing.js';
import { getStatuses } from '../services/statuses.js';

export const publicRouter = Router();

/** The service catalog the public site and project builder read from. */
publicRouter.get('/services', async (_req, res, next) => {
  try {
    const categories = await getPublicCatalog();
    res.json({ categories });
  } catch (err) {
    next(err);
  }
});

/**
 * Re-prices a selection using database prices. The builder calls this so the
 * figure on screen always matches what the server would calculate.
 */
publicRouter.post('/estimate', async (req, res, next) => {
  try {
    const result = await priceSelection(req.body?.items || []);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/statuses', async (_req, res, next) => {
  try {
    res.json({ statuses: await getStatuses() });
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/settings', async (_req, res, next) => {
  try {
    const rows = await many(
      `SELECT key, value FROM site_settings
        WHERE key IN ('business_name','business_email','business_tagline','estimate_disclaimer')`
    );
    res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  } catch (err) {
    next(err);
  }
});
