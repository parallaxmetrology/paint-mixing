// Value Plan: squint at a reference, cut it into a few value masses, and name a pile for each.
// Pure analysis, no DOM. Shared by the page (window.Plan) and the Node tests (require("./plan.js")).
// Colour maths comes from Touch of Paint's copies of reach-mix.js and steer.js (unchanged).
"use strict";
(function (root) {
const RM = typeof module !== "undefined" && module.exports ? require("./reach-mix.js") : root.ReachMix;
const S = typeof module !== "undefined" && module.exports ? require("./steer.js") : root.Steer;
const SP = typeof module !== "undefined" && module.exports ? require("./spectral.js") : root.Spectral;

// ---------- pixels ----------
// RGBA bytes -> three Float32Arrays of OKLab (L, a, b).
function toLab(rgba, n) {
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n), o = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    RM.oklab(RM.LIN[rgba[4 * i]], RM.LIN[rgba[4 * i + 1]], RM.LIN[rgba[4 * i + 2]], o, 0);
    L[i] = o[0]; A[i] = o[1]; B[i] = o[2];
  }
  return { L, A, B };
}

// Squinting: a separable box blur, run three times (close to a Gaussian). r in pixels of the analysis image.
function blur1(src, w, h, r) {
  if (r < 1) return src.slice();
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    let s = 0, row = y * w;
    for (let x = -r; x <= r; x++) s += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / (2 * r + 1);
      s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / (2 * r + 1);
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}
function squint(lab, w, h, r) {
  const k = Math.round(r / 1.7); // three passes of radius k ≈ a Gaussian of sigma r
  const go = ch => { let c = ch; for (let i = 0; i < 3; i++) c = blur1(c, w, h, k); return c; };
  return { L: go(lab.L), A: go(lab.A), B: go(lab.B) };
}

// ---------- values ----------
// 1-D k-means on lightness, started at evenly spaced quantiles. Returns the band centres, light to dark,
// and the cuts between them (midpoints), dark to light.
function valueCuts(L, k) {
  const sorted = Float32Array.from(L).sort(), n = sorted.length;
  let c = Array.from({ length: k }, (_, i) => sorted[Math.min(n - 1, Math.floor((i + .5) / k * n))]);
  const hist = new Float64Array(256), sum = new Float64Array(256); // bin for speed: L in 0..1 at 1/255
  for (let i = 0; i < n; i++) { const b = Math.min(255, Math.max(0, Math.round(sorted[i] * 255))); hist[b]++; sum[b] += sorted[i]; }
  for (let it = 0; it < 60; it++) {
    const cuts = cutsOf(c), s = new Float64Array(k), m = new Float64Array(k);
    for (let b = 0; b < 256; b++) if (hist[b]) { const j = bandOf(b / 255, cuts); s[j] += sum[b]; m[j] += hist[b]; }
    const next = c.map((v, j) => m[j] ? s[j] / m[j] : v);
    if (next.every((v, j) => Math.abs(v - c[j]) < 1e-5)) { c = next; break; }
    c = next;
  }
  return cutsOf(c);
}
function cutsOf(centres) { const c = centres.slice().sort((a, b) => a - b); return c.slice(1).map((v, i) => (v + c[i]) / 2); }
// Band index for a lightness: 0 = the darkest band. cuts ascend.
function bandOf(l, cuts) { let j = 0; while (j < cuts.length && l >= cuts[j]) j++; return j; }

// A painter's number: about Munsell value (0 black … 10 white). OKLab L is close to the cube root of luminance,
// so CIE L* ≈ 116 L − 16 and Munsell ≈ L* / 10. Good to half a step, which is all a value plan needs.
const munsell = L => Math.max(0, Math.min(10, (116 * L - 16) / 10));
const valueWords = L => L < .3 ? "very dark" : L < .45 ? "dark" : L < .6 ? "mid-dark" : L < .72 ? "middle" : L < .84 ? "light" : "very light";

