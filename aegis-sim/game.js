/* AEGIS Harness Monitor — v2. Evals attack the software ship; the harness shield heals it. Trigger-driven only. */
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
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0); }
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function makeNoise(seed, N) {
  const r = mulberry32(seed); const p = new Float32Array(N * N); for (let i = 0; i < N * N; i++) p[i] = r(); const w = v => ((v % N) + N) % N;
  return (x, y) => { const xi = Math.floor(x), yi = Math.floor(y); const fx = x - xi, fy = y - yi; const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); const i = w(xi), j = w(yi), i1 = w(xi + 1), j1 = w(yi + 1); return lerp(lerp(p[i + j * N], p[i1 + j * N], sx), lerp(p[i + j1 * N], p[i1 + j1 * N], sx), sy); };
}
function fbm(noise, x, y, oct) { let v = 0, amp = .5, f = 1, sum = 0; for (let i = 0; i < oct; i++) { v += noise(x * f, y * f) * amp; sum += amp; amp *= .5; f *= 2; } return v / sum; }
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; const bayer = (x, y) => BAYER[(x & 3) + ((y & 3) << 2)] / 16;
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function icoSvg(name, size = 12) { const paths = (window.PXI && window.PXI[name]) || []; return `<svg class="pxi" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${paths.map(d => `<path d="${d}"/>`).join('')}</svg>`; }
$$('[data-ico]').forEach(el => { el.innerHTML = icoSvg(el.dataset.ico, +(el.dataset.size || 12)); });

const P = { hullL: '#d2deec', hullM: '#95a9c2', hullD: '#54667f', hullX: '#2a3649', hvy: '#60728c', hvyD: '#3a4860', floor: '#39475d', floorL: '#4c5c76', ally: '#36e2d0', allyD: '#1a8f9e', orange: '#ff8c2b', orangeL: '#ffc06a', glass: '#7ff0ff', core: '#ffd36b', coreH: '#ff5a1f', fail: '#ff4b3e', failD: '#9e1b2c', hostX: '#1b1620', amber: '#ffb13b', magenta: '#ff5ac8', fix: '#ffd36b', rule: '#c48bff', heal: '#7dffb0', white: '#ffffff', debris: '#2a2630', debrisL: '#4a4458', smoke: '#5a5566', outline: '#070a12' };

// ---------------- bus ----------------
const bus = { h: {}, on(t, f) { (this.h[t] ||= []).push(f); return () => { this.h[t] = this.h[t].filter(x => x !== f); }; }, emit(t, p = {}) { const e = { type: t, t: +sim.t.toFixed(2), ...p }; (this.h[t] || []).forEach(f => f(e)); (this.h['*'] || []).forEach(f => f(e)); } };

// ---------------- audio ----------------
const sfx = (() => {
  let ac = null, muted = false, master, lastT = {};
  const ensure = () => { if (!ac) { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = .3; master.connect(ac.destination); } if (ac.state === 'suspended') ac.resume(); };
  const gate = (k, ms) => { const n = performance.now(); if (n - (lastT[k] || 0) < ms) return false; lastT[k] = n; return true; };
  const tone = (f0, f1, dur, type = 'square', vol = .3) => { if (muted || !ac) return; const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f0, ac.currentTime); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), ac.currentTime + dur); g.gain.setValueAtTime(vol, ac.currentTime); g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + dur); o.connect(g); g.connect(master); o.start(); o.stop(ac.currentTime + dur); };
  const noise = (dur, vol = .4, lp = 1200) => { if (muted || !ac) return; const n = ac.sampleRate * dur | 0, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n); const s = ac.createBufferSource(); s.buffer = b; const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; const g = ac.createGain(); g.gain.value = vol; s.connect(f); f.connect(g); g.connect(master); s.start(); };
  return { ensure, get muted() { return muted; }, set muted(v) { muted = v; },
    zap() { if (gate('zap', 40)) tone(1400, 300, .1, 'sawtooth', .12); }, bolt() { if (gate('bolt', 60)) tone(600, 180, .14, 'square', .12); }, rail() { tone(200, 40, .4, 'sawtooth', .25); noise(.2, .2, 600); },
    hit() { if (gate('hit', 50)) { noise(.12, .2, 900); tone(300, 80, .1, 'square', .1); } }, shield() { if (gate('sh', 50)) tone(900, 1400, .15, 'triangle', .1); },
    boom() { if (gate('boom', 80)) { noise(.5, .45, 500); tone(120, 30, .45, 'sawtooth', .3); } }, pop() { if (gate('pop', 25)) tone(900, 1800, .06, 'square', .05); },
    alert() { tone(520, 520, .18, 'square', .18); setTimeout(() => tone(390, 390, .22, 'square', .18), 200); }, launch() { if (gate('ln', 120)) { tone(90, 420, .5, 'sawtooth', .15); noise(.4, .12, 400); } },
    dock() { tone(660, 990, .1, 'square', .12); setTimeout(() => tone(990, 1320, .14, 'square', .12), 110); }, build() { if (gate('b', 60)) tone(220 + rand(200), 900, .05, 'square', .05); },
    heal() { tone(440, 880, .4, 'triangle', .15); setTimeout(() => tone(660, 1320, .4, 'triangle', .12), 150); }, rule() { tone(330, 660, .2, 'square', .12); setTimeout(() => tone(660, 990, .25, 'square', .12), 180); },
    ui() { tone(800, 600, .05, 'square', .07); }, warp() { if (gate('warp', 120)) tone(60, 1800, .3, 'sawtooth', .16); } };
})();

// ---------------- canvas ----------------
const canvas = $('#scene'), ctx = canvas.getContext('2d'); const labels = $('#labels'), lctx = labels.getContext('2d');
let SCALE = 3, VW = 480, VH = 270, DPR = 1;
function resize() { const w = innerWidth, h = innerHeight; SCALE = w >= 1500 ? 3 : w >= 900 ? 2.5 : 2; VW = Math.ceil(w / SCALE); VH = Math.ceil(h / SCALE); canvas.width = VW; canvas.height = VH; canvas.style.width = (VW * SCALE) + 'px'; canvas.style.height = (VH * SCALE) + 'px'; DPR = Math.min(2, devicePixelRatio || 1); labels.width = w * DPR; labels.height = h * DPR; labels.style.width = w + 'px'; labels.style.height = h + 'px'; ctx.imageSmoothingEnabled = false; buildSpace(); insetCache.at = -1; }
addEventListener('resize', resize);

// ---------------- state ----------------
const sim = { t: 0, paused: false, shake: 0, flash: 0, cond: 'green', demo: false, pods: 0, kills: 0, autoDef: true, autoFix: true, rules: 0, total: 0, pass: 0, fail: 0, rateBuf: [], healPulse: 0 };
const cam = { x: 30, y: 0, z: 1, tx: 30, ty: 0, tz: 1 };
const hostiles = [], shots = [], beams = [], parts = [], pods = [], floaters = [], rings = [], particles = []; const byId = new Map(); const fixes = new Map(); const modules = new Map();
const DETAIL_CAP = 14;

// ---------------- space ----------------
let space = null; const stars = [];
function buildSpace() {
  const w = VW + 240, h = VH + 240; space = document.createElement('canvas'); space.width = w; space.height = h; const nc = space.getContext('2d'); const img = nc.createImageData(w, h); const d = img.data; const n = makeNoise(7, 16), n2 = makeNoise(19, 16);
  const c0 = hex('#06070d'), c1 = hex('#0a0c15'), c2 = hex('#10131f'), c3 = hex('#0d1a22'), c4 = hex('#1b1522'), c5 = hex('#15202a');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fbm(n, x / 90 + 2, y / 60, 5); const m = fbm(n2, x / 160 + 9, y / 160 + 3, 3); const th = bayer(x, y) - .5;
    const band = Math.sin((x * .6 + y) / 170) * .06; const sun = Math.max(0, 1 - dist(x, y, w * .92, 0) / (w * .55)); const g = sun * sun * .5;
    let c = c0; const vv = v + band;
    if (vv > .62 + th * .08) c = m > .5 ? c4 : c5; else if (vv > .55 + th * .10) c = m > .5 ? c2 : c3; else if (vv > .47 + th * .12) c = c1;
    const i = (x + y * w) * 4; const gl = g > th * .4 + .18 ? Math.round(g * 26) : 0; d[i] = c[0] + gl; d[i + 1] = c[1] + gl * .9; d[i + 2] = c[2] + gl * .7; d[i + 3] = 255;
  }
  nc.putImageData(img, 0, 0);
  stars.length = 0; for (let i = 0; i < 320; i++) stars.push({ x: rand(-700, 1000), y: rand(-450, 550), l: pick([.12, .2, .3, .3, .5, .5, .8, 1]), tw: rand(TAU), c: pick(['#ffffff', '#dbe9ff', '#ffe9c4', '#c9fff5', '#ffd6d6']) });
}

// ---------------- EARTH ----------------
const EARTH = { x: -185, y: 122, r: 108, rot: 0, cloudRot: 0 };
const earthTex = (() => {
  const W = 512, H = 256; const land = makeNoise(11, 8), moist = makeNoise(23, 8), city = makeNoise(41, 64), cloud = makeNoise(31, 8);
  const col = new Uint8Array(W * H * 3), light = new Uint8Array(W * H), clouds = new Uint8Array(W * H);
  const C = { deep: hex('#0a2457'), ocean: hex('#0f3f8a'), shelf: hex('#1a62b4'), coast: hex('#2b8fd0'), low: hex('#3f8a3c'), green: hex('#5fa63f'), dry: hex('#b9a257'), desert: hex('#d3b56a'), high: hex('#8c8a52'), mount: hex('#a39682'), snow: hex('#eef4f7') };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W * 8, v = y / H * 4; const lat = Math.abs(y / H - .5) * 2; let e = fbm(land, u, v, 6); e = e + (fbm(land, u * 2 + 3, v * 2 + 1, 3) - .5) * .25; const m = fbm(moist, u + 5, v + 2, 4); const i = x + y * W; let c; const sea = .50 - lat * .03;
    if (e < sea - .10) c = C.deep; else if (e < sea - .035) c = C.ocean; else if (e < sea - .012) c = C.shelf; else if (e < sea) c = C.coast;
    else { const h = (e - sea) / (1 - sea); if (lat > .93 || (lat > .86 && h > .3)) c = C.snow; else if (h > .32) c = C.mount; else if (h > .2) c = C.high; else if (lat < .45 && m < .38) c = C.desert; else if (m < .48) c = C.dry; else c = h > .08 ? C.green : C.low; if (c !== C.snow && city(u * 8, v * 8) > .80 && m > .4 && h < .18 && lat < .8) light[i] = 1; }
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; const cv = fbm(cloud, u * 1.5 + 2, v * 1.5, 5) + (1 - Math.abs(lat - .45)) * .05; clouds[i] = cv > .60 ? 2 : cv > .55 ? 1 : 0;
  }
  return { W, H, col, light, clouds };
})();
const ER = EARTH.r + 8; const earthCan = document.createElement('canvas'); earthCan.width = ER * 2; earthCan.height = ER * 2; const ectx = earthCan.getContext('2d'); const earthImg = ectx.createImageData(ER * 2, ER * 2);
const earthPre = (() => { const n = (ER * 2) ** 2; const lat = new Float32Array(n), lon = new Float32Array(n), shade = new Float32Array(n), rim = new Float32Array(n), inside = new Uint8Array(n); const L = [0.52, -0.42, 0.74]; const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll; const R = EARTH.r;
  for (let py = 0; py < ER * 2; py++) for (let px = 0; px < ER * 2; px++) { const i = px + py * ER * 2; const x = (px + .5 - ER) / R, y = (py + .5 - ER) / R; const d2 = x * x + y * y; if (d2 <= 1) { const z = Math.sqrt(1 - d2); inside[i] = 1; lat[i] = Math.asin(y); lon[i] = Math.atan2(x, z); shade[i] = x * L[0] + y * L[1] + z * L[2]; } else { const d = Math.sqrt(d2); if (d < 1 + 9 / R) { const t = 1 - (d - 1) / (9 / R); const sun = clamp((x * L[0] + y * L[1]) * .9 + .55, .15, 1); rim[i] = t * t * sun; } } }
  return { lat, lon, shade, rim, inside }; })();
function renderEarth() {
  const { W, H, col, light, clouds } = earthTex; const { lat, lon, shade, rim, inside } = earthPre; const d = earthImg.data; const S = ER * 2; const rot = EARTH.rot, crot = EARTH.cloudRot; const atm = hex('#6fd2ff'), atmD = hex('#2a6fb8');
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) { const i = px + py * S, o = i * 4;
    if (inside[i]) { const v = (lat[i] / Math.PI + .5); const u = ((lon[i] / TAU) + rot) % 1; const tx = ((u + 1) % 1 * W) | 0, ty = clamp((v * H) | 0, 0, H - 1); const ti = tx + ty * W; const cu = ((lon[i] / TAU) + crot + 1) % 1; const cl = clouds[((cu * W) | 0) + ty * W]; let r = col[ti * 3], g = col[ti * 3 + 1], b = col[ti * 3 + 2];
      if (cl) { const k = cl === 2 ? .92 : .55; r += (245 - r) * k; g += (248 - g) * k; b += (255 - b) * k; }
      const s = shade[i] + (bayer(px, py) - .5) * .12; let k; if (s > .55) k = 1; else if (s > .28) k = .82; else if (s > .05) k = .6; else if (s > -.12) k = .32; else k = .09; r *= k; g *= k; b *= k;
      if (k < .35 && light[ti] && !cl) { r = 255; g = 180; b = 80; } if (k < .35) b = Math.min(255, b + 10);
      const edge = Math.cos(lat[i]) * Math.cos(lon[i]); if (edge < .25) { const a = (0.25 - edge) * 1.6 * (shade[i] > -.1 ? 1 : .4); r += (atm[0] - r) * a * .6; g += (atm[1] - g) * a * .6; b += (atm[2] - b) * a * .6; }
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255; }
    else if (rim[i] > 0) { const a = rim[i]; const q = a > .7 ? 1 : a > .45 ? .75 : a > .22 ? .5 : .25; const on = a + (bayer(px, py) - .5) * .25 > .12; const c = q > .6 ? atm : atmD; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = on ? Math.round(q * 200) : 0; } else d[o + 3] = 0; }
  ectx.putImageData(earthImg, 0, 0);
}

