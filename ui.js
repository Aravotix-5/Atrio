/** Shared UI helpers: formatting, states, toasts, navigation. */

export const money = (cents, currency = 'usd') =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format((cents || 0) / 100);

export const date = (value) =>
  value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/** Loading placeholder that keeps layout stable. */
export function showLoading(node, rows = 3) {
  clear(node);
  for (let i = 0; i < rows; i += 1) node.append(el('div', { class: 'skeleton skeleton--row', 'aria-hidden': 'true' }));
  node.setAttribute('aria-busy', 'true');
}

export function showEmpty(node, title, message, action) {
  clear(node);
  node.removeAttribute('aria-busy');
  node.append(el('div', { class: 'empty' }, [
    el('h3', { text: title }),
    el('p', { text: message }),
    action || false,
  ]));
}

export function showError(node, message, onRetry) {
  clear(node);
  node.removeAttribute('aria-busy');
  node.append(el('div', { class: 'notice notice--error', role: 'alert' }, [
    el('p', { text: message }),
    onRetry ? el('button', { class: 'btn btn--quiet btn--small', text: 'Try again', onclick: onRetry }) : false,
  ]));
}

let toastArea;
export function toast(message, kind = 'info') {
  if (!toastArea) {
    toastArea = el('div', { class: 'toast-area', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastArea);
  }
  const node = el('div', { class: `toast${kind === 'error' ? ' toast--error' : ''}`, text: message });
  toastArea.append(node);
  setTimeout(() => node.remove(), 5000);
}

/** Puts server-side field errors next to the right inputs. */
export function applyFieldErrors(form, fields = {}) {
  form.querySelectorAll('[data-error-for]').forEach((n) => { n.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
  let first = null;
  for (const [name, message] of Object.entries(fields)) {
    const slot = form.querySelector(`[data-error-for="${name}"]`);
    const input = form.elements[name];
    if (slot) slot.textContent = message;
    if (input) { input.setAttribute('aria-invalid', 'true'); first = first || input; }
  }
  if (first) first.focus();
}

export function setFormNotice(form, message, kind = 'error') {
  const slot = form.querySelector('[data-form-notice]');
  if (!slot) return;
  clear(slot);
  if (!message) return;
  slot.append(el('div', { class: `notice notice--${kind}`, role: kind === 'error' ? 'alert' : 'status', text: message }));
}

export function busy(button, isBusy, busyLabel = 'Working...') {
  if (!button) return;
  if (isBusy) {
    button.dataset.label = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
  } else {
    if (button.dataset.label) button.textContent = button.dataset.label;
    button.disabled = false;
  }
}

const STATUS_TONE = {
  submitted: 'badge--wait', under_review: 'badge--wait', quote_sent: 'badge--active',
  awaiting_customer: 'badge--wait', accepted: 'badge--good', cancelled: 'badge--stop',
  draft: '', sent: 'badge--active', declined: 'badge--stop', expired: 'badge--stop',
  payment_pending: 'badge--wait', paid: 'badge--good', in_progress: 'badge--active',
  waiting_for_customer: 'badge--wait', completed: 'badge--good', pending: 'badge--wait',
  failed: 'badge--stop', refunded: '',
};

/** Status pill. The label carries the meaning; colour only reinforces it. */
export function statusBadge(key, labels = {}) {
  const label = labels[key] || key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return el('span', { class: `badge ${STATUS_TONE[key] || ''}`.trim(), text: label });
}

export const checkIcon = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M13.5 4.5 6.5 12 2.5 8');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2.2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
};
