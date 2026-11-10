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
const INSET = 22; // Both left+right and top+bottom padding for the actual text.
const STORAGE_KEY = 'constraint-studio:v1';

const defaults = Object.freeze({
  text: 'Selected\nWorks',
  width: 620,
  height: 170,
  wrap: false,
  family: 'sans',
  tracking: -0.035,
});
const presets = {
  display: { text: 'Make an\nimpact.', width: 620, height: 190, wrap: false, family: 'sans', tracking: -0.055 },
  editorial: { text: 'The quiet art\nof noticing', width: 530, height: 218, wrap: true, family: 'serif', tracking: -0.035 },
  compact: { text: 'Objects & Spaces', width: 470, height: 120, wrap: false, family: 'mono', tracking: -0.06 },
};
const els = {
  canvas: $('#canvas'), frame: $('#frame'), frameInner: $('#frame-inner'), headline: $('#headline'),
  title: $('#headline-input'), modeSingle: $('#mode-single'), modeWrap: $('#mode-wrap'),
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
let raf = 0;
let dragging = null;

// The probe is plain DOM, deliberately NOT canvas or SVG. Its computed font,
// tracking, line-height and line wrapping match the visible heading.
const probe = document.createElement('h2');
probe.className = 'headline measure-probe';
probe.setAttribute('aria-hidden', 'true');
document.body.append(probe);

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

function solve(width, height) {
  const availableWidth = Math.max(1, width - INSET);
  const availableHeight = Math.max(1, height - INSET);
  let count = 0;
  function measure(size) {
    applyTypography(probe, size);
    probe.style.width = state.wrap ? `${availableWidth}px` : 'max-content';
    const rect = probe.getBoundingClientRect();
    count++;
    return {
      width: state.wrap ? Math.max(rect.width, probe.scrollWidth) : rect.width,
      height: Math.max(rect.height, probe.scrollHeight),
    };
  }
  const fits = (rect) => rect.width <= availableWidth + 0.3 && rect.height <= availableHeight + 0.3;
  let size;
  let bounds;
  let method;
  if (!state.wrap) {
    // For one unwrapped line, font-size scales text width and height almost
    // linearly (including em-based tracking). One baseline measurement gives
    // a strong estimate; further passes compensate for browser rounding.
    const base = measure(100);
    const estimate = 100 * Math.min(availableWidth / Math.max(.001, base.width), availableHeight / Math.max(.001, base.height));
    size = finiteRange(estimate, MIN_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE);
    bounds = measure(size);
    if (!fits(bounds)) {
      size = Math.max(MIN_FONT_SIZE, size * Math.min(availableWidth / Math.max(.001, bounds.width), availableHeight / Math.max(.001, bounds.height)) - 0.015);
      bounds = measure(size);
    }
    method = 'Ratio × ' + count;
  } else {
    // Wrapping introduces discontinuities: the number of lines changes.
    // Browser layout is the oracle; binary search maximizes font-size
    // subject to BOTH width and height constraints. 14 steps ~0.014px.
    let lo = MIN_FONT_SIZE;
    let hi = MAX_FONT_SIZE;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (fits(measure(mid))) lo = mid;
      else hi = mid;
    }
    size = lo;
    bounds = measure(size);
    method = 'Search × ' + count;
  }
  const widthSlack = availableWidth - bounds.width;
  const heightSlack = availableHeight - bounds.height;
  const axis = state.wrap ? (widthSlack < heightSlack ? 'Width' : 'Height') : (widthSlack / availableWidth < heightSlack / availableHeight ? 'Width' : 'Height');
  return { size, bounds, axis, method };
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
  const solution = solve(bounds.width, bounds.height);
  currentSize = solution.size;
  lastBounds = solution.bounds;
  applyTypography(els.headline, solution.size);
  els.dimWidth.textContent = `${Math.round(bounds.width)} px`;
  els.dimHeight.textContent = `${Math.round(bounds.height)} px`;
  els.size.textContent = solution.size.toFixed(1);
  els.textRect.textContent = `${Math.round(solution.bounds.width)} × ${Math.round(solution.bounds.height)}`;
  els.axis.textContent = solution.axis;
  els.method.textContent = solution.method;
  els.modeSingle.setAttribute('aria-pressed', String(!state.wrap));
  els.modeWrap.setAttribute('aria-pressed', String(state.wrap));
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
}

els.title.addEventListener('input', () => update({ text: els.title.value }));
els.font.addEventListener('change', () => update({ family: els.font.value }));
els.tracking.addEventListener('input', () => update({ tracking: Number(els.tracking.value) }));
els.modeSingle.addEventListener('click', () => update({ wrap: false }));
els.modeWrap.addEventListener('click', () => update({ wrap: true }));
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
  const css = `/* Generated by Constraint Studio */\n.hero-title {\n  font-family: ${families[state.family]};\n  font-size: ${currentSize.toFixed(2)}px;\n  letter-spacing: ${state.tracking}em;\n  line-height: 0.99;\n  font-weight: ${state.family === 'mono' ? '500' : '700'};\n  ${state.wrap ? 'white-space: normal;' : 'white-space: nowrap;'}\n}`;
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
if (document.fonts?.ready) document.fonts.ready.then(scheduleDraw);
// Debugging API for integration tests and future static-site-generator wiring.
window.constraintStudio = {
  getState: () => structuredClone(state),
  getSolution: () => ({ fontSize: currentSize, textBounds: { ...lastBounds } }),
  setState: (patch) => update(patch, { sync: true }),
};