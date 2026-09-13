import { api, ApiError } from './api.js';
import {
  el, clear, money, date, showLoading, showError, showEmpty,
  statusBadge, toast, busy,
} from './ui.js';

const labels = {};
const dialog = document.querySelector('[data-quote-dialog]');
let stripeEnabled = false;

async function init() {
  const { user } = await api.get('/api/auth/me');
  if (!user) {
    window.location.href = `/login?next=${encodeURIComponent('/account')}`;
    return;
  }
  document.querySelector('[data-greeting]').textContent = `Signed in as ${user.email}`;

  showReturnNotice();
  loadStatusLabels();
  loadPaymentConfig();
  wireTabs();
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());

  loadProjects();
}

function showReturnNotice() {
  const params = new URLSearchParams(window.location.search);
  const slot = document.querySelector('[data-page-notice]');
  if (params.get('payment') === 'cancelled') {
    slot.append(el('div', { class: 'notice notice--warn', role: 'status' }, [
      el('p', { text: 'Your checkout was cancelled. Nothing was charged. You can pay from the quote whenever you are ready.' }),
    ]));
  }
}

async function loadStatusLabels() {
  try {
    const { statuses } = await api.get('/api/statuses');
    for (const status of statuses) labels[status.key] = status.label;
  } catch { /* keys are readable enough on their own */ }
}

async function loadPaymentConfig() {
  try { stripeEnabled = (await api.get('/api/payments/config')).enabled; } catch { stripeEnabled = false; }
}

function wireTabs() {
  const loaders = { projects: loadProjects, quotes: loadQuotes, requests: loadRequests, payments: loadPayments };
  const tabs = [...document.querySelectorAll('[data-tab]')];
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        document.querySelector(`[data-panel="${t.dataset.tab}"]`).hidden = !on;
      });
      loaders[tab.dataset.tab]();
    });
  });
}

const panel = (name) => document.querySelector(`[data-panel="${name}"]`);

async function loadProjects() {
  const host = panel('projects');
  showLoading(host);
  try {
    const { projects } = await api.get('/api/projects');
    if (!projects.length) {
      showEmpty(host, 'No projects yet', 'A project appears here once you accept a quote.',
        el('a', { class: 'btn btn--primary', href: '/build', text: 'Build your project' }));
      return;
    }
    clear(host);
    host.removeAttribute('aria-busy');
    host.append(el('div', { class: 'rows' }, projects.map((project) => el('article', { class: 'row' }, [
      el('div', { class: 'row__top' }, [
        el('h3', { class: 'row__title', text: project.title }),
        statusBadge(project.status, labels),
      ]),
      el('dl', { class: 'row__facts' }, [
        el('div', {}, [el('dt', { text: 'Agreed total' }), el('dd', { class: 'price', text: money(project.total_cents) })]),
        el('div', {}, [el('dt', { text: 'Started' }), el('dd', { text: date(project.created_at) })]),
        el('div', {}, [el('dt', { text: 'Payment' }), el('dd', { text: project.payment_status ? labelFor(project.payment_status) : 'Not started' })]),
      ]),
      project.status === 'payment_pending'
        ? el('div', { class: 'btn-row' }, [
            el('button', {
              class: 'btn btn--primary btn--small', type: 'button', text: 'Review and pay',
              onclick: () => openQuote(project.quote_id),
            }),
          ])
        : false,
    ]))));
  } catch (err) {
    showError(host, err.message, loadProjects);
  }
}

async function loadQuotes() {
  const host = panel('quotes');
  showLoading(host);
  try {
    const { quotes } = await api.get('/api/quotes');
    if (!quotes.length) {
      showEmpty(host, 'No quotes yet', 'When Atrio finishes reviewing a request, the quote shows up here.');
      return;
    }
    clear(host);
    host.removeAttribute('aria-busy');
    host.append(el('div', { class: 'rows' }, quotes.map((quote) => el('article', { class: 'row' }, [
      el('div', { class: 'row__top' }, [
        el('h3', { class: 'row__title', text: quote.request_title }),
        statusBadge(quote.paid ? 'paid' : quote.status, labels),
      ]),
      el('dl', { class: 'row__facts' }, [
        el('div', {}, [el('dt', { text: 'Total' }), el('dd', { class: 'price', text: money(quote.total_cents, quote.currency) })]),
        quote.expires_at ? el('div', {}, [el('dt', { text: 'Valid until' }), el('dd', { text: date(quote.expires_at) })]) : false,
      ]),
      el('div', { class: 'btn-row' }, [
        el('button', {
          class: 'btn btn--quiet btn--small', type: 'button',
          text: quote.status === 'sent' ? 'Review quote' : 'View quote',
          onclick: () => openQuote(quote.id),
        }),
      ]),
    ]))));
  } catch (err) {
    showError(host, err.message, loadQuotes);
  }
}