// ---------------- SHIP ----------------
const TS = 5;
const LAYOUT = [
  '...........NN.......................',
  '........2d####d2....................',
  '........#==SS==#d1..................',
  '...HHH..#==L==C#=d..................',
  '..TTHHH##=====#==##d................',
  '.TTTHHH#=R===B=====##d..............',
  '.TTTHHH#====AAAAAAAA===###d33.......',
  '..TTHHH#==R====C==4=R===A###>>>>d3..',
  '.TTTHHH#====AAAAAAAA===###d33.......',
  '.TTTHHH#=R===B=====##d..............',
  '..TTHHH##=====#==##d................',
  '...HHH..#==L==C#=d..................',
  '........#==SS==#d1..................',
  '........2d####d2....................',
  '...........NN.......................',
];
const COLS = LAYOUT[0].length, ROWS = LAYOUT.length;
const SHIP = { w: COLS * TS, h: ROWS * TS, shield: 200, shieldMax: 200, power: 1, dirty: true };
SHIP.ox = -Math.round(SHIP.w / 2); SHIP.oy = -Math.round(SHIP.h / 2); SHIP.cx = SHIP.ox + SHIP.w / 2; SHIP.cy = SHIP.oy + SHIP.h / 2;
const PART_DEF = {
  '#': { name: 'Armor Plate', code: 'A', hp: 100, desc: 'Hull plating. Modules live behind it.' }, 'H': { name: 'Heavy Armor', code: 'H', hp: 150, desc: 'Engine block plating.' }, 'd': { name: 'Angled Plate', code: 'A', hp: 100, desc: 'Sloped armor.' },
  'A': { name: 'Accent Plate', code: 'A', hp: 100, desc: 'Marked hull plating.' }, '>': { name: 'Bow Prow', code: 'A', hp: 160, desc: 'Reinforced forward wedge.' }, '=': { name: 'Structure', code: 'F', hp: 60, desc: 'Deck and conduit.' },
  'C': { name: 'Bridge', code: 'C', hp: 130, desc: 'Command deck. Steers targeting.' }, 'R': { name: 'Reactor', code: 'R', hp: 90, desc: 'Fusion core. Feeds turrets and the harness shield.' }, 'T': { name: 'Thruster', code: 'T', hp: 70, desc: 'Ion drive.' },
  'L': { name: 'Laser Turret', code: 'L', hp: 60, desc: 'Point defense. Fires when an eval passes.' }, 'S': { name: 'Shield Emitter', code: 'S', hp: 70, desc: 'Projects the harness shield (+100 cap).' }, 'B': { name: 'Capacitor', code: 'B', hp: 60, desc: 'Buffers reactor output.' }, 'N': { name: 'Sensor Mast', code: 'N', hp: 40, desc: 'Long-range eval telemetry.' },
};
const UPGRADES = { flank: { name: 'Flank turrets', slot: '1', type: 'L', desc: 'Two extra turrets. Passes clear faster.' }, capacitor: { name: 'Shield capacitors', slot: '2', type: 'S', desc: '+400 harness shield, faster regen.' }, bow: { name: 'Bow plating', slot: '3', type: '#', desc: 'Five forward armor cells.' }, core: { name: 'Auxiliary reactor', slot: '4', type: 'R', desc: 'More power. Faster turrets and healing.' } };
const slotCells = {};
function buildShip() {
  parts.length = 0; const counters = {}; SHIP.grid = []; for (const k in slotCells) delete slotCells[k]; modules.clear();
  for (let r = 0; r < ROWS; r++) { SHIP.grid[r] = []; for (let c = 0; c < COLS; c++) { const ch = LAYOUT[r][c]; SHIP.grid[r][c] = null;
    if (PART_DEF[ch]) { const def = PART_DEF[ch]; const n = (counters[def.code] = (counters[def.code] || 0) + 1); const p = { id: def.code + n, type: ch, c, r, hp: def.hp, max: def.hp, build: 1, name: def.name, def, dead: false, cool: rand(1), aim: 0, module: null }; parts.push(p); SHIP.grid[r][c] = p; }
    else if (ch >= '1' && ch <= '4') (slotCells[ch] ||= []).push({ c, r }); } }
  SHIP.applied = {}; SHIP.shieldMax = 200; SHIP.shield = 200; SHIP.dirty = true;
}
const partAt = (c, r) => (r >= 0 && r < ROWS && c >= 0 && c < COLS) ? SHIP.grid[r][c] : null;
const partPos = p => ({ x: SHIP.ox + p.c * TS + TS / 2, y: SHIP.oy + p.r * TS + TS / 2 });
const alive = p => !p.dead && p.build >= 1;
function exposed(p) { return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => { const q = partAt(p.c + dc, p.r + dr); return !q || q.dead; }); }
function shipStats() { let hp = 0, max = 0; for (const p of parts) { hp += p.dead ? 0 : p.hp; max += p.max; } const R = parts.filter(p => p.type === 'R'), S = parts.filter(p => p.type === 'S'); const power = R.length ? R.filter(alive).length / R.length : 0; SHIP.power = power; SHIP.shieldMax = S.filter(alive).length * 100 + sim.rules * 25 + (SHIP.applied.capacitor === true ? 200 : 0); return { hull: hp / max, hullHp: hp, hullMax: max, power, shieldPct: SHIP.shieldMax ? SHIP.shield / SHIP.shieldMax : 0, lasers: parts.filter(p => p.type === 'L' && alive(p)).length }; }
// modules: a named module owns one armor cell (stable by name hash)
function moduleCell(name) {
  if (!name) return pickTargetPart(); if (modules.has(name)) { const m = modules.get(name); if (m.part && !m.part.dead) return m.part; const alt = m.part && m.part.dead ? m.part : null; if (alt) return alt; }
  const cands = parts.filter(p => (p.type === '#' || p.type === 'A' || p.type === 'd' || p.type === 'H' || p.type === '>') && !p.module); const pool = cands.length ? cands : parts.filter(p => !p.module && p.type !== 'N'); const h = strHash(name); const part = pool.length ? pool[h % pool.length] : parts[h % parts.length];
  part.module = name; modules.set(name, { name, part, fails: 0, passes: 0, lastError: null }); SHIP.dirty = true; return part;
}
const shipCan = document.createElement('canvas'); shipCan.width = SHIP.w; shipCan.height = SHIP.h; const sctx = shipCan.getContext('2d'); const silCan = document.createElement('canvas'); silCan.width = SHIP.w; silCan.height = SHIP.h;
function px(c, x, y, col) { c.fillStyle = col; c.fillRect(x, y, 1, 1); }
function drawPart(c, p, x, y, insp) {
  const t = p.type, h = hash2(p.c * 7, p.r * 13), h2 = hash2(p.c * 3 + 1, p.r * 5 + 7);
  const nb = { l: !!partAt(p.c - 1, p.r), r: !!partAt(p.c + 1, p.r), u: !!partAt(p.c, p.r - 1), d: !!partAt(p.c, p.r + 1) };
  const plate = (base, light, dark) => { c.fillStyle = base; c.fillRect(x, y, TS, TS); c.fillStyle = light; c.fillRect(x, y, TS, 1); c.fillRect(x, y, 1, TS); c.fillStyle = dark; c.fillRect(x, y + TS - 1, TS, 1); c.fillRect(x + TS - 1, y, 1, TS); if (!nb.u) { c.fillStyle = P.hullX; c.fillRect(x, y, TS, 1); c.fillStyle = light; c.fillRect(x, y + 1, TS, 1); } if (!nb.d) { c.fillStyle = P.hullX; c.fillRect(x, y + TS - 1, TS, 1); } if (!nb.l) { c.fillStyle = P.hullX; c.fillRect(x, y, 1, TS); } if (!nb.r) { c.fillStyle = P.hullX; c.fillRect(x + TS - 1, y, 1, TS); } };
  if (t === '#' || t === '>' || t === 'A') { plate(t === 'A' ? P.orange : P.hullM, t === 'A' ? P.orangeL : P.hullL, t === 'A' ? '#b85a12' : P.hullD);
    if (t === 'A') { c.fillStyle = '#b85a12'; if (h > .5) c.fillRect(x + 1, y + 2, 3, 1); } else if (h > .72) { px(c, x + 1, y + 1, P.hullD); px(c, x + 3, y + 3, P.hullD); } else if (h > .5) { c.fillStyle = P.hullD; c.fillRect(x + 1, y + 2, 3, 1); } else if (h > .3) { px(c, x + 2, y + 1, P.hullD); px(c, x + 2, y + 3, P.hullD); } else if (h2 > .6 && (!nb.u || !nb.d)) { c.fillStyle = '#0f1a24'; c.fillRect(x + 1, y + 2, 2, 1); px(c, x + 1, y + 2, P.glass); }
    if (t === '>') { c.fillStyle = P.hullX; c.fillRect(x + 3, y, 2, 1); c.fillRect(x + 3, y + TS - 1, 2, 1); c.fillStyle = P.orange; c.fillRect(x + 1, y + 2, 3, 1); } }
  else if (t === 'H') { plate(P.hvy, P.hullM, P.hvyD); c.fillStyle = P.hvyD; if (h > .5) { c.fillRect(x + 1, y + 1, 1, 3); c.fillRect(x + 3, y + 1, 1, 3); } else { c.fillRect(x + 1, y + 1, 3, 1); c.fillRect(x + 1, y + 3, 3, 1); } if (h2 > .7) px(c, x + 2, y + 2, P.amber); }
  else if (t === 'd') { c.fillStyle = P.hullM; c.beginPath(); const tri = nb.l && nb.d ? [[0, TS], [TS, TS], [0, 0]] : nb.l && nb.u ? [[0, 0], [TS, 0], [0, TS]] : nb.r && nb.d ? [[TS, TS], [0, TS], [TS, 0]] : [[TS, 0], [0, 0], [TS, TS]]; c.moveTo(x + tri[0][0], y + tri[0][1]); c.lineTo(x + tri[1][0], y + tri[1][1]); c.lineTo(x + tri[2][0], y + tri[2][1]); c.closePath(); c.fill(); c.fillStyle = P.hullL; for (let i = 0; i < TS; i++) { const yy = (nb.d ? TS - 1 - i : i); if (nb.l) px(c, x + i, y + yy, i === 0 ? P.hullL : P.hullX); else px(c, x + TS - 1 - i, y + yy, i === 0 ? P.hullL : P.hullX); } }
  else if (t === '=') { c.fillStyle = P.floor; c.fillRect(x, y, TS, TS); c.fillStyle = P.floorL; if (h > .6) c.fillRect(x, y + 2, TS, 1); else if (h > .3) c.fillRect(x + 2, y, 1, TS); px(c, x + 1 + ((h * 3) | 0), y + 1, P.hullX); if (h2 > .85) px(c, x + 3, y + 3, P.allyD); }
  else if (t === 'C') { plate(P.hullD, P.hullL, P.hullX); c.fillStyle = P.glass; c.fillRect(x + 1, y + 1, 3, 3); c.fillStyle = P.white; c.fillRect(x + 1, y + 1, 2, 1); px(c, x + 3, y + 3, P.allyD); }
  else if (t === 'R') { plate(P.hullX, P.hullD, '#1b2232'); c.fillStyle = P.coreH; c.fillRect(x + 1, y + 1, 3, 3); c.fillStyle = P.core; c.fillRect(x + 2, y + 1, 1, 3); c.fillRect(x + 1, y + 2, 3, 1); }
  else if (t === 'T') { c.fillStyle = P.hvyD; c.fillRect(x, y, TS, TS); c.fillStyle = P.hullX; c.fillRect(x, y + 1, TS, 3); c.fillStyle = P.hullM; c.fillRect(x + 1, y, TS - 1, 1); c.fillRect(x + 1, y + TS - 1, TS - 1, 1); c.fillStyle = P.allyD; c.fillRect(x, y + 2, 1, 1); if (!nb.l) { c.fillStyle = P.amber; c.fillRect(x + 2, y, 1, 1); c.fillRect(x + 2, y + 4, 1, 1); } }
  else if (t === 'L') { plate(P.hullD, P.hullM, P.hullX); c.fillStyle = P.hullL; c.fillRect(x + 1, y + 1, 3, 3); c.fillStyle = P.hullX; c.fillRect(x + 2, y + 2, 1, 1); if (insp) { c.fillStyle = P.ally; c.fillRect(x + 3, y + 2, 2, 1); } }
  else if (t === 'S') { plate(P.hullD, P.hullM, P.hullX); c.fillStyle = P.allyD; c.fillRect(x + 2, y + 1, 1, 3); c.fillRect(x + 1, y + 2, 3, 1); px(c, x + 2, y + 2, P.ally); }
  else if (t === 'B') { plate(P.hullD, P.hullM, P.hullX); c.fillStyle = P.fix; c.fillRect(x + 1, y + 1, 1, 3); c.fillRect(x + 3, y + 1, 1, 3); }
  else if (t === 'N') { c.fillStyle = P.hullD; c.fillRect(x + 2, y, 1, TS); c.fillStyle = P.hullL; c.fillRect(x + 1, y + (nb.d ? 0 : TS - 1), 3, 1); if (!nb.d && !nb.u) {} px(c, x + 2, y + (nb.d ? 0 : TS - 1), P.fail); }
  const ratio = p.hp / p.max;
  if (p.dead) { c.fillStyle = '#0a0b12'; c.fillRect(x, y, TS, TS); for (let i = 0; i < 8; i++) { const hh = hash2(p.c * 31 + i, p.r * 17 + i); if (hh > .45) px(c, x + ((hh * 97) % TS | 0), y + ((hh * 53) % TS | 0), hh > .8 ? P.debrisL : P.debris); } }
  else if (ratio < .66) { const n = ratio < .33 ? 6 : 3; for (let i = 0; i < n; i++) { const hh = hash2(p.c * 11 + i * 3, p.r * 29 + i); px(c, x + ((hh * 71) % TS | 0), y + ((hh * 37) % TS | 0), ratio < .33 ? '#120d10' : P.hullX); } if (ratio < .33) px(c, x + 2, y + 2, '#000'); }
  if (p.module && !insp && !p.dead && (hover && hover.ship)) { c.fillStyle = 'rgba(54,226,208,.5)'; c.fillRect(x + 1, y + 1, 1, 1); }
}
function renderShip() {
  sctx.clearRect(0, 0, SHIP.w, SHIP.h); for (const p of parts) { if (p.build < 1) continue; drawPart(sctx, p, p.c * TS, p.r * TS); }
  for (const s in slotCells) if (!SHIP.applied[s]) for (const { c, r } of slotCells[s]) { sctx.fillStyle = 'rgba(54,226,208,.28)'; for (let i = 0; i < TS; i += 2) { sctx.fillRect(c * TS + i, r * TS, 1, 1); sctx.fillRect(c * TS + i, r * TS + TS - 1, 1, 1); sctx.fillRect(c * TS, r * TS + i, 1, 1); sctx.fillRect(c * TS + TS - 1, r * TS + i, 1, 1); } }
  const sc = silCan.getContext('2d'); sc.clearRect(0, 0, SHIP.w, SHIP.h); sc.drawImage(shipCan, 0, 0); sc.globalCompositeOperation = 'source-in'; sc.fillStyle = P.outline; sc.fillRect(0, 0, SHIP.w, SHIP.h); sc.globalCompositeOperation = 'source-over';
  SHIP.dirty = false;
}

