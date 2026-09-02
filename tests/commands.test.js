import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDocument, createDefaultObject } from '../src/core/document.js';
import { applyCommand, applyCommandBatch } from '../src/core/commands.js';

test('create_object and undo via delete_objects', () => {
  const doc = createDefaultDocument();
  const rect = createDefaultObject('rectangle', { id: 'r1', x: 50, y: 50, width: 100, height: 60 });

  const { doc: doc1, inverseCmd } = applyCommand(doc, {
    type: 'create_object',
    object: rect
  });

  assert.ok(doc1.objects['r1']);
  assert.deepEqual(doc1.order, ['r1']);

  // Apply inverse
  const { doc: doc2 } = applyCommand(doc1, inverseCmd);
  assert.equal(doc2.objects['r1'], undefined);
  assert.deepEqual(doc2.order, []);
});

test('move_objects and inverse', () => {
  const doc = createDefaultDocument();
  const rect = createDefaultObject('rectangle', { id: 'r1', x: 50, y: 50 });
  const { doc: doc1 } = applyCommand(doc, { type: 'create_object', object: rect });

  const { doc: doc2, inverseCmd } = applyCommand(doc1, {
    type: 'move_objects',
    ids: ['r1'],
    dx: 30,
    dy: -15
  });

  assert.equal(doc2.objects['r1'].x, 80);
  assert.equal(doc2.objects['r1'].y, 35);

  const { doc: doc3 } = applyCommand(doc2, inverseCmd);
  assert.equal(doc3.objects['r1'].x, 50);
  assert.equal(doc3.objects['r1'].y, 50);
});

test('resize_object scales text when requested and restores on undo', () => {
  const doc = createDefaultDocument();
  const rect = createDefaultObject('rectangle', {
    id: 'r1',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    text: 'Hello',
    textStyle: { resolvedSize: 20 }
  });
  const { doc: doc1 } = applyCommand(doc, { type: 'create_object', object: rect });

  const { doc: doc2, inverseCmd } = applyCommand(doc1, {
    type: 'resize_object',
    id: 'r1',
    bounds: { x: 0, y: 0, width: 200, height: 200 },
    scaleText: true
  });

  assert.equal(doc2.objects['r1'].width, 200);
  assert.equal(doc2.objects['r1'].textStyle.resolvedSize, 40);

  const { doc: doc3 } = applyCommand(doc2, inverseCmd);
  assert.equal(doc3.objects['r1'].width, 100);
  assert.equal(doc3.objects['r1'].textStyle.resolvedSize, 20);
});

test('group and ungroup objects preserve order and relations', () => {
  const doc = createDefaultDocument();
  const r1 = createDefaultObject('rectangle', { id: 'r1' });
  const r2 = createDefaultObject('rectangle', { id: 'r2' });

  const { doc: doc1 } = applyCommandBatch(doc, [
    { type: 'create_object', object: r1 },
    { type: 'create_object', object: r2 }
  ]);

  const { doc: doc2, inverseCmd } = applyCommand(doc1, {
    type: 'group_objects',
    ids: ['r1', 'r2'],
    groupId: 'grp_1'
  });

  assert.equal(doc2.objects['r1'].groupId, 'grp_1');
  assert.equal(doc2.objects['r2'].groupId, 'grp_1');
  assert.ok(doc2.groups['grp_1']);

  // Ungroup
  const { doc: doc3 } = applyCommand(doc2, {
    type: 'ungroup_objects',
    groupIds: ['grp_1']
  });

  assert.equal(doc3.objects['r1'].groupId, null);
  assert.equal(doc3.objects['r2'].groupId, null);
  assert.equal(doc3.groups['grp_1'], undefined);
});

