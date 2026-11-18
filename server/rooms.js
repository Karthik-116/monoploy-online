'use strict';

/*
 * Networking layer: rooms, sockets, reconnection and timers.
 * It never decides game rules — it forwards intents to the engine and
 * broadcasts the resulting state to everyone in the room.
 */

const crypto = require('crypto');

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
const { Game, GameError } = require('../engine/game');
const { TOKENS } = require('../engine/constants');
const { getMap, listMaps, DEFAULT_MAP_ID } = require('../maps');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class RoomManager {
  constructor(io, { emptyRoomTtlMs = 10 * 60 * 1000, lobbyGraceMs = 20 * 1000 } = {}) {
    this.io = io;
    this.rooms = new Map();
    this.emptyRoomTtlMs = emptyRoomTtlMs;
    this.lobbyGraceMs = lobbyGraceMs;
  }

  attach() {
    this.io.on('connection', (socket) => this.onConnection(socket));
    // One clock for all rooms: turn timers and disconnected-player timers.
    this.ticker = setInterval(() => {
      for (const room of this.rooms.values()) {
        try {
          if (room.game.tick()) this.afterChange(room);
        } catch (err) {
          console.error('[tick]', err);
        }
      }
    }, 1000);
    this.ticker.unref?.();
    this.io.engine?.on?.('close', () => clearInterval(this.ticker));
    return this;
  }

  newCode() {
    let code;
    do {
      code = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
    } while (this.rooms.has(code));
    return code;
  }

  createRoom() {
    const code = this.newCode();
    const room = {
      code,
      game: new Game({ id: code, map: getMap(DEFAULT_MAP_ID) }),
      secrets: new Map(), // client secret -> playerId
      auctionTimer: null,
      cleanupTimer: null,
      chat: [], // last 60 chat messages
      chatSeq: 0,
      riggers: new Set(), // playerIds who unlocked the Nothing button
      rigTries: new Map(), // playerId -> recent wrong-password timestamps
    };
    this.rooms.set(code, room);
    return room;
  }

  onConnection(socket) {
    socket.data = { code: null, playerId: null };
    socket.emit('meta', { maps: listMaps(), tokens: TOKENS });

    // Wrap every handler: run it, reply via ack, turn GameErrors into messages.
    const on = (event, fn) =>
      socket.on(event, (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          reply({ ok: true, ...(fn(payload || {}) || {}) });
        } catch (err) {
          if (!(err instanceof GameError)) console.error(`[${event}]`, err);
          reply({ ok: false, error: err instanceof GameError ? err.message : 'Server error' });
        }
      });

    on('room:create', ({ name, secret }) => this.join(socket, this.createRoom(), { name, secret }));

    on('room:join', ({ code, name, secret }) => {
      const room = this.rooms.get(String(code || '').trim().toUpperCase());
      if (!room) throw new GameError('Room not found — check the code');
      return this.join(socket, room, { name, secret });
    });

    on('room:leave', () => {
      const { room, playerId } = this.ctx(socket, false);
      this.detach(socket);
      if (playerId && room.game.status === 'lobby') room.game.removePlayer(playerId);
      this.broadcast(room);
    });

    on('lobby:update', ({ name, token }) => {
      const { room, playerId } = this.ctx(socket);
      room.game.updatePlayer(playerId, { name, token });
      this.broadcast(room);
    });

    on('lobby:settings', (s) => {
      const { room, playerId } = this.ctx(socket);
      if (s.mapId !== undefined) {
        const map = getMap(s.mapId);
        if (!map) throw new GameError('Unknown board');
        room.game.chooseMap(playerId, map);
      }
      const { mapId, ...rest } = s; // eslint-disable-line no-unused-vars
      room.game.updateSettings(playerId, rest);
      this.broadcast(room);
    });

    on('game:start', () => {
      const { room, playerId } = this.ctx(socket);
      room.game.start(playerId);
      this.broadcast(room);
    });

    on('game:restart', () => {
      const { room, playerId } = this.ctx(socket);
      room.game.restart(playerId);
      this.afterChange(room);
    });

    on('game:action', ({ type, payload }) => {
      const { room, playerId } = this.ctx(socket);
      room.game.act(playerId, String(type), payload);
      this.afterChange(room);
    });

    on('chat:send', ({ text }) => {
      const { room, playerId } = this.ctx(socket);
      const msg = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!msg) throw new GameError('Type a message first');
      const now = Date.now();
      if (now - (socket.data.lastChat || 0) < 500) throw new GameError('Slow down a little');
      socket.data.lastChat = now;
      const entry = { id: ++room.chatSeq, playerId, text: msg, t: now };
      room.chat.push(entry);
      if (room.chat.length > 60) room.chat.shift();
      this.io.to(room.code).emit('chat', entry);
    });

    // "Nothing" button: password-protected control over the next dice total.
    on('nothing:unlock', ({ password }) => {
      const { room, playerId } = this.ctx(socket);
      const expected = process.env.NOTHING_PASSWORD || '';
      if (!expected) throw new GameError('Nothing happened.');
      const now = Date.now();
      const tries = (room.rigTries.get(playerId) || []).filter((t) => now - t < 60_000);
      if (tries.length >= 5) throw new GameError('Too many tries. Wait a minute and try again.');
      if (!crypto.timingSafeEqual(sha(password), sha(expected))) {
        tries.push(now);
        room.rigTries.set(playerId, tries);
        throw new GameError('Wrong password');
      }
      room.rigTries.delete(playerId);
      room.riggers.add(playerId);
      return { unlocked: true, nextTotal: room.game.nextTotal };
    });

    on('nothing:set', ({ total }) => {
      const { room, playerId } = this.ctx(socket);
      if (!room.riggers.has(playerId)) throw new GameError('Enter the password first');
      room.game.setNextRoll(total);
      this.sendRigStatus(room);
      return { nextTotal: room.game.nextTotal };
    });

    socket.on('disconnect', () => this.detach(socket));
  }

  ctx(socket, needPlayer = true) {
    const { code, playerId } = socket.data;
    const room = code && this.rooms.get(code);
    if (!room) throw new GameError('Join a room first');
    if (needPlayer && !playerId) throw new GameError('Spectators cannot do that');
    return { room, playerId };
  }

  join(socket, room, { name, secret }) {
    if (typeof secret !== 'string' || secret.length < 16 || secret.length > 128) throw new GameError('Missing client id');
    if (socket.data.code && socket.data.code !== room.code) this.detach(socket);

    const { game } = room;
    let playerId = room.secrets.get(secret) || null;
    if (playerId && !game.players.some((p) => p.id === playerId)) {
      room.secrets.delete(secret);
      playerId = null;
    }
    if (!playerId && game.status === 'lobby') {
      playerId = crypto.randomUUID();
      game.addPlayer({ id: playerId, name });
      room.secrets.set(secret, playerId);
    }
    // Otherwise the game is running and this person becomes a spectator.

    if (playerId) game.setConnected(playerId, true);
    socket.join(room.code);
    socket.data = { code: room.code, playerId };
    socket.emit('chat:history', room.chat);
    if (playerId && room.riggers.has(playerId)) socket.emit('nothing:status', { unlocked: true, nextTotal: room.game.nextTotal });
    clearTimeout(room.cleanupTimer);
    this.broadcast(room);
    return { code: room.code, playerId, spectator: !playerId };
  }

  detach(socket) {
    const { code, playerId } = socket.data || {};
    const room = code && this.rooms.get(code);
    socket.data = { code: null, playerId: null };
    if (!room) return;
    socket.leave(code);

    if (playerId && !this.isOnline(room, playerId)) {
      room.game.setConnected(playerId, false);
      if (room.game.status === 'lobby') {
        // Give refreshes a moment before dropping the seat.
        setTimeout(() => {
          const p = room.game.players.find((x) => x.id === playerId);
          if (room.game.status === 'lobby' && p && !p.connected) {
            room.game.removePlayer(playerId);
            this.broadcast(room);
          }
        }, this.lobbyGraceMs).unref?.();
      }
    }
    this.broadcast(room);

    if (this.socketCount(room) === 0) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = setTimeout(() => {
        if (this.socketCount(room) === 0) {
          clearTimeout(room.auctionTimer);
          this.rooms.delete(room.code);
        }
      }, this.emptyRoomTtlMs);
      room.cleanupTimer.unref?.();
    }
  }

  socketCount(room) {
    return this.io.sockets.adapter.rooms.get(room.code)?.size || 0;
  }

  isOnline(room, playerId) {
    const ids = this.io.sockets.adapter.rooms.get(room.code);
    if (!ids) return false;
    for (const id of ids) if (this.io.sockets.sockets.get(id)?.data?.playerId === playerId) return true;
    return false;
  }

  /** Tell only the players who unlocked Nothing what the pending total is. */
  sendRigStatus(room) {
    if (!room.riggers.size) return;
    const ids = this.io.sockets.adapter.rooms.get(room.code);
    if (!ids) return;
    for (const id of ids) {
      const s = this.io.sockets.sockets.get(id);
      if (s && room.riggers.has(s.data.playerId)) s.emit('nothing:status', { unlocked: true, nextTotal: room.game.nextTotal });
    }
  }

  broadcast(room) {
    this.io.to(room.code).emit('state', room.game.publicState());
  }

  afterChange(room) {
    this.broadcast(room);
    this.sendRigStatus(room);
    this.scheduleAuction(room);
  }

  /** Server-side auction clock: closes the auction when nobody bids in time. */
  scheduleAuction(room) {
    clearTimeout(room.auctionTimer);
    const a = room.game.auction;
    if (!a) return;
    const wait = Math.max(0, a.endsAt - Date.now()) + 50;
    room.auctionTimer = setTimeout(() => {
      if (room.game.timeoutAuction()) this.broadcast(room);
      this.scheduleAuction(room);
    }, wait);
  }
}

module.exports = { RoomManager };
