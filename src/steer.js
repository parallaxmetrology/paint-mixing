// Touch of Paint: steering a pile of paint that is almost right.
// Pure model, no DOM. Shared by the page (window.Steer) and the Node tests (require("./steer.js")).
// Colour comes from ReachMix's two-constant Kubelka–Munk mix (copied unchanged from mixing-room/reach-mix.js).
"use strict";
(function (root) {
const RM = typeof module !== "undefined" && module.exports ? require("./reach-mix.js") : root.ReachMix;
// Branch: mixing is spectral (31 wavelength bands) instead of three RGB channels. See spectral.js.
const SP = typeof module !== "undefined" && module.exports ? require("./spectral.js") : root.Spectral;
const MIX = SP.mixLinear;
const MODEL = "spectral";

// The paint library. Optical inputs are estimates, not measurements of any brand.
// hex = masstone (thick, over itself); hiding = one-coat contrast ratio; t14 = OKLab lightness of 1 part tube
// : 4 parts titanium white, which sets tinting strength below. src: "mr" the Mixing Room's eight, "cp" masstone and
// hiding from claude-paint's catalogue (crates/paint/src/palette.rs, via Reach's tubes.js), "new" estimated here for
// modern pigments that historical catalogue lacks. The t14 anchors are all painter's estimates.
// The first eight keep their ids (and order) so saved colours stay valid.
const LIB = [
  // id, name, short, family, pigment, hex, hiding, t14, src
  ["W", "Titanium White", "White", "white", "PW6", "#f4f3ed", .95, null, "mr"],
  ["Y", "Cadmium Yellow Light", "Cad Yellow", "yellow", "PY35", "#f5ce16", .88, .92, "mr"],
  ["R", "Cadmium Red Light", "Cad Red", "red", "PR108", "#de4524", .88, .74, "mr"],
  ["M", "Quinacridone Magenta", "Magenta", "red", "PR122", "#9d1754", .12, .63, "mr"],
  ["U", "Ultramarine Blue", "Ultramarine", "blue", "PB29", "#2e2f8c", .25, .62, "mr"], // red-leaning, as real ultramarine is: R = G
  ["P", "Prussian Blue", "Prussian", "blue", "PB27", "#102f42", .30, .52, "mr"],
  ["G", "Sap Green", "Sap Green", "green", "PY83 · PB15", "#3f5424", .20, .72, "mr"],
  ["S", "Burnt Sienna", "Sienna", "earth", "PBr7", "#974b2c", .32, .72, "mr"],
  // yellows and oranges
  ["LY", "Lemon Yellow", "Lemon", "yellow", "PY3 / PY175", "#eee23a", .55, .93, "new"], // .95 left it weaker than white against blues
  ["YM", "Cadmium Yellow Medium", "Cad Yellow Med", "yellow", "PY35", "#f0b11c", .88, .90, "cp"],
  ["NY", "Naples Yellow", "Naples", "yellow", "PW6 · PY · PR (hue)", "#e2b964", .85, .94, "cp"],
  ["IY", "Indian Yellow", "Indian Yellow", "yellow", "PY110 · PY83 (hue)", "#d9921a", .15, .88, "cp"],
  ["CO", "Cadmium Orange", "Cad Orange", "red", "PO20", "#e5762a", .9, .82, "cp"],
  // reds and violets
  ["PR", "Pyrrole Red", "Pyrrole Red", "red", "PR254", "#c8242a", .8, .72, "new"],
  ["AC", "Alizarin Crimson (permanent)", "Alizarin", "red", "PR177 · PV19", "#5e1624", .15, .62, "cp"],
  ["QR", "Quinacridone Rose", "Quin Rose", "red", "PV19", "#b0254f", .15, .70, "new"],
  ["DP", "Dioxazine Purple", "Dioxazine", "violet", "PV23", "#2c1a3e", .10, .45, "new"],
  ["CV", "Cobalt Violet", "Cobalt Violet", "violet", "PV14", "#7e4c8e", .35, .80, "cp"],
  // blues
  ["CB", "Cobalt Blue", "Cobalt Blue", "blue", "PB28", "#2f55a8", .55, .74, "cp"],
  ["CE", "Cerulean Blue", "Cerulean", "blue", "PB35", "#3f82b3", .8, .80, "cp"],
  ["PB", "Phthalo Blue", "Phthalo Blue", "blue", "PB15:3", "#0f2d52", .12, .48, "new"],
  // greens
  ["PG", "Phthalo Green", "Phthalo Green", "green", "PG7", "#0b3b33", .12, .55, "new"],
  ["VI", "Viridian", "Viridian", "green", "PG18", "#1c4a40", .3, .73, "cp"],
  ["CX", "Chromium Oxide Green", "Chrome Oxide", "green", "PG17", "#5b6b3a", .92, .78, "new"],
  // earths
  ["YO", "Yellow Ochre", "Yellow Ochre", "earth", "PY43", "#b98a36", .8, .86, "cp"],
  ["RS", "Raw Sienna", "Raw Sienna", "earth", "PBr7", "#9a6a2b", .4, .80, "cp"],
  ["TR", "Transparent Red Oxide", "Trans. Red Oxide", "earth", "PR101", "#6e2b18", .2, .72, "new"],
  ["IR", "Indian Red", "Indian Red", "earth", "PR101", "#7a3a33", .92, .66, "cp"],
  ["RU", "Raw Umber", "Raw Umber", "earth", "PBr7", "#5c4c3a", .8, .66, "cp"],
  ["BU", "Burnt Umber", "Burnt Umber", "earth", "PBr7", "#4a3022", .75, .60, "new"],
  // blacks and greys
  ["IB", "Ivory Black", "Ivory Black", "black", "PBk9", "#1e1b19", .9, .52, "cp"],
  ["MB", "Mars Black", "Mars Black", "black", "PBk11", "#1b1b1c", .95, .46, "new"],
  ["PY", "Payne's Grey", "Payne's Grey", "black", "PB29 · PBk9 (mix)", "#2a3038", .6, .50, "new"],
];
const TUBES = LIB.map(([id, name, short, family, pigment, hex, hiding, t14, src]) => ({ id, name, short, family, pigment, hex, hiding, t14, src, strength: 1 }));
const BY = Object.fromEntries(TUBES.map(t => [t.id, t]));
const FAMILIES = [["white", "Whites"], ["yellow", "Yellows"], ["red", "Oranges & reds"], ["violet", "Violets"], ["blue", "Blues"], ["green", "Greens"], ["earth", "Earths"], ["black", "Blacks & greys"]];
// Ready-made palettes. Zorn's vermilion is cadmium red light here, ivory black stands in for bone black.
const PALETTES = [
  { id: "starter", name: "Starter eight", ids: ["W", "Y", "R", "M", "U", "P", "G", "S"] },
  { id: "primary", name: "Split primary", ids: ["W", "LY", "YM", "R", "AC", "U", "PB"] },
  { id: "zorn", name: "Zorn", ids: ["W", "YO", "R", "IB"] },
  { id: "earth", name: "Earth palette", ids: ["W", "YO", "RS", "S", "IR", "RU", "BU", "IB", "U"] },
  { id: "landscape", name: "Landscape", ids: ["W", "LY", "YM", "YO", "R", "AC", "U", "CE", "VI", "S", "BU"] },
  { id: "all", name: "Every paint", ids: LIB.map(r => r[0]) },
];

// Tinting strength. Deriving absorption from the hiding-based scatter (as reach-mix does) leaves the transparent
// tubes far too weak against white: 1 ultramarine : 1 white came out almost white. A correction tool lives on
// amounts, so each colour tube's strength is solved here so that 1 part tube : 4 parts white lands on its t14
// tint lightness (OKLab L). These anchors are a painter's estimates of ordinary artist-grade behaviour,
// not measurements; they are the first thing a physical tint test should replace.
const TINT_1_4 = Object.fromEntries(TUBES.filter(t => t.t14).map(t => [t.id, t.t14]));

// Dark-paint correction. A three-channel Kubelka–Munk model lets dark paints swamp light ones: with the
// anchors above, 10 cad yellow : 1 ultramarine stayed a mid-dark olive and 1 ultramarine : 10 white a mid
// blue. One global number, DARK_SHIFT, lifts the 1:4 anchors of dark paints (scaled by how dark their
// masstone is: full below L 0.35, none above L 0.65), which weakens them against everything else. It is
// fitted, not chosen: calibrate.js minimises the lightness error over REFERENCE_MIXES. Those targets are still
// a painter's estimates of familiar mixes, not measurements.
const DARK_SHIFT = 0.070; // refitted for spectral mixing (RGB branch: 0.100)
const massL = t => { const [r, g, b] = RM.hexRgb(t.hex), o = [0, 0, 0]; RM.oklab(RM.toLin(r), RM.toLin(g), RM.toLin(b), o, 0); return o[0]; };
const darkness = t => Math.min(1, Math.max(0, (.65 - massL(t)) / .3));
const REFERENCE_MIXES = [
  { parts: { U: 1, W: 10 }, L: .80, note: "ultramarine tint, light sky blue" },
  { parts: { U: 1, W: 4 }, L: .70, note: "ultramarine tint, clear mid blue" },
  { parts: { Y: 10, U: 1 }, L: .72, note: "mostly yellow: a bright yellow-green" },
  { parts: { Y: 1, U: 1 }, L: .46, note: "equal yellow and ultramarine: a dark olive" },
  { parts: { S: 1, U: 1 }, L: .33, note: "sienna and ultramarine: near black" },
  { parts: { S: 1, U: 1, W: 4 }, L: .62, note: "that near black with white: a mid grey" },
  { parts: { P: 1, W: 10 }, L: .70, note: "Prussian stays strong even at 1:10" },
  { parts: { Y: 4, P: 1 }, L: .55, note: "yellow and Prussian: a mid green" },
  { parts: { IB: 1, W: 10 }, L: .72, note: "ivory black and white: a middle grey" },
  { parts: { M: 1, W: 8 }, L: .76, note: "magenta tint: a clear pink" },
  { parts: { PB: 1, W: 10 }, L: .62, note: "phthalo blue stays strong at 1:10" },
  { parts: { R: 1, U: 1 }, L: .36, note: "cad red and ultramarine: a dark purple-brown" },
];

function calibrate(shift = DARK_SHIFT) {
  const W = BY.W; W.strength = W.base = 1;
  const tintL = t => { const [r, g, b] = MIX([t, W], [1, 4]), o = [0, 0, 0]; RM.oklab(r, g, b, o, 0); return o[0]; };
  for (const id in TINT_1_4) {
    const t = BY[id]; t.t14eff = Math.min(.97, TINT_1_4[id] + shift * darkness(t));
    let lo = -4, hi = 8;
    for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; t.strength = Math.exp(m); if (tintL(t) > t.t14eff) lo = m; else hi = m; }
    t.strength = t.base = Math.exp((lo + hi) / 2);
  }
}
calibrate();

// ---------- tuning to the painter's own tubes ----------
// A multiplier on each colour tube's strength (white is the reference and stays 1). It is set two ways:
// by comparing a real 1:4 tint with the one on screen, and by the painter's verdict after following a suggestion
// ("went too far" means that tube is stronger than modelled). Both are relative judgements, which survive an
// uncalibrated screen far better than absolute colour does.
const TUNE_MIN = 1 / 8, TUNE_MAX = 8;
const tune = {};
function setTune(id, m) {
  const t = BY[id]; if (!t || id === "W") return;
  m = Math.min(TUNE_MAX, Math.max(TUNE_MIN, m));
  if (Math.abs(Math.log(m)) < 1e-6) delete tune[id]; else tune[id] = m;
  t.strength = t.base * m;
}
const getTune = id => tune[id] || 1;
const nudge = (id, k) => setTune(id, getTune(id) * k);
function loadTune(obj) { for (const t of TUBES) if (t.id !== "W") setTune(t.id, obj && Number.isFinite(obj[t.id]) ? obj[t.id] : 1); }
const tuneState = () => ({ ...tune });
// Verdict factors: a clear overshoot means the tube is noticeably stronger than modelled, and vice versa.
const VERDICT = { far: 1.35, short: 1 / 1.35 };
// 1 part tube : 4 parts white, the swatch a painter compares with their own tint.
const tint = id => colour({ [id]: 1, W: 4 });

// ---------- a pile ----------
const total = parts => Object.values(parts).reduce((s, v) => s + (v > 0 ? v : 0), 0);
const ids = parts => Object.keys(parts).filter(id => parts[id] > 0 && BY[id]);

function colour(parts) {
  const k = ids(parts);
  if (!k.length) return null;
  const [r, g, b] = MIX(k.map(id => BY[id]), k.map(id => parts[id]));
  const lab = [0, 0, 0]; RM.oklab(r, g, b, lab, 0);
  return { lab, rgb: [RM.toByte(r), RM.toByte(g), RM.toByte(b)] };
}

// Add `frac` of the pile's current volume of one tube.
function plus(parts, id, frac) {
  const out = { ...parts };
  out[id] = (out[id] || 0) + frac * total(parts);
  return out;
}

// ---------- painter's axes ----------
// Value = OKLab L. Intensity = OKLab chroma. Temperature is a teaching convention, not a perceptual law:
// a warm pole at OKLab hue 40° (cadmium red light) and a cool pole opposite it (220°, toward cyan-blue).
// Near-greys warm by leaning toward the pole; colours warm by turning their hue toward it.
const POLE = 40, WARM = [Math.cos(POLE * Math.PI / 180), Math.sin(POLE * Math.PI / 180)];
const chroma = lab => Math.hypot(lab[1], lab[2]);
const hueDeg = lab => { let h = Math.atan2(lab[2], lab[1]) * 180 / Math.PI; return h < 0 ? h + 360 : h; };
const fromPole = h => { let d = Math.abs(h - POLE) % 360; return d > 180 ? 360 - d : d; }; // 0 warmest, 180 coolest
// Projection for greys, hue closeness for colours, blended across chroma .02–.06. Units ≈ OKLab a/b.
function temp(lab) {
  const c = chroma(lab), proj = lab[1] * WARM[0] + lab[2] * WARM[1];
  const w = Math.min(1, Math.max(0, (c - .02) / .04));
  return (1 - w) * proj + w * (90 - fromPole(hueDeg(lab))) * .002;
}
function axes(lab) { return { value: lab[0], temp: temp(lab), chroma: chroma(lab) }; }

// Painter-weighted distance: value errors count double (value carries a painting; hue forgives).
const VW = 2;
const dist = (p, q) => Math.sqrt(VW * (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2);

// A judgement by eye -> an imagined goal colour near the pile.
// asks: { value, temp, chroma } each in -2..2 (0 = leave it; ±1 = a little; ±2 = a lot).
// Steps per level: value .045 L; intensity 18% of current chroma (at least .02); temperature 12° of hue for a
// colour, .022 along the warm axis for a grey.
const STEP = { value: .045, temp: .022, turn: 12, chroma: .18, chromaMin: .02 };
function goalFrom(lab, asks) {
  const t = asks.temp || 0, k = asks.chroma || 0;
  let L = lab[0] + (asks.value || 0) * STEP.value, c = chroma(lab), h = hueDeg(lab);
  if (k) c = Math.max(0, c + k * Math.max(STEP.chromaMin, STEP.chroma * c));
  let a, b;
  if (c >= .04 && chroma(lab) >= .03) {
    if (t) { // turn toward the warm or cool pole, never past it
      const pole = t > 0 ? POLE : POLE + 180, d = ((pole - h + 540) % 360) - 180;
      h += Math.sign(d) * Math.min(Math.abs(d), Math.abs(t) * STEP.turn);
    }
    a = c * Math.cos(h * Math.PI / 180); b = c * Math.sin(h * Math.PI / 180);
  } else {
    const c0 = chroma(lab);
    if (c0 > 1e-4) { a = lab[1] * c / c0; b = lab[2] * c / c0; }
    else { a = c * WARM[0]; b = c * WARM[1]; } // a dead grey has no direction to brighten; lean warm
    a += t * STEP.temp * WARM[0]; b += t * STEP.temp * WARM[1];
  }
  return [Math.min(1, Math.max(0, L)), a, b];
}

// ---------- how much of one tube ----------
// Amounts are fractions of the pile's current volume, log-spaced from a trace to twice the pile.
const AMOUNTS = (() => { const a = []; for (let i = 0; i <= 80; i++) a.push(Math.pow(2, -9 + i * 10 / 80)); return a; })();
const LADDER = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1];

// Choosing an amount also charges for paint added (BULK per pile-volume): a correction that doubles the pile
// buries the colour in mud and wastes paint, so it has to earn its size.
const BULK = .012;
function bestAmount(parts, id, goal) {
  const start = dist(colour(parts).lab, goal);
  let best = { frac: 0, d: start, score: start };
  for (const f of AMOUNTS) {
    const c = colour(plus(parts, id, f)), d = dist(c.lab, goal), score = d + BULK * f;
    if (score < best.score - 1e-9) best = { frac: f, d, c, score };
  }
  return { id, ...best, start };
}

// Two tubes at once, for corrections no single tube makes (e.g. lighter AND warmer without chalk).
const PAIR_AMOUNTS = [1 / 256, 1 / 128, 1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1];
function bestPair(parts, a, b, goal) {
  let best = null;
  for (const fa of PAIR_AMOUNTS) for (const fb of PAIR_AMOUNTS) {
    const p = { ...parts }, t = total(parts);
    p[a] = (p[a] || 0) + fa * t; p[b] = (p[b] || 0) + fb * t;
    const c = colour(p), d = dist(c.lab, goal), score = d + BULK * (fa + fb);
    if (!best || score < best.score) best = { ids: [a, b], fracs: [fa, fb], d, c, score };
  }
  return best;
}

// Rank what to add. `avail` = tube ids on the palette. Returns singles and (when they help) pairs.
function suggest(parts, goal, avail) {
  const now = colour(parts), start = dist(now.lab, goal);
  const singles = avail.map(id => bestAmount(parts, id, goal)).filter(s => s.frac > 0)
    .sort((x, y) => x.score - y.score);
  // every pair: some corrections only work as two paints cancelling each other's side effects
  const pairs = [];
  for (let i = 0; i < avail.length; i++) for (let j = i + 1; j < avail.length; j++) pairs.push(bestPair(parts, avail[i], avail[j], goal));
  pairs.sort((x, y) => x.score - y.score);
  const pair = pairs[0] && singles[0] && pairs[0].d < singles[0].d * 0.8 ? pairs[0] : null;
  return { now, start, singles, pair };
}

// ---------- words ----------
function amountWords(f) {
  if (f <= 1 / 100) return "a speck";
  if (f <= 1 / 24) return "a trace";
  if (f <= 1 / 12) return "a touch";
  if (f <= 1 / 6) return "a little";
  if (f <= 1 / 3) return "some";
  if (f <= 2 / 3) return "about half the pile";
  if (f <= 1.25) return "as much as the pile";
  return "more than the pile";
}
function fracLabel(f) {
  const nice = [[1, 512], [1, 256], [1, 128], [1, 64], [1, 32], [1, 16], [1, 12], [1, 8], [1, 6], [1, 4], [1, 3], [1, 2], [2, 3], [1, 1], [3, 2], [2, 1]];
  let best = nice[0];
  for (const n of nice) if (Math.abs(Math.log(n[0] / n[1] / f)) < Math.abs(Math.log(best[0] / best[1] / f))) best = n;
  return best[1] === 1 ? (best[0] === 1 ? "≈ equal to the pile" : `≈ ${best[0]}× the pile`) : `≈ ${best[0]}/${best[1]} of the pile`;
}

// What a change does, in painter's words. Returns [{axis, text, size, dir}] largest first, ignoring the invisible.
const SIZE = { value: [.012, .04, .1], temp: [.008, .025, .06], chroma: [.008, .025, .06] };
const WORD = { value: ["darker", "lighter"], temp: ["cooler", "warmer"], chroma: ["duller", "more intense"] };
function change(fromLab, toLab) {
  const A = axes(fromLab), B = axes(toLab), out = [];
  for (const k of ["value", "temp", "chroma"]) {
    const d = B[k] - A[k], m = Math.abs(d), [s1, s2, s3] = SIZE[k];
    if (m < s1) continue;
    const size = m < s2 ? 1 : m < s3 ? 2 : 3;
    out.push({ axis: k, dir: Math.sign(d), size, mag: m / s2, text: (size === 1 ? "slightly " : size === 3 ? "much " : "") + WORD[k][d > 0 ? 1 : 0] });
  }
  return out.sort((x, y) => y.mag - x.mag);
}

// Hue drift that the three axes miss (e.g. a grey going green). Degrees, only when there is chroma to speak of.
function hueShift(fromLab, toLab) {
  if (chroma(fromLab) < .03 || chroma(toLab) < .03) return 0;
  let d = (Math.atan2(toLab[2], toLab[1]) - Math.atan2(fromLab[2], fromLab[1])) * 180 / Math.PI;
  while (d > 180) d -= 360; while (d < -180) d += 360;
  return d;
}
const HUES = [[0, "pink"], [30, "red"], [60, "orange"], [95, "yellow"], [130, "green"], [200, "blue-green"], [260, "blue"], [310, "violet"], [360, "pink"]];
function hueName(lab) {
  let h = Math.atan2(lab[2], lab[1]) * 180 / Math.PI; if (h < 0) h += 360;
  let best = HUES[0]; for (const x of HUES) if (Math.abs(x[0] - h) < Math.abs(best[0] - h)) best = x;
  return best[1];
}
// Side effects that work against what was asked, or big ones nobody asked for.
function sideEffects(fromLab, toLab, asks) {
  const out = [];
  for (const c of change(fromLab, toLab)) {
    const want = asks ? asks[c.axis] || 0 : 0;
    if (want && Math.sign(want) !== c.dir) out.push({ ...c, against: true });
    else if (!want && asks && c.size >= 2) out.push({ ...c, against: false });
  }
  const h = hueShift(fromLab, toLab);
  if (Math.abs(h) >= 12) out.push({ axis: "hue", against: false, text: `leans ${hueName(toLab)}` });
  return out;
}

// ---------- describing a pile on its own ----------
// A painter's name, not a colour-science one: dark, dull warm colours are browns and olives, not "greyed yellow".
function describe(lab) {
  const L = lab[0], c = chroma(lab), h = hueDeg(lab);
  const v = L < .3 ? "very dark" : L < .45 ? "dark" : L < .6 ? "mid-dark" : L < .72 ? "middle" : L < .84 ? "light" : "very light";
  const inH = (a, b) => a <= b ? h >= a && h < b : h >= a || h < b;
  if (c < .025) return `${v} ${c < .008 ? "" : temp(lab) > 0 ? "warm " : "cool "}grey`;
  if (L < .58 && c < .13) {
    if (inH(330, 15)) return `${v} maroon`;
    if (inH(15, 45)) return `${v} red-brown`;
    if (inH(45, 80)) return `${v} brown`;
    if (inH(80, 125)) return `${v} olive`;
    if (inH(285, 330) && c < .09) return `${v} plum`;
  }
  if (L >= .55 && L < .78 && c >= .05 && c < .14 && inH(60, 95)) return `${v} ochre`;
  if (L >= .78 && c < .07 && inH(30, 110)) return `${v} cream`;
  return `${v} ${c < .05 ? "greyed " : c < .1 ? "muted " : ""}${hueName(lab)}`;
}

// ---------- the recipe you actually ended up with ----------
// Smallest ingredient (above a trace) = 1 part; others rounded to a painter's step. Traces named, not counted.
const STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64];
function recipe(parts) {
  const k = ids(parts), t = total(parts);
  if (!k.length) return { lines: [], traces: [] };
  const main = k.filter(id => parts[id] / t >= 1 / 40), traces = k.filter(id => parts[id] / t < 1 / 40);
  const min = Math.min(...main.map(id => parts[id]));
  const lines = main.map(id => {
    const r = parts[id] / min;
    let s = STEPS[0]; for (const x of STEPS) if (Math.abs(Math.log(x / r)) < Math.abs(Math.log(s / r))) s = x;
    return { id, parts: r > 64 ? Math.round(r) : s };
  }).sort((a, b) => b.parts - a.parts);
  const rounded = Object.fromEntries(lines.map(l => [l.id, l.parts]));
  for (const id of traces) rounded[id] = parts[id] / min; // keep their effect when checking drift
  const drift = dist(colour(parts).lab, colour(rounded).lab);
  return { lines, traces, drift };
}