async function loadRequests() {
  const host = panel('requests');
  showLoading(host);
  try {
    const { requests } = await api.get('/api/project-requests');
    if (!requests.length) {
      showEmpty(host, 'No requests yet', 'Build a project and send it over to get a quote.',
        el('a', { class: 'btn btn--primary', href: '/build', text: 'Build your project' }));
      return;
    }
    clear(host);
    host.removeAttribute('aria-busy');
    host.append(el('div', { class: 'rows' }, requests.map((request) => el('article', { class: 'row' }, [
      el('div', { class: 'row__top' }, [
        el('h3', { class: 'row__title', text: request.title }),
        statusBadge(request.status, labels),
      ]),
      el('dl', { class: 'row__facts' }, [
        el('div', {}, [el('dt', { text: 'Your estimate' }), el('dd', { class: 'price', text: money(request.estimate_total_cents) })]),
        el('div', {}, [el('dt', { text: 'Sent' }), el('dd', { text: date(request.created_at) })]),
      ]),
      request.quote_id
        ? el('div', { class: 'btn-row' }, [el('button', {
            class: 'btn btn--quiet btn--small', type: 'button', text: 'See the quote',
            onclick: () => openQuote(request.quote_id),
          })])
        : el('p', { class: 'row__meta', text: 'Atrio is reviewing this. You will see a quote here when it is ready.' }),
    ]))));
  } catch (err) {
    showError(host, err.message, loadRequests);
  }
}

async function loadPayments() {
  const host = panel('payments');
  showLoading(host);
  try {
    const { payments } = await api.get('/api/payments');
    if (!payments.length) {
      showEmpty(host, 'No payments yet', 'Payments appear here after you accept a quote and pay.');
      return;
    }
    clear(host);
    host.removeAttribute('aria-busy');
    const table = el('table', { class: 'table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Project' }), el('th', { text: 'Date' }),
        el('th', { text: 'Status' }), el('th', { class: 'num', text: 'Amount' }),
      ])]),
      el('tbody', {}, payments.map((payment) => el('tr', {}, [
        el('td', { 'data-label': 'Project', text: payment.project_title }),
        el('td', { 'data-label': 'Date', text: date(payment.paid_at || payment.created_at) }),
        el('td', { 'data-label': 'Status' }, [statusBadge(payment.status, labels)]),
        el('td', { class: 'num', 'data-label': 'Amount', text: money(payment.amount_cents, payment.currency) }),
      ]))),
    ]);
    host.append(el('div', { class: 'table-scroll' }, [table]));
  } catch (err) {
    showError(host, err.message, loadPayments);
  }
}

const labelFor = (key) => labels[key] || key.replace(/_/g, ' ');

async function openQuote(quoteId) {
  const body = dialog.querySelector('[data-quote-body]');
  const actions = dialog.querySelector('[data-quote-actions]');
  clear(actions);
  showLoading(body, 2);
  if (!dialog.open) dialog.showModal();

  let quote;
  try {
    ({ quote } = await api.get(`/api/quotes/${quoteId}`));
  } catch (err) {
    showError(body, err.message);
    return;
  }

  dialog.querySelector('#quote-dialog-title').textContent = quote.request_title;
  clear(body);
  body.removeAttribute('aria-busy');

  body.append(
    el('p', {}, [statusBadge(quote.payment_status === 'paid' ? 'paid' : quote.status, labels)]),
    el('table', { class: 'table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Item' }), el('th', { class: 'num', text: 'Qty' }), el('th', { class: 'num', text: 'Amount' }),
      ])]),
      el('tbody', {}, quote.items.map((item) => el('tr', {}, [
        el('td', { 'data-label': 'Item', text: item.description }),
        el('td', { class: 'num', 'data-label': 'Qty', text: String(item.quantity) }),
        el('td', { class: 'num', 'data-label': 'Amount', text: money(item.line_total_cents, quote.currency) }),
      ]))),
    ]),
  );

  if (quote.adjustment_cents) {
    body.append(el('p', { class: 'summary__row' }, [
      el('span', { text: quote.adjustment_label || 'Adjustment' }),
      el('span', { class: 'price', text: money(quote.adjustment_cents, quote.currency) }),
    ]));
  }
  body.append(el('p', { class: 'summary__total' }, [
    el('span', { text: 'Total' }),
    el('span', { class: 'price', text: money(quote.total_cents, quote.currency) }),
  ]));
  if (quote.notes) body.append(el('div', { class: 'notice' }, [el('p', { text: quote.notes })]));
  if (quote.expires_at && quote.status === 'sent') {
    body.append(el('p', { class: 'card__meta', text: `This quote is valid until ${date(quote.expires_at)}.` }));
  }

  renderQuoteActions(actions, quote);
}

