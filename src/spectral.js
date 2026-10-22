// Spectral mixing for Touch of Paint (branch). Same two-constant Kubelka–Munk as reach-mix, but per wavelength
// (31 bands, 400–700 nm) instead of per RGB channel. Three channels can't tell orange+blue apart from a green
// light source, so complements drift olive; spectra cancel properly.
// Pipeline: a tube's masstone sRGB → a smooth reflectance curve that reproduces it exactly (sigmoid of a quadratic
// in wavelength, after Jakob & Hanika 2019) → K/S per band → mix by weighted average → reflectance → CIE 1931
// colour matching (Wyman, Sloan & Shirley 2013 analytic fit) under an equal-energy light, Bradford-adapted to D65
// → linear sRGB. Everything is deterministic; nothing here is measured paint data.
"use strict";
(function (root) {
const RM = typeof module !== "undefined" && module.exports ? require("./reach-mix.js") : root.ReachMix;

const WL = []; for (let l = 400; l <= 700; l += 10) WL.push(l);
const N = WL.length;

// CIE 1931 2° colour matching functions, piecewise-Gaussian fit.
const g = (x, mu, s1, s2) => { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-.5 * t * t); };
const xbar = l => 1.056 * g(l, 599.8, 37.9, 31.0) + .362 * g(l, 442.0, 16.0, 26.7) - .065 * g(l, 501.1, 20.4, 26.2);
const ybar = l => .821 * g(l, 568.8, 46.9, 40.5) + .286 * g(l, 530.9, 16.3, 31.1);
const zbar = l => 1.217 * g(l, 437.0, 11.8, 36.0) + .681 * g(l, 459.0, 26.0, 13.8);

const mul = (A, B) => A.map(r => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
const inv3 = m => {
  const [a, b, c] = m[0], [d, e, f] = m[1], [gg, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * gg), C = d * h - e * gg, det = a * A + b * B + c * C;
  return [[A, -(b * i - c * h), b * f - c * e], [B, a * i - c * gg, -(a * f - c * d)], [C, -(a * h - b * gg), a * e - b * d]].map(r => r.map(v => v / det));
};
// Bands → XYZ (equal-energy light, Y of a perfect white = 1).
const ySum = WL.reduce((s, l) => s + ybar(l), 0);
const CMF = [WL.map(l => xbar(l) / ySum), WL.map(l => ybar(l) / ySum), WL.map(l => zbar(l) / ySum)];
const whiteE = CMF.map(r => r.reduce((s, v) => s + v, 0));
// Bradford adaptation from that white to D65, then XYZ → linear sRGB.
const BFD = [[.8951, .2664, -.1614], [-.7502, 1.7135, .0367], [.0389, -.0685, 1.0296]];
const D65 = [.95047, 1, 1.08883];
const lmsS = BFD.map(r => r[0] * whiteE[0] + r[1] * whiteE[1] + r[2] * whiteE[2]);
const lmsD = BFD.map(r => r[0] * D65[0] + r[1] * D65[1] + r[2] * D65[2]);
const ADAPT = mul(mul(inv3(BFD), [0, 1, 2].map(i => [0, 1, 2].map(j => i === j ? lmsD[i] / lmsS[i] : 0))), BFD);
const XYZ2RGB = [[3.2404542, -1.5371385, -.4985314], [-.9692660, 1.8760108, .0415560], [.0556434, -.2040259, 1.0572252]];
const M = mul(mul(XYZ2RGB, ADAPT), CMF); // 3 × N: reflectance bands → linear sRGB
function toLinRGB(R) { return M.map(row => row.reduce((s, v, k) => s + v * R[k], 0)); }

// Reflectance from three numbers: R(λ) = sigmoid(c0 + c1 t + c2 t²), t = (λ − 550) / 150. Smooth and inside (0, 1).
const T = WL.map(l => (l - 550) / 150);
const sig = x => .5 + x / (2 * Math.sqrt(1 + x * x)); // Jakob–Hanika's algebraic sigmoid: no saturation cliff
function curve(c) { return T.map(t => sig(c[0] + c[1] * t + c[2] * t * t)); }
// Fit c so the curve reproduces a target linear-sRGB colour. Levenberg–Marquardt with a numeric Jacobian.
function upsample(lin) {
  const tgt = lin.map(v => Math.min(.999, Math.max(.0005, v)));
  const lum = .2126 * tgt[0] + .7152 * tgt[1] + .0722 * tgt[2];
  let c = [(2 * lum - 1) / Math.sqrt(1 - (2 * lum - 1) ** 2), 0, 0], lambda = 1e-3;
  const res = cc => { const o = toLinRGB(curve(cc)); return o.map((v, i) => v - tgt[i]); };
  let r = res(c), e = r.reduce((s, v) => s + v * v, 0);
  for (let it = 0; it < 200 && e > 1e-12; it++) {
    const J = [0, 1, 2].map(k => { const d = c.slice(); d[k] += 1e-5; return res(d).map((v, i) => (v - r[i]) / 1e-5); }); // J[k][i]
    const JTJ = [0, 1, 2].map(a => [0, 1, 2].map(b => J[a].reduce((s, v, i) => s + v * J[b][i], 0)));
    const JTr = [0, 1, 2].map(a => J[a].reduce((s, v, i) => s + v * r[i], 0));
    let stepped = false;
    for (let tries = 0; tries < 12 && !stepped; tries++) {
      const A = JTJ.map((row, a) => row.map((v, b) => v + (a === b ? lambda * (v + 1e-9) : 0)));
      let delta; try { delta = mul(inv3(A), JTr.map(v => [v])).map(v => -v[0]); } catch { delta = null; }
      if (!delta || delta.some(v => !Number.isFinite(v))) { lambda *= 10; continue; }
      const c2 = c.map((v, k) => v + delta[k]), r2 = res(c2), e2 = r2.reduce((s, v) => s + v * v, 0);
      if (e2 < e) { c = c2; r = r2; e = e2; lambda = Math.max(1e-9, lambda / 3); stepped = true; } else lambda *= 10;
    }
    if (!stepped) break;
  }
  return { c, R: curve(c), err: Math.sqrt(e) };
}

const ksOfR = r => { r = Math.min(.995, Math.max(.002, r)); return (1 - r) * (1 - r) / (2 * r); };
const fromKS = k => 1 + k - Math.sqrt(k * k + 2 * k);
// A tube's masstone spectrum and per-band K/S, cached on the tube (scatter S comes from reach-mix's hiding fit).
function spectrumOf(t) {
  if (!t._spec) {
    RM.ksOf(t); // sets t._S
    const lin = RM.hexRgb(t.hex).map(RM.toLin), up = upsample(lin);
    t._spec = { R: up.R, ks: up.R.map(ksOfR), err: up.err };
  }
  return t._spec;
}
// Same signature as ReachMix.mixLinear: tubes and parts → linear sRGB of the pile's masstone.
function mixLinear(ts, ps) {
  const ks = new Array(N).fill(0); let sum = 0;
  for (let i = 0; i < ts.length; i++) {
    if (!ps[i]) continue;
    const sp = spectrumOf(ts[i]), w = ps[i] * ts[i].strength * ts[i]._S;
    for (let k = 0; k < N; k++) ks[k] += w * sp.ks[k];
    sum += w;
  }
  return toLinRGB(ks.map(v => fromKS(v / sum))).map(v => Math.min(1, Math.max(0, v)));
}
// Per-band K/S of a pile (for the mixing-space view), and of an arbitrary colour via upsampling.
function ksBands(ts, ps) {
  const ks = new Array(N).fill(0); let sum = 0;
  for (let i = 0; i < ts.length; i++) {
    if (!ps[i]) continue;
    const sp = spectrumOf(ts[i]), w = ps[i] * ts[i].strength * ts[i]._S;
    for (let k = 0; k < N; k++) ks[k] += w * sp.ks[k];
    sum += w;
  }
  return ks.map(v => v / sum);
}
const ksBandsOfLin = lin => upsample(lin).R.map(ksOfR);

const Spectral = { WL, M, toLinRGB, upsample, curve, spectrumOf, mixLinear, ksBands, ksBandsOfLin };
if (typeof module !== "undefined" && module.exports) module.exports = Spectral; else root.Spectral = Spectral;
})(typeof window !== "undefined" ? window : globalThis);
