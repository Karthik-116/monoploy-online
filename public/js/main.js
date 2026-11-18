// Client entry point: networking, view switching, lobby, game UI and animation timing.
// The client only renders server state and sends intents; the server validates everything.
import { buildBoard, updateTiles, deedHtml, fitNames } from './board.js';
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
  lastCardSeq: undefined,
  lastFeedId: undefined,
  cardTimer: null,
  centerTimer: null,
  modal: null, // { type: 'deed' | 'maps' | 'look', index? }
  bankruptArmed: false,
  clockOffset: 0,
  sideKey: '',
  view: null,
  nothing: { unlocked: false, nextTotal: null },
  tradeDraft: null,
  seenTrades: null, // Set of trade ids already noticed
  rulesOpen: false,
};

/* ---------- loading screen ---------- */
const TIPS = [
  'Tap any square to see its price and who owns it',
  'Owning a whole colour set doubles its rent',
  'Send the room link to friends to play together',
  'On a phone, tap Zoom to read the board up close',
  'Three doubles in a row sends you to jail',
  'Short on cash? Sell or mortgage a property from its card',
];
$('#loaderTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
let loaderTimer = null;
function showLoader(text = 'Loading game…') {
  $('#loaderText').textContent = text;
  $('#loader').classList.remove('done');
  clearTimeout(loaderTimer);
  loaderTimer = setTimeout(() => {
    $('#loaderText').textContent = 'Still connecting… the server may be waking up';
  }, 9000);
}
function hideLoader() {
  clearTimeout(loaderTimer);
  $('#loader').classList.add('done');
}

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
  showLoader(event === 'room:create' ? 'Creating your room…' : 'Joining the game…');
  const res = await request(event, { ...payload, secret });
  hideLoader();
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
  hideCard();
  session.del('mono.room');
  Object.assign(store, { state: null, code: null, me: null, chat: [], boardMapId: null, modal: null, lastRollId: undefined, nothing: { unlocked: false, nextTotal: null }, tradeDraft: null, seenTrades: null });
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

socket.on('nothing:status', (st) => {
  store.nothing = { unlocked: !!st.unlocked, nextTotal: st.nextTotal ?? null };
  if (store.modal?.type === 'nothing') renderModal();
});

socket.on('connect', () => {
  clearTimeout(reconnectTimer);
  const code = store.code || session.get('mono.room');
  const urlCode = new URLSearchParams(location.search).get('room');
  if (!code || (urlCode && urlCode.toUpperCase() !== code)) {
    hideLoader();
    return;
  }
  enterRoom('room:join', { code, name: savedName() }).then((ok) => {
    if (!ok) leaveToHome('That game has ended because the server restarted. Create a new room to play again.');
  });
});
let reconnectTimer = null;
socket.on('disconnect', () => {
  toast('Connection lost — reconnecting…', 'error');
  reconnectTimer = setTimeout(() => showLoader('Reconnecting…'), 1500);
});
showLoader('Loading game…');

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

let fitTimer = null;
new ResizeObserver(() => {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => fitNames($('#board')), 120);
}).observe($('#board'));

const phone = window.matchMedia('(max-width: 760px)');
function placeControls() {
  const controls = $('#controls');
  if (!controls) return;
  const target = phone.matches ? $('#dock') : $('.center');
  if (controls.parentElement === target) return;
  if (phone.matches) target.appendChild(controls);
  else target.insertBefore(controls, $('#centerFeed'));
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

  const grantBtn = t.closest('[data-grant]');
  if (grantBtn) {
    const res = await act('grantTime', { target: grantBtn.dataset.grant });
    if (res.ok) toast('Gave them 2 more minutes to come back');
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
  if (open) {
    if (open.dataset.open === 'trade') store.tradeDraft = newTradeDraft();
    return openModal({ type: open.dataset.open });
  }
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
  if (e.key === 'Escape') {
    closeModal();
    hideCard();
  }
  if (e.key === 'Enter' && e.target.id === 'bidInput') $('#bidCustom').click();
});
$('#appearanceBtn').addEventListener('click', () => openModal({ type: 'look' }));

