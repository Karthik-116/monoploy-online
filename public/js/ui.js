// Small DOM helpers shared by the client modules.

export const $ = (sel, root = document) => root.querySelector(sel);

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function money(map, n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}${map.currency}${Math.abs(n).toLocaleString()}`;
}

export function toast(message, kind = 'info', ms = 3200) {
  const box = $('#toasts');
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = message;
  box.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function show(el, visible) {
  el.classList.toggle('hidden', !visible);
}

/** Copy text; falls back to selecting an input when the Clipboard API is unavailable (plain http on LAN). */
export async function copyText(text, fallbackInput) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallbackInput) {
      fallbackInput.focus();
      fallbackInput.select();
      try {
        return document.execCommand('copy');
      } catch {
        return false;
      }
    }
    return false;
  }
}

/** Player colour comes from the active theme: --p1 … --p6. */
export const playerColor = (index) => `var(--p${(index % 6) + 1})`;
