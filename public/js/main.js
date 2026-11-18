// Client entry point: networking, view switching, lobby and in-game UI.
// The client only renders server state and sends intents; the server validates everything.
import { buildBoard, updateBoard, renderDice, deedHtml } from './board.js';
import { THEMES, getTheme, setTheme } from './themes.js';
import { $, escapeHtml, money, toast, show, copyText, playerColor } from './ui.js';

/* global io */
const socket = io();

const store = {
  state: null,
  meta: { maps: [], tokens: [] },
  me: null, // my playerId (null = spectator)
  code: null,
  boardMapId: null,
  modalSpace: null,
  clockOffset: 0,
  lastRollKey: '',
  lastCardSeq: null,
  bankruptArmed: false,
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

const savedName = () => { try { return localStorage.getItem('mono.name') || ''; } catch { return ''; } };
const saveName = (n) => { try { localStorage.setItem('mono.name', n); } catch { /* ignore */ } };

/* ---------- networking ---------- */
function request(event, payload = {}) {
  return new Promise((resolve) => socket.emit(event, payload, (res) => resolve(res || { ok: false, error: 'No response' })));
}

async function act(type, payload) {
  const res = await request('game:action', { type, payload });
  if (!res.ok) toast(res.error, 'error');
  return res;
}

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
  if (res.spectator) toast('That game is already running — you are watching as a spectator.');
  render(); // the first state broadcast can arrive before this reply
  return true;
}

socket.on('meta', (meta) => {
  store.meta = meta;
  populateMapSelect();
});

socket.on('state', (s) => {
  store.clockOffset = s.serverTime - Date.now();
  store.state = s;
  render();
});

socket.on('connect', () => {
  // Rejoin after a refresh or a dropped connection.
  const code = store.code || session.get('mono.room');
  const urlCode = new URLSearchParams(location.search).get('room');
  if (code && (!urlCode || urlCode.toUpperCase() === code)) {
    enterRoom('room:join', { code, name: savedName() }).then((ok) => {
      if (ok) return;
      // The room is gone (e.g. the free server went to sleep or restarted).
      session.del('mono.room');
      Object.assign(store, { state: null, code: null, me: null, boardMapId: null });
      $('#homeError').textContent = 'That game has ended (the server restarted). Create a new room to play again.';
      history.replaceState(null, '', location.pathname);
      render();
    });
  }
});

socket.on('disconnect', () => toast('Connection lost — reconnecting…', 'error'));

/* ---------- home ---------- */
$('#homeName').value = savedName();
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) $('#joinCode').value = urlRoom.toUpperCase();

function homeName() {
  const n = $('#homeName').value.trim();
  if (n) saveName(n);
  return n;
}
$('#createBtn').addEventListener('click', () => {
  $('#homeError').textContent = '';
  enterRoom('room:create', { name: homeName() });
});
$('#joinBtn').addEventListener('click', () => {
  $('#homeError').textContent = '';
  const code = $('#joinCode').value.trim();
  if (!code) return ($('#homeError').textContent = 'Enter a room code');
  enterRoom('room:join', { code, name: homeName() });
});
$('#joinCode').addEventListener('keydown', (e) => e.key === 'Enter' && $('#joinBtn').click());
$('#homeName').addEventListener('keydown', (e) => e.key === 'Enter' && ($('#joinCode').value ? $('#joinBtn') : $('#createBtn')).click());

$('#leaveBtn').addEventListener('click', async () => {
  await request('room:leave');
  session.del('mono.room');
  Object.assign(store, { state: null, code: null, me: null, boardMapId: null });
  history.replaceState(null, '', location.pathname);
  render();
});

