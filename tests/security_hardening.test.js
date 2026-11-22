import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDocument, createDefaultObject, validateDocument, isReservedId } from '../src/core/document.js';
import { applyCommand, applyCommandBatch, validateCommand } from '../src/core/commands.js';
import { isSafeColor } from '../src/core/color.js';
import { escapeXml } from '../src/core/markup.js';
import { renderObject, renderSvgScene } from '../src/renderer/svg-renderer.js';

const XSS = 'red"/><img src=x onerror=alert(1)>';
const ATTR_BREAKOUT = 'red" onmouseover="alert(1)';

function boardWithRect(rectOverrides = {}) {
  const doc = createDefaultDocument({ title: 'Security' });
  doc.objects.r1 = createDefaultObject('rectangle', { id: 'r1', ...rectOverrides });
  doc.order = ['r1'];
  return doc;
}

function assertNoPrototypePollution() {
  for (const key of ['locked', 'groupId', 'fill', 'stroke']) {
    assert.equal(Object.hasOwn(Object.prototype, key), false, `Object.prototype.${key} was polluted`);
  }
}

// --- Color allowlist -------------------------------------------------------

test('isSafeColor accepts every color form the editor and examples use', () => {
  for (const color of ['#fff', '#ffff', '#1e1e1e', '#1e1e1e80', 'none', 'transparent', 'red', 'currentColor',
    'rgba(70, 50, 20, 0.08)', 'rgb(0 0 0 / 50%)', 'hsl(210deg, 50%, 40%)', 'hsla(0, 0%, 100%, 0.07)']) {
    assert.equal(isSafeColor(color), true, color);
  }
});

test('isSafeColor rejects markup, attribute breakouts, URLs and non-strings', () => {
  for (const color of [XSS, ATTR_BREAKOUT, "red' x='1", 'url(#gradient)', 'url(javascript:alert(1))',
    'var(--x)', 'red; background: blue', 'rgb(0,0,0) <', 'expression(alert(1))', '', ' ', '#12345', 42, null, undefined, 'a'.repeat(65)]) {
    assert.equal(isSafeColor(color), false, String(color));
  }
});

test('validateDocument rejects unsafe object colors', () => {
  for (const overrides of [{ fill: XSS }, { stroke: ATTR_BREAKOUT }, { textStyle: { color: XSS } }]) {
    const result = validateDocument(boardWithRect(overrides));
    assert.equal(result.valid, false, JSON.stringify(overrides));
    assert.ok(result.errors.some((e) => e.includes('must be a valid color')), result.errors.join('; '));
  }
});

test('validateDocument rejects unsafe theme colors and palette entries', () => {
  const patches = [
    { background: XSS },
    { gridColor: ATTR_BREAKOUT },
    { defaultStroke: XSS },
    { defaultFill: XSS },
    { palette: ['#000000', '#000" onfocus="alert(1)" autofocus tabindex="0'] }
  ];
  for (const patch of patches) {
    const doc = boardWithRect();
    Object.assign(doc.theme, patch);
    const result = validateDocument(doc);
    assert.equal(result.valid, false, JSON.stringify(patch));
    assert.ok(result.errors.some((e) => e.includes('must be a valid color')), result.errors.join('; '));
  }
});

test('validateDocument still accepts the default board and plain colors', () => {
  const doc = boardWithRect({ fill: 'none', stroke: '#1e1e1e', textStyle: { color: 'red' } });
  assert.deepEqual(validateDocument(doc).errors, []);
});

test('commands reject unsafe colors before they reach the document', () => {
  const doc = boardWithRect();
  const cmd = { type: 'set_style', ids: ['r1'], updates: { fill: XSS } };
  assert.equal(validateCommand(cmd, doc).valid, false);
  assert.throws(() => applyCommand(doc, cmd), /valid color/);
  assert.throws(() => applyCommandBatch(doc, [cmd]), /valid color/);
  assert.throws(() => applyCommand(doc, { type: 'set_board_theme', theme: { ...doc.theme, background: XSS } }), /valid color/);
});

// --- Reserved (prototype) IDs ----------------------------------------------

test('isReservedId flags Object.prototype member names only', () => {
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.equal(isReservedId(id), true, id);
  }
  for (const id of ['r1', 'proto', 'Constructor', 'rect_abc123', '']) {
    assert.equal(isReservedId(id), false, id);
  }
});

