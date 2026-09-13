import { Router } from 'express';
import { many, one } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { id as validId } from '../utils/validate.js';
import { notFound } from '../utils/errors.js';

export const projectsRouter = Router();

projectsRouter.use(requireAuth);

projectsRouter.get('/', async (req, res, next) => {
  try {
    const projects = await many(
      `SELECT p.id, p.title, p.status, p.created_at, p.updated_at,
              q.id AS quote_id, q.total_cents,
              (SELECT status FROM payments WHERE quote_id = q.id ORDER BY created_at DESC LIMIT 1) AS payment_status
         FROM projects p
         JOIN quotes q ON q.id = p.quote_id
        WHERE p.user_id = $1
        ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json({ projects });
  } catch (err) {
    next(err);
  }
});

projectsRouter.get('/:id', async (req, res, next) => {
  try {
    const projectId = validId(req.params.id);
    const project = await one(
      `SELECT p.*, q.total_cents, q.currency
         FROM projects p JOIN quotes q ON q.id = p.quote_id
        WHERE p.id = $1 AND p.user_id = $2`,
      [projectId, req.user.id]
    );
    if (!project) throw notFound('We could not find that project on your account.');

    // Only notes marked as customer-visible are returned.
    project.notes = await many(
      `SELECT body, created_at FROM notes
        WHERE entity_type = 'project' AND entity_id = $1 AND internal = false
        ORDER BY created_at DESC`,
      [projectId]
    );
    res.json({ project });
  } catch (err) {
    next(err);
  }
});
