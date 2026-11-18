'use strict';

/*
 * Pure game-rules engine. No networking, no DOM.
 * All state changes go through methods that validate first and mutate second,
 * throwing GameError for anything illegal. The server is the only caller in
 * production; tests call it directly with deterministic dice.
 */

const { TOKENS, DEFAULT_SETTINGS, BOOL_SETTINGS, OWNABLE } = require('./constants');
const { CHANCE, CHEST, shuffle } = require('./cards');

class GameError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GameError';
  }
}

const fail = (message) => {
  throw new GameError(message);
};

const PHASE_HINT = {
  roll: 'Roll the dice first',
  buy: 'Buy or auction the property first',
  auction: 'An auction is in progress',
  end: 'End your turn',
  over: 'The game is over',
};

/** Maps an action name (sent by clients) to a handler method. */
const ACTIONS = {
  roll: 'actRoll',
  buy: 'actBuy',
  auction: 'actDecline',
  bid: 'actBid',
  pass: 'actPass',
  build: 'actBuild',
  sell: 'actSell',
  sellProperty: 'actSellProperty',
  mortgage: 'actMortgage',
  unmortgage: 'actUnmortgage',
  payFine: 'actPayFine',
  useCard: 'actUseCard',
  endTurn: 'actEndTurn',
  bankrupt: 'actBankrupt',
};

function cleanName(name, fallback) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return n || fallback;
}

class Game {
  /**
   * @param {object} opts
   * @param {string} opts.id
   * @param {object} opts.map         board definition (see maps/)
   * @param {object} [opts.settings]
   * @param {function} [opts.rng]     () => [0,1) used for dice and shuffling
   * @param {function} [opts.dice]    () => [d1, d2] override (tests)
   * @param {function} [opts.now]     () => ms timestamp (tests)
   * @param {boolean} [opts.shuffleCards=true]
   */
  constructor({ id = 'local', map, settings = {}, rng = Math.random, dice = null, now = Date.now, shuffleCards = true } = {}) {
    if (!map) fail('A map is required');
    this.id = id;
    this.rng = rng;
    this.now = now;
    this.shuffleCards = shuffleCards;
    this.rollDice = dice || (() => [1 + Math.floor(this.rng() * 6), 1 + Math.floor(this.rng() * 6)]);
    this.players = [];
    this.hostId = null;
    this.status = 'lobby'; // lobby | playing | finished
    this.settings = { ...DEFAULT_SETTINGS };
    this.applySettings(settings);
    this.log = [];
    this.logSeq = 0;
    this.version = 0;
    this.setMap(map);
  }

  /* ------------------------------------------------------------------ */
  /* Setup & lobby                                                      */
  /* ------------------------------------------------------------------ */

  setMap(map) {
    if (!Array.isArray(map.spaces)) fail('Invalid map');
    this.map = map;
    this.jailIndex = map.spaces.findIndex((s) => s.type === 'jail');
    this.resetBoard();
  }

  resetBoard() {
    this.properties = {};
    this.map.spaces.forEach((s, i) => {
      if (OWNABLE.has(s.type)) this.properties[i] = { owner: null, houses: 0, mortgaged: false };
    });
    this.turn = null;
    this.auction = null;
    this.lastCard = null;
    this.winnerId = null;
    this.decks = null;
    this.pot = 0; // Vacation cash pot
    this.nextTotal = null; // secretly chosen total for the next roll (never sent to clients)
  }

