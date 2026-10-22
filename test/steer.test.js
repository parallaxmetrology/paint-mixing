"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), S = require("../src/steer.js");
const ALL = S.TUBES.map(t => t.id);

test("adding a tube is relative to the pile's size", () => {
  const p = S.plus({ S: 2, U: 1, W: 3 }, "Y", 1 / 6);
  assert.equal(p.Y, 1);
  assert.equal(S.total(p), 7);
});

test("scaling a pile does not change its colour", () => {
  const a = S.colour({ S: 1, U: 1, W: 2 }).lab, b = S.colour({ S: 3, U: 3, W: 6 }).lab;
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-6);
});

test("asks move the goal in the asked direction only", () => {
  const lab = S.colour({ S: 1, U: 1, W: 2 }).lab;
  const A = S.axes(lab);
  assert.ok(S.axes(S.goalFrom(lab, { value: 1 })).value > A.value + .04);
  assert.ok(Math.abs(S.axes(S.goalFrom(lab, { value: 1 })).temp - A.temp) < 1e-9);
  assert.ok(S.axes(S.goalFrom(lab, { temp: -1 })).temp < A.temp - .02);
  assert.ok(S.axes(S.goalFrom(lab, { chroma: -1 })).chroma < A.chroma);
});

test("'lighter' on a dark pile is answered with white", () => {
  const pile = { S: 1, U: 1 }, g = S.goalFrom(S.colour(pile).lab, { value: 1 });
  const r = S.suggest(pile, g, ALL);
  assert.equal(r.singles[0].id, "W");
  assert.ok(r.singles[0].d < r.start * .5);
});

test("'darker' never suggests white, 'cooler' never suggests the cadmiums first", () => {
  const pile = { R: 1, Y: 1, W: 2 }, lab = S.colour(pile).lab;
  assert.notEqual(S.suggest(pile, S.goalFrom(lab, { value: -1 }), ALL).singles[0].id, "W");
  const cool = S.suggest(pile, S.goalFrom(lab, { temp: -1 }), ALL);
  assert.ok(!["R", "M"].includes(cool.singles[0].id)); // yellow-orange is the cooler orange
});

test("a suggestion always gets closer than doing nothing", () => {
  for (const pile of [{ S: 2, U: 1, W: 3 }, { G: 2, S: 1, W: 1 }, { M: 1, W: 4 }, { P: 1, Y: 3 }])
    for (const asks of [{ value: 1 }, { value: -2 }, { temp: 1 }, { temp: -1 }, { chroma: 1 }, { chroma: -1 }]) {
      const r = S.suggest(pile, S.goalFrom(S.colour(pile).lab, asks), ALL);
      for (const s of r.singles) assert.ok(s.d < r.start, JSON.stringify({ pile, asks, s: s.id }));
      if (r.pair) assert.ok(r.pair.d < r.singles[0].d);
    }
});

test("an unavailable tube is never suggested", () => {
  const pile = { S: 1, U: 1 }, g = S.goalFrom(S.colour(pile).lab, { value: 1 });
  const r = S.suggest(pile, g, ALL.filter(id => id !== "W"));
  assert.ok(r.singles.every(s => s.id !== "W"));
  assert.ok(!r.pair || !r.pair.ids.includes("W"));
});

test("change words follow the direction of the change", () => {
  const dark = S.colour({ S: 1, U: 1 }).lab, light = S.colour({ S: 1, U: 1, W: 4 }).lab;
  assert.ok(S.change(dark, light).some(c => c.axis === "value" && c.dir > 0 && /lighter/.test(c.text)));
  assert.ok(S.change(light, dark).some(c => c.axis === "value" && c.dir < 0 && /darker/.test(c.text)));
  assert.deepEqual(S.change(dark, dark), []);
});