// ---------------- EVALS (hostiles) ----------------
const HPAL = { k: P.hostX, d: '#4a0f1e', r: P.failD, h: P.fail, o: '#ff8a3b', e: P.amber, g: '#3d3648', l: '#6b6380', w: '#ffffff', m: P.magenta, c: '#2a1a3a', y: '#ffd36b' };
function makeSprite(rows, pal) { const w = rows[0].length, h = rows.length; const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const c = cv.getContext('2d'); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const ch = rows[y][x]; if (pal[ch]) { c.fillStyle = pal[ch]; c.fillRect(x, y, 1, 1); } } return cv; }
const KIND_DEF = {
  unit: { name: 'Unit', cls: 'Unit probe', hp: 60, speed: 110, range: 112, cool: .9, dmg: 10, weapon: 'bolt', weapons: ['Assertion bolts'], threat: 1, role: 'Fast single-function check.', color: P.fail, sprite: ['......kk......', '....kkrrk.....', '..kkrrhrrk....', 'kerrhhrrrkkgg.', 'kerrhhrrrkkgg.', '..kkrrhrrk....', '....kkrrk.....', '......kk......'] },
  integration: { name: 'Integration', cls: 'Integration gunship', hp: 170, speed: 60, range: 150, cool: 2.4, dmg: 38, weapon: 'rail', weapons: ['Contract railgun', 'Schema armor'], threat: 2, role: 'Cross-module contract test. Heavy hits.', color: P.amber, sprite: ['.....kkkkkkkk....', '...kkrrrrrrrrkk..', '.kkrrhhrrrrrrrkkk', 'kerrhhhrrrrddkggg', 'keeerrrrrrrddkggg', 'kerrhhhrrrrddkggg', '.kkrrhhrrrrrrrkkk', '...kkrrrrrrrrkk..', '.....kkkkkkkk....'] },
  fuzz: { name: 'Fuzz', cls: 'Fuzz leech', hp: 100, speed: 75, range: 85, cool: .25, dmg: 3, weapon: 'tether', weapons: ['Random-input siphon', 'Edge-case jammer'], threat: 2, role: 'Random inputs. Drains the harness shield.', color: P.magenta, sprite: ['....kcc......', '..kkcmmck....', 'kccmmmmmck...', 'kcmemmemckk..', 'kccmmmmmck.kk', '..kkcmmck..kk', '....kcc...kk.', '.........kk..'] },
  e2e: { name: 'E2E', cls: 'E2E cruiser', hp: 420, speed: 40, range: 175, cool: 3.0, dmg: 22, weapon: 'missile', weapons: ['Scenario missiles x2', 'Flow laser', 'Regression flak'], threat: 3, role: 'Full-flow scenario. Capital class.', color: '#ff7a3b', sprite: ['........kkkkkkkkkkk......', '......kkrrrrrrrrrrrkk....', '....kkrrhhrrrrrrrrrrkk...', '..kkrrrhhhrrrrdddrrrrkkgg', 'kerrrhhhhhrrrrdddrrrrkkgg', 'keeerrrrrrrrrrdddrrrrkggg', 'kerrrhhhhhrrrrdddrrrrkkgg', '..kkrrrhhhrrrrdddrrrrkkgg', '....kkrrhhrrrrrrrrrrkk...', '......kkrrrrrrrrrrrkk....', '........kkkkkkkkkkk......'] },
};
for (const k in KIND_DEF) KIND_DEF[k].img = makeSprite(KIND_DEF[k].sprite, HPAL);
const SUITES = ['auth', 'db', 'api', 'memory', 'tools', 'planner', 'ui', 'billing', 'search', 'cache'];
let seq = 0;
function detailedCount() { let n = 0; for (const h of hostiles) if (h.lod === 'full' && h.live) n++; return n; }
function startEval(p = {}) {
  const kind = KIND_DEF[p.kind] ? p.kind : pick(Object.keys(KIND_DEF)); const def = KIND_DEF[kind]; const n = ++seq; const id = p.id || `t-${n}`;
  if (byId.has(id)) { const old = byId.get(id); if (old.live) return old; }
  const suite = p.suite || pick(SUITES); const name = p.name || `${suite}/${pick(['login', 'refresh', 'write', 'read', 'merge', 'rollback', 'plan', 'retry', 'index', 'stream'])} #${n}`;
  const slotUsed = new Set(hostiles.filter(h => h.live && h.lod === 'full').map(h => h.slot)); let slot = 0; for (const cand of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7]) if (!slotUsed.has(cand)) { slot = cand; break; }
  const full = detailedCount() < DETAIL_CAP; const side = rand() < .5 ? -1 : 1; const sx = 390 + rand(60), sy = side * rand(40, 150); const hh = strHash(id);
  const h = { id, name, suite, kind, def, x: sx, y: sy, hp: def.hp, max: def.hp, state: 'warp', st: 0, cool: def.cool * .6 + rand(.5), slot, ang: 0, warp: 0, flash: 0, orbit: rand(TAU), hits: 0, dmgDealt: 0, spawnT: sim.t, lod: full ? 'full' : 'dot', live: true, result: null, error: null, module: p.module || null, fixId: null, dx: 250 + (hh % 90), dy: ((hh >> 8) % 240) - 120, dp: ((hh >> 16) % 100) / 100 };
  hostiles.push(h); byId.set(id, h); sim.total++; sim.rateBuf.push(sim.t);
  if (full) { sfx.warp(); addRing(sx, sy, 2, 22, def.color, .45); addFloater(sx, sy - 14, 'EVAL START', def.color, 1.2); }
  if (full || sim.total % 25 === 0) log('info', 'pass', `<b>${esc(id)}</b> ${esc(name)} started <span class="cnt">(${def.cls.toLowerCase()})</span>`, !full);
  bus.emit('eval.start', { id, name, suite, kind }); setCondition(); if (full && rand() < .35) say(pick([`${def.cls} ${id} on approach.`, `Eval ${id} warping in. Tracking.`, `${suite} suite probing the hull.`]));
  threatsDirty = true; return h;
}
function promote(h) { if (h.lod === 'full') return; if (detailedCount() >= DETAIL_CAP) { const victim = hostiles.find(x => x.live && x.lod === 'full' && x.result !== 'fail' && x !== h); if (victim) { victim.lod = 'dot'; } else return; } h.lod = 'full'; const slotUsed = new Set(hostiles.filter(x => x.live && x.lod === 'full' && x !== h).map(x => x.slot)); for (const cand of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7]) if (!slotUsed.has(cand)) { h.slot = cand; break; } const e = engagePos(h); h.x = e.x + 120; h.y = e.y; h.state = 'approach'; h.st = 0; }
function engagePos(h) { const a = h.slot * .36 + Math.sin(sim.t * .35 + h.orbit) * .16; const r = h.def.range; return { x: Math.cos(a) * r, y: Math.sin(a) * r * .72 }; }
function pickTargetPart() { const ex = parts.filter(p => alive(p) && exposed(p) && p.type !== 'N'); if (!ex.length) return parts.find(alive) || null; return pick(ex); }
function updateHostile(h, dt) {
  if (!h.live) { h.st += dt; return; } h.flash = Math.max(0, h.flash - dt * 6);
  if (h.lod === 'dot') { h.dp += dt * .3; return; }
  h.st += dt; h.ang = Math.atan2(SHIP.cy - h.y, SHIP.cx - h.x);
  if (h.state === 'warp') { h.warp = Math.min(1, h.st / .6); if (h.st > .6) { h.state = 'approach'; h.st = 0; } return; }
  if (h.state === 'approach' || h.state === 'engage') { const e = engagePos(h); const d = dist(h.x, h.y, e.x, e.y); const sp = h.def.speed * (h.state === 'approach' ? 1 : .5); if (d > 2) { const k = Math.min(1, sp * dt / d); h.x += (e.x - h.x) * k; h.y += (e.y - h.y) * k; }
    if (h.state === 'approach' && d < 12) { h.state = 'engage'; h.st = 0; }
    h.tether = h.state === 'engage' && h.kind === 'fuzz' && d < 14 && h.result === 'fail';
    if (h.result === 'fail') { h.cool -= dt; if (h.state === 'engage' && h.cool <= 0 && !h.fixId) { fireHostile(h); h.cool = h.def.cool * rand(.9, 1.4); } if (h.tether) drainTether(h, dt); } }
  if (h.state === 'retreat') { h.x += Math.cos(h.ang + Math.PI) * 160 * dt; h.y += Math.sin(h.ang + Math.PI) * 160 * dt; if (Math.abs(h.x) > 600 || Math.abs(h.y) > 400) { h.live = false; h.state = 'gone'; } }
  if (h.state === 'dying' && h.st > .5) { h.live = false; h.state = 'dead'; }
}
function fireHostile(h) {
  const target = (h.module ? moduleCell(h.module) : null) || pickTargetPart(); if (!target) return; const tp = partPos(target); const w = h.def.weapon;
  if (w === 'bolt') { for (let i = 0; i < 2; i++) setTimeout(() => shots.push({ kind: 'bolt', x: h.x, y: h.y, tx: tp.x, ty: tp.y, part: target, dmg: h.def.dmg, speed: 260, from: h, color: P.fail, len: 5, life: 0 }), i * 90); sfx.bolt(); }
  else if (w === 'rail') { shots.push({ kind: 'rail', x: h.x, y: h.y, tx: tp.x, ty: tp.y, part: target, dmg: h.def.dmg, speed: 520, from: h, color: '#ffe3d6', len: 14, life: 0 }); sfx.rail(); addShake(1.5); }
  else if (w === 'missile') { for (let i = 0; i < 2; i++) shots.push({ kind: 'missile', x: h.x, y: h.y + (i ? 6 : -6), vx: Math.cos(h.ang + (i ? .8 : -.8)) * 60, vy: Math.sin(h.ang + (i ? .8 : -.8)) * 60, tx: tp.x, ty: tp.y, part: target, dmg: h.def.dmg, from: h, color: P.amber, life: 0, maxLife: 5 }); sfx.launch(); }
  else { beams.push({ x1: h.x, y1: h.y, x2: tp.x, y2: tp.y, color: P.magenta, life: .14, max: .14 }); applyDamage(target, 6, h, 'fuzz'); }
}
function drainTether(h, dt) { const amt = 10 * dt; if (SHIP.shield > 0) { SHIP.shield = Math.max(0, SHIP.shield - amt); h.dmgDealt += amt; shieldAgg.n++; shieldAgg.dmg += amt; shieldAgg.last = sim.t; } if (rand() < dt * 20) particles.push({ x: lerp(h.x, SHIP.cx, rand()), y: lerp(h.y, SHIP.cy, rand()) + rand(-3, 3), vx: rand(-4, 4), vy: rand(-4, 4), life: .4, max: .4, c: P.magenta, s: 1 }); }
function killHostile(h, by = 'turret') {
  if (!h.live) return; if (h.lod === 'dot') { h.live = false; h.state = 'dead'; return; }
  h.state = 'dying'; h.st = 0; sim.kills++; sfx.boom(); addShake(h.def.threat * 1.5); sim.flash = Math.min(.3, sim.flash + .08);
  for (let i = 0; i < 30 + h.def.threat * 8; i++) { const a = rand(TAU), s = rand(20, 110); particles.push({ x: h.x, y: h.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(.4, 1.1), max: 1.1, c: pick([P.fail, P.amber, '#ffe9c4', P.failD, P.debrisL, P.white]), s: rand() < .3 ? 2 : 1 }); }
  for (let i = 0; i < 8; i++) particles.push({ x: h.x + rand(-6, 6), y: h.y + rand(-6, 6), vx: rand(-12, 12), vy: rand(-12, 12), life: rand(.8, 1.6), max: 1.6, c: P.smoke, s: 2, smoke: true });
  addRing(h.x, h.y, 2, 34, P.amber, .45); addRing(h.x, h.y, 2, 18, P.white, .25); if (selected && selected.h === h) selectNone();
}
function passEval(p = {}) {
  const h = p.id ? byId.get(p.id) : hostiles.find(x => x.live && x.result === null && x.lod === 'full') || hostiles.find(x => x.live && x.result === null); if (!h || !h.live) { if (p.id) log('warn', 'pass', `pass for unknown eval <b>${esc(p.id)}</b>`); return; }
  h.result = 'pass'; sim.pass++; const m = h.module && modules.get(h.module); if (m) m.passes++;
  if (h.lod === 'full') { const turrets = parts.filter(q => q.type === 'L' && alive(q)); const shooters = turrets.length ? turrets.slice(0, 2 + h.def.threat) : []; const need = h.hp; let dealt = 0;
    shooters.forEach((q, i) => setTimeout(() => { if (!h.live) return; const pp = partPos(q); q.aim = Math.atan2(h.y - pp.y, h.x - pp.x); q.cool = .3; beams.push({ x1: pp.x + Math.cos(q.aim) * 3, y1: pp.y + Math.sin(q.aim) * 3, x2: h.x + rand(-2, 2), y2: h.y + rand(-2, 2), color: P.ally, life: .12, max: .12 }); sfx.zap(); h.flash = 1; dealt += need / shooters.length; for (let k = 0; k < 4; k++) particles.push({ x: h.x, y: h.y, vx: rand(-30, 30), vy: rand(-30, 30), life: .3, max: .3, c: pick([P.ally, P.white, P.fail]), s: 1 }); if (i === shooters.length - 1) { h.hp = 0; killHostile(h, 'pass'); } else h.hp = Math.max(1, h.hp - need / shooters.length); }, i * 110));
    if (!shooters.length) { h.hp = 0; killHostile(h, 'pass'); }
    addFloater(h.x, h.y - 12, 'PASS', P.pass || '#5ff2b0', 1); }
  else { h.live = false; h.state = 'dead'; sfx.pop(); particles.push({ x: h.dx, y: h.dy, vx: 0, vy: 0, life: .25, max: .25, c: '#5ff2b0', s: 2 }); }
  log('pass', 'pass', `<b>${esc(h.id)}</b> ${esc(h.name)} passed`, true); bus.emit('eval.pass', { id: h.id, suite: h.suite }); threatsDirty = true;
}
function failEval(p = {}) {
  let h = p.id ? byId.get(p.id) : hostiles.find(x => x.live && x.result === null && x.lod === 'full') || hostiles.find(x => x.live && x.result === null);
  if (!h) { h = startEval({ id: p.id, kind: p.kind, module: p.module, suite: p.suite, name: p.name }); h.state = 'approach'; h.st = 0; }
  if (!h.live) return; h.result = 'fail'; h.error = p.error || pick(['AssertionError: expected 200 got 500', 'TimeoutError: tool call exceeded 30s', 'TypeError: cannot read properties of undefined', 'ContextOverflow: 212k tokens > 200k limit', 'PolicyViolation: wrote outside sandbox', 'RateLimit: 429 from provider', 'StaleMemory: recalled fact from 3 sessions ago']);
  h.module = p.module || h.module || h.suite; sim.fail++; promote(h); if (h.state === 'warp') { h.state = 'approach'; h.st = 0; }
  const cell = moduleCell(h.module); const m = modules.get(h.module); if (m) { m.fails++; m.lastError = h.error; } h.cool = .15;
  log('fail', 'fail', `<b>${esc(h.id)}</b> ${esc(h.name)} <b>FAILED</b> in <b>${esc(h.module)}</b> — ${esc(h.error)}`); addFloater(h.x, h.y - 12, 'FAIL', P.fail, 1.2); sfx.alert();
  const fx = { id: `fx-${h.id}`, evalId: h.id, module: h.module, what: h.error, fix: null, status: 'broke', t: sim.t, cell }; fixes.set(fx.id, fx); h.fixId = null; renderFixes();
  bus.emit('eval.fail', { id: h.id, module: h.module, error: h.error }); say(pick([`${h.module} is breached. ${h.error.split(':')[0]}.`, `Failure in ${h.module}. Harness is drafting a fix.`, `Eval ${h.id} broke ${h.module}.`]));
  if (sim.autoFix) setTimeout(() => { if (fixes.get(fx.id)?.status === 'broke') proposeFix({ evalId: h.id }); }, 1800 + rand(1500));
  setCondition(); threatsDirty = true; return h;
}
function proposeFix(p = {}) {
  let fx = p.id && fixes.get(p.id); if (!fx && p.evalId) fx = [...fixes.values()].find(f => f.evalId === p.evalId && f.status !== 'merged'); if (!fx) fx = [...fixes.values()].find(f => f.status === 'broke');
  if (!fx) { if (p.module) { const cell = moduleCell(p.module); fx = { id: p.id || `fx-${++seq}`, evalId: null, module: p.module, what: p.what || 'manual repair', fix: null, status: 'broke', t: sim.t, cell }; fixes.set(fx.id, fx); } else { log('info', 'fix', 'No open failure to fix.'); return; } }
  if (fx.status === 'fixing') return fx; fx.fix = p.summary || pick(['Add retry with backoff on 401', 'Guard null before dereference', 'Truncate context to 180k with summary', 'Scope tool access to sandbox root', 'Add rate-limit queue', 'Expire memory facts after 2 sessions', 'Raise timeout to 60s for tool calls']); fx.status = 'fixing'; fx.podT = sim.t; const h = fx.evalId && byId.get(fx.evalId); if (h) h.fixId = fx.id;
  const pod = sendPod({ part: fx.cell, label: `${fx.module}: ${fx.fix}`, fix: fx }); fx.pod = pod; renderFixes(); log('fix', 'fix', `<b>${esc(fx.id)}</b> fix proposed for <b>${esc(fx.module)}</b>: ${esc(fx.fix)}`); bus.emit('fix.propose', { id: fx.id, evalId: fx.evalId, module: fx.module, summary: fx.fix });
  if (sim.autoFix && !p.manual) setTimeout(() => { if (fixes.get(fx.id)?.status === 'fixing') mergeFix({ id: fx.id }); }, 3200 + rand(1200)); return fx;
}
function mergeFix(p = {}) {
  let fx = p.id && fixes.get(p.id); if (!fx) fx = [...fixes.values()].find(f => f.status === 'fixing') || [...fixes.values()].find(f => f.status === 'broke'); if (!fx) { log('info', 'fix', 'No fix to merge.'); return; }
  if (fx.status === 'broke') { proposeFix({ id: fx.id, manual: true }); }
  fx.status = 'merged'; fx.mergedT = sim.t; const pod = fx.pod; if (pod && pod.state === 'fly') { pod.t = Math.max(pod.t, .92); }
  const finish = () => { const cell = fx.cell; if (cell) { cell.dead = false; cell.hp = cell.max; cell.build = 0; cell.queued = false; SHIP.dirty = true; } const h = fx.evalId && byId.get(fx.evalId); if (h && h.live) { h.state = 'retreat'; h.tether = false; addFloater(h.x, h.y - 12, 'FIXED', P.fix, 1.2); } sim.healPulse = .6; sfx.dock(); log('fix', 'fix', `<b>${esc(fx.id)}</b> merged into <b>${esc(fx.module)}</b>. Cell reformed.`); bus.emit('fix.merge', { id: fx.id, module: fx.module }); const el = document.getElementById('fx-' + fx.id); if (el) { el.classList.add('merged'); setTimeout(() => { el.remove(); fixes.delete(fx.id); renderFixes(); }, 650); } else { fixes.delete(fx.id); renderFixes(); } setCondition(); threatsDirty = true; refreshInspector(); };
  if (pod && pod.state === 'fly') pod.onDock = finish; else finish(); renderFixes();
}
function addRule(p = {}) {
  const id = p.id && UPGRADES[p.id] && !SHIP.applied[p.id] ? p.id : null; const name = p.name || (id ? UPGRADES[id].name : pick(['Never retry writes', 'Summarize context at 150k', 'Deny shell outside repo', 'Prefer cached tool results', 'Escalate after 3 failures', 'Pin provider version']));
  sim.rules++; const level = 1 + Math.floor(sim.rules / 3); sfx.rule(); addRing(SHIP.cx, SHIP.cy, 40, 95, P.rule, .8); SHIP.shield = Math.min(SHIP.shield + 40, 1e9);
  const card = { id: `rule-${sim.rules}`, module: 'harness', what: null, fix: name, status: 'rule', t: sim.t }; fixes.set(card.id, card); renderFixes(); setTimeout(() => { const el = document.getElementById('fx-' + card.id); if (el) el.classList.add('merged'); setTimeout(() => { fixes.delete(card.id); renderFixes(); }, 650); }, 2600);
  log('rule', 'rule', `<b>Rule ${sim.rules}</b> added: ${esc(name)}${id ? ` → <b>${esc(UPGRADES[id].name)}</b> module inbound` : ''}. Harness level ${level}.`); say(id ? `${UPGRADES[id].name} on the way from Earth.` : pick([`Harness learned: ${name}.`, `New rule active. Shield capacity up.`]));
  if (id) sendPod({ upgrade: id }); bus.emit('rule.add', { name, id, rules: sim.rules, level }); renderRuleSelect();
}
function heal(p = {}) {
  const amt = p.amount || 60; sim.healPulse = 1; sfx.heal(); SHIP.shield = Math.min(SHIP.shieldMax || 200, SHIP.shield + amt); let left = amt; const dmg = parts.filter(q => !q.dead && q.hp < q.max).sort((a, b) => a.hp / a.max - b.hp / b.max);
  for (const q of dmg) { if (left <= 0) break; const d = Math.min(left, q.max - q.hp); q.hp += d; left -= d; const pp = partPos(q); for (let i = 0; i < 3; i++) particles.push({ x: pp.x, y: pp.y, vx: rand(-8, 8), vy: rand(-14, -4), life: .6, max: .6, c: P.heal, s: 1 }); }
  SHIP.dirty = true; addRing(SHIP.cx, SHIP.cy, 20, 90, P.heal, .9); log('heal', 'rule', `<b>Self-heal</b> +${amt}: shield restored, ${dmg.length ? dmg.length + ' cells patched' : 'hull nominal'}.`); say(pick(['Harness healing cycle complete.', 'Shield regenerating. Plating patched.'])); bus.emit('heal', { amount: amt }); refreshInspector();
}