function renderQuoteActions(actions, quote) {
  clear(actions);
  const paid = quote.payment_status === 'paid';

  if (quote.status === 'sent') {
    actions.append(
      el('button', {
        class: 'btn btn--quiet', type: 'button', text: 'Request changes',
        onclick: () => askForChanges(quote),
      }),
      el('button', {
        class: 'btn btn--primary', type: 'button', text: 'Accept quote',
        onclick: async (event) => {
          busy(event.currentTarget, true, 'Accepting...');
          try {
            await api.post(`/api/quotes/${quote.id}/accept`);
            toast('Quote accepted.');
            await openQuote(quote.id);
            loadProjects();
          } catch (err) {
            busy(event.currentTarget, false);
            toast(err.message, 'error');
          }
        },
      })
    );
    return;
  }

  if (quote.status === 'accepted' && !paid) {
    actions.append(el('button', {
      class: 'btn btn--primary', type: 'button',
      text: stripeEnabled ? 'Pay securely with Stripe' : 'Pay',
      onclick: async (event) => {
        const button = event.currentTarget;
        busy(button, true, 'Opening checkout...');
        try {
          const { url } = await api.post('/api/payments/checkout-session', { quote_id: quote.id });
          window.location.href = url;
        } catch (err) {
          busy(button, false);
          const body = dialog.querySelector('[data-quote-body]');
          body.prepend(el('div', {
            class: err instanceof ApiError && err.status === 503 ? 'notice notice--warn' : 'notice notice--error',
            role: 'alert',
          }, [el('p', { text: err.message })]));
        }
      },
    }));
    return;
  }

  if (paid) {
    actions.append(el('p', { class: 'card__meta', text: 'Paid in full. Thank you.' }));
  }
  actions.append(el('button', { class: 'btn btn--quiet', type: 'button', text: 'Close', onclick: () => dialog.close() }));
}

function askForChanges(quote) {
  const body = dialog.querySelector('[data-quote-body]');
  const existing = body.querySelector('[data-decline-form]');
  if (existing) { existing.querySelector('textarea').focus(); return; }

  const textarea = el('textarea', { class: 'textarea', id: 'decline-reason', required: true,
    placeholder: 'What would you like changed?' });
  const form = el('div', { class: 'card mt-1', 'data-decline-form': true }, [
    el('label', { class: 'field__label', for: 'decline-reason', text: 'Tell Atrio what to change' }),
    textarea,
    el('div', { class: 'btn-row mt-05' }, [
      el('button', {
        class: 'btn btn--primary btn--small', type: 'button', text: 'Send',
        onclick: async (event) => {
          if (textarea.value.trim().length < 5) { toast('Add a little more detail.', 'error'); return; }
          busy(event.currentTarget, true, 'Sending...');
          try {
            await api.post(`/api/quotes/${quote.id}/decline`, { reason: textarea.value });
            toast('Sent. Atrio will follow up with a revised quote.');
            dialog.close();
            loadQuotes();
          } catch (err) {
            busy(event.currentTarget, false);
            toast(err.message, 'error');
          }
        },
      }),
      el('button', { class: 'btn btn--quiet btn--small', type: 'button', text: 'Cancel', onclick: () => form.remove() }),
    ]),
  ]);
  body.append(form);
  textarea.focus();
}

init();
