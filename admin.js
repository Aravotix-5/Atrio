import { api } from './api.js';
import {
  el, clear, money, date, showLoading, showError, showEmpty,
  statusBadge, toast, busy,
} from './ui.js';

const dialog = document.querySelector('[data-dialog]');
const dBody = () => dialog.querySelector('[data-dialog-body]');
const dFoot = () => dialog.querySelector('[data-dialog-foot]');
const labels = {};
const statusesByDomain = { request: [], quote: [], project: [] };
let categories = [];

const panel = (name) => document.querySelector(`[data-panel="${name}"]`);
const loaders = {
  requests: loadRequests, quotes: loadQuotes, projects: loadProjects,
  payments: loadPayments, services: loadServices, customers: loadCustomers,
  settings: loadSettings,
};

async function init() {
  const { user } = await api.get('/api/auth/me');
  if (!user) { window.location.href = `/login?next=${encodeURIComponent('/admin')}`; return; }
  if (!['admin', 'staff'].includes(user.role)) {
    document.querySelector('main .wrap.page-head').after(el('div', { class: 'wrap' }, [
      el('div', { class: 'notice notice--error', role: 'alert' }, [
        el('p', { text: 'This area is for Atrio staff. Your account does not have access.' }),
      ]),
    ]));
    document.querySelector('.tabs').hidden = true;
    return;
  }
  document.querySelector('[data-admin-greeting]').textContent = `Signed in as ${user.email}`;

  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  wireTabs();
  await loadStatuses();
  loadOverview();
  loadRequests();
}

async function loadStatuses() {
  try {
    const { statuses } = await api.get('/api/admin/statuses');
    for (const status of statuses) {
      labels[status.key] = status.label;
      statusesByDomain[status.domain]?.push(status);
    }
  } catch { /* fall back to raw keys */ }
}

function wireTabs() {
  const tabs = [...document.querySelectorAll('[data-tab]')];
  tabs.forEach((tab) => tab.addEventListener('click', () => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      panel(t.dataset.tab).hidden = !on;
    });
    loaders[tab.dataset.tab]();
  }));
}

async function loadOverview() {
  const host = document.querySelector('[data-overview]');
  showLoading(host, 3);
  try {
    const { overview } = await api.get('/api/admin/overview');
    clear(host);
    host.removeAttribute('aria-busy');
    const stats = [
      ['Open requests', overview.open_requests],
      ['Quotes awaiting a reply', overview.quotes_awaiting],
      ['Active projects', overview.active_projects],
      ['Customers', overview.customers],
      ['Active services', overview.active_services],
      ['Paid to date', money(overview.paid_cents)],
    ];
    for (const [label, value] of stats) {
      host.append(el('div', { class: 'card' }, [
        el('p', { class: 'card__meta', text: label }),
        el('p', { class: 'stat price', text: String(value) }),
      ]));
    }
  } catch (err) {
    showError(host, err.message, loadOverview);
  }
}

/* ------------------------------------------------------------------ requests */

async function loadRequests() {
  const host = panel('requests');
  showLoading(host);
  try {
    const { requests } = await api.get('/api/admin/requests');
    if (!requests.length) {
      showEmpty(host, 'No project requests yet', 'Requests submitted from the builder land here.');
      return;
    }
    clear(host);
    host.removeAttribute('aria-busy');
    host.append(el('div', { class: 'rows' }, requests.map((request) => el('article', { class: 'row' }, [
      el('div', { class: 'row__top' }, [
        el('h3', { class: 'row__title', text: request.title }),
        statusBadge(request.status, labels),
      ]),
      el('p', { class: 'row__meta', text: `${request.contact_name} - ${request.contact_email}${request.user_id ? '' : ' (guest)'}` }),
      el('dl', { class: 'row__facts' }, [
        el('div', {}, [el('dt', { text: 'Estimate' }), el('dd', { class: 'price', text: money(request.estimate_total_cents) })]),
        el('div', {}, [el('dt', { text: 'Sent' }), el('dd', { text: date(request.created_at) })]),
        el('div', {}, [el('dt', { text: 'Quotes' }), el('dd', { text: String(request.quote_count) })]),
      ]),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn btn--quiet btn--small', type: 'button', text: 'Open', onclick: () => openRequest(request.id) }),
      ]),
    ]))));
  } catch (err) {
    showError(host, err.message, loadRequests);
  }
}