// ---------- geometry ----------
// In the model's mixing space (K/S per channel) adding paint is a weighted average, so each addition is a straight
// line toward that tube's masstone; on the painter's axes the same line bends. These helpers sample those paths.
const PATH_FRACS = (() => { const a = [0]; for (let i = 0; i <= 28; i++) a.push(Math.pow(2, -7 + i * 8 / 28)); return a; })(); // 0, 1/128 … 2× pile

// The colour after adding `frac` of the pile's starting volume of each tube, in any order: absolute amounts commute.
function addAbs(parts, adds) {
  const t = total(parts), out = { ...parts };
  for (const [id, f] of adds) out[id] = (out[id] || 0) + f * t;
  return out;
}
function path(parts, id, fracs = PATH_FRACS) { return fracs.map(f => ({ f, lab: colour(addAbs(parts, [[id, f]])).lab })); }

// Everything reachable by adding at most `max` pile-volumes of any one or two palette tubes (sampled).
const REACH_STEPS = [0, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1];
function reachSamples(parts, avail, max = 1) {
  const st = REACH_STEPS.filter(f => f <= max), pts = [];
  for (let i = 0; i < avail.length; i++) for (let j = i; j < avail.length; j++)
    for (const a of st) for (const b of (i === j ? [0] : st)) pts.push(colour(addAbs(parts, i === j ? [[avail[i], a]] : [[avail[i], a], [avail[j], b]])).lab);
  return pts;
}

