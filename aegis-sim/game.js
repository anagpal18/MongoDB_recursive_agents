/* AEGIS-1 Orbital Sim — v1. Pixel canvas scene driven only by triggers. */
(() => {
'use strict';
// ---------------- utils ----------------
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const pad2 = n => String(n).padStart(2, '0');
function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function makeNoise(seed, N) {
  const r = mulberry32(seed); const p = new Float32Array(N * N); for (let i = 0; i < N * N; i++) p[i] = r();
  const w = v => ((v % N) + N) % N;
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y); const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const i = w(xi), j = w(yi), i1 = w(xi + 1), j1 = w(yi + 1);
    return lerp(lerp(p[i + j * N], p[i1 + j * N], sx), lerp(p[i + j1 * N], p[i1 + j1 * N], sx), sy);
  };
}
function fbm(noise, x, y, oct) { let v = 0, amp = .5, f = 1, sum = 0; for (let i = 0; i < oct; i++) { v += noise(x * f, y * f) * amp; sum += amp; amp *= .5; f *= 2; } return v / sum; }
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x, y) => BAYER[(x & 3) + ((y & 3) << 2)] / 16;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// ---------------- icons ----------------
function icoSvg(name, size = 12) {
  const paths = (window.PXI && window.PXI[name]) || [];
  return `<svg class="pxi" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${paths.map(d => `<path d="${d}"/>`).join('')}</svg>`;
}
$$('[data-ico]').forEach(el => { el.innerHTML = icoSvg(el.dataset.ico, +(el.dataset.size || 12)); });

// ---------------- palette ----------------
const P = {
  hullL: '#c9d8e8', hullM: '#8ea3bb', hullD: '#56698a', hullX: '#2d3a52', floor: '#3b4a63', floorL: '#4d5f7c',
  ally: '#36e2d0', allyD: '#1a8f9e', orange: '#ff9d3b', glass: '#7ff0ff', core: '#ffd36b', coreH: '#ff5a1f',
  hostile: '#ff4b3e', hostD: '#9e1b2c', hostX: '#1b1620', amber: '#ffb13b', magenta: '#ff5ac8', supply: '#ffd36b',
  white: '#ffffff', debris: '#2a2630', debrisL: '#4a4458', smoke: '#5a5566',
};

// ---------------- event bus ----------------
const bus = { h: {}, on(t, f) { (this.h[t] ||= []).push(f); return () => { this.h[t] = this.h[t].filter(x => x !== f); }; },
  emit(t, p = {}) { const e = { type: t, t: +sim.t.toFixed(2), ...p }; (this.h[t] || []).forEach(f => f(e)); (this.h['*'] || []).forEach(f => f(e)); } };

// ---------------- audio ----------------
const sfx = (() => {
  let ac = null, muted = false, master;
  const ensure = () => { if (!ac) { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = .35; master.connect(ac.destination); } if (ac.state === 'suspended') ac.resume(); };
  const tone = (f0, f1, dur, type = 'square', vol = .3) => { if (muted || !ac) return; const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f0, ac.currentTime); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), ac.currentTime + dur); g.gain.setValueAtTime(vol, ac.currentTime); g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + dur); o.connect(g); g.connect(master); o.start(); o.stop(ac.currentTime + dur); };
  const noise = (dur, vol = .4, lp = 1200) => { if (muted || !ac) return; const n = ac.sampleRate * dur | 0, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n); const s = ac.createBufferSource(); s.buffer = b; const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; const g = ac.createGain(); g.gain.value = vol; s.connect(f); f.connect(g); g.connect(master); s.start(); };
  return {
    ensure, get muted() { return muted; }, set muted(v) { muted = v; },
    zap() { tone(1400, 300, .12, 'sawtooth', .18); }, bolt() { tone(600, 180, .14, 'square', .14); }, rail() { tone(200, 40, .4, 'sawtooth', .3); noise(.2, .2, 600); },
    hit() { noise(.12, .25, 900); tone(300, 80, .1, 'square', .12); }, shield() { tone(900, 1400, .15, 'triangle', .15); },
    boom() { noise(.6, .6, 500); tone(120, 30, .5, 'sawtooth', .35); }, alert() { tone(520, 520, .18, 'square', .18); setTimeout(() => tone(390, 390, .22, 'square', .18), 200); },
    launch() { tone(90, 420, .5, 'sawtooth', .18); noise(.4, .15, 400); }, dock() { tone(660, 990, .1, 'square', .15); setTimeout(() => tone(990, 1320, .14, 'square', .15), 110); },
    build() { tone(220 + rand(200), 900, .05, 'square', .06); }, ui() { tone(800, 600, .05, 'square', .08); }, warp() { tone(60, 1800, .35, 'sawtooth', .22); },
  };
})();

// ---------------- canvas setup ----------------
const canvas = $('#scene'), ctx = canvas.getContext('2d');
const labels = document.createElement('canvas'); labels.id = 'labels'; labels.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:5;'; document.body.insertBefore(labels, canvas.nextSibling);
const lctx = labels.getContext('2d');
let SCALE = 3, VW = 480, VH = 270, DPR = 1;
function resize() {
  const w = innerWidth, h = innerHeight; SCALE = w >= 1500 ? 3 : w >= 900 ? 2.5 : 2;
  VW = Math.ceil(w / SCALE); VH = Math.ceil(h / SCALE);
  canvas.width = VW; canvas.height = VH; canvas.style.width = (VW * SCALE) + 'px'; canvas.style.height = (VH * SCALE) + 'px';
  DPR = Math.min(2, devicePixelRatio || 1); labels.width = w * DPR; labels.height = h * DPR; labels.style.width = w + 'px'; labels.style.height = h + 'px';
  ctx.imageSmoothingEnabled = false; buildNebula();
}
addEventListener('resize', resize);

// ---------------- sim state ----------------
const sim = { t: 0, paused: false, shake: 0, flash: 0, cond: 'green', demo: false, pods: 0, kills: 0, time0: performance.now(), autoDef: true, autoRepair: false, red: 0 };
const cam = { x: 30, y: 0, z: 1, tx: 30, ty: 0, tz: 1 };
const hostiles = [], shots = [], beams = [], parts = [], pods = [], floaters = [], rings = [];

// ---------------- background ----------------
let nebula = null; const stars = [];
function buildNebula() {
  const w = VW + 200, h = VH + 200; nebula = document.createElement('canvas'); nebula.width = w; nebula.height = h;
  const nc = nebula.getContext('2d'); const img = nc.createImageData(w, h); const d = img.data; const n = makeNoise(7, 16);
  const c0 = hex('#05060f'), c1 = hex('#090c1d'), c2 = hex('#150f2c'), c3 = hex('#0a1a26'), c4 = hex('#1d1438');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fbm(n, x / 70 + 2, y / 70, 5); const m = fbm(n, x / 150 + 9, y / 150 + 3, 3);
    const th = bayer(x, y) - .5;
    let c = c0; if (v > .60 + th * .10) c = m > .5 ? c4 : c3; else if (v > .52 + th * .12) c = m > .5 ? c2 : c3; else if (v > .44 + th * .14) c = c1;
    const i = (x + y * w) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  nc.putImageData(img, 0, 0);
  stars.length = 0; for (let i = 0; i < 260; i++) stars.push({ x: rand(-600, 900), y: rand(-400, 500), l: pick([.15, .3, .3, .55, .55, 1]), tw: rand(TAU), c: pick(['#ffffff', '#c7e5ff', '#ffe9c4', '#b8fff2']) });
}

// ---------------- EARTH ----------------
const EARTH = { x: -175, y: 118, r: 108, rot: 0, cloudRot: 0 };
const earthTex = (() => {
  const W = 512, H = 256; const land = makeNoise(11, 8), moist = makeNoise(23, 8), city = makeNoise(41, 64), cloud = makeNoise(31, 8);
  const col = new Uint8Array(W * H * 3), light = new Uint8Array(W * H), clouds = new Uint8Array(W * H);
  const C = { deep: hex('#0a2457'), ocean: hex('#0f3f8a'), shelf: hex('#1a62b4'), coast: hex('#2b8fd0'), low: hex('#3f8a3c'), green: hex('#5fa63f'), dry: hex('#b9a257'), desert: hex('#d3b56a'), high: hex('#8c8a52'), mount: hex('#a39682'), snow: hex('#eef4f7') };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W * 8, v = y / H * 4; const lat = Math.abs(y / H - .5) * 2; // 0 eq .. 1 pole
    let e = fbm(land, u, v, 6); e = e + (fbm(land, u * 2 + 3, v * 2 + 1, 3) - .5) * .25; const m = fbm(moist, u + 5, v + 2, 4);
    const i = x + y * W; let c;
    const sea = .50 - lat * .04; // more land toward poles
    if (e < sea - .10) c = C.deep; else if (e < sea - .035) c = C.ocean; else if (e < sea - .012) c = C.shelf; else if (e < sea) c = C.coast;
    else { const h = (e - sea) / (1 - sea);
      if (lat > .82 || (lat > .68 && h > .25)) c = C.snow; else if (h > .32) c = C.mount; else if (h > .2) c = C.high; else if (lat < .45 && m < .38) c = C.desert; else if (m < .48) c = C.dry; else c = h > .08 ? C.green : C.low;
      if (c !== C.snow && city(u * 8, v * 8) > .80 && m > .4 && h < .18 && lat < .75) light[i] = 1; }
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    const cv = fbm(cloud, u * 1.5 + 2, v * 1.5, 5) + (1 - Math.abs(lat - .45)) * .05; clouds[i] = cv > .60 ? 2 : cv > .55 ? 1 : 0;
  }
  return { W, H, col, light, clouds };
})();
const earthCan = document.createElement('canvas'); const ER = EARTH.r + 8; earthCan.width = ER * 2; earthCan.height = ER * 2; const ectx = earthCan.getContext('2d');
const earthImg = ectx.createImageData(ER * 2, ER * 2);
const earthPre = (() => { // per-pixel precompute
  const n = (ER * 2) ** 2; const lat = new Float32Array(n), lon = new Float32Array(n), shade = new Float32Array(n), rim = new Float32Array(n), inside = new Uint8Array(n);
  const L = [0.52, -0.42, 0.74]; const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll; const R = EARTH.r;
  for (let py = 0; py < ER * 2; py++) for (let px = 0; px < ER * 2; px++) {
    const i = px + py * ER * 2; const x = (px + .5 - ER) / R, y = (py + .5 - ER) / R; const d2 = x * x + y * y;
    if (d2 <= 1) { const z = Math.sqrt(1 - d2); inside[i] = 1; lat[i] = Math.asin(y); lon[i] = Math.atan2(x, z); shade[i] = x * L[0] + y * L[1] + z * L[2]; }
    else { const d = Math.sqrt(d2); if (d < 1 + 9 / R) { const t = 1 - (d - 1) / (9 / R); const sun = clamp((x * L[0] + y * L[1]) * .9 + .55, .15, 1); rim[i] = t * t * sun; } }
  }
  return { lat, lon, shade, rim, inside };
})();
function renderEarth() {
  const { W, H, col, light, clouds } = earthTex; const { lat, lon, shade, rim, inside } = earthPre; const d = earthImg.data; const S = ER * 2;
  const rot = EARTH.rot, crot = EARTH.cloudRot; const atm = hex('#6fd2ff'), atmD = hex('#2a6fb8');
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const i = px + py * S, o = i * 4;
    if (inside[i]) {
      const v = (lat[i] / Math.PI + .5); const u = ((lon[i] / TAU) + rot) % 1; const tx = ((u + 1) % 1 * W) | 0, ty = clamp((v * H) | 0, 0, H - 1); const ti = tx + ty * W;
      const cu = ((lon[i] / TAU) + crot + 1) % 1; const cti = ((cu * W) | 0) + ty * W; const cl = clouds[cti];
      let r = col[ti * 3], g = col[ti * 3 + 1], b = col[ti * 3 + 2];
      if (cl) { const k = cl === 2 ? .92 : .55; r = r + (245 - r) * k; g = g + (248 - g) * k; b = b + (255 - b) * k; }
      const s = shade[i] + (bayer(px, py) - .5) * .12; let k;
      if (s > .55) k = 1; else if (s > .28) k = .82; else if (s > .05) k = .6; else if (s > -.12) k = .32; else k = .09;
      r *= k; g *= k; b *= k;
      if (k < .35 && light[ti] && !cl) { r = 255; g = 180; b = 80; }
      if (k < .35) { b = Math.min(255, b + 10); }
      const edge = Math.cos(lat[i]) * Math.cos(lon[i]); if (edge < .25) { const a = (0.25 - edge) * 1.6 * (shade[i] > -.1 ? 1 : .4); r += (atm[0] - r) * a * .6; g += (atm[1] - g) * a * .6; b += (atm[2] - b) * a * .6; }
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    } else if (rim[i] > 0) {
      const a = rim[i]; const q = a > .7 ? 1 : a > .45 ? .75 : a > .22 ? .5 : .25; const th = bayer(px, py);
      const on = a + (th - .5) * .25 > .12; const c = q > .6 ? atm : atmD;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = on ? Math.round(q * 200) : 0;
    } else d[o + 3] = 0;
  }
  ectx.putImageData(earthImg, 0, 0);
}

