'use strict';

// Flexible trades between players, and rule switches during a game.

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

const OLD_KENT = 1;
const WHITECHAPEL = 3;
const MAYFAIR = 39;

test('trade money and properties both ways, at any time', () => {
  const { game, p, own } = setup();
  own('p0', OLD_KENT);
  own('p1', MAYFAIR);
  game.properties[MAYFAIR].houses = 2;
  // p1 proposes even though it's p0's turn
  const t = game.act('p1', 'tradePropose', { to: 'p0', give: { properties: [MAYFAIR] }, get: { cash: 300, properties: [OLD_KENT] } });
  assert.equal(game.trades.length, 1);
  game.act('p0', 'tradeAccept', { id: game.trades[0].id });
  assert.equal(game.properties[MAYFAIR].owner, 'p0');
  assert.equal(game.properties[MAYFAIR].houses, 2, 'buildings go with the property');
  assert.equal(game.properties[OLD_KENT].owner, 'p1');
  assert.equal(p('p0').cash, 1200);
  assert.equal(p('p1').cash, 1800);
  assert.equal(game.trades.length, 0);
  assert.equal(t, undefined); // act() returns nothing; the trade lives in game.trades
});

test('gifts, jail cards and mortgaged properties can all be traded', () => {
  const { game, p, own } = setup();
  own('p0', WHITECHAPEL);
  game.properties[WHITECHAPEL].mortgaged = true;
  p('p0').jailCards.push({ deck: 'chance', card: { action: 'jailCard', text: 'x' } });
  game.act('p0', 'tradePropose', { to: 'p1', give: { cash: 50, properties: [WHITECHAPEL], jailCards: 1 } });
  game.act('p1', 'tradeAccept', { id: game.trades[0].id });
  assert.equal(game.properties[WHITECHAPEL].owner, 'p1');
  assert.equal(game.properties[WHITECHAPEL].mortgaged, true);
  assert.equal(p('p1').jailCards.length, 1);
  assert.equal(p('p1').cash, 1550);
});

test('only the receiver accepts or declines; only the sender cancels', () => {
  const { game, own } = setup({ players: 3 });
  own('p0', OLD_KENT);
  game.act('p0', 'tradePropose', { to: 'p1', give: { properties: [OLD_KENT] }, get: { cash: 10 } });
  const id = game.trades[0].id;
  assert.throws(() => game.act('p2', 'tradeAccept', { id }), /Only the player/);
  assert.throws(() => game.act('p0', 'tradeAccept', { id }), /Only the player/);
  assert.throws(() => game.act('p1', 'tradeCancel', { id }), /Only the player who sent/);
  game.act('p1', 'tradeDecline', { id });
  assert.equal(game.trades.length, 0);
  game.act('p0', 'tradePropose', { to: 'p1', give: { cash: 5 } });
  game.act('p0', 'tradeCancel', { id: game.trades[0].id });
  assert.equal(game.trades.length, 0);
});

test('offers must be possible: owned properties, enough cash, something offered', () => {
  const { game, p, own } = setup();
  own('p1', MAYFAIR);
  assert.throws(() => game.act('p0', 'tradePropose', { to: 'p1', give: { properties: [MAYFAIR] } }), /no longer owns/);
  assert.throws(() => game.act('p0', 'tradePropose', { to: 'p1', give: { cash: 99999 } }), /doesn't have/);
  assert.throws(() => game.act('p0', 'tradePropose', { to: 'p1' }), /Add money/);
  assert.throws(() => game.act('p0', 'tradePropose', { to: 'p0', give: { cash: 1 } }), /another player/);
  // things change before acceptance -> the trade is dropped
  game.act('p0', 'tradePropose', { to: 'p1', give: { cash: 1000 }, get: { properties: [MAYFAIR] } });
  p('p0').cash = 10;
  assert.throws(() => game.act('p1', 'tradeAccept', { id: game.trades[0].id }), /can't go through/);
  assert.equal(game.trades.length, 0);
});

test('the host can flip rule switches during a game; others cannot', () => {
  const { game } = setup();
  game.updateSettings('p0', { evenBuild: false });
  assert.equal(game.settings.evenBuild, false);
  assert.match(game.log.at(-1).text, /Host turned off: Even build/);
  assert.throws(() => game.updateSettings('p1', { evenBuild: true }), /Only the host/);
  assert.throws(() => game.updateSettings('p0', { startingCash: 3000 }), /Only the gameplay rules/);
});
