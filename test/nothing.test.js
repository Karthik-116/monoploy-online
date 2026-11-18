'use strict';

// The "Nothing" button: a password-protected way to choose the next dice total.

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { Game } = require('../engine/game');
const { getMap } = require('../maps');

function game(rngValue = 0.5) {
  const g = new Game({ map: getMap('classic-london'), rng: () => rngValue, shuffleCards: false });
  g.addPlayer({ id: 'a' });
  g.addPlayer({ id: 'b' });
  g.start('a');
  return g;
}

test('a chosen total is used once, for whoever rolls next', () => {
  for (const r of [0, 0.99]) {
    const g = game(r);
    g.setNextRoll(3);
    g.act('a', 'roll');
    const [d1, d2] = g.turn.lastRoll;
    assert.equal(d1 + d2, 3);
    assert.ok((d1 === 1 && d2 === 2) || (d1 === 2 && d2 === 1));
    assert.equal(g.nextTotal, null);
  }
});

test('totals 2 and 12 force double ones and double sixes', () => {
  const g = game();
  g.setNextRoll(12);
  assert.deepEqual(g.takeDice(), [6, 6]);
  g.setNextRoll(2);
  assert.deepEqual(g.takeDice(), [1, 1]);
});

test('only totals 2-12 are allowed and the choice stays secret', () => {
  const g = game();
  assert.throws(() => g.setNextRoll(1), /2 to 12/);
  assert.throws(() => g.setNextRoll(13), /2 to 12/);
  g.setNextRoll(7);
  assert.equal(JSON.stringify(g.publicState()).includes('nextTotal'), false);
  g.setNextRoll(null);
  assert.equal(g.nextTotal, null);
});

test('server: wrong password is refused, right one unlocks, other players never learn the total', async () => {
  process.env.NOTHING_PASSWORD = 'open-sesame';
  const { createServer } = require('../server');
  const { server, io } = createServer();
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const a = connect(url, { transports: ['websocket'] });
  const b = connect(url, { transports: ['websocket'] });
  const emit = (s, e, p) => new Promise((r) => s.emit(e, p, r));
  const bHeard = [];
  b.on('nothing:status', (x) => bHeard.push(x));
  try {
    const { code } = await emit(a, 'room:create', { name: 'A', secret: 'x'.repeat(32) });
    await emit(b, 'room:join', { code, name: 'B', secret: 'y'.repeat(32) });
    assert.equal((await emit(b, 'nothing:set', { total: 3 })).ok, false);
    assert.equal((await emit(b, 'nothing:unlock', { password: 'nope' })).ok, false);
    const ok = await emit(b, 'nothing:unlock', { password: 'open-sesame' });
    assert.equal(ok.ok, true);
    assert.equal((await emit(b, 'nothing:set', { total: 3 })).nextTotal, 3);
    assert.equal((await emit(a, 'game:start')).ok, true);
    const rolled = new Promise((r) => a.on('state', (s) => s.turn && s.turn.lastRoll && r(s)));
    await emit(a, 'game:action', { type: 'roll' });
    const s = await rolled;
    assert.equal(s.turn.lastRoll[0] + s.turn.lastRoll[1], 3);
    assert.equal(JSON.stringify(s).includes('nextTotal'), false);
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(bHeard.some((x) => x.nextTotal === null));
  } finally {
    a.close();
    b.close();
    io.close();
    server.close();
    delete process.env.NOTHING_PASSWORD;
  }
});