// ---------------- OUR SHIP (grid, Cosmoteer style) ----------------
const TS = 5;
const LAYOUT = [
  '.......1.....2..........',
  '......#####.####........',
  '.....#=====#====##..3...',
  '...TT#==L==#S===#=#3....',
  '..TTT#==R==4====C==#>3..',
  '...TT#==L==#S===#=#3....',
  '.....#=====#====##..3...',
  '......#####.####........',
  '.......1.....2..........',
];
const COLS = LAYOUT[0].length, ROWS = LAYOUT.length;
const SHIP = { x: 0, y: 0, w: COLS * TS, h: ROWS * TS, shield: 200, shieldMax: 200, power: 1, dirty: true, cx: 0, cy: 0 };
SHIP.ox = -Math.round(SHIP.w / 2); SHIP.oy = -Math.round(SHIP.h / 2);
const PART_DEF = {
  '#': { name: 'Armor Plate', code: 'A', hp: 100, desc: 'Layered hull plating. Takes hits first.' },
  '>': { name: 'Bow Prow', code: 'A', hp: 160, desc: 'Reinforced forward wedge.' },
  '=': { name: 'Structure', code: 'F', hp: 60, desc: 'Interior deck and conduit.' },
  'C': { name: 'Bridge', code: 'C', hp: 130, desc: 'Command deck. Losing it degrades targeting.' },
  'R': { name: 'Reactor', code: 'R', hp: 90, desc: 'Fusion core. Feeds weapons and shields.' },
  'T': { name: 'Thruster', code: 'T', hp: 70, desc: 'Ion drive nozzle.' },
  'L': { name: 'Laser Turret', code: 'L', hp: 60, desc: 'Point-defense beam. Auto-fires.' },
  'S': { name: 'Shield Emitter', code: 'S', hp: 70, desc: 'Projects the deflector bubble (+100 cap).' },
  'B': { name: 'Capacitor Bank', code: 'B', hp: 60, desc: 'Buffers reactor output.' },
};
const UPGRADES = {
  flank: { name: 'Flank Laser Battery', slot: '1', type: 'L', desc: 'Two dorsal/ventral turrets. Doubles fire rate.' },
  capacitor: { name: 'Shield Capacitor Array', slot: '2', type: 'S', desc: '+200 shield capacity, faster regen.' },
  bow: { name: 'Reinforced Bow Plating', slot: '3', type: '#', desc: 'Five forward armor cells.' },
  core: { name: 'Auxiliary Reactor', slot: '4', type: 'R', desc: '+Power. Faster lasers and regen.' },
};
const slotCells = {}; // slot char -> [{c,r}]
function buildShip() {
  parts.length = 0; const counters = {}; SHIP.grid = []; for (const k in slotCells) delete slotCells[k];
  for (let r = 0; r < ROWS; r++) { SHIP.grid[r] = []; for (let c = 0; c < COLS; c++) {
    const ch = LAYOUT[r][c]; SHIP.grid[r][c] = null;
    if (PART_DEF[ch]) { const def = PART_DEF[ch]; const n = (counters[def.code] = (counters[def.code] || 0) + 1);
      const p = { id: def.code + n, type: ch, c, r, hp: def.hp, max: def.hp, build: 1, name: def.name, def, dead: false, cool: rand(1), aim: 0 }; parts.push(p); SHIP.grid[r][c] = p; }
    else if (ch >= '1' && ch <= '4') (slotCells[ch] ||= []).push({ c, r });
  } }
  SHIP.applied = {}; SHIP.shieldMax = 200; SHIP.shield = 200; SHIP.dirty = true; SHIP.cx = SHIP.ox + SHIP.w / 2; SHIP.cy = SHIP.oy + SHIP.h / 2;
}
const partAt = (c, r) => (r >= 0 && r < ROWS && c >= 0 && c < COLS) ? SHIP.grid[r][c] : null;
const partPos = p => ({ x: SHIP.ox + p.c * TS + TS / 2, y: SHIP.oy + p.r * TS + TS / 2 });
const alive = p => !p.dead && p.build >= 1;
function exposed(p) { return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => { const q = partAt(p.c + dc, p.r + dr); return !q || q.dead; }); }
function shipStats() {
  let hp = 0, max = 0; for (const p of parts) { hp += p.dead ? 0 : p.hp; max += p.max; }
  const R = parts.filter(p => p.type === 'R'), S = parts.filter(p => p.type === 'S');
  const power = R.length ? R.filter(alive).length / R.length : 0;
  SHIP.power = power; SHIP.shieldMax = S.filter(alive).length * 100;
  return { hull: hp / max, hullHp: hp, hullMax: max, power, shieldPct: SHIP.shieldMax ? SHIP.shield / SHIP.shieldMax : 0, lasers: parts.filter(p => p.type === 'L' && alive(p)).length };
}
const shipCan = document.createElement('canvas'); shipCan.width = SHIP.w; shipCan.height = SHIP.h; const sctx = shipCan.getContext('2d');
function px(c, x, y, col) { c.fillStyle = col; c.fillRect(x, y, 1, 1); }
function drawPart(c, p, x, y, forInspector) {
  const t = p.type, h = hash2(p.c * 7, p.r * 13);
  const bevel = (base, light, dark) => { c.fillStyle = base; c.fillRect(x, y, TS, TS); c.fillStyle = light; c.fillRect(x, y, TS, 1); c.fillRect(x, y, 1, TS); c.fillStyle = dark; c.fillRect(x, y + TS - 1, TS, 1); c.fillRect(x + TS - 1, y, 1, TS); };
  if (t === '#' || t === '>') { bevel(P.hullM, P.hullL, P.hullD); if (h > .5) { px(c, x + 1, y + 1, P.hullD); px(c, x + 3, y + 3, P.hullD); } else { px(c, x + 3, y + 1, P.hullD); px(c, x + 1, y + 3, P.hullD); }
    if (t === '>') { c.fillStyle = P.hullX; c.fillRect(x + 3, y, 2, 1); c.fillRect(x + 3, y + TS - 1, 2, 1); c.fillStyle = P.orange; c.fillRect(x + 2, y + 2, 2, 1); }
    // outer edge: darker seam where exposed
    for (const [dc, dr, ex, ey, w, hh] of [[0, -1, 0, 0, TS, 1], [0, 1, 0, TS - 1, TS, 1], [-1, 0, 0, 0, 1, TS], [1, 0, TS - 1, 0, 1, TS]]) { const q = partAt(p.c + dc, p.r + dr); if (!q) { c.fillStyle = P.hullX; c.fillRect(x + ex, y + ey, w, hh); } }
  } else if (t === '=') { c.fillStyle = P.floor; c.fillRect(x, y, TS, TS); c.fillStyle = P.floorL; if (h > .6) c.fillRect(x, y + 2, TS, 1); else if (h > .3) c.fillRect(x + 2, y, 1, TS); px(c, x + 1 + ((h * 3) | 0), y + 1, P.hullX); }
  else if (t === 'C') { bevel(P.hullD, P.hullL, P.hullX); c.fillStyle = P.glass; c.fillRect(x + 1, y + 1, 3, 3); c.fillStyle = P.white; c.fillRect(x + 1, y + 1, 2, 1); px(c, x + 3, y + 3, P.allyD); }
  else if (t === 'R') { bevel(P.hullX, P.hullD, '#1b2232'); c.fillStyle = P.coreH; c.fillRect(x + 1, y + 1, 3, 3); c.fillStyle = P.core; c.fillRect(x + 2, y + 1, 1, 3); c.fillRect(x + 1, y + 2, 3, 1); }
  else if (t === 'T') { c.fillStyle = P.hullD; c.fillRect(x, y, TS, TS); c.fillStyle = P.hullX; c.fillRect(x, y + 1, TS, 3); c.fillStyle = P.hullM; c.fillRect(x + 1, y, TS - 1, 1); c.fillRect(x + 1, y + TS - 1, TS - 1, 1); c.fillStyle = P.allyD; c.fillRect(x, y + 2, 1, 1); }
  else if (t === 'L') { bevel(P.hullD, P.hullM, P.hullX); c.fillStyle = P.hullL; c.fillRect(x + 1, y + 1, 3, 3); c.fillStyle = P.hullX; c.fillRect(x + 2, y + 2, 1, 1); if (forInspector) { c.fillStyle = P.ally; c.fillRect(x + 3, y + 2, 2, 1); } }
  else if (t === 'S') { bevel(P.hullD, P.hullM, P.hullX); c.fillStyle = P.allyD; c.fillRect(x + 2, y + 1, 1, 3); c.fillRect(x + 1, y + 2, 3, 1); px(c, x + 2, y + 2, P.ally); }
  else if (t === 'B') { bevel(P.hullD, P.hullM, P.hullX); c.fillStyle = P.supply; c.fillRect(x + 1, y + 1, 1, 3); c.fillRect(x + 3, y + 1, 1, 3); }
  // damage
  const ratio = p.hp / p.max;
  if (p.dead) { c.fillStyle = '#0a0b12'; c.fillRect(x, y, TS, TS); for (let i = 0; i < 8; i++) { const hh = hash2(p.c * 31 + i, p.r * 17 + i); if (hh > .45) px(c, x + ((hh * 97) % TS | 0), y + ((hh * 53) % TS | 0), hh > .8 ? P.debrisL : P.debris); } }
  else if (ratio < .66) { const n = ratio < .33 ? 6 : 3; for (let i = 0; i < n; i++) { const hh = hash2(p.c * 11 + i * 3, p.r * 29 + i); px(c, x + ((hh * 71) % TS | 0), y + ((hh * 37) % TS | 0), ratio < .33 ? '#120d10' : P.hullX); } if (ratio < .33) { px(c, x + 2, y + 2, '#000'); } }
}
function renderShip() {
  sctx.clearRect(0, 0, SHIP.w, SHIP.h);
  for (const p of parts) { if (p.build < 1) continue; drawPart(sctx, p, p.c * TS, p.r * TS); }
  // upgrade slots (dotted outline)
  for (const s in slotCells) if (!SHIP.applied[s]) for (const { c, r } of slotCells[s]) { sctx.fillStyle = 'rgba(54,226,208,.35)'; for (let i = 0; i < TS; i += 2) { sctx.fillRect(c * TS + i, r * TS, 1, 1); sctx.fillRect(c * TS + i, r * TS + TS - 1, 1, 1); sctx.fillRect(c * TS, r * TS + i, 1, 1); sctx.fillRect(c * TS + TS - 1, r * TS + i, 1, 1); } }
  SHIP.dirty = false;
}

