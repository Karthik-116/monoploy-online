// Client entry point: networking, view switching, lobby, game UI and animation timing.
// The client only renders server state and sends intents; the server validates everything.
import { buildBoard, updateTiles, deedHtml } from './board.js';
import { Dice, ROLL_MS } from './dice.js';
import { Pawns } from './pawns.js';
import { THEMES, getTheme, setTheme } from './themes.js';
import { ICONS } from './icons.js';
import { sfx } from './sound.js';
import { $, $$, escapeHtml, money, toast, show, copyText, avatar, tokenColor, storage, reducedMotion } from './ui.js';

/* global io */
const socket = io();
const HOP_MS = 175;

const store = {
  state: null,
  meta: { maps: [], tokens: [] },
  me: null, // my playerId (null = spectator)
  code: null,
  chat: [],
  boardMapId: null,
  dice: null,
  lastRollId: undefined,
  lastCardSeq: null,
  centerTimer: null,
  modal: null, // { type: 'deed' | 'maps' | 'look', index? }
  bankruptArmed: false,
  clockOffset: 0,
  sideKey: '',
  view: null,
};

/* ---------- identity (per tab, survives refresh) ---------- */
function randomSecret() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes); // works on plain http too (randomUUID does not)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
const session = (() => {
  const mem = {};
  return {
    get: (k) => { try { return sessionStorage.getItem(k); } catch { return mem[k] ?? null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { mem[k] = v; } },
    del: (k) => { try { sessionStorage.removeItem(k); } catch { delete mem[k]; } },
  };
})();
const secret = session.get('mono.secret') || randomSecret();
session.set('mono.secret', secret);
const savedName = () => storage.get('mono.name') || '';

/* ---------- networking ---------- */
function request(event, payload = {}) {
  return new Promise((resolve) => socket.emit(event, payload, (res) => resolve(res || { ok: false, error: 'No response from the server' })));
}
async function send(event, payload) {
  const res = await request(event, payload);
  if (!res.ok) toast(res.error, 'error');
  return res;
}
const act = (type, payload) => send('game:action', { type, payload });
const settings = (patch) => send('lobby:settings', patch);

async function enterRoom(event, payload) {
  const res = await request(event, { ...payload, secret });
  if (!res.ok) {
    $('#homeError').textContent = res.error;
    return false;
  }
  store.code = res.code;
  store.me = res.playerId;
  session.set('mono.room', res.code);
  const url = new URL(location.href);
  url.searchParams.set('room', res.code);
  history.replaceState(null, '', url);
  if (res.spectator) toast('This game has already started, so you are watching.');
  render(null); // the first state broadcast can arrive before this reply
  return true;
}

function leaveToHome(message = '') {
  session.del('mono.room');
  Object.assign(store, { state: null, code: null, me: null, chat: [], boardMapId: null, modal: null, lastRollId: undefined });
  $('#homeError').textContent = message;
  history.replaceState(null, '', location.pathname);
  render(null);
}

socket.on('meta', (meta) => {
  store.meta = meta;
  if (store.state) render(store.state);
});

socket.on('state', (s) => {
  const prev = store.state;
  store.clockOffset = s.serverTime - Date.now();
  store.state = s;
  render(prev);
});

socket.on('chat:history', (list) => {
  store.chat = list || [];
  renderFeed();
});
socket.on('chat', (entry) => {
  store.chat.push(entry);
  if (store.chat.length > 60) store.chat.shift();
  renderFeed();
});

socket.on('connect', () => {
  const code = store.code || session.get('mono.room');
  const urlCode = new URLSearchParams(location.search).get('room');
  if (!code || (urlCode && urlCode.toUpperCase() !== code)) return;
  enterRoom('room:join', { code, name: savedName() }).then((ok) => {
    if (!ok) leaveToHome('That game has ended because the server restarted. Create a new room to play again.');
  });
});
socket.on('disconnect', () => toast('Connection lost — reconnecting…', 'error'));

/* ---------- header ---------- */
function renderThemeMenu() {
  const cur = getTheme();
  $('#themeMenu').innerHTML = THEMES.map(
    (t) => `<button type="button" role="menuitemradio" aria-checked="${t.id === cur}" data-theme-id="${t.id}"><span class="sw" style="background:${t.swatch[0]};border-color:${t.swatch[1]}"></span>${t.name}</button>`,
  ).join('');
}
$('#themeBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const open = $('#themeMenu').classList.contains('hidden');
  renderThemeMenu();
  show($('#themeMenu'), open);
  $('#themeBtn').setAttribute('aria-expanded', String(open));
});
$('#themeMenu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme-id]');
  if (!b) return;
  setTheme(b.dataset.themeId);
  renderThemeMenu();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu')) show($('#themeMenu'), false);
});