// ---------- masses ----------
// Within each value band, split by colour (k-means on a/b, up to `perBand`), then fold clusters that are close
// in colour, or too small to plan a pile for, into their nearest neighbour in the same band.
const MERGE = .045;  // OKLab distance under which two masses are one pile
const MIN_AREA = .015; // a mass smaller than this share of the picture gets no pile of its own
function masses(lab, cuts, opts = {}) {
  const perBand = opts.perBand ?? 3, n = lab.L.length, bands = cuts.length + 1;
  const band = new Uint8Array(n);
  for (let i = 0; i < n; i++) band[i] = bandOf(lab.L[i], cuts);
  const label = new Int16Array(n).fill(-1), out = [];
  for (let b = 0; b < bands; b++) {
    const idx = []; for (let i = 0; i < n; i++) if (band[i] === b) idx.push(i);
    if (!idx.length) continue;
    // farthest-point start on a/b, then Lloyd iterations
    let cs = [mean(lab, idx)];
    while (cs.length < perBand) {
      let far = -1, fd = 0;
      for (let t = 0; t < idx.length; t += 7) { const i = idx[t], d = Math.min(...cs.map(c => abDist(lab, i, c))); if (d > fd) { fd = d; far = i; } }
      if (far < 0 || fd < MERGE) break;
      cs.push([lab.L[far], lab.A[far], lab.B[far]]);
    }
    let own = new Int8Array(idx.length);
    for (let it = 0; it < 20; it++) {
      idx.forEach((i, t) => { let bj = 0, bd = Infinity; cs.forEach((c, j) => { const d = abDist(lab, i, c); if (d < bd) { bd = d; bj = j; } }); own[t] = bj; });
      cs = cs.map((c, j) => { const m = idx.filter((_, t) => own[t] === j); return m.length ? mean(lab, m) : c; });
    }
    let groups = cs.map((c, j) => ({ lab: c, idx: idx.filter((_, t) => own[t] === j) })).filter(g => g.idx.length);
    // merge close or small groups, smallest first
    for (let changed = true; changed && groups.length > 1;) {
      changed = false;
      groups.sort((p, q) => p.idx.length - q.idx.length);
      for (let g = 0; g < groups.length && !changed; g++) {
        const G = groups[g]; let near = -1, nd = Infinity;
        groups.forEach((H, h) => { if (h !== g) { const d = labDist(G.lab, H.lab); if (d < nd) { nd = d; near = h; } } });
        if (nd < MERGE || G.idx.length / n < MIN_AREA) {
          const H = groups[near], all = H.idx.concat(G.idx);
          groups[near] = { lab: mean(lab, all), idx: all };
          groups.splice(g, 1); changed = true;
        }
      }
    }
    for (const g of groups) {
      const id = out.length;
      for (const i of g.idx) label[i] = id;
      out.push({ id, band: b, lab: g.lab, area: g.idx.length / n });
    }
  }
  // light to dark, then biggest first within a band; relabel so ids follow that order
  const order = out.slice().sort((p, q) => q.band - p.band || q.area - p.area), remap = new Int16Array(out.length);
  order.forEach((m, k) => { remap[m.id] = k; m.id = k; });
  for (let i = 0; i < n; i++) label[i] = remap[label[i]];
  return { list: order, label, band, bands };
}
function mean(lab, idx) { let l = 0, a = 0, b = 0; for (const i of idx) { l += lab.L[i]; a += lab.A[i]; b += lab.B[i]; } const k = idx.length || 1; return [l / k, a / k, b / k]; }
const abDist = (lab, i, c) => Math.hypot(lab.A[i] - c[1], lab.B[i] - c[2]);
const labDist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

