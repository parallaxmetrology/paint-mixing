// Node entry point. The four modules also load in a browser with plain <script> tags (see demo/).
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ReachMix = require("./src/reach-mix.js"); // colour conversion, two-constant Kubelka–Munk, gamut grid, nearest mix
const Spectral = require("./src/spectral.js");  // the same mix per wavelength (31 bands)
const Steer = require("./src/steer.js");        // 33-paint library; "what do I add?"; recipes; batch quantities
const Plan = require("./src/plan.js");          // value masses from a picture and one shared palette for them
let historical = null;
function historicalTubes() { // Reach's catalogue of historical tubes and painters' boxes, derived from claude-paint
  if (!historical) {
    const ctx = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "src", "historical-tubes.js"), "utf8"), ctx);
    historical = JSON.parse(JSON.stringify(ctx.window.REACH_DATA)); // plain objects in this context, not the sandbox's
  }
  return historical;
}
module.exports = { ReachMix, Spectral, Steer, Plan, historicalTubes };