function renderSoundBtn() {
  $('#soundBtn').innerHTML = sfx.muted ? ICONS.soundOff : ICONS.soundOn;
  $('#soundBtn').setAttribute('aria-label', sfx.muted ? 'Turn sounds on' : 'Mute sounds');
}
$('#soundBtn').addEventListener('click', () => {
  sfx.setMuted(!sfx.muted);
  renderSoundBtn();
});
renderSoundBtn();
document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

$('#leaveBtn').addEventListener('click', async () => {
  await request('room:leave');
  leaveToHome();
});

const inviteUrl = () => `${location.origin}/?room=${store.code}`;
async function copyInvite() {
  const ok = await copyText(inviteUrl(), $('#inviteLink'));
  toast(ok ? 'Invite link copied' : `Share this link: ${inviteUrl()}`);
}
async function shareInvite() {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Monopoly Online', text: `Join my Monopoly game — room ${store.code}`, url: inviteUrl() });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  copyInvite();
}
$('#copyLink').addEventListener('click', () => (navigator.share && matchMedia('(pointer: coarse)').matches ? shareInvite() : copyInvite()));
$('#shareTop').addEventListener('click', shareInvite);

/* ---------- home ---------- */
const homeDice = new Dice($('#homeDice'));
homeDice.show([3, 4], false);
const rollHome = () => {
  homeDice.show([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)], !reducedMotion());
  sfx.roll();
};
setTimeout(() => homeDice.show([5, 6], !reducedMotion()), 250);
$('#homeDice').addEventListener('click', rollHome);
$('#homeDice').addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), rollHome()));

$('#homeName').value = savedName();
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) $('#joinCode').value = urlRoom.toUpperCase();
function homeName() {
  const n = $('#homeName').value.trim();
  if (n) storage.set('mono.name', n);
  return n;
}
$('#createBtn').addEventListener('click', () => {
  $('#homeError').textContent = '';
  enterRoom('room:create', { name: homeName() });
});
$('#joinBtn').addEventListener('click', () => {
  $('#homeError').textContent = '';
  const code = $('#joinCode').value.trim();
  if (!code) {
    $('#homeError').textContent = 'Enter the 5-letter room code from your invite.';
    return;
  }
  enterRoom('room:join', { code, name: homeName() });
});
$('#joinCode').addEventListener('keydown', (e) => e.key === 'Enter' && $('#joinBtn').click());
$('#homeName').addEventListener('keydown', (e) => e.key === 'Enter' && ($('#joinCode').value ? $('#joinBtn') : $('#createBtn')).click());

/* ---------- room: chat, tabs, zoom ---------- */
$('#chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#chatInput');
  const text = input.value.trim();
  if (!text) return;
  const res = await send('chat:send', { text });
  if (res.ok) input.value = '';
});