async function openRequest(requestId) {
  dialog.querySelector('#dialog-title').textContent = 'Project request';
  showLoading(dBody(), 2);
  clear(dFoot());
  if (!dialog.open) dialog.showModal();

  let request;
  try { ({ request } = await api.get(`/api/admin/requests/${requestId}`)); }
  catch (err) { showError(dBody(), err.message); return; }

  const body = dBody();
  clear(body);
  body.removeAttribute('aria-busy');

  body.append(
    el('h3', { text: request.title }),
    el('p', { class: 'card__meta', text: `${request.contact_name} - ${request.contact_email}` }),
    el('p', {}, [statusBadge(request.status, labels)]),
    el('p', { text: request.description }),
    el('dl', { class: 'row__facts' }, [
      request.timeline ? el('div', {}, [el('dt', { text: 'Timeline' }), el('dd', { text: request.timeline })]) : false,
      request.budget_range ? el('div', {}, [el('dt', { text: 'Budget' }), el('dd', { text: request.budget_range })]) : false,
      request.reference_url ? el('div', {}, [el('dt', { text: 'Reference' }), el('dd', {}, [el('a', { href: request.reference_url, rel: 'noopener nofollow', target: '_blank', text: 'Link' })])]) : false,
    ]),
    el('h4', { text: 'Services requested', class: 'mt-2' }),
    el('table', { class: 'table' }, [
      el('tbody', {}, request.items.map((item) => el('tr', {}, [
        el('td', { 'data-label': 'Item', text: item.quantity > 1 ? `${item.name_snapshot} × ${item.quantity}` : item.name_snapshot }),
        el('td', { class: 'num', 'data-label': 'Amount', text: money(item.line_total_cents) }),
      ]))),
    ]),
    el('p', { class: 'summary__total' }, [el('span', { text: 'Customer estimate' }), el('span', { class: 'price', text: money(request.estimate_total_cents) })]),
    statusPicker('request', request.status, async (value, select) => {
      select.disabled = true;
      try { await api.patch(`/api/admin/requests/${request.id}`, { status: value }); toast('Status updated.'); loadRequests(); loadOverview(); }
      catch (err) { toast(err.message, 'error'); }
      finally { select.disabled = false; }
    }),
    notesBlock('request', request.id, request.notes),
    request.quotes.length ? el('h4', { text: 'Quotes', class: 'mt-2' }) : false,
    ...request.quotes.map((quote) => el('p', {}, [
      el('button', {
        class: 'btn btn--quiet btn--small', type: 'button',
        text: `Quote #${quote.id} - ${labels[quote.status] || quote.status} - ${money(quote.total_cents)}`,
        onclick: () => openQuoteEditor(quote.id),
      }),
    ])),
  );

  clear(dFoot());
  dFoot().append(
    el('button', { class: 'btn btn--quiet', type: 'button', text: 'Close', onclick: () => dialog.close() }),
    el('button', {
      class: 'btn btn--primary', type: 'button', text: 'Create a quote',
      onclick: async (event) => {
        busy(event.currentTarget, true, 'Creating...');
        try {
          const { quote } = await api.post('/api/admin/quotes', { request_id: request.id });
          openQuoteEditor(quote.id);
          loadRequests();
        } catch (err) { busy(event.currentTarget, false); toast(err.message, 'error'); }
      },
    })
  );
}

function statusPicker(domain, current, onChange) {
  const select = el('select', { class: 'select', id: `status-${domain}` },
    statusesByDomain[domain].map((status) =>
      el('option', { value: status.key, selected: status.key === current, text: status.label })));
  select.addEventListener('change', () => onChange(select.value, select));
  return el('div', { class: 'field mt-2' }, [
    el('label', { class: 'field__label', for: `status-${domain}`, text: 'Status' }),
    select,
  ]);
}