// 2D convex hull, Andrew's monotone chain. points: [[x, y], ...] -> hull, counter-clockwise, no repeats.
function hull2d(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
// Nearest sampled reachable colour to a goal (painter-weighted distance).
function reachGap(samples, goal) { let d = Infinity; for (const s of samples) d = Math.min(d, dist(s, goal)); return d; }

// ---------- mixing space ----------
// The model's own coordinates: per channel (R, G, B light), absorption over scattering. A pile's K/S is the
// average of its tubes' K/S weighted by parts × strength × scattering, so every mix of two colours lies on the
// straight segment between them, and a palette's whole gamut is the convex hull of its tubes.
// Spectral branch: per-band K/S, summed into three fixed wavelength groups (blue < 490 nm, green 490–580,
// red > 580). A fixed linear map of a weighted average is still a weighted average, so lines stay straight.
const GROUP = SP.WL.map(l => l < 490 ? 2 : l <= 580 ? 1 : 0); // index into [red, green, blue] absorption
function groupBands(b) { const o = [0, 0, 0]; b.forEach((v, k) => { o[GROUP[k]] += v; }); return o; }
function ksVec(parts) {
  const k = ids(parts);
  return k.length ? groupBands(SP.ksBands(k.map(id => BY[id]), k.map(id => parts[id]))) : null;
}
// A seen colour back to K/S (its masstone reading), for goals that aren't mixes.
function ksOfLab(lab) { return groupBands(SP.ksBandsOfLin(RM.fromOklab(lab[0], lab[1], lab[2]).map(v => RM.toLin(v)))); }
// Proportions of absorption: a central projection, which keeps straight lines straight.
function balance(ks) { const s = ks[0] + ks[1] + ks[2]; return [ks[0] / s, ks[1] / s, ks[2] / s]; }
// Is point q inside the convex polygon (counter-clockwise)? Exact, no sampling.
function insideHull(hull, q) {
  if (hull.length < 3) return false;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    if ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) < -1e-12) return false;
  }
  return true;
}