$$('.tabs [data-tab]').forEach((b) =>
  b.addEventListener('click', () => {
    $('#roomView').dataset.tab = b.dataset.tab;
    $$('.tabs [data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    if (b.dataset.tab === 'chat') scrollFeed(true);
  }),
);

$('#zoomBtn').addEventListener('click', () => {
  const zoomed = $('#boardScroll').classList.toggle('zoomed');
  $('#zoomBtn').textContent = zoomed ? 'Show the whole board' : 'Zoom in on the board';
  if (zoomed) requestAnimationFrame(scrollToMe);
});
function scrollToMe() {
  const s = store.state;
  if (!s) return;
  const me = s.players.find((p) => p.id === store.me) || s.players[s.turn ? s.turn.index : 0];
  const tile = $(`.tile[data-index="${me ? me.position : 0}"]`);
  const sc = $('#boardScroll');
  if (!tile) return;
  sc.scrollTo({ left: tile.offsetLeft - sc.clientWidth / 2 + tile.offsetWidth / 2, top: tile.offsetTop - sc.clientHeight / 2 + tile.offsetHeight / 2, behavior: 'smooth' });
}

const phone = window.matchMedia('(max-width: 760px)');
function placeControls() {
  const controls = $('#controls');
  if (!controls) return;
  const target = phone.matches ? $('#dock') : $('.center');
  if (controls.parentElement !== target) target.appendChild(controls);
}
phone.addEventListener('change', placeControls);

/* ---------- delegated clicks ---------- */
document.addEventListener('click', async (e) => {
  const t = e.target;

  const actionBtn = t.closest('[data-action]');
  if (actionBtn && !actionBtn.disabled) {
    const a = actionBtn.dataset.action;
    if (a === 'start') {
      const res = await request('game:start');
      if (!res.ok) toast(res.error, 'error');
    } else if (a === 'restart') {
      send('game:restart');
    } else if (a === 'bankrupt') {
      if (!store.bankruptArmed) {
        store.bankruptArmed = true;
        renderCenter(store.state);
        setTimeout(() => {
          store.bankruptArmed = false;
          if (store.state?.status === 'playing') renderCenter(store.state);
        }, 4000);
      } else {
        store.bankruptArmed = false;
        act('bankrupt');
      }
    } else {
      act(a);
    }
    return;
  }

  const inc = t.closest('[data-bid-inc]');
  if (inc && !inc.disabled) return act('bid', { amount: Number(inc.dataset.amount) });
  if (t.closest('#bidCustom')) {
    const amount = Number($('#bidInput').value);
    $('#bidInput').value = '';
    return act('bid', { amount });
  }
  if (t.closest('#bidPass')) return act('pass');

  const sw = t.closest('.switch[data-setting]');
  if (sw && !sw.disabled) return settings({ [sw.dataset.setting]: sw.getAttribute('aria-checked') !== 'true' });

  const open = t.closest('[data-open]');
  if (open) return openModal({ type: open.dataset.open });
  const mapBtn = t.closest('[data-map]');
  if (mapBtn && !mapBtn.disabled) {
    await settings({ mapId: mapBtn.dataset.map });
    return closeModal();
  }
  const look = t.closest('[data-look]');
  if (look && !look.disabled) return send('lobby:update', { token: look.dataset.look });

  const tile = t.closest('.tile[data-index], [data-deed-open]');
  if (tile && store.state && store.state.status !== 'lobby') {
    return openModal({ type: 'deed', index: Number(tile.dataset.index ?? tile.dataset.deedOpen) });
  }
  const deed = t.closest('[data-deed]');
  if (deed) {
    if (deed.dataset.deed === 'close') return closeModal();
    return act(deed.dataset.deed, { space: Number(deed.dataset.space) });
  }
  if (t.closest('[data-close]') || t.id === 'modal') closeModal();
});

document.addEventListener('change', (e) => {
  const sel = e.target.closest('select[data-setting]');
  if (sel) settings({ [sel.dataset.setting]: Number(sel.value) });
  if (e.target.id === 'lookName') {
    const name = e.target.value.trim();
    if (name) {
      storage.set('mono.name', name);
      send('lobby:update', { name });
    }
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Enter' && e.target.id === 'bidInput') $('#bidCustom').click();
});
$('#appearanceBtn').addEventListener('click', () => openModal({ type: 'look' }));

/* ---------- modal ---------- */
function openModal(m) {
  store.modal = m;
  renderModal();
}
function closeModal() {
  store.modal = null;
  show($('#modal'), false);
}
function renderModal() {
  const s = store.state;
  const m = store.modal;
  if (!m || !s) return closeModal();
  const card = $('#modalCard');
  card.classList.toggle('wide', m.type === 'maps');
  const head = (title) => `<div class="modal-head"><h3>${title}</h3><button class="icon-btn" data-close type="button" aria-label="Close">${ICONS.close}</button></div>`;

  if (m.type === 'deed') {
    if (s.status === 'lobby') return closeModal();
    card.innerHTML = deedHtml(s, m.index, store.me);
  } else if (m.type === 'maps') {
    const isHost = s.hostId === store.me && s.status === 'lobby';
    card.innerHTML = `${head('Choose a board')}<div class="modal-body"><div class="map-grid">${store.meta.maps
      .map(
        (mp) => `<button type="button" class="map-card" data-map="${mp.id}" aria-pressed="${mp.id === s.map.id}" ${isHost ? '' : 'disabled'}>
          <div class="swatches">${mp.colors.map((c) => `<span style="background:${c}"></span>`).join('')}</div>
          <strong>${escapeHtml(mp.name)}</strong><p>${escapeHtml(mp.description)}</p><p>${mp.sample.map(escapeHtml).join(', ')}…</p></button>`,
      )
      .join('')}</div>${isHost ? '' : '<p class="muted" style="margin:12px 0 0">Only the host can change the board.</p>'}</div>`;
  } else if (m.type === 'look') {
    const me = s.players.find((p) => p.id === store.me);
    if (!me || s.status !== 'lobby') return closeModal();
    const takenBy = new Map(s.players.filter((p) => p.id !== me.id).map((p) => [p.token, p.name]));
    const focused = document.activeElement && document.activeElement.id === 'lookName';
    if (focused) {
      // Don't wipe the name field while someone is typing; just refresh the colours.
      $('.look-grid', card).outerHTML = lookGrid(me, takenBy);
      return;
    }
    card.innerHTML = `${head('Change appearance')}<div class="modal-body">
      <label class="label" for="lookName">Name</label>
      <input id="lookName" class="field" maxlength="20" value="${escapeHtml(me.name)}" style="margin-bottom:16px" />
      <span class="label">Colour</span>${lookGrid(me, takenBy)}
      <button class="btn btn-primary btn-block" data-close type="button">Done</button></div>`;
  }
  show($('#modal'), true);
}
function lookGrid(me, takenBy) {
  return `<div class="look-grid">${store.meta.tokens
    .map((t) => {
      const owner = takenBy.get(t);
      return `<button type="button" class="look-btn" data-look="${t}" aria-pressed="${me.token === t}" ${owner ? 'disabled' : ''} aria-label="${t}${owner ? `, taken by ${escapeHtml(owner)}` : ''}">${avatar(t)}<span>${owner ? escapeHtml(owner) : t}</span></button>`;
    })
    .join('')}</div>`;
}

/* ---------- rendering ---------- */
function render(prev) {
  const s = store.state;
  const view = !s || !store.code ? 'home' : 'room';
  if (view !== store.view) window.scrollTo(0, 0);
  store.view = view;
  show($('#homeView'), view === 'home');
  show($('#roomView'), view === 'room');
  show($('#roomChip'), view === 'room');
  show($('#leaveBtn'), view === 'room');
  if (view === 'home') {
    store.boardMapId = null;
    return;
  }
  $('#roomCode').textContent = store.code;
  renderRoom(s, prev && prev.id === s.id ? prev : null);
}

function renderRoom(s, prev) {
  const room = $('#roomView');
  room.classList.toggle('in-game', s.status !== 'lobby');
  $('#inviteLink').value = inviteUrl();
  $('#sideTab').textContent = s.status === 'lobby' ? 'Settings' : 'Properties';

  // Board (rebuilt only when the map changes)
  if (store.boardMapId !== s.map.id) {
    $('#dock').innerHTML = '';
    buildBoard($('#board'), s.map);
    store.boardMapId = s.map.id;
    store.dice = new Dice($('#diceTray'));
    store.dice.show(s.turn?.lastRoll || [5, 6], false);
    store.pawns = store.pawns || new Pawns($('#pawns'), $('#board'));
    store.pawns.reset();
    store.lastRollId = undefined;
    placeControls();
  }

  // New dice roll? Animate, then move the pawn, then reveal what happened.
  const rollLog = s.log.filter((l) => / rolled \d/.test(l.text)).at(-1);
  const rollId = rollLog ? rollLog.id : 0;
  const newRoll = store.lastRollId !== undefined && rollId > store.lastRollId && s.turn?.lastRoll;
  store.lastRollId = rollId;
  let delay = 0;
  if (newRoll) {
    const animate = !reducedMotion();
    store.dice.show(s.turn.lastRoll, animate);
    if (animate) {
      sfx.roll();
      delay = ROLL_MS - 100;
    }
  } else if (s.turn?.lastRoll && store.dice.values.join() !== s.turn.lastRoll.join()) {
    store.dice.show(s.turn.lastRoll, false);
  }
  store.dice.setIdle(s.status === 'lobby' || !s.turn?.lastRoll);

  // How long until the moving pawn lands (for revealing results after the move).
  let landDelay = delay;
  if (prev && prev.status === 'playing' && newRoll) {
    const n = s.map.spaces.length;
    const mover = prev.players[prev.turn.index];
    const now = mover && s.players.find((p) => p.id === mover.id);
    if (now) {
      const steps = (now.position - mover.position + n) % n;
      if (steps > 0 && steps <= 12 && !now.inJail) landDelay = delay + steps * HOP_MS;
      else if (steps) landDelay = delay + 700;
    }
  }

  const prevOwners = prev ? Object.fromEntries(Object.entries(prev.properties).map(([k, v]) => [k, v.owner])) : null;
  updateTiles($('#board'), s, prevOwners);
  store.pawns.sync(s, { delay });

  // Centre (status, actions, auction, card) appears once the pawn has landed.
  clearTimeout(store.centerTimer);
  if (newRoll && landDelay > 0) {
    const roller = s.players.find((p) => p.id === (prev ? prev.players[prev.turn.index]?.id : null)) || s.players[s.turn.index];
    $('#status').innerHTML = `<span>${avatar(roller.token)}${roller.id === store.me ? 'You' : escapeHtml(roller.name)} rolled ${s.turn.lastRoll[0] + s.turn.lastRoll[1]}</span>`;
    $('#actions').innerHTML = '';
    show($('#cardPanel'), false);
    store.centerTimer = setTimeout(() => renderCenter(store.state), landDelay + 120);
  } else {
    renderCenter(s);
  }

  renderPlayers(s, prev, landDelay);
  renderSide(s);
  renderFeed();
  if (store.modal) renderModal();

  // A little chime when it becomes your turn.
  if (prev && s.status === 'playing' && prev.turn && prev.turn.index !== s.turn.index && s.players[s.turn.index].id === store.me) {
    setTimeout(() => sfx.turn(), landDelay);
  }
}

function renderCenter(s) {
  if (!s || !$('#status')) return;
  const me = s.players.find((p) => p.id === store.me);
  const m = (n) => money(s.map, n);
  const btn = (action, label, cls = '', disabled = false) =>
    `<button type="button" class="btn ${cls}" data-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  const out = [];
  let status = '';

  if (s.status === 'lobby') {
    const host = s.players.find((p) => p.id === s.hostId);
    const isHost = s.hostId === store.me;
    if (isHost) {
      status = `<span>${s.players.length < 2 ? 'Send the invite link — you need at least one friend to play' : 'Everyone in? Start whenever you are ready'}</span>`;
      out.push(btn('start', 'Start game', 'btn-primary btn-lg', s.players.length < 2));
    } else {
      status = `<span>Waiting for ${host ? `${avatar(host.token)}${escapeHtml(host.name)}` : 'the host'} to start the game…</span>`;
    }
    out.push(`<div class="room-code-note">${s.players.length} of ${s.settings.maxPlayers} players · room ${escapeHtml(s.id)}</div>`);
  } else {
    const cur = s.players[s.turn.index];
    const myTurn = s.status === 'playing' && me && cur.id === me.id;
    if (s.status === 'finished') {
      const w = s.players.find((p) => p.id === s.winnerId);
      status = `<span class="winner">${w ? `${avatar(w.token)}${escapeHtml(w.name)} wins!` : 'Game over'}</span>`;
      if (s.hostId === store.me) out.push(btn('restart', 'Play again', 'btn-primary btn-lg'));
      else out.push('<div class="room-code-note">Waiting for the host to start a new game</div>');
    } else {
      const hints = { roll: cur.inJail ? 'is in jail' : 'is about to roll', buy: 'is deciding whether to buy', auction: 'An auction is running', end: 'is finishing their turn' };
      status = myTurn
        ? `<span>${avatar(cur.token)}Your turn</span>${cur.inJail ? '<span class="hint">You are in jail. Roll doubles, pay the fine or use a card.</span>' : ''}`
        : `<span>${avatar(cur.token)}${escapeHtml(cur.name)}</span><span class="hint">${s.turn.phase === 'auction' ? hints.auction : hints[s.turn.phase] || ''}</span>`;
    }

    if (s.status === 'playing' && me && !me.bankrupt) {
      if (me.cash < 0) out.push(`<div class="note">You owe ${m(-me.cash)}. Sell buildings or mortgage from your properties, or declare bankruptcy.</div>`);
      if (myTurn) {
        const ph = s.turn.phase;
        if (ph === 'roll') {
          if (me.inJail) {
            out.push(btn('roll', 'Roll for doubles', 'btn-primary btn-lg', me.cash < 0));
            out.push(btn('payFine', `Pay ${m(s.settings.jailFine)}`, '', me.cash < s.settings.jailFine));
            if (me.jailCards > 0) out.push(btn('useCard', 'Use jail card'));
          } else {
            out.push(btn('roll', 'Roll the dice', 'btn-primary btn-lg', me.cash < 0));
          }
        } else if (ph === 'buy') {
          const sp = s.map.spaces[s.turn.pendingSpace];
          out.push(btn('buy', `Buy ${escapeHtml(sp.name)} for ${m(sp.price)}`, 'btn-primary btn-lg', me.cash < sp.price));
          out.push(btn('auction', s.settings.auction ? 'Auction it' : 'Skip'));
        } else if (ph === 'end') {
          out.push(btn('endTurn', 'End turn', 'btn-primary btn-lg', me.cash < 0));
        }
      }
      if ((myTurn || me.cash < 0) && !s.auction) {
        out.push(btn('bankrupt', store.bankruptArmed ? 'Tap again to go bankrupt' : 'Bankrupt', 'btn-danger btn-sm'));
      }
    } else if (!me && s.status === 'playing') {
      out.push('<div class="room-code-note">You are watching this game</div>');
    }
  }

  $('#status').innerHTML = status;
  $('#actions').innerHTML = out.join('');

  // Drawn card (flips in when new)
  const card = s.lastCard;
  show($('#cardPanel'), !!card);
  if (card) {
    const who = s.players.find((p) => p.id === card.playerId);
    $('#cardPanel').innerHTML = `<b>${escapeHtml(card.deckName)}</b>${who && who.id !== store.me ? `${escapeHtml(who.name)}: ` : ''}${escapeHtml(card.text)}`;
    if (store.lastCardSeq !== card.seq) {
      $('#cardPanel').classList.remove('flip-in');
      void $('#cardPanel').offsetWidth;
      $('#cardPanel').classList.add('flip-in');
      sfx.card();
    }
    store.lastCardSeq = card.seq;
  }
  renderAuction(s, me);
}

function renderAuction(s, me) {
  const a = s.auction;
  const panel = $('#auctionPanel');
  show(panel, !!a);
  if (!a) return;
  const sp = s.map.spaces[a.space];
  const high = s.players.find((p) => p.id === a.highBidder);
  $('.auction-title', panel).textContent = `Auction: ${sp.name}`;
  $('.auction-bid', panel).innerHTML = high
    ? `Highest bid <strong>${money(s.map, a.highBid)}</strong> by ${escapeHtml(high.id === store.me ? 'you' : high.name)}`
    : `No bids yet · list price ${money(s.map, sp.price)}`;
  const inIt = me && a.active.includes(me.id);
  panel.querySelectorAll('[data-bid-inc]').forEach((b) => {
    const amount = a.highBid + Number(b.dataset.bidInc);
    b.textContent = money(s.map, amount);
    b.dataset.amount = amount;
    b.disabled = !inIt || amount > me.cash;
  });
  $('#bidCustom').disabled = !inIt;
  $('#bidInput').disabled = !inIt;
  $('#bidPass').disabled = !inIt || a.highBidder === me?.id;
  $('#bidPass').textContent = inIt ? 'Pass' : 'You passed';
}

setInterval(() => {
  const a = store.state?.auction;
  if (!a) return;
  const total = (store.state.settings.auctionSeconds || 10) * 1000;
  const left = Math.max(0, a.endsAt - (Date.now() + store.clockOffset));
  const bar = $('#auctionPanel .auction-timer div');
  if (bar) bar.style.width = `${(left / total) * 100}%`;
}, 200);

function renderPlayers(s, prev, floatDelay) {
  const inGame = s.status !== 'lobby';
  $('#playerList').innerHTML = s.players
    .map((p, i) => {
      const sub = [
        p.id === store.me ? 'You' : '',
        p.inJail ? `In jail (${p.jailTurns}/3)` : '',
        p.jailCards ? `${p.jailCards} jail card${p.jailCards > 1 ? 's' : ''}` : '',
        p.bankrupt ? 'Bankrupt' : '',
        p.connected ? '' : 'Offline',
      ].filter(Boolean);
      const isTurn = s.status === 'playing' && s.turn.index === i;
      const host = p.id === s.hostId ? `<span class="crown">${ICONS.crown}Host</span>` : '';
      return `<li class="player${isTurn ? ' turn' : ''}${p.bankrupt ? ' out' : ''}${p.connected ? '' : ' offline'}" style="--c:${tokenColor(p.token)}" data-pid="${p.id}">
        ${avatar(p.token)}
        <div style="min-width:0"><div class="player-name"><span style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.name)}</span>${host}</div>${sub.length ? `<div class="player-sub">${sub.join(' · ')}</div>` : ''}</div>
        ${inGame ? `<div class="player-cash${p.cash < 0 ? ' neg' : ''}">${money(s.map, p.cash)}</div>` : ''}
      </li>`;
    })
    .join('');
  show($('#youRow'), s.status === 'lobby' && !!s.players.find((p) => p.id === store.me));

  // Money floaters (+£200 / −£50) beside each player's cash.
  if (!prev || prev.status !== 'playing' || s.status !== 'playing') return;
  for (const p of s.players) {
    const before = prev.players.find((x) => x.id === p.id);
    if (!before || before.cash === p.cash) continue;
    const diff = p.cash - before.cash;
    setTimeout(() => {
      const el = $(`.player[data-pid="${p.id}"] .player-cash`);
      if (!el || !el.offsetParent) return;
      const r = el.getBoundingClientRect();
      const f = document.createElement('div');
      f.className = `floater ${diff > 0 ? 'gain' : 'loss'}`;
      f.textContent = `${diff > 0 ? '+' : '−'}${s.map.currency}${Math.abs(diff).toLocaleString('en-US')}`;
      f.style.left = `${r.left - 8}px`;
      f.style.top = `${r.top + r.height / 2}px`;
      $('#fx').appendChild(f);
      setTimeout(() => f.remove(), 1500);
      if (p.id === store.me) (diff > 0 ? sfx.gain : sfx.loss)();
    }, floatDelay);
  }
}

const RULES = [
  ['doubleRentOnSet', 'coins', 'x2 rent on full sets', 'Owning a whole colour set doubles its base rent'],
  ['vacationCash', 'palm', 'Vacation cash', 'Taxes and bank fees build a pot that pays out on Free Parking'],
  ['auction', 'gavel', 'Auction', 'Properties a player skips are sold to the highest bidder'],
  ['noRentInJail', 'lock', 'No rent from jail', 'Owners in jail don’t collect rent'],
  ['mortgage', 'bank', 'Mortgage', 'Borrow half a property’s price; mortgaged properties earn no rent'],
  ['evenBuild', 'building', 'Even build', 'Houses and hotels go up and come down evenly across a set'],
  ['randomizeOrder', 'shuffle', 'Random turn order', 'Shuffle who goes first when the game starts'],
];

function renderSide(s) {
  const isHost = s.hostId === store.me;
  const key = JSON.stringify([s.status, s.settings, s.map.id, isHost, s.status === 'lobby' ? 0 : [s.properties, store.me]]);
  if (key === store.sideKey) return;
  store.sideKey = key;
  const el = $('#sidePanel');

  if (s.status === 'lobby') {
    const dis = isHost ? '' : 'disabled';
    const cashOpts = [...new Set([1000, 1500, 2000, 2500, 3000, s.settings.startingCash])].sort((a, b) => a - b);
    const row = (icon, title, desc, control) =>
      `<div class="setting"><span class="row-icon">${ICONS[icon]}</span><div><div class="setting-title">${title}</div><div class="setting-desc">${desc}</div></div>${control}</div>`;
    el.innerHTML = `
      <h2 class="panel-title">Game settings</h2>
      ${isHost ? '' : '<p class="settings-note">Only the host can change these</p>'}
      ${row('users', 'Maximum players', 'How many people can join this room', `<select class="select" data-setting="maxPlayers" aria-label="Maximum players" ${dis}>${[2, 3, 4, 5, 6].map((n) => `<option ${n === s.settings.maxPlayers ? 'selected' : ''}>${n}</option>`).join('')}</select>`)}
      ${row('map', 'Board', 'Street names, colours and look of the board', `<div class="map-pick"><strong>${escapeHtml(s.map.name)}</strong><button type="button" class="link-btn" data-open="maps">${isHost ? 'Browse boards' : 'View boards'}</button></div>`)}
      ${row('cash', 'Starting cash', 'Money each player starts with', `<select class="select" data-setting="startingCash" aria-label="Starting cash" ${dis}>${cashOpts.map((n) => `<option value="${n}" ${n === s.settings.startingCash ? 'selected' : ''}>${money(s.map, n)}</option>`).join('')}</select>`)}
      <h3 class="settings-sep">Gameplay rules</h3>
      ${RULES.map(([k, icon, title, desc]) => row(icon, title, desc, `<button type="button" class="switch" role="switch" aria-checked="${!!s.settings[k]}" aria-label="${title}" data-setting="${k}" ${dis}></button>`)).join('')}`;
    return;
  }

  // In game: my properties grouped by colour set
  const mine = Object.entries(s.properties).filter(([, pr]) => pr.owner && pr.owner === store.me);
  if (!store.me) {
    el.innerHTML = '<h2 class="panel-title">Properties</h2><p class="feed-empty">Tap any square on the board to see who owns it.</p>';
    return;
  }
  if (!mine.length) {
    el.innerHTML = '<h2 class="panel-title">Your properties</h2><p class="feed-empty">You don’t own anything yet. Land on a property to buy it.</p>';
    return;
  }
  const groups = new Map();
  for (const [idx, pr] of mine) {
    const sp = s.map.spaces[idx];
    const key = sp.group || sp.type;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push([idx, sp, pr]);
  }
  const labels = s.map.labels || {};
  el.innerHTML = `<h2 class="panel-title">Your properties</h2>${[...groups]
    .map(([key, items]) => {
      const g = s.map.groups[key];
      const name = g ? g.name : key === 'railroad' ? labels.railroad || 'Stations' : labels.utility || 'Utilities';
      const color = g ? g.color : 'var(--muted)';
      return `<div class="props-group" style="--g:${color}"><h4><i></i>${escapeHtml(name.charAt(0).toUpperCase() + name.slice(1))}</h4><div class="prop-chips">${items
        .map(([idx, sp, pr]) => `<button type="button" class="prop-chip${pr.mortgaged ? ' mortgaged' : ''}" data-deed-open="${idx}">${escapeHtml(sp.name)}${pr.houses ? `<small>${pr.houses === 5 ? 'hotel' : `${pr.houses}h`}</small>` : ''}</button>`)
        .join('')}</div></div>`;
    })
    .join('')}<p class="setting-desc" style="text-align:center">Tap a property to build, sell or mortgage.</p>`;
}

/* chat + game events in one feed */
function scrollFeed(force) {
  const sc = $('#feedScroll');
  if (force || sc.dataset.stick !== '0') sc.scrollTop = sc.scrollHeight;
}
$('#feedScroll').addEventListener('scroll', () => {
  const sc = $('#feedScroll');
  sc.dataset.stick = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 40 ? '1' : '0';
});
function renderFeed() {
  const s = store.state;
  if (!s) return;
  show($('#chatForm'), !!store.me);
  const items = [
    ...s.log.map((l) => ({ kind: 'ev', t: l.t || 0, id: l.id, text: l.text })),
    ...store.chat.map((c) => ({ kind: 'msg', t: c.t, id: c.id, playerId: c.playerId, text: c.text })),
  ]
    .sort((a, b) => a.t - b.t || (a.kind === b.kind ? a.id - b.id : 0))
    .slice(-90);
  const html = items.length
    ? items
        .map((it) => {
          if (it.kind === 'ev') return `<li class="ev">${escapeHtml(it.text)}</li>`;
          const p = s.players.find((x) => x.id === it.playerId);
          return `<li class="msg" style="--c:${tokenColor(p?.token)}">${avatar(p?.token)}<p><b>${escapeHtml(p ? p.name : 'Someone')}</b>${escapeHtml(it.text)}</p></li>`;
        })
        .join('')
    : '<li class="feed-empty">No messages yet. Say hi to the table.</li>';
  const feed = $('#feed');
  if (feed.dataset.html === html) return;
  feed.innerHTML = html;
  feed.dataset.html = html;
  scrollFeed(false);
}

render(null);
