/**
 * End-to-end smoke test. Boots the real server against the database in your
 * .env, then walks the main flows and the security rules.
 *
 *   npm run test:smoke
 *
 * It creates test accounts with an @atrio-smoke.test email, and cleans them up
 * afterwards. Run it against a development database, never production.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import 'dotenv/config';
import pg from 'pg';

const PORT = Number(process.env.SMOKE_PORT || 3111);
const BASE = `http://127.0.0.1:${PORT}`;
const WEBHOOK_SECRET = 'whsec_smoketest_secret_value';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` -> ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

class Agent {
  constructor() { this.cookies = new Map(); this.csrf = null; }
  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  store(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const idx = pair.indexOf('=');
      this.cookies.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
  }
  async req(method, path, body, { skipCsrf = false, headers = {} } = {}) {
    if (!skipCsrf && method !== 'GET' && !this.csrf) await this.loadCsrf();
    const res = await fetch(BASE + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(this.cookieHeader() ? { cookie: this.cookieHeader() } : {}),
        ...(!skipCsrf && this.csrf ? { 'x-csrf-token': this.csrf } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    this.store(res);
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
    return { status: res.status, data };
  }
  get(p, o) { return this.req('GET', p, undefined, o); }
  post(p, b, o) { return this.req('POST', p, b, o); }
  patch(p, b, o) { return this.req('PATCH', p, b, o); }
  del(p, o) { return this.req('DELETE', p, undefined, o); }
  async loadCsrf() {
    const res = await this.get('/api/csrf');
    this.csrf = res.data?.csrfToken;
  }
}

function startServer(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['src/server.js'], {
      env: { ...process.env, PORT: String(PORT), NODE_ENV: 'development', ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); if (out.includes('server_started')) resolve(child); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    setTimeout(() => reject(new Error(`server did not start:\n${out}`)), 15000).unref();
  });
}

async function stopServer(child) {
  child.kill('SIGTERM');
  await new Promise((r) => { child.on('exit', r); setTimeout(r, 3000).unref(); });
}

const stamp = Date.now();
const customer = { name: 'Smoke Customer', email: `smoke+${stamp}@atrio-smoke.test`, password: 'SmokeTest12345' };
const other = { name: 'Other Customer', email: `other+${stamp}@atrio-smoke.test`, password: 'SmokeTest12345' };

async function main() {
  console.log('\nAtrio smoke test\n');
  let server = await startServer();

  const anon = new Agent();
  const alice = new Agent();
  const bob = new Agent();
  const admin = new Agent();
  let serviceIds = [];
  let requestId, quoteId, projectId;

  try {
    console.log('Public site and catalog');
    check('health endpoint responds', (await anon.get('/healthz')).data?.ok === true);
    const home = await fetch(`${BASE}/`);
    check('homepage loads', home.status === 200);
    const catalog = await anon.get('/api/services');
    const categories = catalog.data?.categories ?? [];
    serviceIds = categories.flatMap((c) => c.services).slice(0, 3).map((s) => s.id);
    check('services load from the database', categories.length >= 5 && serviceIds.length === 3,
      `categories=${categories.length}`);

    const estimate = await anon.post('/api/estimate', {
      items: [{ service_id: serviceIds[0], quantity: 1 }, { service_id: serviceIds[1], quantity: 2 }],
    });
    check('estimate totals calculate server-side', estimate.status === 200 && estimate.data.total_cents > 0);
    const emptyEstimate = await anon.post('/api/estimate', { items: [] });
    check('empty selection is rejected', emptyEstimate.status === 400);

    console.log('\nSecurity: CSRF and price tampering');
    const noCsrf = await anon.post('/api/auth/login', { email: 'x@y.test', password: 'nope' }, { skipCsrf: true });
    check('state-changing request without CSRF token is blocked', noCsrf.status === 403);

    console.log('\nAccounts');
    const signup = await alice.post('/api/auth/signup', customer);
    check('signup works', signup.status === 201 && signup.data.user.email === customer.email,
      JSON.stringify(signup.data));
    check('signup gives the customer role, not admin', signup.data?.user?.role === 'customer');
    const dupe = await new Agent().post('/api/auth/signup', customer);
    check('duplicate email is rejected', dupe.status === 409);
    const weak = await new Agent().post('/api/auth/signup', { ...customer, email: `weak+${stamp}@atrio-smoke.test`, password: 'short' });
    check('weak password is rejected', weak.status === 400 && Boolean(weak.data.fields?.password));
    await bob.post('/api/auth/signup', other);
    check('second account created', (await bob.get('/api/auth/me')).data.user.email === other.email);

    const badLogin = await new Agent().post('/api/auth/login', { email: customer.email, password: 'wrongpassword' });
    check('wrong password is rejected', badLogin.status === 401);

    console.log('\nProject request');
    const tampered = await alice.post('/api/project-requests', {
      contact_name: 'Smoke Customer',
      contact_email: customer.email,
      title: 'Smoke test project',
      description: 'A project request created by the automated smoke test to verify the flow end to end.',
      timeline: '2 months',
      // Deliberately sending a fake price. The server must ignore it.
      items: [{ service_id: serviceIds[0], quantity: 1, unit_price_cents: 1, price: 0.01 }],
    });
    requestId = tampered.data?.request?.id;
    const trueService = categories.flatMap((c) => c.services).find((s) => s.id === serviceIds[0]);
    check('project request saves', tampered.status === 201 && Boolean(requestId), JSON.stringify(tampered.data));
    check('browser-supplied price is ignored',
      tampered.data?.request?.estimate_total_cents === trueService.price_cents,
      `got ${tampered.data?.request?.estimate_total_cents}, expected ${trueService.price_cents}`);

    const invalid = await alice.post('/api/project-requests', {
      contact_name: '', contact_email: 'not-an-email', title: 'x', description: 'too short', items: [],
    });
    check('request validation returns field errors', invalid.status === 400 && Object.keys(invalid.data.fields || {}).length >= 3);

    const mine = await alice.get('/api/project-requests');
    check('customer sees their own request', mine.data.requests.some((r) => r.id === requestId));
    const stolen = await bob.get(`/api/project-requests/${requestId}`);
    check('customer cannot read another customer request', stolen.status === 404);

    console.log('\nAdmin access control');
    const anonAdmin = await anon.get('/api/admin/overview');
    check('signed-out visitor cannot reach admin', anonAdmin.status === 401);
    const customerAdmin = await alice.get('/api/admin/overview');
    check('customer cannot reach admin', customerAdmin.status === 403);

    const adminLogin = await admin.post('/api/auth/login', {
      email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD,
    });
    check('admin login works', adminLogin.status === 200 && adminLogin.data.user.role === 'admin',
      JSON.stringify(adminLogin.data));
    check('admin overview loads', (await admin.get('/api/admin/overview')).status === 200);

    console.log('\nAdmin: services and pricing');
    const created = await admin.post('/api/admin/services', {
      name: `Smoke service ${stamp}`, description: 'Created by the smoke test.',
      category_id: categories[0].id, price: 123.45, pricing_type: 'fixed',
    });
    check('admin can create a service', created.status === 201 && created.data.service.price_cents === 12345,
      JSON.stringify(created.data));
    const repriced = await admin.patch(`/api/admin/services/${created.data.service.id}`, { price: 200 });
    check('admin can change a price without code changes', repriced.data?.service?.price_cents === 20000);
    const deactivated = await admin.del(`/api/admin/services/${created.data.service.id}`);
    check('admin can deactivate a service', deactivated.data?.service?.active === false);
    const publicAfter = await anon.get('/api/services');
    check('deactivated service disappears from the public catalog',
      !publicAfter.data.categories.flatMap((c) => c.services).some((s) => s.id === created.data.service.id));

    console.log('\nAdmin: business settings');
    const settingsBefore = await admin.get('/api/admin/settings');
    check('admin can read business settings', settingsBefore.status === 200
      && typeof settingsBefore.data.settings.business_email === 'string');
    const badEmail = await admin.patch('/api/admin/settings', { business_email: 'not-an-email' });
    check('invalid contact email is rejected', badEmail.status === 400 && !!badEmail.data.fields?.business_email);
    const newEmail = `owner+${stamp}@atrio-smoke.test`;
    const savedSettings = await admin.patch('/api/admin/settings', { business_email: newEmail });
    check('admin can change the contact email', savedSettings.data?.settings?.business_email === newEmail);
    const publicSettings = await anon.get('/api/settings');
    check('the public site reads the new contact email', publicSettings.data?.settings?.business_email === newEmail);
    const customerSettings = await alice.patch('/api/admin/settings', { business_email: 'hijack@atrio-smoke.test' });
    check('a customer cannot change business settings', customerSettings.status === 403);
    const ignoredKey = await admin.patch('/api/admin/settings', { stripe_secret_key: 'sk_live_should_never_store' });
    check('unknown settings keys are refused', ignoredKey.status === 400);
    await admin.patch('/api/admin/settings', { business_email: settingsBefore.data.settings.business_email });

    console.log('\nAdmin: quote lifecycle');
    const quote = await admin.post('/api/admin/quotes', { request_id: requestId });
    quoteId = quote.data?.quote?.id;
    check('quote is created from the request', quote.status === 201 && quote.data.quote.items.length === 1);
    const withItem = await admin.post(`/api/admin/quotes/${quoteId}/items`, {
      description: 'Discovery call', quantity: 1, unit_price: 250,
    });
    check('admin can add a custom line item', withItem.data.quote.items.length === 2);
    const adjusted = await admin.patch(`/api/admin/quotes/${quoteId}`, {
      adjustment: -50, adjustment_label: 'Introductory discount', notes: 'Thanks for the detail.',
    });
    const expectedTotal = adjusted.data.quote.subtotal_cents - 5000;
    check('totals recalculate after an adjustment', adjusted.data.quote.total_cents === expectedTotal,
      `${adjusted.data.quote.total_cents} vs ${expectedTotal}`);

    const hiddenDraft = await alice.get(`/api/quotes/${quoteId}`);
    check('customer cannot see a draft quote', hiddenDraft.status === 404);

    const sent = await admin.post(`/api/admin/quotes/${quoteId}/send`);
    check('admin can send the quote', sent.status === 200 && sent.data.quote.status === 'sent',
      JSON.stringify(sent.data).slice(0, 160));

    console.log('\nCustomer: quote and payment');
    const seen = await alice.get(`/api/quotes/${quoteId}`);
    check('customer can view the sent quote', seen.status === 200 && seen.data.quote.items.length === 2);
    const peek = await bob.get(`/api/quotes/${quoteId}`);
    check('another customer cannot view the quote', peek.status === 404);

    const earlyPay = await alice.post('/api/payments/checkout-session', { quote_id: quoteId });
    check('payment is blocked before the quote is accepted', earlyPay.status === 400);

    const accepted = await alice.post(`/api/quotes/${quoteId}/accept`);
    check('customer can accept the quote', accepted.status === 200 && accepted.data.quote.status === 'accepted');
    const projects = await alice.get('/api/projects');
    projectId = projects.data.projects[0]?.id;
    check('accepting creates a project in payment_pending',
      projects.data.projects[0]?.status === 'payment_pending');

    const lockedEdit = await admin.patch(`/api/admin/quotes/${quoteId}`, { adjustment: -9999 });
    check('accepted quote can no longer be edited', lockedEdit.status === 409);

    const noStripe = await alice.post('/api/payments/checkout-session', { quote_id: quoteId });
    check('checkout gives a clear message when Stripe is not configured',
      noStripe.status === 503 && /payment/i.test(noStripe.data.error), JSON.stringify(noStripe.data));

    console.log('\nAdmin: projects and payments');
    const advanced = await admin.patch(`/api/admin/projects/${projectId}`, { status: 'in_progress' });
    check('admin can change project status', advanced.data?.project?.status === 'in_progress');
    const badStatus = await admin.patch(`/api/admin/projects/${projectId}`, { status: 'not_a_status' });
    check('invalid status is rejected', badStatus.status === 400);
    check('admin payments list loads', (await admin.get('/api/admin/payments')).status === 200);

    console.log('\nSessions');
    await alice.post('/api/auth/logout');
    check('logout ends the session', (await alice.get('/api/auth/me')).data.user === null);
    check('logged-out customer cannot read their quote', (await alice.get(`/api/quotes/${quoteId}`)).status === 401);
  } finally {
    await stopServer(server);
  }

  // ---- Stripe webhook verification, offline ------------------------------
  // Runs with a dummy webhook secret so signature verification and idempotency
  // can be tested without calling Stripe.
  console.log('\nStripe webhook (signature verified locally, no network calls)');
  server = await startServer({
    STRIPE_SECRET_KEY: 'sk_test_smoke_dummy',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const sessionId = `cs_test_smoke_${stamp}`;
    const { rows } = await db.query(
      `SELECT q.id AS quote_id, q.total_cents, q.user_id FROM quotes q WHERE q.id = $1`, [quoteId]
    );
    const q = rows[0];
    await db.query(
      `INSERT INTO payments (quote_id, project_id, user_id, stripe_checkout_session_id, amount_cents, currency, status)
       VALUES ($1,$2,$3,$4,$5,'usd','pending')`,
      [q.quote_id, projectId, q.user_id, sessionId, q.total_cents]
    );
    await db.query(`UPDATE projects SET status = 'payment_pending' WHERE id = $1`, [projectId]);

    const event = {
      id: `evt_smoke_${stamp}`,
      type: 'checkout.session.completed',
      data: { object: { id: sessionId, payment_status: 'paid', payment_intent: 'pi_test_smoke', customer: null, amount_total: q.total_cents, currency: 'usd' } },
    };
    const payload = JSON.stringify(event);

    const bad = await fetch(`${BASE}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
      body: payload,
    });
    check('webhook with an invalid signature is rejected', bad.status === 400);

    const send = async () => {
      const ts = Math.floor(Date.now() / 1000);
      const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${ts}.${payload}`).digest('hex');
      const res = await fetch(`${BASE}/api/webhooks/stripe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${signature}` },
        body: payload,
      });
      return { status: res.status, data: await res.json() };
    };

    const first = await send();
    check('valid webhook is accepted', first.status === 200 && first.data.received === true);
    const second = await send();
    check('duplicate webhook is ignored', second.status === 200 && second.data.duplicate === true);

    const paid = await db.query(`SELECT status FROM payments WHERE stripe_checkout_session_id = $1`, [sessionId]);
    check('payment is marked paid exactly once', paid.rows.length === 1 && paid.rows[0].status === 'paid');
    const proj = await db.query('SELECT status FROM projects WHERE id = $1', [projectId]);
    check('project advances to paid', proj.rows[0].status === 'paid');
    const stored = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'payments'`
    );
    const names = stored.rows.map((r) => r.column_name).join(',');
    check('no card data columns exist', !/card|cvv|pan|pin/i.test(names));
  } finally {
    await stopServer(server);
    // Clean up the accounts and records this test created.
    await db.query(`DELETE FROM users WHERE email LIKE '%@atrio-smoke.test'`).catch(() => {});
    await db.query(`DELETE FROM services WHERE name LIKE 'Smoke service %'`).catch(() => {});
    await db.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('\nSmoke test crashed:', err);
  process.exit(1);
});
