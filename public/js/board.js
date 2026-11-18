// Board rendering. Works for any map whose space count is a multiple of 4.
import { escapeHtml, money, playerColor } from './ui.js';

/** Grid position of space i on a board with `side` spaces per edge (GO bottom-right, clockwise). */
export function spaceCoords(i, side) {
  if (i <= side) return { row: side, col: side - i, edge: 'bottom' };
  if (i <= 2 * side) return { row: 2 * side - i, col: 0, edge: 'left' };
  if (i <= 3 * side) return { row: 0, col: i - 2 * side, edge: 'top' };
  return { row: i - 3 * side, col: side, edge: 'right' };
}

function iconFor(space, index, map) {
  const icons = map.icons || {};
  const icon = icons[space.type];
  if (Array.isArray(icon)) {
    const nth = map.spaces.slice(0, index).filter((s) => s.type === space.type).length;
    return icon[nth % icon.length];
  }
  return icon || '';
}

/** Builds the static board for a map. Call again only when the map changes. */
export function buildBoard(container, map) {
  const n = map.spaces.length;
  const side = n / 4;
  const tracks = `1.6fr repeat(${side - 1}, 1fr) 1.6fr`;
  container.style.gridTemplateColumns = tracks;
  container.style.gridTemplateRows = tracks;
  container.innerHTML = '';

  map.spaces.forEach((s, i) => {
    const { row, col, edge } = spaceCoords(i, side);
    const d = document.createElement('div');
    d.className = `space type-${s.type} edge-${edge}${i % side === 0 ? ' corner' : ''}`;
    d.style.gridRow = String(row + 1);
    d.style.gridColumn = String(col + 1);
    d.dataset.index = i;
    d.title = s.name;
    const color = s.group ? map.groups[s.group].color : null;
    const icon = s.type === 'street' ? '' : `<div class="icon">${iconFor(s, i, map)}</div>`;
    const cost = s.price ? money(map, s.price) : s.amount ? money(map, s.amount) : '';
    d.innerHTML = `
      ${color ? `<div class="band" style="background:${color}"></div>` : ''}
      <div class="space-body">${icon}<div class="name">${escapeHtml(s.name)}</div>${cost ? `<div class="price">${cost}</div>` : ''}</div>
      <div class="owner-mark"></div>
      <div class="tokens"></div>`;
    container.appendChild(d);
  });

  const center = document.createElement('div');
  center.className = 'center';
  center.style.gridRow = `2 / ${side + 1}`;
  center.style.gridColumn = `2 / ${side + 1}`;
  center.innerHTML = `
    <div class="center-inner">
      <div><div class="map-title">${escapeHtml(map.name.toUpperCase())}</div></div>
      <div id="controls" class="controls">
      <div id="turnInfo"></div>
      <div id="dice" class="dice"></div>
      <div id="actions" class="actions"></div>
      <div id="auctionPanel" class="auction hidden">
        <div class="auction-title"></div>
        <div class="auction-bid"></div>
        <div class="auction-timer"><div></div></div>
        <div class="bid-row">
          <button class="btn" data-bid-inc="1" type="button">+1</button>
          <button class="btn" data-bid-inc="10" type="button">+10</button>
          <button class="btn" data-bid-inc="50" type="button">+50</button>
          <button class="btn" data-bid-inc="100" type="button">+100</button>
        </div>
        <div class="bid-row" style="margin-top:.6cqi">
          <input id="bidInput" type="number" min="1" step="1" placeholder="Custom bid" />
          <button id="bidCustom" class="btn primary" type="button">Bid</button>
          <button id="bidPass" class="btn danger" type="button">Pass</button>
        </div>
      </div>
      <div id="cardPanel" class="drawn-card hidden"></div>
      </div>
    </div>`;
  container.appendChild(center);
}

/** Updates ownership, buildings and tokens from the latest state. */
export function updateBoard(container, state) {
  const current = state.status === 'playing' ? state.players[state.turn.index] : null;
  const highlight = state.auction ? state.auction.space : state.turn && state.turn.phase === 'buy' ? state.turn.pendingSpace : null;

  state.map.spaces.forEach((s, i) => {
    const d = container.querySelector(`.space[data-index="${i}"]`);
    if (!d) return;
    const prop = state.properties[i];
    if (prop) {
      const ownerIdx = prop.owner ? state.players.findIndex((p) => p.id === prop.owner) : -1;
      d.classList.toggle('owned', ownerIdx >= 0);
      d.style.setProperty('--owner', ownerIdx >= 0 ? playerColor(ownerIdx) : 'transparent');
      d.classList.toggle('mortgaged', !!prop.mortgaged);
      const band = d.querySelector('.band');
      if (band) {
        band.innerHTML = prop.houses === 5 ? '<i class="hotel"></i>' : '<i class="house"></i>'.repeat(prop.houses);
      }
    }
    d.classList.toggle('pending', highlight === i);

    const tokens = state.players
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => !p.bankrupt && p.position === i && state.status !== 'lobby');
    const html = tokens
      .map(({ p, idx }) => `<span class="token${current && current.id === p.id ? ' active' : ''}" style="--pc:${playerColor(idx)}" title="${escapeHtml(p.name)}">${p.token}</span>`)
      .join('');
    const box = d.querySelector('.tokens');
    if (box.dataset.html !== html) {
      box.innerHTML = html;
      box.dataset.html = html;
    }
  });
}

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

