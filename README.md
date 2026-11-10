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
- Fast ratio-based solution for single-line headings, measured binary search for wrapping text.
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
width(s) <= targetWidth - 22
height(s) <= targetHeight - 22
12 <= s <= 240
```

With **one parameter**, the heading usually fills only the limiting dimension; exact contact with both frame edges is not generally possible without another degree of freedom. Measurements use line-box geometry, not painted glyph outlines. Normal/wrapped mode can have discontinuities as text moves between lines.

The invisible probe is plain HTML, not a canvas renderer. It uses the actual font metrics and CSS text layout available in the browser.

## Static-site-generator integration

The published website can remain SSG-produced HTML and Tailwind. When an authorized user enters edit mode (`?drag=1`), load `app.js` (or a future reusable editor module) and attach frame controls to selected DOM elements. Persist the **semantic configuration** separately from compiled CSS. In this demo, state is saved in localStorage; no backend publishing is included.

The global `window.constraintStudio` exposes `getState()`, `setState(patch)` and `getSolution()` for experimentation.

## Limitations / possible next steps

- Extend the solver to **two parameters** (`font-size` + `letter-spacing`) and define an objective such as minimizing deviation from default tracking while filling both axes.
- Improve ink-bound geometry support with `Range` measurement or Canvas `TextMetrics` when visual glyph-edge alignment is desired.
- Generalize a `constraint` + `measure` + `solve` schema to arbitrary DOM elements.
- Move style-matched probing to a sandboxed, position-preserving measurement context for complex inherited styles.
- Extract the editing overlay for integration into Eleventy, Astro, Hugo, Jekyll, etc.

## Deploy to GitHub Pages

This is a dependency-free static site; no build step is required.

1. Open [Settings → Pages](https://github.com/dmos62/constraint-studio/settings/pages).
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Set branch **main**, directory **/(root)**, and save.
4. The public URL will be **https://dmos62.github.io/constraint-studio/** once GitHub reports deployment complete.

## License

MIT — see `LICENSE`.
