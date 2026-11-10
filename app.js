/**
 * Constraint Studio — dependency-free inverse DOM layout experiment.
 * The interaction describes target dimensions; the browser supplies the
 * actual text geometry, and the solver finds a CSS font size that fits.
 */
const $ = (selector) => document.querySelector(selector);
const MIN_WIDTH = 205;
const MIN_HEIGHT = 85;
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 240;
const STORAGE_KEY = 'constraint-studio:v1';
const INK_SAFETY = 0.6; // Subpixel tolerance for rasterized glyphs.

const defaults = Object.freeze({
  text: 'Selected\nWorks',
  width: 620,
  height: 170,
  wrap: false,
  family: 'sans',
  tracking: -0.035,
  fit: 'ink',
});
const presets = {
  display: { text: 'Make an\nimpact.', width: 620, height: 190, wrap: false, family: 'sans', tracking: -0.055 },
  editorial: { text: 'The quiet art\nof noticing', width: 530, height: 218, wrap: true, family: 'serif', tracking: -0.035 },
  compact: { text: 'Objects & Spaces', width: 470, height: 120, wrap: false, family: 'mono', tracking: -0.06 },
};
const els = {
  canvas: $('#canvas'), frame: $('#frame'), frameInner: $('#frame-inner'), headline: $('#headline'),
  title: $('#headline-input'), modeSingle: $('#mode-single'), modeWrap: $('#mode-wrap'),
  modeLayout: $('#mode-layout'), modeInk: $('#mode-ink'), inkOutline: $('#ink-outline'),
  font: $('#font-select'), tracking: $('#tracking-input'), trackingOutput: $('#tracking-output'),
  dimWidth: $('#dim-width'), dimHeight: $('#dim-height'),
  size: $('#metric-size'), textRect: $('#metric-text-rect'), axis: $('#metric-axis'), method: $('#metric-method'),
  copy: $('#copy-css'), reset: $('#reset'), saveNote: $('#save-note'),
};
const families = {
  sans: "'DM Sans', Arial, sans-serif",
  serif: "'Playfair Display', Georgia, serif",
  mono: "'DM Mono', Consolas, monospace",
};

function validState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = typeof raw.text === 'string' ? raw.text.slice(0, 120) : defaults.text;
  return {
    text,
    width: finiteRange(raw.width, MIN_WIDTH, 1400, defaults.width),
    height: finiteRange(raw.height, MIN_HEIGHT, 600, defaults.height),
    wrap: Boolean(raw.wrap),
    family: Object.hasOwn(families, raw.family) ? raw.family : defaults.family,
    tracking: finiteRange(raw.tracking, -.08, .16, defaults.tracking),
    fit: raw.fit === 'layout' ? 'layout' : 'ink',
  };
}
function finiteRange(raw, min, max, fallback) {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : fallback;
}
function load() {
  try { return validState(JSON.parse(localStorage.getItem(STORAGE_KEY))) ?? { ...defaults }; }
  catch { return { ...defaults }; }
}
let state = load();
let currentSize = 64;
let lastBounds = { width: 0, height: 0 };
let lastInk = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
let lastOffset = { x: 0, y: 0 };
let raf = 0;
let dragging = null;

// Measure the real heading in its real wrapping context. In ink mode,
// Canvas TextMetrics measures each line's glyph outlines; DOM Ranges supply
// the browser's actual wrap boundaries and line positions.
const inkContext = document.createElement('canvas').getContext('2d');
const textRange = document.createRange();

function frameBounds() {
  const canvasWidth = els.canvas.clientWidth;
  return {
    width: Math.max(Math.min(MIN_WIDTH, canvasWidth - 52), Math.min(state.width, canvasWidth - 52)),
    height: state.height,
  };
}

function applyTypography(element, fontSize) {
  element.textContent = state.text.replace(/\s*\n\s*/g, state.wrap ? ' ' : ' ');
  element.style.fontFamily = families[state.family];
  element.style.setProperty('--heading-size', `${fontSize}px`);
  element.style.setProperty('--heading-tracking', `${state.tracking}em`);
  element.style.fontWeight = state.family === 'mono' ? '500' : '700';
  element.classList.toggle('is-wrapped', state.wrap);
}

