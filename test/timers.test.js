'use strict';

// Turn clock (4:36), disconnected players (1 min + 2 min grants), auto-finishing turns.

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

const TURN = 276 * 1000;

test('every turn gets 4 min 36 s', () => {
  const { game, clock } = setup();
  assert.equal(game.turn.deadline, clock.t + TURN);
  assert.equal(game.settings.turnSeconds, 276);
});

test('when the clock runs out the turn is finished automatically', () => {
  const { game, dice, clock, p } = setup({ settings: { auction: false } });
  dice.push([1, 2]); // auto-roll lands on Whitechapel (unowned) -> skipped -> turn ends
  clock.t += TURN - 1;
  assert.equal(game.tick(), false);
  clock.t += 2;
  assert.equal(game.tick(), true);
  assert.equal(p('p0').position, 3);
  assert.equal(game.properties[3].owner, null);
  assert.equal(game.current().id, 'p1');
  assert.equal(game.turn.deadline, clock.t + TURN, 'next player gets a fresh clock');
});

test('auto-finish raises money for a player in debt before ending the turn', () => {
  const { game, dice, clock, p, own } = setup();
  own('p1', 3);
  own('p0', 39);
  p('p0').cash = 1;
  dice.push([1, 2]);
  game.act('p0', 'roll'); // owes rent, now in debt
  assert.ok(p('p0').cash < 0);
  clock.t += TURN;
  game.tick();
  assert.equal(game.properties[39].mortgaged, true);
  assert.ok(p('p0').cash >= 0);
  assert.equal(game.current().id, 'p1');
});

test('a disconnected player is removed after 1 minute; reconnecting cancels it', () => {
  const { game, clock, p, own } = setup({ players: 3 });
  own('p1', 39);
  game.setConnected('p1', false);
  assert.equal(p('p1').awayDeadline, clock.t + 60_000);
  clock.t += 30_000;
  game.setConnected('p1', true);
  assert.equal(p('p1').awayDeadline, null);
  game.setConnected('p1', false);
  clock.t += 60_001;
  game.tick();
  assert.equal(p('p1').bankrupt, true);
  assert.equal(game.properties[39].owner, null, 'properties go back to the bank');
  assert.match(game.log.map((l) => l.text).join('\n'), /removed from the game after running out of time/);
});

test('+2 min: each other player may grant once per disconnect', () => {
  const { game, clock, p, dice } = setup({ players: 3, settings: { auction: false } });
  dice.push([1, 2], [1, 2]); // the waiting also runs out p0's turn clock, which auto-rolls
  game.setConnected('p2', false);
  const base = p('p2').awayDeadline;
  game.act('p0', 'grantTime', { target: 'p2' });
  assert.equal(p('p2').awayDeadline, base + 120_000);
  assert.throws(() => game.act('p0', 'grantTime', { target: 'p2' }), /already gave/);
  game.act('p1', 'grantTime', { target: 'p2' });
  assert.equal(p('p2').awayDeadline, base + 240_000);
  assert.throws(() => game.act('p0', 'grantTime', { target: 'p1' }), /not waiting/);
  clock.t += 60_000 + 240_000 - 1;
  game.tick();
  assert.equal(p('p2').bankrupt, false);
  clock.t += 2;
  game.tick();
  assert.equal(p('p2').bankrupt, true);
});

test('removing the last opponent ends the game', () => {
  const { game, clock } = setup();
  game.setConnected('p1', false);
  clock.t += 61_000;
  game.tick();
  assert.equal(game.status, 'finished');
  assert.equal(game.winnerId, 'p0');
});

test('three doubles in a row still sends you to jail', () => {
  const { game, dice, p } = setup();
  p('p0').position = 21;
  dice.push([1, 1], [2, 2], [3, 3]);
  game.act('p0', 'roll');
  game.act('p0', 'buy');
  game.act('p0', 'roll');
  game.act('p0', 'buy');
  game.act('p0', 'roll');
  assert.equal(p('p0').inJail, true);
  assert.equal(p('p0').position, 10);
});
