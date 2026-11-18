'use strict';

// End-to-end check over real sockets: create, join, start, act out of turn, roll.

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../server');

const emit = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const nextState = (socket, pred = () => true) =>
  new Promise((resolve) => {
    const h = (s) => {
      if (pred(s)) {
        socket.off('state', h);
        resolve(s);
      }
    };
    socket.on('state', h);
  });

test('two clients can play over Socket.IO', async () => {
  const { server, io } = createServer();
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const a = connect(url, { transports: ['websocket'] });
  const b = connect(url, { transports: ['websocket'] });
  try {
    const created = await emit(a, 'room:create', { name: 'Alice', secret: 'a'.repeat(32) });
    assert.equal(created.ok, true);
    const joined = await emit(b, 'room:join', { code: created.code.toLowerCase(), name: 'Bob', secret: 'b'.repeat(32) });
    assert.equal(joined.ok, true);

    const notHost = await emit(b, 'game:start');
    assert.equal(notHost.ok, false);

    const mapRes = await emit(a, 'lobby:settings', { mapId: 'world-tour' });
    assert.equal(mapRes.ok, true);

    const started = nextState(b, (s) => s.status === 'playing');
    assert.equal((await emit(a, 'game:start')).ok, true);
    const s = await started;
    assert.equal(s.map.id, 'world-tour');
    assert.equal(s.players.length, 2);

    const outOfTurn = await emit(b, 'game:action', { type: 'roll' });
    assert.equal(outOfTurn.ok, false);
    assert.match(outOfTurn.error, /not your turn/);

    const rolled = nextState(b, (st) => st.turn.lastRoll !== null);
    assert.equal((await emit(a, 'game:action', { type: 'roll' })).ok, true);
    assert.ok((await rolled).players[0].position > 0 || (await rolled).players[0].inJail);
  } finally {
    a.close();
    b.close();
    io.close();
    server.close();
  }
});
