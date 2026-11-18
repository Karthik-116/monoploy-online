// 3D CSS dice that tumble and land on a given face.

const PIPS = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
// Cube rotation [x, y] that brings each face to the front (faces are placed in style.css).
const FACE_ROT = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
export const ROLL_MS = 1100;

const faceHtml = (n) =>
  `<div class="face f${n}">${Array.from({ length: 9 }, (_, k) => `<i class="${PIPS[n].includes(k) ? 'on' : ''}"></i>`).join('')}</div>`;

export class Dice {
  constructor(mount, count = 2) {
    this.mount = mount;
    this.dice = [];
    mount.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'die';
      el.innerHTML = `<div class="shadow"></div><div class="cube-wrap"><div class="cube">${[1, 2, 3, 4, 5, 6].map(faceHtml).join('')}</div></div>`;
      mount.appendChild(el);
      this.dice.push({ el, cube: el.querySelector('.cube'), turns: { x: 0, y: 0, z: 0 } });
    }
    this.values = [];
  }

  /** Show values; animate=true tumbles the dice first. */
  show(values, animate = false) {
    values.forEach((v, i) => {
      const d = this.dice[i];
      if (!d) return;
      const [fx, fy] = FACE_ROT[v] || FACE_ROT[1];
      if (animate) {
        d.turns.x += 2 + Math.floor(Math.random() * 2);
        d.turns.y += 2 + Math.floor(Math.random() * 2);
        d.turns.z += 1;
        d.cube.style.transition = '';
        d.el.classList.remove('toss');
        void d.el.offsetWidth; // restart the toss animation
        d.el.classList.add('toss');
      } else {
        d.cube.style.transition = 'none';
      }
      d.cube.style.transform = `rotateX(${d.turns.x * 360 + fx}deg) rotateY(${d.turns.y * 360 + fy}deg) rotateZ(${d.turns.z * 360}deg)`;
      if (!animate) void d.cube.offsetWidth;
    });
    this.values = values.slice();
  }

  setIdle(idle) {
    this.dice.forEach((d) => d.el.classList.toggle('idle', idle));
  }
}
