/**
 * Seeds the service catalog, site settings and the first admin account.
 *
 *   npm run seed
 *
 * Safe to re-run: existing rows are left alone, so prices you change in the
 * admin dashboard are never overwritten by a deploy. No fake customers,
 * projects, quotes or payments are ever created.
 */
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { pool } from './pool.js';
import { config } from '../config.js';

const CATEGORIES = [
  { slug: 'websites',    name: 'Websites',    description: 'Marketing sites, landing pages and everything that makes them work on real devices.' },
  { slug: 'web-apps',    name: 'Web apps',    description: 'Logged-in products: dashboards, accounts, carts and custom features.' },
  { slug: 'backend',     name: 'Backend',     description: 'The parts customers never see: data, accounts, APIs and file storage.' },
  { slug: 'deployment',  name: 'Deployment',  description: 'Getting the work live on a real domain, configured for production.' },
  { slug: 'payments',    name: 'Payments',    description: 'Take payments securely through Stripe.' },
  { slug: 'native-apps', name: 'Native apps', description: 'Apps installed from the App Store or Google Play. Substantially more work than a website.' },
];

// price_cents are placeholder starting points. Change them in the admin
// dashboard - no code change needed.
const SERVICES = [
  // Websites
  ['websites', 'custom-website',        'Custom website',            'A site designed and built for you, not dropped into a template.', 'starting', 120000, null, 1, 'Includes home page, basic contact details and responsive layout. Extra pages are priced separately.'],
  ['websites', 'additional-page',       'Additional page',           'One more page beyond the starting set, such as About or Pricing.', 'quantity', 15000, 'per page', 20, null],
  ['websites', 'mobile-optimization',   'Mobile optimization',       'Tune the layout and touch targets for phone-sized screens.', 'fixed', 25000, null, 1, null],
  ['websites', 'tablet-optimization',   'Tablet optimization',       'Layouts tuned for iPad and Android tablet widths.', 'fixed', 17500, null, 1, null],
  ['websites', 'desktop-optimization',  'Desktop optimization',      'Wide-screen layouts that use the extra space well.', 'fixed', 17500, null, 1, null],
  ['websites', 'responsive-design',     'Responsive design',         'One layout that adapts across phone, tablet and desktop.', 'fixed', 35000, null, 1, 'Choose this instead of the individual device options if you want the full range covered together.'],
  ['websites', 'contact-form',          'Contact form',              'A working form that delivers messages to you, with spam protection.', 'fixed', 12000, null, 1, null],
  ['websites', 'custom-design',         'Custom design',             'Original visual design: type, colour and layout built for your brand.', 'starting', 60000, null, 1, null],
  ['websites', 'animation-interactions','Animation and interactions','Motion and interactive detail, kept fast and accessible.', 'fixed', 30000, null, 1, null],

  // Web apps
  ['web-apps', 'custom-web-app',        'Custom web app',            'A web application built around your workflow rather than a page of content.', 'starting', 250000, null, 1, 'Scope varies a lot. The quote is set after we talk through what it needs to do.'],
  ['web-apps', 'progressive-web-app',   'Progressive web app (PWA)', 'Installable from the browser and works offline in limited ways. Not an App Store app.', 'fixed', 60000, null, 1, null],
  ['web-apps', 'user-accounts',         'User accounts',             'Sign up, log in and secure sessions for your users.', 'fixed', 55000, null, 1, null],
  ['web-apps', 'customer-dashboard',    'Customer dashboard',        'A logged-in area where your customers see their own records.', 'fixed', 70000, null, 1, null],
  ['web-apps', 'admin-dashboard',       'Admin dashboard',           'A private area where you manage the data behind the product.', 'fixed', 90000, null, 1, null],
  ['web-apps', 'cart-functionality',    'Shopping and cart',         'Product listings, a cart and a checkout flow.', 'fixed', 85000, null, 1, null],
  ['web-apps', 'custom-feature',        'Custom application feature','One additional feature specified by you.', 'quantity', 40000, 'per feature', 10, 'Priced per feature so you only pay for what you ask for.'],

  // Backend
  ['backend', 'database',               'Database',                  'A cloud database for your customer and application data.', 'fixed', 45000, null, 1, null],
  ['backend', 'authentication',         'Authentication',            'Secure password handling, sessions and access rules.', 'fixed', 50000, null, 1, null],
  ['backend', 'backend-api',            'Backend and API',           'Server-side logic and API routes your app talks to.', 'starting', 80000, null, 1, null],
  ['backend', 'file-storage',           'File storage',              'Upload, store and serve files such as images and documents.', 'fixed', 35000, null, 1, null],
  ['backend', 'api-integration',        'Custom API integration',    'Connect to an outside service you already use.', 'quantity', 50000, 'per integration', 6, null],
  ['backend', 'data-management',        'Data management',           'Import, export, search and clean-up tools for your data.', 'fixed', 40000, null, 1, null],

  // Deployment
  ['deployment', 'hosting-setup',       'Hosting and deployment setup','Get the application running on live hosting.', 'fixed', 25000, null, 1, 'Hosting provider fees are billed by that provider, not by Atrio.'],
  ['deployment', 'domain-setup',        'Domain setup assistance',   'Point your domain at the live application, including certificates.', 'fixed', 10000, null, 1, 'The domain registration fee is paid by you to your registrar.'],
  ['deployment', 'production-config',   'Production configuration',  'Environment variables, backups and production hardening.', 'fixed', 30000, null, 1, null],
  ['deployment', 'mobile-web-deploy',   'Mobile web deployment',     'Verify and tune the live site on real phone browsers.', 'fixed', 20000, null, 1, null],
  ['deployment', 'desktop-web-deploy',  'Desktop web deployment',    'Verify and tune the live site on desktop browsers.', 'fixed', 20000, null, 1, null],

  // Payments
  ['payments', 'stripe-integration',    'Stripe integration',        'Connect Stripe so you can take card payments.', 'fixed', 65000, null, 1, 'Stripe charges its own per-transaction fee.'],
  ['payments', 'secure-checkout',       'Secure checkout',           'A hosted checkout page. Card details go to Stripe, never to your server.', 'fixed', 40000, null, 1, null],
  ['payments', 'payment-confirmation',  'Payment confirmation',      'Confirmation screens and records once a payment succeeds.', 'fixed', 20000, null, 1, null],
  ['payments', 'payment-webhooks',      'Payment webhook integration','Server-side verification so payment status is always accurate.', 'fixed', 35000, null, 1, null],

  // Native apps
  ['native-apps', 'ios-app',            'iOS application',           'A native app installed from the Apple App Store.', 'starting', 650000, null, 1, 'A native app is a separate build from your website. Apple charges an annual developer fee.'],
  ['native-apps', 'android-app',        'Android application',       'A native app installed from Google Play.', 'starting', 650000, null, 1, 'Google charges a one-time developer registration fee.'],
  ['native-apps', 'ios-android-app',    'iOS and Android application','Native apps for both platforms.', 'starting', 1100000, null, 1, null],
  ['native-apps', 'app-store-submission','App Store submission assistance','Prepare listing assets and take the app through Apple review.', 'fixed', 45000, null, 1, null],
  ['native-apps', 'play-submission',    'Google Play submission assistance','Prepare listing assets and take the app through Google review.', 'fixed', 45000, null, 1, null],
];

