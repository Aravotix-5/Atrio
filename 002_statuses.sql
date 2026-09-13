-- Status vocabulary. Edit rows here (or in the database) rather than in code.
INSERT INTO statuses (domain, key, label, description, sort_order, is_terminal) VALUES
  ('request', 'draft',             'Draft',              'Started but not submitted.',                    10, false),
  ('request', 'submitted',         'Submitted',          'Waiting for Atrio to review.',                  20, false),
  ('request', 'under_review',      'Under review',       'Atrio is scoping the work.',                    30, false),
  ('request', 'quote_sent',        'Quote sent',         'A quote is available to the customer.',         40, false),
  ('request', 'awaiting_customer', 'Awaiting customer',  'Waiting on information from the customer.',     50, false),
  ('request', 'accepted',          'Accepted',           'Quote accepted, moved to a project.',           60, true),
  ('request', 'cancelled',         'Cancelled',          'No longer moving forward.',                     70, true),

  ('quote', 'draft',    'Draft',    'Being prepared by Atrio.',            10, false),
  ('quote', 'sent',     'Sent',     'Visible to the customer.',            20, false),
  ('quote', 'accepted', 'Accepted', 'Customer accepted the quote.',        30, true),
  ('quote', 'declined', 'Declined', 'Customer asked for changes.',         40, true),
  ('quote', 'expired',  'Expired',  'Past its expiry date.',               50, true),

  ('project', 'payment_pending',     'Payment pending',     'Waiting for the deposit or payment.', 10, false),
  ('project', 'paid',                'Paid',                'Payment confirmed by Stripe.',        20, false),
  ('project', 'in_progress',         'In progress',         'Work underway.',                      30, false),
  ('project', 'waiting_for_customer','Waiting for customer','Blocked on customer input.',          40, false),
  ('project', 'completed',           'Completed',           'Delivered and closed.',               50, true),
  ('project', 'cancelled',           'Cancelled',           'Stopped before completion.',          60, true)
ON CONFLICT (domain, key) DO NOTHING;