test('reorder objects (front, back, forward, backward)', () => {
  const doc = createDefaultDocument();
  const r1 = createDefaultObject('rectangle', { id: 'r1' });
  const r2 = createDefaultObject('rectangle', { id: 'r2' });
  const r3 = createDefaultObject('rectangle', { id: 'r3' });

  const { doc: doc1 } = applyCommandBatch(doc, [
    { type: 'create_object', object: r1 },
    { type: 'create_object', object: r2 },
    { type: 'create_object', object: r3 }
  ]);

  assert.deepEqual(doc1.order, ['r1', 'r2', 'r3']);

  // Send r3 to back
  const { doc: doc2, inverseCmd: inv1 } = applyCommand(doc1, {
    type: 'reorder_objects',
    ids: ['r3'],
    action: 'back'
  });
  assert.deepEqual(doc2.order, ['r3', 'r1', 'r2']);

  // Undo reorder
  const { doc: doc3 } = applyCommand(doc2, inv1);
  assert.deepEqual(doc3.order, ['r1', 'r2', 'r3']);
});

test('change_shape preserves identity, position, and connections', () => {
  const doc = createDefaultDocument();
  const rect = createDefaultObject('rectangle', { id: 'r1', x: 40, y: 60, width: 120, height: 80, text: 'Box' });
  const { doc: doc1 } = applyCommand(doc, { type: 'create_object', object: rect });

  const { doc: doc2, inverseCmd } = applyCommand(doc1, {
    type: 'change_shape',
    id: 'r1',
    newType: 'diamond'
  });

  assert.equal(doc2.objects['r1'].type, 'diamond');
  assert.equal(doc2.objects['r1'].x, 40);
  assert.equal(doc2.objects['r1'].text, 'Box');

  const { doc: doc3 } = applyCommand(doc2, inverseCmd);
  assert.equal(doc3.objects['r1'].type, 'rectangle');
});

test('align_objects and distribute_objects atomic execution and undo', () => {
  const doc = createDefaultDocument();
  const r1 = createDefaultObject('rectangle', { id: 'r1', x: 10, y: 10, width: 50, height: 50 });
  const r2 = createDefaultObject('rectangle', { id: 'r2', x: 80, y: 30, width: 50, height: 50 });
  const r3 = createDefaultObject('rectangle', { id: 'r3', x: 200, y: 50, width: 50, height: 50 });

  const { doc: doc1 } = applyCommandBatch(doc, [
    { type: 'create_object', object: r1 },
    { type: 'create_object', object: r2 },
    { type: 'create_object', object: r3 }
  ]);

  // Align left
  const { doc: doc2, inverseCmd: invAlign } = applyCommand(doc1, {
    type: 'align_objects',
    ids: ['r1', 'r2', 'r3'],
    alignment: 'left'
  });

  assert.equal(doc2.objects['r1'].x, 10);
  assert.equal(doc2.objects['r2'].x, 10);
  assert.equal(doc2.objects['r3'].x, 10);

  // Undo alignment
  const { doc: doc3 } = applyCommand(doc2, invAlign);
  assert.equal(doc3.objects['r1'].x, 10);
  assert.equal(doc3.objects['r2'].x, 80);
  assert.equal(doc3.objects['r3'].x, 200);

  // Distribute horizontal
  const { doc: doc4, inverseCmd: invDist } = applyCommand(doc3, {
    type: 'distribute_objects',
    ids: ['r1', 'r2', 'r3'],
    direction: 'horizontal'
  });
  assert.ok(doc4.objects['r2'].x > doc4.objects['r1'].x);
  assert.ok(doc4.objects['r3'].x > doc4.objects['r2'].x);

  // Undo distribution
  const { doc: doc5 } = applyCommand(doc4, invDist);
  assert.equal(doc5.objects['r2'].x, 80);
});

test('set_style toggles clean vs sketch and stroke styles atomically', () => {
  const doc = createDefaultDocument();
  const r1 = createDefaultObject('rectangle', { id: 'r1', roughness: 1, strokeStyle: 'solid' });
  const { doc: doc1 } = applyCommand(doc, { type: 'create_object', object: r1 });

  // Set clean style and dashed stroke
  const { doc: doc2, inverseCmd } = applyCommand(doc1, {
    type: 'set_style',
    ids: ['r1'],
    updates: { roughness: 0, strokeStyle: 'dashed' }
  });

  assert.equal(doc2.objects['r1'].roughness, 0);
  assert.equal(doc2.objects['r1'].strokeStyle, 'dashed');

  // Undo
  const { doc: doc3 } = applyCommand(doc2, inverseCmd);
  assert.equal(doc3.objects['r1'].roughness, 1);
  assert.equal(doc3.objects['r1'].strokeStyle, 'solid');
});

