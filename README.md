# paint-mixing

Paint mixing for the questions painters actually ask at the palette:

1. **What do I add?** The pile is nearly right and needs to be a little lighter and warmer. Which paint, how
   much (as a share of the pile), and what else will it do?
2. **Can these tubes reach it?** Given the paints you own, the nearest mix to a colour, as a recipe in parts,
   and how far off it is.
3. **One shared palette for a value plan.** Squint at a picture, cut it into value masses, and choose one
   pile per mass so the plan needs few different tubes, with each pile checked against its value band.

It is a small, dependency-free JavaScript library built on a two-constant Kubelka–Munk model of oil paint.
It runs in Node and in the browser from plain `<script>` tags.

**[Try the demo](https://parallaxmetrology.github.io/paint-mixing/demo/)**: all three questions, with
Vermeer's *Milkmaid* as the value-plan example.

> **The colours are estimates, not measurements.** The paints are modelled from estimated masstones,
> hiding power and tinting strength for ordinary artist-grade oils, not measured spectra of any brand.
> Treat every answer as a first pile and judge it by eye. Directions (which way a paint pushes a pile) are
> far more reliable than absolute colours.

## Use

No package registry yet: clone the repository, or copy the files in `src/`.

```js
const { Steer, Plan, ReachMix, Spectral, historicalTubes } = require("./paint-mixing");
```

In a browser, load the files in this order; they define `window.ReachMix`, `Spectral`, `Steer` and `Plan`:

```html
<script src="src/reach-mix.js"></script>
<script src="src/spectral.js"></script>
<script src="src/steer.js"></script>
<script src="src/plan.js"></script>
```

### 1. What do I add?

Piles are `{ tubeId: parts }` over the 33-paint library in `Steer.TUBES` (`W` titanium white, `Y` cadmium
yellow light, `U` ultramarine, `S` burnt sienna and so on). An ask is the painter's judgement by eye: value,
temperature and intensity, each from −2 (a lot less) to +2 (a lot more).

```js
const pile = { S: 2, U: 1, W: 2 };
const now = Steer.colour(pile);                                // { lab: OKLab, rgb: sRGB bytes }
const asks = { value: 1, temp: 1 };                            // a little lighter, a little warmer
const goal = Steer.goalFrom(now.lab, asks);
const { singles, pair } = Steer.suggest(pile, goal, ["W", "Y", "R", "M", "U", "P", "G", "S"]);

for (const s of singles.slice(0, 2))
  console.log(Steer.BY[s.id].name, Steer.amountWords(s.frac), Steer.fracLabel(s.frac),
              Steer.sideEffects(now.lab, s.c.lab, asks).map(e => e.text));
// Titanium White some ≈ 1/4 of the pile []
// Cadmium Yellow Light some ≈ 1/4 of the pile [ 'more intense' ]
console.log(pair && pair.ids, pair && pair.fracs);              // [ 'W', 'R' ] [ 0.25, 0.0625 ]
```

Amounts are fractions of the pile's current volume, chosen with a small charge for every bit of paint
added, because a correction that doubles the pile turns it to mud. A pair is offered only when two paints
together do clearly better than any one. `Steer.recipe(parts)` collapses a history of additions into a
clean parts recipe, and `Steer.batch(parts, areaCm2, "normal", 0.25)` says how much to mix for an area.

### 2. Can these tubes reach it?

```js
const target = [0, 0, 0];
const [r, g, b] = ReachMix.hexRgb("#6f8a5a");
ReachMix.oklab(ReachMix.toLin(r), ReachMix.toLin(g), ReachMix.toLin(b), target, 0);

const fit = Steer.fresh(target, ["W", "Y", "R", "M", "U", "P", "G", "S"]);
console.log(Steer.recipe(fit.parts).lines, (100 * fit.d).toFixed(1));
// [ { id: 'G', parts: 6 }, { id: 'W', parts: 6 }, { id: 'U', parts: 1 } ] 0.9
```

Every mix of up to three colour tubes plus a white, in simple part ratios, is enumerated once per palette
and indexed on a grid in OKLab, so lookups after the first are instant. `ReachMix.buildGamut`,
`nearestMix` and `tubeGain` work on any tube list. `tubeGain` answers "which one extra tube would bring
the most of this picture within reach?".

`historicalTubes()` returns a second catalogue of 55 historical pigments (lead white, smalt, bone black,
vermilion…) and eleven painters' boxes (Zorn, Sargent, Hopper, Friedrich and others) for the same functions:

```js
const H = historicalTubes(), byName = new Map(H.tubes.map(t => [t.name, t]));
const G = ReachMix.buildGamut(H.boxes.zorn.map(n => byName.get(n)));
const [i, distance] = ReachMix.nearestMix(G, ...target);
// yellow ochre 5 : bone black 4 : lead white 3, distance 4.7
```

### 3. One shared palette for a value plan

```js
const lab = Plan.toLab(rgbaBytes, width * height);            // e.g. from canvas getImageData
const squinted = Plan.squint(lab, width, height, 7);           // blur radius in pixels: a hard squint
const cuts = Plan.valueCuts(squinted.L, 4);                    // four value bands
const masses = Plan.masses(squinted, cuts, { perBand: 2 });
const piles = Plan.piles(masses.list, cuts, ["W", "YO", "RS", "S", "IR", "RU", "BU", "IB", "U"]);
Plan.paletteOf(piles);                                         // the shared palette, most-used first
// each pile: { mass, parts, rgb, recipe, inBand, reads, dE, ... }
```

Recipes are chosen for the whole plan at once: each mass keeps the candidate mixes that stay in its value
band and come close to its colour, and then one per mass is picked to minimise colour error plus a cost for
every different tube the plan needs. On the *Milkmaid* with the earth palette and four values, that gives
six piles from five tubes, all inside their bands. `Plan.accents` gives small, sharply different passages
(a red roof in an ochre field) a pile of their own, and `Plan.quantities` totals what to squeeze out.

## The model

- **Mixing.** Two-constant Kubelka–Munk: each paint has an absorption K and a scattering S. A pile's K and
  S are its paints' values weighted by parts × tinting strength, and the colour is the reflectance of a thick
  layer of that mixture. S comes from each paint's hiding power (one-coat contrast ratio), K from its
  masstone. This part is ported from [claude-paint](https://github.com/aliceisjustplaying/claude-paint).
- **Spectral.** `Steer` and `Plan` mix per wavelength (31 bands, 400–700 nm). Each masstone becomes a
  smooth reflectance curve that reproduces it exactly (the sigmoid-of-a-quadratic form of Jakob & Hanika
  2019), K/S is averaged band by band, and the result goes back to sRGB through an analytic fit of the CIE
  1931 colour-matching functions (Wyman, Sloan & Shirley 2013) under an equal-energy light, adapted to D65.
  Yellow and blue make a real green, and complements cancel to neutral greys rather than olive.
- **Tinting strength.** Each paint's strength is solved so that 1 part paint : 4 parts white lands on an
  estimated tint lightness. One global correction (`DARK_SHIFT`) weakens dark paints, fitted by minimising
  the lightness error over twelve reference mixes (`Steer.REFERENCE_MIXES`). The anchors and targets are
  painters' estimates. They are the first thing a physical tint test should replace, and
  `Steer.setTune(id, factor)` exists for exactly that.
- **Colour space and distance.** OKLab (Ottosson 2020). Value differences count double, because value
  carries a painting where hue forgives. Temperature is a teaching convention (a warm pole near cadmium red
  light), not a perceptual law.

**Known limits.**
- Smooth reflectance curves are broader than real pigments, so red and magenta mixes come out a little dull.
- Yellow plus blue in the three-channel path (`ReachMix.mixLinear`) runs dark and olive.
- Nothing models drying shifts, glazing over a ground or a particular brand.
- The value-plan constants were set by eye on a few pictures and are not validated at the easel.

**Related work.**
- [spectral.js](https://github.com/rvanwijnen/spectral.js) (MIT) is a forward Kubelka–Munk mixer for
  graphics. `src/spectral.js` here is a separate implementation with the same name.
- [Mixbox](https://github.com/scrtwpns/mixbox) models four acrylic primaries under a non-commercial licence.

The contribution here is the painter-side solvers: what to add and how much, reach for a given set of
tubes, and a shared palette across a value plan.

## Files

| file | contents |
|---|---|
| `src/reach-mix.js` | colour conversion, two-constant Kubelka–Munk, mix enumeration, OKLab gamut grid, nearest mix, `tubeGain` |
| `src/spectral.js` | the same mix per wavelength: upsampling, colour matching, `mixLinear` |
| `src/steer.js` | the 33-paint library and palettes; tinting calibration and tuning; "what do I add"; recipes; batch quantities; `fresh` |
| `src/plan.js` | squint, value cuts, masses, accents, shared-palette piles, quantities |
| `src/historical-tubes.js` | 55 historical pigments and eleven painters' boxes, generated from claude-paint's catalogue |
| `index.js` | Node entry point |
| `demo/` | the demo page |
| `test/` | 48 tests: `npm test` (Node 20+; the three *Milkmaid* tests use Python with Pillow and are skipped without it) |

Each engine file is byte-identical to the copy the painting apps on
[parallaxmetrology.com](https://www.parallaxmetrology.com/portfolio.html#f-studio) load: `reach-mix.js` in
Reach, Touch of Paint, Value Plan and the Mixing Room; `spectral.js` in all but Reach; `steer.js` in Touch of
Paint and Value Plan; `plan.js` in Value Plan. SHA-256 prefixes: `reach-mix.js` e6edc5f4c7a6984a,
`spectral.js` 5441d00c24d9f3c2, `steer.js` 8c469afecd329a28, `plan.js` 987d778bbd7d24cc.

`Steer` keeps its paint objects and tuning in module state (strengths are calibrated once at load), so
`setTune` affects every caller in the same process.

## Licence

MIT. See [LICENSE](LICENSE). The Kubelka–Munk model and the historical catalogue derive from claude-paint
(MIT); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## References

- Kubelka, P. & Munk, F. (1931). Ein Beitrag zur Optik der Farbanstriche. *Zeitschrift für technische Physik* 12, 593–601.
- Duncan, D. R. (1940). The colour of pigment mixtures. *Proceedings of the Physical Society* 52, 390–401.
- Jakob, W. & Hanika, J. (2019). A low-dimensional function space for efficient spectral upsampling. *Computer Graphics Forum* 38(2).
- Wyman, C., Sloan, P.-P. & Shirley, P. (2013). Simple analytic approximations to the CIE XYZ color matching functions. *Journal of Computer Graphics Techniques* 2(2).
- Ottosson, B. (2020). A perceptual color space for image processing. https://bottosson.github.io/posts/oklab/
