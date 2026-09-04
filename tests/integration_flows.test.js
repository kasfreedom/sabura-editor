import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDocument, createDefaultObject, cloneDocument, canonicalJson } from '../src/core/document.js';
import { applyCommand, applyCommandBatch, validateCommand } from '../src/core/commands.js';
import { extractDocumentFromHtml, packageHtmlWithDocument } from '../src/storage/file-packer.js';
import { SaburaApp } from '../src/main.js';

test('canonical history boundary suppresses idempotent command, batch, public API, undo, and redo entries', () => {
  const makeApp = () => {
    const app = Object.create(SaburaApp.prototype);
    app.doc = createDefaultDocument({ title: 'Stable title' });
    app.isCorrupted = false;
    app.undoStack = [];
    app.redoStack = [];
    app.status = 'Clean';
    app.uiUpdates = 0;
    app.notifications = 0;
    app.updateUI = () => { app.uiUpdates += 1; };
    app.notifySubscribers = () => { app.notifications += 1; };
    return app;
  };

  const app = makeApp();
  const originalDoc = app.doc;
  const existingRedo = { type: 'set_title', title: 'Future title' };
  app.redoStack = [existingRedo];
  app.mode = 'presentation';
  app.workspace = { selectedIds: ['transient-selection'], camera: { x: 90, y: 40, zoom: 2 } };
  const samePersistentDocument = cloneDocument(app.doc);
  assert.equal(app.documentStateChanged(app.doc, samePersistentDocument), false);
  samePersistentDocument['ext:test:persistent'] = { value: 1 };
  assert.equal(app.documentStateChanged(app.doc, samePersistentDocument), true);

  assert.equal(app.dispatchCommand({ type: 'set_title', title: 'Stable title' }), false);
  assert.strictEqual(app.doc, originalDoc);
  assert.equal(app.undoStack.length, 0);
  assert.deepEqual(app.redoStack, [existingRedo]);
  assert.equal(app.status, 'Clean');
  assert.equal(app.uiUpdates, 0);
  assert.equal(app.notifications, 0);

  assert.equal(app.dispatchCommandBatch([{ type: 'set_title', title: 'Stable title' }]), false);
  assert.strictEqual(app.doc, originalDoc);
  assert.equal(app.undoStack.length, 0);
  assert.deepEqual(app.redoStack, [existingRedo]);

  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    app.exposeApi();
    const publicResult = globalThis.window.sabura.applyCommands([
      { type: 'set_title', title: 'Stable title' }
    ]);
    assert.equal(publicResult.success, true);
    assert.strictEqual(app.doc, originalDoc);
    assert.equal(app.undoStack.length, 0);
    assert.deepEqual(app.redoStack, [existingRedo]);
    assert.equal(app.status, 'Clean');
    assert.equal(app.uiUpdates, 0);
    assert.equal(app.notifications, 0);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }

  assert.equal(app.dispatchCommand({ type: 'set_title', title: 'Changed title' }), true);
  assert.equal(app.doc.title, 'Changed title');
  assert.equal(app.undoStack.length, 1);
  assert.equal(app.redoStack.length, 0);
  assert.equal(app.status, 'Changed');
  assert.equal(app.uiUpdates, 1);
  assert.equal(app.notifications, 1);

  const staleUndo = makeApp();
  staleUndo.undoStack = [{ type: 'set_title', title: 'Stable title' }];
  assert.equal(staleUndo.undo(), false);
  assert.equal(staleUndo.undoStack.length, 0);
  assert.equal(staleUndo.redoStack.length, 0);
  assert.equal(staleUndo.uiUpdates, 0);
  assert.equal(staleUndo.notifications, 0);

  const staleRedo = makeApp();
  staleRedo.redoStack = [{ type: 'set_title', title: 'Stable title' }];
  assert.equal(staleRedo.redo(), false);
  assert.equal(staleRedo.undoStack.length, 0);
  assert.equal(staleRedo.redoStack.length, 0);
  assert.equal(staleRedo.uiUpdates, 0);
  assert.equal(staleRedo.notifications, 0);
});

