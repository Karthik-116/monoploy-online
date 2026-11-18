'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { allMaps, validateMap, getMap } = require('../maps');
const { setup } = require('./helpers');

test('every bundled map is valid and has at least 4 boards', () => {
  const maps = allMaps();
  assert.ok(maps.length >= 4);
  for (const m of maps) assert.deepEqual(validateMap(m), [], m.id);
});

test('validator catches broken maps', () => {
  const broken = { ...getMap('classic-london'), id: 'broken', spaces: getMap('classic-london').spaces.slice(1) };
  assert.ok(validateMap(broken).length > 0);
});

test('cards resolve targets on themed maps', () => {
  const { game, dice, p } = setup({ mapId: 'space-odyssey' });
  dice.push([3, 4]); // chance -> "Advance to <go>"
  game.act('p0', 'roll');
  assert.equal(p('p0').position, 0);
  assert.match(game.lastCard.text, /Launch/);
});