// ---------------- HOSTILES ----------------
const HPAL = { k: P.hostX, d: '#4a0f1e', r: P.hostD, h: P.hostile, o: '#ff8a3b', e: P.amber, g: '#3d3648', l: '#6b6380', w: '#ffffff', m: P.magenta, c: '#2a1a3a' };
function makeSprite(rows, pal) { const w = rows[0].length, h = rows.length; const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const c = cv.getContext('2d'); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const ch = rows[y][x]; if (pal[ch]) { c.fillStyle = pal[ch]; c.fillRect(x, y, 1, 1); } } return cv; }
const HOSTILE_DEF = {
  wasp: { name: 'Wasp', cls: 'Interceptor', hp: 60, speed: 95, range: 115, cool: .9, dmg: 10, weapon: 'bolt', weapons: ['Twin plasma bolters'], threat: 1, role: 'Fast harasser. Strafes armor.', sprite: [
    '......kk......', '....kkrrk.....', '..kkrrhrrk....', 'kerrhhrrrkkgg.', 'kerrhhrrrkkgg.', '..kkrrhrrk....', '....kkrrk.....', '......kk......'] },
  hammerhead: { name: 'Hammerhead', cls: 'Gunship', hp: 170, speed: 55, range: 150, cool: 2.4, dmg: 38, weapon: 'rail', weapons: ['Spinal railgun', 'Ablative armor'], threat: 2, role: 'Slow. Heavy single shots crack plating.', sprite: [
    '.....kkkkkkkk....', '...kkrrrrrrrrkk..', '.kkrrhhrrrrrrrkkk', 'kerrhhhrrrrddkggg', 'keeerrrrrrrddkggg', 'kerrhhhrrrrddkggg', '.kkrrhhrrrrrrrkkk', '...kkrrrrrrrrkk..', '.....kkkkkkkk....'] },
  leech: { name: 'Leech', cls: 'Drain Frigate', hp: 100, speed: 70, range: 85, cool: .25, dmg: 3, weapon: 'tether', weapons: ['Siphon tether', 'EM jammers'], threat: 2, role: 'Latches on. Drains shields and power.', sprite: [
    '....kcc......', '..kkcmmck....', 'kccmmmmmck...', 'kcmemmemckk..', 'kccmmmmmck.kk', '..kkcmmck..kk', '....kcc...kk.', '.........kk..'] },
  warden: { name: 'Warden', cls: 'Heavy Cruiser', hp: 420, speed: 38, range: 175, cool: 3.0, dmg: 22, weapon: 'missile', weapons: ['Missile pods x2', 'Burst laser', 'Flak screen'], threat: 3, role: 'Capital-class. Salvos of homing missiles.', sprite: [
    '........kkkkkkkkkkk......', '......kkrrrrrrrrrrrkk....', '....kkrrhhrrrrrrrrrrkk...', '..kkrrrhhhrrrrdddrrrrkkgg', 'kerrrhhhhhrrrrdddrrrrkkgg', 'keeerrrrrrrrrrdddrrrrkggg', 'kerrrhhhhhrrrrdddrrrrkkgg', '..kkrrrhhhrrrrdddrrrrkkgg', '....kkrrhhrrrrrrrrrrkk...', '......kkrrrrrrrrrrrkk....', '........kkkkkkkkkkk......'] },
};
for (const k in HOSTILE_DEF) HOSTILE_DEF[k].img = makeSprite(HOSTILE_DEF[k].sprite, HPAL);
let hostileSeq = 0;
function spawnHostile(kind = 'wasp') {
  const def = HOSTILE_DEF[kind] || HOSTILE_DEF.wasp; const n = ++hostileSeq;
  const side = rand() < .5 ? -1 : 1; const sx = 380 + rand(60), sy = side * rand(40, 150);
  const used = hostiles.filter(h => h.state !== 'dead' && h.state !== 'retreat').map(h => h.slot);
  let slot = 0; for (let i = 0; i < 12; i++) { const cand = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6][i]; if (!used.includes(cand)) { slot = cand; break; } }
  const h = { id: `${def.name.toUpperCase()}-${pad2(n)}`, kind, def, x: sx, y: sy, hp: def.hp, max: def.hp, state: 'warp', st: 0, cool: def.cool * .6 + rand(.5), slot, ang: 0, warp: 0, flash: 0, orbit: rand(TAU), hits: 0, dmgDealt: 0, spawnT: sim.t };
  hostiles.push(h); sfx.warp(); addRing(sx, sy, 2, 26, P.hostile, .5); addFloater(sx, sy - 14, 'WARP-IN', P.hostile, 1.4);
  log('hostile', 'combat', `<b>${h.id}</b> ${def.cls.toLowerCase()} warped in. Threat ${'!'.repeat(def.threat)}`);
  bus.emit('spawn', { id: h.id, kind }); setCondition(); say(pick([`Contact. ${def.name}-class on approach.`, `${def.cls} signature at ${Math.round(dist(sx, sy, 0, 0))} km. Tracking.`, `Unknown hull warping in. Arming point defense.`]));
  return h;
}
function engagePos(h) { const a = h.slot * .42 + Math.sin(sim.t * .35 + h.orbit) * .18; const r = h.def.range; return { x: Math.cos(a) * r, y: Math.sin(a) * r * .72 }; }
function pickTargetPart() { const ex = parts.filter(p => alive(p) && exposed(p)); if (!ex.length) return parts.find(alive) || null; const weighted = ex.flatMap(p => p.type === '#' || p.type === '>' ? [p, p, p] : [p]); return pick(weighted); }
function updateHostile(h, dt) {
  h.st += dt; h.flash = Math.max(0, h.flash - dt * 6);
  const tx = SHIP.cx, ty = SHIP.cy; h.ang = Math.atan2(ty - h.y, tx - h.x);
  if (h.state === 'warp') { h.warp = Math.min(1, h.st / .6); if (h.st > .6) { h.state = 'approach'; h.st = 0; } return; }
  if (h.state === 'approach' || h.state === 'engage') {
    const e = engagePos(h); const d = dist(h.x, h.y, e.x, e.y); const sp = h.def.speed * (h.state === 'approach' ? 1 : .5);
    if (d > 2) { const k = Math.min(1, sp * dt / d); h.x += (e.x - h.x) * k; h.y += (e.y - h.y) * k; }
    if (h.state === 'approach' && d < 12) { h.state = 'engage'; h.st = 0; log('hostile', 'combat', `<b>${h.id}</b> in weapons range. Engaging.`); }
    if (h.state === 'engage' && h.kind === 'leech' && d < 14) h.tether = true; else h.tether = false;
    h.cool -= dt; if (h.state === 'engage' && h.cool <= 0 && parts.some(alive)) { fireHostile(h); h.cool = h.def.cool * rand(.85, 1.2); }
    if (h.tether) drainTether(h, dt);
  }
  if (h.state === 'retreat') { h.x += Math.cos(h.ang + Math.PI) * 140 * dt; h.y += Math.sin(h.ang + Math.PI) * 140 * dt; if (Math.abs(h.x) > 600) h.state = 'gone'; }
  if (h.state === 'dying') { if (h.st > .5) { h.state = 'dead'; } }
}
function fireHostile(h) {
  const target = pickTargetPart(); if (!target) return; const tp = partPos(target); const w = h.def.weapon;
  if (w === 'bolt') { for (let i = 0; i < 2; i++) setTimeout(() => shots.push({ kind: 'bolt', x: h.x, y: h.y, tx: tp.x, ty: tp.y, part: target, dmg: h.def.dmg, speed: 260, from: h, color: P.hostile, len: 5, life: 0 }), i * 90); sfx.bolt(); }
  else if (w === 'rail') { shots.push({ kind: 'rail', x: h.x, y: h.y, tx: tp.x, ty: tp.y, part: target, dmg: h.def.dmg, speed: 520, from: h, color: '#ffe3d6', len: 14, life: 0 }); sfx.rail(); addShake(1.5); }
  else if (w === 'tether') { /* handled by drainTether */ }
  else if (w === 'missile') { for (let i = 0; i < 2; i++) { const t2 = i ? pickTargetPart() || target : target; const pp = partPos(t2); shots.push({ kind: 'missile', x: h.x, y: h.y + (i ? 6 : -6), vx: Math.cos(h.ang + (i ? .8 : -.8)) * 60, vy: Math.sin(h.ang + (i ? .8 : -.8)) * 60, tx: pp.x, ty: pp.y, part: t2, dmg: h.def.dmg, from: h, color: P.amber, life: 0, maxLife: 5 }); } sfx.launch();
    if (rand() < .5) { beams.push({ x1: h.x, y1: h.y, x2: tp.x, y2: tp.y, color: P.hostile, life: .14, max: .14, w: 1 }); setTimeout(() => applyDamage(target, 8, h, 'laser'), 60); sfx.zap(); } }
  bus.emit('fire', { from: h.id, weapon: w, target: target.id });
}
function drainTether(h, dt) {
  const amt = 14 * dt; if (SHIP.shield > 0) { SHIP.shield = Math.max(0, SHIP.shield - amt); h.dmgDealt += amt; shieldAgg.n++; shieldAgg.dmg += amt; shieldAgg.last = sim.t; }
  else { h.drainT = (h.drainT || 0) + dt; if (h.drainT > .5) { h.drainT = 0; const t = pickTargetPart(); if (t) applyDamage(t, 4, h, 'tether'); } }
  if (rand() < dt * 20) { const tp = partPos(parts[0]); particles.push({ x: lerp(h.x, SHIP.cx, rand()), y: lerp(h.y, SHIP.cy, rand()) + rand(-3, 3), vx: rand(-4, 4), vy: rand(-4, 4), life: .4, max: .4, c: P.magenta, s: 1 }); }
}
function killHostile(h, by = 'laser') {
  h.state = 'dying'; h.st = 0; sim.kills++; sfx.boom(); addShake(5); sim.flash = .25;
  for (let i = 0; i < 46; i++) { const a = rand(TAU), s = rand(20, 110); particles.push({ x: h.x, y: h.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(.4, 1.1), max: 1.1, c: pick([P.hostile, P.amber, '#ffe9c4', P.hostD, P.debrisL, P.white]), s: rand() < .3 ? 2 : 1 }); }
  for (let i = 0; i < 10; i++) particles.push({ x: h.x + rand(-6, 6), y: h.y + rand(-6, 6), vx: rand(-12, 12), vy: rand(-12, 12), life: rand(.8, 1.6), max: 1.6, c: P.smoke, s: 2, smoke: true });
  addRing(h.x, h.y, 2, 34, P.amber, .45); addRing(h.x, h.y, 2, 18, P.white, .25);
  log('ok', 'combat', `<b>${h.id}</b> destroyed by ${by}. Kill ${sim.kills}.`); bus.emit('destroyed', { id: h.id, kind: h.kind, by });
  say(pick(['Target neutralized.', 'Hostile hull breached. Debris clear.', 'Scratch one. Scanning for more.', 'Splash. Point defense holding.']));
  if (selected && selected.h === h) selectNone();
}