test("a side effect against the ask is flagged", () => {
  const pile = { S: 1, U: 1, W: 2 }, lab = S.colour(pile).lab;
  const afterU = S.colour(S.plus(pile, "U", 1 / 2)).lab; // ultramarine darkens
  assert.ok(S.sideEffects(lab, afterU, { value: 1 }).some(s => s.against && s.axis === "value"));
});

test("recipe writes the smallest ingredient as one part and keeps traces apart", () => {
  const r = S.recipe({ S: 2.1, U: 1, W: 3.05, Y: .02 });
  assert.deepEqual(r.lines.map(l => [l.id, l.parts]), [["W", 3], ["S", 2], ["U", 1]]);
  assert.deepEqual(r.traces, ["Y"]);
  assert.ok(r.drift < .02);
});

test("fresh recipe lands near a reachable goal", () => {
  const goal = S.colour({ R: 3, S: 1 }).lab, f = S.fresh(goal, ALL);
  assert.ok(f && f.d < .03, f && f.d);
});

test("amount words grow with the amount", () => {
  const order = [1 / 200, 1 / 30, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2].map(S.amountWords);
  assert.equal(new Set(order).size, order.length);
  assert.equal(S.fracLabel(1 / 8), "≈ 1/8 of the pile");
});

test("tuning a tube stronger makes the same addition move further, and resets cleanly", () => {
  const pile = { S: 1, W: 4 }, before = S.colour(pile).lab;
  const moved = () => S.dist(before, S.colour(S.plus(pile, "U", 1 / 8)).lab);
  const base = moved();
  S.nudge("U", S.VERDICT.far);
  assert.ok(moved() > base);
  assert.ok(S.getTune("U") > 1);
  S.loadTune({});
  assert.equal(S.getTune("U"), 1);
  assert.ok(Math.abs(moved() - base) < 1e-12);
});

test("a stronger-tuned tube gets a smaller suggested amount", () => {
  const pile = { S: 1, U: 1, W: 6 }, g = S.goalFrom(S.colour(pile).lab, { value: -1 });
  const f0 = S.bestAmount(pile, "U", g).frac;
  S.setTune("U", 3);
  const f1 = S.bestAmount(pile, "U", g).frac;
  S.loadTune({});
  assert.ok(f1 < f0, `${f1} < ${f0}`);
});

test("white cannot be tuned and tuning is clamped", () => {
  S.setTune("W", 4); assert.equal(S.getTune("W"), 1);
  S.setTune("P", 1000); assert.equal(S.getTune("P"), 8);
  S.loadTune({});
});

test("mix enough keeps the recipe's proportions and adds the margin", () => {
  const b = S.batch({ W: 4, S: 2, U: 1 }, 1000, "normal", .25);
  assert.ok(Math.abs(b.paintMl - 10) < 1e-9);          // 1000 cm² at 100 cm²/ml
  assert.ok(Math.abs(b.totalMl - 12.5) < 1e-9);
  const sum = b.lines.reduce((s, l) => s + l.ml, 0);
  assert.ok(Math.abs(sum - b.totalMl) < 1e-9);
  const by = Object.fromEntries(b.lines.map(l => [l.id, l.ml]));
  assert.ok(Math.abs(by.W / by.U - 4) < 1e-9 && Math.abs(by.S / by.U - 2) < 1e-9);
});

test("thicker paint needs more for the same area", () => {
  const thin = S.batch({ W: 1 }, 500, "thin", 0).totalMl, imp = S.batch({ W: 1 }, 500, "impasto", 0).totalMl;
  assert.ok(imp > thin * 20);
});

test("mix order starts with the biggest pile and leaves the strong tinter for last", () => {
  const b = S.batch({ W: 6, S: 1, P: .5 }, 800, "normal", .25);
  assert.equal(b.order[0], "W");
  assert.equal(b.order[b.order.length - 1], "P");
});