function notesBlock(entity, entityId, existing = []) {
  const list = el('div', { class: 'stack' }, existing.map((note) => el('p', { class: 'card__meta' }, [
    `${date(note.created_at)} - ${note.author_name || 'Atrio'}${note.internal ? ' (internal)' : ' (visible to customer)'}: ${note.body}`,
  ])));
  const input = el('textarea', { class: 'textarea', id: `note-${entity}-${entityId}`, placeholder: 'Add a note' });
  const internal = el('input', { type: 'checkbox', id: `note-internal-${entity}-${entityId}`, checked: true });

  return el('div', { class: 'mt-2' }, [
    el('h4', { text: 'Notes' }),
    list,
    el('label', { class: 'field__label', for: input.id, text: 'New note' }),
    input,
    el('p', { class: 'card__meta my-05' }, [
      internal, ' ',
      el('label', { for: internal.id, text: ' Internal only (uncheck to show the customer)' }),
    ]),
    el('button', {
      class: 'btn btn--quiet btn--small', type: 'button', text: 'Save note',
      onclick: async (event) => {
        if (!input.value.trim()) return;
        busy(event.currentTarget, true, 'Saving...');
        try {
          await api.post(`/api/admin/${entity === 'request' ? 'requests' : 'projects'}/${entityId}/notes`,
            { body: input.value, internal: internal.checked });
          list.append(el('p', { class: 'card__meta', text: `Just now - ${internal.checked ? '(internal)' : '(visible to customer)'}: ${input.value}` }));
          input.value = '';
          toast('Note saved.');
        } catch (err) { toast(err.message, 'error'); }
        finally { busy(event.currentTarget, false); }
      },
    }),
  ]);
}

/* -------------------------------------------------------------------- quotes */

async function loadQuotes() {
  const host = panel('quotes');
  showLoading(host);
  try {
    const { quotes } = await api.get('/api/admin/quotes');
    if (!quotes.length) {
      showEmpty(host, 'No quotes yet', 'Open a request and create a quote from it.');
      return;
    }
    clear(host);
    host.removeAttribute('aria-busy');
    host.append(el('div', { class: 'rows' }, quotes.map((quote) => el('article', { class: 'row' }, [
      el('div', { class: 'row__top' }, [
        el('h3', { class: 'row__title', text: `#${quote.id} ${quote.request_title}` }),
        statusBadge(quote.status, labels),
      ]),
      el('p', { class: 'row__meta', text: quote.contact_email }),
      el('dl', { class: 'row__facts' }, [
        el('div', {}, [el('dt', { text: 'Total' }), el('dd', { class: 'price', text: money(quote.total_cents, quote.currency) })]),
        el('div', {}, [el('dt', { text: 'Created' }), el('dd', { text: date(quote.created_at) })]),
      ]),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn btn--quiet btn--small', type: 'button', text: 'Open', onclick: () => openQuoteEditor(quote.id) }),
      ]),
    ]))));
  } catch (err) {
    showError(host, err.message, loadQuotes);
  }
}

