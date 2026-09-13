# Atrio

A working software-business platform: a public website, a database-driven
service catalog, a project builder that prices a selection as you go, customer
accounts, an admin dashboard, a quote system, and Stripe checkout with verified
webhooks.

Nothing here is a mock. The database is real PostgreSQL, the authentication is
real, and payments run through Stripe's hosted checkout.

---

## Contents

1. [What it does](#what-it-does)
2. [How the money flow works](#how-the-money-flow-works)
3. [Running it on your own computer](#running-it-on-your-own-computer)
4. [Putting it on GitHub](#putting-it-on-github)
5. [Deploying to Render](#deploying-to-render)
6. [Setting up the database](#setting-up-the-database)
7. [Setting up Stripe](#setting-up-stripe)
8. [Environment variables](#environment-variables)
9. [Security rules this project follows](#security-rules-this-project-follows)
10. [Free tier: what is actually free](#free-tier-what-is-actually-free)
11. [Project layout](#project-layout)
12. [Testing](#testing)
13. [Changing things later](#changing-things-later)
14. [What I need to do after Claude finishes](#what-i-need-to-do-after-claude-finishes)

---

## What it does

**For visitors**

- Browse services grouped into categories, each with its own price.
- Build a project by selecting only the pieces they want, with quantities where
  it makes sense (extra pages, extra integrations).
- Watch a running estimate. Selecting things never charges anyone.
- Send a project request, with or without an account.

**For customers with an account**

- See their requests, quotes, projects and payment history.
- Read a finalised quote, accept it or ask for changes.
- Pay through Stripe once a quote is accepted.

**For you (admin)**

- Review requests, add internal notes, change status.
- Build a quote from a request: adjust lines, add custom lines, apply a
  discount, set an expiry, then send it.
- Create, edit, reprice, reorder, hide and unhide services without touching code.
- Track projects, payments and customers.

**Deliberately not built yet:** email notifications, file uploads, invoices,
subscriptions, staff accounts beyond the `staff` role, native mobile builds.
The database and routes are laid out so these can be added without a rewrite.

---

## How the money flow works

```
customer builds a project
        ↓
submits a request                    ← estimate only, no charge
        ↓
you review it in the admin dashboard
        ↓
you create and finalise a quote      ← you control the real price
        ↓
customer accepts the quote           ← a project is created
        ↓
customer pays on Stripe's page       ← card details never touch this app
        ↓
Stripe sends a signed webhook
        ↓
the app verifies the signature and marks the payment paid
        ↓
project moves to Paid
```

Two rules are enforced in code:

1. **The browser cannot set a price.** Every total is recalculated on the server
   from the `services` and `quote_items` tables. Editing JavaScript in devtools
   changes nothing that matters.
2. **Visiting the success page is not proof of payment.** A payment is marked
   paid only from a Stripe-signed webhook, or from a server-side lookup of the
   session with Stripe's API. Both run the same idempotent update.

---

## Running it on your own computer

You need [Node.js](https://nodejs.org) 20 or newer and a PostgreSQL database.
The easiest free database is [Supabase](https://supabase.com) - you can point
your local copy at it, so you do not have to install PostgreSQL.

1. Download or clone this project, then open a terminal in its folder.

2. Install the dependencies:

   ```bash
   npm install
   ```

3. Copy the example settings file and fill it in:

   ```bash
   cp .env.example .env
   ```

   Open `.env` in a text editor. At minimum set `DATABASE_URL`,
   `SESSION_SECRET`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`. To generate a session
   secret:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

4. Create the tables and load the service catalog:

   ```bash
   npm run setup
   ```

5. Start it:

   ```bash
   npm start
   ```

6. Open <http://localhost:3000>. Log in at `/login` with the admin email and
   password from your `.env` to reach `/admin`.

Payments are switched off until you add Stripe keys. Everything else works, and
the pay button explains that payments are not set up yet.

---

## Putting it on GitHub

GitHub stores the **code**. It does not run the app, and it must never hold
your secrets.

1. Create a new repository at <https://github.com/new>. Keep it private if you
   prefer. Do not let GitHub add a README or `.gitignore` - this project has both.
2. On your computer, in the project folder:

   ```bash
   git init
   git add .
   git commit -m "Atrio: first version"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
   git push -u origin main
   ```

3. Check on github.com that **`.env` is not there**. The included `.gitignore`
   excludes it. If you ever see it listed, remove it immediately and change
   every secret it contained.

---

## Deploying to Render

Render runs the actual application.

1. Sign up at <https://render.com> and connect your GitHub account.
2. Click **New → Web Service** and pick your repository.
3. Fill in:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm run migrate && npm run seed && npm start`
   - **Instance type:** Free
4. Open the **Environment** section and add the variables listed in
   [Environment variables](#environment-variables). Render's environment
   variables are the correct place for every secret.
5. Click **Create Web Service** and wait for the first deploy.
6. Render gives you a URL like `https://atrio.onrender.com`. Copy it, then set
   `APP_URL` to exactly that URL (no trailing slash) and redeploy. Stripe return
   links use it.
7. Visit the URL, then `/login`, and sign in with your `ADMIN_EMAIL` and
   `ADMIN_PASSWORD`.

`render.yaml` is included if you prefer Render's Blueprint flow
(**New → Blueprint**). It contains no secrets - you still type those into the
dashboard.

The start command runs migrations and the seed on every deploy. Both are safe to
re-run: applied migrations are skipped, and the seed never overwrites prices you
have edited or creates fake customers.

---

## Setting up the database

Any PostgreSQL database works. Two good free options:

**Supabase** (recommended, database only)

1. Create a project at <https://supabase.com>.
2. Go to **Project Settings → Database → Connection string → URI**.
3. Copy it, replace `[YOUR-PASSWORD]` with your database password, and use it as
   `DATABASE_URL`. Prefer the connection-pooler string (port 6543) for hosting
   platforms.
4. Set `DATABASE_SSL=true`.

**Render PostgreSQL**

1. **New → PostgreSQL**, free instance.
2. Copy the **Internal Database URL** into `DATABASE_URL`, set `DATABASE_SSL=true`.
3. Note Render's free database expires after a set period - check their current
   terms before relying on it.

Schema changes live in `src/db/migrations/` as numbered `.sql` files. To add
one, create `003_your_change.sql` and deploy; `npm run migrate` applies anything
new, once, inside a transaction. You never edit tables by hand.

---

## Setting up Stripe

The app runs fine without Stripe. Add it when you are ready to take money.

1. Create an account at <https://stripe.com>.
2. Leave the dashboard in **Test mode** (the toggle at the top).
3. Go to **Developers → API keys**:
   - Copy the **Secret key** (`sk_test_...`) into `STRIPE_SECRET_KEY`.
   - You do not need the publishable key. This app uses Stripe's hosted checkout
     page, so no Stripe code runs in the browser.
4. Go to **Developers → Webhooks → Add endpoint**:
   - **URL:** `https://YOUR-RENDER-URL/api/webhooks/stripe`
   - **Events:** `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`
   - After creating it, click **Reveal** under *Signing secret* and copy the
     `whsec_...` value into `STRIPE_WEBHOOK_SECRET`.
5. Redeploy so the new variables load.
6. Test the whole path: accept a quote as a customer, pay with Stripe's test
   card `4242 4242 4242 4242`, any future expiry, any CVC. The payment should
   show as paid in `/admin` within a few seconds.

**Going live later:** switch the dashboard to live mode, create a new endpoint
and new keys, and replace both values in Render. Do not mix test and live keys.

**If Stripe will not let you open an account** - for instance because you are
under 18, or you do not have a business entity yet - stop at this step. Stripe
requires an account holder who can legally accept payments; an adult or the
business owner must open it. Everything else in Atrio works without it, and the
pay button tells customers to contact you to arrange payment. Do not try to work
around the requirement, and never take card details by email or text instead.

---

## Environment variables

Set these in Render (or in `.env` locally). Never in the code, never in GitHub.

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. Contains a password - keep it secret. |
| `DATABASE_SSL` | yes on hosting | `true` for Supabase/Render/Neon, `false` for a local database. |
| `SESSION_SECRET` | yes | Long random string that signs login cookies. Changing it logs everyone out. |
| `APP_URL` | yes in production | Your live URL, no trailing slash. Used for Stripe return links. |
| `NODE_ENV` | yes in production | `production` on Render. Turns on secure cookies. |
| `PORT` | no | Render sets this automatically. |
| `ADMIN_EMAIL` | yes | Email of the first admin account, created by the seed. |
| `ADMIN_PASSWORD` | yes | Password for that account. Use something long. Change it after first login. |
| `ADMIN_NAME` | no | Display name for the admin account. |
| `STRIPE_SECRET_KEY` | for payments | `sk_test_...` while testing. |
| `STRIPE_WEBHOOK_SECRET` | for payments | `whsec_...` from your webhook endpoint. |

`.env.example` lists the same names with placeholder values and is safe to commit.

---

## Security rules this project follows

**Secrets** live only in environment variables. `.env` is git-ignored, and
nothing secret is sent to the browser. The only configuration the frontend can
read is whether payments are switched on.

**Passwords** are hashed with bcrypt (cost 12). Plaintext passwords are never
stored or logged. Login compares a hash even when the email does not exist, so
response timing does not reveal which accounts are real.

**Sessions** are stored in PostgreSQL, not in a cookie. The cookie is
`HttpOnly`, `SameSite=Lax`, and `Secure` in production. The session id is
regenerated on login and signup.

**Authorisation** is checked on the server for every protected request. Hiding a
button in the browser is never the control. Admin routes re-read the user's role
from the database on each request, so a demoted account loses access at once.
Customer routes filter by `user_id`, so one customer cannot load another's
request, quote, project or payment - they get the same "not found" either way.

**SQL injection** is prevented by parameterised queries throughout. No query is
built by concatenating user input.

**XSS** is prevented by building the DOM with `textContent` rather than
`innerHTML`, and by a Content-Security-Policy that forbids inline scripts and
inline styles.

**CSRF** is blocked by a per-session token required on every state-changing
request, plus `SameSite=Lax` cookies.

**Payments**: this app never sees a card number, CVV, PIN or bank login. Stripe
hosts the payment page. The database stores the amount, the currency, the status
and Stripe's reference ids - nothing else. Checkout amounts are read from the
database, never from the request body. Webhook signatures are verified, and
processing is idempotent, so a replayed event cannot create a second payment.

**Errors** show a plain sentence to the user. Stack traces, SQL and
configuration stay in the server logs, and passwords and secrets are never logged.

**Rate limiting** applies to the whole API, with tighter limits on login, signup
and request submission.

---

## Free tier: what is actually free

| Piece | Free? | The catch |
|---|---|---|
| Render web service | Free plan available | Free instances sleep when idle, so the first visit after a quiet spell takes a few seconds to wake. |
| Supabase database | Free plan available | Storage and connection limits; projects can be paused after long inactivity. |
| Render PostgreSQL | Free plan available | Free databases expire after a period set by Render. |
| Stripe | No monthly fee | Stripe takes a percentage plus a fixed amount per successful payment. Test mode is free. |
| GitHub | Free | Private repositories are included. |
| A domain name | **Not free** | Roughly $10-15 a year from a registrar. Render gives you a free `onrender.com` subdomain. |
| Email sending | Not built yet | Adding notification email later will mean a provider with its own free tier and limits. |

Providers change their terms, so check the current pricing pages before
committing. Nothing in the code requires a paid plan to run.

---

## Project layout

```
atrio/
├── src/
│   ├── server.js               starts the HTTP server
│   ├── app.js                  express setup, security headers, route mounting
│   ├── config.js               reads and validates environment variables
│   ├── db/
│   │   ├── pool.js             PostgreSQL connection pool and query helpers
│   │   ├── migrate.js          applies migrations once each, in order
│   │   ├── seed.js             service catalog, settings, first admin
│   │   └── migrations/         numbered .sql schema files
│   ├── middleware/
│   │   ├── session.js          PostgreSQL-backed sessions
│   │   ├── auth.js             attachUser, requireAuth, requireAdmin
│   │   ├── csrf.js             per-session CSRF token
│   │   └── errors.js           central error handling
│   ├── routes/
│   │   ├── auth.routes.js      signup, login, logout, password change
│   │   ├── public.routes.js    catalog, estimate, statuses, settings
│   │   ├── requests.routes.js  project requests
│   │   ├── quotes.routes.js    customer quote view, accept, decline
│   │   ├── projects.routes.js  customer projects
│   │   ├── payments.routes.js  Stripe checkout session, payment status
│   │   ├── webhooks.routes.js  Stripe webhook, signature verified
│   │   └── admin.routes.js     everything behind the admin dashboard
│   ├── services/
│   │   ├── catalog.js          reads services and categories
│   │   ├── pricing.js          authoritative price calculation
│   │   ├── quotes.js           quote totals and loading
│   │   ├── payments.js         idempotent "mark this paid"
│   │   ├── statuses.js         database-driven status lists
│   │   └── stripe.js           Stripe client, or a clear error if unconfigured
│   └── utils/                  errors, validation, money, slugs, logging
├── public/
│   ├── index.html              home
│   ├── services.html           full catalog
│   ├── build.html              project builder and request form
│   ├── login.html / signup.html
│   ├── account.html            customer dashboard
│   ├── checkout-complete.html  Stripe return page
│   ├── admin.html              admin dashboard
│   ├── 404.html
│   ├── css/atrio.css           the whole design system
│   ├── js/                     one module per page, plus shared helpers
│   └── images/favicon.svg      placeholder mark
├── tests/smoke.mjs             end-to-end test of the main flows
├── .env.example                variable names only
├── .gitignore
├── render.yaml
└── package.json
```

---

## Testing

```bash
npm run test:smoke
```

This boots the real server against the database in your `.env` and walks the
main paths: catalog loading, estimates, signup and login, request submission,
quote creation and sending, acceptance, project creation, and the Stripe webhook
(signature verification and duplicate handling, with no network calls). It also
checks the security rules: a customer cannot read another customer's records, a
customer cannot reach admin routes, a browser-supplied price is ignored, and a
request without a CSRF token is refused.

It creates accounts ending in `@atrio-smoke.test` and deletes them afterwards.
**Run it against a development database, never production.**

---

## Changing things later

- **Prices and services:** admin dashboard → Services. No deploy needed.
- **Status names:** the `statuses` table. Add a row or change a label.
- **Site name, contact email, tagline, disclaimer text:** the **Settings** tab
  in the admin dashboard. No code or database editing needed.
- **New database tables:** add `src/db/migrations/003_*.sql` and deploy.
- **New pages:** add an HTML file in `public/` and a module in `public/js/`.
  `/about` automatically serves `public/about.html`.

Colour, type and spacing all come from the CSS custom properties at the top of
`public/css/atrio.css`. Changing `--pine` re-themes the whole site.

---

## What I need to do after Claude finishes

Only these steps need a human with accounts and passwords.

1. **Create a GitHub repository** and push the code
   ([instructions](#putting-it-on-github)). Confirm `.env` is not in it.
2. **Create a PostgreSQL database** (Supabase free tier is the simplest) and
   copy the connection string.
3. **Create the Render web service**, connect the repository, set the build
   command to `npm install` and the start command to
   `npm run migrate && npm run seed && npm start`.
4. **Add the environment variables in Render**: `DATABASE_URL`, `DATABASE_SSL`,
   `SESSION_SECRET`, `APP_URL`, `NODE_ENV`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
   Generate the session secret with the command in step 3 of
   [Running it locally](#running-it-on-your-own-computer).
5. **Deploy, then set `APP_URL`** to the live Render URL and redeploy.
6. **Log in at `/login`** with your admin email and password, and check `/admin`
   loads.
7. **Create a Stripe account in test mode**, add `STRIPE_SECRET_KEY`, create the
   webhook endpoint at `https://YOUR-URL/api/webhooks/stripe`, and add
   `STRIPE_WEBHOOK_SECRET`. If you cannot open a Stripe account yet, skip this -
   everything else still works.
8. **Run one test payment** end to end with card `4242 4242 4242 4242`.
9. **Review the seeded prices** in the admin dashboard and change them to your
   real numbers.
10. **Replace the placeholders**: the portfolio slots on the home page, the
    contact email under **Admin → Settings**, and `public/images/favicon.svg`.
11. **Optional:** buy a domain and point it at Render (**Settings → Custom
    Domains**).

Before you take real money, switch Stripe to live mode and swap both Stripe
values for their live equivalents.
