import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { AgentApi, AGENT_API_VERSION } from '../src/agent-api.js';
import { SaburaApp } from '../src/main.js';
import {
  canonicalJson,
  cloneDocument,
  createDefaultDocument,
  createDefaultObject,
  validateDocument
} from '../src/core/document.js';
import { resolveConnectorGeometry } from '../src/core/geometry.js';
import { packageHtmlWithDocument, extractDocumentFromHtml } from '../src/storage/file-packer.js';

function makeApp(doc = createDefaultDocument({ id: 'agent_board', title: 'Existing human board' })) {
  const app = Object.create(SaburaApp.prototype);
  app.doc = doc;
  app.status = 'Clean';
  app.mode = 'editing';
  app.isCorrupted = false;
  app.inPresentation = false;
  app.isSaving = false;
  app.pendingImageReader = null;
  app.pendingImageDecode = null;
  app.undoStack = [];
  app.redoStack = [];
  app.subscribers = new Set();
  app.updateUI = () => {};
  app.workspace = {
    selectedIds: [],
    activeGroupId: null,
    camera: { x: 10, y: 20, zoom: 1.25 },
    container: { getBoundingClientRect: () => ({ width: 900, height: 600 }) },
    interactionActive: false,
    hasActiveInteraction() { return this.interactionActive; },
    fitToContent() { this.camera = { x: 30, y: 40, zoom: 0.8 }; },
    focusObjects(ids) {
      this.lastFocusedIds = [...ids];
      this.camera = { x: 50, y: 60, zoom: 1.5 };
      return true;
    }
  };
  app.textEditor = { targetObject: null, textarea: { style: { display: 'none' } } };
  app.agentApi = new AgentApi(app);
  return app;
}

function request(app, requestId, commands, token = app.agentApi.editToken()) {
  return { requestId, expectedEditToken: token, commands };
}

function labeledRectangle(id, x, text) {
  return createDefaultObject('rectangle', {
    id,
    x,
    y: 100,
    width: 150,
    height: 90,
    text
  });
}

test('agent discovery is versioned and excludes internal history commands', () => {
  const app = makeApp();
  const description = app.agentApi.describe();
  assert.equal(description.apiVersion, AGENT_API_VERSION);
  assert.equal(description.documentSchemaVersion, 'sabura/canvas/v1');
  assert.equal(description.commandSchemaVersion, 'sabura/commands/v1');
  assert.deepEqual(description.operations, [
    'describe', 'read', 'apply', 'undo', 'redo', 'fitBoard', 'focusObjects', 'saveCopy', 'subscribe'
  ]);
  assert.equal(description.supportedCommands.includes('create_object'), true);
  assert.equal(description.supportedCommands.includes('connect_objects'), true);
  for (const type of ['noop', 'batch', 'restore_positions', 'restore_styles', 'delete_asset']) {
    assert.equal(description.supportedCommands.includes(type), false, type);
  }
  description.supportedCommands.push('mutated');
  assert.equal(app.agentApi.describe().supportedCommands.includes('mutated'), false);
});