/* ---------- themes ---------- */
function renderThemeControls() {
  const current = getTheme();
  $('#themeSelect').innerHTML = THEMES.map((t) => `<option value="${t.id}" ${t.id === current ? 'selected' : ''}>${t.name}</option>`).join('');
  $('#themeSwatches').innerHTML = THEMES.map(
    (t) => `<button type="button" data-theme-id="${t.id}" class="${t.id === current ? 'active' : ''}"><i style="background:${t.swatch[0]};border:2px solid ${t.swatch[1]}"></i>${t.name}</button>`,
  ).join('');
}
$('#themeSelect').addEventListener('change', (e) => {
  setTheme(e.target.value);
  renderThemeControls();
});
$('#themeSwatches').addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme-id]');
  if (!b) return;
  setTheme(b.dataset.themeId);
  renderThemeControls();
});
renderThemeControls();

/* ---------- invite links ---------- */
const inviteUrl = () => `${location.origin}/?room=${store.code}`;
async function copyInvite() {
  const ok = await copyText(inviteUrl(), $('#inviteLink'));
  toast(ok ? 'Invite link copied' : `Share this link: ${inviteUrl()}`);
}
// On phones, open the native share sheet (WhatsApp, Messages…); otherwise copy.
async function shareInvite() {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Monopoly Online', text: `Join my Monopoly game! Room ${store.code}`, url: inviteUrl() });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  copyInvite();
}
show($('#shareLink'), !!navigator.share);
$('#copyLink').addEventListener('click', copyInvite);
$('#shareLink').addEventListener('click', shareInvite);
$('#copyLinkTop').addEventListener('click', shareInvite);

/* ---------- phone layout: controls dock + board zoom ---------- */
const phone = window.matchMedia('(max-width: 760px)');
function placeControls() {
  const controls = $('#controls');
  if (!controls) return;
  const target = phone.matches ? $('#dock') : $('.center-inner');
  if (controls.parentElement !== target) target.appendChild(controls);
}
phone.addEventListener('change', placeControls);

$('#zoomBtn').addEventListener('click', () => {
  const wrap = $('#boardWrap');
  const zoomed = wrap.classList.toggle('zoomed');
  $('#zoomBtn').textContent = zoomed ? '↩︎ Fit board' : '🔍 Zoom board';
  if (zoomed) scrollToMyToken();
});
function scrollToMyToken() {
  const s = store.state;
  const me = s && s.players.find((p) => p.id === store.me);
  const idx = me ? me.position : s ? s.players[s.turn.index].position : 0;
  const cell = $(`.space[data-index="${idx}"]`);
  const wrap = $('#boardWrap');
  if (!cell) return;
  requestAnimationFrame(() => {
    wrap.scrollTo({
      left: cell.offsetLeft - wrap.clientWidth / 2 + cell.offsetWidth / 2,
      top: cell.offsetTop - wrap.clientHeight / 2 + cell.offsetHeight / 2,
      behavior: 'smooth',
    });
  });
}

/* ---------- lobby ---------- */
function populateMapSelect() {
  $('#mapSelect').innerHTML = store.meta.maps.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
  if (store.state) render();
}

async function settings(patch) {
  const res = await request('lobby:settings', patch);
  if (!res.ok) toast(res.error, 'error');
}
$('#mapSelect').addEventListener('change', (e) => settings({ mapId: e.target.value }));
$('#maxPlayersSelect').addEventListener('change', (e) => settings({ maxPlayers: Number(e.target.value) }));
$('#cashSelect').addEventListener('change', (e) => settings({ startingCash: Number(e.target.value) }));
$('#lobbyName').addEventListener('change', async (e) => {
  const name = e.target.value.trim();
  if (!name) return;
  saveName(name);
  const res = await request('lobby:update', { name });
  if (!res.ok) toast(res.error, 'error');
});
$('#tokenPicker').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-token]');
  if (!b || b.disabled) return;
  const res = await request('lobby:update', { token: b.dataset.token });
  if (!res.ok) toast(res.error, 'error');
});
$('#startBtn').addEventListener('click', async () => {
  const res = await request('game:start');
  $('#lobbyError').textContent = res.ok ? '' : res.error;
});

