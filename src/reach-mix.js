// Reach's mixing core: colour conversion, the two-constant Kubelka–Munk mix, the gamut grid and nearest-mix lookup.
// Shared by the page (window.ReachMix) and the Node tests and calibration (require("./mix.js")).
"use strict";
(function (root) {
// ---------- colour ----------
const toLin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const toByte = x => { x = x < 0 ? 0 : x > 1 ? 1 : x; return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)); };
const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) LIN[i] = toLin(i);
function oklab(r, g, b, out, o) { // linear sRGB in
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  out[o] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  out[o + 1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  out[o + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
}
function fromOklab(L, a, b) { // -> sRGB bytes
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [toByte(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toByte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toByte(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)];
}
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const css = (r, g, b) => `rgb(${r},${g},${b})`;

// Two-constant Kubelka–Munk, ported from claude-paint (crates/paint/src/pigment.rs) so a tube means the same
// thing in both: each tube's scattering S per coat comes from its hiding (contrast ratio of one coat, `scatter_for`),
// its absorption is K = S·K/S(masstone) per channel, and a pile sums K and S by parts × tinting strength
// (the concentration model of claude-paint's notes/spectral.md and notes/tints.md).
const ksOfR = r => { r = Math.min(0.995, Math.max(0.002, r)); return (1 - r) * (1 - r) / (2 * r); };
const fromKS = k => 1 + k - Math.sqrt(k * k + 2 * k);
// reflectance and transmittance of one channel of a layer: absorption k, scattering s per coat, x coats
function layer1(k, s, x) {
  if (s < 1e-6) return [0, Math.exp(-k * x)];
  const a = 1 + k / s, b = Math.sqrt(Math.max(0, a * a - 1));
  if (b < 1e-3) { const sx = s * x; return [sx / (1 + a * sx), 1 / (1 + a * sx)]; }
  const bsx = Math.min(b * s * x, 40), sh = Math.sinh(bsx), ch = Math.cosh(bsx), c = a * sh + b * ch;
  return [sh / c, b / c];
}
function hidingOf(r, s) { // one coat over black ÷ over white
  const [rr, t] = layer1(s * ksOfR(r), s, 1);
  return Math.min(1, Math.max(0, rr / Math.max(1e-6, rr + t * t / Math.max(1e-6, 1 - rr))));
}
function scatterFor(r, hiding) { // inverse of hidingOf, by bisection on ln s
  const h = Math.min(0.9995, Math.max(1e-4, hiding));
  let lo = -9, hi = 9;
  for (let i = 0; i < 40; i++) { const mid = 0.5 * (lo + hi); if (hidingOf(r, Math.exp(mid)) < h) lo = mid; else hi = mid; }
  return Math.exp(0.5 * (lo + hi));
}
// a tube's K (per channel) and S, cached on the tube
function ksOf(t) {
  if (!t._K) {
    const lin = hexRgb(t.hex).map(toLin);
    t._S = scatterFor(0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2], t.hiding);
    t._K = lin.map(c => t._S * ksOfR(c));
  }
  return t._K;
}

const gcd = (a, b) => b ? gcd(b, a % b) : a;

// ---------- gamut grid in OKLab ----------
const CELL = 1 / 64, AMIN = -0.32, NL = 65, NA = 41, NB = 41, NCELL = NL * NA * NB;
const cellOf = (L, a, b) => {
  let i = Math.round(L / CELL), j = Math.round((a - AMIN) / CELL), k = Math.round((b - AMIN) / CELL);
  i = i < 0 ? 0 : i >= NL ? NL - 1 : i; j = j < 0 ? 0 : j >= NA ? NA - 1 : j; k = k < 0 ? 0 : k >= NB ? NB - 1 : k;
  return (i * NA + j) * NB + k;
};

// Every mix of up to three colour tubes plus a white, in simple part ratios.
const SINGLE = [[1,0],[1,1],[1,2],[1,3],[1,4],[1,6],[1,8],[1,12],[1,16],[1,24],[1,32],[1,48],[1,64],[1,96],[1,128],[1,192],[1,256],[2,1],[3,1],[4,1],[6,1],[8,1]];
// Ratio lists: denser for small boxes (a box of four can afford every ratio; a box of thirty cannot).
const ratioPairs = m => { const out = []; for (let a = 1; a <= m; a++) for (let b = 1; b <= m; b++) if (gcd(a, b) === 1) out.push([a, b]); return out; };
const triples = parts => { const out = []; for (const a of parts) for (const b of parts) for (const c of parts) if (gcd(gcd(a, b), c) === 1) out.push([a, b, c]); return out; };
const DENSITY = [
  { upTo: 8, PAIR: ratioPairs(8), PAIRW: [0,1,2,3,4,6,8,12,16,24,32,48,64,96,128,192,256], TRIPLE: triples([1,2,3,4,6]), TRIW: [0,1,2,4,8,16,32,64,128,256] },
  { upTo: 16, PAIR: [[8,1],[4,1],[2,1],[3,2],[1,1],[2,3],[1,2],[1,4],[1,8]], PAIRW: [0,1,2,4,8,16,32,64,128,256], TRIPLE: triples([1,2,4]), TRIW: [0,1,3,9,27,81,243] },
  { upTo: Infinity, PAIR: [[8,1],[4,1],[2,1],[1,1],[1,2],[1,4],[1,8]], PAIRW: [0,1,2,4,8,16,32,64,128,256], TRIPLE: triples([1,2,4]), TRIW: [0,1,4,16,64,256] },
];
const isWhite = t => /white/i.test(t.name);

// One pile: tubes and parts by volume -> linear RGB (the pile's masstone, R∞ of the mixed K/S).
function mixLinear(ts, ps) {
  let k0 = 0, k1 = 0, k2 = 0, sum = 0;
  for (let i = 0; i < ts.length; i++) {
    if (!ps[i]) continue;
    const w = ps[i] * ts[i].strength, K = ksOf(ts[i]);
    k0 += w * K[0]; k1 += w * K[1]; k2 += w * K[2]; sum += w * ts[i]._S;
  }
  return [fromKS(k0 / sum), fromKS(k1 / sum), fromKS(k2 / sum)];
}

// Calls emit(lab0,lab1,lab2, r,g,b, tubes[], parts[]) for every mix. `must` (optional) restricts to mixes holding that tube.
// `recolour` (optional, calibration only) replaces the Kubelka–Munk colour: (tubes, parts) -> linear [r, g, b].
function enumerate(tubeList, emit, must, recolour) {
  const whites = tubeList.filter(isWhite), cols = tubeList.filter(t => !isWhite(t));
  const wlist = whites.length ? whites : [null];
  const lab = new Float32Array(3);
  const mix = (ts, ps) => {
    const [r, g, b] = (recolour || mixLinear)(ts, ps);
    oklab(r, g, b, lab, 0);
    emit(lab[0], lab[1], lab[2], r, g, b, ts, ps);
  };
  for (const w of whites) if (!must || must === w) mix([w], [1]);
  const n = cols.length, { PAIR, PAIRW, TRIPLE, TRIW } = DENSITY.find(d => n <= d.upTo);
  for (let i = 0; i < n; i++) {
    for (const W of wlist) {
      const a = cols[i];
      if (must && must !== a && must !== W) continue;
      for (const [c, wp] of SINGLE) if (W || !wp) mix(W ? [a, W] : [a], W ? [c, wp] : [c]);
    }
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (const W of wlist) {
    const a = cols[i], b = cols[j];
    if (must && must !== a && must !== b && must !== W) continue;
    for (const [pa, pb] of PAIR) for (const wp of PAIRW) {
      if (!W && wp) continue;
      mix(W ? [a, b, W] : [a, b], W ? [pa, pb, wp] : [pa, pb]);
    }
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) for (const W of wlist) {
    const a = cols[i], b = cols[j], c = cols[k];
    if (must && must !== a && must !== b && must !== c && must !== W) continue;
    for (const [pa, pb, pc] of TRIPLE) for (const wp of TRIW) {
      if (!W && wp) continue;
      mix(W ? [a, b, c, W] : [a, b, c], W ? [pa, pb, pc, wp] : [pa, pb, pc]);
    }
  }
}

// Build: per occupied cell the simplest mix that lands there; then a nearest-occupied-cell field.
function buildGamut(tubeList, recolour) {
  const cost = new Float32Array(NCELL).fill(Infinity);
  const owner = new Int32Array(NCELL).fill(-1);
  const mixes = []; // {lab:[3], rgb:[3], tubes, parts}
  let count = 0;
  enumerate(tubeList, (L, a, b, r, g, bl, ts, ps) => {
    count++;
    let n = 0, tot = 0; for (const p of ps) if (p) { n++; tot += p; }
    const c = cellOf(L, a, b), score = n * 1000 + tot;
    if (score >= cost[c]) return;
    cost[c] = score;
    const m = { lab: [L, a, b], rgb: [toByte(r), toByte(g), toByte(bl)], tubes: ts.slice(), parts: ps.slice() };
    if (owner[c] < 0) { owner[c] = mixes.length; mixes.push(m); } else mixes[owner[c]] = m;
  }, null, recolour);
  // multi-source BFS: nearest[c] = index of a mix in a nearby occupied cell
  const nearest = new Int32Array(NCELL).fill(-1), q = new Int32Array(NCELL);
  let h = 0, t = 0;
  for (let c = 0; c < NCELL; c++) if (owner[c] >= 0) { nearest[c] = owner[c]; q[t++] = c; }
  while (h < t) {
    const c = q[h++], k = c % NB, j = ((c - k) / NB) % NA, i = Math.floor(c / (NA * NB));
    const nb = [i > 0 ? c - NA * NB : -1, i < NL - 1 ? c + NA * NB : -1, j > 0 ? c - NB : -1, j < NA - 1 ? c + NB : -1, k > 0 ? c - 1 : -1, k < NB - 1 ? c + 1 : -1];
    for (const d of nb) if (d >= 0 && nearest[d] < 0) { nearest[d] = nearest[c]; q[t++] = d; }
  }
  // BFS spreads along grid steps, so far from the gamut its pick drifts from the true nearest.
  // Jump-flood refinement: each cell takes any neighbour's pick (at 8, 4, 2, 1, 1 cells) that is closer to its centre.
  const ML = new Float32Array(mixes.length * 3);
  mixes.forEach((m, i) => { ML[i * 3] = m.lab[0]; ML[i * 3 + 1] = m.lab[1]; ML[i * 3 + 2] = m.lab[2]; });
  for (const step of [8, 4, 2, 1, 1]) {
    for (let i = 0; i < NL; i++) for (let j = 0; j < NA; j++) for (let k = 0; k < NB; k++) {
      const c = (i * NA + j) * NB + k, L = i * CELL, A = AMIN + j * CELL, B = AMIN + k * CELL;
      let best = nearest[c], bd = (ML[best * 3] - L) ** 2 + (ML[best * 3 + 1] - A) ** 2 + (ML[best * 3 + 2] - B) ** 2;
      for (let di = -step; di <= step; di += step) for (let dj = -step; dj <= step; dj += step) for (let dk = -step; dk <= step; dk += step) {
        const ii = i + di, jj = j + dj, kk = k + dk;
        if (ii < 0 || jj < 0 || kk < 0 || ii >= NL || jj >= NA || kk >= NB) continue;
        const m = nearest[(ii * NA + jj) * NB + kk];
        if (m === best) continue;
        const d = (ML[m * 3] - L) ** 2 + (ML[m * 3 + 1] - A) ** 2 + (ML[m * 3 + 2] - B) ** 2;
        if (d < bd) { bd = d; best = m; }
      }
      nearest[c] = best;
    }
  }
  let Lmin = 1, Lmax = 0; for (const m of mixes) { Lmin = Math.min(Lmin, m.lab[0]); Lmax = Math.max(Lmax, m.lab[0]); }
  return { mixes, nearest, count, Lmin, Lmax };
}

function nearestMix(G, L, a, b) {
  const c = cellOf(L, a, b), k = c % NB, j = ((c - k) / NB) % NA, i = Math.floor(c / (NA * NB));
  let best = -1, bd = Infinity;
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
    const ii = i + di, jj = j + dj, kk = k + dk;
    if (ii < 0 || jj < 0 || kk < 0 || ii >= NL || jj >= NA || kk >= NB) continue;
    const m = G.nearest[(ii * NA + jj) * NB + kk]; if (m < 0) continue;
    const l = G.mixes[m].lab, d = (l[0] - L) ** 2 + (l[1] - a) ** 2 + (l[2] - b) ** 2;
    if (d < bd) { bd = d; best = m; }
  }
  return [best, Math.sqrt(bd) * 100];
}

// How many out-of-reach pixels one more tube would bring within `tol` (OKLab, not ×100).
// `outs`: [[L, a, b, pixelCount], ...] for the colours now out of reach. Only mixes holding `extra` are new.
function tubeGain(base, extra, outs, tol) {
  const pts = [];
  enumerate(base.concat([extra]), (L, a, b) => pts.push(L, a, b), extra);
  // bucket the new mixes on a grid with cell = tol, so each colour checks its 27 neighbouring buckets
  const buckets = new Map(), key = (i, j, k) => i * 1e6 + j * 1e3 + k, ix = v => Math.floor((v + 1) / tol);
  for (let i = 0; i < pts.length; i += 3) { const k = key(ix(pts[i]), ix(pts[i + 1]), ix(pts[i + 2])); let arr = buckets.get(k); if (!arr) buckets.set(k, arr = []); arr.push(i); }
  let gained = 0;
  for (const [L, a, b, c] of outs) {
    const bl = ix(L), ba = ix(a), bb = ix(b);
    let hit = false;
    for (let di = -1; di <= 1 && !hit; di++) for (let dj = -1; dj <= 1 && !hit; dj++) for (let dk = -1; dk <= 1 && !hit; dk++) {
      const arr = buckets.get(key(bl + di, ba + dj, bb + dk)); if (!arr) continue;
      for (const i of arr) if ((pts[i] - L) ** 2 + (pts[i + 1] - a) ** 2 + (pts[i + 2] - b) ** 2 <= tol * tol) { hit = true; break; }
    }
    if (hit) gained += c;
  }
  return gained;
}

const ReachMix = { scatterFor, hidingOf, mixLinear, tubeGain, toLin, toByte, LIN, oklab, fromOklab, hexRgb, css, ksOf, fromKS, gcd, CELL, AMIN, NL, NA, NB, NCELL, cellOf, SINGLE, ratioPairs, triples, DENSITY, isWhite, enumerate, buildGamut, nearestMix };
if (typeof module !== "undefined" && module.exports) module.exports = ReachMix; else root.ReachMix = ReachMix;
})(typeof window !== "undefined" ? window : globalThis);