/** Bounds of the live heading's CSS layout box (no CSS transforms applied). */
function layoutBounds() {
  const rect = els.headline.getBoundingClientRect();
  return { left: 0, top: 0, width: Math.max(rect.width, els.headline.scrollWidth),
    height: Math.max(rect.height, els.headline.scrollHeight) };
}

/** Locate the browser's line breaks without estimating text widths ourselves. */
function renderedLines() {
  const node = els.headline.firstChild;
  if (!node || !node.textContent) return [];
  const text = node.textContent;
  textRange.selectNodeContents(node);
  const rects = Array.from(textRange.getClientRects()).filter(r => r.width > 0 && r.height > 0);
  if (!rects.length) return [];
  if (rects.length === 1) return [{ text, rect: rects[0] }];

  // A range over one character gives its actual line. Binary search for each
  // next line boundary, so measurement scales with lines rather than letters.
  const charRange = document.createRange();
  function charTop(index) {
    charRange.setStart(node, index);
    charRange.setEnd(node, index + 1);
    const rect = charRange.getClientRects()[0];
    return rect ? rect.top : -Infinity;
  }
  const lines = [];
  let start = 0;
  for (let i = 0; i < rects.length; i++) {
    let end = text.length;
    if (i + 1 < rects.length) {
      const nextTop = rects[i + 1].top;
      let lo = start, hi = text.length;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (charTop(mid) < nextTop - 0.5) lo = mid + 1;
        else hi = mid;
      }
      end = lo;
    }
    lines.push({ text: text.slice(start, end).trimEnd(), rect: rects[i] });
    start = end;
  }
  return lines;
}

/**
 * Estimate painted glyph bounds. Canvas measures actual outlines, while DOM
 * Ranges provide the browser's true text wrapping and line coordinates.
 * Font fallback, shaping and line-box baselines can differ slightly between
 * Canvas and DOM, hence the small subpixel safety margin in the ink solver.
 */
