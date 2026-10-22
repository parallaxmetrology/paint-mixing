// The public entry point and the three questions the README answers, end to end.
"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { ReachMix, Spectral, Steer, Plan, historicalTubes } = require("..");

test("the entry point exposes the four modules and the historical catalogue", () => {
  for (const m of [ReachMix, Spectral, Steer, Plan]) assert.equal(typeof m, "object");
  const H = historicalTubes();
  assert.ok(H.tubes.length > 40 && Object.keys(H.boxes).length > 5);
  assert.equal(Steer.TUBES.length, 33);
});

test("what do I add: a dark pile that should be a little lighter gets white, with an amount", () => {
  const pile = { S: 1, U: 1 };
  const goal = Steer.goalFrom(Steer.colour(pile).lab, { value: 1 });
  const { singles } = Steer.suggest(pile, goal, ["W", "Y", "R", "U", "S"]);
  assert.equal(singles[0].id, "W");
  assert.ok(singles[0].frac > 0 && singles[0].frac < 1);
  assert.match(Steer.amountWords(singles[0].frac), /speck|trace|touch|little|some|half/);
});

test("can these tubes reach it: a mid green from the starter eight, as a recipe", () => {
  const avail = Steer.PALETTES.find(p => p.id === "starter").ids;
  const goal = Steer.colour({ Y: 4, U: 1, W: 2 }).lab;
  const r = Steer.fresh(goal, avail);
  assert.ok(r && r.d < 0.03, `nearest mix is ${r && r.d}`);
  assert.ok(Object.keys(r.parts).every(id => avail.includes(id)));
});

test("a value plan on a two-tone picture gives two in-band piles from a short palette", () => {
  const w = 40, h = 20, n = w * h, px = new Uint8ClampedArray(4 * n);
  for (let i = 0; i < n; i++) { const light = i % w < 20; px.set(light ? [225, 215, 190, 255] : [60, 45, 35, 255], 4 * i); }
  const lab = Plan.toLab(px, n), cuts = Plan.valueCuts(lab.L, 2);
  const M = Plan.masses(lab, cuts);
  const piles = Plan.piles(M.list, cuts, Steer.PALETTES.find(p => p.id === "earth").ids);
  assert.equal(piles.length, 2);
  for (const p of piles) assert.ok(p.inBand, `pile for band ${p.mass.band} reads band ${p.reads}`);
  assert.ok(Plan.paletteOf(piles).length <= 4);
});