export function renderDice(el, roll, animate) {
  const faces = roll || [1, 1];
  el.innerHTML = faces
    .map((v) => `<div class="die${animate ? ' roll' : ''}">${Array.from({ length: 9 }, (_, k) => `<i class="${PIPS[v].includes(k) ? 'on' : ''}"></i>`).join('')}</div>`)
    .join('');
  el.style.opacity = roll ? '1' : '0.35';
}

/** Title-deed style HTML for the property modal. */
export function deedHtml(state, i, meId) {
  const map = state.map;
  const s = map.spaces[i];
  const prop = state.properties[i];
  const m = (n) => money(map, n);
  const color = s.group ? map.groups[s.group].color : 'var(--accent)';
  const kind = s.group ? map.groups[s.group].name : { railroad: map.labels?.railroad || 'Station', utility: map.labels?.utility || 'Utility' }[s.type] || s.type;
  let rows = '';
  let curRow = -1;

  if (s.type === 'street') {
    const ownsSet = prop.owner && map.spaces.every((x, j) => x.type !== 'street' || x.group !== s.group || state.properties[j].owner === prop.owner);
    curRow = prop.owner ? (prop.houses > 0 ? prop.houses + 1 : ownsSet ? 1 : 0) : -1;
    const labels = ['Rent', 'With colour set', 'With 1 house', 'With 2 houses', 'With 3 houses', 'With 4 houses', 'With hotel'];
    const values = [s.rent[0], s.rent[0] * 2, ...s.rent.slice(1)];
    rows = labels.map((l, k) => `<tr class="${k === curRow ? 'current' : ''}"><td>${l}</td><td>${m(values[k])}</td></tr>`).join('');
    rows += `<tr><td>House / hotel cost</td><td>${m(s.houseCost)} each</td></tr>`;
  } else if (s.type === 'railroad') {
    const owned = prop.owner ? map.spaces.filter((x, j) => x.type === 'railroad' && state.properties[j].owner === prop.owner).length : 0;
    rows = s.rent.map((r, k) => `<tr class="${k + 1 === owned ? 'current' : ''}"><td>If ${k + 1} owned</td><td>${m(r)}</td></tr>`).join('');
  } else if (s.type === 'utility') {
    const owned = prop.owner ? map.spaces.filter((x, j) => x.type === 'utility' && state.properties[j].owner === prop.owner).length : 0;
    rows = s.multipliers.map((x, k) => `<tr class="${k + 1 === owned ? 'current' : ''}"><td>If ${k + 1} owned</td><td>${x}× dice roll</td></tr>`).join('');
  }

  let body;
  if (prop) {
    const owner = prop.owner ? state.players.find((p) => p.id === prop.owner) : null;
    const unmortgage = Math.ceil(Math.round((s.price / 2) * (1 + state.unmortgageInterest) * 100) / 100);
    const mine = owner && owner.id === meId && state.status === 'playing';
    const buttons = [];
    if (mine) {
      if (s.type === 'street') {
        buttons.push(`<button class="btn primary" data-deed="build" data-space="${i}" type="button">Build (${m(s.houseCost)})</button>`);
        if (prop.houses > 0) buttons.push(`<button class="btn" data-deed="sell" data-space="${i}" type="button">Sell building (+${m(Math.floor(s.houseCost / 2))})</button>`);
      }
      if (prop.mortgaged) buttons.push(`<button class="btn" data-deed="unmortgage" data-space="${i}" type="button">Unmortgage (${m(unmortgage)})</button>`);
      else buttons.push(`<button class="btn" data-deed="mortgage" data-space="${i}" type="button">Mortgage (+${m(Math.floor(s.price / 2))})</button>`);
    }
    body = `
      <table class="deed-table">
        <tr><td>Price</td><td>${m(s.price)}</td></tr>
        ${rows}
        <tr><td>Mortgage value</td><td>${m(Math.floor(s.price / 2))}</td></tr>
      </table>
      <div class="deed-owner">Owner: <b>${owner ? `${owner.token} ${escapeHtml(owner.name)}` : 'Bank'}</b>
        ${prop.mortgaged ? ' · <span style="color:var(--danger)">Mortgaged</span>' : ''}
        ${prop.houses ? ` · ${prop.houses === 5 ? 'Hotel' : `${prop.houses} house${prop.houses > 1 ? 's' : ''}`}` : ''}</div>
      <div class="deed-actions">${buttons.join('')}<button class="btn ghost" data-deed="close" type="button">Close</button></div>`;
  } else {
    const info = {
      go: `Collect ${m(state.settings.goSalary)} salary as you pass.`,
      jail: 'Just visiting — unless you were sent here.',
      parking: 'Take a breather. Nothing happens here.',
      gotojail: 'Go directly to jail. Do not pass GO.',
      chance: 'Draw a card from this deck.',
      chest: 'Draw a card from this deck.',
      tax: `Pay ${m(s.amount || 0)} to the bank.`,
    }[s.type];
    body = `<p>${info || ''}</p><div class="deed-actions"><button class="btn ghost" data-deed="close" type="button">Close</button></div>`;
  }

  return `<div class="deed-head" style="background:${color}"><small>${escapeHtml(kind)}</small>${escapeHtml(s.name)}</div><div class="deed-body">${body}</div>`;
}
