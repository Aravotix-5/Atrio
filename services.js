import { api } from './api.js';
import { el, clear, money, showLoading, showError, showEmpty } from './ui.js';

const PRICE_NOTE = {
  fixed: '',
  starting: 'starting price',
  quantity: 'per unit',
};

async function init() {
  const host = document.querySelector('[data-catalog]');
  showLoading(host, 4);

  let categories;
  try {
    ({ categories } = await api.get('/api/services'));
  } catch {
    showError(host, 'We could not load the services. Check your connection and try again.', init);
    return;
  }

  const withServices = categories.filter((c) => c.services.length > 0);
  if (withServices.length === 0) {
    showEmpty(host, 'No services are available yet', 'The catalog is being set up. Check back shortly.');
    return;
  }

  clear(host);
  host.removeAttribute('aria-busy');
  for (const category of withServices) {
    host.append(el('section', { class: 'stack mb-3' }, [
      el('h2', { text: category.name }),
      category.description ? el('p', { class: 'lede', text: category.description }) : false,
      el('div', { class: 'rows' }, category.services.map(serviceRow)),
    ]));
  }

  try {
    const { settings } = await api.get('/api/settings');
    const slot = document.querySelector('[data-disclaimer] p');
    if (slot && settings.estimate_disclaimer) slot.textContent = settings.estimate_disclaimer;
  } catch { /* the default wording stays */ }
}

function serviceRow(service) {
  const note = PRICE_NOTE[service.pricing_type];
  return el('article', { class: 'row' }, [
    el('div', { class: 'row__top' }, [
      el('h3', { class: 'row__title', text: service.name }),
      el('div', { class: 'option__price price' }, [
        service.pricing_type === 'starting' ? `from ${money(service.price_cents)}` : money(service.price_cents),
        el('span', { class: 'option__unit', text: service.unit_label || note || '' }),
      ]),
    ]),
    el('p', { class: 'row__meta', text: service.description }),
    service.details ? el('p', { class: 'option__detail', text: service.details }) : false,
  ]);
}

init();