// ---------------- SHOTS / DAMAGE ----------------
const particles = [];
const shieldAgg = { n: 0, dmg: 0, last: 0, flushAt: 0 };
function shieldHitPoint(fx, fy, tx, ty) { // intersection of segment from (fx,fy) to (tx,ty) with shield ellipse
  const rx = 68, ry = 36, cx = SHIP.cx, cy = SHIP.cy; const dx = tx - fx, dy = ty - fy; const ox = fx - cx, oy = fy - cy;
  const A = dx * dx / (rx * rx) + dy * dy / (ry * ry), B = 2 * (ox * dx / (rx * rx) + oy * dy / (ry * ry)), C = ox * ox / (rx * rx) + oy * oy / (ry * ry) - 1;
  const disc = B * B - 4 * A * C; if (disc < 0) return { x: tx, y: ty }; const t = (-B - Math.sqrt(disc)) / (2 * A); return { x: fx + dx * clamp(t, 0, 1), y: fy + dy * clamp(t, 0, 1) };
}
function applyDamage(part, amount, from, how) {
  if (!part || part.dead) part = pickTargetPart(); if (!part) return;
  const pp = partPos(part);
  if (SHIP.shield > 0) {
    const absorbed = Math.min(SHIP.shield, amount); SHIP.shield -= absorbed; amount -= absorbed; if (from) from.dmgDealt += absorbed;
    const hp = from ? shieldHitPoint(from.x, from.y, pp.x, pp.y) : pp; addRing(hp.x, hp.y, 1, 10, P.ally, .3); sfx.shield();
    for (let i = 0; i < 5; i++) particles.push({ x: hp.x, y: hp.y, vx: rand(-25, 25), vy: rand(-25, 25), life: .3, max: .3, c: P.ally, s: 1 });
    shieldAgg.n++; shieldAgg.dmg += absorbed; shieldAgg.last = sim.t; SHIP.shieldFlash = .25;
    if (SHIP.shield <= 0) { log('crit', 'combat', `<b>Shields down.</b> Hull exposed.`); say('Deflectors collapsed. Taking it on the plating.'); bus.emit('shield.down'); }
    if (amount <= 0) return;
  }
  part.hp -= amount; if (from) { from.dmgDealt += amount; from.hits++; } SHIP.dirty = true; sfx.hit(); addShake(amount > 20 ? 3 : 1.2);
  addFloater(pp.x, pp.y - 4, `-${Math.round(amount)}`, amount > 20 ? P.hostile : '#ffd9b0', .9);
  for (let i = 0; i < (amount > 20 ? 10 : 4); i++) particles.push({ x: pp.x, y: pp.y, vx: rand(-40, 40), vy: rand(-40, 40), life: rand(.2, .5), max: .5, c: pick([P.orange, P.hullL, P.amber]), s: 1 });
  const fromId = from ? from.id : 'unknown';
  if (part.hp <= 0) { part.hp = 0; part.dead = true; log('crit', 'combat', `<b>${part.name} ${part.id}</b> destroyed by ${fromId}${exposed(part) ? ' — interior exposed' : ''}.`); bus.emit('breach', { part: part.id, type: part.type, by: fromId });
    for (let i = 0; i < 12; i++) particles.push({ x: pp.x, y: pp.y, vx: rand(-20, 20), vy: rand(-20, 20), life: rand(.6, 1.4), max: 1.4, c: P.smoke, s: 2, smoke: true });
    if (part.type === 'S') say('Shield emitter gone. Capacity reduced.'); else if (part.type === 'R') say('Reactor hit! Power dropping.'); else if (part.type === 'C') say('Bridge is burning. Rerouting control.'); else if (part.type === 'L') say('Lost a turret. Request resupply.');
    if (part.type === '#' || part.type === '>') say(pick(['Plating breached. Request repair pod.', 'Armor section gone. Interior exposed.']));
    if (sim.autoRepair) setTimeout(() => sendPod({ part }), 700);
  } else { log('warn', 'combat', `${fromId} hits <b>${part.name} ${part.id}</b> (−${Math.round(amount)}, ${Math.round(part.hp / part.max * 100)}%)`); bus.emit('hit', { part: part.id, amount: Math.round(amount), by: fromId }); }
  refreshInspector();
}
function updateShots(dt) {
  for (let i = shots.length - 1; i >= 0; i--) { const s = shots[i]; s.life += dt;
    if (s.kind === 'missile') { const ang = Math.atan2(s.ty - s.y, s.tx - s.x); const want = { x: Math.cos(ang) * 120, y: Math.sin(ang) * 120 }; s.vx += (want.x - s.vx) * dt * 2.2; s.vy += (want.y - s.vy) * dt * 2.2; s.x += s.vx * dt; s.y += s.vy * dt;
      if (rand() < .8) particles.push({ x: s.x, y: s.y, vx: rand(-5, 5), vy: rand(-5, 5), life: .35, max: .35, c: pick([P.amber, P.smoke]), s: 1 });
      const sh = SHIP.shield > 0 ? shieldHitPoint(s.from.x, s.from.y, s.tx, s.ty) : null; const goal = sh || { x: s.tx, y: s.ty };
      if (dist(s.x, s.y, goal.x, goal.y) < 4 || s.life > s.maxLife) { shots.splice(i, 1); applyDamage(s.part, s.dmg, s.from, 'missile'); addRing(goal.x, goal.y, 1, 9, P.amber, .2); }
      continue; }
    const d = dist(s.x, s.y, s.tx, s.ty); const step = s.speed * dt; const sh = SHIP.shield > 0 ? shieldHitPoint(s.from.x, s.from.y, s.tx, s.ty) : null;
    if (sh && dist(s.x, s.y, sh.x, sh.y) <= step) { shots.splice(i, 1); applyDamage(s.part, s.dmg, s.from, s.kind); continue; }
    if (d <= step) { shots.splice(i, 1); applyDamage(s.part, s.dmg, s.from, s.kind); continue; }
    s.x += (s.tx - s.x) / d * step; s.y += (s.ty - s.y) / d * step; }
}
function updateBeams(dt) { for (let i = beams.length - 1; i >= 0; i--) { beams[i].life -= dt; if (beams[i].life <= 0) beams.splice(i, 1); } }
function updateDefense(dt) {
  const st = shipStats(); const targets = hostiles.filter(h => ['approach', 'engage'].includes(h.state));
  for (const p of parts) { if (p.type !== 'L' || !alive(p)) continue; p.cool -= dt;
    const pp = partPos(p); let best = null, bd = 1e9; for (const h of targets) { const d = dist(pp.x, pp.y, h.x, h.y); if (d < bd) { bd = d; best = h; } }
    if (best) p.aim = Math.atan2(best.y - pp.y, best.x - pp.x); else p.aim += (0 - p.aim) * dt * 2;
    if (!sim.autoDef || !best || bd > 230 || p.cool > 0) continue;
    p.cool = 1.25 / Math.max(.35, .55 + st.power * .45) * (p.focus ? .8 : 1); const dmg = 12 + (parts.find(x => x.type === 'C' && alive(x)) ? 2 : -3);
    const tgt = (focusTarget && ['approach', 'engage'].includes(focusTarget.state)) ? focusTarget : best;
    beams.push({ x1: pp.x + Math.cos(p.aim) * 3, y1: pp.y + Math.sin(p.aim) * 3, x2: tgt.x + rand(-2, 2), y2: tgt.y + rand(-2, 2), color: P.ally, life: .12, max: .12, w: 1 }); sfx.zap();
    tgt.hp -= dmg; tgt.flash = 1; for (let k = 0; k < 4; k++) particles.push({ x: tgt.x, y: tgt.y, vx: rand(-30, 30), vy: rand(-30, 30), life: .3, max: .3, c: pick([P.ally, P.white, P.hostile]), s: 1 });
    bus.emit('laser', { turret: p.id, target: tgt.id, dmg });
    if (tgt.hp <= 0 && tgt.state !== 'dying') killHostile(tgt, `turret ${p.id}`);
  }
}

// ---------------- PODS (Earth supply) ----------------
function earthLaunchPoint() { const a = Math.atan2(SHIP.cy - EARTH.y, SHIP.cx - EARTH.x); return { x: EARTH.x + Math.cos(a) * (EARTH.r + 2), y: EARTH.y + Math.sin(a) * (EARTH.r + 2), a }; }
function sendPod({ part, upgrade, cells } = {}) {
  let targetCells, label, type;
  if (upgrade) { const u = UPGRADES[upgrade]; if (!u) return log('warn', 'supply', `Unknown upgrade <b>${upgrade}</b>.`); if (SHIP.applied[upgrade]) return log('info', 'supply', `${u.name} already installed.`);
    SHIP.applied[upgrade] = 'pending'; targetCells = slotCells[u.slot].map(x => ({ ...x })); label = u.name; type = u.type; }
  else { if (!part) { const dmg = parts.filter(p => p.hp < p.max && p.build >= 1 && !p.queued).sort((a, b) => (a.hp / a.max) - (b.hp / b.max)); part = dmg[0]; }
    if (!part) { log('info', 'supply', 'No damage to repair. Pod request cancelled.'); say('All systems nominal. No resupply needed.'); return null; }
    part.queued = true; targetCells = [{ c: part.c, r: part.r, part }]; label = `${part.dead ? 'Replacement' : 'Repair kit'}: ${part.name} ${part.id}`; type = part.type; }
  const lp = earthLaunchPoint(); sim.pods++;
  const pod = { id: `POD-${pad2(sim.pods)}`, x: lp.x, y: lp.y, sx: lp.x, sy: lp.y, t: 0, dur: 2.4, cells: targetCells, label, type, upgrade, part, state: 'fly', ctrl: { x: lerp(lp.x, SHIP.cx, .45), y: lerp(lp.y, SHIP.cy, .45) - 70 } };
  const first = targetCells[0]; pod.tx = SHIP.ox + first.c * TS + TS / 2; pod.ty = SHIP.oy + first.r * TS + TS / 2;
  pods.push(pod); sfx.launch(); addRing(lp.x, lp.y, 1, 14, P.supply, .4); addFloater(lp.x, lp.y - 10, 'LAUNCH', P.supply, 1.2);
  for (let i = 0; i < 14; i++) particles.push({ x: lp.x, y: lp.y, vx: Math.cos(lp.a + rand(-1, 1)) * rand(10, 40), vy: Math.sin(lp.a + rand(-1, 1)) * rand(10, 40), life: rand(.4, .9), max: .9, c: pick([P.supply, '#fff1c9', P.smoke]), s: 1 });
  log('supply', 'supply', `<b>${pod.id}</b> launched from Earth: ${label}.`); bus.emit('pod.launch', { id: pod.id, label, upgrade: upgrade || null, part: part ? part.id : null });
  say(upgrade ? `Supply pod inbound with ${label}. Clearing dock.` : pick(['Repair pod away. ETA 2 seconds.', 'Earth control confirms launch. Standing by to dock.']));
  return pod;
}
function updatePods(dt) {
  for (let i = pods.length - 1; i >= 0; i--) { const p = pods[i];
    if (p.state === 'fly') { p.t += dt / p.dur; const t = Math.min(1, p.t); const e = t * t * (3 - 2 * t); const mt = 1 - e;
      p.x = mt * mt * p.sx + 2 * mt * e * p.ctrl.x + e * e * p.tx; p.y = mt * mt * p.sy + 2 * mt * e * p.ctrl.y + e * e * p.ty;
      if (rand() < .9) particles.push({ x: p.x, y: p.y, vx: rand(-6, 6), vy: rand(-6, 6), life: .4, max: .4, c: pick([P.supply, '#fff1c9', '#8a7a4a']), s: 1 });
      if (t >= 1) { p.state = 'dock'; p.t = 0; sfx.dock(); addRing(p.tx, p.ty, 1, 8, P.supply, .3); log('supply', 'supply', `<b>${p.id}</b> docked. Reforming ${p.cells.length} cell${p.cells.length > 1 ? 's' : ''}.`); bus.emit('pod.dock', { id: p.id }); }
    } else if (p.state === 'dock') { p.t += dt; const idx = Math.floor(p.t / .55);
      if (idx > (p.doneIdx ?? -1)) { // start building next cell
        p.doneIdx = idx; const cell = p.cells[idx]; if (!cell) { p.state = 'done'; pods.splice(i, 1); finishPod(p); continue; }
        let part = cell.part || partAt(cell.c, cell.r);
        if (!part) { const def = PART_DEF[p.type]; const n = parts.filter(q => q.def.code === def.code).length + 1; part = { id: def.code + n, type: p.type, c: cell.c, r: cell.r, hp: def.hp, max: def.hp, build: 0, name: def.name, def, dead: false, cool: 0, aim: 0 }; parts.push(part); SHIP.grid[cell.r][cell.c] = part; }
        part.dead = false; part.hp = part.max; part.build = 0; part.queued = false; part.buildT = sim.t; SHIP.dirty = true; bus.emit('part.rebuild', { part: part.id }); }
    } }
  for (const part of parts) if (part.build < 1) { part.build = Math.min(1, part.build + dt / .5); const pp = partPos(part); if (rand() < .7) { particles.push({ x: pp.x + rand(-3, 3), y: pp.y - 3 + part.build * 6, vx: rand(-15, 15), vy: rand(-20, 5), life: .3, max: .3, c: pick([P.ally, P.white, P.supply]), s: 1 }); sfx.build(); } if (part.build >= 1) { SHIP.dirty = true; refreshInspector(); } }
}
function finishPod(p) {
  if (p.upgrade) { SHIP.applied[p.upgrade] = true; const u = UPGRADES[p.upgrade]; log('ok', 'supply', `<b>${u.name}</b> online. ${u.desc}`); bus.emit('upgrade.done', { id: p.upgrade }); say(pick([`${u.name} integrated. Ship reconfigured.`, 'New module synced to the reactor bus.'])); renderUpgradeSelect(); }
  else { log('ok', 'supply', `<b>${p.cells[0].part.name} ${p.cells[0].part.id}</b> restored to 100%.`); bus.emit('repair.done', { part: p.cells[0].part.id }); }
  SHIP.dirty = true; refreshInspector();
}

