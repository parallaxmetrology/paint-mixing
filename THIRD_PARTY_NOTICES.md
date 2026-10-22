# Third-party notices

## claude-paint

The two-constant Kubelka–Munk model in `src/reach-mix.js` is ported from claude-paint
(`crates/paint/src/pigment.rs`: scattering from one-coat hiding, absorption from the masstone, and the
concentration model of its `notes/spectral.md` and `notes/tints.md`). The historical tube catalogue in
`src/historical-tubes.js` is generated from its `crates/paint/src/palette.rs`. The fourteen paints marked
`src: "cp"` in `src/steer.js` take their masstone and hiding from that catalogue.

https://github.com/aliceisjustplaying/claude-paint

```
MIT License

Copyright (c) 2026 alice

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

claude-paint itself includes code ported from spectral.js (Ronald van Wijnen, MIT). This library does not
use that part: `src/spectral.js` here is a separate implementation (Jakob–Hanika upsampling and the
Wyman–Sloan–Shirley colour-matching fit), despite the shared file name.

## Example image

`examples/milkmaid.jpg`: Johannes Vermeer, *The Milkmaid*, c. 1660, Rijksmuseum, Amsterdam (SK-A-2344).
Public domain; a 1257 × 1400 px copy.
