import { api } from './api.js';
import { el, clear, money } from './ui.js';

/**
 * This page never decides on its own that a payment succeeded. It asks the
 * server, which reads the payment record (set by the verified Stripe webhook)
 * and double-checks with Stripe if the webhook has not landed yet.
 */
const host = document.querySelector('[data-checkout-status]');
const sessionId = new URLSearchParams(window.location.search).get('session_id');

async function check(attempt = 1) {
  if (!sessionId) return render('missing');
  try {
    const { payment } = await api.get(`/api/payments/session/${encodeURIComponent(sessionId)}`);
    if (payment.status === 'paid') return render('paid', payment);
    if (attempt < 4) return setTimeout(() => check(attempt + 1), 1500);
    return render('pending', payment);
  } catch (err) {
    if (err.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    render('error', null, err.message);
  }
}

function render(kind, payment, message) {
  clear(host);
  const back = el('div', { class: 'btn-row' }, [
    el('a', { class: 'btn btn--primary', href: '/account', text: 'Go to your account' }),
  ]);

  if (kind === 'paid') {
    host.append(
      el('h1', { class: 'h-lg', text: 'Payment received' }),
      el('div', { class: 'notice notice--success', role: 'status' }, [
        el('p', { text: `We have recorded ${money(payment.amount_cents, payment.currency)}. Your project moves forward from here.` }),
      ]),
      back
    );
    return;
  }
  if (kind === 'pending') {
    host.append(
      el('h1', { class: 'h-lg', text: 'Payment is still processing' }),
      el('div', { class: 'notice notice--warn', role: 'status' }, [
        el('p', { text: 'Stripe has not confirmed this one yet. Some payment methods take a little longer. Your account will update by itself - no need to pay again.' }),
      ]),
      back
    );
    return;
  }
  if (kind === 'missing') {
    host.append(
      el('h1', { class: 'h-lg', text: 'Nothing to show here' }),
      el('p', { class: 'lede', text: 'This page opens after a Stripe checkout. Your payment status is always in your account.' }),
      back
    );
    return;
  }
  host.append(
    el('h1', { class: 'h-lg', text: 'We could not check that payment' }),
    el('div', { class: 'notice notice--error', role: 'alert' }, [el('p', { text: message || 'Please try again.' })]),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn--quiet', type: 'button', text: 'Try again', onclick: () => check() }),
      el('a', { class: 'btn btn--primary', href: '/account', text: 'Go to your account' }),
    ])
  );
}

check();