// ---------- mix enough ----------
// How much of a recipe to mix for a passage, so you don't run out and have to rematch.
// Coverage is wet paint volume per area, from film thickness: 1 ml spread 0.1 mm thick covers 100 cm².
// These are rough working figures for brushed oil, not product data; the margin is there because they are rough.
const THICKNESS = {
  thin: { label: "Thin / scumbled", cm2PerMl: 250 },   // ~0.04 mm
  normal: { label: "Normal brushwork", cm2PerMl: 100 }, // ~0.1 mm
  heavy: { label: "Heavy, loaded brush", cm2PerMl: 40 }, // ~0.25 mm
  impasto: { label: "Impasto / knife", cm2PerMl: 10 },  // ~1 mm
};
const TUBE_ML = 37;               // a standard artist tube
const SQUEEZE_CM2 = Math.PI * .35 * .35; // cross-section of a ~7 mm tube opening, cm²: 1 cm of squeeze ≈ 0.38 ml
const PEA = .2, HAZELNUT = 1, WALNUT = 5; // ml, a painter's kitchen units

// parts: recipe by volume. area: cm² to cover. thickness: key of THICKNESS. margin: fraction extra (0.25 = +25%).
function batch(parts, area, thickness, margin) {
  const k = ids(parts), t = total(parts), th = THICKNESS[thickness] || THICKNESS.normal;
  if (!k.length || !(area > 0)) return null;
  const paintMl = area / th.cm2PerMl, totalMl = paintMl * (1 + Math.max(0, margin || 0));
  const lines = k.map(id => {
    const frac = parts[id] / t, ml = totalMl * frac;
    return { id, frac, ml, squeezeCm: ml / SQUEEZE_CM2, tubeShare: ml / TUBE_ML, size: sizeWords(ml) };
  }).sort((a, b) => b.ml - a.ml);
  return { totalMl, paintMl, lines, order: mixOrder(lines) };
}

