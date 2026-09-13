import { api, ApiError } from './api.js';
import {
  el, clear, money, showLoading, showError, showEmpty,
  applyFieldErrors, setFormNotice, busy, toast, checkIcon,
} from './ui.js';
import { selection } from './store.js';

const state = { services: new Map(), categories: [] };

async function init() {
  const host = document.querySelector('[data-catalog]');
  showLoading(host, 5);

  try {
    const { categories } = await api.get('/api/services');
    state.categories = categories.filter((c) => c.services.length > 0);
    for (const category of state.categories) {
      for (const service of category.services) state.services.set(service.id, service);
    }
  } catch {
    showError(host, 'We could not load the services. Check your connection and try again.', init);
    return;
  }

  if (state.categories.length === 0) {
    showEmpty(host, 'No services are available yet', 'The catalog is being set up. Check back shortly.');
    return;
  }

  dropMissingSelections();
  renderCatalog(host);
  renderSummary();
  wireForm();
  prefillContact();
}

/** A service may have been retired since the draft was saved. */
function dropMissingSelections() {
  for (const { service_id: id } of selection.items()) {
    if (!state.services.has(id)) selection.remove(id);
  }
}

function renderCatalog(host) {
  clear(host);
  host.removeAttribute('aria-busy');
  state.categories.forEach((category, index) => {
    const body = el('div', { class: 'cat__body', id: `cat-${category.slug}` },
      category.services.map(optionRow));
    const open = index === 0;
    body.hidden = !open;

    const head = el('button', {
      type: 'button', class: 'cat__head', 'aria-expanded': String(open), 'aria-controls': body.id,
      onclick: () => {
        const isOpen = head.getAttribute('aria-expanded') === 'true';
        head.setAttribute('aria-expanded', String(!isOpen));
        body.hidden = isOpen;
      },
    }, [
      el('span', {}, [
        el('span', { class: 'cat__title', text: category.name }), ' ',
        el('span', { class: 'cat__count', text: `${category.services.length}` }),
      ]),
      chevron(),
    ]);

    host.append(el('section', { class: 'cat' }, [head, body]));
  });
}

function optionRow(service) {
  const selected = selection.has(service.id);

  const priceText = service.pricing_type === 'starting'
    ? `from ${money(service.price_cents)}`
    : money(service.price_cents);

  const qtyWrap = el('div', { class: 'qty', hidden: !(selected && service.pricing_type === 'quantity') });
  const output = el('output', { text: String(selection.quantity(service.id) || 1) });

  const setQty = (next) => {
    const clamped = Math.min(Math.max(next, 1), service.max_quantity);
    output.textContent = String(clamped);
    selection.set(service.id, clamped);
    renderSummary();
  };

  qtyWrap.append(
    el('button', {
      type: 'button', 'aria-label': `Fewer ${service.name}`,
      onclick: (e) => { e.stopPropagation(); setQty(Number(output.textContent) - 1); },
    }, ['\u2212']),
    output,
    el('button', {
      type: 'button', 'aria-label': `More ${service.name}`,
      onclick: (e) => { e.stopPropagation(); setQty(Number(output.textContent) + 1); },
    }, ['+']),
    el('span', { class: 'summary__qty', text: service.unit_label || '' })
  );

  const button = el('button', {
    type: 'button', class: 'option', 'aria-pressed': String(selected),
    'data-service-id': service.id,
    onclick: () => {
      const on = selection.toggle(service.id, service.pricing_type === 'quantity' ? Number(output.textContent) : 1);
      button.setAttribute('aria-pressed', String(on));
      qtyWrap.hidden = !(on && service.pricing_type === 'quantity');
      renderSummary();
    },
  }, [
    el('span', { class: 'option__box', 'aria-hidden': 'true' }, [checkIcon()]),
    el('span', { class: 'option__body' }, [
      el('span', { class: 'option__name', text: service.name }),
      el('p', { class: 'option__desc', text: service.description }),
      service.details ? el('p', { class: 'option__detail', text: service.details }) : false,
    ]),
    el('span', { class: 'option__price price' }, [
      priceText,
      el('span', { class: 'option__unit', text: service.unit_label || (service.pricing_type === 'starting' ? 'starting price' : '') }),
    ]),
  ]);

  return el('div', { 'data-service-row': service.id }, [button, qtyWrap]);
}

function chevron() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('class', 'cat__chev');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M5 8l5 5 5-5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

/** Local total for instant feedback; the server recalculates on submit. */
function currentTotal() {
  return selection.items().reduce((sum, item) => {
    const service = state.services.get(item.service_id);
    return service ? sum + service.price_cents * item.quantity : sum;
  }, 0);
}