function renderLobby(s) {
  const isHost = s.hostId === store.me;
  const me = s.players.find((p) => p.id === store.me);
  $('#lobbyCode').textContent = s.id;
  $('#inviteLink').value = inviteUrl();
  $('#playerCount').textContent = `(${s.players.length}/${s.settings.maxPlayers})`;

  const rows = s.players.map((p, i) => {
    const tags = [p.id === s.hostId ? 'host' : '', p.id === store.me ? 'you' : '', p.connected ? '' : 'offline'].filter(Boolean).join(' · ');
    return `<li style="--pc:${playerColor(i)}"><span class="tok">${p.token}</span><b>${escapeHtml(p.name)}</b><span class="tag">${tags}</span></li>`;
  });
  for (let i = s.players.length; i < s.settings.maxPlayers; i++) rows.push('<li class="empty">Waiting for player…</li>');
  $('#lobbyPlayers').innerHTML = rows.join('');

  if (me && document.activeElement !== $('#lobbyName')) $('#lobbyName').value = me.name;
  $('#lobbyName').disabled = !me;
  const taken = new Set(s.players.filter((p) => p.id !== store.me).map((p) => p.token));
  $('#tokenPicker').innerHTML = store.meta.tokens
    .map((t) => `<button type="button" data-token="${t}" class="${me && me.token === t ? 'mine' : ''}" ${taken.has(t) || !me ? 'disabled' : ''}>${t}</button>`)
    .join('');

  for (const id of ['#mapSelect', '#maxPlayersSelect', '#cashSelect']) $(id).disabled = !isHost;
  $('#mapSelect').value = s.map.id;
  $('#maxPlayersSelect').value = String(s.settings.maxPlayers);
  $('#cashSelect').value = String(s.settings.startingCash);
  $('#hostNote').textContent = isHost ? '(you are the host)' : '(set by the host)';

  const info = store.meta.maps.find((m) => m.id === s.map.id);
  $('#mapPreview').innerHTML = info
    ? `<div class="swatches">${info.colors.map((c) => `<span style="background:${c}"></span>`).join('')}</div>${escapeHtml(info.description)} <i>${info.sample.map(escapeHtml).join(', ')}…</i>`
    : '';

  $('#startBtn').disabled = !isHost || s.players.length < 2;
  $('#startBtn').textContent = isHost ? (s.players.length < 2 ? 'Waiting for players…' : `Start game (${s.players.length} players)`) : 'Waiting for the host to start…';
}

/* ---------- game ---------- */
const PHASE_TEXT = {
  roll: 'Roll the dice',
  buy: 'Deciding whether to buy',
  auction: 'Auction in progress',
  end: 'Finishing their turn',
  moving: 'Moving…',
};

function renderGame(s) {
  const board = $('#board');
  if (store.boardMapId !== s.map.id) {
    $('#dock').innerHTML = ''; // old controls (phone layout) go with the old board
    buildBoard(board, s.map);
    store.boardMapId = s.map.id;
    store.lastRollId = undefined;
    placeControls();
  }
  updateBoard(board, s);
  renderCenter(s);
  renderPlayers(s);
  $('#log').innerHTML = s.log.slice().reverse().map((l) => `<li>${escapeHtml(l.text)}</li>`).join('');
  if (store.modalSpace !== null) renderModal();
}

