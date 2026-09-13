/** Integer cents -> "$1,200.00". Used for emails/logs; the UI formats its own. */
export function formatCents(cents, currency = 'usd') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format((cents || 0) / 100);
}
