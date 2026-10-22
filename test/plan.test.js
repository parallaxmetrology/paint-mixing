// node plan.test.js — checks the analysis on a synthetic picture with known value masses.
"use strict";
const assert = require("assert"), P = require("../src/plan.js"), S = require("../src/steer.js");
let pass = 0; const ok = (name, f) => { f(); pass++; console.log("ok", name); };

// 120 × 80: a light sky (top half), a mid green field, a dark tree block, a tiny red dot (too small to plan).
const w = 120, h = 80, n = w * h, px = new Uint8ClampedArray(4 * n);
const put = (i, [r, g, b]) => { px[4 * i] = r; px[4 * i + 1] = g; px[4 * i + 2] = b; px[4 * i + 3] = 255; };
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = y * w + x;
  let c = y < 40 ? [200, 215, 230] : [110, 140, 70];
  if (x > 80 && x < 105 && y > 20 && y < 70) c = [35, 50, 30];
  if (x > 10 && x < 13 && y > 60 && y < 63) c = [200, 30, 30];
  put(i, c);
}
const lab = P.toLab(px, n);

ok("three values split sky, field and tree", () => {
  const cuts = P.valueCuts(lab.L, 3);
  assert.strictEqual(cuts.length, 2);
  const sky = P.bandOf(lab.L[5 * w + 5], cuts), field = P.bandOf(lab.L[50 * w + 30], cuts), tree = P.bandOf(lab.L[40 * w + 90], cuts);
  assert.deepStrictEqual([sky, field, tree], [2, 1, 0]);
});
ok("masses: one per band, the tiny red dot folded in", () => {
  const cuts = P.valueCuts(lab.L, 3), m = P.masses(lab, cuts);
  assert.strictEqual(m.list.length, 3);
  assert.deepStrictEqual(m.list.map(x => x.band), [2, 1, 0]); // light to dark
  assert.ok(Math.abs(m.list.reduce((s, x) => s + x.area, 0) - 1) < 1e-9);
});
ok("two colours in one value band stay two masses", () => {
  const p2 = new Uint8ClampedArray(4 * n);
  for (let i = 0; i < n; i++) { const c = (i % w) < 60 ? [190, 120, 110] : [120, 150, 190]; p2.set([...c, 255], 4 * i); } // similar value, warm vs cool
  const l2 = P.toLab(p2, n), m = P.masses(l2, [0.2], { perBand: 3 });
  assert.strictEqual(m.list.length, 2);
});
ok("squint keeps the mean and softens edges", () => {
  const s = P.squint(lab, w, h, 6), avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(Math.abs(avg(s.L) - avg(lab.L)) < .01);
  assert.ok(Math.abs(s.L[40 * w + 81] - lab.L[40 * w + 81]) > .02);
});
ok("piles: a recipe per mass, value check reported", () => {
  const cuts = P.valueCuts(lab.L, 3), m = P.masses(lab, cuts), pl = P.piles(m.list, cuts, S.PALETTES[0].ids);
  assert.strictEqual(pl.length, 3);
  for (const p of pl) { assert.ok(!p.none && p.recipe.lines.length); assert.ok(typeof p.inBand === "boolean"); assert.ok(p.dE < .12, `dE ${p.dE}`); }
  assert.ok(pl.every(p => p.inBand), "simple masses should mix inside their bands");
});
ok("quantities add up across piles", () => {
  const cuts = P.valueCuts(lab.L, 3), m = P.masses(lab, cuts), pl = P.piles(m.list, cuts, S.PALETTES[0].ids);
  const q = P.quantities(pl, 40 * 50, "normal", 0);
  assert.ok(Math.abs(q.totalMl - 2000 / 100) < 1e-6);
  assert.ok(q.squeeze.some(t => t.id === "W"));
});
ok("a palette that can't reach the hue still holds the value", () => {
  const list = [{ id: 0, band: 1, lab: [.55, -.03, -.15], area: 1 }]; // a blue, and Zorn has no blue
  const p = P.piles(list, [.4, .7], S.PALETTES.find(x => x.id === "zorn").ids)[0];
  assert.ok(p.inBand && Math.abs(p.dL) < .02 && p.dE > .06);
  // the band starts just above the target: the nearest mix would fall short, so an in-band one is chosen instead
  const q = P.piles([{ id: 0, band: 1, lab: [.55, 0, 0], area: 1 }], [.56, .7], ["W", "IB"])[0];
  assert.ok(q.inBand && q.lab[0] >= .56);
});
ok("a shared palette uses fewer tubes than choosing each pile alone", () => {
  const all = S.TUBES.map(t => t.id);
  const list = [[.85, -.01, -.03], [.72, .01, .06], [.6, -.04, .05], [.5, -.02, -.04], [.4, .02, .03], [.28, -.02, .01], [.62, .1, .07]]
    .map((lab, k) => ({ id: k, band: 0, lab, area: 1 / 7 }));
  const alone = P.piles(list, [], all, { shared: false }), shared = P.piles(list, [], all);
  const nA = P.paletteOf(alone).length, nS = P.paletteOf(shared).length;
  assert.ok(nS < nA, `shared ${nS} vs alone ${nA}`);
  assert.ok(shared.every(p => p.dE < .06), "sharing must not wreck any pile");
});
ok("a small, sharply different patch becomes an accent pile", () => {
  const p3 = new Uint8ClampedArray(4 * n);
  for (let i = 0; i < n; i++) { const x = i % w, y = (i / w) | 0; const c = x > 50 && x < 60 && y > 30 && y < 38 ? [190, 70, 50] : [170, 150, 100]; p3.set([...c, 255], 4 * i); }
  const l3 = P.toLab(p3, n), cuts = [.2], m = P.masses(l3, cuts); // one band holds both colours
  assert.ok(!m.list.some(x => x.lab[1] > .08), "the red patch is under MIN_AREA, so masses alone lose it");
  P.accents(m, l3, cuts);
  const acc = m.list.filter(x => x.accent);
  assert.strictEqual(acc.length, 1); assert.ok(acc[0].lab[1] > .08);
  assert.ok(Math.abs(m.list.reduce((s, x) => s + x.area, 0) - 1) < 1e-6);
});
ok("munsell scale ends", () => { assert.ok(P.munsell(1) > 9.9); assert.strictEqual(P.munsell(0), 0); });
console.log(`${pass} passed`);