async function openQuoteEditor(quoteId) {
  dialog.querySelector('#dialog-title').textContent = `Quote #${quoteId}`;
  showLoading(dBody(), 3);
  clear(dFoot());
  if (!dialog.open) dialog.showModal();

  let quote;
  try { ({ quote } = await api.get(`/api/admin/quotes/${quoteId}`)); }
  catch (err) { showError(dBody(), err.message); return; }

  const locked = quote.status === 'accepted';
  const body = dBody();
  clear(body);
  body.removeAttribute('aria-busy');

  body.append(
    el('p', {}, [statusBadge(quote.status, labels), ' ', el('span', { class: 'card__meta', text: quote.contact_email })]),
    locked ? el('div', { class: 'notice' }, [el('p', { text: 'This quote has been accepted, so its lines are locked. Create a new quote if the scope changes.' })]) : false,
  );

  const rows = el('tbody', {}, quote.items.map((item) => el('tr', {}, [
    el('td', { 'data-label': 'Item', text: item.description }),
    el('td', { class: 'num', 'data-label': 'Qty', text: String(item.quantity) }),
    el('td', { class: 'num', 'data-label': 'Unit', text: money(item.unit_price_cents, quote.currency) }),
    el('td', { class: 'num', 'data-label': 'Amount', text: money(item.line_total_cents, quote.currency) }),
    el('td', { 'data-label': '' }, [
      locked ? '' : el('button', {
        class: 'btn btn--danger btn--small', type: 'button', text: 'Remove',
        'aria-label': `Remove ${item.description}`,
        onclick: async () => {
          try { await api.delete(`/api/admin/quotes/${quote.id}/items/${item.id}`); openQuoteEditor(quote.id); }
          catch (err) { toast(err.message, 'error'); }
        },
      }),
    ]),
  ])));

  body.append(el('table', { class: 'table' }, [
    el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Item' }), el('th', { class: 'num', text: 'Qty' }),
      el('th', { class: 'num', text: 'Unit' }), el('th', { class: 'num', text: 'Amount' }), el('th', { text: '' }),
    ])]),
    rows,
  ]));

  if (!locked) body.append(addItemForm(quote));

  body.append(
    el('p', { class: 'summary__row' }, [el('span', { text: 'Subtotal' }), el('span', { class: 'price', text: money(quote.subtotal_cents, quote.currency) })]),
    el('p', { class: 'summary__total' }, [el('span', { text: 'Total' }), el('span', { class: 'price', text: money(quote.total_cents, quote.currency) })]),
  );

  if (!locked) body.append(quoteSettingsForm(quote));

  clear(dFoot());
  dFoot().append(el('button', { class: 'btn btn--quiet', type: 'button', text: 'Close', onclick: () => dialog.close() }));
  if (!locked && quote.status !== 'accepted') {
    dFoot().append(el('button', {
      class: 'btn btn--primary', type: 'button',
      text: quote.status === 'draft' ? 'Send to customer' : 'Re-send to customer',
      onclick: async (event) => {
        busy(event.currentTarget, true, 'Sending...');
        try {
          await api.post(`/api/admin/quotes/${quote.id}/send`);
          toast('Quote is now visible to the customer.');
          openQuoteEditor(quote.id);
          loadQuotes(); loadOverview();
        } catch (err) { busy(event.currentTarget, false); toast(err.message, 'error'); }
      },
    }));
  }
}

function addItemForm(quote) {
  const description = el('input', { class: 'input', id: 'qi-desc', placeholder: 'Line item' });
  const qty = el('input', { class: 'input', id: 'qi-qty', type: 'number', min: '1', max: '999', value: '1', inputmode: 'numeric' });
  const price = el('input', { class: 'input', id: 'qi-price', type: 'text', inputmode: 'decimal', placeholder: '500' });

  return el('div', { class: 'card my-1' }, [
    el('h4', { text: 'Add a line' }),
    el('label', { class: 'field__label', for: 'qi-desc', text: 'Description' }), description,
    el('div', { class: 'field-row mt-05' }, [
      el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'qi-qty', text: 'Quantity' }), qty]),
      el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'qi-price', text: 'Unit price (dollars)' }), price]),
    ]),
    el('button', {
      class: 'btn btn--quiet btn--small', type: 'button', text: 'Add line',
      onclick: async (event) => {
        busy(event.currentTarget, true, 'Adding...');
        try {
          await api.post(`/api/admin/quotes/${quote.id}/items`, {
            description: description.value, quantity: Number(qty.value), unit_price: price.value,
          });
          openQuoteEditor(quote.id);
        } catch (err) { busy(event.currentTarget, false); toast(err.message, 'error'); }
      },
    }),
  ]);
}

