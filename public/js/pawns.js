// Player pawns drawn over the board. Forward moves hop square by square;
// jumps (jail, cards that send you back) glide straight to the new square.
import { avatar, reducedMotion } from './ui.js';
import { sfx } from './sound.js';

const HOP_MS = 175;

export class Pawns {
  constructor(layer, board) {
    this.layer = layer;
    this.board = board;
    this.els = new Map(); // playerId -> element
    this.at = new Map(); // playerId -> square currently shown
    this.gen = new Map(); // playerId -> animation generation (cancels stale hops)
    this.order = [];
    new ResizeObserver(() => this.layout()).observe(board);
  }

  reset() {
    this.layer.innerHTML = '';
    this.els.clear();
    this.at.clear();
    this.gen.clear();
  }

  /** Bring pawns in line with the state. `delay` postpones movement (e.g. while dice roll). */
  sync(state, { delay = 0 } = {}) {
    const n = state.map.spaces.length;
    const visible = state.status !== 'lobby' ? state.players.filter((p) => !p.bankrupt) : [];
    const current = state.status === 'playing' ? state.players[state.turn.index] : null;
    this.order = state.players.map((p) => p.id);
    this.jailIdx = state.map.spaces.findIndex((sp) => sp.type === 'jail');
    this.jailed = new Set(state.players.filter((p) => p.inJail).map((p) => p.id));

    for (const [id, el] of this.els) {
      if (!visible.some((p) => p.id === id)) {
        el.remove();
        this.els.delete(id);
        this.at.delete(id);
      }
    }

    for (const p of visible) {
      let el = this.els.get(p.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'pawn';
        this.layer.appendChild(el);
        this.els.set(p.id, el);
      }
      if (el.dataset.token !== p.token) {
        el.innerHTML = avatar(p.token);
        el.style.setProperty('--c', `var(--t-${p.token})`);
        el.dataset.token = p.token;
      }
      el.title = p.name;
      el.classList.toggle('active', !!current && current.id === p.id);

      const from = this.at.get(p.id);
      if (from === undefined) {
        this.at.set(p.id, p.position);
        continue;
      }
      if (from === p.position) continue;
      const steps = (p.position - from + n) % n;
      const walk = steps > 0 && steps <= 12 && !p.inJail && !reducedMotion();
      this.animate(p.id, from, p.position, walk ? steps : 0, n, delay);
    }
    this.layout();
  }

  animate(id, from, to, steps, n, delay) {
    const gen = (this.gen.get(id) || 0) + 1;
    this.gen.set(id, gen);
    const el = this.els.get(id);
    const live = () => this.gen.get(id) === gen && this.els.get(id) === el;

    if (!steps) {
      setTimeout(() => {
        if (!live()) return;
        el.classList.add('glide');
        this.at.set(id, to);
        this.layout();
        setTimeout(() => el.classList.remove('glide'), 750);
      }, delay);
      return;
    }
    for (let k = 1; k <= steps; k++) {
      setTimeout(() => {
        if (!live()) return;
        this.at.set(id, (from + k) % n);
        el.classList.remove('hop');
        void el.offsetWidth;
        el.classList.add('hop');
        sfx.hop();
        this.layout();
      }, delay + (k - 1) * HOP_MS);
    }
  }

  /**
   * Position every pawn. Pawns sit on the inner edge of a square (so the name
   * stays readable) and fan out when several share it. On the jail corner,
   * players in jail go in the cell and visitors in the outer strip.
   */
  layout() {
    const groups = new Map();
    for (const id of this.order) {
      if (!this.at.has(id)) continue;
      const sq = this.at.get(id);
      let key = String(sq);
      if (sq === this.jailIdx) key = this.jailed.has(id) ? 'jail:in' : 'jail:visit';
      if (!groups.has(key)) groups.set(key, { sq, ids: [] });
      groups.get(key).ids.push(id);
    }
    const unit = this.board.clientWidth / 100; // 1cqw
    const CELL = { bl: [0.67, 0.33], br: [0.33, 0.33], tl: [0.67, 0.67], tr: [0.33, 0.67] };
    const VISIT = { bl: [0.5, 0.84], br: [0.5, 0.84], tl: [0.5, 0.16], tr: [0.5, 0.16] };
    for (const [key, { sq, ids }] of groups) {
      const tile = this.board.querySelector(`.tile[data-index="${sq}"]`);
      if (!tile) continue;
      const L = tile.offsetLeft;
      const T = tile.offsetTop;
      const W = tile.offsetWidth;
      const H = tile.offsetHeight;
      const edge = tile.dataset.edge;
      const corner = tile.dataset.corner;
      let ax = L + W / 2;
      let ay = T + H / 2;
      let along = 'x'; // direction pawns spread in
      let gap = 2.5;
      if (key === 'jail:in' && corner) {
        [ax, ay] = [L + W * CELL[corner][0], T + H * CELL[corner][1]];
        gap = 1.9;
      } else if (key === 'jail:visit' && corner) {
        [ax, ay] = [L + W * VISIT[corner][0], T + H * VISIT[corner][1]];
        gap = 2.2;
      } else if (!corner) {
        if (edge === 'bottom') ay = T + H * 0.14;
        else if (edge === 'top') ay = T + H * 0.86;
        else if (edge === 'left') { ax = L + W * 0.86; along = 'y'; }
        else if (edge === 'right') { ax = L + W * 0.14; along = 'y'; }
      }
      const n = ids.length;
      const perRow = Math.min(n, 3);
      ids.forEach((id, i) => {
        const row = Math.floor(i / 3);
        const inRow = Math.min(perRow, n - row * 3);
        const a = n === 1 ? 0 : ((i % 3) - (inRow - 1) / 2) * unit * gap;
        const b = n <= 3 ? 0 : (row - (Math.ceil(n / 3) - 1) / 2) * unit * gap;
        const dx = along === 'x' ? a : b;
        const dy = along === 'x' ? b : a;
        this.els.get(id).style.transform = `translate(${ax + dx}px, ${ay + dy}px)`;
      });
    }
  }
}