// ---------------- damage / shots ----------------
const shieldAgg = { n: 0, dmg: 0, last: 0 };
function shieldHitPoint(fx, fy, tx, ty) { const rx = 92, ry = 46, cx = SHIP.cx, cy = SHIP.cy; const dx = tx - fx, dy = ty - fy; const ox = fx - cx, oy = fy - cy; const A = dx * dx / (rx * rx) + dy * dy / (ry * ry), B = 2 * (ox * dx / (rx * rx) + oy * dy / (ry * ry)), C = ox * ox / (rx * rx) + oy * oy / (ry * ry) - 1; const disc = B * B - 4 * A * C; if (disc < 0) return { x: tx, y: ty }; const t = (-B - Math.sqrt(disc)) / (2 * A); return { x: fx + dx * clamp(t, 0, 1), y: fy + dy * clamp(t, 0, 1) }; }
function applyDamage(part, amount, from, how) {
  if (!part || part.dead) part = pickTargetPart(); if (!part) return; const pp = partPos(part);
  if (SHIP.shield > 0) { const absorbed = Math.min(SHIP.shield, amount); SHIP.shield -= absorbed; amount -= absorbed; if (from) from.dmgDealt += absorbed; const hp = from ? shieldHitPoint(from.x, from.y, pp.x, pp.y) : pp; addRing(hp.x, hp.y, 1, 10, P.ally, .3); sfx.shield(); for (let i = 0; i < 5; i++) particles.push({ x: hp.x, y: hp.y, vx: rand(-25, 25), vy: rand(-25, 25), life: .3, max: .3, c: P.ally, s: 1 }); shieldAgg.n++; shieldAgg.dmg += absorbed; shieldAgg.last = sim.t; SHIP.shieldFlash = .25;
    if (SHIP.shield <= 0) { log('fail', 'fail', `<b>Harness shield down.</b> Modules exposed.`); say('Shield collapsed. Failures hit the hull now.'); bus.emit('shield.down'); } if (amount <= 0) return; }
  part.hp -= amount; if (from) { from.dmgDealt += amount; from.hits++; } SHIP.dirty = true; sfx.hit(); addShake(amount > 20 ? 3 : 1.2); addFloater(pp.x, pp.y - 4, `-${Math.round(amount)}`, amount > 20 ? P.fail : '#ffd9b0', .9);
  for (let i = 0; i < (amount > 20 ? 10 : 4); i++) particles.push({ x: pp.x, y: pp.y, vx: rand(-40, 40), vy: rand(-40, 40), life: rand(.2, .5), max: .5, c: pick([P.orange, P.hullL, P.amber]), s: 1 });
  const who = from ? from.id : 'external'; const mod = part.module ? ` <span class="tag">${esc(part.module)}</span>` : '';
  if (part.hp <= 0) { part.hp = 0; part.dead = true; log('fail', 'fail', `<b>${esc(part.name)} ${part.id}</b>${mod} destroyed by ${esc(who)}.`); bus.emit('breach', { part: part.id, module: part.module, by: who }); for (let i = 0; i < 12; i++) particles.push({ x: pp.x, y: pp.y, vx: rand(-20, 20), vy: rand(-20, 20), life: rand(.6, 1.4), max: 1.4, c: P.smoke, s: 2, smoke: true }); if (part.type === 'S') say('Shield emitter gone. Capacity reduced.'); else if (part.type === 'R') say('Reactor hit. Power dropping.'); }
  else { log('warn', 'fail', `${esc(who)} hits <b>${esc(part.name)} ${part.id}</b>${mod} (−${Math.round(amount)}, ${Math.round(part.hp / part.max * 100)}%)`, true); bus.emit('hit', { part: part.id, module: part.module, amount: Math.round(amount), by: who }); }
  refreshInspector(true);
}
function updateShots(dt) {
  for (let i = shots.length - 1; i >= 0; i--) { const s = shots[i]; s.life += dt; if (!s.from.live && s.kind !== 'missile') { shots.splice(i, 1); continue; }
    if (s.kind === 'missile') { const ang = Math.atan2(s.ty - s.y, s.tx - s.x); s.vx += (Math.cos(ang) * 120 - s.vx) * dt * 2.2; s.vy += (Math.sin(ang) * 120 - s.vy) * dt * 2.2; s.x += s.vx * dt; s.y += s.vy * dt; if (rand() < .8) particles.push({ x: s.x, y: s.y, vx: rand(-5, 5), vy: rand(-5, 5), life: .35, max: .35, c: pick([P.amber, P.smoke]), s: 1 }); const sh = SHIP.shield > 0 ? shieldHitPoint(s.from.x, s.from.y, s.tx, s.ty) : null; const goal = sh || { x: s.tx, y: s.ty }; if (dist(s.x, s.y, goal.x, goal.y) < 4 || s.life > s.maxLife) { shots.splice(i, 1); applyDamage(s.part, s.dmg, s.from, 'missile'); addRing(goal.x, goal.y, 1, 9, P.amber, .2); } continue; }
    const d = dist(s.x, s.y, s.tx, s.ty); const step = s.speed * dt; const sh = SHIP.shield > 0 ? shieldHitPoint(s.from.x, s.from.y, s.tx, s.ty) : null; if (sh && dist(s.x, s.y, sh.x, sh.y) <= step) { shots.splice(i, 1); applyDamage(s.part, s.dmg, s.from, s.kind); continue; } if (d <= step) { shots.splice(i, 1); applyDamage(s.part, s.dmg, s.from, s.kind); continue; } s.x += (s.tx - s.x) / d * step; s.y += (s.ty - s.y) / d * step; }
}
function updateDefense(dt) {
  const st = shipStats(); const targets = hostiles.filter(h => h.live && h.lod === 'full' && (h.state === 'approach' || h.state === 'engage') && h.result === 'fail' && !h.fixId);
  for (const p of parts) { if (p.type !== 'L' || !alive(p)) continue; p.cool -= dt; const pp = partPos(p); let best = null, bd = 1e9; for (const h of targets) { const d = dist(pp.x, pp.y, h.x, h.y); if (d < bd) { bd = d; best = h; } }
    if (best) p.aim = Math.atan2(best.y - pp.y, best.x - pp.x); else p.aim += (0 - p.aim) * dt * 2; if (!sim.autoDef || !best || p.cool > 0) continue;
    p.cool = 1.4 / Math.max(.35, .55 + st.power * .45); const tgt = (focusTarget && focusTarget.live) ? focusTarget : best; beams.push({ x1: pp.x + Math.cos(p.aim) * 3, y1: pp.y + Math.sin(p.aim) * 3, x2: tgt.x + rand(-2, 2), y2: tgt.y + rand(-2, 2), color: P.ally, life: .12, max: .12 }); sfx.zap(); tgt.hp -= 6; tgt.flash = 1; if (tgt.hp <= 0 && tgt.state !== 'dying') { tgt.state = 'retreat'; log('info', 'fail', `<b>${esc(tgt.id)}</b> suppressed by point defense.`); } }
}

