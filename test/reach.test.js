// Reach's mixing core, headless, on the historical tube catalogue.
// The Milkmaid tests need python3 with Pillow to decode the picture; they are skipped without it.
"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm"), { execFileSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "src", "reach-mix.js"));
const DATA = require(ROOT).historicalTubes(), TUBES = new Map(DATA.tubes.map(t => [t.name, t]));
const box = name => DATA.boxes[name].map(n => TUBES.get(n));

const labOf = rgb => { const o = new Float32Array(3); M.oklab(rgb[0], rgb[1], rgb[2], o, 0); return o; };
const dE = (x, y) => 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
// one recipe through the page's own mixer
const mixOf = recipe => labOf(M.mixLinear(recipe.map(([n]) => TUBES.get(n)), recipe.map(([, p]) => p)));

test("every box names only catalogue tubes", () => {
  for (const [name, list] of Object.entries(DATA.boxes)) for (const t of list) assert.ok(TUBES.has(t), `${name}: ${t}`);
});

test("a tube straight from the tube is its own masstone", () => {
  for (const t of DATA.tubes) {
    assert.ok(dE(mixOf([[t.name, 1]]), labOf(M.hexRgb(t.hex).map(M.toLin))) < 0.5, t.name);
  }
});

test("mixing is subtractive: white lightens, black darkens, blue and yellow make green", () => {
  const ochre = mixOf([["yellow ochre", 1]]);
  assert.ok(mixOf([["yellow ochre", 1], ["lead white", 4]])[0] > ochre[0]);
  assert.ok(mixOf([["yellow ochre", 1], ["bone black", 1]])[0] < ochre[0]);
  const green = mixOf([["cobalt blue", 1], ["chrome yellow", 1]]);
  const h = Math.atan2(green[2], green[1]) * 180 / Math.PI;
  assert.ok(h > 110 && h < 160, `cobalt + chrome yellow hue ${h.toFixed(0)}°, not green`);
});

test("the mixer is claude-paint's two-constant model: its scattering, and notes/tints.md's table", () => {
  // claude-paint's scatter_for gives bone black S 0.076 and lead white S 3.27 per coat
  M.mixLinear([TUBES.get("bone black"), TUBES.get("lead white")], [1, 1]);
  assert.ok(Math.abs(TUBES.get("bone black")._S - 0.076) < 0.001);
  assert.ok(Math.abs(TUBES.get("lead white")._S - 3.27) < 0.01);
  // the "two-constant" column of claude-paint/notes/tints.md, 2026-10-16
  const table = [["bone black", 1, "#908983"], ["bone black", 4, "#bcb6af"], ["bone black", 16, "#d8d3cb"],
    ["cobalt blue", 4, "#b9d3da"], ["ultramarine blue", 1, "#909bd4"], ["vermilion", 4, "#eca280"], ["cadmium red", 10, "#edb597"]];
  for (const [t, w, hex] of table) {
    const got = M.mixLinear([TUBES.get(t), TUBES.get("lead white")], [1, w]);
    assert.ok(dE(labOf(got), labOf(M.hexRgb(hex).map(M.toLin))) < 0.5, `${t} 1:${w}`);
  }
});

test("black and white land near the sourced value ladder (notes/tints.md anchor 1)", () => {
  // anchors for lead white, OKLab L: 1:1 0.53–0.60, 1:4 0.65–0.70, 1:16 0.72–0.79, 1:40 0.80–0.85.
  // Two-constant KM runs light by up to about one value step (0.1) from 1:4 up; this pins that, not more.
  const ladder = [[1, 0.53, 0.60], [4, 0.65, 0.70], [16, 0.72, 0.79], [40, 0.80, 0.85]];
  let prev = 0;
  for (const [w, lo, hi] of ladder) {
    const L = mixOf([["bone black", 1], ["lead white", w]])[0];
    assert.ok(L > prev, `1:${w} not lighter than the step before`); prev = L;
    assert.ok(L >= lo - 0.02 && L <= hi + 0.1, `1:${w} L ${L.toFixed(2)} against ${lo}–${hi}`);
  }
});

test("every box builds, deterministically, with a sensible value range", () => {
  for (const name of Object.keys(DATA.boxes)) {
    const a = M.buildGamut(box(name)), b = M.buildGamut(box(name));
    assert.equal(a.count, b.count, name);
    assert.equal(a.mixes.length, b.mixes.length, name);
    assert.ok(a.mixes.length > 200, `${name}: only ${a.mixes.length} distinct colours`);
    assert.ok(a.Lmin < 0.3 && a.Lmax > 0.85, `${name}: value range ${a.Lmin.toFixed(2)}–${a.Lmax.toFixed(2)}`);
  }
});