function quoteSettingsForm(quote) {
  const adjustment = el('input', {
    class: 'input', id: 'q-adj', type: 'text', inputmode: 'decimal',
    value: (quote.adjustment_cents / 100).toFixed(2), placeholder: '-50 for a discount',
  });
  const label = el('input', { class: 'input', id: 'q-adj-label', value: quote.adjustment_label || '', placeholder: 'Introductory discount' });
  const notes = el('textarea', { class: 'textarea', id: 'q-notes' }, [quote.notes || '']);
  const expires = el('input', {
    class: 'input', id: 'q-expires', type: 'date',
    value: quote.expires_at ? new Date(quote.expires_at).toISOString().slice(0, 10) : '',
  });

  return el('div', { class: 'card mt-1' }, [
    el('h4', { text: 'Adjustments and terms' }),
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'q-adj', text: 'Adjustment (dollars)' }), adjustment]),
      el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'q-adj-label', text: 'Adjustment label' }), label]),
    ]),
    el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'q-expires', text: 'Valid until' }), expires]),
    el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'q-notes', text: 'Notes for the customer' }), notes]),
    el('button', {
      class: 'btn btn--quiet btn--small', type: 'button', text: 'Save changes',
      onclick: async (event) => {
        busy(event.currentTarget, true, 'Saving...');
        try {
          await api.patch(`/api/admin/quotes/${quote.id}`, {
            adjustment: adjustment.value, adjustment_label: label.value,
            notes: notes.value, expires_at: expires.value || null,
          });
          toast('Quote updated.');
          openQuoteEditor(quote.id);
        } catch (err) { busy(event.currentTarget, false); toast(err.message, 'error'); }
      },
    }),
  ]);
}

/* ------------------------------------------------------------------ projects */

async function loadProjects() {
  const host = panel('projects');
  showLoading(host);
  try {
    const { projects } = await api.get('/api/admin/projects');
    if (!projects.length) {
      showEmpty(host, 'No projects yet', 'A project is created when a customer accepts a quote.');
      return;
    }
    clear(host);
    host.removeAttribute('aria-busy');
    host.append(el('div', { class: 'rows' }, projects.map((project) => {
      const select = el('select', { class: 'select', 'aria-label': `Status for ${project.title}` },
        statusesByDomain.project.map((status) =>
          el('option', { value: status.key, selected: status.key === project.status, text: status.label })));
      select.addEventListener('change', async () => {
        select.disabled = true;
        try { await api.patch(`/api/admin/projects/${project.id}`, { status: select.value }); toast('Project updated.'); loadOverview(); }
        catch (err) { toast(err.message, 'error'); }
        finally { select.disabled = false; }
      });
      return el('article', { class: 'row' }, [
        el('div', { class: 'row__top' }, [
          el('h3', { class: 'row__title', text: project.title }),
          statusBadge(project.status, labels),
        ]),
        el('p', { class: 'row__meta', text: `${project.customer_name || 'Customer'} - ${project.customer_email || ''}` }),
        el('dl', { class: 'row__facts' }, [
          el('div', {}, [el('dt', { text: 'Value' }), el('dd', { class: 'price', text: money(project.total_cents) })]),
          el('div', {}, [el('dt', { text: 'Payment' }), el('dd', { text: project.payment_status ? (labels[project.payment_status] || project.payment_status) : 'Not started' })]),
        ]),
        select,
        el('div', { class: 'btn-row' }, [
          el('button', {
            class: 'btn btn--quiet btn--small', type: 'button', text: 'Notes',
            onclick: () => openProjectNotes(project),
          }),
        ]),
      ]);
    })));
  } catch (err) {
    showError(host, err.message, loadProjects);
  }
}

async function openProjectNotes(project) {
  dialog.querySelector('#dialog-title').textContent = project.title;
  showLoading(dBody(), 1);
  clear(dFoot());
  if (!dialog.open) dialog.showModal();
  try {
    const { notes } = await api.get(`/api/admin/projects/${project.id}/notes`);
    clear(dBody());
    dBody().removeAttribute('aria-busy');
    dBody().append(notesBlock('project', project.id, notes));
    dFoot().append(el('button', { class: 'btn btn--quiet', type: 'button', text: 'Close', onclick: () => dialog.close() }));
  } catch (err) {
    showError(dBody(), err.message);
  }
}