// ---------------- pods ----------------
function earthLaunchPoint() { const a = Math.atan2(SHIP.cy - EARTH.y, SHIP.cx - EARTH.x); return { x: EARTH.x + Math.cos(a) * (EARTH.r + 2), y: EARTH.y + Math.sin(a) * (EARTH.r + 2), a }; }
function sendPod({ part, upgrade, label, fix } = {}) {
  let cells, type; if (upgrade) { const u = UPGRADES[upgrade]; if (!u || SHIP.applied[upgrade]) return null; SHIP.applied[upgrade] = 'pending'; cells = slotCells[u.slot].map(x => ({ ...x })); label = label || u.name; type = u.type; }
  else { if (!part) { const dmg = parts.filter(p => p.hp < p.max && p.build >= 1 && !p.queued).sort((a, b) => (a.hp / a.max) - (b.hp / b.max)); part = dmg[0]; } if (!part) { log('info', 'fix', 'Nothing to repair.'); return null; } part.queued = true; cells = [{ c: part.c, r: part.r, part }]; label = label || `${part.name} ${part.id}`; type = part.type; }
  const lp = earthLaunchPoint(); sim.pods++; const pod = { id: `POD-${pad2(sim.pods)}`, x: lp.x, y: lp.y, sx: lp.x, sy: lp.y, t: 0, dur: 2.4, cells, label, type, upgrade, part, fix, state: 'fly', ctrl: { x: lerp(lp.x, SHIP.cx, .45), y: lerp(lp.y, SHIP.cy, .45) - 70 } };
  const first = cells[0]; pod.tx = SHIP.ox + first.c * TS + TS / 2; pod.ty = SHIP.oy + first.r * TS + TS / 2; pods.push(pod); sfx.launch(); addRing(lp.x, lp.y, 1, 14, P.fix, .4); addFloater(lp.x, lp.y - 10, 'LAUNCH', P.fix, 1.2);
  for (let i = 0; i < 14; i++) particles.push({ x: lp.x, y: lp.y, vx: Math.cos(lp.a + rand(-1, 1)) * rand(10, 40), vy: Math.sin(lp.a + rand(-1, 1)) * rand(10, 40), life: rand(.4, .9), max: .9, c: pick([P.fix, '#fff1c9', P.smoke]), s: 1 });
  log('fix', 'fix', `<b>${pod.id}</b> launched from Earth: ${esc(label)}.`, true); bus.emit('pod.launch', { id: pod.id, label }); return pod;
}
function updatePods(dt) {
  for (let i = pods.length - 1; i >= 0; i--) { const p = pods[i];
    if (p.state === 'fly') { p.t += dt / p.dur; const t = Math.min(1, p.t); const e = t * t * (3 - 2 * t); const mt = 1 - e; p.x = mt * mt * p.sx + 2 * mt * e * p.ctrl.x + e * e * p.tx; p.y = mt * mt * p.sy + 2 * mt * e * p.ctrl.y + e * e * p.ty; if (rand() < .9) particles.push({ x: p.x, y: p.y, vx: rand(-6, 6), vy: rand(-6, 6), life: .4, max: .4, c: pick([P.fix, '#fff1c9', '#8a7a4a']), s: 1 });
      if (t >= 1) { p.state = 'dock'; p.t = 0; sfx.dock(); addRing(p.tx, p.ty, 1, 8, P.fix, .3); bus.emit('pod.dock', { id: p.id }); if (p.onDock) { p.onDock(); p.onDock = null; } else if (p.fix && p.fix.status === 'fixing') { p.fix.docked = true; renderFixes(); } } }
    else if (p.state === 'dock') { p.t += dt; const idx = Math.floor(p.t / .5); if (idx > (p.doneIdx ?? -1)) { p.doneIdx = idx; const cell = p.cells[idx]; if (!cell) { p.state = 'done'; pods.splice(i, 1); finishPod(p); continue; } if (p.fix && !p.fix.mergedT) continue; let part = cell.part || partAt(cell.c, cell.r); if (!part) { const def = PART_DEF[p.type]; const n = parts.filter(q => q.def.code === def.code).length + 1; part = { id: def.code + n, type: p.type, c: cell.c, r: cell.r, hp: def.hp, max: def.hp, build: 0, name: def.name, def, dead: false, cool: 0, aim: 0, module: null }; parts.push(part); SHIP.grid[cell.r][cell.c] = part; } part.dead = false; part.hp = part.max; part.build = 0; part.queued = false; SHIP.dirty = true; } } }
  for (const part of parts) if (part.build < 1) { part.build = Math.min(1, part.build + dt / .5); const pp = partPos(part); if (rand() < .7) { particles.push({ x: pp.x + rand(-3, 3), y: pp.y - 3 + part.build * 6, vx: rand(-15, 15), vy: rand(-20, 5), life: .3, max: .3, c: pick([P.ally, P.white, P.fix]), s: 1 }); sfx.build(); } if (part.build >= 1) { SHIP.dirty = true; refreshInspector(true); } }
}
function finishPod(p) { if (p.upgrade) { SHIP.applied[p.upgrade] = true; const u = UPGRADES[p.upgrade]; log('rule', 'rule', `<b>${u.name}</b> online. ${u.desc}`); bus.emit('upgrade.done', { id: p.upgrade }); say(`${u.name} integrated. Ship reconfigured.`); renderRuleSelect(); } SHIP.dirty = true; refreshInspector(); }

// ---------------- fx ----------------
function addRing(x, y, r0, r1, c, life) { rings.push({ x, y, r0, r1, c, life, max: life }); }
function addFloater(x, y, text, c, life) { if (floaters.length > 40) floaters.shift(); floaters.push({ x, y, text, c, life, max: life }); }
function addShake(a) { sim.shake = Math.min(8, sim.shake + a); }

// ---------------- camera ----------------
let insetCache = { l: 0, r: 0, t: 0, b: 0, at: -1 };
function uiInsets() { if (sim.t - insetCache.at < .5 && insetCache.at >= 0) return insetCache; let l = 0, r = 0, t = 0, b = 0; const W = innerWidth, H = innerHeight;
  const vis = id => { const e = document.getElementById(id); if (!e || e.classList.contains('collapsed') || getComputedStyle(e).display === 'none') return null; return e.getBoundingClientRect(); };
  for (const id of ['left', 'insp', 'fixes', 'console', 'log', 'top']) { const q = vis(id); if (!q) continue; if (q.height >= H * .3 && q.right <= W * .55) l = Math.max(l, q.right); else if (q.height >= H * .3 && q.left >= W * .45) r = Math.max(r, W - q.left); else if (q.top >= H * .5) b = Math.max(b, H - q.top); else if (q.bottom <= H * .3) t = Math.max(t, q.bottom); }
  if (W - l - r < 260 || H - t - b < 200) { l = r = 0; b = Math.min(b, H * .4); } insetCache = { l: l / SCALE, r: r / SCALE, t: t / SCALE, b: b / SCALE, at: sim.t }; return insetCache; }
function updateCamera(dt) {
  let minX = SHIP.ox - 24, maxX = SHIP.ox + SHIP.w + 24, minY = SHIP.oy - 24, maxY = SHIP.oy + SHIP.h + 24; let anyFull = false, anyDot = false;
  for (const h of hostiles) { if (!h.live) continue; if (h.lod === 'full') { anyFull = true; minX = Math.min(minX, h.x - 24); maxX = Math.max(maxX, h.x + 24); minY = Math.min(minY, h.y - 20); maxY = Math.max(maxY, h.y + 20); } else anyDot = true; }
  if (anyDot) { maxX = Math.max(maxX, 345); minY = Math.min(minY, -125); maxY = Math.max(maxY, 125); }
  for (const p of pods) if (p.state === 'fly') { minX = Math.min(minX, p.x - 10); maxX = Math.max(maxX, p.x + 10); minY = Math.min(minY, p.y - 10); maxY = Math.max(maxY, p.y + 10); }
  const ins = uiInsets(); const uw = VW - ins.l - ins.r, uh = VH - ins.t - ins.b; const w = maxX - minX + 40, h = maxY - minY + 40; const z = clamp(Math.min(uw / w, uh / h), .45, 1); const calm = z >= 1 && !anyFull && !anyDot && !pods.length;
  cam.tz = z; cam.tx = (minX + maxX) / 2 - (ins.l - ins.r) / 2 / z + (calm ? -30 : 0); cam.ty = (minY + maxY) / 2 - (ins.t - ins.b) / 2 / z + (calm ? 22 : 0); const k = 1 - Math.pow(.02, dt); cam.x += (cam.tx - cam.x) * k; cam.y += (cam.ty - cam.y) * k; cam.z += (cam.tz - cam.z) * k * .8;
}
const w2s = (x, y) => ({ x: ((x - cam.x) * cam.z + VW / 2) * SCALE, y: ((y - cam.y) * cam.z + VH / 2) * SCALE });
const s2w = (sx, sy) => ({ x: (sx / SCALE - VW / 2) / cam.z + cam.x, y: (sy / SCALE - VH / 2) / cam.z + cam.y });