test("the fast nearest-mix lookup is within 1 ΔE of brute force, near and far from the gamut", () => {
  for (const name of ["zorn", "hopper", "impressionist"]) {
    const G = M.buildGamut(box(name));
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 1500; i++) {
      const c = labOf([rnd(), rnd(), rnd()]);
      const fast = M.nearestMix(G, c[0], c[1], c[2])[1];
      let best = Infinity; for (const m of G.mixes) best = Math.min(best, dE(m.lab, c));
      assert.ok(fast - best <= 1, `${name} sample ${i}: fast ${fast.toFixed(2)} vs exact ${best.toFixed(2)}`);
    }
  }
});

// ---- the Milkmaid (Vermeer, Rijksmuseum SK-A-2344, public domain) ----
let HAS_PIL = true;
try { execFileSync("python3", ["-I", "-c", "import PIL"], { stdio: "pipe" }); } catch { HAS_PIL = false; }
const mtest = (name, f) => test(name, { skip: !HAS_PIL && "needs python3 with Pillow" }, f);
let pic = null;
function milkmaid() {
  if (pic) return pic;
  const py = `import sys; from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB"); s = min(1, 720 / max(im.size))
im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
sys.stdout.buffer.write(im.width.to_bytes(4, "little") + im.height.to_bytes(4, "little") + im.tobytes())`;
  const raw = execFileSync("python3", ["-I", "-c", py, path.join(ROOT, "examples", "milkmaid.jpg")], { maxBuffer: 1 << 26 });
  const W = raw.readUInt32LE(0), H = raw.readUInt32LE(4), px = raw.subarray(8), n = W * H, lab = new Float32Array(n * 3);
  for (let p = 0; p < n; p++) M.oklab(M.LIN[px[p * 3]], M.LIN[px[p * 3 + 1]], M.LIN[px[p * 3 + 2]], lab, p * 3);
  const Ls = Array.from({ length: n }, (_, p) => lab[p * 3]).sort((a, b) => a - b);
  return pic = { n, lab, lo: Ls[Math.floor(0.02 * n)], hi: Ls[Math.floor(0.98 * n)] };
}
// mirrors the page's analyse(): optional value keying, then nearest mix at ΔE 4
function reach(G, keyed) {
  const { n, lab, lo, hi } = milkmaid();
  const to0 = keyed ? Math.max(lo, G.Lmin) : lo, to1 = keyed ? Math.min(hi, G.Lmax) : hi;
  const outs = new Map(); let inside = 0;
  for (let p = 0; p < n; p++) {
    const L = to0 + (lab[p * 3] - lo) * (to1 - to0) / (hi - lo);
    if (M.nearestMix(G, L, lab[p * 3 + 1], lab[p * 3 + 2])[1] <= 4) { inside++; continue; }
    const k = `${L.toFixed(3)},${lab[p * 3 + 1].toFixed(3)},${lab[p * 3 + 2].toFixed(3)}`, o = outs.get(k);
    if (o) o[3]++; else outs.set(k, [L, lab[p * 3 + 1], lab[p * 3 + 2], 1]);
  }
  return { cover: 100 * inside / n, outs: [...outs.values()] };
}

mtest("Milkmaid: Zorn reaches about 81%, about 90% keyed", () => {
  const G = M.buildGamut(box("zorn"));
  const plain = reach(G, false).cover, keyed = reach(G, true).cover;
  assert.ok(Math.abs(plain - 81) <= 2, `unkeyed ${plain.toFixed(1)}%`);
  assert.ok(Math.abs(keyed - 90) <= 2, `keyed ${keyed.toFixed(1)}%`);
});

mtest("Milkmaid: keyed, the full boxes reach 99–100%", () => {
  for (const name of ["hopper", "sargent", "impressionist"]) {
    const c = reach(M.buildGamut(box(name)), true).cover;
    assert.ok(c >= 98.5, `${name} keyed ${c.toFixed(1)}%`);
  }
});

mtest("Milkmaid: the one tube Zorn's box most needs is a blue (Prussian, then ultramarine)", () => {
  const base = box("zorn"), { n } = milkmaid(), { outs } = reach(M.buildGamut(base), false);
  const ranked = DATA.tubes.filter(t => !base.includes(t))
    .map(t => [t.name, M.tubeGain(base, t, outs, 0.04) / n]).sort((a, b) => b[1] - a[1]);
  assert.deepEqual(ranked.slice(0, 2).map(r => r[0]), ["Prussian blue", "ultramarine blue"], JSON.stringify(ranked.slice(0, 3)));
  for (const [name] of ranked.slice(0, 3)) assert.match(name, /blue/);
});