/* ------------------------------------------------------------------ payments */

async function loadPayments() {
  const host = panel('payments');
  showLoading(host);
  try {
    const { payments } = await api.get('/api/admin/payments');
    if (!payments.length) {
      showEmpty(host, 'No payments yet', 'Payments appear here once a customer pays a quote.');
      return;
    }
    clear(host);
    host.removeAttribute('aria-busy');
    host.append(
      el('p', { class: 'card__meta', text: 'Stripe reference ids only. No card details are stored anywhere in Atrio.' }),
      el('div', { class: 'table-scroll' }, [el('table', { class: 'table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Customer' }), el('th', { text: 'Quote' }), el('th', { text: 'Status' }),
          el('th', { text: 'Date' }), el('th', { class: 'num', text: 'Amount' }), el('th', { text: 'Stripe session' }),
        ])]),
        el('tbody', {}, payments.map((payment) => el('tr', {}, [
          el('td', { 'data-label': 'Customer', text: payment.customer_email || '-' }),
          el('td', { 'data-label': 'Quote', text: `#${payment.quote_id}` }),
          el('td', { 'data-label': 'Status' }, [statusBadge(payment.status, labels)]),
          el('td', { 'data-label': 'Date', text: date(payment.paid_at || payment.created_at) }),
          el('td', { class: 'num', 'data-label': 'Amount', text: money(payment.amount_cents, payment.currency) }),
          el('td', { 'data-label': 'Stripe session', text: payment.stripe_checkout_session_id || '-' }),
        ]))),
      ])])
    );
  } catch (err) {
    showError(host, err.message, loadPayments);
  }
}

/* ------------------------------------------------------------------ services */

async function loadServices() {
  const host = panel('services');
  showLoading(host);
  try {
    const data = await api.get('/api/admin/services');
    categories = data.categories;
    clear(host);
    host.removeAttribute('aria-busy');
    host.append(
      el('div', { class: 'btn-row mb-1' }, [
        el('button', { class: 'btn btn--primary btn--small', type: 'button', text: 'Add a service', onclick: () => openServiceForm(null) }),
      ]),
      el('div', { class: 'rows' }, data.services.map((service) => el('article', { class: 'row' }, [
        el('div', { class: 'row__top' }, [
          el('h3', { class: 'row__title', text: service.name }),
          service.active ? statusBadge('active_service', { active_service: 'Active' }) : statusBadge('cancelled', { cancelled: 'Hidden' }),
        ]),
        el('p', { class: 'row__meta', text: `${service.category_name} - ${service.description}` }),
        el('dl', { class: 'row__facts' }, [
          el('div', {}, [el('dt', { text: 'Price' }), el('dd', { class: 'price', text: money(service.price_cents) })]),
          el('div', {}, [el('dt', { text: 'Type' }), el('dd', { text: service.pricing_type })]),
          el('div', {}, [el('dt', { text: 'Order' }), el('dd', { text: String(service.sort_order) })]),
        ]),
        el('div', { class: 'btn-row' }, [
          el('button', { class: 'btn btn--quiet btn--small', type: 'button', text: 'Edit', onclick: () => openServiceForm(service) }),
          el('button', {
            class: 'btn btn--danger btn--small', type: 'button',
            text: service.active ? 'Hide from catalog' : 'Show in catalog',
            onclick: async () => {
              try {
                if (service.active) await api.delete(`/api/admin/services/${service.id}`);
                else await api.patch(`/api/admin/services/${service.id}`, { active: true });
                loadServices(); loadOverview();
              } catch (err) { toast(err.message, 'error'); }
            },
          }),
        ]),
      ]))),
    );
  } catch (err) {
    showError(host, err.message, loadServices);
  }
}

