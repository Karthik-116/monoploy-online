// Tiny synthesized sound effects (Web Audio) — no audio files needed.
import { storage } from './ui.js';

let ctx = null;
let muted = storage.get('mono.muted') === '1';

function audio() {
  if (muted) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = 'sine', vol = 0.06, when = 0, slide = 0 } = {}) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + when;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function click(when, vol = 0.12) {
  const ac = audio();
  if (!ac) return;
  const len = Math.floor(ac.sampleRate * 0.03);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = ac.createBufferSource();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();
  filter.type = 'bandpass';
  filter.frequency.value = 1800 + Math.random() * 1600;
  gain.gain.value = vol;
  src.buffer = buf;
  src.connect(filter).connect(gain).connect(ac.destination);
  src.start(ac.currentTime + when);
}

export const sfx = {
  roll() {
    [0, 0.07, 0.16, 0.27, 0.42, 0.58, 0.74].forEach((t, i) => click(t + Math.random() * 0.02, 0.16 - i * 0.015));
  },
  hop() {
    tone(480 + Math.random() * 90, 0.07, { type: 'triangle', vol: 0.035 });
  },
  gain() {
    tone(880, 0.09, { vol: 0.05 });
    tone(1320, 0.16, { vol: 0.045, when: 0.07 });
  },
  loss() {
    tone(330, 0.18, { type: 'triangle', vol: 0.045, slide: 0.7 });
  },
  turn() {
    tone(660, 0.1, { vol: 0.05 });
    tone(990, 0.16, { vol: 0.05, when: 0.1 });
  },
  card() {
    tone(520, 0.08, { type: 'triangle', vol: 0.04, slide: 1.5 });
  },
  get muted() {
    return muted;
  },
  setMuted(value) {
    muted = value;
    storage.set('mono.muted', value ? '1' : '0');
  },
  unlock() {
    audio();
  },
};
