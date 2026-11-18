// Board rendering. Works for any map whose space count is a multiple of 4.
import { escapeHtml, money, tokenColor, avatar } from './ui.js';

/** Grid cell of space i with `side` spaces per edge (GO bottom-right, clockwise). */
export function spaceCoords(i, side) {
  if (i <= side) return { row: side, col: side - i, edge: 'bottom' };
  if (i <= 2 * side) return { row: 2 * side - i, col: 0, edge: 'left' };
  if (i <= 3 * side) return { row: 0, col: i - 2 * side, edge: 'top' };
  return { row: i - 3 * side, col: side, edge: 'right' };
}

export function iconFor(space, index, map) {
  const icon = (map.icons || {})[space.type];
  if (Array.isArray(icon)) {
    const nth = map.spaces.slice(0, index).filter((s) => s.type === space.type).length;
    return icon[nth % icon.length];
  }
  return icon || '';
}

const groupColor = (map, s) => (s.group ? map.groups[s.group].color : null);

/** Builds tiles + the centre area. Call again only when the map changes. */
export function buildBoard(board, map) {
  const side = map.spaces.length / 4;
  const tracks = `1.55fr repeat(${side - 1}, 1fr) 1.55fr`;
  board.style.gridTemplateColumns = tracks;
  board.style.gridTemplateRows = tracks;
  board.innerHTML = '';

  map.spaces.forEach((s, i) => {
    const { row, col, edge } = spaceCoords(i, side);
    const corner = i % side === 0;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `tile type-${s.type} edge-${edge}${corner ? ' corner' : ''}`;
    el.style.gridRow = String(row + 1);
    el.style.gridColumn = String(col + 1);
    el.dataset.index = i;
    el.setAttribute('aria-label', s.name);
    const color = groupColor(map, s);
    if (color) el.style.setProperty('--g', color);
    const icon = s.type === 'street' ? '' : `<span class="tile-icon" aria-hidden="true">${iconFor(s, i, map)}</span>`;
    const cost = s.price ? money(map, s.price) : s.amount ? money(map, s.amount) : '';

    if (corner) {
      const sub = { go: `Collect ${map.currency}200`, jail: 'Just visiting', parking: '', gotojail: '' }[s.type] || '';
      el.innerHTML = `<span class="tile-inner">${icon}<span class="tile-name">${escapeHtml(s.name)}</span>${sub ? `<span class="tile-sub">${escapeHtml(sub)}</span>` : ''}</span>`;
    } else {
      el.innerHTML = `<span class="tile-inner">
        ${color ? '<span class="band"></span>' : '<span class="tile-spacer"></span>'}
        <span class="tile-name">${escapeHtml(s.name)}</span>
        ${icon}
        ${cost ? `<span class="tile-price">${cost}</span>` : '<span class="tile-spacer"></span>'}
      </span>`;
    }
    board.appendChild(el);
  });

  const center = document.createElement('div');
  center.className = 'center';
  center.style.gridRow = `2 / ${side + 1}`;
  center.style.gridColumn = `2 / ${side + 1}`;
  center.innerHTML = `
    <div class="center-name">${escapeHtml(map.name)}</div>
    <div id="controls" class="controls">
      <div id="diceTray" class="dice-tray"></div>
      <div id="status" class="status" aria-live="polite"></div>
      <div id="actions" class="actions"></div>
      <div id="auctionPanel" class="auction hidden">
        <div class="auction-title"></div>
        <div class="auction-bid"></div>
        <div class="auction-timer"><div></div></div>
        <div class="bid-row">
          <button class="btn" data-bid-inc="1" type="button"></button>
          <button class="btn" data-bid-inc="10" type="button"></button>
          <button class="btn" data-bid-inc="50" type="button"></button>
          <button class="btn" data-bid-inc="100" type="button"></button>
        </div>
        <div class="bid-row">
          <input id="bidInput" class="field" type="number" inputmode="numeric" min="1" step="1" placeholder="Your bid" aria-label="Custom bid" />
          <button id="bidCustom" class="btn btn-primary" type="button">Bid</button>
          <button id="bidPass" class="btn btn-danger" type="button">Pass</button>
        </div>
      </div>
      <div id="cardPanel" class="drawn-card hidden"></div>
    </div>`;
  board.appendChild(center);
}

/** Ownership, buildings and highlights. Returns indices that were just bought. */
export function updateTiles(board, state, prevOwners) {
  const highlight = state.auction ? state.auction.space : state.turn && state.turn.phase === 'buy' ? state.turn.pendingSpace : null;
  const bought = [];
  state.map.spaces.forEach((s, i) => {
    const el = board.querySelector(`.tile[data-index="${i}"]`);
    if (!el) return;
    const prop = state.properties[i];
    if (prop) {
      const owner = prop.owner ? state.players.find((p) => p.id === prop.owner) : null;
      el.classList.toggle('owned', !!owner);
      el.style.setProperty('--owner', owner ? tokenColor(owner.token) : 'transparent');
      el.classList.toggle('mortgaged', !!prop.mortgaged);
      const band = el.querySelector('.band');
      if (band) {
        const html = prop.houses === 5 ? '<i class="hotel"></i>' : '<i class="house"></i>'.repeat(prop.houses);
        if (band.dataset.h !== String(prop.houses)) {
          band.innerHTML = html;
          band.dataset.h = String(prop.houses);
        }
      }
      if (prevOwners && prop.owner && prevOwners[i] !== prop.owner) bought.push(i);
    }
    el.classList.toggle('pending', highlight === i);
  });
  for (const i of bought) {
    const el = board.querySelector(`.tile[data-index="${i}"]`);
    el.classList.remove('just-bought');
    void el.offsetWidth;
    el.classList.add('just-bought');
  }
  return bought;
}

