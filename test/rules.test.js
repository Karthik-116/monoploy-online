'use strict';

// Gameplay rule switches the host can toggle in the lobby.

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

const OLD_KENT = 1;
const WHITECHAPEL = 3;
const MAYFAIR = 39;

test('x2 rent on full sets can be turned off', () => {
  const { game, own } = setup({ settings: { doubleRentOnSet: false } });
  own('p1', OLD_KENT, WHITECHAPEL);
  assert.equal(game.rentFor(OLD_KENT), 2);
});

test('auction off: declining just passes the property', () => {
  const { game, dice } = setup({ settings: { auction: false } });
  dice.push([1, 2]);
  game.act('p0', 'roll');
  game.act('p0', 'auction');
  assert.equal(game.auction, null);
  assert.equal(game.properties[WHITECHAPEL].owner, null);
  assert.equal(game.turn.phase, 'end');
});

test('no rent is collected from owners in jail when the rule is on', () => {
  const { game, dice, p, own } = setup({ settings: { noRentInJail: true } });
  own('p1', WHITECHAPEL);
  p('p1').inJail = true;
  dice.push([1, 2]);
  game.act('p0', 'roll');
  assert.equal(p('p0').cash, 1500);
});

test('owners in jail still collect rent by default', () => {
  const { game, dice, p, own } = setup();
  own('p1', WHITECHAPEL);
  p('p1').inJail = true;
  dice.push([1, 2]);
  game.act('p0', 'roll');
  assert.equal(p('p0').cash, 1496);
});

test('vacation cash: bank payments fill a pot that Free Parking pays out', () => {
  const { game, dice, p } = setup({ settings: { vacationCash: true } });
  dice.push([2, 2]); // -> 4 Income Tax £200 (doubles: roll again)
  game.act('p0', 'roll');
  assert.equal(game.pot, 200);
  p('p0').position = 16;
  dice.push([1, 3]); // -> 20 Free Parking
  game.act('p0', 'roll');
  assert.equal(game.pot, 0);
  assert.equal(p('p0').cash, 1500);
});

test('mortgages can be turned off', () => {
  const { game, own } = setup({ settings: { mortgage: false } });
  own('p0', MAYFAIR);
  assert.throws(() => game.act('p0', 'mortgage', { space: MAYFAIR }), /turned off/);
});

test('even build can be turned off', () => {
  const { game, own } = setup({ settings: { evenBuild: false } });
  own('p0', OLD_KENT, WHITECHAPEL);
  game.act('p0', 'build', { space: OLD_KENT });
  game.act('p0', 'build', { space: OLD_KENT });
  assert.equal(game.properties[OLD_KENT].houses, 2);
});

test('rule switches must be booleans', () => {
  const { Game } = require('../engine/game');
  const { getMap } = require('../maps');
  const g = new Game({ map: getMap('classic-london') });
  g.addPlayer({ id: 'a' });
  assert.throws(() => g.updateSettings('a', { auction: 'yes' }), /on or off/);
  g.updateSettings('a', { auction: false, randomizeOrder: true });
  assert.equal(g.settings.auction, false);
});

test('sell a property back to the bank for half price', () => {
  const { game, p, own } = setup();
  own('p0', MAYFAIR);
  game.act('p0', 'sellProperty', { space: MAYFAIR });
  assert.equal(game.properties[MAYFAIR].owner, null);
  assert.equal(p('p0').cash, 1700);
  assert.throws(() => game.act('p0', 'sellProperty', { space: MAYFAIR }), /don't own/);
});

test('cannot sell a property with buildings in its set, mortgaged, or out of turn', () => {
  const { game, own } = setup();
  own('p0', OLD_KENT, WHITECHAPEL);
  game.properties[WHITECHAPEL].houses = 1;
  assert.throws(() => game.act('p0', 'sellProperty', { space: OLD_KENT }), /buildings/);
  game.properties[WHITECHAPEL].houses = 0;
  game.properties[OLD_KENT].mortgaged = true;
  assert.throws(() => game.act('p0', 'sellProperty', { space: OLD_KENT }), /Unmortgage/);
  own('p1', MAYFAIR);
  assert.throws(() => game.act('p1', 'sellProperty', { space: MAYFAIR }), /your turn/);
});

test('selling a property can clear a debt', () => {
  const { game, dice, p, own } = setup();
  own('p1', WHITECHAPEL);
  own('p0', MAYFAIR);
  p('p0').cash = 1;
  dice.push([1, 2]);
  game.act('p0', 'roll');
  assert.ok(p('p0').cash < 0);
  game.act('p0', 'sellProperty', { space: MAYFAIR });
  assert.equal(p('p0').cash, 197);
  game.act('p0', 'endTurn');
});
