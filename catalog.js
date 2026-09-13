import { many } from '../db/pool.js';

const SERVICE_FIELDS = `
  s.id, s.category_id, s.name, s.slug, s.description, s.details,
  s.price_cents, s.pricing_type, s.unit_label, s.max_quantity,
  s.active, s.sort_order, s.created_at, s.updated_at
`;

/** Active catalog grouped by category - what the public site and builder use. */
export async function getPublicCatalog() {
  const categories = await many(
    `SELECT id, name, slug, description, sort_order
       FROM service_categories
      WHERE active = true
      ORDER BY sort_order, name`
  );
  const services = await many(
    `SELECT ${SERVICE_FIELDS} FROM services s
      WHERE s.active = true
      ORDER BY s.sort_order, s.name`
  );
  return categories.map((category) => ({
    ...category,
    services: services.filter((s) => s.category_id === category.id),
  }));
}

export async function getAllServices() {
  return many(
    `SELECT ${SERVICE_FIELDS}, c.name AS category_name, c.slug AS category_slug
       FROM services s
       JOIN service_categories c ON c.id = s.category_id
      ORDER BY c.sort_order, s.sort_order, s.name`
  );
}

export async function getAllCategories() {
  return many('SELECT * FROM service_categories ORDER BY sort_order, name');
}

export async function getServicesByIds(ids) {
  if (!ids.length) return [];
  return many(`SELECT ${SERVICE_FIELDS} FROM services s WHERE s.id = ANY($1::bigint[])`, [ids]);
}