test('Sabura exposes the versioned agent namespace through its public browser API', () => {
  const app = makeApp();
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    app.exposeApi();
    assert.equal(globalThis.window.sabura.agent.describe().apiVersion, AGENT_API_VERSION);
    assert.equal(typeof globalThis.window.sabura.agent.apply, 'function');
    assert.equal(typeof globalThis.window.sabura.agent.focusObjects, 'function');
    assert.notEqual(globalThis.window.sabura.agent, app.agentApi);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('read returns copied document, selection, viewport, history, and live token', () => {
  const doc = createDefaultDocument({ id: 'copy_board' });
  doc.objects.human = labeledRectangle('human', 20, 'Human work');
  doc.order = ['human'];
  const app = makeApp(doc);
  app.workspace.selectedIds = ['human'];

  const snapshot = app.agentApi.read();
  snapshot.document.objects.human.text = 'mutated outside';
  snapshot.selection.ids.push('other');
  snapshot.viewport.camera.x = 999;

  const reread = app.agentApi.read();
  assert.equal(reread.document.objects.human.text, 'Human work');
  assert.deepEqual(reread.selection.ids, ['human']);
  assert.equal(reread.viewport.camera.x, 10);
  assert.deepEqual(reread.editToken, { sessionId: app.agentApi.sessionId, sequence: 0 });
});

test('agent batch creates a connected story atomically and Undo/Redo advance live tokens', () => {
  const doc = createDefaultDocument({ id: 'story_board' });
  doc.objects.human = labeledRectangle('human', -180, 'Existing');
  doc.order = ['human'];
  const app = makeApp(doc);
  const before = canonicalJson(app.doc);
  const token0 = app.agentApi.editToken();

  const commands = [
    { type: 'create_object', object: labeledRectangle('agent_a', 40, 'A') },
    { type: 'create_object', object: labeledRectangle('agent_b', 280, 'B') },
    { type: 'create_object', object: labeledRectangle('agent_c', 520, 'C') },
    { type: 'connect_objects', connectorId: 'agent_ab', fromId: 'agent_a', toId: 'agent_b', routing: 'straight' },
    { type: 'connect_objects', connectorId: 'agent_bc', fromId: 'agent_b', toId: 'agent_c', routing: 'curved' },
    { type: 'move_objects', ids: ['agent_b'], dx: 0, dy: 120 },
    { type: 'set_text', id: 'agent_a', text: 'Ingress' },
    { type: 'set_style', ids: ['agent_c'], updates: { fill: '#b2f2bb' } }
  ];
  const result = app.agentApi.apply(request(app, 'story-create', commands, token0));

  assert.equal(result.success, true);
  assert.equal(result.changed, true);
  assert.equal(app.undoStack.length, 1);
  assert.equal(result.editTokenAfter.sequence, 1);
  assert.equal(app.doc.objects.agent_a.text, 'Ingress');
  assert.equal(app.doc.objects.agent_c.fill, '#b2f2bb');
  assert.deepEqual(app.doc.objects.agent_ab.from, { id: 'agent_a' });
  assert.deepEqual(app.doc.objects.agent_ab.to, { id: 'agent_b' });
  assert.equal(result.affected.renderAffected.includes('agent_ab'), true);
  assert.deepEqual(validateDocument(app.doc), { valid: true, errors: [] });

  const geometry = resolveConnectorGeometry(app.doc, app.doc.objects.agent_ab);
  assert.equal(Number.isFinite(geometry.end.x) && Number.isFinite(geometry.end.y), true);

  const undo = app.agentApi.historyOperation('undo', request(app, 'story-undo', undefined));
  assert.equal(undo.success, true);
  assert.equal(undo.changed, true);
  assert.equal(undo.editTokenAfter.sequence, 2);
  assert.equal(canonicalJson(app.doc), before);

  const redo = app.agentApi.historyOperation('redo', request(app, 'story-redo', undefined));
  assert.equal(redo.success, true, JSON.stringify(redo));
  assert.equal(redo.changed, true);
  assert.equal(redo.editTokenAfter.sequence, 3);
  assert.equal(Boolean(app.doc.objects.agent_ab), true);
});

test('invalid sequential batch is atomic and returns a structured command index', () => {
  const app = makeApp();
  const beforeDoc = canonicalJson(app.doc);
  const beforeUndo = app.undoStack.length;
  const beforeRedo = app.redoStack.length;
  const beforeToken = app.agentApi.editToken();

  const result = app.agentApi.apply(request(app, 'invalid-batch', [
    { type: 'create_object', object: labeledRectangle('would_be_partial', 20, 'Partial') },
    { type: 'connect_objects', connectorId: 'broken', fromId: 'would_be_partial', toId: 'missing' }
  ], beforeToken));

  assert.equal(result.success, false);
  assert.equal(result.errors[0].code, 'INVALID_COMMAND');
  assert.equal(result.errors[0].commandIndex, 1);
  assert.equal(canonicalJson(app.doc), beforeDoc);
  assert.equal(app.undoStack.length, beforeUndo);
  assert.equal(app.redoStack.length, beforeRedo);
  assert.deepEqual(app.agentApi.editToken(), beforeToken);
});

test('no-op batches do not create history or advance the live token', () => {
  const app = makeApp();
  const token = app.agentApi.editToken();
  const result = app.agentApi.apply(request(app, 'empty-batch', [], token));
  assert.equal(result.success, true);
  assert.equal(result.changed, false);
  assert.deepEqual(result.editTokenAfter, token);
  assert.equal(app.undoStack.length, 0);
});

test('intervening human edit rejects stale agent request without mutation', () => {
  const app = makeApp();
  const stale = app.agentApi.editToken();
  app.dispatchCommand({ type: 'set_title', title: 'Human changed this' });
  const before = canonicalJson(app.doc);

  const result = app.agentApi.apply(request(app, 'stale-request', [
    { type: 'create_object', object: labeledRectangle('too_late', 20, 'Late') }
  ], stale));

  assert.equal(result.success, false);
  assert.equal(result.errors[0].code, 'STALE_EDIT');
  assert.equal(canonicalJson(app.doc), before);
  assert.equal(app.undoStack.length, 1);
});

test('completed request retry is idempotent and payload mismatch is rejected', () => {
  const app = makeApp();
  const originalRequest = request(app, 'stable-request', [
    { type: 'create_object', object: labeledRectangle('once_only', 20, 'Once') }
  ]);
  const first = app.agentApi.apply(originalRequest);
  const retry = app.agentApi.apply(originalRequest);
  assert.deepEqual(retry, first);
  assert.equal(app.doc.order.filter(id => id === 'once_only').length, 1);
  assert.equal(app.undoStack.length, 1);

  const mismatch = app.agentApi.apply({
    ...originalRequest,
    commands: [{ type: 'create_object', object: labeledRectangle('different', 20, 'Different') }]
  });
  assert.equal(mismatch.success, false);
  assert.equal(mismatch.errors[0].code, 'REQUEST_ID_REUSE');
});

test('agent-created IDs are required and collisions are rejected', () => {
  const doc = createDefaultDocument();
  doc.objects.existing = labeledRectangle('existing', 20, 'Existing');
  doc.order = ['existing'];
  const app = makeApp(doc);

  const missing = app.agentApi.apply(request(app, 'missing-id', [
    { type: 'create_object', object: { type: 'rectangle', x: 0, y: 0, width: 100, height: 80 } }
  ]));
  assert.equal(missing.errors[0].code, 'EXPLICIT_ID_REQUIRED');

  const collision = app.agentApi.apply(request(app, 'collision-id', [
    { type: 'create_object', object: labeledRectangle('existing', 100, 'Replacement') }
  ]));
  assert.equal(collision.errors[0].code, 'ID_COLLISION');
  assert.equal(app.doc.objects.existing.text, 'Existing');

  const duplicateWithinBatch = app.agentApi.apply(request(app, 'duplicate-in-batch', [
    { type: 'create_object', object: labeledRectangle('same_new_id', 100, 'First') },
    { type: 'create_object', object: labeledRectangle('same_new_id', 300, 'Second') }
  ]));
  assert.equal(duplicateWithinBatch.errors[0].code, 'ID_COLLISION');
  assert.equal(duplicateWithinBatch.errors[0].commandIndex, 1);
  assert.equal(duplicateWithinBatch.errors[0].path, 'commands[1].object.id');
  assert.equal(Boolean(app.doc.objects.same_new_id), false);
});

test('connector, group, image, and raster asset creation all require explicit IDs', () => {
  const doc = createDefaultDocument();
  doc.objects.left = labeledRectangle('left', 20, 'Left');
  doc.objects.right = labeledRectangle('right', 260, 'Right');
  doc.order = ['left', 'right'];
  const cases = [
    {
      requestId: 'missing-connector-id',
      command: { type: 'connect_objects', fromId: 'left', toId: 'right' },
      path: 'commands[0].connectorId'
    },
    {
      requestId: 'missing-group-id',
      command: { type: 'group_objects', ids: ['left', 'right'] },
      path: 'commands[0].groupId'
    },
    {
      requestId: 'missing-image-id',
      command: {
        type: 'create_image',
        object: { type: 'image', assetId: 'asset_explicit' },
        asset: { id: 'asset_explicit', type: 'raster' }
      },
      path: 'commands[0].object.id'
    },
    {
      requestId: 'missing-asset-id',
      command: {
        type: 'create_image',
        object: { id: 'image_explicit', type: 'image' },
        asset: { type: 'raster' }
      },
      path: 'commands[0].asset.id'
    }
  ];

  for (const testCase of cases) {
    const app = makeApp(cloneDocument(doc));
    const result = app.agentApi.apply(request(app, testCase.requestId, [testCase.command]));
    assert.equal(result.success, false, testCase.requestId);
    assert.equal(result.errors[0].code, 'EXPLICIT_ID_REQUIRED', testCase.requestId);
    assert.equal(result.errors[0].path, testCase.path, testCase.requestId);
    assert.equal(app.undoStack.length, 0, testCase.requestId);
  }
});

test('internal commands are unavailable through the agent façade', () => {
  const app = makeApp();
  for (const [index, type] of ['noop', 'batch', 'restore_positions', 'delete_asset'].entries()) {
    const result = app.agentApi.apply(request(app, `internal-${index}`, [{ type }]));
    assert.equal(result.success, false);
    assert.equal(result.errors[0].code, 'UNSUPPORTED_COMMAND');
  }
});

test('agent edits reject Reading, Presentation, save, import, text, and pointer busy states', () => {
  const cases = [
    ['reading-mode', app => { app.mode = 'reading'; }, 'NOT_EDITABLE'],
    ['presentation', app => { app.inPresentation = true; }, 'EDITOR_BUSY'],
    ['saving', app => { app.isSaving = true; }, 'EDITOR_BUSY'],
    ['image-import', app => { app.pendingImageReader = {}; }, 'EDITOR_BUSY'],
    ['text-editing', app => { app.textEditor.targetObject = { id: 'editing' }; }, 'EDITOR_BUSY'],
    ['pointer-interaction', app => { app.workspace.interactionActive = true; }, 'EDITOR_BUSY']
  ];
  for (const [name, arrange, expectedCode] of cases) {
    const app = makeApp();
    arrange(app);
    const before = canonicalJson(app.doc);
    const result = app.agentApi.apply(request(app, `busy-${name}`, []));
    assert.equal(result.success, false, name);
    assert.equal(result.errors[0].code, expectedCode, name);
    assert.equal(canonicalJson(app.doc), before, name);
    assert.equal(app.undoStack.length, 0, name);
  }
});

test('subscription payloads cannot mutate the live document', () => {
  const app = makeApp();
  let received = null;
  const unsubscribe = app.agentApi.subscribe(snapshot => {
    received = snapshot;
    snapshot.document.title = 'Subscriber mutation';
  });
  app.dispatchCommand({ type: 'set_title', title: 'Committed title' });
  assert.equal(received.document.title, 'Subscriber mutation');
  assert.equal(app.doc.title, 'Committed title');
  unsubscribe();
  assert.equal(app.subscribers.size, 0);
});

test('fit and focus change only viewport state', () => {
  const doc = createDefaultDocument();
  doc.objects.target = labeledRectangle('target', 20, 'Target');
  doc.order = ['target'];
  const app = makeApp(doc);
  const beforeDoc = canonicalJson(app.doc);
  const beforeToken = app.agentApi.editToken();

  const focused = app.agentApi.focusObjects(['target'], { padding: 80 });
  assert.equal(focused.success, true);
  assert.deepEqual(app.workspace.lastFocusedIds, ['target']);
  const fitted = app.agentApi.fitBoard();
  assert.equal(fitted.success, true);
  assert.equal(canonicalJson(app.doc), beforeDoc);
  assert.deepEqual(app.agentApi.editToken(), beforeToken);
  assert.equal(app.undoStack.length, 0);
});

test('agent save reports request semantics rather than confirmed delivery', () => {
  const app = makeApp();
  app.saveCopy = () => ({
    success: true,
    changed: true,
    filename: 'sabura-agent-board-rabc.html',
    byteLength: 1234,
    revisionId: 'abc',
    parentId: null
  });
  const result = app.agentApi.saveCopy();
  assert.equal(result.success, true);
  assert.equal(result.exportPrepared, true);
  assert.equal(result.downloadRequested, true);
  assert.equal(result.deliveryConfirmed, false);
});

test('connect_objects creates canonical connectors that follow transformed endpoints and survive save/reopen', () => {
  const app = makeApp();
  const commands = [
    { type: 'create_object', object: labeledRectangle('source', 40, 'Source') },
    { type: 'create_object', object: labeledRectangle('destination', 320, 'Destination') },
    {
      type: 'connect_objects',
      connectorId: 'source_destination',
      fromId: 'source',
      toId: 'destination',
      fromAnchor: { x: 1, y: 0.5 },
      toAnchor: { x: 0, y: 0.5 },
      routing: 'elbow'
    },
    { type: 'move_objects', ids: ['destination'], dx: 80, dy: 45 },
    { type: 'resize_object', id: 'destination', bounds: { x: 400, y: 145, width: 210, height: 120 } },
    { type: 'rotate_objects', objects: { destination: { rotation: 35 } } }
  ];
  const result = app.agentApi.apply(request(app, 'connector-transform', commands));
  assert.equal(result.success, true);
  const connector = app.doc.objects.source_destination;
  assert.equal('x' in connector, false);
  assert.equal('width' in connector, false);
  assert.equal('curveDistance' in connector, false);
  assert.equal('elbowOffset' in connector, false);
  assert.equal('stacking' in connector, false);
  assert.deepEqual(connector.from, { id: 'source', anchor: { x: 1, y: 0.5 } });
  assert.deepEqual(connector.to, { id: 'destination', anchor: { x: 0, y: 0.5 } });
  const geometry = resolveConnectorGeometry(app.doc, connector);
  assert.equal([geometry.start, geometry.end, ...geometry.points].every(point =>
    Number.isFinite(point.x) && Number.isFinite(point.y)), true);
  assert.deepEqual(validateDocument(app.doc), { valid: true, errors: [] });

  const html = fs.readFileSync(new URL('../sabura.html', import.meta.url), 'utf8');
  const packed = packageHtmlWithDocument(html, app.doc);
  assert.equal(packed.success, true);
  const reopened = extractDocumentFromHtml(packed.html);
  assert.equal(reopened.valid, true);
  assert.deepEqual(reopened.document.objects.source_destination, connector);
  assert.equal(reopened.document.objects.destination.id, 'destination');
});
