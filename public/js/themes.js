// UI colour themes. Each id matches a [data-theme] block in css/themes.css.
import { storage } from './ui.js';

export const THEMES = [
  { id: 'night', name: 'Night', swatch: ['#262046', '#8d7bff'] },
  { id: 'daylight', name: 'Daylight', swatch: ['#ffffff', '#5a55ef'] },
  { id: 'neon', name: 'Neon arcade', swatch: ['#120a22', '#ff2bd6'] },
  { id: 'retro', name: 'Retro paper', swatch: ['#fbf3df', '#b5452b'] },
  { id: 'ocean', name: 'Deep ocean', swatch: ['#072e42', '#21d4c3'] },
];

export const getTheme = () => document.documentElement.dataset.theme || 'night';

export function setTheme(id) {
  if (!THEMES.some((t) => t.id === id)) return;
  document.documentElement.dataset.theme = id;
  storage.set('mono.theme', id);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
}