// ---------------- render ----------------
let hover = null, selected = null, focusTarget = null;
function render() {
  const t = sim.t; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#06070d'; ctx.fillRect(0, 0, VW, VH); const shx = (rand(-1, 1) * sim.shake) | 0, shy = (rand(-1, 1) * sim.shake) | 0;
  ctx.drawImage(space, Math.round(-120 - cam.x * .06 + shx * .3), Math.round(-120 - cam.y * .06 + shy * .3));
  for (const s of stars) { const px_ = Math.round((s.x - cam.x * (.2 + s.l * .35)) + VW / 2), py_ = Math.round((s.y - cam.y * (.2 + s.l * .35)) + VH / 2); if (px_ < 0 || py_ < 0 || px_ >= VW || py_ >= VH) continue; const tw = .6 + .4 * Math.sin(t * 2 + s.tw); ctx.globalAlpha = s.l * (s.l > .5 ? tw : 1); ctx.fillStyle = s.c; ctx.fillRect(px_, py_, 1, 1); if (s.l === 1 && tw > .9) { ctx.globalAlpha = .4; ctx.fillRect(px_ - 1, py_, 3, 1); ctx.fillRect(px_, py_ - 1, 1, 3); } } ctx.globalAlpha = 1;
  ctx.setTransform(cam.z, 0, 0, cam.z, Math.round(VW / 2 - cam.x * cam.z + shx), Math.round(VH / 2 - cam.y * cam.z + shy));
  ctx.drawImage(earthCan, Math.round(EARTH.x - ER), Math.round(EARTH.y - ER));
  // swarm dots (far right band)
  for (const h of hostiles) { if (h.lod !== 'dot' || !h.live) continue; const bl = Math.sin(h.dp * TAU) > 0; ctx.fillStyle = h.result === 'fail' ? P.fail : bl ? h.def.color : '#6b2a2a'; ctx.fillRect(Math.round(h.dx + Math.sin(t * .4 + h.dp * 9) * 3), Math.round(h.dy + Math.cos(t * .3 + h.dp * 7) * 2), 1, 1); }
  for (const p of pods) if (p.state === 'fly') { const ang = Math.atan2(p.ty - p.y, p.tx - p.x); ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.rotate(ang); ctx.fillStyle = P.hullX; ctx.fillRect(-4, -2, 8, 4); ctx.fillStyle = P.fix; ctx.fillRect(-3, -1, 6, 2); ctx.fillStyle = P.white; ctx.fillRect(1, -1, 2, 1); ctx.fillStyle = ((t * 30) | 0) % 2 ? P.orange : '#fff1c9'; ctx.fillRect(-7, -1, 3, 2); ctx.restore(); }
  if (SHIP.dirty) renderShip();
  for (const p of parts) if (p.type === 'T' && alive(p) && !partAt(p.c - 1, p.r)) { const pp = partPos(p); const len = 5 + ((Math.sin(t * 25 + p.r * 3) + 1) * 2.5) | 0; ctx.fillStyle = P.allyD; ctx.fillRect(pp.x - 3 - len, pp.y - 1, len, 3); ctx.fillStyle = P.ally; ctx.fillRect(pp.x - 3 - len * .6, pp.y - 1, len * .6, 2); ctx.fillStyle = P.white; ctx.fillRect(pp.x - 5, pp.y, 2, 1); }
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.drawImage(silCan, SHIP.ox + ox, SHIP.oy + oy); ctx.drawImage(shipCan, SHIP.ox, SHIP.oy);
  for (const p of parts) if (p.build < 1) { const x = SHIP.ox + p.c * TS, y = SHIP.oy + p.r * TS; ctx.save(); ctx.beginPath(); ctx.rect(x, y, TS, Math.ceil(TS * p.build)); ctx.clip(); ctx.translate(SHIP.ox, SHIP.oy); drawPart(ctx, p, p.c * TS, p.r * TS); ctx.restore(); ctx.fillStyle = ((t * 20) | 0) % 2 ? P.ally : P.white; ctx.fillRect(x - 1, y + Math.floor(TS * p.build), TS + 2, 1); ctx.strokeStyle = P.fix; ctx.globalAlpha = .7; ctx.strokeRect(x - 1.5, y - 1.5, TS + 3, TS + 3); ctx.globalAlpha = 1; }
  for (const p of parts) { if (!alive(p)) continue; const pp = partPos(p);
    if (p.type === 'R') { const k = (Math.sin(t * 6 + p.c) + 1) / 2; ctx.fillStyle = k > .5 ? P.core : P.coreH; ctx.fillRect(pp.x - 1, pp.y - 1, 1, 1); ctx.fillRect(pp.x, pp.y, 1, 1); if (k > .8) { ctx.fillStyle = P.white; ctx.fillRect(pp.x - 1, pp.y, 1, 1); } }
    else if (p.type === 'S') { if (Math.sin(t * 4 + p.r) > 0 && SHIP.shield > 0) { ctx.fillStyle = P.white; ctx.fillRect(pp.x - 1, pp.y - 1, 1, 1); } }
    else if (p.type === 'L') { ctx.strokeStyle = P.hullL; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pp.x, pp.y); ctx.lineTo(pp.x + Math.cos(p.aim) * 3.5, pp.y + Math.sin(p.aim) * 3.5); ctx.stroke(); ctx.fillStyle = p.cool > .9 ? P.ally : P.hullX; ctx.fillRect(pp.x - 1, pp.y - 1, 1, 1); }
    else if (p.type === 'C') { if (((t * 2) | 0) % 2) { ctx.fillStyle = P.white; ctx.fillRect(pp.x - 1, pp.y - 1, 1, 1); } }
    else if (p.type === 'N' && !partAt(p.c, p.r - 1) && ((t * 1.5) | 0) % 2) { ctx.fillStyle = P.fail; ctx.fillRect(pp.x, pp.y - 2, 1, 1); } else if (p.type === 'N' && !partAt(p.c, p.r + 1) && ((t * 1.5 + 1) | 0) % 2) { ctx.fillStyle = P.fail; ctx.fillRect(pp.x, pp.y + 2, 1, 1); }
    if (!p.dead && p.hp / p.max < .34 && rand() < .15) particles.push({ x: pp.x + rand(-2, 2), y: pp.y, vx: rand(-4, 4), vy: rand(-14, -6), life: rand(.5, 1), max: 1, c: pick([P.smoke, '#3a3542']), s: 1, smoke: true }); }
  // shield is invisible at rest: a hit shows a local arc flash, a heal shows a brief green sweep
  if (SHIP.shieldFlash > 0 && SHIP.shield > 0) { ctx.globalAlpha = SHIP.shieldFlash * 1.6; ctx.strokeStyle = P.ally; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.ellipse(SHIP.cx, SHIP.cy, 92, 46, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; SHIP.shieldFlash = Math.max(0, SHIP.shieldFlash - .02); }
  if (sim.healPulse > 0) { const x = SHIP.ox - 10 + (1 - sim.healPulse) * (SHIP.w + 20); ctx.globalAlpha = Math.min(1, sim.healPulse * 1.5); ctx.fillStyle = P.heal; ctx.fillRect(Math.round(x), SHIP.oy - 6, 1, SHIP.h + 12); ctx.globalAlpha *= .35; ctx.fillRect(Math.round(x) - 6, SHIP.oy - 6, 6, SHIP.h + 12); ctx.globalAlpha = 1; }
  for (const h of hostiles) { if (!h.live && h.state !== 'dying') continue; if (h.lod !== 'full') continue; const img = h.def.img; ctx.save(); ctx.translate(Math.round(h.x), Math.round(h.y)); ctx.rotate(h.ang - Math.PI);
    if (h.state === 'warp') { ctx.globalAlpha = h.warp; ctx.scale(1 + (1 - h.warp) * 3, Math.max(.05, h.warp)); }
    if (h.state !== 'dying') { const fl = 3 + ((Math.sin(t * 30 + h.slot) + 1) * 2) | 0; ctx.fillStyle = h.kind === 'fuzz' ? P.magenta : P.orange; ctx.fillRect(img.width / 2 - 1, -1, fl, 2); ctx.fillStyle = '#fff1c9'; ctx.fillRect(img.width / 2 - 1, 0, 2, 1); }
    ctx.drawImage(img, -img.width / 2 | 0, -img.height / 2 | 0);
    if (h.flash > 0) { ctx.globalCompositeOperation = 'source-atop'; ctx.globalAlpha = h.flash * .8; ctx.fillStyle = '#fff'; ctx.fillRect(-img.width / 2, -img.height / 2, img.width, img.height); ctx.globalCompositeOperation = 'source-over'; }
    if (h.state === 'dying') { ctx.globalAlpha = Math.max(0, 1 - h.st * 2); ctx.fillStyle = '#fff'; ctx.fillRect(-img.width / 2, -img.height / 2, img.width, img.height); }
    ctx.restore();
    if (h.tether) { ctx.strokeStyle = P.magenta; ctx.lineWidth = 1; ctx.globalAlpha = .8; ctx.beginPath(); ctx.moveTo(h.x, h.y); for (let k = 1; k <= 8; k++) { const u = k / 8; ctx.lineTo(lerp(h.x, SHIP.cx, u) + Math.sin(t * 25 + k) * 3 * (1 - Math.abs(u - .5) * 2), lerp(h.y, SHIP.cy, u) + Math.cos(t * 19 + k * 2) * 3); } ctx.stroke(); ctx.globalAlpha = 1; }
    if (h.state !== 'dying') { const w = img.width; const col = h.result === 'fail' ? P.fail : h.result === 'pass' ? '#5ff2b0' : P.amber; ctx.fillStyle = '#0a0b12'; ctx.fillRect(Math.round(h.x - w / 2), Math.round(h.y - img.height / 2) - 5, w, 2); ctx.fillStyle = col; ctx.fillRect(Math.round(h.x - w / 2), Math.round(h.y - img.height / 2) - 5, Math.round(w * h.hp / h.max), 2);
      if (h.result === 'fail' && ((t * 3) | 0) % 2) { ctx.fillStyle = P.fail; ctx.fillRect(Math.round(h.x - w / 2) - 3, Math.round(h.y - img.height / 2) - 6, 2, 2); } }
    if ((hover && hover.h === h) || (selected && selected.h === h) || focusTarget === h) { ctx.strokeStyle = focusTarget === h ? P.fail : (selected && selected.h === h) ? P.white : P.amber; ctx.lineWidth = 1; const r = img.width / 2 + 4; ctx.setLineDash([2, 2]); ctx.lineDashOffset = -t * 10; ctx.strokeRect(Math.round(h.x - r) + .5, Math.round(h.y - r) + .5, r * 2, r * 2); ctx.setLineDash([]); } }
  const hp = hover && hover.part, sp = selected && selected.part; for (const [p, c] of [[hp, P.white], [sp, P.ally]]) if (p) { ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.strokeRect(SHIP.ox + p.c * TS - .5, SHIP.oy + p.r * TS - .5, TS + 1, TS + 1); }
  for (const f of fixes.values()) if (f.cell && f.status !== 'merged' && f.status !== 'rule') { ctx.strokeStyle = f.status === 'fixing' ? P.fix : P.fail; ctx.globalAlpha = .5 + .5 * Math.sin(t * 6); ctx.strokeRect(SHIP.ox + f.cell.c * TS - 1.5, SHIP.oy + f.cell.r * TS - 1.5, TS + 3, TS + 3); ctx.globalAlpha = 1; }
  if ((hover && hover.ship) || (selected && selected.ship)) { ctx.strokeStyle = selected && selected.ship ? P.ally : P.white; ctx.setLineDash([3, 3]); ctx.lineDashOffset = -t * 8; ctx.strokeRect(SHIP.ox - 3.5, SHIP.oy - 3.5, SHIP.w + 7, SHIP.h + 7); ctx.setLineDash([]); }
  if ((hover && hover.earth) || (selected && selected.earth)) { ctx.strokeStyle = selected && selected.earth ? P.fix : P.white; ctx.setLineDash([4, 4]); ctx.lineDashOffset = -t * 8; ctx.beginPath(); ctx.arc(EARTH.x, EARTH.y, EARTH.r + 12, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
  for (const s of shots) { if (s.kind === 'missile') { ctx.fillStyle = P.hullL; ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 1, 3, 2); ctx.fillStyle = P.amber; ctx.fillRect(Math.round(s.x) - 2, Math.round(s.y), 1, 1); continue; } const ang = Math.atan2(s.ty - s.y, s.tx - s.x); ctx.strokeStyle = s.color; ctx.lineWidth = s.kind === 'rail' ? 2 : 1; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - Math.cos(ang) * s.len, s.y - Math.sin(ang) * s.len); ctx.stroke(); }
  for (const b of beams) { ctx.globalAlpha = b.life / b.max; ctx.strokeStyle = b.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke(); } ctx.globalAlpha = 1;
  for (const p of particles) { ctx.globalAlpha = p.smoke ? (p.life / p.max) * .6 : Math.min(1, p.life / p.max * 2); ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s); } ctx.globalAlpha = 1;
  for (const r of rings) { const k = 1 - r.life / r.max; ctx.globalAlpha = 1 - k; ctx.strokeStyle = r.c; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(r.x, r.y, lerp(r.r0, r.r1, k), 0, TAU); ctx.stroke(); } ctx.globalAlpha = 1;
  if (sim.flash > 0) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = sim.flash; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, VW, VH); ctx.globalAlpha = 1; }
  renderLabels();
}
function renderLabels() {
  lctx.setTransform(DPR, 0, 0, DPR, 0, 0); lctx.clearRect(0, 0, labels.width, labels.height); lctx.font = '600 10px "IBM Plex Mono", monospace'; lctx.textBaseline = 'middle';
  const tag = (x, y, text, color) => { const w = lctx.measureText(text).width + 8; lctx.fillStyle = 'rgba(6,7,13,.85)'; lctx.fillRect(x - w / 2 | 0, y - 8 | 0, w | 0, 15); lctx.fillStyle = color; lctx.fillText(text, (x - w / 2 + 4) | 0, y | 0); };
  for (const h of hostiles) { if (!h.live || h.lod !== 'full' || h.state === 'dying') continue; const s = w2s(h.x, h.y); const show = (hover && hover.h === h) || (selected && selected.h === h) || h.result === 'fail' || sim.t - h.spawnT < 2.5; if (show) tag(s.x, s.y - (h.def.img.height / 2 + 12) * cam.z * SCALE / 2 - 8, h.result === 'fail' ? `${h.id} ✖ ${h.module}` : `${h.id} · ${h.suite}`, h.result === 'fail' ? P.fail : h.def.color); }
  const dots = hostiles.filter(h => h.live && h.lod === 'dot'); if (dots.length) { const s = w2s(295, -138); tag(s.x, s.y, `+${dots.length} evals running`, P.amber); }
  for (const p of pods) if (p.state === 'fly') { const s = w2s(p.x, p.y); tag(s.x, s.y - 16, p.label.length > 28 ? p.label.slice(0, 27) + '…' : p.label, P.fix); }
  if (hover && hover.part) { const pp = partPos(hover.part); const s = w2s(pp.x, pp.y); const p = hover.part; tag(s.x, s.y - 16, `${p.name} ${p.id}${p.module ? ' · ' + p.module : ''} · ${p.dead ? 'DESTROYED' : Math.round(p.hp / p.max * 100) + '%'}`, p.dead ? P.fail : P.white); }
  if (hover && hover.earth) { const s = w2s(EARTH.x, EARTH.y - EARTH.r); tag(s.x, s.y - 12, 'EARTH · fix & module source', '#6fd2ff'); }
  if (hover && hover.ship) { const s = w2s(SHIP.cx, SHIP.oy); tag(s.x, s.y - 18, 'AEGIS · software under test · click for status', P.ally); }
  for (const f of floaters) { const s = w2s(f.x, f.y - (1 - f.life / f.max) * 10); lctx.globalAlpha = Math.min(1, f.life / f.max * 2); lctx.fillStyle = '#000'; lctx.fillText(f.text, s.x + 1 | 0, s.y + 1 | 0); lctx.fillStyle = f.c; lctx.fillText(f.text, s.x | 0, s.y | 0); } lctx.globalAlpha = 1;
}

// ---------------- loop ----------------
let last = performance.now(), acc = 0, earthReady = false;
function frame(now) { requestAnimationFrame(frame); let dt = Math.min(.05, (now - last) / 1000); last = now; if (sim.paused) dt = 0; update(dt); render(); updatePortrait(); }
function update(dt) {
  sim.t += dt; EARTH.rot += dt * .006; EARTH.cloudRot += dt * .009; acc += dt; if (acc > .05 || !earthReady) { renderEarth(); acc = 0; earthReady = true; }
  if (dt <= 0) return;
  for (const h of hostiles) updateHostile(h, dt); if (hostiles.length > 60 || hostiles.some(h => !h.live)) { let w = 0; for (let i = 0; i < hostiles.length; i++) { const h = hostiles[i]; if (h.live || (h.state === 'dying')) hostiles[w++] = h; else if (byId.get(h.id) === h && sim.t - h.spawnT > 120) byId.delete(h.id); } if (w !== hostiles.length) { hostiles.length = w; threatsDirty = true; } }
  updateShots(dt); updateBeams(dt); updateDefense(dt); updatePods(dt);
  const st = shipStats(); if (SHIP.shieldMax > 0 && SHIP.shield < SHIP.shieldMax && !hostiles.some(h => h.live && h.tether)) SHIP.shield = Math.min(SHIP.shieldMax, SHIP.shield + dt * (6 + 10 * st.power + sim.rules * 2) * (SHIP.applied.capacitor === true ? 1.6 : 1)); if (SHIP.shield > SHIP.shieldMax) SHIP.shield = SHIP.shieldMax;
  for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .96; p.vy *= .96; if (p.life <= 0) particles.splice(i, 1); } if (particles.length > 900) particles.splice(0, particles.length - 900);
  for (let i = rings.length - 1; i >= 0; i--) { rings[i].life -= dt; if (rings[i].life <= 0) rings.splice(i, 1); } for (let i = floaters.length - 1; i >= 0; i--) { floaters[i].life -= dt; if (floaters[i].life <= 0) floaters.splice(i, 1); }
  sim.shake = Math.max(0, sim.shake - dt * 14); sim.flash = Math.max(0, sim.flash - dt * 2); sim.healPulse = Math.max(0, sim.healPulse - dt * .8);
  if (shieldAgg.n && sim.t - shieldAgg.last > 1.2) { log('info', 'fail', `Harness shield absorbed <b>${shieldAgg.n} hit${shieldAgg.n > 1 ? 's' : ''}</b> (−${Math.round(shieldAgg.dmg)}). ${Math.round(SHIP.shield / Math.max(1, SHIP.shieldMax) * 100)}% left.`, true); shieldAgg.n = 0; shieldAgg.dmg = 0; }
  updateCamera(dt); setCondition(); updateHud();
}
function updateBeams(dt) { for (let i = beams.length - 1; i >= 0; i--) { beams[i].life -= dt; if (beams[i].life <= 0) beams.splice(i, 1); } }

// ---------------- HUD ----------------
const el = {}; for (const id of ['m-hull', 'v-hull', 'm-shield', 'v-shield', 'v-rules', 'v-level', 'v-total', 'v-pass', 'v-fail', 'v-open', 'v-rate', 'v-cond', 'v-clock', 'logbody', 'log-n', 'insp-body', 'insp-title', 'threats', 'threats-empty', 't-active', 't-fail', 's-flight', 's-f', 's-a', 's-p', 's-fn', 's-an', 's-pn', 'fixlist', 'fix-empty', 'f-open', 'log-pz']) el[id] = document.getElementById(id);
let hudT = -1, threatsDirty = true, threatsT = -1;
function updateHud() { if (sim.t - hudT < .12 && hudT >= 0) return; hudT = sim.t; const st = shipStats(); el['m-hull'].style.width = (st.hull * 100) + '%'; el['v-hull'].textContent = Math.round(st.hull * 100) + '%'; el['m-hull'].style.background = st.hull > .5 ? 'var(--pass)' : st.hull > .25 ? 'var(--warn)' : 'var(--fail)'; el['m-shield'].style.width = (st.shieldPct * 100) + '%'; el['v-shield'].textContent = Math.round(st.shieldPct * 100) + '%';
  el['v-rules'].textContent = sim.rules; el['v-level'].textContent = 1 + Math.floor(sim.rules / 3); el['v-total'].textContent = sim.total; el['v-pass'].textContent = sim.pass; el['v-fail'].textContent = sim.fail; const open = [...fixes.values()].filter(f => f.status !== 'merged' && f.status !== 'rule').length; el['v-open'].textContent = open; el['f-open'].textContent = open;
  while (sim.rateBuf.length && sim.t - sim.rateBuf[0] > 5) sim.rateBuf.shift(); el['v-rate'].textContent = (sim.rateBuf.length / 5).toFixed(1); const s = sim.t | 0; el['v-clock'].textContent = `T+${pad2((s / 60) | 0)}:${pad2(s % 60)}`;
  if (threatsDirty || sim.t - threatsT > .5) renderThreats(); if (selected && selected.h) refreshInspector(true); }
function renderThreats() { threatsDirty = false; threatsT = sim.t; const live = hostiles.filter(h => h.live); const fails = live.filter(h => h.result === 'fail'), run = live.filter(h => h.result === null); el['t-active'].textContent = live.length; el['t-fail'].textContent = fails.length; el['s-flight'].textContent = live.length; el['s-fn'].textContent = fails.length; el['s-an'].textContent = run.length; el['s-pn'].textContent = sim.pass; const tot = Math.max(1, sim.total); el['s-f'].style.width = (sim.fail / tot * 100) + '%'; el['s-a'].style.width = (run.length / tot * 100) + '%'; el['s-p'].style.width = (sim.pass / tot * 100) + '%';
  el['threats-empty'].style.display = live.length ? 'none' : ''; const rows = [...fails.sort((a, b) => b.spawnT - a.spawnT), ...live.filter(h => h.result === null && h.lod === 'full'), ...live.filter(h => h.result === null && h.lod === 'dot').slice(0, 20)].slice(0, 60);
  el['threats'].innerHTML = rows.map(h => `<li class="${h.result === 'fail' ? (h.fixId ? 'fixing' : 'fail') : h.lod === 'dot' ? 'dot' : 'run'}${selected && selected.h === h ? ' sel' : ''}" data-id="${esc(h.id)}"><span class="dot"></span><span class="nm">${esc(h.id)}<small>${esc(h.name)}</small></span><span class="st">${h.result === 'fail' ? (h.fixId ? 'FIXING' : 'FAILED') : h.lod === 'dot' ? 'QUEUED' : h.state === 'warp' ? 'WARP' : 'RUNNING'}</span></li>`).join('') + (live.length > rows.length ? `<li class="more">+${live.length - rows.length} more in flight</li>` : ''); }