function sizeWords(ml) {
  if (ml < .05) return "a knife tip";
  if (ml < .6) { const n = Math.max(1, Math.round(ml / PEA)); return n === 1 ? "a pea" : `${n} peas`; }
  if (ml < 4) { const n = Math.round(ml / HAZELNUT * 2) / 2; return n <= 1 ? "a hazelnut" : `${n} hazelnuts`; }
  if (ml < 25) { const n = Math.round(ml / WALNUT * 2) / 2; return n <= 1 ? "a walnut" : `${n} walnuts`; }
  const n = Math.round(ml / TUBE_ML * 2) / 2; return n <= 1 ? "about a tube" : `about ${n} tubes`;
}

// How hard a paint tints: how far its 1:4 tint with white sits from white (OKLab). White itself is 0.
function tintPower(id) {
  if (id === "W") return 0;
  const w = colour({ W: 1 }).lab, t = colour({ [id]: 1, W: 4 }).lab;
  return Math.hypot(t[0] - w[0], t[1] - w[1], t[2] - w[2]);
}
// Order of mixing: the biggest pile down first, then the others, the strongest tinters last and in steps,
// since a strong colour can always be added and never taken out.
function mixOrder(lines) {
  return lines.slice().sort((a, b) => {
    if (a === lines[0]) return -1; if (b === lines[0]) return 1;
    return tintPower(a.id) - tintPower(b.id) || b.ml - a.ml;
  }).map(l => l.id);
}

