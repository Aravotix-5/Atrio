import { api } from './api.js';
import { el } from './ui.js';
import { selection } from './store.js';

/** Builds the header and footer on every page so they stay identical. */
const LINKS = [
  { href: '/services', label: 'Services' },
  { href: '/build', label: 'Build your project' },
];

export async function mountChrome() {
  const header = document.querySelector('[data-nav]');
  if (header) header.append(buildNav());
  const footer = document.querySelector('[data-foot]');
  if (footer) footer.append(buildFoot());

  applySettings();

  // Fill in the account link once we know who is signed in.
  try {
    const { user } = await api.get('/api/auth/me');
    const slot = document.querySelector('[data-account-links]');
    if (!slot) return;
    if (user) {
      slot.append(el('a', { href: '/account', text: 'Your account' }));
      if (user.role === 'admin' || user.role === 'staff') slot.append(el('a', { href: '/admin', text: 'Admin' }));
      slot.append(el('a', {
        href: '#', text: 'Log out', class: 'nav__logout',
        onclick: async (event) => {
          event.preventDefault();
          await api.post('/api/auth/logout');
          selection.clear();
          window.location.href = '/';
        },
      }));
    } else {
      slot.append(el('a', { href: '/login', text: 'Log in' }));
    }
    document.dispatchEvent(new CustomEvent('atrio:user', { detail: user }));
  } catch {
    /* the page still works signed out */
  }
}

/**
 * Replaces the placeholder contact details with whatever is stored in
 * site_settings, so the owner can change them without editing any code.
 */
async function applySettings() {
  let settings;
  try {
    ({ settings } = await api.get('/api/settings'));
  } catch {
    return; // keep the placeholders rather than breaking the page
  }
  if (!settings) return;

  const email = settings.business_email;
  if (email) {
    document.querySelectorAll('[data-business-email]').forEach((node) => {
      node.textContent = email;
      node.setAttribute('href', `mailto:${email}`);
    });
  }

  const name = settings.business_name;
  if (name) {
    document.querySelectorAll('[data-business-name]').forEach((node) => {
      node.textContent = name;
    });
  }

  const tagline = settings.business_tagline;
  if (tagline) {
    document.querySelectorAll('[data-business-tagline]').forEach((node) => {
      node.textContent = tagline;
    });
  }

  document.dispatchEvent(new CustomEvent('atrio:settings', { detail: settings }));
}

function buildNav() {
  const path = window.location.pathname.replace(/\.html$/, '') || '/';
  const links = el('div', { class: 'nav__links', id: 'nav-links' }, [
    ...LINKS.map((link) => el('a', {
      href: link.href, text: link.label,
      'aria-current': path === link.href ? 'page' : null,
    })),
    el('span', { 'data-account-links': true, class: 'nav__links-account' }),
    el('a', { href: '/build', class: 'btn btn--primary btn--small nav__cta', text: 'Start a project' }),
  ]);

  const toggle = el('button', {
    class: 'nav__toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'nav-links',
    onclick: () => {
      const open = links.dataset.open === 'true';
      links.dataset.open = String(!open);
      toggle.setAttribute('aria-expanded', String(!open));
    },
  }, ['Menu']);

  return el('div', { class: 'wrap' }, [
    el('div', { class: 'nav__inner' }, [
      el('a', { class: 'brand', href: '/' }, [el('span', { class: 'brand__mark', text: 'A', 'aria-hidden': 'true' }), 'Atrio']),
      toggle,
    ]),
    links,
  ]);
}

function buildFoot() {
  const year = new Date().getFullYear();
  return el('div', { class: 'wrap' }, [
    el('div', { class: 'foot__grid' }, [
      el('div', {}, [
        el('a', { class: 'brand', href: '/' }, [el('span', { class: 'brand__mark', text: 'A', 'aria-hidden': 'true' }), 'Atrio']),
        el('p', { class: 'foot__note', 'data-business-tagline': true, text: 'Custom websites, web apps and software, priced by the piece.' }),
      ]),
      el('nav', { 'aria-label': 'Footer' }, [
        el('h3', { text: 'Explore' }),
        el('ul', {}, [
          el('li', {}, [el('a', { href: '/services', text: 'Services' })]),
          el('li', {}, [el('a', { href: '/build', text: 'Build your project' })]),
          el('li', {}, [el('a', { href: '/account', text: 'Your account' })]),
        ]),
      ]),
      el('div', {}, [
        el('h3', { text: 'Contact' }),
        el('ul', {}, [
          el('li', {}, [el('a', { href: 'mailto:hello@example.com', text: 'hello@example.com', 'data-business-email': true })]),
          el('li', {}, [el('a', { href: '/build', text: 'Request a quote' })]),
        ]),
      ]),
    ]),
    el('p', { class: 'foot__note', text: `© ${year} Atrio. Prices shown are estimates until confirmed in a written quote.` }),
  ]);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountChrome);
} else {
  mountChrome();
}