function openServiceForm(service) {
  dialog.querySelector('#dialog-title').textContent = service ? 'Edit service' : 'New service';
  clear(dBody()); clear(dFoot());
  if (!dialog.open) dialog.showModal();

  const f = {
    name: el('input', { class: 'input', id: 's-name', value: service?.name || '' }),
    description: el('input', { class: 'input', id: 's-desc', value: service?.description || '' }),
    details: el('textarea', { class: 'textarea', id: 's-details' }, [service?.details || '']),
    category: el('select', { class: 'select', id: 's-cat' }, categories.map((c) =>
      el('option', { value: c.id, selected: service?.category_id === c.id, text: c.name }))),
    price: el('input', { class: 'input', id: 's-price', inputmode: 'decimal', value: service ? (service.price_cents / 100).toFixed(2) : '' }),
    pricing: el('select', { class: 'select', id: 's-type' }, [
      el('option', { value: 'fixed', selected: service?.pricing_type === 'fixed', text: 'Fixed price' }),
      el('option', { value: 'starting', selected: service?.pricing_type === 'starting', text: 'Starting price' }),
      el('option', { value: 'quantity', selected: service?.pricing_type === 'quantity', text: 'Priced per unit' }),
    ]),
    unit: el('input', { class: 'input', id: 's-unit', value: service?.unit_label || '', placeholder: 'per page' }),
    maxQty: el('input', { class: 'input', id: 's-maxq', type: 'number', min: '1', max: '999', value: String(service?.max_quantity || 10) }),
    order: el('input', { class: 'input', id: 's-order', type: 'number', min: '0', value: String(service?.sort_order ?? 500) }),
  };

  const field = (label, input, hint) => el('div', { class: 'field' }, [
    el('label', { class: 'field__label', for: input.id, text: label }),
    hint ? el('span', { class: 'field__hint', text: hint }) : false,
    input,
  ]);

  dBody().append(
    el('div', { 'data-form-notice': true }),
    field('Name', f.name),
    field('Short description', f.description, 'One line, shown in the builder.'),
    field('Details', f.details, 'Optional. Shown under the description.'),
    field('Category', f.category),
    el('div', { class: 'field-row' }, [
      field('Price (dollars)', f.price),
      field('Pricing type', f.pricing),
    ]),
    el('div', { class: 'field-row' }, [
      field('Unit label', f.unit, 'Optional, e.g. per page.'),
      field('Max quantity', f.maxQty, 'Used for per-unit pricing.'),
    ]),
    field('Sort order', f.order, 'Lower numbers appear first.'),
  );

  dFoot().append(
    el('button', { class: 'btn btn--quiet', type: 'button', text: 'Cancel', onclick: () => dialog.close() }),
    el('button', {
      class: 'btn btn--primary', type: 'button', text: service ? 'Save changes' : 'Create service',
      onclick: async (event) => {
        const payload = {
          name: f.name.value, description: f.description.value, details: f.details.value,
          category_id: Number(f.category.value), price: f.price.value, pricing_type: f.pricing.value,
          unit_label: f.unit.value, max_quantity: Number(f.maxQty.value), sort_order: Number(f.order.value),
          active: service ? service.active : true,
        };
        busy(event.currentTarget, true, 'Saving...');
        try {
          if (service) await api.patch(`/api/admin/services/${service.id}`, payload);
          else await api.post('/api/admin/services', payload);
          dialog.close();
          toast('Service saved.');
          loadServices(); loadOverview();
        } catch (err) {
          busy(event.currentTarget, false);
          const slot = dBody().querySelector('[data-form-notice]');
          clear(slot);
          slot.append(el('div', { class: 'notice notice--error', role: 'alert' }, [
            el('p', { text: err.message }),
            ...Object.entries(err.fields || {}).map(([k, v]) => el('p', { text: `${k}: ${v}` })),
          ]));
        }
      },
    })
  );
}

/* ----------------------------------------------------------------- customers */