// ---------------- fx helpers ----------------
function addRing(x, y, r0, r1, c, life) { rings.push({ x, y, r0, r1, c, life, max: life }); }
function addFloater(x, y, text, c, life) { floaters.push({ x, y, text, c, life, max: life }); }
function addShake(a) { sim.shake = Math.min(8, sim.shake + a); }

// ---------------- camera ----------------
function updateCamera(dt) {
  let minX = SHIP.ox - 30, maxX = SHIP.ox + SHIP.w + 30, minY = SHIP.oy - 30, maxY = SHIP.oy + SHIP.h + 30;
  for (const h of hostiles) if (['warp', 'approach', 'engage', 'dying'].includes(h.state)) { minX = Math.min(minX, h.x - 24); maxX = Math.max(maxX, h.x + 24); minY = Math.min(minY, h.y - 20); maxY = Math.max(maxY, h.y + 20); }
  for (const p of pods) if (p.state === 'fly') { minX = Math.min(minX, p.x - 10); maxX = Math.max(maxX, p.x + 10); minY = Math.min(minY, p.y - 10); maxY = Math.max(maxY, p.y + 10); }
  // usable viewport = area not covered by the UI windows (log left, inspector right, console bottom, topbar)
  const ins = uiInsets(); const uw = VW - ins.l - ins.r, uh = VH - ins.t - ins.b;
  const w = maxX - minX + 50, h = maxY - minY + 50; const z = clamp(Math.min(uw / w, uh / h), .5, 1);
  const calm = z >= 1 && !hostiles.some(h => h.state !== 'gone' && h.state !== 'dead') && !pods.length;
  cam.tz = z; cam.tx = (minX + maxX) / 2 - (ins.l - ins.r) / 2 / z + (calm ? -30 : 0); cam.ty = (minY + maxY) / 2 - (ins.t - ins.b) / 2 / z + (calm ? 22 : 0);
  const k = 1 - Math.pow(.02, dt); cam.x += (cam.tx - cam.x) * k; cam.y += (cam.ty - cam.y) * k; cam.z += (cam.tz - cam.z) * k * .8;
}
let insetCache = { l: 0, r: 0, t: 0, b: 0, at: -1 };
function uiInsets() {
  if (sim.t - insetCache.at < .5) return insetCache;
  const vis = id => { const e = document.getElementById(id); if (!e || e.classList.contains('minimized') || getComputedStyle(e).display === 'none') return null; return e.getBoundingClientRect(); };
  let l = 0, r = 0, t = 0, b = 0; const W = innerWidth, H = innerHeight;
  for (const id of ['win-log', 'win-inspector', 'win-console', 'win-comms', 'topbar']) { const q = vis(id); if (!q) continue;
    if (q.height >= H * .45 && q.right <= W * .55) l = Math.max(l, q.right); else if (q.height >= H * .45 && q.left >= W * .45) r = Math.max(r, W - q.left);
    else if (q.top >= H * .45) b = Math.max(b, H - q.top); else if (q.bottom <= H * .5) t = Math.max(t, q.bottom); }
  if (W - l - r < 260 || H - t - b < 200) { l = r = 0; b = Math.min(b, H * .4); } // never let the UI squeeze the camera into nothing
  insetCache = { l: l / SCALE, r: r / SCALE, t: t / SCALE, b: b / SCALE, at: sim.t };
  return insetCache;
}
const w2s = (x, y) => ({ x: ((x - cam.x) * cam.z + VW / 2) * SCALE, y: ((y - cam.y) * cam.z + VH / 2) * SCALE });
const s2w = (sx, sy) => ({ x: (sx / SCALE - VW / 2) / cam.z + cam.x, y: (sy / SCALE - VH / 2) / cam.z + cam.y });

// ---------------- render ----------------
let hover = null, selected = null, focusTarget = null;
function render() {
  const t = sim.t; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#05060f'; ctx.fillRect(0, 0, VW, VH);
  const shx = (rand(-1, 1) * sim.shake) | 0, shy = (rand(-1, 1) * sim.shake) | 0;
  // nebula parallax
  ctx.drawImage(nebula, Math.round(-100 - cam.x * .08 + shx * .3), Math.round(-100 - cam.y * .08 + shy * .3));
  // stars
  for (const s of stars) { const px_ = Math.round((s.x - cam.x * (.25 + s.l * .4)) * 1 + VW / 2), py_ = Math.round((s.y - cam.y * (.25 + s.l * .4)) + VH / 2); if (px_ < 0 || py_ < 0 || px_ >= VW || py_ >= VH) continue; const tw = .6 + .4 * Math.sin(t * 2 + s.tw); ctx.globalAlpha = s.l * (s.l > .5 ? tw : 1); ctx.fillStyle = s.c; ctx.fillRect(px_, py_, 1, 1); if (s.l === 1 && tw > .9) { ctx.globalAlpha = .4; ctx.fillRect(px_ - 1, py_, 3, 1); ctx.fillRect(px_, py_ - 1, 1, 3); } }
  ctx.globalAlpha = 1;
  // world transform
  ctx.setTransform(cam.z, 0, 0, cam.z, Math.round(VW / 2 - cam.x * cam.z + shx), Math.round(VH / 2 - cam.y * cam.z + shy));
  // Earth
  ctx.drawImage(earthCan, Math.round(EARTH.x - ER), Math.round(EARTH.y - ER));
  // pods trail glow + sprite
  for (const p of pods) if (p.state === 'fly') { const ang = Math.atan2(p.ty - p.y, p.tx - p.x); ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.rotate(ang); ctx.fillStyle = P.hullX; ctx.fillRect(-4, -2, 8, 4); ctx.fillStyle = P.supply; ctx.fillRect(-3, -1, 6, 2); ctx.fillStyle = P.white; ctx.fillRect(1, -1, 2, 1); ctx.fillStyle = ((t * 30) | 0) % 2 ? P.orange : '#fff1c9'; ctx.fillRect(-7, -1, 3, 2); ctx.restore(); }
  // ship prerender
  if (SHIP.dirty) renderShip();
  // thruster flames (behind ship)
  for (const p of parts) if (p.type === 'T' && alive(p) && !partAt(p.c - 1, p.r)) { const pp = partPos(p); const len = 4 + ((Math.sin(t * 25 + p.r * 3) + 1) * 2.2) | 0; ctx.fillStyle = P.allyD; ctx.fillRect(pp.x - 3 - len, pp.y - 1, len, 3); ctx.fillStyle = P.ally; ctx.fillRect(pp.x - 3 - len * .6, pp.y - 1, len * .6, 2); ctx.fillStyle = P.white; ctx.fillRect(pp.x - 3 - 2, pp.y, 2, 1); }
  ctx.drawImage(shipCan, SHIP.ox, SHIP.oy);
  // building parts: scanline reveal
  for (const p of parts) if (p.build < 1) { const x = SHIP.ox + p.c * TS, y = SHIP.oy + p.r * TS; ctx.save(); ctx.beginPath(); ctx.rect(x, y, TS, Math.ceil(TS * p.build)); ctx.clip(); ctx.drawImage(shipCan, 0, 0); ctx.translate(SHIP.ox, SHIP.oy); drawPart(ctx, p, p.c * TS, p.r * TS); ctx.restore(); ctx.fillStyle = ((t * 20) | 0) % 2 ? P.ally : P.white; ctx.fillRect(x - 1, y + Math.floor(TS * p.build), TS + 2, 1); ctx.strokeStyle = P.ally; ctx.globalAlpha = .6; ctx.strokeRect(x - 1.5, y - 1.5, TS + 3, TS + 3); ctx.globalAlpha = 1; }
  // dynamic part overlays
  for (const p of parts) { if (!alive(p)) continue; const pp = partPos(p);
    if (p.type === 'R') { const k = (Math.sin(t * 6 + p.c) + 1) / 2; ctx.fillStyle = k > .5 ? P.core : P.coreH; ctx.fillRect(pp.x - 1, pp.y - 1, 1, 1); ctx.fillRect(pp.x, pp.y, 1, 1); if (k > .8) { ctx.fillStyle = P.white; ctx.fillRect(pp.x - 1, pp.y, 1, 1); } }
    else if (p.type === 'S') { const k = (Math.sin(t * 4 + p.r) + 1) / 2; if (k > .5 && SHIP.shield > 0) { ctx.fillStyle = P.white; ctx.fillRect(pp.x - 1, pp.y - 1, 1, 1); } }
    else if (p.type === 'L') { ctx.strokeStyle = P.hullL; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pp.x, pp.y); ctx.lineTo(pp.x + Math.cos(p.aim) * 3.5, pp.y + Math.sin(p.aim) * 3.5); ctx.stroke(); ctx.fillStyle = p.cool > .9 ? P.ally : P.hullX; ctx.fillRect(pp.x - 1, pp.y - 1, 1, 1); }
    else if (p.type === 'C') { if (((t * 2) | 0) % 2) { ctx.fillStyle = P.white; ctx.fillRect(pp.x - 1, pp.y - 1, 1, 1); } }
    if (!p.dead && p.hp / p.max < .34 && rand() < .15) particles.push({ x: pp.x + rand(-2, 2), y: pp.y, vx: rand(-4, 4), vy: rand(-14, -6), life: rand(.5, 1), max: 1, c: pick([P.smoke, '#3a3542']), s: 1, smoke: true }); }
  // shield bubble
  const st = shipStats(); if (SHIP.shieldMax > 0 && SHIP.shield > 0) { const a = .22 + st.shieldPct * .45 + (SHIP.shieldFlash || 0); ctx.globalAlpha = Math.min(1, a); ctx.strokeStyle = P.ally; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(SHIP.cx, SHIP.cy, 68, 36, 0, 0, TAU); ctx.stroke(); ctx.globalAlpha = a * .25; ctx.fillStyle = P.ally; ctx.fill(); ctx.globalAlpha = 1; SHIP.shieldFlash = Math.max(0, (SHIP.shieldFlash || 0) - .02); }
  // hostiles
  for (const h of hostiles) { if (h.state === 'dead' || h.state === 'gone') continue; const img = h.def.img; ctx.save(); ctx.translate(Math.round(h.x), Math.round(h.y)); ctx.rotate(h.ang - Math.PI);
    if (h.state === 'warp') { const k = h.warp; ctx.globalAlpha = k; ctx.scale(1 + (1 - k) * 3, Math.max(.05, k)); }
    // engine flame at back (right side in local)
    if (h.state !== 'dying') { const fl = 3 + ((Math.sin(t * 30 + h.slot) + 1) * 2) | 0; ctx.fillStyle = h.kind === 'leech' ? P.magenta : P.orange; ctx.fillRect(img.width / 2 - 1, -1, fl, 2); ctx.fillStyle = '#fff1c9'; ctx.fillRect(img.width / 2 - 1, 0, 2, 1); }
    ctx.drawImage(img, -img.width / 2 | 0, -img.height / 2 | 0);
    if (h.flash > 0) { ctx.globalCompositeOperation = 'source-atop'; ctx.globalAlpha = h.flash * .8; ctx.fillStyle = '#fff'; ctx.fillRect(-img.width / 2, -img.height / 2, img.width, img.height); ctx.globalCompositeOperation = 'source-over'; }
    if (h.state === 'dying') { ctx.globalAlpha = 1 - h.st * 2; ctx.fillStyle = '#fff'; ctx.fillRect(-img.width / 2, -img.height / 2, img.width, img.height); }
    ctx.restore();
    if (h.tether) { ctx.strokeStyle = P.magenta; ctx.lineWidth = 1; ctx.globalAlpha = .8; ctx.beginPath(); ctx.moveTo(h.x, h.y); for (let k = 1; k <= 8; k++) { const u = k / 8; ctx.lineTo(lerp(h.x, SHIP.cx, u) + Math.sin(t * 25 + k) * 3 * (1 - Math.abs(u - .5) * 2), lerp(h.y, SHIP.cy, u) + Math.cos(t * 19 + k * 2) * 3); } ctx.stroke(); ctx.globalAlpha = 1; }
    if ((hover && hover.h === h) || (selected && selected.h === h) || focusTarget === h) { const isSel = selected && selected.h === h; ctx.strokeStyle = focusTarget === h ? P.hostile : isSel ? P.white : P.amber; ctx.lineWidth = 1; const r = img.width / 2 + 4; ctx.setLineDash([2, 2]); ctx.lineDashOffset = -t * 10; ctx.strokeRect(Math.round(h.x - r) + .5, Math.round(h.y - r) + .5, r * 2, r * 2); ctx.setLineDash([]); }
    if (h.state !== 'dying') { const w = img.width; const hpw = Math.round(w * h.hp / h.max); ctx.fillStyle = '#0a0b12'; ctx.fillRect(Math.round(h.x - w / 2), Math.round(h.y - img.height / 2) - 5, w, 2); ctx.fillStyle = h.hp / h.max > .5 ? P.hostile : P.amber; ctx.fillRect(Math.round(h.x - w / 2), Math.round(h.y - img.height / 2) - 5, hpw, 2); }
  }
  // part hover/selection
  const hp = hover && hover.part ? hover.part : null; const sp = selected && selected.part ? selected.part : null;
  for (const [p, c] of [[hp, P.white], [sp, P.ally]]) if (p) { ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.strokeRect(SHIP.ox + p.c * TS - .5, SHIP.oy + p.r * TS - .5, TS + 1, TS + 1); }
  if ((hover && hover.ship) || (selected && selected.ship)) { ctx.strokeStyle = selected && selected.ship ? P.ally : P.white; ctx.setLineDash([3, 3]); ctx.lineDashOffset = -t * 8; ctx.strokeRect(SHIP.ox - 3.5, SHIP.oy - 3.5, SHIP.w + 7, SHIP.h + 7); ctx.setLineDash([]); }
  if ((hover && hover.earth) || (selected && selected.earth)) { ctx.strokeStyle = selected && selected.earth ? P.supply : P.white; ctx.setLineDash([4, 4]); ctx.lineDashOffset = -t * 8; ctx.beginPath(); ctx.arc(EARTH.x, EARTH.y, EARTH.r + 12, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
  // shots
  for (const s of shots) { if (s.kind === 'missile') { ctx.fillStyle = P.hullL; ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 1, 3, 2); ctx.fillStyle = P.amber; ctx.fillRect(Math.round(s.x) - 2, Math.round(s.y), 1, 1); continue; }
    const ang = Math.atan2(s.ty - s.y, s.tx - s.x); ctx.strokeStyle = s.color; ctx.lineWidth = s.kind === 'rail' ? 2 : 1; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - Math.cos(ang) * s.len, s.y - Math.sin(ang) * s.len); ctx.stroke(); if (s.kind === 'rail') { ctx.strokeStyle = P.white; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - Math.cos(ang) * 4, s.y - Math.sin(ang) * 4); ctx.stroke(); } }
  // beams
  for (const b of beams) { const k = b.life / b.max; ctx.globalAlpha = k; ctx.strokeStyle = b.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke(); ctx.globalAlpha = 1; }
  // particles
  for (const p of particles) { ctx.globalAlpha = p.smoke ? (p.life / p.max) * .6 : Math.min(1, p.life / p.max * 2); ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s); } ctx.globalAlpha = 1;
  // rings
  for (const r of rings) { const k = 1 - r.life / r.max; ctx.globalAlpha = 1 - k; ctx.strokeStyle = r.c; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(r.x, r.y, lerp(r.r0, r.r1, k), 0, TAU); ctx.stroke(); } ctx.globalAlpha = 1;
  // flash
  if (sim.flash > 0) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = sim.flash; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, VW, VH); ctx.globalAlpha = 1; }
  renderLabels();
}
function renderLabels() {
  lctx.setTransform(DPR, 0, 0, DPR, 0, 0); lctx.clearRect(0, 0, labels.width, labels.height); lctx.font = '11px "Pixelated MS Sans Serif", monospace'; lctx.textBaseline = 'middle';
  const tag = (x, y, text, color, bg = 'rgba(5,6,15,.85)') => { const w = lctx.measureText(text).width + 8; lctx.fillStyle = bg; lctx.fillRect(x - w / 2 | 0, y - 8 | 0, w | 0, 15); lctx.fillStyle = color; lctx.fillText(text, (x - w / 2 + 4) | 0, y | 0); };
  for (const h of hostiles) { if (!['warp', 'approach', 'engage'].includes(h.state)) continue; const s = w2s(h.x, h.y); const show = hover && hover.h === h || selected && selected.h === h || h.state === 'warp' || sim.t - h.spawnT < 3; if (show) tag(s.x, s.y - (h.def.img.height / 2 + 14) * cam.z * SCALE / 2 - 8, `${h.id} · ${h.def.cls}`, P.hostile); }
  for (const p of pods) if (p.state === 'fly') { const s = w2s(p.x, p.y); tag(s.x, s.y - 16, p.id, P.supply); }
  if (hover && hover.part) { const pp = partPos(hover.part); const s = w2s(pp.x, pp.y); tag(s.x, s.y - 16, `${hover.part.name} ${hover.part.id} · ${hover.part.dead ? 'DESTROYED' : Math.round(hover.part.hp / hover.part.max * 100) + '%'}`, hover.part.dead ? P.hostile : P.white); }
  if (hover && hover.earth) { const s = w2s(EARTH.x, EARTH.y - EARTH.r); tag(s.x, s.y - 12, 'EARTH · supply origin', P.earth || '#6fd2ff'); }
  if (hover && hover.ship) { const s = w2s(SHIP.cx, SHIP.oy); tag(s.x, s.y - 18, 'AEGIS-1 · click for status', P.ally); }
  for (const f of floaters) { const s = w2s(f.x, f.y - (1 - f.life / f.max) * 10); lctx.globalAlpha = Math.min(1, f.life / f.max * 2); lctx.fillStyle = '#000'; lctx.fillText(f.text, s.x + 1 | 0, s.y + 1 | 0); lctx.fillStyle = f.c; lctx.fillText(f.text, s.x | 0, s.y | 0); } lctx.globalAlpha = 1;
}

