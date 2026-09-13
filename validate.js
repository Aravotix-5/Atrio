import { badRequest } from './errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Collects field errors so the form can show all of them at once. */
export class FieldErrors {
  constructor() {
    this.errors = {};
  }
  add(field, message) {
    if (!this.errors[field]) this.errors[field] = message;
    return this;
  }
  get hasErrors() {
    return Object.keys(this.errors).length > 0;
  }
  throwIfAny(message = 'Please check the highlighted fields.') {
    if (this.hasErrors) throw badRequest(message, this.errors);
  }
}

export function str(value, { field, min = 0, max = 5000, required = false, errors }) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    if (required) errors?.add(field, 'This is required.');
    return '';
  }
  if (raw.length < min) errors?.add(field, `Use at least ${min} characters.`);
  if (raw.length > max) errors?.add(field, `Keep this under ${max} characters.`);
  return raw.slice(0, max);
}

export function email(value, { field = 'email', errors, required = true } = {}) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) {
    if (required) errors?.add(field, 'Enter your email address.');
    return '';
  }
  if (!EMAIL_RE.test(raw) || raw.length > 255) errors?.add(field, 'Enter a valid email address.');
  return raw;
}

export function url(value, { field = 'reference_url', errors } = {}) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
    return parsed.toString().slice(0, 500);
  } catch {
    errors?.add(field, 'Enter a full link starting with https://');
    return '';
  }
}

export function intIn(value, { field, min, max, fallback, errors }) {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num)) {
    if (fallback !== undefined) return fallback;
    errors?.add(field, 'Enter a whole number.');
    return min ?? 0;
  }
  if (num < min || num > max) {
    errors?.add(field, `Enter a number between ${min} and ${max}.`);
    return Math.min(Math.max(num, min), max);
  }
  return num;
}

/** Money entered by an admin as dollars -> integer cents. */
export function dollarsToCents(value, { field, errors, allowNegative = false } = {}) {
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) {
    errors?.add(field, 'Enter an amount, for example 1200 or 1200.50');
    return 0;
  }
  if (!allowNegative && num < 0) {
    errors?.add(field, 'Amount cannot be negative.');
    return 0;
  }
  return Math.round(num * 100);
}

export function id(value, { field = 'id' } = {}) {
  const num = Number.parseInt(value, 10);
  if (!Number.isInteger(num) || num <= 0) throw badRequest(`Invalid ${field}.`);
  return num;
}