/* ---------- "Nothing" button: password, then choose the next dice total ---------- */
$('#nothingBtn').addEventListener('click', () => openModal({ type: 'nothing' }));
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'nothingForm') return;
  e.preventDefault();
  const pw = $('#nothingPw');
  const res = await send('nothing:unlock', { password: pw.value });
  if (!res.ok) {
    pw.select();
    return;
  }
  store.nothing = { unlocked: true, nextTotal: res.nextTotal ?? null };
  renderModal();
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-total]');
  if (!b) return;
  const total = b.dataset.total === 'clear' ? null : Number(b.dataset.total);
  const res = await send('nothing:set', { total });
  if (res.ok) {
    store.nothing.nextTotal = res.nextTotal ?? null;
    renderModal();
  }
});

/* ---------- trades ---------- */
function noticeTrades(s) {
  const ids = s.trades.map((t) => t.id);
  if (!store.seenTrades) {
    store.seenTrades = new Set(ids); // don't pop up offers that existed before we joined
    return;
  }
  for (const t of s.trades) {
    if (store.seenTrades.has(t.id)) continue;
    store.seenTrades.add(t.id);
    if (t.to !== store.me) continue;
    const from = s.players.find((p) => p.id === t.from);
    sfx.turn();
    if (!store.modal) openModal({ type: 'tradeView', id: t.id });
    else toast(`${from ? from.name : 'Someone'} sent you a trade offer — see Trades`);
  }
}
document.addEventListener('click', async (e) => {
  const t = e.target;
  const withBtn = t.closest('[data-trade-with]');
  if (withBtn) {
    store.tradeDraft = newTradeDraft(withBtn.dataset.tradeWith);
    return openModal({ type: 'trade' });
  }
  const toBtn = t.closest('[data-trade-to]');
  if (toBtn && store.tradeDraft) {
    store.tradeDraft = { ...newTradeDraft(toBtn.dataset.tradeTo), give: store.tradeDraft.give };
    return renderModal();
  }
  const prop = t.closest('[data-trade-prop]');
  if (prop && store.tradeDraft) {
    const set = store.tradeDraft[prop.dataset.tradeProp].properties;
    const i = Number(prop.dataset.space);
    if (set.has(i)) set.delete(i);
    else set.add(i);
    prop.setAttribute('aria-pressed', String(set.has(i)));
    return;
  }
  if (t.closest('[data-trade-send]') && store.tradeDraft) {
    const d = store.tradeDraft;
    const side = (x) => ({ cash: Number(x.cash) || 0, properties: [...x.properties], jailCards: Number(x.jailCards) || 0 });
    const res = await act('tradePropose', { to: d.to, give: side(d.give), get: side(d.get) });
    if (res.ok) {
      store.tradeDraft = null;
      closeModal();
      toast('Trade offer sent');
    }
    return;
  }
  for (const [attr, type] of [['tradeAccept', 'tradeAccept'], ['tradeDecline', 'tradeDecline'], ['tradeCancel', 'tradeCancel']]) {
    const sel = `[data-${attr.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`;
    const b = t.closest(sel);
    if (b) {
      const res = await act(type, { id: Number(b.dataset[attr]) });
      if (res.ok && store.modal?.type === 'tradeView') closeModal();
      if (res.ok && type === 'tradeAccept') toast('Trade done');
      return;
    }
  }
});
document.addEventListener('input', (e) => {
  const cash = e.target.closest('[data-trade-cash]');
  if (cash && store.tradeDraft) store.tradeDraft[cash.dataset.tradeCash].cash = Math.max(0, Math.floor(Number(cash.value) || 0));
});
document.addEventListener('change', (e) => {
  const jail = e.target.closest('[data-trade-jail]');
  if (jail && store.tradeDraft) store.tradeDraft[jail.dataset.tradeJail].jailCards = Number(jail.value) || 0;
});

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
  card.classList.toggle('wide', m.type === 'maps' || m.type === 'trade');
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
  } else if (m.type === 'trade') {
    const html = tradeDialogHtml(s, head);
    if (!html || s.status !== 'playing') return closeModal();
    card.innerHTML = html;
  } else if (m.type === 'tradeView') {
    const t = s.trades.find((x) => x.id === m.id);
    if (!t) return closeModal();
    card.innerHTML = `${head(t.to === store.me ? 'Trade offer for you' : 'Trade offer')}<div class="modal-body">${tradeCardHtml(s, t)}</div>`;
  } else if (m.type === 'nothing') {
    const nt = store.nothing.nextTotal;
    if (!store.me) return closeModal();
    if (!store.nothing.unlocked) {
      card.innerHTML = `${head('Nothing')}<form id="nothingForm" class="modal-body" autocomplete="off">
        <label class="label" for="nothingPw">Password</label>
        <input id="nothingPw" class="field" type="password" autocomplete="off" style="margin-bottom:12px" />
        <button class="btn btn-primary btn-block" type="submit">Unlock</button></form>`;
      show($('#modal'), true);
      setTimeout(() => $('#nothingPw')?.focus(), 50);
      return;
    }
    card.innerHTML = `${head('Next roll')}<div class="modal-body">
      <p class="muted" style="margin:0">Pick the total for the next roll, whoever rolls it. It's used once, then the dice go back to random.</p>
      <div class="total-grid">${[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
        .map((n) => `<button type="button" class="btn" data-total="${n}" aria-pressed="${n === nt}">${n}</button>`)
        .join('')}</div>
      <p class="nothing-status">${nt ? `Next roll will total ${nt}` : 'Next roll is random'}</p>
      <div class="nothing-row"><button type="button" class="btn" data-total="clear" ${nt ? '' : 'disabled'}>Make it random</button><button type="button" class="btn btn-primary" data-close>Done</button></div></div>`;
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
  show($('#nothingBtn'), view === 'room' && !!store.me);
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
  $('#sideTab').textContent = s.status === 'lobby' ? 'Settings' : 'Trades';

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
    store.lastCardSeq = undefined;
    store.lastFeedId = undefined;
    placeControls();
    requestAnimationFrame(() => fitNames($('#board')));
    if (document.fonts) document.fonts.ready.then(() => fitNames($('#board')));
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
    store.centerTimer = setTimeout(() => renderCenter(store.state), landDelay + 120);
  } else {
    renderCenter(s);
  }

  renderPlayers(s, prev, landDelay);
  renderSide(s);
  renderFeed();
  if (store.modal && store.modal.type !== 'trade') renderModal();
  noticeTrades(s);

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
        : `<span>${avatar(cur.token)}${escapeHtml(cur.name)}</span><span class="hint">${
            !cur.connected && cur.awayDeadline
              ? `<span class="away-note">Not connected — removed in <span data-countdown="${cur.awayDeadline}"></span></span>`
              : s.turn.phase === 'auction' ? hints.auction : hints[s.turn.phase] || ''
          }</span>`;
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
      const tradePartners = s.players.some((p) => p.id !== me.id && !p.bankrupt);
      if (tradePartners) out.push('<button type="button" class="btn trade-open" data-open="trade">⇄ Trade</button>');
      if ((myTurn || me.cash < 0) && !s.auction) {
        out.push(btn('bankrupt', store.bankruptArmed ? 'Tap again to go bankrupt' : 'Bankrupt', 'btn-danger btn-sm'));
      }
    } else if (!me && s.status === 'playing') {
      out.push('<div class="room-code-note">You are watching this game</div>');
    }
  }

  $('#status').innerHTML = status;
  $('#actions').innerHTML = out.join('');
  tickClocks();

  renderCenterFeed(s);

  // Chance / Community Chest: pop up a big card when a new one is drawn.
  const card = s.lastCard;
  if (store.lastCardSeq === undefined) store.lastCardSeq = card ? card.seq : null;
  else if (card && card.seq !== store.lastCardSeq) {
    store.lastCardSeq = card.seq;
    showCard(card, s);
  }
  renderAuction(s, me);
}