// ---------------- update loop ----------------
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame); let dt = Math.min(.05, (now - last) / 1000); last = now; if (sim.paused) dt = 0;
  update(dt); render(); updatePortrait();
}
function update(dt) {
  sim.t += dt; EARTH.rot += dt * .006; EARTH.cloudRot += dt * .009; acc += dt; if (acc > .05 || !earthReady) { renderEarth(); acc = 0; earthReady = true; }
  if (dt > 0) {
    for (const h of hostiles) updateHostile(h, dt); for (let i = hostiles.length - 1; i >= 0; i--) if (['dead', 'gone'].includes(hostiles[i].state)) hostiles.splice(i, 1);
    updateShots(dt); updateBeams(dt); updateDefense(dt); updatePods(dt);
    const st = shipStats(); if (SHIP.shieldMax > 0 && SHIP.shield < SHIP.shieldMax && !hostiles.some(h => h.tether)) SHIP.shield = Math.min(SHIP.shieldMax, SHIP.shield + dt * (6 + 10 * st.power) * (SHIP.applied.capacitor === true ? 1.6 : 1)); if (SHIP.shield > SHIP.shieldMax) SHIP.shield = SHIP.shieldMax;
    for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .96; p.vy *= .96; if (p.life <= 0) particles.splice(i, 1); }
    for (let i = rings.length - 1; i >= 0; i--) { rings[i].life -= dt; if (rings[i].life <= 0) rings.splice(i, 1); }
    for (let i = floaters.length - 1; i >= 0; i--) { floaters[i].life -= dt; if (floaters[i].life <= 0) floaters.splice(i, 1); }
    sim.shake = Math.max(0, sim.shake - dt * 14); sim.flash = Math.max(0, sim.flash - dt * 2);
    if (shieldAgg.n && sim.t - shieldAgg.last > 1.2) { log('info', 'combat', `Shield absorbed <b>${shieldAgg.n} hit${shieldAgg.n > 1 ? 's' : ''}</b> (−${Math.round(shieldAgg.dmg)}). ${Math.round(SHIP.shield / Math.max(1, SHIP.shieldMax) * 100)}% left.`); shieldAgg.n = 0; shieldAgg.dmg = 0; }
    updateCamera(dt); setCondition(); updateHud();
  }
}
let earthReady = false;

// ---------------- HUD / UI ----------------
const el = { hull: $('#m-hull'), vh: $('#v-hull'), sh: $('#m-shield'), vs: $('#v-shield'), pw: $('#m-power'), vp: $('#v-power'), hs: $('#v-hostiles'), pods: $('#v-pods'), cond: $('#v-cond'), clock: $('#v-clock'), log: $('#log'), logCount: $('#log-count'), insp: $('#insp'), inspTitle: $('#insp-title') };
let hudT = 0;
function updateHud() { if (sim.t - hudT < .1) return; hudT = sim.t; const st = shipStats(); el.hull.style.width = (st.hull * 100) + '%'; el.vh.textContent = Math.round(st.hull * 100) + '%'; el.hull.style.background = st.hull > .5 ? 'var(--ok)' : st.hull > .25 ? 'var(--warn)' : 'var(--crit)';
  el.sh.style.width = (st.shieldPct * 100) + '%'; el.vs.textContent = Math.round(st.shieldPct * 100) + '%'; el.pw.style.width = (st.power * 100) + '%'; el.vp.textContent = Math.round(st.power * 100) + '%';
  el.hs.textContent = hostiles.filter(h => ['warp', 'approach', 'engage'].includes(h.state)).length; el.pods.textContent = sim.pods; const s = sim.t | 0; el.clock.textContent = `T+${pad2((s / 60) | 0)}:${pad2(s % 60)}`;
  if (selected && selected.h) refreshInspector(true); }
function setCondition() {
  const n = hostiles.filter(h => ['warp', 'approach', 'engage'].includes(h.state)).length; const st = shipStats();
  const c = n === 0 ? 'green' : (n >= 3 || st.hull < .5 || hostiles.some(h => h.def.threat >= 3)) ? 'red' : 'yellow';
  if (c === sim.cond) return; sim.cond = c; el.cond.className = 'chip ' + (c === 'green' ? 'calm' : c === 'yellow' ? 'alert' : 'red'); el.cond.textContent = `CONDITION ${c.toUpperCase()}`; document.body.classList.toggle('red-alert', c === 'red');
  if (c === 'red') { sfx.alert(); showAlert('RED ALERT', n >= 3 ? `${n} hostile signatures engaging.` : hostiles.some(h => h.def.threat >= 3) ? 'Capital-class hull inbound.' : 'Hull integrity critical.'); log('crit', 'system', `<b>Condition RED.</b>`); }
  else if (c === 'green') { log('ok', 'system', 'Condition GREEN. Threat board clear.'); bus.emit('clear'); } else log('warn', 'system', 'Condition YELLOW. Hostiles in range.');
}
let alertT = null; function showAlert(title, msg) { $('#alert-title').textContent = title; $('#alert-msg').textContent = msg; const pop = $('#alert-popup'); pop.classList.remove('show'); void pop.offsetWidth; pop.classList.add('show'); clearTimeout(alertT); alertT = setTimeout(() => pop.classList.remove('show'), 2600); }
const LOG_ICO = { info: 'info-box', ok: 'check', warn: 'alert', crit: 'warning-box', supply: 'truck', hostile: 'bullseye-arrow' }; let logN = 0, logFilter = 'all';
function log(level, cat, html) { const s = sim.t | 0; const d = document.createElement('div'); d.className = `le l-${level}`; d.dataset.cat = cat; d.innerHTML = `${icoSvg(LOG_ICO[level] || 'info-box')}<span class="ts">${pad2((s / 60) | 0)}:${pad2(s % 60)}</span><span class="msg">${html}</span>`; if (logFilter !== 'all' && cat !== logFilter) d.style.display = 'none'; el.log.appendChild(d); logN++; el.logCount.textContent = `${logN} events`; while (el.log.children.length > 300) el.log.firstChild.remove(); el.log.scrollTop = el.log.scrollHeight; bus.emit('log', { level, cat, text: d.querySelector('.msg').textContent }); }
$('#log-tabs').addEventListener('click', e => { const li = e.target.closest('li'); if (!li) return; e.preventDefault(); $$('#log-tabs li').forEach(x => x.setAttribute('aria-selected', x === li)); logFilter = li.dataset.f; $$('#log .le').forEach(x => x.style.display = logFilter === 'all' || x.dataset.cat === logFilter ? '' : 'none'); });
$('#b-clearlog').onclick = () => { el.log.innerHTML = ''; logN = 0; el.logCount.textContent = '0 events'; };

