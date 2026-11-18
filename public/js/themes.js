// UI colour themes. Each id matches a [data-theme] block in css/themes.css.
export const THEMES = [
  { id: 'light', name: 'Daylight', swatch: ['#ffffff', '#3b6cff'] },
  { id: 'dark', name: 'Midnight', swatch: ['#171c2c', '#6c8cff'] },
  { id: 'neon', name: 'Neon Arcade', swatch: ['#120a24', '#ff2bd6'] },
  { id: 'retro', name: 'Retro Paper', swatch: ['#fbf3df', '#b5452b'] },
  { id: 'ocean', name: 'Deep Ocean', swatch: ['#072e42', '#21d4c3'] },
];

export function getTheme() {
  return document.documentElement.dataset.theme || 'dark';
}

export function setTheme(id) {
  if (!THEMES.some((t) => t.id === id)) return;
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem('mono.theme', id);
  } catch {
    /* storage unavailable — theme still applies for this page */
  }
}