function renderCenter(s) {
  const me = s.players.find((p) => p.id === store.me);
  const cur = s.players[s.turn.index];
  const myTurn = s.status === 'playing' && me && cur.id === me.id;
  const m = (n) => money(s.map, n);

  // Turn banner
  if (s.status === 'finished') {
    const w = s.players.find((p) => p.id === s.winnerId);
    $('#turnInfo').innerHTML = `<div class="winner">🏆 ${w ? `${w.token} ${escapeHtml(w.name)} wins!` : 'Game over'}</div>`;
  } else {
    $('#turnInfo').innerHTML = `${cur.token} ${myTurn ? 'Your turn' : `${escapeHtml(cur.name)}'s turn`}<span class="hint">${myTurn ? '' : PHASE_TEXT[s.turn.phase] || ''}</span>`;
  }

  // Dice (animate only when a new roll arrives)
  const rollLog = s.log.filter((l) => / rolled \d/.test(l.text)).at(-1);
  const rollId = rollLog ? rollLog.id : 0;
  renderDice($('#dice'), s.turn.lastRoll, store.lastRollId !== undefined && rollId > store.lastRollId);
  store.lastRollId = rollId;

  // Drawn card
  const card = s.lastCard;
  show($('#cardPanel'), !!card);
  if (card) {
    const who = s.players.find((p) => p.id === card.playerId);
    $('#cardPanel').innerHTML = `<b>${escapeHtml(card.deckName)} — ${escapeHtml(who ? who.name : '')}</b>${escapeHtml(card.text)}`;
  }

  // Action buttons
  const btn = (action, label, cls = '', disabled = false) =>
    `<button type="button" class="btn ${cls}" data-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  const out = [];
  if (s.status === 'finished') {
    if (s.hostId === store.me) out.push(btn('restart', 'Play again', 'primary'));
  } else if (me && !me.bankrupt) {
    if (me.cash < 0) out.push(`<div class="note">You owe ${m(-me.cash)}. Sell buildings or mortgage (click your properties), or declare bankruptcy.</div>`);
    if (myTurn) {
      const ph = s.turn.phase;
      if (ph === 'roll') {
        if (me.inJail) {
          out.push(btn('roll', '🎲 Roll for doubles', 'primary', me.cash < 0));
          out.push(btn('payFine', `Pay ${m(s.settings.jailFine)} fine`, '', me.cash < s.settings.jailFine));
          if (me.jailCards > 0) out.push(btn('useCard', `Use jail card (${me.jailCards})`));
        } else {
          out.push(btn('roll', '🎲 Roll dice', 'primary', me.cash < 0));
        }
      } else if (ph === 'buy') {
        const sp = s.map.spaces[s.turn.pendingSpace];
        out.push(btn('buy', `Buy ${escapeHtml(sp.name)} for ${m(sp.price)}`, 'primary', me.cash < sp.price));
        out.push(btn('auction', 'Auction'));
      } else if (ph === 'end') {
        out.push(btn('endTurn', 'End turn', 'primary', me.cash < 0));
      }
    }
    if ((myTurn || me.cash < 0) && !s.auction) {
      out.push(btn('bankrupt', store.bankruptArmed ? 'Click again to confirm' : 'Declare bankruptcy', 'danger small'));
    }
  } else if (!me) {
    out.push('<div class="muted">Spectating</div>');
  }
  $('#actions').innerHTML = out.join('');

  renderAuction(s, me);
}

function renderAuction(s, me) {
  const a = s.auction;
  const panel = $('#auctionPanel');
  show(panel, !!a);
  if (!a) return;
  const sp = s.map.spaces[a.space];
  const high = s.players.find((p) => p.id === a.highBidder);
  $('.auction-title', panel).textContent = `🔨 Auction: ${sp.name} (list ${money(s.map, sp.price)})`;
  $('.auction-bid', panel).innerHTML = high ? `Highest bid <b>${money(s.map, a.highBid)}</b> by ${high.token} ${escapeHtml(high.name)}` : 'No bids yet';
  const inIt = me && a.active.includes(me.id);
  panel.querySelectorAll('[data-bid-inc]').forEach((b) => {
    const amount = a.highBid + Number(b.dataset.bidInc);
    b.textContent = `${money(s.map, amount)}`;
    b.dataset.amount = amount;
    b.disabled = !inIt || amount > me.cash;
  });
  $('#bidCustom').disabled = !inIt;
  $('#bidInput').disabled = !inIt;
  $('#bidPass').disabled = !inIt || a.highBidder === me?.id;
  $('#bidPass').textContent = inIt ? 'Pass' : 'Out';
}

// Auction countdown bar
setInterval(() => {
  const a = store.state?.auction;
  if (!a) return;
  const total = (store.state.settings.auctionSeconds || 10) * 1000;
  const left = Math.max(0, a.endsAt - (Date.now() + store.clockOffset));
  const bar = $('#auctionPanel .auction-timer div');
  if (bar) bar.style.width = `${(left / total) * 100}%`;
}, 200);

function renderPlayers(s) {
  $('#playerList').innerHTML = s.players
    .map((p, i) => {
      const owned = Object.entries(s.properties)
        .filter(([, pr]) => pr.owner === p.id)
        .map(([idx, pr]) => {
          const sp = s.map.spaces[idx];
          const color = sp.group ? s.map.groups[sp.group].color : '#9aa3b5';
          return `<button type="button" data-space="${idx}" class="${pr.mortgaged ? 'mortgaged' : ''}" style="background:${color}" title="${escapeHtml(sp.name)}"></button>`;
        })
        .join('');
      const badges = [
        p.id === store.me ? 'you' : '',
        p.inJail ? `🔒 in jail (${p.jailTurns}/3)` : '',
        p.jailCards ? `🎫 ×${p.jailCards}` : '',
        p.bankrupt ? '💀 bankrupt' : '',
        p.connected ? '' : '📴 offline',
      ].filter(Boolean);
      const isTurn = s.status === 'playing' && s.turn.index === i;
      return `<li style="--pc:${playerColor(i)}" class="${isTurn ? 'turn' : ''} ${p.bankrupt ? 'out' : ''}">
        <div class="player-head"><span class="tok">${p.token}</span><span class="name">${escapeHtml(p.name)}</span>
        <span class="cash ${p.cash < 0 ? 'neg' : ''}">${money(s.map, p.cash)}</span></div>
        ${badges.length ? `<div class="badges">${badges.join(' · ')}</div>` : ''}
        ${owned ? `<div class="chips">${owned}</div>` : ''}</li>`;
    })
    .join('');
}

/* ---------- game events ---------- */
document.addEventListener('click', async (e) => {
  const actionBtn = e.target.closest('[data-action]');
  if (actionBtn && !actionBtn.disabled) {
    const action = actionBtn.dataset.action;
    if (action === 'restart') {
      const res = await request('game:restart');
      if (!res.ok) toast(res.error, 'error');
    } else if (action === 'bankrupt') {
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
      act(action);
    }
    return;
  }

  const inc = e.target.closest('[data-bid-inc]');
  if (inc && !inc.disabled) return act('bid', { amount: Number(inc.dataset.amount) });
  if (e.target.closest('#bidCustom')) {
    const amount = Number($('#bidInput').value);
    $('#bidInput').value = '';
    return act('bid', { amount });
  }
  if (e.target.closest('#bidPass')) return act('pass');

  const space = e.target.closest('.space[data-index], .chips button[data-space]');
  if (space) {
    store.modalSpace = Number(space.dataset.index ?? space.dataset.space);
    return renderModal();
  }

  const deed = e.target.closest('[data-deed]');
  if (deed) {
    if (deed.dataset.deed === 'close') return closeModal();
    return act(deed.dataset.deed, { space: Number(deed.dataset.space) });
  }
  if (e.target.id === 'modal') closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Enter' && e.target.id === 'bidInput') $('#bidCustom').click();
});

function renderModal() {
  const s = store.state;
  if (store.modalSpace === null || !s || s.status === 'lobby') return closeModal();
  $('#modalCard').innerHTML = deedHtml(s, store.modalSpace, store.me);
  show($('#modal'), true);
}
function closeModal() {
  store.modalSpace = null;
  show($('#modal'), false);
}

/* ---------- view switching ---------- */
function render() {
  const s = store.state;
  const view = !s || !store.code ? 'home' : s.status === 'lobby' ? 'lobby' : 'game';
  if (view !== store.view) window.scrollTo(0, 0);
  store.view = view;
  show($('#homeView'), view === 'home');
  show($('#lobbyView'), view === 'lobby');
  show($('#gameView'), view === 'game');
  show($('#roomChip'), view !== 'home');
  if (store.code) $('#roomCodeLabel').textContent = store.code;
  if (view === 'lobby') {
    store.boardMapId = null;
    $('#dock').innerHTML = ''; // drop old controls; rebuilt with the board
    closeModal();
    renderLobby(s);
  } else if (view === 'game') {
    renderGame(s);
  }
}

render();