// comms
let sayQ = [], sayBusy = false, sayTimer = null;
function say(text) { sayQ.push(text); if (sayQ.length > 3) sayQ.shift(); if (!sayBusy) nextSay(); }
function nextSay() { const t = sayQ.shift(); if (!t) { sayBusy = false; return; } sayBusy = true; const elc = $('#comms-line'); elc.textContent = ''; let i = 0; clearInterval(sayTimer); sayTimer = setInterval(() => { elc.textContent = t.slice(0, ++i); if (i >= t.length) { clearInterval(sayTimer); setTimeout(nextSay, 1400); } }, 22); bus.emit('say', { text: t }); }
const pctx = $('#portrait').getContext('2d'); let blinkT = 0;
function updatePortrait() { const t = sim.t; const red = sim.cond === 'red'; pctx.fillStyle = red ? '#2a0810' : '#061612'; pctx.fillRect(0, 0, 16, 16); pctx.fillStyle = red ? '#4a0f1e' : '#0d2a24'; pctx.fillRect(2, 2, 12, 12); pctx.fillStyle = red ? '#8a1424' : '#16614a'; pctx.fillRect(3, 3, 10, 10);
  const blink = (t % 3.7) < .12; const talking = sayBusy && ((t * 12) | 0) % 2; pctx.fillStyle = red ? P.hostile : '#7fd36b'; if (!blink) { pctx.fillRect(5, 6, 2, 2); pctx.fillRect(9, 6, 2, 2); } else { pctx.fillRect(5, 7, 2, 1); pctx.fillRect(9, 7, 2, 1); }
  pctx.fillStyle = red ? P.amber : P.ally; pctx.fillRect(5, talking ? 10 : 11, 6, talking ? 2 : 1); pctx.fillStyle = '#fff'; pctx.fillRect(((t * 10) | 0) % 10 + 3, 3, 1, 1); }

// inspector
function selectNone() { selected = null; focusTarget = null; refreshInspector(); }
function spriteCanvas(img, scale = 3) { const c = document.createElement('canvas'); c.width = img.width * scale; c.height = img.height * scale; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(img, 0, 0, c.width, c.height); return c; }
function refreshInspector(light) {
  const box = el.insp; const win = $('#win-inspector'); win.className = 'window ' + (selected && selected.h ? 't-hostile' : selected && selected.earth ? 't-earth' : 't-ally');
  if (!selected) { el.inspTitle.textContent = 'Inspector'; if (light) return; box.innerHTML = `<p class="insp-note">Click a hostile, a hull cell, the ship, or Earth.</p><dl class="kv"><dt>Modules</dt><dd>${parts.filter(alive).length}/${parts.length}</dd><dt>Kills</dt><dd>${sim.kills}</dd><dt>Pods sent</dt><dd>${sim.pods}</dd></dl>`; return; }
  if (selected.h) { const h = selected.h; el.inspTitle.textContent = `${h.id}`; const pct = clamp(h.hp / h.max, 0, 1);
    if (light) { const b = box.querySelector('.bar.hp i'); if (b) b.style.width = (pct * 100) + '%'; const v = box.querySelector('[data-hp]'); if (v) v.textContent = `${Math.round(h.hp)}/${h.max}`; const s = box.querySelector('[data-state]'); if (s) s.textContent = h.state.toUpperCase(); return; }
    box.innerHTML = `<div class="insp-head"></div><div class="bar hp"><i style="width:${pct * 100}%"></i></div><dl class="kv"><dt>Hull</dt><dd data-hp>${Math.round(h.hp)}/${h.max}</dd><dt>State</dt><dd data-state>${h.state.toUpperCase()}</dd><dt>Speed</dt><dd>${h.def.speed} u/s</dd><dt>Range</dt><dd>${h.def.range} km</dd><dt>Threat</dt><dd class="pips">${'■'.repeat(h.def.threat)}${'□'.repeat(3 - h.def.threat)}</dd><dt>Damage dealt</dt><dd>${Math.round(h.dmgDealt)}</dd></dl><p class="insp-note">${h.def.role}</p><fieldset><legend>Weapons</legend><ul class="list bad">${h.def.weapons.map(w => `<li>${icoSvg('zap')}${w}</li>`).join('')}</ul></fieldset><div class="btn-row"><button id="i-focus" class="btn-ico">${icoSvg('bullseye')}${focusTarget === h ? 'Focused' : 'Focus fire'}</button><button id="i-retreat" class="btn-ico">${icoSvg('flag')}Force retreat</button></div>`;
    const head = box.querySelector('.insp-head'); head.appendChild(spriteCanvas(h.def.img, 3)); head.insertAdjacentHTML('beforeend', `<div><div class="insp-title">${h.def.name}-class</div><div class="insp-sub">${h.def.cls}</div></div>`);
    $('#i-focus').onclick = () => { focusTarget = focusTarget === h ? null : h; log('info', 'combat', focusTarget ? `Turrets focusing <b>${h.id}</b>.` : 'Focus fire cleared.'); refreshInspector(); }; $('#i-retreat').onclick = () => { h.state = 'retreat'; log('hostile', 'combat', `<b>${h.id}</b> disengaging.`); setCondition(); selectNone(); };
    return; }
  if (selected.part) { const p = selected.part; el.inspTitle.textContent = `${p.name} ${p.id}`; const pct = clamp(p.hp / p.max, 0, 1); if (light) return;
    box.innerHTML = `<div class="insp-head"></div><div class="bar ${p.dead ? 'bad' : 'hp'}"><i style="width:${p.dead ? 100 : pct * 100}%"></i></div><dl class="kv"><dt>Integrity</dt><dd>${p.dead ? 'DESTROYED' : Math.round(pct * 100) + '%'}</dd><dt>Cell</dt><dd>${p.c},${p.r}</dd><dt>Exposed</dt><dd>${exposed(p) ? 'yes' : 'no'}</dd></dl><p class="insp-note">${p.def.desc}</p><div class="btn-row"><button id="i-repair" class="btn-ico" ${p.hp >= p.max ? 'disabled' : ''}>${icoSvg('reload')}Send repair pod</button><button id="i-ship" class="btn-ico">${icoSvg('ship')}Ship status</button></div>`;
    const head = box.querySelector('.insp-head'); const c = document.createElement('canvas'); c.width = TS * 6; c.height = TS * 6; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; const tmp = document.createElement('canvas'); tmp.width = TS; tmp.height = TS; drawPart(tmp.getContext('2d'), p, 0, 0, true); x.drawImage(tmp, 0, 0, c.width, c.height); head.appendChild(c); head.insertAdjacentHTML('beforeend', `<div><div class="insp-title">${p.name}</div><div class="insp-sub">ID ${p.id} · ${p.max} HP max</div></div>`);
    $('#i-repair').onclick = () => sendPod({ part: p }); $('#i-ship').onclick = () => { selected = { ship: true }; refreshInspector(); }; return; }
  if (selected.ship) { const st = shipStats(); el.inspTitle.textContent = 'AEGIS-1 status'; if (light) return;
    box.innerHTML = `<div class="insp-head"></div><dl class="kv"><dt>Hull</dt><dd>${Math.round(st.hullHp)}/${st.hullMax}</dd><dt>Shield</dt><dd>${Math.round(SHIP.shield)}/${SHIP.shieldMax}</dd><dt>Power</dt><dd>${Math.round(st.power * 100)}%</dd><dt>Turrets</dt><dd>${st.lasers}</dd><dt>Modules</dt><dd>${parts.filter(alive).length}/${parts.length}</dd></dl><fieldset><legend>Cells (click to inspect)</legend><div class="partgrid">${parts.map(p => `<button data-pid="${p.id}" class="${p.dead ? 'dead' : ''}"><span>${p.id}</span><span class="pbar"><i style="width:${p.dead ? 0 : p.hp / p.max * 100}%"></i></span></button>`).join('')}</div></fieldset><fieldset><legend>Upgrades</legend><ul class="list good">${Object.entries(UPGRADES).map(([k, u]) => `<li>${icoSvg(SHIP.applied[k] === true ? 'check' : SHIP.applied[k] ? 'loader' : 'upload')}${u.name}${SHIP.applied[k] === true ? '' : SHIP.applied[k] ? ' (inbound)' : ''}</li>`).join('')}</ul></fieldset><div class="btn-row"><button data-t="repair" class="btn-ico">${icoSvg('reload')}Repair worst</button><button id="i-repairall" class="btn-ico">${icoSvg('sync')}Repair all</button></div>`;
    const head = box.querySelector('.insp-head'); head.appendChild(spriteCanvas(shipCan, 2)); head.insertAdjacentHTML('beforeend', `<div><div class="insp-title">AEGIS-1</div><div class="insp-sub">Orbital defense platform</div></div>`);
    box.querySelectorAll('[data-pid]').forEach(b => b.onclick = () => { selected = { part: parts.find(p => p.id === b.dataset.pid) }; refreshInspector(); });
    $('#i-repairall').onclick = () => { const dmg = parts.filter(p => p.hp < p.max && !p.queued); if (!dmg.length) return log('info', 'supply', 'Nothing to repair.'); dmg.forEach((p, i) => setTimeout(() => sendPod({ part: p }), i * 350)); }; return; }
  if (selected.earth) { el.inspTitle.textContent = 'Earth'; if (light) return; const lp = earthLaunchPoint();
    box.innerHTML = `<div class="insp-head"></div><dl class="kv"><dt>Role</dt><dd>Supply origin</dd><dt>Distance</dt><dd>${Math.round(dist(lp.x, lp.y, SHIP.cx, SHIP.cy) * 10)} km</dd><dt>Pods launched</dt><dd>${sim.pods}</dd><dt>Launch window</dt><dd>OPEN</dd></dl><p class="insp-note">Earth control fabricates replacement cells and upgrade modules and launches them on supply pods.</p><div class="btn-row"><button data-t="repair" class="btn-ico">${icoSvg('reload')}Repair pod</button><button data-t="upgrade" class="btn-ico">${icoSvg('upload')}Upgrade pod</button></div>`;
    const head = box.querySelector('.insp-head'); const c = document.createElement('canvas'); c.width = 48; c.height = 48; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(earthCan, 0, 0, 48, 48); head.appendChild(c); head.insertAdjacentHTML('beforeend', `<div><div class="insp-title">Earth</div><div class="insp-sub">Sol III · home port</div></div>`); return; }
}
function renderUpgradeSelect() { const s = $('#sel-upgrade'); const cur = s.value; s.innerHTML = Object.entries(UPGRADES).map(([k, u]) => `<option value="${k}" ${SHIP.applied[k] ? 'disabled' : ''}>${u.name}${SHIP.applied[k] === true ? ' ✓' : SHIP.applied[k] ? ' …' : ''}</option>`).join(''); const firstOpen = Object.keys(UPGRADES).find(k => !SHIP.applied[k]); s.value = (!SHIP.applied[cur] && cur) ? cur : (firstOpen || cur); }

