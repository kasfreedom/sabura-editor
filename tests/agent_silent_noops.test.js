// Agent commands must never report success while changing nothing.
import test from 'node:test';
import assert from 'node:assert/strict';

import { AgentApi } from '../src/agent-api.js';
import { SaburaApp } from '../src/main.js';
import { applyCommand, applyCommandBatch } from '../src/core/commands.js';
import { canonicalJson, createDefaultDocument, normalizeDocument, validateDocument } from '../src/core/document.js';
import { FONT_SIZES } from '../src/core/types.js';

function makeApp() {
  const app = Object.create(SaburaApp.prototype);
  app.doc = createDefaultDocument({ id: 'noop_board', title: 'No-ops' });
  Object.assign(app, { status: 'Clean', mode: 'editing', isCorrupted: false, inPresentation: false, isSaving: false,
    pendingImageReader: null, pendingImageDecode: null, undoStack: [], redoStack: [], subscribers: new Set() });
  app.updateUI = () => {};
  app.workspace = { selectedIds: [], activeGroupId: null, camera: { x: 0, y: 0, zoom: 1 },
    container: { getBoundingClientRect: () => ({ width: 900, height: 600 }) }, hasActiveInteraction: () => false };
  app.textEditor = { targetObject: null, textarea: { style: { display: 'none' } } };
  app.agentApi = new AgentApi(app);
  return app;
}
const rect = (id, extra = {}) => ({ type: 'create_object', object: { id, type: 'rectangle', x: 0, y: 0, width: 100, height: 60, text: id, ...extra } });
let seq = 0;
const apply = (app, commands) => app.agentApi.apply({ requestId: `n${++seq}`, expectedEditToken: app.agentApi.editToken(), commands });

// --- Text size on shapes created without a textStyle (regression) -----------

test('set_typography changes text created without a textStyle (regression: was silently skipped)', () => {
  let doc = normalizeDocument(createDefaultDocument({ title: 't' }));
  doc = applyCommandBatch(doc, [rect('a')]).doc;
  assert.equal(doc.objects.a.textStyle, undefined, 'precondition: plain text, no textStyle');
  const result = applyCommand(doc, { type: 'set_typography', ids: ['a'], updates: { size: 'xl', bold: true } });
  assert.equal(result.doc.objects.a.textStyle.resolvedSize, FONT_SIZES.xl);
  assert.equal(result.doc.objects.a.textStyle.bold, true);
  assert.equal(validateDocument(result.doc).valid, true);
  // Undo removes the textStyle again, exactly; redo brings it back.
  const undone = applyCommand(result.doc, result.inverseCmd);
  assert.equal(canonicalJson(undone.doc), canonicalJson(doc));
  const redone = applyCommand(undone.doc, undone.inverseCmd);
  assert.equal(canonicalJson(redone.doc), canonicalJson(result.doc));
});

test('the teacher board: xl and bold applied through the agent API are visible', () => {
  const app = makeApp();
  const r = apply(app, [rect('sun'), rect('leaf'), { type: 'set_typography', ids: ['sun', 'leaf'], updates: { size: 'xl', bold: true } }]);
  assert.equal(r.success, true, JSON.stringify(r.errors));
  for (const id of ['sun', 'leaf']) {
    assert.equal(app.doc.objects[id].textStyle.resolvedSize, FONT_SIZES.xl, id);
    assert.equal(app.doc.objects[id].textStyle.bold, true, id);
  }
});

// --- Commands naming objects that do not exist (regression) -----------------

test('commands naming an object that does not exist are refused, not silently ignored (regression)', () => {
  const cases = [
    { type: 'set_text', id: 'ghost', text: 'x' },
    { type: 'move_objects', ids: ['a', 'ghost'], dx: 5, dy: 5 },
    { type: 'set_style', ids: ['ghost'], updates: { fill: '#ff0000' } },
    { type: 'set_typography', ids: ['ghost'], updates: { size: 'l' } },
    { type: 'delete_objects', ids: ['ghost'] },
    { type: 'lock_objects', ids: ['ghost'], locked: true },
    { type: 'resize_object', id: 'ghost', bounds: { x: 0, y: 0, width: 10, height: 10 } },
    { type: 'change_shape', id: 'ghost', newType: 'ellipse' },
  ];
  for (const cmd of cases) {
    const app = makeApp();
    const before = canonicalJson(app.doc);
    const r = apply(app, [rect('a'), cmd]);
    assert.equal(r.success, false, `${cmd.type} accepted a missing object`);
    assert.equal(r.errors[0].code, 'INVALID_COMMAND', cmd.type);
    assert.equal(r.errors[0].commandIndex, 1, cmd.type);
    assert.match(r.errors[0].message, /ghost/, cmd.type);
    assert.equal(canonicalJson(app.doc), before, `${cmd.type}: a refused batch changes nothing`);
  }
});

test('objects created or deleted earlier in the same batch are tracked', () => {
  const app = makeApp();
  const ok = apply(app, [rect('a'), { type: 'set_text', id: 'a', text: 'renamed' }, { type: 'move_objects', ids: ['a'], dx: 1, dy: 1 }]);
  assert.equal(ok.success, true, JSON.stringify(ok.errors));
  const gone = apply(app, [{ type: 'delete_objects', ids: ['a'] }, { type: 'set_text', id: 'a', text: 'again' }]);
  assert.equal(gone.success, false);
  assert.equal(gone.errors[0].code, 'INVALID_COMMAND');
  assert.equal(gone.errors[0].commandIndex, 1);
});

// --- Every problem reported at once -----------------------------------------

test('a batch with several invalid commands reports each of them in one response', () => {
  const app = makeApp();
  const r = apply(app, [
    rect('a', { colour: 'red' }),
    rect('b'),
    { type: 'connect_objects', connectorId: 'c', fromId: 'a', toId: 'b', label: 'x' },
    { type: 'set_typography', ids: ['b'], updates: { fontSize: 30 } },
  ]);
  assert.equal(r.success, false);
  assert.deepEqual(r.errors.map((e) => e.commandIndex), [0, 2, 3]);
  assert.ok(r.errors.every((e) => e.code === 'INVALID_COMMAND'));
  assert.match(r.errors[0].message, /colour/);
  assert.match(r.errors[1].message, /label/);
  assert.match(r.errors[2].message, /fontSize/);
});

test('error lists are capped so a huge bad batch stays a readable response', () => {
  const app = makeApp();
  const r = apply(app, Array.from({ length: 50 }, (_, i) => rect(`r${i}`, { colour: 'red' })));
  assert.equal(r.success, false);
  assert.equal(r.errors.length, 10);
});
