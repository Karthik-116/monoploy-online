'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { Game, GameError } = require('../engine/game');
const { getMap } = require('../maps');

// Classic board indices used below.
const OLD_KENT = 1;
const WHITECHAPEL = 3;
const KINGS_CROSS = 5;
const ELECTRIC = 12;
const WATER = 28;
const MAYFAIR = 39;
const PARK_LANE = 37;

test.describe('lobby & turn order', () => {
  test('first player is host; only host can start; needs 2 players', () => {
    const g = new Game({ map: getMap('classic-london') });
    g.addPlayer({ id: 'a', name: 'A' });
    assert.throws(() => g.start('a'), /At least 2/);
    g.addPlayer({ id: 'b', name: 'B' });
    assert.throws(() => g.start('b'), /Only the host/);
    g.start('a');
    assert.equal(g.status, 'playing');
    assert.equal(g.players[0].cash, 1500);
  });

  test('respects max players and unique tokens', () => {
    const g = new Game({ map: getMap('classic-london'), settings: { maxPlayers: 2 } });
    g.addPlayer({ id: 'a', token: '🚗' });
    const b = g.addPlayer({ id: 'b', token: '🚗' });
    assert.notEqual(b.token, '🚗');
    assert.throws(() => g.addPlayer({ id: 'c' }), /full/);
    assert.throws(() => g.updatePlayer('b', { token: '🚗' }), /taken/);
  });

  test('players cannot act out of turn', () => {
    const { game, dice } = setup();
    dice.push([1, 2]);
    assert.throws(() => game.act('p1', 'roll'), /not your turn/);
    game.act('p0', 'roll');
    assert.throws(() => game.act('p0', 'roll'), GameError);
  });

  test('turn passes to the next player and skips bankrupt players', () => {
    const { game, dice, p } = setup({ players: 3 });
    p('p1').bankrupt = true;
    dice.push([2, 4]); // -> 6, The Angel Islington (buy phase)
    game.act('p0', 'roll');
    game.act('p0', 'buy');
    game.act('p0', 'endTurn');
    assert.equal(game.current().id, 'p2');
  });

  test('doubles give another roll', () => {
    const { game, dice } = setup();
    dice.push([3, 3]); // -> 6, unowned street
    game.act('p0', 'roll');
    game.act('p0', 'buy');
    assert.equal(game.turn.phase, 'roll');
  });

  test('passing GO pays salary', () => {
    const { game, dice, p } = setup();
    p('p0').position = 38;
    dice.push([1, 2]); // -> 1
    game.act('p0', 'roll');
    assert.equal(p('p0').position, OLD_KENT);
    assert.equal(p('p0').cash, 1700);
  });
});