// ---------------- input ----------------
function hitTest(wx, wy) {
  for (const h of hostiles) { if (!['warp', 'approach', 'engage'].includes(h.state)) continue; const r = h.def.img.width / 2 + 3; if (Math.abs(wx - h.x) < r && Math.abs(wy - h.y) < r) return { h }; }
  const c = Math.floor((wx - SHIP.ox) / TS), r = Math.floor((wy - SHIP.oy) / TS); const p = partAt(c, r); if (p) return { part: p };
  if (wx > SHIP.ox - 4 && wx < SHIP.ox + SHIP.w + 4 && wy > SHIP.oy - 4 && wy < SHIP.oy + SHIP.h + 4) return { ship: true };
  if (dist(wx, wy, EARTH.x, EARTH.y) < EARTH.r + 4) return { earth: true }; return null;
}
canvas.addEventListener('mousemove', e => { const w = s2w(e.clientX, e.clientY); hover = hitTest(w.x, w.y); canvas.classList.toggle('hovering', !!hover); });
canvas.addEventListener('mouseleave', () => { hover = null; });
canvas.addEventListener('click', e => { sfx.ensure(); const w = s2w(e.clientX, e.clientY); const hit = hitTest(w.x, w.y); selected = hit; if (hit && hit.h) sfx.ui(); refreshInspector(); if (hit) bus.emit('select', { target: hit.h ? hit.h.id : hit.part ? hit.part.id : hit.ship ? 'ship' : 'earth' }); });
$$('.window').forEach(win => { const tb = win.querySelector('.title-bar'); if (!tb) return; tb.addEventListener('mousedown', e => { if (e.target.closest('button')) return; const r = win.getBoundingClientRect(); win.style.left = r.left + 'px'; win.style.top = r.top + 'px'; win.style.right = 'auto'; win.style.bottom = 'auto'; win.style.transform = 'none'; if (win.id === 'win-log') { win.style.height = r.height + 'px'; } const ox = e.clientX - r.left, oy = e.clientY - r.top; win.classList.add('dragging');
  const mv = ev => { win.style.left = (ev.clientX - ox) + 'px'; win.style.top = (ev.clientY - oy) + 'px'; }; const up = () => { win.classList.remove('dragging'); removeEventListener('mousemove', mv); removeEventListener('mouseup', up); }; addEventListener('mousemove', mv); addEventListener('mouseup', up); e.preventDefault(); }); });
$$('[data-min]').forEach(b => b.onclick = e => { const w = e.target.closest('.window'); w.classList.toggle('minimized'); if (w.id === 'win-log') w.style.bottom = w.classList.contains('minimized') ? 'auto' : ''; });
document.addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; sfx.ensure(); sfx.ui(); trigger(b.dataset.t, b.dataset.kind ? { kind: b.dataset.kind } : b.dataset.t === 'upgrade' ? { id: $('#sel-upgrade').value } : {}); });
$('#b-pause').onclick = () => { sim.paused = !sim.paused; $('#b-pause').innerHTML = icoSvg(sim.paused ? 'play' : 'pause'); log('info', 'system', sim.paused ? 'Simulation paused.' : 'Simulation resumed.'); };
$('#b-mute').onclick = () => { sfx.ensure(); sfx.muted = !sfx.muted; $('#b-mute').innerHTML = icoSvg(sfx.muted ? 'volume-x' : 'volume-3'); };
$('#b-help').onclick = () => $('#help').classList.toggle('show'); $('#b-help-close').onclick = () => $('#help').classList.remove('show');
$('#b-demo').onclick = () => { sfx.ensure(); trigger('demo'); };
$('#cb-autorepair').onchange = e => { sim.autoRepair = e.target.checked; log('info', 'system', `Auto-repair ${sim.autoRepair ? 'enabled' : 'disabled'}.`); };
$('#cb-autodef').onchange = e => { sim.autoDef = e.target.checked; log('info', 'system', `Auto-defense ${sim.autoDef ? 'enabled' : 'disabled'}.`); };
addEventListener('keydown', e => { if (e.target.matches('input,select,textarea')) return; const k = e.key.toLowerCase(); sfx.ensure();
  const map = { '1': ['spawn', { kind: 'wasp' }], '2': ['spawn', { kind: 'hammerhead' }], '3': ['spawn', { kind: 'leech' }], '4': ['spawn', { kind: 'warden' }], w: ['wave'], a: ['attack'], x: ['retreat'], r: ['repair'], u: ['upgrade', { id: $('#sel-upgrade').value }], d: ['demo'] };
  if (map[k]) { trigger(...map[k]); e.preventDefault(); } else if (k === 'p') $('#b-pause').click(); else if (k === 'm') $('#b-mute').click(); else if (k === 'escape') { selectNone(); $('#help').classList.remove('show'); } });

// ---------------- TRIGGER API ----------------
let demoTimers = [];
function trigger(type, payload = {}) {
  bus.emit('trigger', { trigger: type, payload });
  switch (type) {
    case 'spawn': { const n = clamp(payload.count || 1, 1, 6); for (let i = 0; i < n; i++) setTimeout(() => spawnHostile(payload.kind || pick(Object.keys(HOSTILE_DEF))), i * 450); break; }
    case 'wave': { const kinds = payload.kinds || ['wasp', 'wasp', 'hammerhead', 'leech']; kinds.forEach((k, i) => setTimeout(() => spawnHostile(k), i * 500)); log('hostile', 'combat', `<b>Wave inbound:</b> ${kinds.length} signatures.`); break; }
    case 'attack': { const hs = hostiles.filter(h => ['approach', 'engage'].includes(h.state)); if (!hs.length) { log('info', 'combat', 'No hostiles to order. Spawn one first.'); break; } hs.forEach((h, i) => setTimeout(() => { if (h.state === 'approach') h.state = 'engage'; fireHostile(h); }, i * 120)); log('hostile', 'combat', `<b>Volley:</b> ${hs.length} hostile${hs.length > 1 ? 's' : ''} firing.`); break; }
    case 'damage': { const p = payload.part ? parts.find(x => x.id === payload.part) : pickTargetPart(); applyDamage(p, payload.amount || 30, hostiles.find(h => h.state === 'engage') || null, 'external'); break; }
    case 'retreat': { const hs = hostiles.filter(h => !['dead', 'gone', 'retreat'].includes(h.state)); hs.forEach(h => { h.state = 'retreat'; h.tether = false; }); if (hs.length) { log('hostile', 'combat', `${hs.length} hostile${hs.length > 1 ? 's' : ''} retreating.`); say('They are breaking off. Holding position.'); } focusTarget = null; if (selected && selected.h) selectNone(); break; }
    case 'repair': { if (payload.part) { const p = parts.find(x => x.id === payload.part); if (!p) log('warn', 'supply', `Unknown part ${payload.part}.`); else sendPod({ part: p }); } else if (payload.all) { parts.filter(p => p.hp < p.max && !p.queued).forEach((p, i) => setTimeout(() => sendPod({ part: p }), i * 350)); } else sendPod({}); break; }
    case 'upgrade': { const id = payload.id || Object.keys(UPGRADES).find(k => !SHIP.applied[k]); if (!id) { log('info', 'supply', 'All upgrades installed.'); break; } sendPod({ upgrade: id }); renderUpgradeSelect(); break; }
    case 'log': log(payload.level || 'info', payload.cat || 'system', payload.html || escapeHtml(payload.text || '')); break;
    case 'say': say(payload.text || ''); break;
    case 'alert': showAlert(payload.title || 'ALERT', payload.text || ''); sfx.alert(); break;
    case 'reset': resetSim(); break;
    case 'demo': runDemo(); break;
    case 'pause': sim.paused = payload.on ?? !sim.paused; break;
    default: log('warn', 'system', `Unknown trigger <b>${escapeHtml(type)}</b>.`);
  }
}
const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function resetSim() { demoTimers.forEach(clearTimeout); demoTimers = []; sim.demo = false; $('#v-demo').style.display = 'none'; hudT = -1; insetCache.at = -1; shieldAgg.n = 0; shieldAgg.dmg = 0; shieldAgg.last = 0; hostiles.length = 0; shots.length = 0; beams.length = 0; pods.length = 0; particles.length = 0; rings.length = 0; floaters.length = 0; buildShip(); renderShip(); selectNone(); focusTarget = null; sim.kills = 0; sim.pods = 0; sim.t = 0; setCondition(); renderUpgradeSelect(); log('info', 'system', 'Simulation reset. AEGIS-1 at full integrity.'); say('Systems reinitialized. Standing by.'); }
function runDemo() {
  if (sim.demo) { demoTimers.forEach(clearTimeout); demoTimers = []; sim.demo = false; $('#v-demo').style.display = 'none'; log('info', 'system', 'Demo stopped.'); return; }
  sim.demo = true; $('#v-demo').style.display = ''; log('info', 'system', '<b>Demo sequence</b> started (~70s).');
  const steps = [[0, () => say('Running demo sequence. Watch the threat board.')], [1.5, () => trigger('spawn', { kind: 'wasp' })], [6, () => trigger('attack')], [9, () => trigger('spawn', { kind: 'hammerhead' })], [14, () => trigger('attack')], [17, () => trigger('damage', { amount: 70 })], [19, () => trigger('damage', { amount: 70 })], [22, () => trigger('repair')], [25, () => trigger('upgrade', { id: 'flank' })], [31, () => trigger('spawn', { kind: 'leech' })], [37, () => trigger('upgrade', { id: 'capacitor' })], [42, () => trigger('spawn', { kind: 'warden' })], [50, () => trigger('attack')], [54, () => trigger('upgrade', { id: 'bow' })], [60, () => trigger('repair', { all: true })], [66, () => trigger('upgrade', { id: 'core' })], [72, () => { sim.demo = false; $('#v-demo').style.display = 'none'; log('ok', 'system', 'Demo sequence complete.'); say('Demo complete. Awaiting live triggers.'); }]];
  steps.forEach(([d, f]) => demoTimers.push(setTimeout(() => { if (sim.demo) f(); }, d * 1000)));
}
window.AEGIS = { trigger, on: (t, f) => bus.on(t, f), step: (sec = 1) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) update(1 / 60); render(); updatePortrait(); return sim.t; }, state: () => ({ t: sim.t, cond: sim.cond, ship: shipStats(), shield: SHIP.shield, hostiles: hostiles.map(h => ({ id: h.id, kind: h.kind, hp: h.hp, state: h.state, x: Math.round(h.x), y: Math.round(h.y) })), parts: parts.map(p => ({ id: p.id, type: p.type, hp: p.hp, max: p.max, dead: p.dead })), upgrades: { ...SHIP.applied } }), kinds: Object.keys(HOSTILE_DEF), upgrades: Object.keys(UPGRADES), screen: (x, y) => w2s(x, y) };
try { const bc = new BroadcastChannel('aegis'); bc.onmessage = e => { const m = e.data || {}; if (m.type) trigger(m.type, m.payload || {}); }; bus.on('*', ev => { try { bc.postMessage({ event: ev }); } catch (_) { } }); } catch (_) { }
addEventListener('message', e => { const m = e.data; if (m && m.aegis && m.type) trigger(m.type, m.payload || {}); });
const wsUrl = new URLSearchParams(location.search).get('ws'); if (wsUrl) { try { const ws = new WebSocket(wsUrl); ws.onopen = () => log('ok', 'system', `WebSocket linked: ${escapeHtml(wsUrl)}`); ws.onmessage = e => { try { const m = JSON.parse(e.data); if (m.type) trigger(m.type, m.payload || {}); } catch (_) { } }; ws.onerror = () => log('warn', 'system', 'WebSocket error.'); bus.on('*', ev => { if (ws.readyState === 1) ws.send(JSON.stringify(ev)); }); } catch (_) { log('warn', 'system', 'WebSocket URL invalid.'); } }

// ---------------- boot ----------------
resize(); buildShip(); renderShip(); renderEarth(); earthReady = true; renderUpgradeSelect(); refreshInspector();
document.body.classList.remove('boot'); document.body.classList.add('booted');
log('info', 'system', 'AEGIS-1 orbital defense sim online.'); log('info', 'system', 'Awaiting triggers. Press <b>D</b> for the demo sequence.'); say('MIRA-7 online. Orbit stable. Earth link green.');
requestAnimationFrame(frame);
})();
