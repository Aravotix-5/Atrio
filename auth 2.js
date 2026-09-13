import { api, ApiError } from './api.js';
import { applyFieldErrors, setFormNotice, busy } from './ui.js';

const form = document.querySelector('[data-auth-form]');
const mode = form.dataset.mode;

/** Only same-origin paths are honoured, so ?next= cannot send people off-site. */
function safeNext() {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/account';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = form.querySelector('button[type="submit"]');
  setFormNotice(form, '');
  applyFieldErrors(form, {});

  const payload = mode === 'signup'
    ? { name: form.elements.name.value, email: form.elements.email.value, password: form.elements.password.value }
    : { email: form.elements.email.value, password: form.elements.password.value };

  busy(submit, true, mode === 'signup' ? 'Creating...' : 'Logging in...');
  try {
    const { user } = await api.post(`/api/auth/${mode}`, payload);
    window.location.href = user.role === 'admin' || user.role === 'staff' ? '/admin' : safeNext();
  } catch (err) {
    busy(submit, false);
    setFormNotice(form, err.message);
    if (err instanceof ApiError && Object.keys(err.fields).length) applyFieldErrors(form, err.fields);
  }
});