  applySettings(s = {}) {
    const intIn = (v, lo, hi, msg) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < lo || n > hi) fail(msg);
      return n;
    };
    if (s.maxPlayers !== undefined) {
      const n = intIn(s.maxPlayers, 2, 6, 'Player count must be between 2 and 6');
      if (n < this.players.length) fail(`${this.players.length} players have already joined`);
      this.settings.maxPlayers = n;
    }
    if (s.startingCash !== undefined) this.settings.startingCash = intIn(s.startingCash, 500, 5000, 'Starting cash must be 500–5000');
    if (s.auctionSeconds !== undefined) this.settings.auctionSeconds = intIn(s.auctionSeconds, 3, 60, 'Auction time must be 3–60 seconds');
    for (const key of BOOL_SETTINGS) {
      if (s[key] === undefined) continue;
      if (typeof s[key] !== 'boolean') fail(`${key} must be on or off`);
      this.settings[key] = s[key];
    }
  }

  requireHostLobby(byId) {
    if (this.status !== 'lobby') fail('You can only change this in the lobby');
    if (byId !== this.hostId) fail('Only the host can change game settings');
  }

  updateSettings(byId, s) {
    this.requireHostLobby(byId);
    this.applySettings(s);
    this.version++;
  }

  chooseMap(byId, map) {
    this.requireHostLobby(byId);
    this.setMap(map);
    this.addLog(`Board changed to ${map.name}`);
    this.version++;
  }

  addPlayer({ id, name, token } = {}) {
    if (this.status !== 'lobby') fail('This game has already started');
    if (this.players.length >= this.settings.maxPlayers) fail('This room is full');
    if (!id || this.players.some((p) => p.id === id)) fail('Invalid or duplicate player');
    const taken = new Set(this.players.map((p) => p.token));
    const player = {
      id,
      name: cleanName(name, `Player ${this.players.length + 1}`),
      token: TOKENS.includes(token) && !taken.has(token) ? token : TOKENS.find((t) => !taken.has(t)),
      cash: 0,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: [],
      bankrupt: false,
      connected: true,
      debt: null,
    };
    this.players.push(player);
    if (!this.hostId) this.hostId = id;
    this.addLog(`${player.name} joined`);
    this.version++;
    return player;
  }

  updatePlayer(id, { name, token } = {}) {
    if (this.status !== 'lobby') fail('You can only change this in the lobby');
    const p = this.getPlayer(id);
    if (name !== undefined) p.name = cleanName(name, p.name);
    if (token !== undefined) {
      if (!TOKENS.includes(token)) fail('Unknown token');
      if (this.players.some((o) => o !== p && o.token === token)) fail('That token is already taken');
      p.token = token;
    }
    this.version++;
  }

  removePlayer(id) {
    if (this.status !== 'lobby') fail('Players can only be removed in the lobby');
    const i = this.players.findIndex((p) => p.id === id);
    if (i < 0) return;
    const [p] = this.players.splice(i, 1);
    if (this.hostId === id) this.hostId = this.players[0]?.id ?? null;
    this.addLog(`${p.name} left`);
    this.version++;
  }

  setConnected(id, connected) {
    const p = this.players.find((x) => x.id === id);
    if (!p) return;
    p.connected = connected;
    // Hand host rights to someone who is still here.
    if (!connected && this.hostId === id) {
      const next = this.players.find((x) => x.connected && !x.bankrupt);
      if (next) this.hostId = next.id;
    }
    this.version++;
  }

  start(byId) {
    if (this.status !== 'lobby') fail('The game has already started');
    if (byId !== this.hostId) fail('Only the host can start the game');
    if (this.players.length < 2) fail('At least 2 players are needed');
    const chosen = this.nextTotal; // a total picked in the lobby still applies to the first roll
    this.resetBoard();
    this.nextTotal = chosen;
    for (const p of this.players) {
      Object.assign(p, { cash: this.settings.startingCash, position: 0, inJail: false, jailTurns: 0, jailCards: [], bankrupt: false, debt: null });
    }
    const decks = this.map.cards || {};
    const prep = (d) => (this.shuffleCards ? shuffle(d, this.rng) : d.slice());
    this.decks = { chance: prep(decks.chance || CHANCE), chest: prep(decks.chest || CHEST) };
    if (this.settings.randomizeOrder) this.players = shuffle(this.players, this.rng);
    this.status = 'playing';
    this.turn = this.newTurn(0);
    this.addLog(`Game started on ${this.map.name}. ${this.players[0].name} goes first.`);
    this.version++;
  }

  /** Host sends everyone back to the lobby to play again. */
  restart(byId) {
    if (this.status === 'lobby') fail('Already in the lobby');
    if (byId !== this.hostId) fail('Only the host can restart');
    this.status = 'lobby';
    this.resetBoard();
    for (const p of this.players) Object.assign(p, { cash: 0, position: 0, inJail: false, jailTurns: 0, jailCards: [], bankrupt: false, debt: null });
    this.addLog('Back to the lobby');
    this.version++;
  }

  /* ------------------------------------------------------------------ */
  /* Action dispatch                                                    */
  /* ------------------------------------------------------------------ */

  act(playerId, type, payload = {}) {
    const method = ACTIONS[type];
    if (!method) fail(`Unknown action "${type}"`);
    if (this.status !== 'playing') fail('The game is not in progress');
    const player = this.players.find((p) => p.id === playerId);
    if (!player) fail('You are not a player in this game');
    if (player.bankrupt) fail('You are bankrupt');
    this[method](player, payload || {});
    this.version++;
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                            */
  /* ------------------------------------------------------------------ */

  getPlayer(id) {
    const p = this.players.find((x) => x.id === id);
    if (!p) fail('Player not found');
    return p;
  }

  current() {
    return this.turn ? this.players[this.turn.index] : null;
  }

  isCurrent(p) {
    return this.status === 'playing' && this.current() === p;
  }

  requireTurn(p, ...phases) {
    if (!this.isCurrent(p)) fail("It's not your turn");
    if (phases.length && !phases.includes(this.turn.phase)) fail(PHASE_HINT[this.turn.phase] || "You can't do that right now");
  }

  newTurn(index, lastRoll = null) {
    return { index, phase: 'roll', doublesCount: 0, extraRoll: false, lastRoll, pendingSpace: null };
  }

  money(n) {
    return `${this.map.currency}${n}`;
  }

  addLog(text) {
    this.log.push({ id: ++this.logSeq, text, t: this.now() });
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }

  groupIndices(group) {
    const out = [];
    this.map.spaces.forEach((s, i) => s.type === 'street' && s.group === group && out.push(i));
    return out;
  }

  ownsGroup(playerId, group) {
    return this.groupIndices(group).every((i) => this.properties[i].owner === playerId);
  }

  countOwned(playerId, type) {
    return this.map.spaces.filter((s, i) => s.type === type && this.properties[i].owner === playerId).length;
  }

  /** Rent owed for landing on space i (0 if unowned or mortgaged). */
  rentFor(i, diceTotal = 0, opts = {}) {
    const s = this.map.spaces[i];
    const prop = this.properties[i];
    if (!prop || !prop.owner || prop.mortgaged) return 0;
    if (s.type === 'street') {
      if (prop.houses > 0) return s.rent[prop.houses];
      return this.settings.doubleRentOnSet && this.ownsGroup(prop.owner, s.group) ? s.rent[0] * 2 : s.rent[0];
    }
    if (s.type === 'railroad') {
      const n = this.countOwned(prop.owner, 'railroad');
      return s.rent[Math.min(n, s.rent.length) - 1] * (opts.rentMultiplier || 1);
    }
    if (s.type === 'utility') {
      const n = this.countOwned(prop.owner, 'utility');
      const mult = opts.utilityMultiplier || s.multipliers[Math.min(n, s.multipliers.length) - 1];
      return diceTotal * mult;
    }
    return 0;
  }

  diceTotal() {
    const r = this.turn && this.turn.lastRoll;
    return r ? r[0] + r[1] : 0;
  }

  /** Move money between players (to === null means the bank). Allows debt. */
  pay(from, to, amount, reason) {
    amount = Math.max(0, Math.round(amount));
    if (!amount) return;
    from.cash -= amount;
    if (to) to.cash += amount;
    else if (this.settings.vacationCash) this.pot += amount;
    this.addLog(`${from.name} paid ${this.money(amount)}${to ? ` to ${to.name}` : ''} (${reason})`);
    if (from.cash < 0) {
      const toId = to ? to.id : null;
      const shortfall = Math.min(amount, -from.cash);
      if (from.debt && from.debt.to === toId) from.debt.amount += shortfall;
      else from.debt = { to: toId, amount: shortfall };
      this.addLog(`${from.name} owes ${this.money(-from.cash)} and must raise funds`);
    }
  }

  credit(p, amount, reason) {
    p.cash += amount;
    this.addLog(`${p.name} received ${this.money(amount)} (${reason})`);
    this.settleDebt(p);
  }

  settleDebt(p) {
    if (p.cash >= 0) p.debt = null;
  }

  moveBy(p, steps) {
    const len = this.map.spaces.length;
    const next = p.position + steps;
    if (next >= len) this.credit(p, this.settings.goSalary, 'passed GO');
    p.position = next % len;
  }

  moveTo(p, index, collectGo = true) {
    if (collectGo && index < p.position) this.credit(p, this.settings.goSalary, 'passed GO');
    p.position = index;
  }

  sendToJail(p) {
    p.position = this.jailIndex;
    p.inJail = true;
    p.jailTurns = 0;
    if (this.isCurrent(p)) this.turn.extraRoll = false;
    this.addLog(`${p.name} was sent to jail`);
  }

  releaseFromJail(p) {
    p.inJail = false;
    p.jailTurns = 0;
  }

  /** After movement/purchase is resolved, decide what the current player does next. */
  advancePhase() {
    if (this.status !== 'playing') return;
    if (this.turn.phase === 'buy' || this.turn.phase === 'auction') return;
    const p = this.current();
    this.turn.phase = this.turn.extraRoll && !p.inJail ? 'roll' : 'end';
  }

  landOn(p, opts = {}) {
    const i = p.position;
    const s = this.map.spaces[i];
    switch (s.type) {
      case 'gotojail':
        this.sendToJail(p);
        break;
      case 'tax':
        this.pay(p, null, s.amount, s.name);
        break;
      case 'chance':
      case 'chest':
        this.drawCard(p, s.type);
        break;
      case 'street':
      case 'railroad':
      case 'utility': {
        const prop = this.properties[i];
        if (!prop.owner) {
          this.turn.phase = 'buy';
          this.turn.pendingSpace = i;
        } else if (prop.owner !== p.id) {
          if (prop.mortgaged) {
            this.addLog(`${s.name} is mortgaged — no rent`);
            break;
          }
          const owner = this.getPlayer(prop.owner);
          if (this.settings.noRentInJail && owner.inJail) {
            this.addLog(`${owner.name} is in jail — no rent for ${s.name}`);
            break;
          }
          this.pay(p, owner, this.rentFor(i, this.diceTotal(), opts), `rent for ${s.name}`);
        }
        break;
      }
      case 'parking':
        if (this.settings.vacationCash && this.pot > 0) {
          const pot = this.pot;
          this.pot = 0;
          this.credit(p, pot, 'Vacation cash');
        }
        break;
      default:
        break; // go, jail (visiting)
    }
  }

  resolveTarget(target) {
    const idx = [];
    this.map.spaces.forEach((s, i) => s.type === target.type && idx.push(i));
    if (!idx.length) return null;
    const n = target.nth < 0 ? idx.length + target.nth : target.nth;
    return idx[Math.max(0, Math.min(idx.length - 1, n))];
  }

  nextOfType(from, type) {
    const len = this.map.spaces.length;
    for (let k = 1; k <= len; k++) {
      const i = (from + k) % len;
      if (this.map.spaces[i].type === type) return i;
    }
    return null;
  }

  cardText(card) {
    const target = card.target ? this.resolveTarget(card.target) : null;
    const typeName = { railroad: this.map.labels?.railroad || 'station', utility: this.map.labels?.utility || 'utility' };
    return card.text
      .replaceAll('{cur}', this.map.currency)
      .replaceAll('{target}', target !== null ? this.map.spaces[target].name : '')
      .replaceAll('{type}', typeName[card.type] || card.type || '');
  }

  drawCard(p, deck) {
    const pile = this.decks[deck];
    const card = pile.shift();
    if (card.action !== 'jailCard') pile.push(card);
    const text = this.cardText(card);
    const deckName = this.map.spaces.find((s) => s.type === deck)?.name || deck;
    this.lastCard = { deck, deckName, text, playerId: p.id, seq: this.logSeq + 1 };
    this.addLog(`${p.name} drew ${deckName}: "${text}"`);

    const others = this.players.filter((o) => o !== p && !o.bankrupt);
    switch (card.action) {
      case 'advance': {
        const target = this.resolveTarget(card.target);
        if (target === null) break;
        this.moveTo(p, target, true);
        this.landOn(p);
        break;
      }
      case 'nearest': {
        const target = this.nextOfType(p.position, card.type);
        if (target === null) break;
        this.moveTo(p, target, true);
        this.landOn(p, { rentMultiplier: card.rentMultiplier, utilityMultiplier: card.utilityMultiplier });
        break;
      }
      case 'back': {
        const len = this.map.spaces.length;
        p.position = (p.position - card.amount + len) % len;
        this.landOn(p);
        break;
      }
      case 'jail':
        this.sendToJail(p);
        break;
      case 'collect':
        this.credit(p, card.amount, 'card');
        break;
      case 'pay':
        this.pay(p, null, card.amount, 'card');
        break;
      case 'payEach':
        for (const o of others) this.pay(p, o, card.amount, 'card');
        break;
      case 'collectEach':
        for (const o of others) this.pay(o, p, card.amount, 'card');
        this.settleDebt(p);
        break;
      case 'repairs': {
        let houses = 0;
        let hotels = 0;
        for (const prop of Object.values(this.properties)) {
          if (prop.owner !== p.id) continue;
          if (prop.houses === 5) hotels++;
          else houses += prop.houses;
        }
        this.pay(p, null, houses * card.house + hotels * card.hotel, 'repairs');
        break;
      }
      case 'jailCard':
        p.jailCards.push({ deck, card });
        break;
      default:
        break;
    }
  }

  nextTurn() {
    const n = this.players.length;
    let i = this.turn.index;
    for (let k = 0; k < n; k++) {
      i = (i + 1) % n;
      if (!this.players[i].bankrupt) break;
    }
    this.turn = this.newTurn(i, this.turn.lastRoll);
    this.lastCard = null;
    this.addLog(`${this.players[i].name}'s turn`);
  }

  ownedSpace(p, space) {
    const i = Number(space);
    const s = this.map.spaces[i];
    if (!s || !OWNABLE.has(s.type)) fail('That is not a property');
    const prop = this.properties[i];
    if (prop.owner !== p.id) fail("You don't own that property");
    return { i, s, prop };
  }

  requireManage(p, mustBeCurrent) {
    if (this.auction) fail('Wait for the auction to finish');
    if (this.isCurrent(p)) return;
    // Players in debt may raise money (sell/mortgage) outside their turn.
    if (mustBeCurrent || p.cash >= 0) fail('You can only do that on your turn');
  }

  /** Choose the total (2–12) of the next dice roll, whoever rolls it. Pass null to clear. */
  setNextRoll(total) {
    if (total === null || total === undefined) {
      this.nextTotal = null;
      return;
    }
    const n = Number(total);
    if (!Number.isInteger(n) || n < 2 || n > 12) fail('Pick a total from 2 to 12');
    this.nextTotal = n;
  }

  /** Roll the dice, honouring a chosen total once (random split, e.g. 3 -> 1+2 or 2+1). */
  takeDice() {
    if (this.nextTotal === null) return this.rollDice();
    const t = this.nextTotal;
    this.nextTotal = null;
    const pairs = [];
    for (let a = 1; a <= 6; a++) if (t - a >= 1 && t - a <= 6) pairs.push([a, t - a]);
    return pairs[Math.floor(this.rng() * pairs.length)];
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                            */
  /* ------------------------------------------------------------------ */

  actRoll(p) {
    this.requireTurn(p, 'roll');
    if (p.cash < 0) fail('Raise funds or declare bankruptcy before rolling');
    const [a, b] = this.takeDice();
    const total = a + b;
    const doubles = a === b;
    this.turn.lastRoll = [a, b];
    this.turn.phase = 'moving';
    this.lastCard = null;
    this.addLog(`${p.name} rolled ${a} + ${b}${doubles ? ' (doubles!)' : ''}`);

    if (p.inJail) {
      this.turn.extraRoll = false;
      if (doubles) {
        this.releaseFromJail(p);
        this.addLog(`${p.name} rolled doubles and leaves jail`);
      } else {
        p.jailTurns += 1;
        if (p.jailTurns < 3) {
          this.addLog(`${p.name} stays in jail`);
          this.turn.phase = 'end';
          return;
        }
        this.releaseFromJail(p);
        this.pay(p, null, this.settings.jailFine, 'jail fine after 3 turns');
      }
    } else if (doubles) {
      this.turn.doublesCount += 1;
      if (this.turn.doublesCount >= 3) {
        this.addLog(`${p.name} rolled doubles three times — straight to jail`);
        this.sendToJail(p);
        this.turn.phase = 'end';
        return;
      }
      this.turn.extraRoll = true;
    } else {
      this.turn.extraRoll = false;
    }

    this.moveBy(p, total);
    this.landOn(p);
    this.advancePhase();
  }

  actBuy(p) {
    this.requireTurn(p, 'buy');
    const i = this.turn.pendingSpace;
    const s = this.map.spaces[i];
    if (p.cash < s.price) fail(`You can't afford ${s.name} (${this.money(s.price)})`);
    p.cash -= s.price;
    this.properties[i].owner = p.id;
    this.addLog(`${p.name} bought ${s.name} for ${this.money(s.price)}`);
    this.turn.pendingSpace = null;
    this.turn.phase = 'moving';
    this.advancePhase();
  }

  actDecline(p) {
    this.requireTurn(p, 'buy');
    const i = this.turn.pendingSpace;
    if (!this.settings.auction) {
      this.addLog(`${p.name} passed on ${this.map.spaces[i].name}`);
      this.turn.pendingSpace = null;
      this.turn.phase = 'moving';
      this.advancePhase();
      return;
    }
    this.auction = {
      space: i,
      highBid: 0,
      highBidder: null,
      active: this.players.filter((x) => !x.bankrupt).map((x) => x.id),
      endsAt: this.now() + this.settings.auctionSeconds * 1000,
    };
    this.turn.phase = 'auction';
    this.addLog(`${this.map.spaces[i].name} is up for auction`);
  }

  actBid(p, { amount }) {
    const a = this.auction;
    if (!a) fail('No auction is running');
    if (!a.active.includes(p.id)) fail('You have left this auction');
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= a.highBid) fail(`Bid more than ${this.money(a.highBid)}`);
    if (n > p.cash) fail("You can't afford that bid");
    a.highBid = n;
    a.highBidder = p.id;
    a.endsAt = this.now() + this.settings.auctionSeconds * 1000;
    this.addLog(`${p.name} bid ${this.money(n)}`);
    this.checkAuctionEnd();
  }

  actPass(p) {
    const a = this.auction;
    if (!a) fail('No auction is running');
    if (!a.active.includes(p.id)) fail('You have already left this auction');
    if (a.highBidder === p.id) fail('You are the highest bidder');
    a.active = a.active.filter((id) => id !== p.id);
    this.addLog(`${p.name} dropped out of the auction`);
    this.checkAuctionEnd();
  }

  checkAuctionEnd() {
    const a = this.auction;
    if (a.active.length === 0 || (a.active.length === 1 && a.active[0] === a.highBidder)) this.closeAuction();
  }

  closeAuction() {
    const a = this.auction;
    this.auction = null;
    const s = this.map.spaces[a.space];
    if (a.highBidder) {
      const w = this.getPlayer(a.highBidder);
      w.cash -= a.highBid;
      this.properties[a.space].owner = w.id;
      this.addLog(`${w.name} won ${s.name} for ${this.money(a.highBid)}`);
    } else {
      this.addLog(`No bids — ${s.name} stays with the bank`);
    }
    this.turn.pendingSpace = null;
    this.turn.phase = 'moving';
    this.advancePhase();
  }

  /** Called by the server's timer. Returns true if the auction closed. */
  timeoutAuction() {
    if (!this.auction || this.now() < this.auction.endsAt) return false;
    this.closeAuction();
    this.version++;
    return true;
  }

  actBuild(p, { space }) {
    this.requireManage(p, true);
    const { s, prop } = this.ownedSpace(p, space);
    if (s.type !== 'street') fail('You can only build on streets');
    const group = this.groupIndices(s.group);
    if (!this.ownsGroup(p.id, s.group)) fail('You need the whole colour set to build');
    if (group.some((j) => this.properties[j].mortgaged)) fail('Unmortgage the colour set first');
    if (prop.houses >= 5) fail('This property already has a hotel');
    const min = Math.min(...group.map((j) => this.properties[j].houses));
    if (this.settings.evenBuild && prop.houses > min) fail('Build evenly across the colour set');
    if (p.cash < s.houseCost) fail(`You need ${this.money(s.houseCost)} to build`);
    p.cash -= s.houseCost;
    prop.houses += 1;
    this.addLog(`${p.name} built ${prop.houses === 5 ? 'a hotel' : 'a house'} on ${s.name}`);
  }

  actSell(p, { space }) {
    this.requireManage(p, false);
    const { s, prop } = this.ownedSpace(p, space);
    if (!prop.houses) fail('There are no buildings to sell');
    const max = Math.max(...this.groupIndices(s.group).map((j) => this.properties[j].houses));
    if (this.settings.evenBuild && prop.houses < max) fail('Sell evenly across the colour set');
    prop.houses -= 1;
    this.credit(p, Math.floor(s.houseCost / 2), `sold a building on ${s.name}`);
  }

  actMortgage(p, { space }) {
    if (!this.settings.mortgage) fail('Mortgages are turned off in this game');
    this.requireManage(p, false);
    const { s, prop } = this.ownedSpace(p, space);
    if (prop.mortgaged) fail('Already mortgaged');
    if (s.type === 'street' && this.groupIndices(s.group).some((j) => this.properties[j].houses > 0)) {
      fail('Sell all buildings in this colour set first');
    }
    prop.mortgaged = true;
    this.credit(p, Math.floor(s.price / 2), `mortgaged ${s.name}`);
  }

  /** Sell a property back to the bank for half its price. It becomes available to buy again. */
  actSellProperty(p, { space }) {
    this.requireManage(p, false);
    const { s, prop } = this.ownedSpace(p, space);
    if (prop.mortgaged) fail('Unmortgage it before selling');
    if (s.type === 'street' && this.groupIndices(s.group).some((j) => this.properties[j].houses > 0)) {
      fail('Sell all buildings in this colour set first');
    }
    const value = Math.floor(s.price / 2);
    Object.assign(prop, { owner: null, houses: 0, mortgaged: false });
    p.cash += value;
    this.addLog(`${p.name} sold ${s.name} to the bank for ${this.money(value)}`);
    this.settleDebt(p);
  }

  unmortgageCost(i) {
    const raw = (this.map.spaces[i].price / 2) * (1 + this.settings.unmortgageInterest);
    return Math.ceil(Math.round(raw * 100) / 100); // avoid 220.00000000000003 -> 221
  }

  actUnmortgage(p, { space }) {
    this.requireManage(p, true);
    const { i, s, prop } = this.ownedSpace(p, space);
    if (!prop.mortgaged) fail('That property is not mortgaged');
    const cost = this.unmortgageCost(i);
    if (p.cash < cost) fail(`You need ${this.money(cost)} to unmortgage`);
    p.cash -= cost;
    prop.mortgaged = false;
    this.addLog(`${p.name} unmortgaged ${s.name} for ${this.money(cost)}`);
  }

  actPayFine(p) {
    this.requireTurn(p, 'roll');
    if (!p.inJail) fail("You're not in jail");
    if (p.cash < this.settings.jailFine) fail(`You need ${this.money(this.settings.jailFine)}`);
    p.cash -= this.settings.jailFine;
    this.releaseFromJail(p);
    this.addLog(`${p.name} paid ${this.money(this.settings.jailFine)} to leave jail`);
  }

  actUseCard(p) {
    this.requireTurn(p, 'roll');
    if (!p.inJail) fail("You're not in jail");
    if (!p.jailCards.length) fail("You don't have a Get Out of Jail Free card");
    const held = p.jailCards.pop();
    this.decks[held.deck].push(held.card);
    this.releaseFromJail(p);
    this.addLog(`${p.name} used a Get Out of Jail Free card`);
  }

  actEndTurn(p) {
    this.requireTurn(p, 'end');
    if (p.cash < 0) fail('You are in debt — sell, mortgage, or declare bankruptcy');
    this.nextTurn();
  }

  actBankrupt(p) {
    if (this.auction) fail('Wait for the auction to finish');
    const creditor =
      p.cash < 0 && p.debt && p.debt.to ? this.players.find((x) => x.id === p.debt.to && !x.bankrupt) : null;

    for (const [key, prop] of Object.entries(this.properties)) {
      if (prop.owner !== p.id) continue;
      const s = this.map.spaces[key];
      if (creditor) {
        if (prop.houses) creditor.cash += prop.houses * Math.floor(s.houseCost / 2);
        prop.houses = 0;
        prop.owner = creditor.id; // keeps mortgage status
      } else {
        Object.assign(prop, { owner: null, houses: 0, mortgaged: false });
      }
    }
    // The creditor was credited the full payment; take back what the debtor couldn't cover.
    if (creditor) creditor.cash -= Math.min(p.debt.amount, -p.cash);
    else if (p.cash < 0 && p.debt && this.settings.vacationCash) this.pot = Math.max(0, this.pot - Math.min(p.debt.amount, -p.cash));
    for (const held of p.jailCards) this.decks[held.deck].push(held.card);
    Object.assign(p, { bankrupt: true, cash: 0, debt: null, inJail: false, jailTurns: 0, jailCards: [] });
    this.addLog(`${p.name} is bankrupt${creditor ? ` — assets go to ${creditor.name}` : ''}`);

    const alive = this.players.filter((x) => !x.bankrupt);
    if (alive.length <= 1) {
      this.status = 'finished';
      this.winnerId = alive[0]?.id ?? null;
      this.turn.phase = 'over';
      if (alive[0]) this.addLog(`🏆 ${alive[0].name} wins the game!`);
      return;
    }
    if (this.current() === p) this.nextTurn();
  }

  /* ------------------------------------------------------------------ */
  /* Serialisation                                                      */
  /* ------------------------------------------------------------------ */

  publicState() {
    const m = this.map;
    return {
      id: this.id,
      status: this.status,
      hostId: this.hostId,
      version: this.version,
      settings: { ...this.settings },
      map: { id: m.id, name: m.name, description: m.description, currency: m.currency, icons: m.icons, labels: m.labels, groups: m.groups, spaces: m.spaces },
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        token: p.token,
        cash: p.cash,
        position: p.position,
        inJail: p.inJail,
        jailTurns: p.jailTurns,
        jailCards: p.jailCards.length,
        bankrupt: p.bankrupt,
        connected: p.connected,
      })),
      properties: this.properties,
      turn: this.turn,
      auction: this.auction,
      lastCard: this.lastCard,
      winnerId: this.winnerId,
      pot: this.pot,
      unmortgageInterest: this.settings.unmortgageInterest,
      log: this.log.slice(-60),
      serverTime: this.now(),
    };
  }
}

module.exports = { Game, GameError, ACTIONS };