function renderSummary() {
  const host = document.querySelector('[data-summary]');
  const totalNode = document.querySelector('[data-total]');
  const continueBtn = document.querySelector('[data-continue]');
  const dock = document.querySelector('[data-dock]');
  const items = selection.items();

  clear(host);
  if (items.length === 0) {
    host.append(el('p', { class: 'card__meta', text: 'Nothing selected yet. Choose the pieces you need.' }));
  } else {
    const list = el('ul', { class: 'summary__list' });
    for (const item of items) {
      const service = state.services.get(item.service_id);
      if (!service) continue;
      list.append(el('li', { class: 'summary__row' }, [
        el('span', {}, [
          el('span', { class: 'summary__name', text: service.name }),
          item.quantity > 1 ? el('span', { class: 'summary__qty', text: `× ${item.quantity}` }) : false,
          el('br'),
          el('button', {
            type: 'button', class: 'summary__remove', text: 'Remove',
            'aria-label': `Remove ${service.name}`,
            onclick: () => { selection.remove(service.id); refreshOptionStates(); renderSummary(); },
          }),
        ]),
        el('span', { class: 'summary__amount price', text: money(service.price_cents * item.quantity) }),
      ]));
    }
    host.append(list);
  }

  const total = currentTotal();
  totalNode.textContent = money(total);
  continueBtn.disabled = items.length === 0;
  document.querySelector('[data-dock-total]').textContent = money(total);
  document.querySelector('[data-dock-count]').textContent =
    `${items.length} ${items.length === 1 ? 'item' : 'items'} selected`;
  dock.hidden = items.length === 0;

  renderFormSummary();
}

function refreshOptionStates() {
  document.querySelectorAll('[data-service-row]').forEach((row) => {
    const id = Number(row.dataset.serviceRow);
    const service = state.services.get(id);
    const on = selection.has(id);
    row.querySelector('.option')?.setAttribute('aria-pressed', String(on));
    const qty = row.querySelector('.qty');
    if (qty) qty.hidden = !(on && service?.pricing_type === 'quantity');
  });
}

function renderFormSummary() {
  const host = document.querySelector('[data-form-summary]');
  if (!host) return;
  clear(host);
  const items = selection.items();
  if (items.length === 0) {
    host.append(el('p', { class: 'card__meta', text: 'Nothing selected.' }));
    return;
  }
  const list = el('ul', { class: 'summary__list' });
  for (const item of items) {
    const service = state.services.get(item.service_id);
    if (!service) continue;
    list.append(el('li', { class: 'summary__row' }, [
      el('span', { text: item.quantity > 1 ? `${service.name} × ${item.quantity}` : service.name }),
      el('span', { class: 'summary__amount price', text: money(service.price_cents * item.quantity) }),
    ]));
  }
  host.append(list, el('p', { class: 'summary__total' }, [
    el('span', { text: 'Estimate' }),
    el('span', { class: 'price', text: money(currentTotal()) }),
  ]));
}

function openRequest() {
  const section = document.querySelector('[data-request-section]');
  section.hidden = false;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  section.querySelector('#contact_name')?.focus({ preventScroll: true });
}

async function prefillContact() {
  try {
    const { user } = await api.get('/api/auth/me');
    if (!user) return;
    const form = document.querySelector('[data-request-form]');
    form.elements.contact_name.value = user.name;
    form.elements.contact_email.value = user.email;
  } catch { /* guests fill it in themselves */ }
}

function wireForm() {
  document.querySelector('[data-continue]').addEventListener('click', openRequest);
  document.querySelector('[data-dock-continue]').addEventListener('click', openRequest);

  const form = document.querySelector('[data-request-form]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    setFormNotice(form, '');

    const items = selection.items();
    if (items.length === 0) {
      setFormNotice(form, 'Choose at least one service before sending the request.');
      return;
    }

    const payload = {
      contact_name: form.elements.contact_name.value,
      contact_email: form.elements.contact_email.value,
      title: form.elements.title.value,
      description: form.elements.description.value,
      timeline: form.elements.timeline.value,
      budget_range: form.elements.budget_range.value,
      reference_url: form.elements.reference_url.value,
      items, // ids and quantities only - the server sets every price
    };

    busy(submit, true, 'Sending...');
    try {
      const result = await api.post('/api/project-requests', payload);
      selection.clear();
      showDone(result);
    } catch (err) {
      busy(submit, false);
      if (err instanceof ApiError && Object.keys(err.fields).length > 0) {
        applyFieldErrors(form, err.fields);
        setFormNotice(form, err.message);
      } else {
        setFormNotice(form, err.message);
      }
      toast('Your request was not sent.', 'error');
    }
  });
}

function showDone(result) {
  const form = document.querySelector('[data-request-form]');
  const done = document.querySelector('[data-request-done]');
  form.hidden = true;
  done.hidden = false;
  clear(done);
  done.append(el('div', { class: 'notice notice--success', role: 'status' }, [
    el('h2', { class: 'h-md', text: 'Your project request was sent' }),
    el('p', { text: `Request #${result.request.id}. Atrio will review it and come back with a written quote.` }),
  ]));
  done.append(el('div', { class: 'stack' }, [
    result.linked_to_account
      ? el('p', { text: 'You can follow its progress in your account.' })
      : el('p', { text: 'Create an account with the same email address to see the quote and pay online when it arrives.' }),
    el('div', { class: 'btn-row' }, [
      result.linked_to_account
        ? el('a', { class: 'btn btn--primary', href: '/account', text: 'Go to your account' })
        : el('a', { class: 'btn btn--primary', href: '/signup', text: 'Create your account' }),
      el('a', { class: 'btn btn--quiet', href: '/build', text: 'Start another project' }),
    ]),
  ]));
  window.scrollTo({ top: done.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
  document.querySelector('[data-dock]').hidden = true;
}

init();
