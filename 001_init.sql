-- Atrio initial schema.
-- All money is stored as integer cents to avoid floating point errors.

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,
  name          TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'customer'
                CHECK (role IN ('customer', 'staff', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email));

-- Session store for connect-pg-simple.
CREATE TABLE IF NOT EXISTS user_sessions (
  sid    VARCHAR      NOT NULL COLLATE "default" PRIMARY KEY,
  sess   JSON         NOT NULL,
  expire TIMESTAMPTZ  NOT NULL
);
CREATE INDEX IF NOT EXISTS user_sessions_expire_idx ON user_sessions (expire);

-- Centralised, database-driven status lists so they can change without a deploy.
CREATE TABLE IF NOT EXISTS statuses (
  id          BIGSERIAL PRIMARY KEY,
  domain      TEXT    NOT NULL CHECK (domain IN ('request', 'quote', 'project')),
  key         TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_terminal BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (domain, key)
);

CREATE TABLE IF NOT EXISTS service_categories (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL UNIQUE,
  description TEXT,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS services (
  id           BIGSERIAL PRIMARY KEY,
  category_id  BIGINT      NOT NULL REFERENCES service_categories (id) ON DELETE RESTRICT,
  name         TEXT        NOT NULL,
  slug         TEXT        NOT NULL UNIQUE,
  description  TEXT        NOT NULL DEFAULT '',
  details      TEXT,
  price_cents  INTEGER     NOT NULL CHECK (price_cents >= 0),
  pricing_type TEXT        NOT NULL DEFAULT 'fixed'
               CHECK (pricing_type IN ('fixed', 'starting', 'quantity')),
  unit_label   TEXT,
  max_quantity INTEGER     NOT NULL DEFAULT 1 CHECK (max_quantity >= 1),
  active       BOOLEAN     NOT NULL DEFAULT true,
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS services_category_idx ON services (category_id);
CREATE INDEX IF NOT EXISTS services_active_idx ON services (active);

CREATE TABLE IF NOT EXISTS project_requests (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  contact_name          TEXT        NOT NULL,
  contact_email         TEXT        NOT NULL,
  title                 TEXT        NOT NULL,
  description           TEXT        NOT NULL DEFAULT '',
  timeline              TEXT,
  budget_range          TEXT,
  reference_url         TEXT,
  status                TEXT        NOT NULL DEFAULT 'submitted',
  estimate_total_cents  INTEGER     NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_requests_user_idx  ON project_requests (user_id);
CREATE INDEX IF NOT EXISTS project_requests_email_idx ON project_requests (lower(contact_email));
CREATE INDEX IF NOT EXISTS project_requests_status_idx ON project_requests (status);

CREATE TABLE IF NOT EXISTS project_request_items (
  id               BIGSERIAL PRIMARY KEY,
  request_id       BIGINT      NOT NULL REFERENCES project_requests (id) ON DELETE CASCADE,
  service_id       BIGINT      REFERENCES services (id) ON DELETE SET NULL,
  name_snapshot    TEXT        NOT NULL,
  pricing_type     TEXT        NOT NULL DEFAULT 'fixed',
  quantity         INTEGER     NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  unit_price_cents INTEGER     NOT NULL CHECK (unit_price_cents >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_request_items_request_idx ON project_request_items (request_id);

CREATE TABLE IF NOT EXISTS quotes (
  id                BIGSERIAL PRIMARY KEY,
  request_id        BIGINT      NOT NULL REFERENCES project_requests (id) ON DELETE CASCADE,
  user_id           BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  status            TEXT        NOT NULL DEFAULT 'draft',
  subtotal_cents    INTEGER     NOT NULL DEFAULT 0,
  adjustment_cents  INTEGER     NOT NULL DEFAULT 0,
  adjustment_label  TEXT,
  total_cents       INTEGER     NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  currency          TEXT        NOT NULL DEFAULT 'usd',
  notes             TEXT,
  expires_at        TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  accepted_at       TIMESTAMPTZ,
  declined_at       TIMESTAMPTZ,
  decline_reason    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quotes_request_idx ON quotes (request_id);
CREATE INDEX IF NOT EXISTS quotes_user_idx    ON quotes (user_id);
CREATE INDEX IF NOT EXISTS quotes_status_idx  ON quotes (status);

CREATE TABLE IF NOT EXISTS quote_items (
  id               BIGSERIAL PRIMARY KEY,
  quote_id         BIGINT      NOT NULL REFERENCES quotes (id) ON DELETE CASCADE,
  service_id       BIGINT      REFERENCES services (id) ON DELETE SET NULL,
  description      TEXT        NOT NULL,
  quantity         INTEGER     NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  unit_price_cents INTEGER     NOT NULL CHECK (unit_price_cents >= 0),
  sort_order       INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quote_items_quote_idx ON quote_items (quote_id);

CREATE TABLE IF NOT EXISTS projects (
  id         BIGSERIAL PRIMARY KEY,
  quote_id   BIGINT      NOT NULL UNIQUE REFERENCES quotes (id) ON DELETE RESTRICT,
  request_id BIGINT      NOT NULL REFERENCES project_requests (id) ON DELETE RESTRICT,
  user_id    BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  title      TEXT        NOT NULL,
  status     TEXT        NOT NULL DEFAULT 'payment_pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_user_idx   ON projects (user_id);
CREATE INDEX IF NOT EXISTS projects_status_idx ON projects (status);

-- Payments: business records only. No card data is ever stored here.
CREATE TABLE IF NOT EXISTS payments (
  id                          BIGSERIAL PRIMARY KEY,
  quote_id                    BIGINT      NOT NULL REFERENCES quotes (id) ON DELETE RESTRICT,
  project_id                  BIGINT      REFERENCES projects (id) ON DELETE SET NULL,
  user_id                     BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  stripe_checkout_session_id  TEXT        UNIQUE,
  stripe_payment_intent_id    TEXT,
  stripe_customer_id          TEXT,
  amount_cents                INTEGER     NOT NULL CHECK (amount_cents >= 0),
  currency                    TEXT        NOT NULL DEFAULT 'usd',
  status                      TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
  paid_at                     TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_quote_idx  ON payments (quote_id);
CREATE INDEX IF NOT EXISTS payments_user_idx   ON payments (user_id);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status);

-- Notes attached to a request or project. `internal` notes are never sent to customers.
CREATE TABLE IF NOT EXISTS notes (
  id          BIGSERIAL PRIMARY KEY,
  entity_type TEXT        NOT NULL CHECK (entity_type IN ('request', 'project', 'quote')),
  entity_id   BIGINT      NOT NULL,
  author_id   BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  body        TEXT        NOT NULL,
  internal    BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_entity_idx ON notes (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT        PRIMARY KEY,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Makes webhook processing idempotent: the same Stripe event can arrive twice.
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id     TEXT        PRIMARY KEY,
  type         TEXT        NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