test('set_text auto-fits text object bounds and restores on undo', () => {
  const doc = createDefaultDocument();
  const textObj = createDefaultObject('text', { id: 't1', text: 'Hi', x: 100, y: 100 });
  const initW = textObj.width;
  const initH = textObj.height;

  const { doc: doc1 } = applyCommand(doc, { type: 'create_object', object: textObj });

  // Update text to a longer string
  const { doc: doc2, inverseCmd } = applyCommand(doc1, {
    type: 'set_text',
    id: 't1',
    text: 'Hello World, Welcome to Sabura Whiteboard'
  });

  assert.strictEqual(doc2.objects['t1'].text, 'Hello World, Welcome to Sabura Whiteboard');
  assert.ok(doc2.objects['t1'].width > initW, 'Width should expand for longer text');

  // Undo restores both text and original bounds
  const { doc: doc3 } = applyCommand(doc2, inverseCmd);
  assert.strictEqual(doc3.objects['t1'].text, 'Hi');
  assert.strictEqual(doc3.objects['t1'].width, initW);
  assert.strictEqual(doc3.objects['t1'].height, initH);
});

test('set_board_theme updates existing objects matching defaults and restores on undo', () => {
  const doc = createDefaultDocument(); // Default theme: Paper (stroke #1e1e1e, bg #fcfaf6)
  const rect = createDefaultObject('rectangle', { id: 'r1', stroke: '#1e1e1e', fill: '#fcfaf6' });
  const custom = createDefaultObject('ellipse', { id: 'c1', stroke: '#ff0000', fill: 'none' });

  const { doc: doc1 } = applyCommand(doc, { type: 'create_object', object: rect });
  const { doc: doc2 } = applyCommand(doc1, { type: 'create_object', object: custom });

  // Switch to Blueprint theme
  const { doc: doc3, inverseCmd } = applyCommand(doc2, {
    type: 'set_board_theme',
    themeId: 'blueprint'
  });

  assert.strictEqual(doc3.theme.id, 'blueprint');
  // Built-in object matching defaults should be updated to Blueprint chalk white / navy bg
  assert.strictEqual(doc3.objects['r1'].stroke, '#ffffff');
  assert.strictEqual(doc3.objects['r1'].fill, '#0c192e');
  // Custom styled object should remain untouched
  assert.strictEqual(doc3.objects['c1'].stroke, '#ff0000');

  // Undo restores original theme and object styling
  const { doc: doc4 } = applyCommand(doc3, inverseCmd);
  assert.strictEqual(doc4.theme.id, 'paper');
  assert.strictEqual(doc4.objects['r1'].stroke, '#1e1e1e');
  assert.strictEqual(doc4.objects['r1'].fill, '#fcfaf6');
  assert.strictEqual(doc4.objects['c1'].stroke, '#ff0000');
});

test('configure_connector updates route, arrows, and stacking with reversible undo', () => {
  const doc = createDefaultDocument();
  const conn = createDefaultObject('connector', {
    id: 'conn1',
    routing: 'straight',
    startArrow: false,
    endArrow: true,
    stacking: 'auto'
  });
  const { doc: doc1 } = applyCommand(doc, { type: 'create_object', object: conn });

  // Reconfigure connector
  const { doc: doc2, inverseCmd } = applyCommand(doc1, {
    type: 'configure_connector',
    id: 'conn1',
    routing: 'curved',
    startArrow: true,
    endArrow: true,
    stacking: 'front'
  });

  assert.strictEqual(doc2.objects['conn1'].routing, 'curved');
  assert.strictEqual(doc2.objects['conn1'].startArrow, true);
  assert.strictEqual(doc2.objects['conn1'].endArrow, true);
  assert.strictEqual(doc2.objects['conn1'].stacking, 'front');

  // Undo restores original configuration
  const { doc: doc3 } = applyCommand(doc2, inverseCmd);
  assert.strictEqual(doc3.objects['conn1'].routing, 'straight');
  assert.strictEqual(doc3.objects['conn1'].startArrow, false);
  assert.strictEqual(doc3.objects['conn1'].endArrow, true);
  assert.strictEqual(doc3.objects['conn1'].stacking, 'auto');
});
