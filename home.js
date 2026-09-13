import { api } from './api.js';
import { el, clear, money, showError, checkIcon } from './ui.js';
import { selection } from './store.js';

const HERO_SLUGS = ['custom-website', 'mobile-optimization', 'database', 'user-accounts', 'stripe-integration'];

async function init() {
  const list = document.querySelector('[data-hero-list]');
  const totalNode = document.querySelector('[data-hero-total]');
  const grid = document.querySelector('[data-category-grid]');

  let categories;
  try {
    ({ categories } = await api.get('/api/services'));
  } catch (err) {
    if (list) showError(list, 'We could not load the service list. Refresh to try again.');
    if (grid) showError(grid, 'We could not load the service list. Refresh to try again.');
    return;
  }

  const all = categories.flatMap((category) => category.services);
  if (all.length === 0) {
    if (list) clear(list), list.append(el('li', {}, [el('p', { class: 'card__meta', text: 'No services are published yet.' })]));
    return;
  }

  renderHero(list, totalNode, pickHeroServices(all));
  renderCategories(grid, categories);
}

function pickHeroServices(all) {
  const bySlug = new Map(all.map((s) => [s.slug, s]));
  const picked = HERO_SLUGS.map((slug) => bySlug.get(slug)).filter(Boolean);
  return (picked.length >= 3 ? picked : all).slice(0, 4);
}

function renderHero(list, totalNode, services) {
  if (!list) return;
  clear(list);

  const update = () => {
    const total = services.reduce(
      (sum, service) => sum + (selection.has(service.id) ? service.price_cents * selection.quantity(service.id) : 0),
      0
    );
    totalNode.textContent = money(total);
  };

  for (const service of services) {
    const button = el('button', {
      type: 'button', class: 'option', 'aria-pressed': String(selection.has(service.id)),
      onclick: () => {
        const on = selection.toggle(service.id);
        button.setAttribute('aria-pressed', String(on));
        update();
      },
    }, [
      el('span', { class: 'option__box', 'aria-hidden': 'true' }, [checkIcon()]),
      el('span', { class: 'option__body' }, [
        el('span', { class: 'option__name', text: service.name }),
      ]),
      el('span', { class: 'option__price price' }, [
        service.pricing_type === 'starting' ? `from ${money(service.price_cents)}` : money(service.price_cents),
      ]),
    ]);
    list.append(el('li', {}, [button]));
  }
  update();
}

function renderCategories(grid, categories) {
  if (!grid) return;
  clear(grid);
  for (const category of categories) {
    const examples = category.services.slice(0, 3).map((s) => s.name).join(', ');
    grid.append(el('article', { class: 'card card--soft' }, [
      el('h3', { class: 'card__title', text: category.name }),
      el('p', { text: category.description || '' }),
      el('p', { class: 'card__meta', text: `${category.services.length} services${examples ? ` - ${examples}` : ''}` }),
    ]));
  }
}

init();