el['threats'].addEventListener('click', e => { const li = e.target.closest('li[data-id]'); if (!li) return; const h = byId.get(li.dataset.id); if (!h) return; if (h.lod === 'dot') promote(h); selected = { h }; sfx.ui(); refreshInspector(); threatsDirty = true; });
function setCondition() { const fails = hostiles.filter(h => h.live && h.result === 'fail').length, live = hostiles.filter(h => h.live).length; const st = shipStats(); const c = live === 0 && fails === 0 ? 'green' : (fails >= 3 || st.hull < .5 || SHIP.shield <= 0) ? 'red' : fails > 0 ? 'yellow' : 'green'; if (c === sim.cond) return; sim.cond = c; el['v-cond'].className = 'chip ' + c; el['v-cond'].textContent = `CONDITION ${c.toUpperCase()}`; document.body.classList.toggle('red', c === 'red');
  if (c === 'red') { sfx.alert(); showAlert('RED ALERT', fails >= 3 ? `${fails} failures open.` : SHIP.shield <= 0 ? 'Harness shield down.' : 'Hull integrity critical.'); log('fail', 'fail', '<b>Condition RED.</b>'); } else if (c === 'green') { log('pass', 'rule', 'Condition GREEN. Board clear.'); bus.emit('clear'); } }
let alertT = null; function showAlert(title, msg) { $('#alert-title').textContent = title; $('#alert-msg').textContent = msg; const pop = $('#alert'); pop.classList.remove('show'); void pop.offsetWidth; pop.classList.add('show'); clearTimeout(alertT); alertT = setTimeout(() => pop.classList.remove('show'), 2400); }

// log: aggregation + pause-on-hover + filters
const LOG_ICO = { info: 'info-box', pass: 'check', fail: 'warning-box', warn: 'alert', fix: 'reload', rule: 'lightbulb-on', heal: 'heart' }; let logN = 0, logFilter = 'all', logPaused = false, lastAgg = null; const logQueue = [];
function log(level, cat, html, aggregate = false) {
  const s = sim.t | 0; const ts = `${pad2((s / 60) | 0)}:${pad2(s % 60)}`; logN++; el['log-n'].textContent = logN; bus.emit('log', { level, cat, html });
  if (aggregate && lastAgg && lastAgg.level === level && lastAgg.cat === cat && sim.t - lastAgg.t < 1.5 && lastAgg.el.isConnected) { lastAgg.n++; lastAgg.el.querySelector('.msg').innerHTML = `${html} <span class="cnt">×${lastAgg.n} in the last second</span>`; lastAgg.el.classList.add('agg'); return; }
  const d = document.createElement('div'); d.className = `le l-${level}`; d.dataset.cat = cat; d.innerHTML = `<span class="ts">${ts}</span>${icoSvg(LOG_ICO[level] || 'info-box')}<span class="msg">${html}</span>`; if (logFilter !== 'all' && cat !== logFilter) d.style.display = 'none';
  lastAgg = aggregate ? { level, cat, t: sim.t, n: 1, el: d } : null; if (logPaused) { logQueue.push(d); if (logQueue.length > 500) logQueue.shift(); el['log-pz'].textContent = `PAUSED +${logQueue.length}`; return; } appendLog(d);
}
function appendLog(d) { el['logbody'].appendChild(d); while (el['logbody'].children.length > 400) el['logbody'].firstChild.remove(); el['logbody'].scrollTop = el['logbody'].scrollHeight; }
$('#log').addEventListener('mouseenter', () => { logPaused = true; $('#log').classList.add('paused'); el['log-pz'].textContent = 'PAUSED'; });
$('#log').addEventListener('mouseleave', () => { logPaused = false; $('#log').classList.remove('paused'); logQueue.forEach(appendLog); logQueue.length = 0; el['log-pz'].textContent = 'LIVE'; });
$$('#log [data-f]').forEach(b => b.onclick = () => { $$('#log [data-f]').forEach(x => x.classList.toggle('on', x === b)); logFilter = b.dataset.f; $$('#logbody .le').forEach(x => x.style.display = logFilter === 'all' || x.dataset.cat === logFilter ? '' : 'none'); el['logbody'].scrollTop = el['logbody'].scrollHeight; });
$('#b-clearlog').onclick = () => { el['logbody'].innerHTML = ''; };

// fix lane
function renderFixes() { const list = [...fixes.values()].filter(f => f.status !== 'merged' || document.getElementById('fx-' + f.id)); el['fix-empty'].style.display = list.length ? 'none' : ''; const open = list.filter(f => f.status !== 'rule').length; el['f-open'].textContent = open;
  for (const f of [...fixes.values()]) { let d = document.getElementById('fx-' + f.id); if (f.status === 'merged' && d && d.classList.contains('merged')) continue; if (!d) { d = document.createElement('div'); d.id = 'fx-' + f.id; el['fixlist'].prepend(d); }
    d.className = `fx ${f.status}`; const st = f.status === 'rule' ? 'RULE LEARNED' : f.status === 'broke' ? 'BROKE' : f.status === 'fixing' ? (f.docked ? 'DOCKED · AWAIT MERGE' : 'FIX IN FLIGHT') : 'MERGED'; const pod = f.pod && f.pod.state === 'fly' ? Math.round(Math.min(1, f.pod.t) * 100) : f.status === 'fixing' ? 100 : 0;
    d.innerHTML = `<div class="h"><span>${esc(f.id)} <span class="mod">· ${esc(f.module)}</span></span><span class="st">${st}</span></div>${f.what ? `<div class="what">✖ ${esc(f.what)}</div>` : ''}${f.fix ? `<div class="fix">${f.status === 'rule' ? '◆' : '✚'} ${esc(f.fix)}</div>` : '<div class="mod">harness drafting a fix…</div>'}${f.status === 'fixing' ? `<div class="prog"><i style="width:${pod}%"></i></div>` : ''}`;
    d.onclick = () => { if (f.evalId && byId.get(f.evalId)) { selected = { h: byId.get(f.evalId) }; } else if (f.cell) selected = { part: f.cell }; refreshInspector(); }; } }
setInterval(() => { for (const f of fixes.values()) if (f.status === 'fixing' && f.pod) { const d = document.querySelector('#fx-' + CSS.escape(f.id) + ' .prog i'); if (d) d.style.width = Math.round(Math.min(1, f.pod.t) * 100) + '%'; } }, 200);

// comms
let sayQ = [], sayBusy = false, sayTimer = null; function say(text) { if (sayQ.length > 2) return; sayQ.push(text); if (!sayBusy) nextSay(); }
function nextSay() { const t = sayQ.shift(); if (!t) { sayBusy = false; return; } sayBusy = true; const c = $('#comms-text'); c.textContent = ''; let i = 0; clearInterval(sayTimer); sayTimer = setInterval(() => { c.textContent = t.slice(0, ++i); if (i >= t.length) { clearInterval(sayTimer); setTimeout(nextSay, 1500); } }, 20); bus.emit('say', { text: t }); }
const pctx = $('#portrait').getContext('2d'); function updatePortrait() { const t = sim.t; const red = sim.cond === 'red'; pctx.fillStyle = red ? '#2a0810' : '#061612'; pctx.fillRect(0, 0, 16, 16); pctx.fillStyle = red ? '#4a0f1e' : '#0d2a24'; pctx.fillRect(2, 2, 12, 12); pctx.fillStyle = red ? '#8a1424' : '#16614a'; pctx.fillRect(3, 3, 10, 10); const blink = (t % 3.7) < .12; const talking = sayBusy && ((t * 12) | 0) % 2; pctx.fillStyle = red ? P.fail : '#7fd36b'; if (!blink) { pctx.fillRect(5, 6, 2, 2); pctx.fillRect(9, 6, 2, 2); } else { pctx.fillRect(5, 7, 2, 1); pctx.fillRect(9, 7, 2, 1); } pctx.fillStyle = red ? P.amber : P.ally; pctx.fillRect(5, talking ? 10 : 11, 6, talking ? 2 : 1); pctx.fillStyle = '#fff'; pctx.fillRect(((t * 10) | 0) % 10 + 3, 3, 1, 1); }

// inspector
function selectNone() { selected = null; focusTarget = null; refreshInspector(); threatsDirty = true; }
function spriteCanvas(img, scale = 3) { const c = document.createElement('canvas'); c.width = img.width * scale; c.height = img.height * scale; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(img, 0, 0, c.width, c.height); return c; }
function refreshInspector(light) {
  const box = el['insp-body'];
  if (!selected) { el['insp-title'].textContent = 'Inspector'; if (light) return; box.innerHTML = `<p class="note">Click an eval, a hull cell, the ship, or Earth.</p><dl class="kv"><dt>Cells alive</dt><dd>${parts.filter(alive).length}/${parts.length}</dd><dt>Modules mapped</dt><dd>${modules.size}</dd><dt>Evals cleared</dt><dd>${sim.kills}</dd><dt>Pods sent</dt><dd>${sim.pods}</dd></dl>`; return; }
  if (selected.h) { const h = selected.h; el['insp-title'].textContent = h.id; const pct = clamp(h.hp / h.max, 0, 1); const fx = [...fixes.values()].find(f => f.evalId === h.id);
    if (light) { const b = box.querySelector('.bar i'); if (b) b.style.width = (pct * 100) + '%'; const s = box.querySelector('[data-state]'); if (s) s.textContent = (h.result ? h.result.toUpperCase() : h.state.toUpperCase()); return; }
    box.innerHTML = `<div class="ih"></div><div class="bar ${h.result === 'fail' ? 'en' : 'hp'}"><i style="width:${pct * 100}%"></i></div><dl class="kv"><dt>Eval</dt><dd>${esc(h.name)}</dd><dt>Suite</dt><dd>${esc(h.suite)}</dd><dt>Status</dt><dd data-state>${h.result ? h.result.toUpperCase() : h.state.toUpperCase()}</dd><dt>Module</dt><dd>${esc(h.module || '—')}</dd><dt>Threat</dt><dd>${'■'.repeat(h.def.threat)}${'□'.repeat(3 - h.def.threat)}</dd><dt>Damage dealt</dt><dd>${Math.round(h.dmgDealt)}</dd></dl>${h.error ? `<div class="err">${esc(h.error)}</div>` : ''}${fx && fx.fix ? `<div class="fixtxt">✚ ${esc(fx.fix)} <span class="tag">${fx.status}</span></div>` : ''}<p class="note">${h.def.role}</p><div class="btnrow">${h.result === null ? `<button class="ibtn" id="i-pass">${icoSvg('check')}Pass</button><button class="ibtn" id="i-fail">${icoSvg('warning-box')}Fail</button>` : ''}${h.result === 'fail' && (!fx || fx.status === 'broke') ? `<button class="ibtn" id="i-fix">${icoSvg('reload')}Propose fix</button>` : ''}${fx && fx.status === 'fixing' ? `<button class="ibtn" id="i-merge">${icoSvg('check-double')}Merge</button>` : ''}<button class="ibtn" id="i-focus">${icoSvg('bullseye')}${focusTarget === h ? 'Focused' : 'Focus fire'}</button></div>`;
    const head = box.querySelector('.ih'); head.appendChild(spriteCanvas(h.def.img, 3)); head.insertAdjacentHTML('beforeend', `<div><div class="t">${esc(h.def.cls)}</div><div class="s">${esc(h.def.weapons.join(' · '))}</div></div>`);
    const bind = (id, f) => { const b = box.querySelector(id); if (b) b.onclick = f; }; bind('#i-pass', () => trigger('eval.pass', { id: h.id })); bind('#i-fail', () => trigger('eval.fail', { id: h.id })); bind('#i-fix', () => trigger('fix.propose', { evalId: h.id })); bind('#i-merge', () => trigger('fix.merge', { id: fx.id })); bind('#i-focus', () => { focusTarget = focusTarget === h ? null : h; refreshInspector(); }); return; }
  if (selected.part) { const p = selected.part; el['insp-title'].textContent = `${p.name} ${p.id}`; const pct = clamp(p.hp / p.max, 0, 1); if (light) { const b = box.querySelector('.bar i'); if (b) b.style.width = (p.dead ? 100 : pct * 100) + '%'; return; } const m = p.module && modules.get(p.module);
    box.innerHTML = `<div class="ih"></div><div class="bar ${p.dead ? 'en' : 'hp'}"><i style="width:${p.dead ? 100 : pct * 100}%"></i></div><dl class="kv"><dt>Integrity</dt><dd>${p.dead ? 'DESTROYED' : Math.round(pct * 100) + '%'}</dd><dt>Module</dt><dd>${esc(p.module || 'unassigned')}</dd>${m ? `<dt>Fails / passes</dt><dd>${m.fails} / ${m.passes}</dd>` : ''}<dt>Exposed</dt><dd>${exposed(p) ? 'yes' : 'no'}</dd></dl>${m && m.lastError ? `<div class="err">${esc(m.lastError)}</div>` : ''}<p class="note">${p.def.desc}</p><div class="btnrow"><button class="ibtn" id="i-repair" ${p.hp >= p.max ? 'disabled' : ''}>${icoSvg('reload')}Repair pod</button><button class="ibtn" id="i-ship">${icoSvg('ship')}Ship status</button></div>`;
    const head = box.querySelector('.ih'); const c = document.createElement('canvas'); c.width = TS * 6; c.height = TS * 6; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; const tmp = document.createElement('canvas'); tmp.width = TS; tmp.height = TS; drawPart(tmp.getContext('2d'), p, 0, 0, true); x.drawImage(tmp, 0, 0, c.width, c.height); head.appendChild(c); head.insertAdjacentHTML('beforeend', `<div><div class="t">${esc(p.name)}</div><div class="s">cell ${p.c},${p.r} · ${p.max} HP</div></div>`);
    box.querySelector('#i-repair').onclick = () => proposeFix({ module: p.module || p.id, what: 'manual repair', manual: true }); box.querySelector('#i-ship').onclick = () => { selected = { ship: true }; refreshInspector(); }; return; }
  if (selected.ship) { const st = shipStats(); el['insp-title'].textContent = 'AEGIS status'; if (light) return;
    box.innerHTML = `<div class="ih"></div><dl class="kv"><dt>Hull</dt><dd>${Math.round(st.hullHp)}/${st.hullMax}</dd><dt>Harness shield</dt><dd>${Math.round(SHIP.shield)}/${SHIP.shieldMax}</dd><dt>Power</dt><dd>${Math.round(st.power * 100)}%</dd><dt>Turrets</dt><dd>${st.lasers}</dd><dt>Rules</dt><dd>${sim.rules} (Lv ${1 + Math.floor(sim.rules / 3)})</dd></dl><div class="note">Modules</div><div class="cells">${[...modules.values()].map(m => `<button data-pid="${m.part.id}" class="${m.part.dead ? 'dead' : ''}" title="${esc(m.name)}"><span>${esc(m.name).slice(0, 7)}</span><i style="width:${m.part.hp / m.part.max * 100}%"></i></button>`).join('') || '<span class="note">none mapped yet</span>'}</div><div class="note">Upgrades</div><div>${Object.entries(UPGRADES).map(([k, u]) => `<span class="tag" style="${SHIP.applied[k] === true ? 'color:var(--pass)' : ''}">${u.name}${SHIP.applied[k] === true ? ' ✓' : SHIP.applied[k] ? ' …' : ''}</span> `).join('')}</div><div class="btnrow"><button class="ibtn" data-t="heal">${icoSvg('heart')}Heal</button><button class="ibtn" id="i-repairall">${icoSvg('sync')}Repair all</button></div>`;
    const head = box.querySelector('.ih'); head.appendChild(spriteCanvas(shipCan, 1.5)); head.insertAdjacentHTML('beforeend', `<div><div class="t">AEGIS</div><div class="s">software under test</div></div>`); box.querySelectorAll('[data-pid]').forEach(b => b.onclick = () => { selected = { part: parts.find(p => p.id === b.dataset.pid) }; refreshInspector(); }); box.querySelector('#i-repairall').onclick = () => parts.filter(p => p.hp < p.max && !p.queued).forEach((p, i) => setTimeout(() => sendPod({ part: p }), i * 300)); return; }
  if (selected.earth) { el['insp-title'].textContent = 'Earth'; if (light) return; box.innerHTML = `<div class="ih"></div><dl class="kv"><dt>Role</dt><dd>Fix and module source</dd><dt>Pods launched</dt><dd>${sim.pods}</dd><dt>Rules learned</dt><dd>${sim.rules}</dd></dl><p class="note">The harness drafts fixes here and ships them on supply pods. Merged fixes reform the cell they target.</p>`; const head = box.querySelector('.ih'); const c = document.createElement('canvas'); c.width = 48; c.height = 48; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(earthCan, 0, 0, 48, 48); head.appendChild(c); head.insertAdjacentHTML('beforeend', `<div><div class="t">Earth</div><div class="s">home port</div></div>`); }
}
function renderRuleSelect() { const s = $('#sel-rule'); const cur = s.value; s.innerHTML = `<option value="">Generic rule</option>` + Object.entries(UPGRADES).map(([k, u]) => `<option value="${k}" ${SHIP.applied[k] ? 'disabled' : ''}>${u.name}${SHIP.applied[k] === true ? ' ✓' : SHIP.applied[k] ? ' …' : ''}</option>`).join(''); const firstOpen = Object.keys(UPGRADES).find(k => !SHIP.applied[k]); s.value = cur && !SHIP.applied[cur] ? cur : (firstOpen || ''); }