// ---------- accents ----------
// Small passages that differ sharply in colour from the mass around them (a red roof in an ochre field) are what
// the masses rule folds away for being small. They get their own pile. Found on a lightly squinted copy (`detail`),
// since a hard squint smears them into their surroundings.
const ACCENT_D = .07;     // a/b distance from the pixel's own mass colour that marks it as an accent
const ACCENT_AREA = .003; // and the cluster must cover at least this share of the picture
const ACCENT_MAX = 3;
function accents(M, detail, cuts) {
  const n = M.label.length, flagged = [];
  for (let i = 0; i < n; i++) {
    const m = M.list[M.label[i]].lab;
    if (Math.hypot(detail.A[i] - m[1], detail.B[i] - m[2]) > ACCENT_D) flagged.push(i);
  }
  if (flagged.length < ACCENT_AREA * n) return M;
  // cluster the flagged pixels on full OKLab, farthest-point start, then fold close or tiny clusters
  const full = (i, c) => Math.hypot(detail.L[i] - c[0], detail.A[i] - c[1], detail.B[i] - c[2]);
  let cs = [mean(detail, flagged)];
  while (cs.length < 6) {
    let far = -1, fd = 0;
    for (let t = 0; t < flagged.length; t += 3) { const i = flagged[t], d = Math.min(...cs.map(c => full(i, c))); if (d > fd) { fd = d; far = i; } }
    if (far < 0 || fd < MERGE * 1.5) break;
    cs.push([detail.L[far], detail.A[far], detail.B[far]]);
  }
  const own = new Int8Array(flagged.length);
  for (let it = 0; it < 15; it++) {
    flagged.forEach((i, t) => { let bj = 0, bd = Infinity; cs.forEach((c, j) => { const d = full(i, c); if (d < bd) { bd = d; bj = j; } }); own[t] = bj; });
    cs = cs.map((c, j) => { const m = flagged.filter((_, t) => own[t] === j); return m.length ? mean(detail, m) : c; });
  }
  const groups = cs.map((c, j) => {
    const idx = flagged.filter((_, t) => own[t] === j);
    // how far the accent sits from the masses it sits in: its distinctness
    let away = 0; for (const i of idx) away += labDist(c, M.list[M.label[i]].lab);
    return { lab: c, idx, away: idx.length ? away / idx.length : 0 };
  }).filter(g => g.idx.length / n >= ACCENT_AREA && g.away > ACCENT_D)
    .sort((p, q) => q.idx.length * q.away - p.idx.length * p.away).slice(0, ACCENT_MAX);
  for (const g of groups) {
    const id = M.list.length;
    for (const i of g.idx) { M.list[M.label[i]].area -= 1 / n; M.label[i] = id; }
    M.list.push({ id, band: bandOf(g.lab[0], cuts), lab: g.lab, area: g.idx.length / n, accent: true });
  }
  return M;
}

