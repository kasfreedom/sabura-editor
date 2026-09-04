import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultDocument, createDefaultObject, canonicalJson } from '../src/core/document.js';
import { renderObject, renderSvgScene, getVisualThemeProfile } from '../src/renderer/svg-renderer.js';
import { TopBar } from '../src/ui/topbar.js';
import { ToolWheel } from '../src/ui/wheel.js';
import { iconForWheelItem, renderSaburaIcon } from '../src/ui/wheel-icon-map.js';
import { SaburaApp } from '../src/main.js';

function mockElement() {
  return {
    className: '',
    innerHTML: '',
    style: {},
    attributes: {},
    appendChild() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}

if (typeof document === 'undefined') {
  globalThis.document = { createElement: () => mockElement(), documentElement: mockElement() };
}
if (typeof window === 'undefined') {
  globalThis.window = { innerWidth: 1200, innerHeight: 900, addEventListener() {}, removeEventListener() {} };
}

test('built-in visual profiles are allowlisted and custom themes retain legacy rendering', () => {
  assert.equal(getVisualThemeProfile('paper').pigment, true);
  assert.equal(getVisualThemeProfile('blueprint').pigment, true);
  assert.equal(getVisualThemeProfile('night').pigment, true);
  assert.equal(getVisualThemeProfile('high-contrast').cleanSketch, true);
  assert.equal(getVisualThemeProfile('customer-theme'), null);
});

test('eligible built-in fills get exactly two stable pigment layers without changing canonical state', () => {
  for (const themeId of ['paper', 'blueprint', 'night']) {
    const doc = createDefaultDocument({ themeId });
    const shape = createDefaultObject('rectangle', {
      id: `shape_${themeId}`,
      x: 12, y: 18, width: 140, height: 80,
      fill: doc.theme.palette[1], roughness: 1, seed: 24680
    }, doc.theme);
    const before = canonicalJson(doc);
    const first = renderObject(doc, shape);
    const second = renderObject(doc, shape);
    assert.equal(first, second, themeId);
    assert.equal((first.match(/data-sabura-vs-pigment-layer=/g) || []).length, 2, themeId);
    assert.equal(canonicalJson(doc), before, themeId);
  }
});

test('high contrast is clean and custom themes receive the exact legacy single-fill path', () => {
  const highContrast = createDefaultDocument({ themeId: 'high-contrast' });
  const shape = createDefaultObject('rectangle', {
    id: 'hc_shape', x: 0, y: 0, width: 100, height: 60,
    fill: '#ffffff', stroke: '#000000', roughness: 1, seed: 42
  }, highContrast.theme);
  const hcMarkup = renderObject(highContrast, shape);
  assert.equal((hcMarkup.match(/data-sabura-vs-pigment-layer=/g) || []).length, 0);
  assert.match(hcMarkup, /d="M 0 0 L 100 0 L 100 60 L 0 60 Z" fill="#ffffff"/, 'high contrast fill is geometric');
  const strokeD = hcMarkup.match(/<path d="([^"]+)" stroke=/)?.[1] || '';
  assert.equal((strokeD.match(/M /g) || []).length, 1, 'high contrast forces one clean outline pass');

  const custom = createDefaultDocument();
  custom.theme = { ...custom.theme, id: 'customer-theme', background: '#f0f0f0' };
  const customMarkup = renderObject(custom, shape);
  assert.equal((customMarkup.match(/data-sabura-vs-pigment-layer=/g) || []).length, 0);
  assert.match(customMarkup, /fill-opacity="1\.0"/);
});

test('open paths, connectors, images, and text never receive pigment layers', () => {
  const doc = createDefaultDocument({ themeId: 'paper' });
  const objects = [
    createDefaultObject('path', { id: 'open', points: [{ x: 0, y: 0 }, { x: 50, y: 20 }], closed: false, fill: '#ffec99' }, doc.theme),
    createDefaultObject('connector', { id: 'connector', from: { point: { x: 0, y: 0 } }, to: { point: { x: 50, y: 50 } } }, doc.theme),
    createDefaultObject('text', { id: 'text', text: 'Crisp' }, doc.theme),
    createDefaultObject('image', { id: 'image', assetId: 'missing' }, doc.theme)
  ];
  for (const object of objects) {
    assert.doesNotMatch(renderObject(doc, object), /data-sabura-vs-pigment-layer=/, object.type);
  }
});

test('board patterns are namespaced and paper texture is isolated from other themes', () => {
  const runtime = { camera: { x: 0, y: 0, zoom: 1 }, selectedIds: [], showGrid: true };
  const paper = renderSvgScene(createDefaultDocument({ themeId: 'paper' }), runtime);
  assert.match(paper, /id="sabura-vs-canvas-grid"/);
  assert.match(paper, /id="sabura-vs-paper-grain"/);
  assert.doesNotMatch(paper, /id="canvas-grid"/);
  const night = renderSvgScene(createDefaultDocument({ themeId: 'night' }), runtime);
  assert.doesNotMatch(night, /sabura-vs-paper-grain/);
});