// ---------------- input ----------------
function hitTest(wx, wy) { for (const h of hostiles) { if (!h.live || h.lod !== 'full' || h.state === 'dying') continue; const r = h.def.img.width / 2 + 3; if (Math.abs(wx - h.x) < r && Math.abs(wy - h.y) < r) return { h }; } const c = Math.floor((wx - SHIP.ox) / TS), r = Math.floor((wy - SHIP.oy) / TS); const p = partAt(c, r); if (p) return { part: p }; if (wx > SHIP.ox - 4 && wx < SHIP.ox + SHIP.w + 4 && wy > SHIP.oy - 4 && wy < SHIP.oy + SHIP.h + 4) return { ship: true }; if (dist(wx, wy, EARTH.x, EARTH.y) < EARTH.r + 4) return { earth: true }; return null; }
canvas.addEventListener('mousemove', e => { const w = s2w(e.clientX, e.clientY); const nh = hitTest(w.x, w.y); if ((nh && nh.ship) !== (hover && hover.ship)) SHIP.dirty = true; hover = nh; canvas.classList.toggle('hovering', !!hover); });
canvas.addEventListener('mouseleave', () => { hover = null; });
canvas.addEventListener('click', e => { sfx.ensure(); const w = s2w(e.clientX, e.clientY); const hit = hitTest(w.x, w.y); selected = hit; if (hit) sfx.ui(); refreshInspector(); threatsDirty = true; if (hit) bus.emit('select', { target: hit.h ? hit.h.id : hit.part ? hit.part.id : hit.ship ? 'ship' : 'earth' }); });
$$('[data-collapse]').forEach(b => b.onclick = e => { const w = e.target.closest('.hud'); w.classList.toggle('collapsed'); b.textContent = w.classList.contains('collapsed') ? '+' : '–'; insetCache.at = -1; });
document.addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; sfx.ensure(); sfx.ui(); const t = b.dataset.t; trigger(t, b.dataset.kind ? { kind: b.dataset.kind } : t === 'rule.add' ? { id: $('#sel-rule').value || undefined } : {}); });
$('#b-pause').onclick = () => { sim.paused = !sim.paused; $('#b-pause').innerHTML = icoSvg(sim.paused ? 'play' : 'pause'); };
$('#b-mute').onclick = () => { sfx.ensure(); sfx.muted = !sfx.muted; $('#b-mute').innerHTML = icoSvg(sfx.muted ? 'volume-x' : 'volume-3'); };
$('#b-clean').onclick = () => { document.body.classList.toggle('clean'); insetCache.at = -1; };
$('#b-help').onclick = () => $('#help').classList.toggle('show'); $('#b-help-close').onclick = () => $('#help').classList.remove('show');
$('#b-demo').onclick = () => { sfx.ensure(); trigger('demo'); }; $('#b-stress').onclick = () => { sfx.ensure(); trigger('stress'); };
$('#cb-autofix').onchange = e => { sim.autoFix = e.target.checked; }; $('#cb-autodef').onchange = e => { sim.autoDef = e.target.checked; };
addEventListener('keydown', e => { if (e.target.matches('input,select,textarea')) return; const k = e.key.toLowerCase(); sfx.ensure();
  const map = { '1': ['eval.start', { kind: 'unit' }], '2': ['eval.start', { kind: 'integration' }], '3': ['eval.start', { kind: 'fuzz' }], '4': ['eval.start', { kind: 'e2e' }], a: ['eval.pass'], f: ['eval.fail'], r: ['fix.propose'], g: ['fix.merge'], e: ['heal'], u: ['rule.add', { id: $('#sel-rule').value || undefined }], d: ['demo'], s: ['stress'] };
  if (map[k]) { trigger(...map[k]); e.preventDefault(); } else if (k === 'p') $('#b-pause').click(); else if (k === 'm') $('#b-mute').click(); else if (k === 'h') $('#b-clean').click(); else if (k === 'escape') { selectNone(); $('#help').classList.remove('show'); } });

// ---------------- TRIGGER API ----------------
let demoTimers = [];
function trigger(type, payload = {}) {
  bus.emit('trigger', { trigger: type, payload });
  switch (type) {
    case 'eval.start': case 'spawn': { const n = clamp(payload.count || 1, 1, 2000); if (n === 1) startEval(payload); else for (let i = 0; i < n; i++) setTimeout(() => startEval({ ...payload, id: payload.id ? `${payload.id}-${i}` : undefined }), i * (n > 50 ? 12 : 300)); break; }
    case 'eval.pass': passEval(payload); break;
    case 'eval.fail': failEval(payload); break;
    case 'fix.propose': case 'repair': proposeFix({ ...payload, manual: type === 'repair' ? false : payload.manual }); break;
    case 'fix.merge': mergeFix(payload); break;
    case 'rule.add': case 'upgrade': addRule(payload); break;
    case 'heal': heal(payload); break;
    case 'attack': { hostiles.filter(h => h.live && h.result === 'fail' && h.lod === 'full').forEach((h, i) => setTimeout(() => fireHostile(h), i * 120)); break; }
    case 'damage': { const p = payload.module ? moduleCell(payload.module) : payload.part ? parts.find(x => x.id === payload.part) : pickTargetPart(); applyDamage(p, payload.amount || 30, null, 'external'); break; }
    case 'retreat': hostiles.filter(h => h.live).forEach(h => { if (h.lod === 'full') { h.state = 'retreat'; h.tether = false; } else h.live = false; }); threatsDirty = true; break;
    case 'log': log(payload.level || 'info', payload.cat || 'rule', payload.html || esc(payload.text || '')); break;
    case 'say': say(payload.text || ''); break;
    case 'alert': showAlert(payload.title || 'ALERT', payload.text || ''); sfx.alert(); break;
    case 'reset': resetSim(); break;
    case 'demo': runDemo(); break;
    case 'stress': stress(payload.count || 500); break;
    case 'pause': sim.paused = payload.on ?? !sim.paused; break;
    default: log('warn', 'rule', `Unknown trigger <b>${esc(type)}</b>.`);
  }
}
function resetSim() { demoTimers.forEach(clearTimeout); demoTimers = []; sim.demo = false; $('#v-demo').style.display = 'none'; hudT = -1; insetCache.at = -1; shieldAgg.n = 0; shieldAgg.dmg = 0; hostiles.length = 0; byId.clear(); fixes.clear(); el['fixlist'].querySelectorAll('.fx').forEach(x => x.remove()); shots.length = 0; beams.length = 0; pods.length = 0; particles.length = 0; rings.length = 0; floaters.length = 0; buildShip(); renderShip(); selectNone(); sim.kills = 0; sim.pods = 0; sim.t = 0; sim.rules = 0; sim.total = 0; sim.pass = 0; sim.fail = 0; sim.rateBuf.length = 0; threatsDirty = true; renderFixes(); setCondition(); renderRuleSelect(); log('info', 'rule', 'Reset. AEGIS at full integrity.'); say('Systems reinitialized. Standing by.'); }
function stress(n) { log('info', 'rule', `<b>Stress burst:</b> ${n} evals over 4 s.`); say(`Incoming burst. ${n} evals.`); for (let i = 0; i < n; i++) demoTimers.push(setTimeout(() => { const h = startEval({ suite: pick(SUITES) }); const willFail = rand() < .04; demoTimers.push(setTimeout(() => { if (!h.live) return; if (willFail) failEval({ id: h.id, module: h.suite }); else passEval({ id: h.id }); }, 1500 + rand(5000))); }, i * (4000 / n))); }
function runDemo() {
  if (sim.demo) { demoTimers.forEach(clearTimeout); demoTimers = []; sim.demo = false; $('#v-demo').style.display = 'none'; log('info', 'rule', 'Demo stopped.'); return; }
  sim.demo = true; $('#v-demo').style.display = ''; log('info', 'rule', '<b>Demo:</b> a harness run, ~80 s.'); const at = (d, f) => demoTimers.push(setTimeout(() => { if (sim.demo) f(); }, d * 1000));
  at(0, () => say('Harness run starting. Evals inbound.')); at(1, () => trigger('eval.start', { kind: 'unit', suite: 'auth', name: 'auth/login refresh' })); at(2.5, () => trigger('eval.start', { kind: 'unit', suite: 'db', name: 'db/write txn' })); at(5, () => trigger('eval.pass')); at(6.5, () => trigger('eval.pass'));
  at(8, () => trigger('eval.start', { kind: 'integration', suite: 'api', name: 'api/order flow', id: 't-api-1' })); at(13, () => trigger('eval.fail', { id: 't-api-1', module: 'api', error: 'AssertionError: expected 200 got 500 (/orders)' }));
  at(20, () => trigger('eval.start', { count: 40, kind: 'unit' })); at(27, () => { for (let i = 0; i < 36; i++) demoTimers.push(setTimeout(() => trigger('eval.pass'), i * 150)); });
  at(30, () => trigger('eval.start', { kind: 'fuzz', suite: 'memory', name: 'memory/recall fuzz', id: 't-mem-1' })); at(34, () => trigger('eval.fail', { id: 't-mem-1', module: 'memory', error: 'StaleMemory: recalled fact from 3 sessions ago' }));
  at(36, () => trigger('rule.add', { name: 'Expire memory facts after 2 sessions', id: 'capacitor' })); at(42, () => trigger('eval.start', { kind: 'e2e', suite: 'planner', name: 'planner/long-horizon e2e', id: 't-e2e-1' })); at(48, () => trigger('eval.fail', { id: 't-e2e-1', module: 'planner', error: 'ContextOverflow: 212k tokens > 200k limit' }));
  at(52, () => trigger('rule.add', { name: 'Summarize context at 150k', id: 'flank' })); at(58, () => trigger('heal', { amount: 80 })); at(62, () => trigger('stress', { count: 300 })); at(70, () => trigger('rule.add', { name: 'Escalate after 3 failures', id: 'core' })); at(76, () => trigger('rule.add', { name: 'Pin provider version', id: 'bow' }));
  at(82, () => { sim.demo = false; $('#v-demo').style.display = 'none'; log('pass', 'rule', 'Demo complete.'); say('Run complete. Harness level up. Awaiting live triggers.'); });
}
window.AEGIS = { trigger, on: (t, f) => bus.on(t, f), step: (sec = 1) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) update(1 / 60); render(); updatePortrait(); return sim.t; }, screen: (x, y) => w2s(x, y), kinds: Object.keys(KIND_DEF), upgrades: Object.keys(UPGRADES),
  state: () => ({ t: sim.t, cond: sim.cond, ship: shipStats(), shield: SHIP.shield, rules: sim.rules, total: sim.total, pass: sim.pass, fail: sim.fail, hostiles: hostiles.filter(h => h.live).map(h => ({ id: h.id, kind: h.kind, hp: h.hp, state: h.state, result: h.result, lod: h.lod, x: Math.round(h.x), y: Math.round(h.y) })), parts: parts.map(p => ({ id: p.id, type: p.type, hp: p.hp, max: p.max, dead: p.dead, module: p.module })), fixes: [...fixes.values()].map(f => ({ id: f.id, module: f.module, status: f.status, fix: f.fix })), upgrades: { ...SHIP.applied } }) };
try { const bc = new BroadcastChannel('aegis'); bc.onmessage = e => { const m = e.data || {}; if (m.type) trigger(m.type, m.payload || {}); }; bus.on('*', ev => { try { bc.postMessage({ event: ev }); } catch (_) { } }); } catch (_) { }
addEventListener('message', e => { const m = e.data; if (m && m.aegis && m.type) trigger(m.type, m.payload || {}); });
const wsUrl = new URLSearchParams(location.search).get('ws'); if (wsUrl) { try { const ws = new WebSocket(wsUrl); ws.onopen = () => log('pass', 'rule', `WebSocket linked: ${esc(wsUrl)}`); ws.onmessage = e => { try { const m = JSON.parse(e.data); if (m.type) trigger(m.type, m.payload || {}); } catch (_) { } }; ws.onerror = () => log('warn', 'rule', 'WebSocket error.'); bus.on('*', ev => { if (ws.readyState === 1) ws.send(JSON.stringify(ev)); }); } catch (_) { log('warn', 'rule', 'WebSocket URL invalid.'); } }

// ---------------- boot ----------------
resize(); buildShip(); renderShip(); renderEarth(); earthReady = true; renderRuleSelect(); refreshInspector(); renderFixes();
log('info', 'rule', 'AEGIS harness monitor online. Evals attack, fixes reform, rules strengthen the shield.'); log('info', 'rule', 'Press <b>D</b> for a demo run, <b>S</b> for a 500-eval stress burst, <b>H</b> to hide panels.'); say('MIRA online. Harness shield green. Earth link up.');
requestAnimationFrame(frame);
})();
