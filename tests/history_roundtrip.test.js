import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, createDefaultDocument, createDefaultObject, validateDocument } from '../src/core/document.js';
import { applyCommand } from '../src/core/commands.js';
import { SaburaApp } from '../src/main.js';

/**
 * Board with two grouped shapes, a free shape, a text object and a connector
 * between the grouped shapes. Every command below runs against it.
 */
function board() {
  const doc = createDefaultDocument({ title: 'History' });
  const add = (obj) => { doc.objects[obj.id] = obj; doc.order.push(obj.id); };
  add(createDefaultObject('rectangle', { id: 'a', x: 0, y: 0, width: 120, height: 80, text: 'A', groupId: 'g1' }));
  add(createDefaultObject('ellipse', { id: 'b', x: 240, y: 0, width: 120, height: 80, text: 'B', groupId: 'g1' }));
  add(createDefaultObject('rectangle', { id: 'c', x: 0, y: 200, width: 120, height: 80, text: 'C' }));
  add(createDefaultObject('text', { id: 't', x: 240, y: 200, text: 'Note' }));
  add(createDefaultObject('connector', { id: 'k', from: { id: 'a' }, to: { id: 'b' } }));
  doc.groups.g1 = { id: 'g1', name: 'Pair' };
  assert.deepEqual(validateDocument(doc).errors, []);
  return doc;
}

const same = (x, y) => canonicalJson(x) === canonicalJson(y);

/**
 * do → undo → redo → undo must land exactly on the "after" and "before" states,
 * and every intermediate document must be valid. History is built from each
 * step's own inverse, exactly as the app's undo/redo stacks do.
 */
function assertRoundTrip(cmd, makeDoc = board) {
  const before = makeDoc();
  const done = applyCommand(before, cmd);
  assert.ok(!same(before, done.doc), `${cmd.type} should change the board`);
  assert.notEqual(done.inverseCmd.type, 'noop', `${cmd.type} should be undoable`);

  const undone = applyCommand(done.doc, done.inverseCmd);
  assert.ok(same(undone.doc, before), `undo of ${cmd.type} must restore the exact prior board`);
  assert.notEqual(undone.inverseCmd.type, 'noop', `undo of ${cmd.type} must be redoable`);

  const redone = applyCommand(undone.doc, undone.inverseCmd);
  assert.deepEqual(validateDocument(redone.doc).errors, [], `redo of ${cmd.type} must be valid`);
  assert.ok(same(redone.doc, done.doc), `redo of ${cmd.type} must restore the exact post-command board`);

  const undoneAgain = applyCommand(redone.doc, redone.inverseCmd);
  assert.ok(same(undoneAgain.doc, before), `second undo of ${cmd.type} must restore the prior board`);
}

const ROUND_TRIP_COMMANDS = [
  { type: 'move_objects', ids: ['a', 'c'], dx: 15, dy: -10 },
  { type: 'set_style', ids: ['c'], updates: { fill: '#ffec99', stroke: '#e03131' } },
  { type: 'set_text', id: 'c', text: 'Changed' },
  { type: 'lock_objects', ids: ['c'], locked: true },
  { type: 'reorder_objects', ids: ['a'], action: 'front' },
  { type: 'delete_objects', ids: ['c'] },
  { type: 'delete_objects', ids: ['a'] },
  { type: 'group_objects', ids: ['c', 't'], groupId: 'g2', name: 'Second' },
  { type: 'ungroup_objects', groupIds: ['g1'] },
  { type: 'duplicate_objects', ids: ['a', 'b', 'k'] },
  { type: 'set_board_theme', themeId: 'night' },
  { type: 'configure_connector', id: 'k', stacking: 'front', startArrow: true, routing: 'elbow' },
  { type: 'set_title', title: 'Renamed' }
];

for (const cmd of ROUND_TRIP_COMMANDS) {
  test(`history round trip is exact: ${cmd.type} ${JSON.stringify(cmd).slice(0, 60)}`, () => {
    assertRoundTrip(cmd);
  });
}

test('grouping objects that have no groupId key round-trips exactly (absent is not null)', () => {
  const withoutKey = () => {
    const doc = board();
    delete doc.objects.c.groupId;
    delete doc.objects.t.groupId;
    return doc;
  };
  assertRoundTrip({ type: 'group_objects', ids: ['c', 't'], groupId: 'g2', name: 'Second' }, withoutKey);
  const before = withoutKey();
  const done = applyCommand(before, { type: 'group_objects', ids: ['c', 't'], groupId: 'g2' });
  const undone = applyCommand(done.doc, done.inverseCmd);
  assert.equal(Object.hasOwn(undone.doc.objects.c, 'groupId'), false);
});

test('history steps survive a JSON round trip (stacks never rely on undefined values)', () => {
  const before = board();
  const done = applyCommand(before, { type: 'group_objects', ids: ['c', 't'], groupId: 'g2' });
  const inverse = JSON.parse(JSON.stringify(done.inverseCmd));
  const undone = applyCommand(done.doc, inverse);
  assert.ok(same(undone.doc, before));
  const redo = JSON.parse(JSON.stringify(undone.inverseCmd));
  assert.ok(same(applyCommand(undone.doc, redo).doc, done.doc));
});

test('theme restore payloads are colour-checked like any other colour field', () => {
  const doc = board();
  assert.throws(
    () => applyCommand(doc, { type: 'set_board_theme', theme: doc.theme, restoreObjects: { c: { textColor: 'red" onload="x' } } }),
    /valid color/
  );
});