test('topbar preserves complete controls while using local icons and pressed semantics', () => {
  const container = { appendChild(element) { this.child = element; } };
  const topbar = new TopBar(container, {});
  const doc = createDefaultDocument({ title: 'Visual & system' });
  const canonicalBefore = canonicalJson(doc);
  topbar.update(doc, 'Changed', 'light', false, true, 'editing');
  const html = container.child.innerHTML;
  for (const id of ['btn-view', 'select-board-theme', 'select-ui-theme', 'btn-grid-visible', 'btn-grid-snap', 'btn-undo', 'btn-redo', 'btn-fullscreen', 'btn-present', 'btn-save']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /href="#sabura-vs-app-icon"/);
  assert.match(html, /class="sabura-vs-app-mark"[^>]*role="img"[^>]*aria-label="Sabura — Visual &amp; system"[^>]*title="Sabura — Visual &amp; system"/);
  assert.match(html, /id="btn-grid-visible"[^>]*aria-pressed="true"/);
  assert.match(html, /id="btn-grid-snap"[^>]*aria-pressed="false"/);
  assert.match(html, /id="select-board-theme"[^>]*aria-label="Board Theme"/);
  assert.match(html, /id="select-ui-theme"[^>]*aria-label="Interface Appearance"/);
  assert.match(html, /id="btn-grid-visible"[^>]*aria-label="Grid On"/);
  assert.match(html, /id="btn-grid-snap"[^>]*aria-label="Snap Off"/);
  assert.match(html, /class="topbar-primary-actions"/);
  assert.match(html, /id="btn-present" class="topbar-btn"/);
  assert.doesNotMatch(html, /id="btn-present" class="[^"]*primary/);

  topbar.update(doc, 'Changed', 'light', false, true, 'reading');
  assert.match(container.child.innerHTML, /class="sabura-vs-app-mark"[^>]*aria-label="Sabura — Visual &amp; system"[^>]*title="Sabura — Visual &amp; system"/);
  assert.match(container.child.innerHTML, /id="btn-present" class="topbar-btn"/);
  assert.match(container.child.innerHTML, /id="btn-edit"[^>]*aria-label="Enter Editing Mode"/);
  assert.match(container.child.innerHTML, /id="btn-present"[^>]*aria-label="Enter Presentation Mode"/);
  assert.match(container.child.innerHTML, /id="btn-save"[^>]*aria-label="Save Copy"/);
  assert.doesNotMatch(container.child.innerHTML, /id="btn-present" class="[^"]*primary/);
  assert.match(renderSaburaIcon('edit'), /href="#sabura-vs-icon-edit"/);
  assert.equal(canonicalJson(doc), canonicalBefore, 'responsive identity rendering must not mutate persistent document state');
});

test('board-theme bridge is render-only and independent from interface appearance', () => {
  const appElement = mockElement();
  const fakeApp = {
    appElement,
    doc: createDefaultDocument({ themeId: 'night' }),
    status: 'Clean', interfaceTheme: 'dark', mode: 'editing',
    topbar: { update() {} },
    workspace: { snapGrid: true, showGrid: true, render() {} }
  };
  document.documentElement.setAttribute('data-ui-theme', 'dark');
  SaburaApp.prototype.updateUI.call(fakeApp);
  assert.equal(appElement.attributes['data-sabura-vs-board-theme'], 'night');
  assert.equal(document.documentElement.attributes['data-ui-theme'], 'dark');
  SaburaApp.prototype.applyInterfaceTheme.call(fakeApp, 'light');
  assert.equal(document.documentElement.attributes['data-ui-theme'], 'light');
  assert.equal(appElement.attributes['data-sabura-vs-board-theme'], 'night');
  assert.equal(fakeApp.doc.theme.id, 'night');
});

test('ToolWheel remains deterministic and maps semantic symbols without changing eight slots', () => {
  const wheelElement = mockElement();
  const container = { appendChild() {} };
  const wheel = new ToolWheel(container, () => {});
  wheel.wheelEl = wheelElement;
  wheel.context = 'canvas';
  wheel.render();
  const first = wheelElement.innerHTML;
  wheel.render();
  assert.equal(wheelElement.innerHTML, first);
  assert.equal(wheel.getItems().length, 8);
  assert.match(first, /href="#sabura-vs-icon-shapes"/);
  assert.match(first, /href="#sabura-vs-icon-image"/);
  assert.equal((first.match(/class="wheel-divider-sketch"/g) || []).length, 8);
  assert.doesNotMatch(first, /wheel-wedge-sketch/);
  assert.equal(iconForWheelItem('action_delete'), 'delete');
});

test('ToolWheel renders solid ring outlines independently from dashed category dividers', () => {
  const wheelElement = mockElement();
  const container = { appendChild() {} };
  const wheel = new ToolWheel(container, () => {});
  wheel.wheelEl = wheelElement;
  wheel.context = 'canvas';
  wheel.activeSubMenu = 'shapes';
  wheel.render();

  assert.match(wheelElement.innerHTML, /class="wheel-bezel-rim"/);
  assert.match(wheelElement.innerHTML, /class="wheel-bezel-rim sub"/);
  assert.ok((wheelElement.innerHTML.match(/class="wheel-divider-sketch"/g) || []).length > 8);
  assert.doesNotMatch(wheelElement.innerHTML, /wheel-wedge-sketch/);
});