// ---------- start fresh ----------
// When steering would need more paint than the pile, find a clean recipe for the goal from scratch.
let G = null, Gkey = "";
function fresh(goal, avail) {
  const key = avail.slice().sort().map(id => id + getTune(id).toFixed(4)).join("");
  if (!G || Gkey !== key) { G = RM.buildGamut(avail.map(id => BY[id]), MIX); Gkey = key; }
  const [i] = RM.nearestMix(G, goal[0], goal[1], goal[2]);
  if (i < 0) return null;
  const m = G.mixes[i], parts = {};
  m.tubes.forEach((t, j) => { if (m.parts[j]) parts[t.id] = m.parts[j]; });
  const c = colour(parts);
  return { parts, c, d: dist(c.lab, goal) };
}

const Steer = { MODEL, calibrate, DARK_SHIFT, REFERENCE_MIXES, darkness, ksVec, ksOfLab, balance, insideHull, PATH_FRACS, addAbs, path, reachSamples, hull2d, reachGap, FAMILIES, PALETTES, THICKNESS, TUBE_ML, SQUEEZE_CM2, batch, sizeWords, TUBES, BY, TINT_1_4, setTune, getTune, nudge, loadTune, tuneState, VERDICT, tint, total, ids, colour, plus, axes, dist, goalFrom, STEP, AMOUNTS, LADDER, bestAmount, bestPair, suggest,
  amountWords, fracLabel, change, hueShift, hueName, sideEffects, describe, recipe, fresh, chroma, temp };
if (typeof module !== "undefined" && module.exports) module.exports = Steer; else root.Steer = Steer;
})(typeof window !== "undefined" ? window : globalThis);
