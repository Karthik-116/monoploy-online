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

  /** Position every pawn on its square, fanning out pawns that share a square. */
  layout() {
    const groups = new Map();
    for (const id of this.order) {
      if (!this.at.has(id)) continue;
      const sq = this.at.get(id);
      if (!groups.has(sq)) groups.set(sq, []);
      groups.get(sq).push(id);
    }
    const unit = this.board.clientWidth / 100; // 1cqw
    for (const [sq, ids] of groups) {
      const tile = this.board.querySelector(`.tile[data-index="${sq}"]`);
      if (!tile) continue;
      const cx = tile.offsetLeft + tile.offsetWidth / 2;
      const cy = tile.offsetTop + tile.offsetHeight * 0.58;
      ids.forEach((id, i) => {
        const count = ids.length;
        const cols = count > 2 ? 3 : count;
        const row = Math.floor(i / 3);
        const col = i % 3;
        const rows = Math.ceil(count / 3);
        const dx = count === 1 ? 0 : (col - (Math.min(cols, count - row * 3) - 1) / 2) * unit * 2.6;
        const dy = count <= 3 ? 0 : (row - (rows - 1) / 2) * unit * 2.6;
        this.els.get(id).style.transform = `translate(${cx + dx}px, ${cy + dy}px)`;
      });
    }
  }
}