/** Title-deed card for the property modal. */
export function deedHtml(state, i, meId) {
  const map = state.map;
  const s = map.spaces[i];
  const prop = state.properties[i];
  const m = (n) => money(map, n);
  const color = groupColor(map, s);
  const labels = map.labels || {};
  const kind = s.group ? map.groups[s.group].name : { railroad: labels.railroad || 'station', utility: labels.utility || 'utility' }[s.type] || '';
  const kindLabel = kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : '';
  const head = `<div class="deed-head" style="${color ? `--g:${color}` : ''}"><small>${escapeHtml(kindLabel)}</small><h3>${escapeHtml(s.name)}</h3></div>`;
  const close = '<button class="btn btn-ghost" data-deed="close" type="button">Close</button>';

  if (!prop) {
    const info = {
      go: `Collect ${m(state.settings.goSalary)} every time you pass.`,
      jail: 'Just visiting — unless you were sent here.',
      parking: state.settings.vacationCash ? `Land here to collect the vacation pot: ${m(state.pot || 0)}.` : 'Take a breather. Nothing happens here.',
      gotojail: 'Go straight to jail. You do not pass GO.',
      chance: 'Draw a card and do what it says.',
      chest: 'Draw a card and do what it says.',
      tax: `Pay ${m(s.amount || 0)} to the bank.`,
    }[s.type];
    return `<div class="deed-head" style="--g:var(--panel-2)"><small>&nbsp;</small><h3>${iconFor(s, i, map)} ${escapeHtml(s.name)}</h3></div>
      <div class="modal-body"><p style="margin-top:0">${info || ''}</p><div class="deed-actions">${close}</div></div>`;
  }

  let rows = '';
  let cur = -1;
  if (s.type === 'street') {
    const ownsSet = prop.owner && map.spaces.every((x, j) => x.type !== 'street' || x.group !== s.group || state.properties[j].owner === prop.owner);
    const dbl = state.settings.doubleRentOnSet;
    if (prop.owner) cur = prop.houses > 0 ? prop.houses + 1 : ownsSet && dbl ? 1 : 0;
    const lines = [
      ['Rent', s.rent[0]],
      dbl ? ['With the full colour set', s.rent[0] * 2] : null,
      ['With 1 house', s.rent[1]],
      ['With 2 houses', s.rent[2]],
      ['With 3 houses', s.rent[3]],
      ['With 4 houses', s.rent[4]],
      ['With a hotel', s.rent[5]],
    ];
    rows = lines
      .map((l, idx) => (l ? `<tr class="${idx === cur ? 'current' : ''}"><td>${l[0]}</td><td>${m(l[1])}</td></tr>` : ''))
      .join('');
    rows += `<tr><td>Each house or hotel costs</td><td>${m(s.houseCost)}</td></tr>`;
  } else if (s.type === 'railroad') {
    const owned = prop.owner ? map.spaces.filter((x, j) => x.type === 'railroad' && state.properties[j].owner === prop.owner).length : 0;
    rows = s.rent.map((r, k) => `<tr class="${k + 1 === owned ? 'current' : ''}"><td>If ${k + 1} owned</td><td>${m(r)}</td></tr>`).join('');
  } else if (s.type === 'utility') {
    const owned = prop.owner ? map.spaces.filter((x, j) => x.type === 'utility' && state.properties[j].owner === prop.owner).length : 0;
    rows = s.multipliers.map((x, k) => `<tr class="${k + 1 === owned ? 'current' : ''}"><td>If ${k + 1} owned</td><td>${x}× the dice</td></tr>`).join('');
  }

  const owner = prop.owner ? state.players.find((p) => p.id === prop.owner) : null;
  const mine = owner && owner.id === meId && state.status === 'playing';
  const unmortgage = Math.ceil(Math.round((s.price / 2) * (1 + state.unmortgageInterest) * 100) / 100);
  const buttons = [];
  if (mine) {
    if (s.type === 'street') {
      buttons.push(`<button class="btn btn-primary" data-deed="build" data-space="${i}" type="button">Build for ${m(s.houseCost)}</button>`);
      if (prop.houses > 0) buttons.push(`<button class="btn" data-deed="sell" data-space="${i}" type="button">Sell a building +${m(Math.floor(s.houseCost / 2))}</button>`);
    }
    if (state.settings.mortgage) {
      buttons.push(
        prop.mortgaged
          ? `<button class="btn" data-deed="unmortgage" data-space="${i}" type="button">Unmortgage for ${m(unmortgage)}</button>`
          : `<button class="btn" data-deed="mortgage" data-space="${i}" type="button">Mortgage +${m(Math.floor(s.price / 2))}</button>`,
      );
    }
  }
  const buildings = prop.houses ? (prop.houses === 5 ? 'a hotel' : `${prop.houses} house${prop.houses > 1 ? 's' : ''}`) : '';
  return `${head}
    <div class="modal-body">
      <table class="deed-table">
        <tr><td>Price</td><td>${m(s.price)}</td></tr>
        ${rows}
        <tr><td>Mortgage value</td><td>${m(Math.floor(s.price / 2))}</td></tr>
      </table>
      <div class="deed-owner">${owner ? `${avatar(owner.token)}<span>Owned by <b>${escapeHtml(owner.name)}</b>${buildings ? ` · ${buildings}` : ''}${prop.mortgaged ? ' · <span style="color:var(--bad)">mortgaged</span>' : ''}</span>` : '<span class="muted">For sale — the bank owns it.</span>'}</div>
      <div class="deed-actions">${buttons.join('')}${close}</div>
    </div>`;
}
