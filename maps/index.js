'use strict';

/*
 * Map registry. Every .js file in ./boards is loaded automatically, so adding
 * a new board is just dropping a new file there — no engine changes needed.
 */

const fs = require('fs');
const path = require('path');
const { validateMap } = require('./validate');

const DEFAULT_MAP_ID = 'classic-london';
const dir = path.join(__dirname, 'boards');

// The single-file hosting build (scripts/build-flat.js) pre-loads the boards here,
// because a bundled server has no maps/boards folder to read.
const maps = (global.__MONOPOLY_BOARDS__ ||
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => require(path.join(dir, f)))
).slice();

for (const m of maps) {
  const errors = validateMap(m);
  if (errors.length) throw new Error(`Invalid map:\n  ${errors.join('\n  ')}`);
}

// Classic first, the rest alphabetically.
maps.sort((a, b) => (a.id === DEFAULT_MAP_ID ? -1 : b.id === DEFAULT_MAP_ID ? 1 : a.name.localeCompare(b.name)));

const byId = new Map(maps.map((m) => [m.id, m]));

const getMap = (id) => byId.get(id) || null;

/** Lightweight info for the lobby picker. */
const listMaps = () =>
  maps.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    currency: m.currency,
    colors: Object.values(m.groups).map((g) => g.color),
    sample: m.spaces.filter((s) => s.type === 'street').slice(-3).map((s) => s.name),
  }));

module.exports = { getMap, listMaps, allMaps: () => maps.slice(), DEFAULT_MAP_ID, validateMap };