function inkBounds() {
  const lines = renderedLines();
  const elRect = els.headline.getBoundingClientRect();
  if (!lines.length || !inkContext) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  const css = getComputedStyle(els.headline);
  inkContext.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
  inkContext.textAlign = 'left';
  inkContext.textBaseline = 'alphabetic';
  // Supported by modern Canvas implementations; in older browsers tracking
  // may be approximated in ink mode, but CSS/layout mode is unaffected.
  if ('letterSpacing' in inkContext) inkContext.letterSpacing = css.letterSpacing;

  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const line of lines) {
    if (!line.text.trim()) continue;
    const metrics = inkContext.measureText(line.text);
    const originX = line.rect.left - elRect.left;
    const originY = line.rect.top - elRect.top;
    const ascent = metrics.fontBoundingBoxAscent ?? parseFloat(css.fontSize) * 0.8;
    const lineLeft = originX - metrics.actualBoundingBoxLeft;
    const lineTop = originY + ascent - metrics.actualBoundingBoxAscent;
    left = Math.min(left, lineLeft);
    right = Math.max(right, originX + metrics.actualBoundingBoxRight);
    top = Math.min(top, lineTop);
    bottom = Math.max(bottom, originY + ascent + metrics.actualBoundingBoxDescent);
  }
  if (!Number.isFinite(left)) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function solve(availableWidth, availableHeight) {
  // Don't let the previous ink correction move our DOM measurements.
  els.headline.style.transform = 'none';
  let count = 0;
  function measure(size) {
    applyTypography(els.headline, size);
    const bounds = state.fit === 'ink' ? inkBounds() : layoutBounds();
    count++;
    return bounds;
  }
  const fits = (rect) => rect.width <= availableWidth - (state.fit === 'ink' ? INK_SAFETY : 0)
    && rect.height <= availableHeight - (state.fit === 'ink' ? INK_SAFETY : 0);

  let size;
  let bounds;
  let method;
  if (!state.wrap) {
    // On a single line, ink and layout dimensions both scale approximately
    // with font size (including em-based tracking). Correct with bisection
    // if the proportional prediction overshoots.
    const base = measure(100);
    const usableWidth = availableWidth - (state.fit === 'ink' ? INK_SAFETY : 0);
    const usableHeight = availableHeight - (state.fit === 'ink' ? INK_SAFETY : 0);
    const estimate = 100 * Math.min(usableWidth / Math.max(.001, base.width), usableHeight / Math.max(.001, base.height));
    size = finiteRange(estimate, MIN_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE);
    bounds = measure(size);
    if (!fits(bounds)) {
      let lo = MIN_FONT_SIZE, hi = size;
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        if (fits(measure(mid))) lo = mid;
        else hi = mid;
      }
      size = lo;
      bounds = measure(size);
    }
    method = 'Ratio × ' + count;
  } else {
    // Wrapping changes discontinuously; use the real browser's line breaks
    // and geometry at every candidate size. No approximate wrap simulation.
    let lo = MIN_FONT_SIZE;
    let hi = MAX_FONT_SIZE;
    for (let i = 0; i < 15; i++) {
      const mid = (lo + hi) / 2;
      if (fits(measure(mid))) lo = mid;
      else hi = mid;
    }
    size = lo;
    bounds = measure(size);
    method = 'Search × ' + count;
  }
  // Always compute ink bounds once for the overlay, even in layout mode.
  // These reflect the final font size and actual line wrapping.
  const ink = state.fit === 'ink' ? bounds : inkBounds();
  const widthSlack = availableWidth - bounds.width;
  const heightSlack = availableHeight - bounds.height;
  const axis = widthSlack / availableWidth < heightSlack / availableHeight ? 'Width' : 'Height';
  return { size, bounds, ink, axis, method };
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { els.saveNote.textContent = 'Local save unavailable in this browser'; }
}
function draw() {
  raf = 0;
  const bounds = frameBounds();
  els.frame.style.width = `${bounds.width}px`;
  els.frame.style.height = `${bounds.height}px`;
  // Read the effective inner dimensions, including frame borders and any
  // future CSS changes to the inset. Never estimate the usable area.
  const inner = els.frameInner.getBoundingClientRect();
  const solution = solve(inner.width, inner.height);
  const offset = state.fit === 'ink' ? { x: -solution.ink.left, y: -solution.ink.top } : { x: 0, y: 0 };
  // This is a paint-only correction; it doesn't affect line wrapping.
  // The measured ink rect now meets the inner frame's top-left edges.
  els.headline.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
  els.inkOutline.style.left = `${solution.ink.left + offset.x}px`;
  els.inkOutline.style.top = `${solution.ink.top + offset.y}px`;
  els.inkOutline.style.width = `${Math.max(0, solution.ink.width)}px`;
  els.inkOutline.style.height = `${Math.max(0, solution.ink.height)}px`;
  currentSize = solution.size;
  lastBounds = solution.bounds;
  lastInk = solution.ink;
  lastOffset = offset;
  // The solver already applied its last candidate. Restore the chosen size.
  applyTypography(els.headline, solution.size);
  els.dimWidth.textContent = `${Math.round(bounds.width)} px`;
  els.dimHeight.textContent = `${Math.round(bounds.height)} px`;
  els.size.textContent = solution.size.toFixed(1);
  els.textRect.textContent = `${Math.round(solution.bounds.width)} × ${Math.round(solution.bounds.height)}`;
  els.axis.textContent = solution.axis;
  els.method.textContent = solution.method;
  els.modeSingle.setAttribute('aria-pressed', String(!state.wrap));
  els.modeWrap.setAttribute('aria-pressed', String(state.wrap));
  els.modeLayout.setAttribute('aria-pressed', String(state.fit === 'layout'));
  els.modeInk.setAttribute('aria-pressed', String(state.fit === 'ink'));
  els.trackingOutput.value = `${state.tracking < 0 ? '−' : '+'}${Math.abs(state.tracking).toFixed(3)} em`;
}
function scheduleDraw() {
  if (!raf) raf = requestAnimationFrame(draw);
}
function update(patch, { sync = false } = {}) {
  state = validState({ ...state, ...patch });
  if (sync) syncInputs();
  persist();
  scheduleDraw();
}
function syncInputs() {
  els.title.value = state.text;
  els.font.value = state.family;
  els.tracking.value = String(state.tracking);
  els.modeSingle.setAttribute('aria-pressed', String(!state.wrap));
  els.modeWrap.setAttribute('aria-pressed', String(state.wrap));
  els.modeLayout.setAttribute('aria-pressed', String(state.fit === 'layout'));
  els.modeInk.setAttribute('aria-pressed', String(state.fit === 'ink'));
}