test.describe('buying & auctions', () => {
  test('buy an unowned property', () => {
    const { game, dice, p } = setup();
    dice.push([1, 2]); // -> Whitechapel £60
    game.act('p0', 'roll');
    assert.equal(game.turn.phase, 'buy');
    game.act('p0', 'buy');
    assert.equal(game.properties[WHITECHAPEL].owner, 'p0');
    assert.equal(p('p0').cash, 1440);
    assert.equal(game.turn.phase, 'end');
  });

  test('cannot buy what you cannot afford, or out of turn', () => {
    const { game, dice, p } = setup();
    dice.push([1, 2]);
    game.act('p0', 'roll');
    assert.throws(() => game.act('p1', 'buy'), /not your turn/);
    p('p0').cash = 50;
    assert.throws(() => game.act('p0', 'buy'), /can't afford/);
    assert.equal(game.properties[WHITECHAPEL].owner, null);
    assert.equal(game.turn.phase, 'buy');
  });

  test('cannot buy when not in the buy phase', () => {
    const { game } = setup();
    assert.throws(() => game.act('p0', 'buy'), /Roll the dice/);
  });

  test('declined property goes to auction; highest bidder wins', () => {
    const { game, dice, p } = setup({ players: 3 });
    dice.push([1, 2]);
    game.act('p0', 'roll');
    game.act('p0', 'auction');
    assert.equal(game.turn.phase, 'auction');
    game.act('p1', 'bid', { amount: 10 });
    assert.throws(() => game.act('p2', 'bid', { amount: 10 }), /Bid more/);
    assert.throws(() => game.act('p2', 'bid', { amount: 99999 }), /afford/);
    game.act('p2', 'bid', { amount: 25 });
    assert.throws(() => game.act('p2', 'pass'), /highest bidder/);
    game.act('p0', 'pass');
    game.act('p1', 'pass');
    assert.equal(game.auction, null);
    assert.equal(game.properties[WHITECHAPEL].owner, 'p2');
    assert.equal(p('p2').cash, 1475);
    assert.equal(game.turn.phase, 'end');
  });

  test('auction closes on timeout; no bids leaves it with the bank', () => {
    const { game, dice, clock } = setup();
    dice.push([1, 2]);
    game.act('p0', 'roll');
    game.act('p0', 'auction');
    assert.equal(game.timeoutAuction(), false);
    clock.t += 11_000;
    assert.equal(game.timeoutAuction(), true);
    assert.equal(game.properties[WHITECHAPEL].owner, null);
  });
});

test.describe('rent', () => {
  test('street rent: base, full set doubles, houses, hotel, mortgaged', () => {
    const { game, own } = setup();
    own('p1', OLD_KENT);
    assert.equal(game.rentFor(OLD_KENT), 2);
    own('p1', WHITECHAPEL);
    assert.equal(game.rentFor(OLD_KENT), 4);
    game.properties[OLD_KENT].houses = 1;
    assert.equal(game.rentFor(OLD_KENT), 10);
    game.properties[OLD_KENT].houses = 5;
    assert.equal(game.rentFor(OLD_KENT), 250);
    game.properties[WHITECHAPEL].mortgaged = true;
    assert.equal(game.rentFor(WHITECHAPEL), 0);
  });

  test('railroad rent scales with number owned; utilities use the dice', () => {
    const { game, own } = setup();
    own('p1', KINGS_CROSS);
    assert.equal(game.rentFor(KINGS_CROSS), 25);
    own('p1', 15, 25);
    assert.equal(game.rentFor(KINGS_CROSS), 100);
    own('p1', 35);
    assert.equal(game.rentFor(KINGS_CROSS), 200);
    own('p1', ELECTRIC);
    assert.equal(game.rentFor(ELECTRIC, 7), 28);
    own('p1', WATER);
    assert.equal(game.rentFor(ELECTRIC, 7), 70);
  });

  test('landing on an owned property pays the owner', () => {
    const { game, dice, p, own } = setup();
    own('p1', WHITECHAPEL);
    dice.push([1, 2]);
    game.act('p0', 'roll');
    assert.equal(p('p0').cash, 1496);
    assert.equal(p('p1').cash, 1504);
    assert.equal(game.turn.phase, 'end');
  });

  test('no rent on mortgaged property', () => {
    const { game, dice, p, own } = setup();
    own('p1', WHITECHAPEL);
    game.properties[WHITECHAPEL].mortgaged = true;
    dice.push([1, 2]);
    game.act('p0', 'roll');
    assert.equal(p('p0').cash, 1500);
  });
});

test.describe('jail', () => {
  test('landing on Go To Jail sends you to jail without salary', () => {
    const { game, dice, p } = setup();
    p('p0').position = 25;
    dice.push([2, 3]);
    game.act('p0', 'roll');
    assert.equal(p('p0').position, 10);
    assert.equal(p('p0').inJail, true);
    assert.equal(p('p0').cash, 1500);
    assert.equal(game.turn.phase, 'end');
  });

  test('three doubles in a row sends you to jail', () => {
    const { game, dice, p } = setup();
    p('p0').position = 21;
    dice.push([1, 1], [2, 2], [3, 3]);
    game.act('p0', 'roll'); // -> 23
    game.act('p0', 'buy');
    game.act('p0', 'roll'); // -> 27
    game.act('p0', 'buy');
    game.act('p0', 'roll'); // third doubles
    assert.equal(p('p0').inJail, true);
    assert.equal(p('p0').position, 10);
    assert.equal(game.turn.phase, 'end');
  });

  test('rolling doubles in jail frees you but gives no extra roll', () => {
    const { game, dice, p } = setup();
    game.sendToJail(p('p0'));
    dice.push([3, 3]); // -> 16
    game.act('p0', 'roll');
    assert.equal(p('p0').inJail, false);
    assert.equal(p('p0').position, 16);
    game.act('p0', 'buy');
    assert.equal(game.turn.phase, 'end');
  });

  test('failing to roll doubles keeps you in jail', () => {
    const { game, dice, p } = setup();
    game.sendToJail(p('p0'));
    dice.push([1, 2]);
    game.act('p0', 'roll');
    assert.equal(p('p0').inJail, true);
    assert.equal(p('p0').jailTurns, 1);
    assert.equal(p('p0').position, 10);
  });

  test('third failed attempt forces the fine and moves you', () => {
    const { game, dice, p } = setup();
    game.sendToJail(p('p0'));
    p('p0').jailTurns = 2;
    dice.push([1, 2]); // -> 13
    game.act('p0', 'roll');
    assert.equal(p('p0').inJail, false);
    assert.equal(p('p0').position, 13);
    assert.equal(p('p0').cash, 1450);
  });

  test('pay the fine or use a card to leave before rolling', () => {
    const { game, p } = setup();
    game.sendToJail(p('p0'));
    game.act('p0', 'payFine');
    assert.equal(p('p0').inJail, false);
    assert.equal(p('p0').cash, 1450);
    assert.equal(game.turn.phase, 'roll');

    game.sendToJail(p('p0'));
    assert.throws(() => game.act('p0', 'useCard'), /don't have/);
    p('p0').cash = 10;
    assert.throws(() => game.act('p0', 'payFine'), /need/);
  });
});

test.describe('cards, building, bankruptcy', () => {
  test('chance card: advance to GO collects salary', () => {
    const { game, dice, p } = setup();
    dice.push([3, 4]); // -> 7 Chance; unshuffled deck: "Advance to GO"
    game.act('p0', 'roll');
    assert.equal(p('p0').position, 0);
    assert.equal(p('p0').cash, 1700);
    assert.match(game.lastCard.text, /Advance to GO/);
  });

  test('build evenly, only with the full colour set', () => {
    const { game, p, own } = setup();
    own('p0', OLD_KENT);
    assert.throws(() => game.act('p0', 'build', { space: OLD_KENT }), /whole colour set/);
    own('p0', WHITECHAPEL);
    game.act('p0', 'build', { space: OLD_KENT });
    assert.throws(() => game.act('p0', 'build', { space: OLD_KENT }), /evenly/);
    game.act('p0', 'build', { space: WHITECHAPEL });
    assert.equal(game.properties[OLD_KENT].houses, 1);
    assert.equal(p('p0').cash, 1400);
    assert.throws(() => game.act('p0', 'mortgage', { space: OLD_KENT }), /Sell all buildings/);
    assert.throws(() => game.act('p1', 'build', { space: OLD_KENT }), /your turn|don't own/);
  });

  test('mortgage and unmortgage with interest', () => {
    const { game, p, own } = setup();
    own('p0', MAYFAIR);
    game.act('p0', 'mortgage', { space: MAYFAIR });
    assert.equal(p('p0').cash, 1700);
    game.act('p0', 'unmortgage', { space: MAYFAIR });
    assert.equal(p('p0').cash, 1480);
  });

  test('debt blocks ending the turn; bankruptcy hands assets to the creditor', () => {
    const { game, dice, p, own } = setup();
    own('p1', PARK_LANE, MAYFAIR);
    game.properties[MAYFAIR].houses = 5; // rent 2000
    own('p0', OLD_KENT);
    p('p0').position = 36;
    p('p0').cash = 10;
    dice.push([1, 2]); // -> Mayfair
    game.act('p0', 'roll');
    assert.equal(p('p0').cash, -1990);
    assert.equal(p('p1').cash, 3500);
    assert.throws(() => game.act('p0', 'endTurn'), /debt/);
    game.act('p0', 'bankrupt');
    assert.equal(p('p0').bankrupt, true);
    assert.equal(game.properties[OLD_KENT].owner, 'p1');
    assert.equal(p('p1').cash, 1510); // gets only what p0 actually had
    assert.equal(game.status, 'finished');
    assert.equal(game.winnerId, 'p1');
  });

  test('raising funds clears debt and lets the turn end', () => {
    const { game, dice, p, own } = setup();
    own('p1', WHITECHAPEL);
    own('p0', MAYFAIR);
    p('p0').cash = 1;
    dice.push([1, 2]);
    game.act('p0', 'roll');
    assert.ok(p('p0').cash < 0);
    game.act('p0', 'mortgage', { space: MAYFAIR });
    assert.equal(p('p0').cash, 197);
    game.act('p0', 'endTurn');
    assert.equal(game.current().id, 'p1');
  });
});
