/**
 * Small fetch wrapper. Adds the CSRF token to state-changing requests,
 * refreshes it once if the session rotated, and turns API errors into
 * something the UI can show.
 */
let csrfToken = null;

export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

async function loadCsrf() {
  const res = await fetch('/api/csrf', { credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(res.status, 'Could not start a secure session. Refresh the page.');
  csrfToken = (await res.json()).csrfToken;
  return csrfToken;
}

async function request(method, path, body, retry = true) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken || (await loadCsrf());

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'We could not reach the server. Check your connection and try again.');
  }

  if (res.status === 204) return null;

  let data = null;
  try { data = await res.json(); } catch { data = null; }

  if (!res.ok) {
    // A rotated session invalidates the token we hold; fetch a fresh one once.
    if (res.status === 403 && retry && /session expired/i.test(data?.error || '')) {
      await loadCsrf();
      return request(method, path, body, false);
    }
    throw new ApiError(res.status, data?.error || 'Something went wrong. Please try again.', data?.fields);
  }
  return data;
}

export const api = {
  get:    (path) => request('GET', path),
  post:   (path, body) => request('POST', path, body ?? {}),
  patch:  (path, body) => request('PATCH', path, body ?? {}),
  delete: (path) => request('DELETE', path),
  primeCsrf: loadCsrf,
};