els.title.addEventListener('input', () => update({ text: els.title.value }));
els.font.addEventListener('change', () => update({ family: els.font.value }));
els.tracking.addEventListener('input', () => update({ tracking: Number(els.tracking.value) }));
els.modeSingle.addEventListener('click', () => update({ wrap: false }));
els.modeWrap.addEventListener('click', () => update({ wrap: true }));
els.modeLayout.addEventListener('click', () => update({ fit: 'layout' }));
els.modeInk.addEventListener('click', () => update({ fit: 'ink' }));
for (const button of document.querySelectorAll('[data-preset]')) {
  button.addEventListener('click', () => update(presets[button.dataset.preset], { sync: true }));
}
els.reset.addEventListener('click', () => update({ ...defaults }, { sync: true }));

for (const handle of document.querySelectorAll('[data-resize]')) {
  const direction = handle.dataset.resize;
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const effective = frameBounds();
    dragging = { pointerId: event.pointerId, direction, x: event.clientX, y: event.clientY, width: effective.width, height: effective.height };
    els.frame.classList.add('is-dragging');
    handle.classList.add('active');
  });
  handle.addEventListener('pointermove', (event) => {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const patch = {};
    if (direction !== 'height') patch.width = Math.max(MIN_WIDTH, Math.min(1400, dragging.width + event.clientX - dragging.x));
    if (direction !== 'width') patch.height = Math.max(MIN_HEIGHT, Math.min(600, dragging.height + event.clientY - dragging.y));
    update(patch);
  });
  function finish(event) {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    dragging = null;
    els.frame.classList.remove('is-dragging');
    handle.classList.remove('active');
  }
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('lostpointercapture', finish);
  handle.addEventListener('keydown', (event) => {
    const delta = event.shiftKey ? 20 : 5;
    const patch = {};
    if ((direction === 'width' || direction === 'both') && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      patch.width = frameBounds().width + (event.key === 'ArrowRight' ? delta : -delta);
    }
    if ((direction === 'height' || direction === 'both') && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      patch.height = state.height + (event.key === 'ArrowDown' ? delta : -delta);
    }
    if (Object.keys(patch).length) { event.preventDefault(); update(patch); }
  });
}

els.copy.addEventListener('click', async () => {
  const css = `/* Generated by Constraint Studio */\n.hero-title {\n  font-family: ${families[state.family]};\n  font-size: ${currentSize.toFixed(2)}px;\n  letter-spacing: ${state.tracking}em;\n  line-height: 0.99;\n  font-weight: ${state.family === 'mono' ? '500' : '700'};\n  ${state.wrap ? 'white-space: normal;\n  overflow-wrap: anywhere;\n  width: 100%;' : 'white-space: nowrap;\n  width: max-content;'}\n  text-align: left;\n  ${state.fit === 'ink' ? `/* Recompute this offset when the text or frame width changes. */\n  transform-origin: top left;\n  transform: translate(${lastOffset.x.toFixed(2)}px, ${lastOffset.y.toFixed(2)}px);` : ''}\n}`;
  try {
    await navigator.clipboard.writeText(css);
    els.copy.innerHTML = 'Copied ✓';
    setTimeout(() => { els.copy.innerHTML = 'Copy CSS <span aria-hidden="true">↗</span>'; }, 1400);
  } catch {
    els.copy.textContent = 'Clipboard unavailable';
    setTimeout(() => { els.copy.innerHTML = 'Copy CSS <span aria-hidden="true">↗</span>'; }, 1800);
  }
});

syncInputs();
draw();
new ResizeObserver(scheduleDraw).observe(els.canvas);
// Font metrics change after remote font files load; solve again when ready.
if (document.fonts?.ready) {
  document.fonts.ready.then(scheduleDraw);
  document.fonts.addEventListener?.('loadingdone', scheduleDraw);
}
// Debugging API for integration tests and future static-site-generator wiring.
window.constraintStudio = {
  getState: () => structuredClone(state),
  getSolution: () => ({ fontSize: currentSize, textBounds: { ...lastBounds }, inkBounds: { ...lastInk }, offset: { ...lastOffset } }),
  setState: (patch) => update(patch, { sync: true }),
};