test("size words grow with volume", () => {
  assert.equal(S.sizeWords(.02), "a knife tip");
  assert.equal(S.sizeWords(.2), "a pea");
  assert.equal(S.sizeWords(.4), "2 peas");
  assert.equal(S.sizeWords(1.5), "1.5 hazelnuts");
  assert.equal(S.sizeWords(3.2), "3 hazelnuts");
  assert.equal(S.sizeWords(10), "2 walnuts");
  assert.equal(S.sizeWords(129), "about 3.5 tubes");
});

test("an empty recipe or no area gives no batch", () => {
  assert.equal(S.batch({}, 100, "normal", 0), null);
  assert.equal(S.batch({ W: 1 }, 0, "normal", 0), null);
});

test("every paint calibrates to its 1:4 tint anchor and every palette is valid", () => {
  for (const t of S.TUBES) if (t.id !== "W") assert.ok(Math.abs(S.tint(t.id).lab[0] - t.t14eff) < .005, t.id);
  for (const p of S.PALETTES) {
    assert.ok(p.ids.includes("W"), p.id);
    for (const id of p.ids) assert.ok(S.BY[id], `${p.id}:${id}`);
  }
  assert.equal(new Set(S.TUBES.map(t => t.id)).size, S.TUBES.length);
});

test("suggestions stay inside a small palette", () => {
  const zorn = S.PALETTES.find(p => p.id === "zorn").ids, pile = { W: 3, YO: 1, R: 1 };
  const r = S.suggest(pile, S.goalFrom(S.colour(pile).lab, { value: -1, temp: -1 }), zorn);
  for (const s of r.singles) assert.ok(zorn.includes(s.id));
  assert.equal(r.singles[0].id, "IB"); // in Zorn, black is the cool and the dark
});

test("order of additions doesn't matter: A then B lands exactly where B then A does", () => {
  const pile = { W: 3, S: 1, U: 1 };
  const ab = S.colour(S.addAbs(S.addAbs(pile, [["S", .25]]), [["U", .25 * 5 / 6.25]])).lab; // second add in starting-pile units
  const one = S.colour(S.addAbs(pile, [["S", .25], ["U", .25]])).lab, two = S.colour(S.addAbs(pile, [["U", .25], ["S", .25]])).lab;
  for (let i = 0; i < 3; i++) { assert.ok(Math.abs(one[i] - two[i]) < 1e-12); assert.ok(Math.abs(ab[i] - one[i]) < 1e-9); }
});

test("a path starts at the pile and heads toward the tube's own colour", () => {
  const pile = { W: 4, S: 1 }, p = S.path(pile, "U"), now = S.colour(pile).lab, tube = S.colour({ U: 1 }).lab;
  assert.deepEqual(p[0].lab, now);
  assert.ok(S.dist(p[p.length - 1].lab, tube) < S.dist(now, tube));
});

test("convex hull keeps the corners and drops the inside", () => {
  const h = S.hull2d([[0, 0], [1, 0], [1, 1], [0, 1], [.5, .5], [.2, .7]]);
  assert.equal(h.length, 4);
  assert.ok(!h.some(([x, y]) => x === .5 && y === .5));
});

test("the pile itself is always reachable, a far-off colour is not", () => {
  const pile = { W: 3, YO: 1 }, avail = ["W", "YO", "R", "IB"], s = S.reachSamples(pile, avail);
  assert.equal(S.reachGap(s, S.colour(pile).lab), 0);
  assert.ok(S.reachGap(s, S.colour({ PB: 1, W: 2 }).lab) > .1); // a phthalo tint can't come from a Zorn palette
});

test("in mixing space every addition is a straight line toward the tube", () => {
  const pile = { W: 3, S: 1, U: 1 }, A = S.ksVec(pile), B = S.ksVec({ YO: 1 });
  for (const f of [1 / 32, 1 / 4, 1, 4]) {
    const M = S.ksVec(S.addAbs(pile, [["YO", f]]));
    // M = A + t (B − A) with one t for all three channels, 0 < t < 1
    const ts = [0, 1, 2].map(i => (M[i] - A[i]) / (B[i] - A[i]));
    assert.ok(Math.abs(ts[0] - ts[1]) < 1e-9 && Math.abs(ts[1] - ts[2]) < 1e-9, ts.join());
    assert.ok(ts[0] > 0 && ts[0] < 1);
  }
});