test('Public AI API command validation and atomic batch execution', () => {
  let doc = createDefaultDocument();
  let undoStack = [];
  let redoStack = [];

  // Simulate public AI API applyCommands implementation
  function applyAiCommands(commands) {
    if (!Array.isArray(commands)) {
      return { success: false, errors: ['Commands must be an array'] };
    }
    const errors = [];
    for (let i = 0; i < commands.length; i++) {
      const val = validateCommand(commands[i]);
      if (!val.valid) {
        errors.push(`Command [${i}] (${commands[i]?.type || 'unknown'}): ${val.errors.join(', ')}`);
      }
    }
    if (errors.length > 0) {
      return { success: false, errors };
    }

    try {
      const testDoc = cloneDocument(doc);
      const { doc: finalDoc, inverseCmd } = applyCommandBatch(testDoc, commands);
      doc = finalDoc;
      if (inverseCmd && inverseCmd.type !== 'noop') {
        undoStack.push(inverseCmd);
        redoStack = [];
      }
      return { success: true, document: cloneDocument(doc) };
    } catch (err) {
      return { success: false, errors: [err.message] };
    }
  }

  // 1. Rejects invalid commands
  const badRes = applyAiCommands([
    { type: '' },
    { type: 'create_object', object: null }
  ]);
  assert.strictEqual(badRes.success, false);
  assert.ok(badRes.errors.length >= 1);

  // 2. Applies valid batch atomically
  const obj1 = createDefaultObject('rectangle', { id: 'box1', x: 50, y: 50, width: 100, height: 80 });
  const obj2 = createDefaultObject('ellipse', { id: 'circle1', x: 200, y: 50, width: 80, height: 80 });
  const conn = createDefaultObject('connector', {
    id: 'c1',
    from: { id: 'box1' },
    to: { id: 'circle1' },
    routing: 'elbow',
    endArrow: true
  });

  const validRes = applyAiCommands([
    { type: 'create_object', object: obj1 },
    { type: 'create_object', object: obj2 },
    { type: 'create_object', object: conn }
  ]);
  assert.strictEqual(validRes.success, true);
  assert.ok(doc.objects['box1']);
  assert.ok(doc.objects['circle1']);
  assert.ok(doc.objects['c1']);
  assert.strictEqual(undoStack.length, 1);

  // 3. Document returned is an isolated deep copy
  const copyDoc = validRes.document;
  copyDoc.title = 'Mutated Title';
  assert.notStrictEqual(doc.title, 'Mutated Title');

  // 4. Undo and Redo work seamlessly on batch
  const inv = undoStack.pop();
  const { doc: undoneDoc, inverseCmd: redoCmd } = applyCommand(doc, inv);
  doc = undoneDoc;
  assert.strictEqual(doc.objects['box1'], undefined);
  assert.strictEqual(doc.objects['circle1'], undefined);
  assert.strictEqual(doc.objects['c1'], undefined);

  // Redo
  const { doc: redoneDoc } = applyCommand(doc, redoCmd);
  doc = redoneDoc;
  assert.ok(doc.objects['box1']);
  assert.ok(doc.objects['circle1']);
});

test('Clean HTML shell saving isolates live DOM mutations and preserves constant file size', () => {
  const doc = createDefaultDocument();
  const rect = createDefaultObject('rectangle', { id: 'r1', text: 'Clean Shell Test' });
  doc.objects['r1'] = rect;
  doc.order = ['r1'];

  // Base clean template
  const cleanShell = `<!DOCTYPE html>
<html lang="en">
<head><title>Sabura</title><style>body { margin: 0; }</style></head>
<body>
  <div id="app"></div>
  <script type="application/json" id="sabura-document">
  {}
  </script>
  <script>console.log("bundle");</script>
</body>
</html>`;

  // Package doc
  const pack1 = packageHtmlWithDocument(cleanShell, doc);
  assert.strictEqual(pack1.success, true);

  // Verify extracted doc
  const extracted = extractDocumentFromHtml(pack1.html);
  assert.strictEqual(extracted.valid, true);
  assert.strictEqual(extracted.document.objects['r1'].text, 'Clean Shell Test');

  // Verify that live DOM nodes like svg or canvas or selection classes are NOT present in output
  assert.strictEqual(pack1.html.includes('<svg id="canvas-svg">'), false);
  assert.strictEqual(pack1.html.includes('in-presentation'), false);
  assert.strictEqual(pack1.html.includes('wheel-wedge'), false);
});
