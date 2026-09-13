import { getServicesByIds } from './catalog.js';
import { badRequest } from '../utils/errors.js';

/**
 * Turns a browser-supplied selection into priced line items.
 *
 * Prices ALWAYS come from the database. Anything the browser sends about
 * price is ignored, so editing JavaScript in devtools cannot change a total.
 *
 * @param {Array<{service_id:number, quantity:number}>} selection
 */
export async function priceSelection(selection) {
  if (!Array.isArray(selection) || selection.length === 0) {
    throw badRequest('Choose at least one service before submitting.');
  }
  if (selection.length > 100) {
    throw badRequest('That is more items than a single request can hold.');
  }

  const wanted = new Map();
  for (const entry of selection) {
    const serviceId = Number.parseInt(entry?.service_id, 10);
    if (!Number.isInteger(serviceId) || serviceId <= 0) continue;
    const quantity = Number.parseInt(entry?.quantity, 10);
    wanted.set(serviceId, Number.isInteger(quantity) && quantity > 0 ? quantity : 1);
  }
  if (wanted.size === 0) throw badRequest('Choose at least one service before submitting.');

  const services = await getServicesByIds([...wanted.keys()]);
  const active = services.filter((s) => s.active);
  if (active.length === 0) {
    throw badRequest('Those services are no longer available. Refresh the builder and try again.');
  }

  const items = active.map((service) => {
    const requested = wanted.get(service.id) ?? 1;
    const quantity = service.pricing_type === 'quantity'
      ? Math.min(Math.max(requested, 1), service.max_quantity)
      : 1;
    return {
      service_id: service.id,
      name_snapshot: service.name,
      pricing_type: service.pricing_type,
      quantity,
      unit_price_cents: service.price_cents,
      line_total_cents: service.price_cents * quantity,
    };
  });

  const total = items.reduce((sum, item) => sum + item.line_total_cents, 0);
  const dropped = [...wanted.keys()].filter((id) => !active.some((s) => s.id === id));
  const hasStartingPrice = items.some((item) => item.pricing_type === 'starting');

  return { items, total_cents: total, dropped_service_ids: dropped, has_starting_price: hasStartingPrice };
}