async function loadCustomers() {
  const host = panel('customers');
  showLoading(host);
  const search = el('input', { class: 'input', type: 'search', id: 'cust-search', placeholder: 'Search by name or email' });
  try {
    const render = async () => {
      const { customers } = await api.get(`/api/admin/customers?search=${encodeURIComponent(search.value)}`);
      const list = host.querySelector('[data-customer-list]');
      clear(list);
      if (!customers.length) {
        list.append(el('div', { class: 'empty' }, [
          el('h3', { text: 'No customers found' }),
          el('p', { text: search.value ? 'Try a different search.' : 'Accounts appear here as people sign up.' }),
        ]));
        return;
      }
      list.append(el('div', { class: 'table-scroll' }, [el('table', { class: 'table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Name' }), el('th', { text: 'Email' }), el('th', { text: 'Role' }),
          el('th', { class: 'num', text: 'Requests' }), el('th', { class: 'num', text: 'Projects' }), el('th', { text: 'Joined' }),
        ])]),
        el('tbody', {}, customers.map((customer) => el('tr', {}, [
          el('td', { 'data-label': 'Name', text: customer.name }),
          el('td', { 'data-label': 'Email', text: customer.email }),
          el('td', { 'data-label': 'Role', text: customer.role }),
          el('td', { class: 'num', 'data-label': 'Requests', text: String(customer.request_count) }),
          el('td', { class: 'num', 'data-label': 'Projects', text: String(customer.project_count) }),
          el('td', { 'data-label': 'Joined', text: date(customer.created_at) }),
        ]))),
      ])]));
    };

    clear(host);
    host.removeAttribute('aria-busy');
    host.append(
      el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'cust-search', text: 'Search customers' }), search]),
      el('div', { 'data-customer-list': true }),
    );
    let timer;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 250); });
    await render();
  } catch (err) {
    showError(host, err.message, loadCustomers);
  }
}

/* ------------------------------------------------------------------ settings */

const SETTING_FIELDS = [
  { key: 'business_name', label: 'Business name', help: 'Shown in the footer.' },
  { key: 'business_email', label: 'Contact email', help: 'Where quote requests should reach you.' },
  { key: 'business_tagline', label: 'Tagline', help: 'One line under the footer logo.' },
  { key: 'estimate_disclaimer', label: 'Estimate disclaimer', help: 'Shown wherever an estimate is displayed.' },
];

async function loadSettings() {
  const host = panel('settings');
  showLoading(host);
  try {
    const { settings } = await api.get('/api/admin/settings');
    const inputs = {};

    const fields = SETTING_FIELDS.map(({ key, label, help }) => {
      const input = el('input', {
        class: 'input', id: `set-${key}`, name: key,
        type: key === 'business_email' ? 'email' : 'text',
        value: settings[key] || '',
      });
      inputs[key] = input;
      return el('div', { class: 'field' }, [
        el('label', { class: 'field__label', for: `set-${key}`, text: label }),
        input,
        el('p', { class: 'field__hint', text: help }),
        el('p', { class: 'field__error', 'data-error-for': key }),
      ]);
    });

    const save = el('button', { class: 'btn btn--primary', type: 'button', text: 'Save settings' });
    save.addEventListener('click', async () => {
      host.querySelectorAll('[data-error-for]').forEach((node) => { node.textContent = ''; });
      const body = Object.fromEntries(SETTING_FIELDS.map(({ key }) => [key, inputs[key].value]));
      busy(save, true, 'Saving...');
      try {
        await api.patch('/api/admin/settings', body);
        toast('Settings saved. Reload the site to see them.');
      } catch (err) {
        const fields = Object.entries(err.fields || {});
        if (fields.length) {
          for (const [field, message] of fields) {
            const node = host.querySelector(`[data-error-for="${field}"]`);
            if (node) node.textContent = message;
          }
        } else {
          toast(err.message, 'error');
        }
      } finally {
        busy(save, false);
      }
    });

    clear(host);
    host.removeAttribute('aria-busy');
    host.append(
      el('div', { class: 'card' }, [
        el('h2', { class: 'card__title', text: 'Business details' }),
        el('p', { class: 'card__meta', text: 'These appear on the public site. Changing them here does not require any code edits.' }),
        ...fields,
        el('div', { class: 'btn-row' }, [save]),
      ])
    );
  } catch (err) {
    showError(host, err.message, loadSettings);
  }
}

init();