// ---------- piles ----------
// Recipes are chosen for the whole plan at once. Every mix of up to three colour tubes plus white (Reach's ratio
// grid, spectral colour) is a candidate. For each mass, the candidates that stay in its value band and come close
// to its colour are kept; then one recipe per mass is picked so that the plan as a whole needs few different tubes.
// A painter would do the same: a short palette shared across the piles, not the closest tube triple for each.
const SLACK = .035;      // a candidate may be this much further (painter-weighted) than the mass's best mix
const KEEP = 600;        // candidates kept per mass
const TUBE_COST = .018;  // what one more tube on the palette is worth, in painter-weighted colour distance
const PILE_TUBE = .004;  // a small charge per tube inside a pile, so simple piles win ties
let cache = null;        // the enumerated mixes for one set of tubes and tunings
function mixesFor(avail) {
  const key = avail.slice().sort().map(id => id + S.getTune(id).toFixed(4)).join(",");
  if (cache && cache.key === key) return cache;
  const tubes = avail.map(id => S.BY[id]), index = new Map(tubes.map((t, k) => [t, k]));
  const L = [], A = [], B = [], T = [], Pp = [];
  RM.enumerate(tubes, (l, a, b, r, g, bl, ts, ps) => {
    L.push(l); A.push(a); B.push(b);
    T.push(ts.map(t => index.get(t))); Pp.push(ps.slice());
  }, null, SP.mixLinear);
  cache = { key, tubes, L: Float32Array.from(L), A: Float32Array.from(A), B: Float32Array.from(B), T, P: Pp };
  return cache;
}
function candidates(X, m, cuts) {
  const bounds = [0, ...cuts, 1], lo = bounds[m.band], hi = bounds[m.band + 1], q = m.lab, n = X.L.length;
  const d = new Float32Array(n); let best = Infinity, bestIn = Infinity;
  for (let i = 0; i < n; i++) {
    const v = Math.sqrt(2 * (X.L[i] - q[0]) ** 2 + (X.A[i] - q[1]) ** 2 + (X.B[i] - q[2]) ** 2); // = S.dist
    d[i] = v; if (v < best) best = v;
    if (X.L[i] >= lo && X.L[i] < hi && v < bestIn) bestIn = v;
  }
  const inBandOnly = bestIn < Infinity, ref = inBandOnly ? bestIn : best, out = [];
  for (let i = 0; i < n; i++) {
    if (d[i] > ref + SLACK) continue;
    if (inBandOnly && !(X.L[i] >= lo && X.L[i] < hi)) continue;
    const tubes = new Set();
    X.T[i].forEach((k, j) => { if (X.P[i][j] > 0) tubes.add(X.tubes[k].id); });
    out.push({ i, d: d[i], tubes: [...tubes].filter(id => id !== "W"), own: tubes.size });
  }
  out.sort((p, q) => p.d - q.d);
  return out.slice(0, KEEP);
}
// Pick one candidate per mass, minimising colour error plus the cost of the tubes the plan as a whole uses.
// Coordinate descent from two starts (each mass's closest mix; each mass's simplest close mix), best total kept.
function choose(cands, shared) {
  const local = c => c.d + PILE_TUBE * c.own;
  if (!shared) return cands.map(cs => cs.length ? 0 : -1);
  const total = pick => {
    const used = new Set(); let s = 0;
    pick.forEach((k, m) => { if (k < 0) return; const c = cands[m][k]; s += local(c); c.tubes.forEach(t => used.add(t)); });
    return s + TUBE_COST * used.size;
  };
  const descend = pick => {
    for (let round = 0; round < 12; round++) {
      let changed = false;
      for (let m = 0; m < cands.length; m++) {
        if (!cands[m].length) continue;
        const others = new Map();
        pick.forEach((k, j) => { if (j !== m && k >= 0) for (const t of cands[j][k].tubes) others.set(t, (others.get(t) || 0) + 1); });
        let bk = pick[m], bc = Infinity;
        cands[m].forEach((c, k) => { const cost = local(c) + TUBE_COST * c.tubes.filter(t => !others.has(t)).length; if (cost < bc - 1e-9) { bc = cost; bk = k; } });
        if (bk !== pick[m]) { pick[m] = bk; changed = true; }
      }
      if (!changed) break;
    }
    return pick;
  };
  const a = descend(cands.map(cs => cs.length ? 0 : -1));
  const b = descend(cands.map(cs => { if (!cs.length) return -1; let bk = 0; cs.forEach((c, k) => { if (c.tubes.length < cs[bk].tubes.length) bk = k; }); return bk; }));
  return total(a) <= total(b) ? a : b;
}
// One recipe per mass, and whether each mix stays inside its value band. A pile that lands in the next band
// breaks the plan however good its hue is, so that is the headline check.
function piles(list, cuts, avail, opts = {}) {
  const X = mixesFor(avail), bounds = [0, ...cuts, 1];
  const cands = list.map(m => candidates(X, m, cuts)), pick = choose(cands, opts.shared !== false);
  return list.map((m, k) => {
    if (pick[k] < 0) return { mass: m, none: true };
    const i = cands[k][pick[k]].i, parts = {};
    X.T[i].forEach((t, j) => { if (X.P[i][j] > 0) parts[X.tubes[t].id] = (parts[X.tubes[t].id] || 0) + X.P[i][j]; });
    const c = S.colour(parts), got = c.lab, reads = bandOf(got[0], cuts);
    const lo = bounds[m.band], hi = bounds[m.band + 1];
    return {
      mass: m, parts, lab: got, rgb: c.rgb, recipe: S.recipe(parts),
      dL: got[0] - m.lab[0], dE: labDist(got, m.lab), reads, inBand: reads === m.band,
      margin: Math.min(got[0] - lo, hi - got[0]), // how far inside the band the mix sits (negative: outside)
    };
  });
}
// The tubes a plan uses, most-used first (white first when present).
function paletteOf(pileList) {
  const n = {};
  for (const p of pileList) if (!p.none) for (const id of Object.keys(p.parts)) n[id] = (n[id] || 0) + 1;
  return Object.keys(n).sort((a, b) => (b === "W") - (a === "W") || n[b] - n[a]);
}

// How much of each pile, and what to squeeze out for all of them. areaCm2 is the painted area.
function quantities(pileList, areaCm2, thick, margin) {
  const tubes = {};
  const each = pileList.map(p => {
    if (p.none) return null;
    const b = S.batch(p.parts, areaCm2 * p.mass.area, thick, margin);
    if (b) for (const l of b.lines) tubes[l.id] = (tubes[l.id] || 0) + l.ml;
    return b;
  });
  const squeeze = Object.entries(tubes).map(([id, ml]) => ({ id, ml, squeezeCm: ml / S.SQUEEZE_CM2, size: S.sizeWords(ml) }))
    .sort((p, q) => q.ml - p.ml);
  return { each, squeeze, totalMl: squeeze.reduce((s, t) => s + t.ml, 0) };
}

const Plan = { toLab, squint, valueCuts, bandOf, munsell, valueWords, masses, accents, piles, paletteOf, quantities, MERGE, MIN_AREA, TUBE_COST };
if (typeof module !== "undefined" && module.exports) module.exports = Plan; else root.Plan = Plan;
})(typeof window !== "undefined" ? window : globalThis);