test("the balance projection keeps that line straight", () => {
  const pile = { W: 2, R: 1 }, pts = [0, 1 / 8, 1 / 2, 2].map(f => S.balance(S.ksVec(S.addAbs(pile, [["U", f]]))));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  for (let i = 2; i < pts.length; i++) assert.ok(Math.abs(cross(pts[0], pts[1], pts[i])) < 1e-12);
});

test("a mix's balance is inside its palette's hull; a phthalo balance is outside an earth palette's", () => {
  const earth = S.PALETTES.find(p => p.id === "earth").ids, hull = S.hull2d(earth.map(id => S.balance(S.ksVec({ [id]: 1 }))));
  assert.ok(S.insideHull(hull, S.balance(S.ksVec({ W: 2, YO: 1, U: .3 }))));
  assert.ok(!S.insideHull(hull, S.balance(S.ksVec({ PG: 1 }))));
});

test("K/S read back from a colour agrees with a mix's own K/S", () => {
  const p = { W: 3, S: 1 }, a = S.ksVec(p), b = S.ksOfLab(S.colour(p).lab);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - b[i]) / a[i] < .05, `${a[i]} ${b[i]}`);
});

test("the shipped dark-paint shift is the fitted one and beats no shift on the reference mixes", () => {
  const rms = shift => { S.calibrate(shift); const e = S.REFERENCE_MIXES.map(m => (S.colour(m.parts).lab[0] - m.L) ** 2); return Math.sqrt(e.reduce((a, b) => a + b, 0) / e.length); };
  let best = 0, bestE = Infinity;
  for (let x = 0; x <= .2 + 1e-9; x += .005) { const e = rms(x); if (e < bestE) { bestE = e; best = x; } }
  const before = rms(0), shipped = rms(S.DARK_SHIFT);
  S.calibrate();
  assert.ok(Math.abs(best - S.DARK_SHIFT) < .006, `fit ${best} vs shipped ${S.DARK_SHIFT}`);
  assert.ok(shipped < before * .5, `${shipped} vs ${before}`);
});

test("red-and-blue mixes land in the right families, and get painter names", () => {
  const hue = p => { const l = S.colour(p).lab; return (Math.atan2(l[2], l[1]) * 180 / Math.PI + 360) % 360; };
  const name = p => S.describe(S.colour(p).lab);
  const R_U = hue({ R: 1, U: 1 });
  assert.ok(R_U >= 20 && R_U < 75, `cad red light + ultramarine should be a brown, hue ${R_U}`);
  assert.match(name({ R: 1, U: 1 }), /brown/);
  const Y_U = hue({ Y: 1, U: 1 });
  assert.ok(Y_U >= 130 && Y_U < 175, `spectral: cad yellow + ultramarine should be a real green, hue ${Y_U}`);
  assert.ok(S.chroma(S.colour({ S: 1, U: 1 }).lab) < .03, "sienna + ultramarine stays near neutral");
  for (const id of ["AC", "QR"]) { const h = hue({ [id]: 1, U: 1 }); assert.ok(h >= 280 && h < 335, `${id} + ultramarine should be violet, hue ${h}`); }
  // spectral: true complements cancel to near-neutral instead of drifting olive
  for (const p of [{ Y: 1, DP: 1 }, { AC: 1, PG: 1 }, { IR: 1, CE: 1 }]) assert.ok(S.chroma(S.colour(p).lab) < .04, JSON.stringify(p));
  assert.doesNotMatch(name({ R: 1, U: 1 }), /greyed yellow/);
  assert.match(name({ M: 1, U: 1 }), /violet|plum/); // spectral mixes a little duller: a dark plum-violet
});
