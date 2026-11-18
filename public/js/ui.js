// Small DOM helpers shared by the client modules.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function money(map, n) {
  const sign = n < 0 ? '−' : '';
  return `${sign}${map.currency}${Math.abs(n).toLocaleString('en-US')}`;
}

export function toast(message, kind = 'info', ms = 3200) {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = message;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function show(el, visible) {
  el.classList.toggle('hidden', !visible);
}

/** CSS colour for an appearance id (each theme defines --t-<id>). */
export const tokenColor = (id) => `var(--t-${id || 'blue'})`;

/** Blob avatar with eyes. */
export function avatar(id, extraClass = '') {
  return `<span class="avatar ${extraClass}" style="--c:${tokenColor(id)}"></span>`;
}

/** Copy text; falls back to selecting an input when the Clipboard API is unavailable (plain http). */
export async function copyText(text, fallbackInput) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!fallbackInput) return false;
    fallbackInput.focus();
    fallbackInput.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const storage = {
  get(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch { /* storage unavailable */ }
  },
};