test('theme redo restyles objects exactly as the original change did (regression)', () => {
  const before = board();
  const done = applyCommand(before, { type: 'set_board_theme', themeId: 'night' });
  assert.notEqual(done.doc.objects.c.stroke, before.objects.c.stroke, 'night theme restyles the dark stroke');
  const undone = applyCommand(done.doc, done.inverseCmd);
  const redone = applyCommand(undone.doc, undone.inverseCmd);
  assert.equal(redone.doc.objects.c.stroke, done.doc.objects.c.stroke);
  assert.equal(redone.doc.theme.id, 'night');
});

test('configure_connector undo removes fields that were previously unset (regression)', () => {
  const before = board();
  assert.equal(Object.hasOwn(before.objects.k, 'stacking'), false);
  const done = applyCommand(before, { type: 'configure_connector', id: 'k', stacking: 'front' });
  const undone = applyCommand(done.doc, done.inverseCmd);
  assert.equal(Object.hasOwn(undone.doc.objects.k, 'stacking'), false);
  assert.ok(same(undone.doc, before));
});

// --- Application-level history and clipboard --------------------------------

function fakeApp(doc = board()) {
  const app = Object.create(SaburaApp.prototype);
  app.doc = doc;
  app.workspace = { selectedIds: [], activeGroupId: null, render() {} };
  app.undoStack = [];
  app.redoStack = [];
  app.exportBaseline = null;
  app.status = 'Clean';
  app.subscribers = new Set();
  app.clipboard = null;
  app.clipboardAssets = {};
  app.pasteCount = 0;
  app.updateUI = () => {};
  return app;
}

test('pasting connectors with their endpoints produces a valid board and leaves no stray x/y (regression)', () => {
  const app = fakeApp();
  app.workspace.selectedIds = ['a', 'b', 'k'];
  app.copy();
  app.paste();
  assert.deepEqual(validateDocument(app.doc).errors, []);
  const pasted = app.workspace.selectedIds.map((id) => app.doc.objects[id]);
  assert.equal(pasted.length, 3);
  const connector = pasted.find((o) => o.type === 'connector');
  assert.ok(connector, 'connector was pasted');
  assert.equal(Object.hasOwn(connector, 'x'), false);
  assert.equal(Object.hasOwn(connector, 'y'), false);
  const pastedShapeIds = pasted.filter((o) => o.type !== 'connector').map((o) => o.id);
  assert.ok(pastedShapeIds.includes(connector.from.id) && pastedShapeIds.includes(connector.to.id), 'connector rebinds to the pasted shapes');
});

test('paste is one undoable step that also removes the groups it created (regression)', () => {
  const app = fakeApp();
  const before = canonicalJson(app.doc);
  app.workspace.selectedIds = ['a', 'b'];
  app.copy();
  app.paste();
  assert.equal(Object.keys(app.doc.groups).length, 2, 'paste creates a copy of group g1');
  assert.equal(app.undo(), true);
  assert.equal(canonicalJson(app.doc), before, 'undo removes pasted objects and their new group');
  assert.equal(app.redo(), true);
  assert.equal(Object.keys(app.doc.groups).length, 2);
  assert.deepEqual(validateDocument(app.doc).errors, []);
});

test('a connector copied with only one endpoint pastes with a free point even after the other end is deleted', () => {
  const app = fakeApp();
  app.workspace.selectedIds = ['a', 'k'];
  app.copy();
  app.dispatchCommand({ type: 'delete_objects', ids: ['b'] });
  app.paste();
  assert.deepEqual(validateDocument(app.doc).errors, []);
  const connector = app.workspace.selectedIds.map((id) => app.doc.objects[id]).find((o) => o.type === 'connector');
  assert.ok(Number.isFinite(connector.to.point.x) && Number.isFinite(connector.to.point.y));
});

test('pasting after cut keeps the copied group name', () => {
  const app = fakeApp();
  app.workspace.selectedIds = ['a', 'b'];
  app.cut();
  app.paste();
  const pastedGroupIds = new Set(app.workspace.selectedIds.map((id) => app.doc.objects[id].groupId));
  assert.equal(pastedGroupIds.size, 1);
  const [pastedGroupId] = pastedGroupIds;
  assert.notEqual(pastedGroupId, 'g1');
  assert.equal(app.doc.groups[pastedGroupId].name, 'Pair');
});

test('undo and redo keep their history entry when applying it fails (regression)', () => {
  const app = fakeApp();
  app.dispatchCommand({ type: 'move_objects', ids: ['c'], dx: 10, dy: 0 });
  app.undoStack.push({ type: 'configure_connector', id: 'missing' });
  assert.throws(() => app.undo(), /non-existent connector/);
  assert.equal(app.undoStack.length, 2, 'the failing entry is still on the undo stack');

  app.redoStack.push({ type: 'configure_connector', id: 'missing' });
  assert.throws(() => app.redo(), /non-existent connector/);
  assert.equal(app.redoStack.length, 1, 'the failing entry is still on the redo stack');
});

test('a failed undo from the UI is reported to the user, keeps its entry, and leaves the status alone', () => {
  const app = fakeApp();
  app.dispatchCommand({ type: 'move_objects', ids: ['c'], dx: 10, dy: 0 });
  app.undoStack.push({ type: 'configure_connector', id: 'missing' });
  const reported = [];
  app.reportActionError = (label, error) => reported.push([label, error.message]);
  const statusBefore = app.status;
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(app.runUserAction('Undo', () => app.undo()), false);
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(reported.map(([label]) => label), ['Undo']);
  assert.match(reported[0][1], /non-existent connector/);
  assert.equal(app.undoStack.length, 2);
  assert.equal(app.status, statusBefore, 'status is not switched to Error, so the unsaved-changes warning still fires');
});
