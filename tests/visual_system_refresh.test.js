import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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
  assert.match(container.child.innerHTML, /class="status-region status-badge"[^>]*data-status="Changed"[^>]*role="status"[^>]*aria-live="polite"/);
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

test('Graphite tokens keep interface appearance independent from board themes', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'styles/sabura.css'), 'utf8');
  for (const token of ['#fffdf7', '#303a3e', '#6b7474', '#b9c0ba', '#366b93', '#dce7ed', '#2b2f33', '#edf0f0', '#b6bec5', '#687078', '#c1c8ff', '#414b70']) {
    assert.match(css, new RegExp(token.replace('#', '\\#')), token);
  }
  assert.match(css, /\[data-ui-theme="system"\]/);
  assert.match(css, /data-sabura-vs-board-theme="high-contrast"/);
  assert.match(css, /\.mode-reading \.status-region\[data-status="Clean"\]/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.sabura-topbar \.topbar-center \{[\s\S]*?top: 58px;[\s\S]*?bottom: auto;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.sabura-topbar\.mode-editing \.topbar-right \{[\s\S]*?display: flex;[\s\S]*?align-items: center;/);
  const finalCompactRules = css.slice(css.lastIndexOf('@media (max-width: 640px)'));
  assert.doesNotMatch(finalCompactRules, /topbar-secondary-actions[\s\S]*?position: fixed/);
  assert.match(css, /@media \(min-width: 641px\) and \(max-width: 680px\)[\s\S]*?\.sabura-topbar \.topbar-center \{ top: 58px; bottom: auto; \}/);
  assert.equal((css.match(/\/\* Graphite interface layout\./g) || []).length, 1);
  assert.doesNotMatch(css, /Final interface tokens|Frozen Graphite cascade/);
});

test('360px wheel compensation and browser audits protect the visual boundary', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'styles/sabura.css'), 'utf8');
  const runner = fs.readFileSync(path.join(process.cwd(), 'scripts/verify-full-e2e.js'), 'utf8');
  const wheelSource = fs.readFileSync(path.join(process.cwd(), 'src/ui/wheel.js'), 'utf8');
  assert.match(css, /@media \(max-width: 380px\)[\s\S]*?\.sabura-wheel \.wheel-text \{ font-size: 15px; \}[\s\S]*?\.sabura-wheel \.wheel-sub-text \{ font-size: 13px;/);
  assert.match(runner, /Interface matrix: Light\/Dark × Paper\/Night\/Blueprint\/High Contrast/);
  assert.match(runner, /Emulation\.setEmulatedMedia/);
  assert.match(runner, /Flow 32W: Real 360×640 three-ring wheel usability/);
  assert.match(runner, /Input\.dispatchMouseEvent/);
  assert.match(runner, /Input\.dispatchKeyEvent/);
  assert.match(runner, />= 33\.5/);
  assert.match(runner, /Compact persistent layout separation: settings, wheel launcher, zoom rail/);
  assert.match(runner, /Keep the persistent chrome audit independent of the modal wheel/);
  assert.match(runner, /activeThirdLabelContrast/);
  assert.match(runner, />= 4\.5/);
  assert.match(wheelSource, /stop-color="var\(--ui-wheel-bg\)"/);
  assert.match(wheelSource, /stop-color="var\(--ui-wheel-active\)"/);
  assert.match(wheelSource, /data-third-label-id=/);
});

test('wheel rims are crisp circles and dividers are straight dotted spokes', () => {
  const wheelElement = mockElement();
  const wheel = new ToolWheel({ appendChild() {} }, () => {});
  wheel.wheelEl = wheelElement;
  wheel.context = 'canvas';
  wheel.render();
  assert.match(wheelElement.innerHTML, /<circle[^>]+class="wheel-bezel-rim"/);
  assert.doesNotMatch(wheelElement.innerHTML, /<path[^>]+class="wheel-bezel-rim"/);
  const divider = wheelElement.innerHTML.match(/<path d="([^"]+)" class="wheel-divider-sketch"/);
  assert.ok(divider, 'divider is present');
  assert.match(divider[1], / L /);
  assert.doesNotMatch(divider[1], / Q /);
});

test('wheel scales and clamps its outer ring at a 360px viewport', () => {
  const wheelElement = mockElement();
  const wheel = new ToolWheel({ appendChild() {} }, () => {});
  wheel.wheelEl = wheelElement;
  window.innerWidth = 360;
  window.innerHeight = 640;
  wheel.open(20, 20, 'canvas');
  assert.ok(Number(wheelElement.attributes['data-wheel-scale']) < 1);
  assert.ok(wheel.pos.x >= 180 && wheel.pos.x <= 180, `centered x: ${wheel.pos.x}`);
  assert.ok(wheel.pos.y >= 180 && wheel.pos.y <= 460, `clamped y: ${wheel.pos.y}`);
  wheel.close();
  window.innerWidth = 1200;
  window.innerHeight = 900;
});
