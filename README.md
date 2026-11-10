# Constraint Studio

An experiment in **inverse DOM layout**: drag the edges of a frame containing a heading, and the browser computes the largest `font-size` that fits the desired dimensions. Inspired by Dragology's declarative, model-driven dragging approach, but intentionally implemented using ordinary HTML, CSS and vanilla JavaScript.

No build step, React, SVG, dependencies or server are required.

## Try it locally

Open `index.html` in a browser, or run a static server:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Features

- Drag right, bottom, or corner handles to resize the heading frame.
- Solve font size from **actual browser measurements**, rather than mapping pointer distance directly to CSS pixels.
- Layout mode uses live DOM box measurements; ink mode uses Canvas `TextMetrics` with the DOM’s actual wrapped lines. Both use ratio fitting for single-line text and binary search for wrapped text.
- Toggle **Layout box** / **Glyph ink** fitting (ink is the default). The pink overlay shows the estimated painted glyph bounds.
- No deliberate frame padding: text starts at the top-left. Ink mode also offsets the actual painted glyphs to the top-left.
- Edit text, choose a font family, adjust `letter-spacing`, and switch between wrapping modes.
- Accessible resize handles with arrow-key support (hold Shift for larger steps).
- Presets, copyable CSS, and autosaved local configuration.
- Entirely client-side; no uploaded text or settings.

## The idea

Regular browser layout maps styles to geometry:

```
DOM + CSS state -> layout geometry
```

This experiment approximately inverts that relationship:

```
target geometry -> candidate CSS state -> DOM measurement -> solve
```

For a proposed font size `s`, the browser measures the rendered heading to obtain `width(s)` and `height(s)`. We choose the largest `s` satisfying:

```
width(s) <= frameInnerWidth
height(s) <= frameInnerHeight
12 <= s <= 240
```

With **one parameter**, the heading usually fills only the limiting dimension; exact contact with both width and height is not generally possible without another degree of freedom. In Layout mode, the browser’s CSS layout box is measured. In Ink mode, DOM `Range` gives actual line breaks, and Canvas `measureText()` provides an estimate of each line’s painted glyph bounds. The text is then translated so its measured ink origin touches the frame’s top-left edge. This is close to painted pixels, but can differ slightly with font fallback, complex shaping, kerning and browser rasterization. The small subpixel safety margin helps avoid clipping. Wrapping is discontinuous when words jump between lines.

The solver measures the *visible heading itself*, within its actual frame. This avoids off-by-one wrapping errors from separate off-screen probes. Intermediate candidate sizes are applied synchronously within one animation frame, so they are not painted. In ink mode the DOM wrapping stays authoritative, with the Canvas metrics used only for each rendered line’s ink extents.

## Static-site-generator integration

The published website can remain SSG-produced HTML and Tailwind. When an authorized user enters edit mode (`?drag=1`), load `app.js` (or a future reusable editor module) and attach frame controls to selected DOM elements. Persist the **semantic configuration** separately from compiled CSS. In this demo, state is saved in localStorage; no backend publishing is included.

The global `window.constraintStudio` exposes `getState()`, `setState(patch)` and `getSolution()` for experimentation.

## Limitations / possible next steps

- Extend the solver to **two parameters** (`font-size` + `letter-spacing`) and define an objective such as minimizing deviation from default tracking while filling both axes.
- Investigate glyph-accurate bounds for more complex scripts and font fallbacks; Canvas metrics are approximate relative to DOM rendering.
- Generalize a `constraint` + `measure` + `solve` schema to arbitrary DOM elements.
- Move style-matched probing to a sandboxed, position-preserving measurement context for complex inherited styles.
- Extract the editing overlay for integration into Eleventy, Astro, Hugo, Jekyll, etc.

## Deploy to GitHub Pages

This is a dependency-free static site; no build step is required.

1. Open [Settings → Pages](https://github.com/dmos62/constraint-studio/settings/pages).
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Set branch **main**, directory **/(root)**, and save.
4. The public URL is **https://dmos62.github.io/constraint-studio/** once GitHub reports deployment complete.

## License

MIT — see `LICENSE`.