test('validateDocument rejects dangling references that name prototype members', () => {
  const orderDoc = boardWithRect();
  orderDoc.order = ['r1', 'constructor'];
  assert.equal(validateDocument(orderDoc).valid, false);

  const groupDoc = boardWithRect({ groupId: 'constructor' });
  assert.equal(validateDocument(groupDoc).valid, false);

  const connectorDoc = boardWithRect();
  connectorDoc.objects.c1 = createDefaultObject('connector', { id: 'c1', from: { id: 'r1' }, to: { id: 'toString' } });
  connectorDoc.order.push('c1');
  const result = validateDocument(connectorDoc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('non-existent object ID: "toString"')), result.errors.join('; '));
});

test('validateDocument rejects records keyed by reserved IDs, including JSON __proto__ keys', () => {
  const parsed = JSON.parse(JSON.stringify(boardWithRect()));
  const rect = parsed.objects.r1;
  const withProtoKey = JSON.parse(JSON.stringify(parsed).replace('"objects":{', `"objects":{"__proto__":${JSON.stringify({ ...rect, id: '__proto__' })},`));
  withProtoKey.order.push('__proto__');
  assert.ok(Object.hasOwn(withProtoKey.objects, '__proto__'));
  const result = validateDocument(withProtoKey);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('reserved')), result.errors.join('; '));

  const groupDoc = boardWithRect();
  groupDoc.groups.constructor = { id: 'constructor', name: 'G' };
  assert.equal(validateDocument(groupDoc).valid, false);
});

test('commands with reserved IDs are rejected and never pollute Object.prototype (regression)', () => {
  const doc = boardWithRect();
  const attacks = [
    { type: 'lock_objects', ids: ['__proto__'], locked: true },
    { type: 'lock_objects', ids: ['constructor'], locked: true },
    { type: 'group_objects', ids: ['__proto__', 'r1'] },
    { type: 'delete_objects', ids: ['constructor'] },
    { type: 'set_style', ids: ['__proto__'], updates: { fill: '#000000' } }
  ];
  for (const cmd of attacks) {
    assert.equal(validateCommand(cmd, doc).valid, false, JSON.stringify(cmd));
    assert.throws(() => applyCommand(doc, cmd), /reserved/, JSON.stringify(cmd));
    assert.throws(() => applyCommandBatch(doc, [cmd]), /reserved/, JSON.stringify(cmd));
    assert.throws(() => applyCommand(doc, { type: 'batch', commands: [cmd] }), /reserved/, JSON.stringify(cmd));
    assertNoPrototypePollution();
  }
});

test('normal commands still validate after the payload safety guard', () => {
  const doc = boardWithRect();
  const { doc: locked } = applyCommand(doc, { type: 'lock_objects', ids: ['r1'], locked: true });
  assert.equal(locked.objects.r1.locked, true);
  const { doc: styled } = applyCommand(doc, { type: 'set_style', ids: ['r1'], updates: { fill: 'rgba(0, 0, 0, 0.5)' } });
  assert.equal(styled.objects.r1.fill, 'rgba(0, 0, 0, 0.5)');
  assertNoPrototypePollution();
});

// --- Output escaping (defence in depth) -------------------------------------

test('escapeXml neutralises quotes and markup and treats nullish as empty', () => {
  assert.equal(escapeXml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeXml(undefined), '');
  assert.equal(escapeXml(null), '');
  assert.equal(escapeXml(0), '0');
});

test('renderer escapes object IDs and colors even when validation is bypassed', () => {
  const doc = boardWithRect({ fill: XSS, stroke: ATTR_BREAKOUT });
  doc.objects['a"b'] = { ...doc.objects.r1, id: 'a"b' };
  doc.theme.background = XSS;
  const markup = renderObject(doc, doc.objects['a"b']);
  assert.ok(!markup.includes('<img'), markup);
  assert.ok(!markup.includes('" onmouseover='), markup);
  assert.ok(markup.includes('data-id="a&quot;b"'), markup);

  const scene = renderSvgScene(doc, { camera: { x: 0, y: 0, zoom: 1 }, selectedIds: [] });
  assert.ok(!scene.includes('<img'), 'scene contains injected markup');
});