/** Which player a log line is about (the longest player name it starts with). */
function playerInText(s, text) {
  return s.players.filter((p) => text.startsWith(p.name)).sort((a, b) => b.name.length - a.name.length)[0] || null;
}

/** The latest moves, newest first, in the middle of the board. */
function renderCenterFeed(s) {
  const list = $('#centerFeed');
  if (!list) return;
  if (s.status === 'lobby') {
    list.innerHTML = '';
    return;
  }
  const items = s.log.filter((l) => !/'s turn$/.test(l.text)).slice(-6).reverse();
  const newest = items[0] ? items[0].id : 0;
  list.innerHTML = items
    .map((l, idx) => {
      const p = playerInText(s, l.text);
      const text = p ? `<b>${escapeHtml(p.name)}</b>${escapeHtml(l.text.slice(p.name.length))}` : escapeHtml(l.text);
      const fresh = idx === 0 && store.lastFeedId !== undefined && l.id > store.lastFeedId;
      return `<li class="${fresh ? 'fresh' : ''}" style="--c:${tokenColor(p?.token)}">${p ? avatar(p.token) : ''}<span>${text}</span></li>`;
    })
    .join('');
  store.lastFeedId = newest;
}

function showCard(card, s) {
  const who = s.players.find((p) => p.id === card.playerId);
  const icon = (s.map.icons || {})[card.deck] || (card.deck === 'chance' ? '❓' : '💰');
  $('#cardBig').className = `card-big ${card.deck === 'chest' ? 'chest' : 'chance'}`;
  $('#cardBig').innerHTML = `
    <div class="card-top"><span class="card-icon" aria-hidden="true">${Array.isArray(icon) ? icon[0] : icon}</span><span class="card-deck">${escapeHtml(card.deckName)}</span></div>
    <div class="card-body">
      <p class="card-text">${escapeHtml(card.text)}</p>
      ${who ? `<div class="card-who">${avatar(who.token)}<span>${who.id === store.me ? 'You drew this card' : `${escapeHtml(who.name)} drew this card`}</span></div>` : ''}
      <button type="button" class="btn btn-primary" data-card-ok>OK</button>
    </div>`;
  show($('#cardShow'), true);
  sfx.card();
  clearTimeout(store.cardTimer);
  store.cardTimer = setTimeout(hideCard, 5500);
}
function hideCard() {
  clearTimeout(store.cardTimer);
  show($('#cardShow'), false);
}
$('#cardShow').addEventListener('click', hideCard);

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

/* ---------- clocks ---------- */
const mmss = (ms) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
function tickClocks() {
  const s = store.state;
  if (!s) return;
  const now = Date.now() + store.clockOffset;
  const clock = $('#turnClock');
  if (clock) {
    const live = s.status === 'playing' && s.turn && s.turn.deadline && !s.auction;
    show(clock, !!live);
    if (live) {
      const left = s.turn.deadline - now;
      const total = (s.settings.turnSeconds || 276) * 1000;
      clock.style.setProperty('--p', String(Math.max(0, Math.min(1, left / total))));
      clock.querySelector('span').textContent = mmss(left);
      clock.classList.toggle('warn', left < 30_000);
    }
  }
  $$('[data-countdown]').forEach((el) => (el.textContent = mmss(Number(el.dataset.countdown) - now)));
}
setInterval(tickClocks, 250);

function renderPlayers(s, prev, floatDelay) {
  const inGame = s.status !== 'lobby';
  $('#playerList').innerHTML = s.players
    .map((p, i) => {
      const sub = [
        p.id === store.me ? 'You' : '',
        p.inJail ? `In jail (${p.jailTurns}/3)` : '',
        p.jailCards ? `${p.jailCards} jail card${p.jailCards > 1 ? 's' : ''}` : '',
        p.bankrupt ? 'Bankrupt' : '',
        p.connected || p.bankrupt ? '' : p.awayDeadline ? `<span class="away-note">Offline · removed in <span data-countdown="${p.awayDeadline}"></span></span>` : 'Offline',
      ].filter(Boolean);
      const meP = s.players.find((x) => x.id === store.me);
      const canGrant = s.status === 'playing' && p.awayDeadline && !p.bankrupt && meP && !meP.bankrupt && meP.id !== p.id && !(p.grantedBy || []).includes(meP.id);
      const grant = canGrant ? `<button type="button" class="btn btn-sm grant-btn" data-grant="${p.id}">+2 min</button>` : '';
      const canTradeWith = s.status === 'playing' && meP && !meP.bankrupt && meP.id !== p.id && !p.bankrupt;
      const tradeRow = canTradeWith ? `<button type="button" class="btn btn-sm row-trade" data-trade-with="${p.id}" aria-label="Trade with ${escapeHtml(p.name)}">⇄ Trade</button>` : '';
      const isTurn = s.status === 'playing' && s.turn.index === i;
      const host = p.id === s.hostId ? `<span class="crown">${ICONS.crown}Host</span>` : '';
      return `<li class="player${isTurn ? ' turn' : ''}${p.bankrupt ? ' out' : ''}${p.connected ? '' : ' offline'}" style="--c:${tokenColor(p.token)}" data-pid="${p.id}">
        ${avatar(p.token)}
        <div style="min-width:0"><div class="player-name"><span style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.name)}</span>${host}</div>${sub.length ? `<div class="player-sub">${sub.join(' · ')}</div>` : ''}${grant}${tradeRow}</div>
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
  const key = JSON.stringify([s.status, s.settings, s.map.id, isHost, store.me, s.status === 'lobby' ? 0 : [s.properties, s.trades, s.players.map((p) => [p.id, p.name, p.token, p.bankrupt, p.jailCards])]]);
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

  // In game: trades, every player's properties, and the rule switches.
  const me = s.players.find((p) => p.id === store.me);
  const canTrade = s.status === 'playing' && me && !me.bankrupt;
  const mineTrades = s.trades.filter((t) => t.from === store.me || t.to === store.me);
  const otherTrades = s.trades.length - mineTrades.length;
  const owners = [...s.players].sort((a, b) => (a.id === store.me ? -1 : b.id === store.me ? 1 : 0));
  const ruleRow = ([k, icon, title, desc]) =>
    `<div class="setting"><span class="row-icon">${ICONS[icon]}</span><div><div class="setting-title">${title}</div><div class="setting-desc">${desc}</div></div><button type="button" class="switch" role="switch" aria-checked="${!!s.settings[k]}" aria-label="${title}" data-setting="${k}" ${isHost && s.status === 'playing' ? '' : 'disabled'}></button></div>`;

  el.innerHTML = `
    <h2 class="panel-title">Trades</h2>
    ${canTrade ? '<button type="button" class="btn btn-primary btn-block" data-open="trade">Create a trade</button>' : ''}
    <div class="trade-list">
      ${mineTrades.map((t) => tradeCardHtml(s, t)).join('') || `<p class="settings-note" style="margin:10px 0 0">${canTrade ? 'No trade offers right now.' : 'No trades right now.'}</p>`}
      ${otherTrades ? `<p class="settings-note">${otherTrades} other offer${otherTrades > 1 ? 's' : ''} between players</p>` : ''}
    </div>
    <h3 class="settings-sep">Properties</h3>
    ${owners.map((p) => ownerBlock(s, p, canTrade)).join('')}
    <details class="rules-box" ${store.rulesOpen ? 'open' : ''}>
      <summary>Gameplay rules${isHost ? '' : ' (host can change)'}</summary>
      ${RULES.filter(([k]) => k !== 'randomizeOrder').map(ruleRow).join('')}
    </details>`;
  el.querySelector('.rules-box').addEventListener('toggle', (e) => (store.rulesOpen = e.target.open));
}

/** One player's properties with a count, grouped in board order. */
function ownerBlock(s, p, canTrade) {
  const owned = Object.entries(s.properties)
    .filter(([, pr]) => pr.owner === p.id)
    .map(([i, pr]) => [Number(i), pr])
    .sort((a, b) => a[0] - b[0]);
  const isMe = p.id === store.me;
  const chips = owned
    .map(([i, pr]) => {
      const sp = s.map.spaces[i];
      const color = sp.group ? s.map.groups[sp.group].color : 'var(--muted)';
      const extra = pr.houses ? `<small>${pr.houses === 5 ? 'hotel' : `${pr.houses}h`}</small>` : '';
      return `<button type="button" class="prop-chip${pr.mortgaged ? ' mortgaged' : ''}" style="--g:${color}" data-deed-open="${i}">${escapeHtml(sp.name)}${extra}</button>`;
    })
    .join('');
  const tradeBtn = canTrade && !isMe && !p.bankrupt ? `<button type="button" class="link-btn" data-trade-with="${p.id}">Trade</button>` : '';
  return `<div class="owner-block${p.bankrupt ? ' out' : ''}" style="--c:${tokenColor(p.token)}">
    <div class="owner-head">${avatar(p.token)}<b>${isMe ? 'You' : escapeHtml(p.name)}</b><span class="count">${owned.length} propert${owned.length === 1 ? 'y' : 'ies'}</span>${tradeBtn}</div>
    ${chips ? `<div class="prop-chips">${chips}</div>` : `<p class="setting-desc">${p.bankrupt ? 'Bankrupt' : 'No properties yet'}</p>`}
  </div>`;
}

/** Items on one side of a trade. */
function tradeItems(s, side) {
  const items = [];
  if (side.cash) items.push(`<span class="trade-item cash">${money(s.map, side.cash)}</span>`);
  for (const i of side.properties) {
    const sp = s.map.spaces[i];
    const color = sp.group ? s.map.groups[sp.group].color : 'var(--muted)';
    items.push(`<span class="trade-item" style="--g:${color}">${escapeHtml(sp.name)}</span>`);
  }
  if (side.jailCards) items.push(`<span class="trade-item">${side.jailCards} jail card${side.jailCards > 1 ? 's' : ''}</span>`);
  return items.join('') || '<span class="trade-item none">Nothing</span>';
}

function tradeCardHtml(s, t) {
  const from = s.players.find((p) => p.id === t.from);
  const to = s.players.find((p) => p.id === t.to);
  const nm = (p) => (p.id === store.me ? 'You' : escapeHtml(p.name));
  let actions = `<p class="settings-note" style="margin:0">Waiting for ${nm(to)}</p>`;
  if (t.to === store.me) {
    actions = `<button type="button" class="btn btn-primary btn-sm" data-trade-accept="${t.id}">Accept</button><button type="button" class="btn btn-danger btn-sm" data-trade-decline="${t.id}">Decline</button>`;
  } else if (t.from === store.me) {
    actions = `<p class="settings-note" style="margin:0;flex:1;text-align:left">Waiting for ${nm(to)}</p><button type="button" class="btn btn-sm" data-trade-cancel="${t.id}">Cancel offer</button>`;
  }
  return `<div class="trade-card">
    <div class="trade-head">${avatar(from.token)}<b>${nm(from)}</b><span class="muted">→</span>${avatar(to.token)}<b>${nm(to)}</b></div>
    <div class="trade-cols">
      <div><small>${nm(from)} give${from.id === store.me ? '' : 's'}</small><div class="trade-items">${tradeItems(s, t.give)}</div></div>
      <div><small>${nm(to)} give${to.id === store.me ? '' : 's'}</small><div class="trade-items">${tradeItems(s, t.get)}</div></div>
    </div>
    <div class="trade-actions">${actions}</div>
  </div>`;
}

/** The "Create a trade" dialog. */
function newTradeDraft(to = null) {
  return { to, give: { cash: 0, properties: new Set(), jailCards: 0 }, get: { cash: 0, properties: new Set(), jailCards: 0 } };
}
function tradeDialogHtml(s, head) {
  const me = s.players.find((p) => p.id === store.me);
  const others = s.players.filter((p) => p.id !== store.me && !p.bankrupt);
  if (!me || !others.length) return null;
  const d = store.tradeDraft || (store.tradeDraft = newTradeDraft());
  if (!others.some((o) => o.id === d.to)) {
    d.to = others[0].id;
    d.get = newTradeDraft().get;
  }
  const them = others.find((o) => o.id === d.to);
  const column = (who, key) => {
    const side = d[key];
    const owned = Object.entries(s.properties).filter(([, pr]) => pr.owner === who.id).map(([i, pr]) => [Number(i), pr]).sort((a, b) => a[0] - b[0]);
    const props = owned
      .map(([i, pr]) => {
        const sp = s.map.spaces[i];
        const color = sp.group ? s.map.groups[sp.group].color : 'var(--muted)';
        const extra = pr.houses ? ` · ${pr.houses === 5 ? 'hotel' : `${pr.houses}h`}` : pr.mortgaged ? ' · mortgaged' : '';
        return `<button type="button" class="trade-prop" data-trade-prop="${key}" data-space="${i}" aria-pressed="${side.properties.has(i)}" style="--g:${color}">${escapeHtml(sp.name)}<small>${extra}</small></button>`;
      })
      .join('');
    const jail = who.jailCards
      ? `<label class="trade-jail">Get Out of Jail Free cards <select class="select" data-trade-jail="${key}">${Array.from({ length: who.jailCards + 1 }, (_, n) => `<option ${n === side.jailCards ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`
      : '';
    return `<div class="trade-col">
      <div class="trade-col-head">${avatar(who.token)}<b>${who.id === store.me ? 'You give' : `${escapeHtml(who.name)} gives`}</b><span>${money(s.map, who.cash)}</span></div>
      <label class="trade-cash"><span>${escapeHtml(s.map.currency)}</span><input class="field" type="number" min="0" step="10" inputmode="numeric" placeholder="0" aria-label="Money" data-trade-cash="${key}" value="${side.cash || ''}" /></label>
      <div class="trade-props">${props || '<p class="setting-desc" style="margin:0">No properties</p>'}</div>
      ${jail}
    </div>`;
  };
  const picker = others.length >= 1
    ? `<div class="trade-with">${others.map((o) => `<button type="button" class="look-btn" data-trade-to="${o.id}" aria-pressed="${o.id === d.to}">${avatar(o.token)}<span>${escapeHtml(o.name)}</span></button>`).join('')}</div>`
    : '';
  return `${head('New trade')}<div class="modal-body">
    ${picker ? `<span class="label">Trade with</span>${picker}` : ''}
    <div class="trade-grid">${column(me, 'give')}${column(them, 'get')}</div>
    <p class="setting-desc" style="margin:-4px 0 12px">Pick anything from either side — money, properties (buildings go with them) or jail cards. ${escapeHtml(them.name)} can accept or decline.</p>
    <div class="deed-actions"><button type="button" class="btn btn-primary" data-trade-send>Send offer to ${escapeHtml(them.name)}</button><button type="button" class="btn btn-ghost" data-close>Cancel</button></div>
  </div>`;
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