const SETTINGS = [
  ['business_name', 'Atrio'],
  ['business_email', 'hello@example.com'],
  ['business_tagline', 'Custom software, built to the shape of your work.'],
  ['quote_validity_days', '30'],
  ['estimate_disclaimer', 'Totals shown here are an estimate. Your final price is confirmed in a written quote before anything is charged.'],
];

export async function runSeed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [index, cat] of CATEGORIES.entries()) {
      await client.query(
        `INSERT INTO service_categories (name, slug, description, sort_order)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (slug) DO NOTHING`,
        [cat.name, cat.slug, cat.description, (index + 1) * 10]
      );
    }

    let order = 0;
    for (const [catSlug, slug, name, description, pricingType, price, unitLabel, maxQty, details] of SERVICES) {
      order += 10;
      await client.query(
        `INSERT INTO services
           (category_id, name, slug, description, details, price_cents, pricing_type, unit_label, max_quantity, sort_order)
         VALUES ((SELECT id FROM service_categories WHERE slug = $1), $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (slug) DO NOTHING`,
        [catSlug, name, slug, description, details, price, pricingType, unitLabel, maxQty, order]
      );
    }

    for (const [key, value] of SETTINGS) {
      await client.query(
        `INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [key, value]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await seedAdmin();
  console.log('[seed] catalog ready');
}

async function seedAdmin() {
  const { email, password, name } = config.admin;
  if (!email || !password) {
    console.warn('[seed] ADMIN_EMAIL / ADMIN_PASSWORD not set - no admin account created.');
    return;
  }
  if (password.length < 10) {
    console.warn('[seed] ADMIN_PASSWORD is shorter than 10 characters - choose a stronger one.');
  }
  const existing = await pool.query('SELECT id, role FROM users WHERE lower(email) = lower($1)', [email]);
  if (existing.rows.length > 0) {
    if (existing.rows[0].role !== 'admin') {
      await pool.query('UPDATE users SET role = $1, updated_at = now() WHERE id = $2', ['admin', existing.rows[0].id]);
      console.log('[seed] existing account promoted to admin');
    } else {
      console.log('[seed] admin account already exists - password left unchanged');
    }
    return;
  }
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES (lower($1), $2, $3, 'admin')`,
    [email, hash, name]
  );
  console.log(`[seed] admin account created for ${email}`);
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isDirectRun) {
  runSeed()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[seed] failed:', err.message);
      process.exit(1);
    });
}
