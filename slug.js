export function slugify(value, fallback = 'item') {
  const slug = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

/** Appends -2, -3 ... until the slug is free. */
export async function uniqueSlug(base, exists) {
  let candidate = base;
  let n = 1;
  while (await exists(candidate)) {
    n += 1;
    candidate = `${base}-${n}`.slice(0, 90);
  }
  return candidate;
}
