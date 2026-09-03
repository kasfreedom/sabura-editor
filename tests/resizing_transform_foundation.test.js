import test from 'node:test';
import assert from 'node:assert/strict';

// Setup minimal DOM mocks for Node.js test environment
if (typeof window === 'undefined') {
  global.window = {
    innerWidth: 1000,
    innerHeight: 800,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}
if (typeof document === 'undefined') {
  global.document = {
    activeElement: null,
    createElement: (tag) => {
      const el = {
        tagName: tag.toUpperCase(),
        className: '',
        style: {},
        children: [],
        innerHTML: '',
        appendChild: (child) => { el.children.push(child); },
        querySelectorAll: () => [],
        querySelector: () => null,
        addEventListener: () => {},
        removeEventListener: () => {}
      };
      return el;
    }
  };
}

import { createDefaultDocument, createDefaultObject, cloneDocument, validateDocument } from '../src/core/document.js';
import { applyCommand, applyCommandBatch, validateCommand } from '../src/core/commands.js';
import { calculateResize, transformObjects, getBoundingBox, getUnionBoundingBox, distanceToPath, distanceToConnector } from '../src/core/geometry.js';
import { renderObject, renderSelectionOverlay } from '../src/renderer/svg-renderer.js';
import { packageHtmlWithDocument, extractDocumentFromHtml } from '../src/storage/file-packer.js';
import { ToolWheel } from '../src/ui/wheel.js';
import { Workspace } from '../src/ui/workspace.js';

function createMockContainer() {
  return {
    addEventListener: () => {},
    removeEventListener: () => {},
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    style: {},
    innerHTML: '',
    appendChild: () => {},
    querySelector: () => null
  };
}

test('AC-01: Single-object resize handles calculation for shapes, text, and paths', () => {
  // Rectangle
  const origRect = { x: 100, y: 100, width: 200, height: 100 };
  const resE = calculateResize('e', origRect, 50, 0, {});
  assert.equal(resE.width, 250);
  assert.equal(resE.height, 100);
  assert.equal(resE.x, 100);

  // Aspect ratio preservation (Shift)
  const resSE_shift = calculateResize('se', origRect, 100, 20, { keepAspect: true });
  assert.equal(resSE_shift.width, 300);
  assert.equal(resSE_shift.height, 150);

  // Resize from center (Alt)
  const resSE_alt = calculateResize('se', origRect, 50, 50, { fromCenter: true });
  assert.equal(resSE_alt.x, 50);
  assert.equal(resSE_alt.y, 50);
  assert.equal(resSE_alt.width, 300);
  assert.equal(resSE_alt.height, 200);

  // Zero-dimension safety guards
  const zeroRect = { x: 50, y: 50, width: 0, height: 0 };
  const resZero = calculateResize('se', zeroRect, 40, 40, { keepAspect: true });
  assert.ok(!Number.isNaN(resZero.width) && !Number.isNaN(resZero.height));
});

test('AC-02: Escape / pointer interruption cancellation discards uncommitted live resize', () => {
  let doc = createDefaultDocument();
  const box = createDefaultObject('rectangle', { id: 'box1', x: 100, y: 100, width: 100, height: 100 });
  doc = applyCommand(doc, { type: 'create_object', object: box }).doc;

  const container = createMockContainer();

  const ws = new Workspace(container, {
    getDocument: () => doc,
    onCommand: (cmd) => { doc = applyCommand(doc, cmd).doc; },
    onCommandBatch: (cmds) => { doc = applyCommandBatch(doc, cmds).doc; },
    onOpenWheel: () => {},
    onDoubleClickedObject: () => {}
  });

  ws.mode = 'editing';
  ws.selectedIds = ['box1'];

  // Start resize on 'se' handle
  ws.onPointerDown({
    clientX: 204,
    clientY: 204,
    button: 0,
    target: {
      closest: (sel) => ({ getAttribute: (attr) => attr === 'data-handle' ? 'se' : null }),
      getAttribute: (attr) => attr === 'data-handle' ? 'se' : null
    },
    stopPropagation: () => {}
  });

  assert.equal(ws.isResizing, true);

  // Live drag preview
  ws.onPointerMove({
    clientX: 304,
    clientY: 304,
    shiftKey: false,
    altKey: false
  });

  // Verify temporary mutation during drag
  assert.equal(doc.objects.box1.width, 200);

  // Cancel via Escape
  ws.cancelGesture();

  // Bounds must be completely restored to initial 100x100
  assert.equal(doc.objects.box1.width, 100);
  assert.equal(doc.objects.box1.height, 100);
  assert.equal(ws.isResizing, false);
});

test('AC-03: Single path resizing proportionally scales local points and maintains alignment', () => {
  let doc = createDefaultDocument();
  const pathObj = createDefaultObject('path', {
    id: 'p1',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    points: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 50 }],
    closed: false
  });
  doc = applyCommand(doc, { type: 'create_object', object: pathObj }).doc;

  // Resize path to 400x200 (2x scale)
  const resizeResult = applyCommand(doc, {
    type: 'resize_object',
    id: 'p1',
    bounds: { x: 100, y: 100, width: 400, height: 200 }
  });
  doc = resizeResult.doc;

  const pResized = doc.objects.p1;
  assert.equal(pResized.width, 400);
  assert.equal(pResized.height, 200);
  assert.deepEqual(pResized.points, [
    { x: 0, y: 0 },
    { x: 200, y: 200 },
    { x: 400, y: 100 }
  ]);

  // Undo restores exact original points
  const undoResult = applyCommand(doc, resizeResult.inverseCmd);
  doc = undoResult.doc;
  assert.equal(doc.objects.p1.width, 200);
  assert.equal(doc.objects.p1.height, 100);
  assert.deepEqual(doc.objects.p1.points, [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
    { x: 200, y: 50 }
  ]);
});

test('AC-04 & AC-05: Multi-selection shared resize handles and proportional transformation', () => {
  let doc = createDefaultDocument();
  const b1 = createDefaultObject('rectangle', { id: 'b1', x: 100, y: 100, width: 100, height: 100 });
  const b2 = createDefaultObject('rectangle', { id: 'b2', x: 300, y: 200, width: 100, height: 100 });
  const conn = createDefaultObject('connector', {
    id: 'c1',
    from: { point: { x: 10, y: 10 } },
    to: { point: { x: 500, y: 500 } }
  });
  doc = applyCommand(doc, { type: 'create_object', object: b1 }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: b2 }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: conn }).doc;

  // Spatial objects union excludes connectors
  const spatialObjs = [b1, b2, conn].filter(o => o.type !== 'connector');
  const spatialUnion = getUnionBoundingBox(spatialObjs, doc);
  assert.equal(spatialUnion.x, 100);
  assert.equal(spatialUnion.y, 100);
  assert.equal(spatialUnion.width, 300);
  assert.equal(spatialUnion.height, 200);

  // Overlay renders shared handles
  const overlay = renderSelectionOverlay(doc, ['b1', 'b2', 'c1']);
  assert.ok(overlay.includes('data-handle="se"'));

  // Transform objects helper
  const origBox = { x: 100, y: 100, width: 300, height: 200 };
  const newBox = { x: 100, y: 100, width: 600, height: 400 }; // 2x scale
  const transformed = transformObjects([b1, b2], origBox, newBox);

  const t1 = transformed.find(o => o.id === 'b1');
  const t2 = transformed.find(o => o.id === 'b2');

  assert.equal(t1.x, 100);
  assert.equal(t1.y, 100);
  assert.equal(t1.width, 200);
  assert.equal(t1.height, 200);

  assert.equal(t2.x, 500);
  assert.equal(t2.y, 300);
  assert.equal(t2.width, 200);
  assert.equal(t2.height, 200);
});

test('AC-06: Attached connector endpoints preserve normalized anchors during shape resize', () => {
  let doc = createDefaultDocument();
  const shape = createDefaultObject('rectangle', { id: 's1', x: 100, y: 100, width: 100, height: 100 });
  const conn = createDefaultObject('connector', {
    id: 'c1',
    from: { id: 's1', anchor: { x: 0.5, y: 1.0 } }, // bottom-center
    to: { point: { x: 300, y: 300 } }
  });
  doc = applyCommand(doc, { type: 'create_object', object: shape }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: conn }).doc;

  // Resize shape to 200x200
  doc = applyCommand(doc, {
    type: 'resize_object',
    id: 's1',
    bounds: { x: 100, y: 100, width: 200, height: 200 }
  }).doc;

  // Anchor remains normalized (0.5, 1.0)
  assert.deepEqual(doc.objects.c1.from.anchor, { x: 0.5, y: 1.0 });
});

test('AC-07: Free connector endpoints transform once with multi-selection box', () => {
  const origBox = { x: 100, y: 100, width: 200, height: 200 };
  const newBox = { x: 200, y: 200, width: 400, height: 400 }; // Shift +100,+100 and scale 2x

  const conn = createDefaultObject('connector', {
    id: 'c1',
    from: { point: { x: 150, y: 150 } },
    to: { point: { x: 250, y: 250 } }
  });

  const transformed = transformObjects([conn], origBox, newBox);
  const tConn = transformed.find(o => o.id === 'c1');
  assert.deepEqual(tConn.from.point, { x: 300, y: 300 });
  assert.deepEqual(tConn.to.point, { x: 500, y: 500 });
});

test('AC-08: Locked objects are strictly excluded from transformations', () => {
  let doc = createDefaultDocument();
  const b1 = createDefaultObject('rectangle', { id: 'b1', x: 100, y: 100, width: 100, height: 100, locked: false });
  const b2 = createDefaultObject('rectangle', { id: 'b2', x: 300, y: 100, width: 100, height: 100, locked: true });
  doc = applyCommand(doc, { type: 'create_object', object: b1 }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: b2 }).doc;

  const origBox = { x: 100, y: 100, width: 300, height: 100 };
  const newBox = { x: 100, y: 100, width: 600, height: 200 };

  const transformed = transformObjects([b1, b2], origBox, newBox);
  const t1 = transformed.find(o => o.id === 'b1');
  const t2 = transformed.find(o => o.id === 'b2');

  assert.equal(t1.width, 200);
  assert.equal(t2.width, 100, 'Locked b2 must not be modified');
  assert.equal(t2.x, 300, 'Locked b2 must not move');
});

test('AC-09 & AC-10: Group resize transforms all members atomically with single undo step', () => {
  let doc = createDefaultDocument();
  doc.groups['group1'] = { id: 'group1' };
  const g1 = createDefaultObject('rectangle', { id: 'g1', groupId: 'group1', x: 100, y: 100, width: 100, height: 100 });
  const g2 = createDefaultObject('rectangle', { id: 'g2', groupId: 'group1', x: 300, y: 100, width: 100, height: 100 });
  doc = applyCommand(doc, { type: 'create_object', object: g1 }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: g2 }).doc;

  const batchCmds = [
    { type: 'resize_object', id: 'g1', bounds: { x: 100, y: 100, width: 200, height: 200 } },
    { type: 'resize_object', id: 'g2', bounds: { x: 500, y: 100, width: 200, height: 200 } }
  ];

  const batchResult = applyCommandBatch(doc, batchCmds);
  doc = batchResult.doc;

  assert.equal(doc.objects.g1.width, 200);
  assert.equal(doc.objects.g2.x, 500);

  // Single batch undo step restores both objects
  const undoResult = applyCommandBatch(doc, batchResult.inverseCmd.commands);
  doc = undoResult.doc;

  assert.equal(doc.objects.g1.width, 100);
  assert.equal(doc.objects.g2.x, 300);
});

test('AC-11: Standalone text contextual wheel does not expose fill, stroke styling, or equal sides', () => {
  const textObj = createDefaultObject('text', {
    id: 't1',
    x: 100,
    y: 100,
    width: 120,
    height: 40,
    text: 'Hello Sabura',
    stroke: '#e03131',
    textStyle: { color: '#e03131', size: 'm', fontFamily: 'hand' }
  });

  const wheel = new ToolWheel(createMockContainer(), () => {});

  wheel.open(200, 200, 'object', textObj, ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5'], 1, [textObj]);

  const items = wheel.getItems();
  assert.equal(items.length, 8);

  // Slot 0 (12:00): Opacity (no Fill)
  assert.equal(items[0].id, 'menu_opacity');
  assert.ok(items[0].subItems.some(i => i.id === 'opacity_100'));

  // Slot 1 (1:30): Type
  assert.equal(items[1].id, 'menu_type');
  assert.ok(items[1].subItems.some(i => i.id === 'font_hand'));
  assert.ok(items[1].thirdItems.some(i => i.id === 'type_m'));

  // Slot 2 (3:00): Shape Conversion (NO equal sides)
  assert.equal(items[2].id, 'menu_shape');
  assert.ok(items[2].subItems.some(i => i.id === 'to_rectangle'));
  assert.ok(!items[2].subItems.some(i => i.id === 'toggle_equal_sides'));
  if (items[2].thirdItems) {
    assert.ok(!items[2].thirdItems.some(i => i.id === 'toggle_equal_sides'));
  }

  // Slot 3 (4:30): Duplicate
  assert.equal(items[3].id, 'action_duplicate');

  // Slot 4 (6:00): Arrange
  assert.equal(items[4].id, 'menu_order');

  // Slot 5 (7:30): Style - disabled
  assert.equal(items[5].id, 'menu_style');
  assert.equal(items[5].disabled, true);

  // Slot 6 (9:00): Color / Ink
  assert.equal(items[6].id, 'menu_ink');
  assert.ok(items[6].subItems.some(i => i.color === '#e03131' && i.isActive));

  // Slot 7 (10:30): Delete
  assert.equal(items[7].id, 'action_delete');
});

test('AC-12: Morphing text to shape restores shape wheel with Fill menu and stroke styles', () => {
  let doc = createDefaultDocument();
  const textObj = createDefaultObject('text', {
    id: 't1',
    x: 100,
    y: 100,
    width: 120,
    height: 40,
    text: 'Converted Text'
  });
  doc = applyCommand(doc, { type: 'create_object', object: textObj }).doc;

  // Change to rectangle shape
  doc = applyCommand(doc, { type: 'change_shape', id: 't1', newType: 'rectangle' }).doc;
  const rectObj = doc.objects.t1;
  assert.equal(rectObj.type, 'rectangle');

  const wheel = new ToolWheel(createMockContainer(), () => {});

  wheel.open(200, 200, 'object', rectObj, ['#1e1e1e', '#e03131', '#2f9e44'], 1, [rectObj]);

  const items = wheel.getItems();
  // Slot 0 is now Fill with color subItems and opacity thirdItems
  assert.equal(items[0].id, 'menu_fill');
  assert.ok(items[0].subItems.some(i => i.id === 'fill_none'));
  assert.ok(items[0].thirdItems.some(i => i.id === 'opacity_100'));

  // Slot 5 Style is enabled with stroke width thirdItems
  assert.equal(items[5].id, 'menu_style');
  assert.ok(!items[5].disabled);
  assert.ok(items[5].thirdItems.some(i => i.id === 'width_2'));
});

test('AC-13 & AC-14: No outline (strokeWidth: 0) availability and rendering semantics', () => {
  const wheel = new ToolWheel(createMockContainer(), () => {});

  // 1. Closed shape with fill -> No outline available
  const filledShape = createDefaultObject('rectangle', { fill: '#ffc9c9', stroke: '#e03131', strokeWidth: 2 });
  wheel.open(100, 100, 'object', filledShape, ['#1e1e1e', '#e03131'], 1, [filledShape]);
  const filledItems = wheel.getItems();
  const styleItemFilled = filledItems.find(i => i.id === 'menu_style');
  assert.ok(styleItemFilled.thirdItems.some(w => w.id === 'width_0' && w.label === 'No outline'));

  // 2. Closed shape with text -> No outline available
  const textShape = createDefaultObject('rectangle', { fill: 'none', text: 'Label', stroke: '#1e1e1e', strokeWidth: 2 });
  wheel.open(100, 100, 'object', textShape, ['#1e1e1e'], 1, [textShape]);
  const textShapeItems = wheel.getItems();
  const styleItemText = textShapeItems.find(i => i.id === 'menu_style');
  assert.ok(styleItemText.thirdItems.some(w => w.id === 'width_0'));

  // 3. Transparent empty shape -> No outline NOT available
  const emptyShape = createDefaultObject('rectangle', { fill: 'none', text: '', stroke: '#1e1e1e', strokeWidth: 2 });
  wheel.open(100, 100, 'object', emptyShape, ['#1e1e1e'], 1, [emptyShape]);
  const emptyItems = wheel.getItems();
  const styleItemEmpty = emptyItems.find(i => i.id === 'menu_style');
  assert.ok(!styleItemEmpty.thirdItems.some(w => w.id === 'width_0'));

  // 4. Open path -> No outline NOT available
  const openPath = createDefaultObject('path', { closed: false, stroke: '#1e1e1e', strokeWidth: 2 });
  wheel.open(100, 100, 'object', openPath, ['#1e1e1e'], 1, [openPath]);
  const openPathItems = wheel.getItems();
  const styleItemOpenPath = openPathItems.find(i => i.id === 'menu_style');
  assert.ok(!styleItemOpenPath.thirdItems.some(w => w.id === 'width_0'));

  // 5. Connector -> No outline NOT available
  const conn = createDefaultObject('connector', { stroke: '#1e1e1e', strokeWidth: 2 });
  wheel.open(100, 100, 'object', conn, ['#1e1e1e'], 1, [conn]);
  const connItems = wheel.getItems();
  const styleItemConn = connItems.find(i => i.id === 'menu_style');
  assert.ok(!styleItemConn.thirdItems.some(w => w.id === 'width_0'));

  // 6. Rendering with strokeWidth: 0
  let doc = createDefaultDocument();
  const shapeNoOutline = createDefaultObject('rectangle', {
    id: 's_no_out',
    x: 50,
    y: 50,
    width: 100,
    height: 100,
    fill: '#ffc9c9',
    stroke: '#e03131',
    strokeWidth: 0
  });
  doc = applyCommand(doc, { type: 'create_object', object: shapeNoOutline }).doc;

  const renderedSvg = renderObject(doc, shapeNoOutline);
  // Must render fill path
  assert.ok(renderedSvg.includes('fill="#ffc9c9"'));
  // Must NOT render stroke path
  assert.ok(!renderedSvg.includes('stroke="#e03131"'));
  // Must preserve stroke color in data model
  assert.equal(shapeNoOutline.stroke, '#e03131');
  assert.equal(shapeNoOutline.strokeWidth, 0);
});

test('F-01: Interactively created connectors produce clean canonical schema without shape fields', () => {
  let doc = createDefaultDocument();
  const box1 = createDefaultObject('rectangle', { id: 'b1', x: 50, y: 50, width: 100, height: 100 });
  const box2 = createDefaultObject('rectangle', { id: 'b2', x: 300, y: 50, width: 100, height: 100 });
  doc = applyCommand(doc, { type: 'create_object', object: box1 }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: box2 }).doc;

  const container = createMockContainer();
  let createdCmd = null;
  const ws = new Workspace(container, {
    getDocument: () => doc,
    onCommand: (cmd) => {
      createdCmd = cmd;
      doc = applyCommand(doc, cmd).doc;
    },
    onCommandBatch: (cmds) => { doc = applyCommandBatch(doc, cmds).doc; },
    onOpenWheel: () => {},
    onDoubleClickedObject: () => {}
  });

  ws.mode = 'editing';
  ws.activeTool = 'connector';

  // 1. Pointer down on box1
  ws.onPointerDown({ clientX: 100, clientY: 100, button: 0 });
  assert.ok(ws.isCreating);
  assert.equal(ws.draftObject.type, 'connector');
  assert.equal('x' in ws.draftObject, false);
  assert.equal('y' in ws.draftObject, false);
  assert.equal('width' in ws.draftObject, false);
  assert.equal('height' in ws.draftObject, false);

  // 2. Pointer move to box2
  ws.onPointerMove({ clientX: 350, clientY: 100 });
  assert.equal('width' in ws.draftObject, false);
  assert.equal('height' in ws.draftObject, false);

  // 3. Pointer up on box2
  ws.onPointerUp({ clientX: 350, clientY: 100, button: 0 });
  assert.ok(createdCmd);
  const connObj = createdCmd.object;
  assert.equal(connObj.type, 'connector');
  assert.equal('x' in connObj, false);
  assert.equal('y' in connObj, false);
  assert.equal('width' in connObj, false);
  assert.equal('height' in connObj, false);
  assert.equal(connObj.from.id, 'b1');
  assert.equal(connObj.to.id, 'b2');

  // Document validation and packaging MUST pass cleanly
  const val = validateDocument(doc);
  assert.equal(val.valid, true, `Document validation failed: ${val.errors.join(', ')}`);

  const mockHtml = `<!DOCTYPE html><html><head></head><body><script id="sabura-document" type="application/json">{"schemaVersion":"sabura/canvas/v1"}</script></body></html>`;
  const packResult = packageHtmlWithDocument(mockHtml, doc);
  assert.equal(packResult.success, true);
  const extracted = extractDocumentFromHtml(packResult.html);
  assert.equal(extracted.valid, true);
  assert.ok(extracted.document.objects[connObj.id]);
});

test('F-01 Regression: Group objects, duplicate group, connect groups, Save Copy and reopen', () => {
  let doc = createDefaultDocument();
  const s1 = createDefaultObject('rectangle', { id: 's1', x: 50, y: 50, width: 80, height: 80 });
  const s2 = createDefaultObject('ellipse', { id: 's2', x: 150, y: 50, width: 80, height: 80 });
  doc = applyCommand(doc, { type: 'create_object', object: s1 }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: s2 }).doc;

  // Group s1 and s2 into 'grp1'
  doc = applyCommand(doc, { type: 'group_objects', ids: ['s1', 's2'], groupId: 'grp1' }).doc;
  assert.equal(doc.objects['s1'].groupId, 'grp1');
  assert.equal(doc.objects['s2'].groupId, 'grp1');

  // Duplicate objects in group
  doc = applyCommand(doc, { type: 'duplicate_objects', ids: ['s1', 's2'] }).doc;

  const duplicatedObjs = Object.values(doc.objects).filter(o => o.id !== 's1' && o.id !== 's2' && o.type !== 'connector');
  assert.equal(duplicatedObjs.length, 2);
  const dup1 = duplicatedObjs[0];
  const dup2 = duplicatedObjs[1];
  assert.ok(dup1.groupId && dup1.groupId !== 'grp1');
  assert.equal(dup1.groupId, dup2.groupId);

  // Move duplicated group so it doesn't overlap with original
  doc = applyCommand(doc, { type: 'move_objects', ids: [dup1.id, dup2.id], dx: 300, dy: 300 }).doc;

  // Interactively create connector between grp1 shape (s1) and duplicated group shape (dup1)
  const container = createMockContainer();
  const ws = new Workspace(container, {
    getDocument: () => doc,
    onCommand: (cmd) => { doc = applyCommand(doc, cmd).doc; },
    onCommandBatch: (cmds) => { doc = applyCommandBatch(doc, cmds).doc; },
    onOpenWheel: () => {},
    onDoubleClickedObject: () => {}
  });
  ws.mode = 'editing';
  ws.activeTool = 'connector';

  // Draw connector from s1 to dup1
  ws.onPointerDown({ clientX: 90, clientY: 90, button: 0 });
  ws.onPointerMove({ clientX: doc.objects[dup1.id].x + 40, clientY: doc.objects[dup1.id].y + 40 });
  ws.onPointerUp({ clientX: doc.objects[dup1.id].x + 40, clientY: doc.objects[dup1.id].y + 40, button: 0 });

  const val = validateDocument(doc);
  assert.equal(val.valid, true, `Document validation failed: ${val.errors.join(', ')}`);

  // Package / Save Copy and extract / reopen
  const mockHtml = `<!DOCTYPE html><html><head></head><body><script id="sabura-document" type="application/json">{"schemaVersion":"sabura/canvas/v1"}</script></body></html>`;
  const packResult = packageHtmlWithDocument(mockHtml, doc);
  assert.equal(packResult.success, true);
  const extracted = extractDocumentFromHtml(packResult.html);
  assert.equal(extracted.valid, true);

  const reopenedDoc = extracted.document;
  assert.ok(reopenedDoc.groups['grp1']);
  assert.ok(reopenedDoc.groups[dup1.groupId]);
  assert.equal(reopenedDoc.objects['s1'].groupId, 'grp1');
  assert.equal(reopenedDoc.objects[dup1.id].groupId, dup1.groupId);

  // Verify connector connects the two groups
  const conns = Object.values(reopenedDoc.objects).filter(o => o.type === 'connector');
  assert.equal(conns.length, 1);
  assert.equal(conns[0].from.id, 's1');
  assert.equal(conns[0].to.id, dup1.id);
});

test('F-03: Table-driven command validation and atomic batch regression for review-r2 reproductions', () => {
  const initialDoc = createDefaultDocument();
  const shape = createDefaultObject('rectangle', { id: 'sh1', x: 100, y: 100, width: 100, height: 100 });
  const pathObj = createDefaultObject('path', { id: 'p1', x: 100, y: 100, width: 100, height: 100, points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] });
  const conn = createDefaultObject('connector', { id: 'c1', from: { id: 'sh1' }, to: { point: { x: 300, y: 300 } } });
  
  let doc = applyCommand(initialDoc, { type: 'create_object', object: shape }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: pathObj }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: conn }).doc;

  const negativeCases = [
    {
      name: 'Array connector point is rejected',
      cmd: {
        type: 'configure_connector_endpoints',
        id: 'c1',
        from: { id: 'sh1' },
        to: { point: [300, 300] }
      }
    },
    {
      name: 'Unknown property on connector endpoint is rejected',
      cmd: {
        type: 'configure_connector_endpoints',
        id: 'c1',
        from: { id: 'sh1', bogus: 123 },
        to: { point: { x: 300, y: 300 } }
      }
    },
    {
      name: 'Unknown property on connector anchor is rejected',
      cmd: {
        type: 'configure_connector_endpoints',
        id: 'c1',
        from: { id: 'sh1', anchor: { x: 0.5, y: 0.5, extra: true } },
        to: { point: { x: 300, y: 300 } }
      }
    },
    {
      name: 'Invalid textStyle (non-finite resolvedSize) on resize_object is rejected',
      cmd: {
        type: 'resize_object',
        id: 'sh1',
        bounds: { x: 100, y: 100, width: 100, height: 100 },
        textStyle: { resolvedSize: NaN }
      }
    },
    {
      name: 'Invalid textStyle (unknown property) on resize_object is rejected',
      cmd: {
        type: 'resize_object',
        id: 'sh1',
        bounds: { x: 100, y: 100, width: 100, height: 100 },
        textStyle: { bogus: 'illegal' }
      }
    },
    {
      name: 'Path points specified on non-path object (rectangle) is rejected',
      cmd: {
        type: 'resize_object',
        id: 'sh1',
        bounds: { x: 100, y: 100, width: 120, height: 120 },
        points: [{ x: 0, y: 0 }, { x: 120, y: 120 }]
      }
    },
    {
      name: 'update_path_points on non-path object (rectangle) is rejected',
      cmd: {
        type: 'update_path_points',
        id: 'sh1',
        points: [{ x: 0, y: 0 }, { x: 120, y: 120 }]
      }
    },
    {
      name: 'Connector endpoint referencing non-existent target is rejected in document context',
      cmd: {
        type: 'reconnect_connector',
        id: 'c1',
        endpoint: 'to',
        target: { id: 'missing_target_object' }
      }
    }
  ];

  for (const tc of negativeCases) {
    const val = validateCommand(tc.cmd, doc);
    assert.equal(val.valid, false, `Expected validation failure for: ${tc.name}`);

    // Verify applyCommand throws or returns noop without corrupting doc
    const beforeState = JSON.stringify(doc);
    assert.throws(() => {
      const res = applyCommand(doc, tc.cmd);
      if (res.inverseCmd.type === 'noop') throw new Error('noop returned');
    }, null, `Expected applyCommand to fail or be rejected for: ${tc.name}`);
    
    // Verify document was unchanged and remains valid
    const afterState = JSON.stringify(doc);
    assert.equal(beforeState, afterState, `Document modified unexpectedly for: ${tc.name}`);
    const docVal = validateDocument(doc);
    assert.equal(docVal.valid, true, `Document became invalid after testing: ${tc.name}`);
  }

  // Atomic batch reproduction from review-r2: valid move + invalid connector endpoint target
  const beforeBatch = JSON.stringify(doc);
  const badBatch = [
    { type: 'move_objects', ids: ['sh1'], dx: 50, dy: 0 },
    { type: 'reconnect_connector', id: 'c1', endpoint: 'to', target: { id: 'non_existent_target_id' } }
  ];

  // Batch execution MUST abort atomically and throw
  assert.throws(() => {
    applyCommandBatch(doc, badBatch);
  });

  // Verify input document was NOT mutated (sh1 was not moved by 50px)
  assert.equal(JSON.stringify(doc), beforeBatch);
  assert.equal(doc.objects['sh1'].x, 100);

  // Document validates cleanly and packages successfully
  const valCheck = validateDocument(doc);
  assert.equal(valCheck.valid, true);

  const mockHtml = `<!DOCTYPE html><html><head></head><body><script id="sabura-document" type="application/json">{"schemaVersion":"sabura/canvas/v1"}</script></body></html>`;
  const packResult = packageHtmlWithDocument(mockHtml, doc);
  assert.equal(packResult.success, true);
  const extracted = extractDocumentFromHtml(packResult.html);
  assert.equal(extracted.valid, true);
  assert.equal(extracted.document.objects['sh1'].x, 100);
  assert.equal(extracted.document.objects['c1'].id, 'c1');
});

test('F-03: Valid legacy text sizes above 120 and below 10 resize, undo, redo, validate, and package cleanly', () => {
  const initialDoc = createDefaultDocument();

  // Case 1: Large text size (resolvedSize: 200 > 120)
  const largeText = createDefaultObject('text', {
    id: 'large_txt',
    x: 100,
    y: 100,
    width: 200,
    height: 80,
    text: 'Large Header',
    textStyle: { color: '#1e1e1e', size: 'xl', resolvedSize: 200 }
  });
  let doc = applyCommand(initialDoc, { type: 'create_object', object: largeText }).doc;
  assert.equal(validateDocument(doc).valid, true);
  assert.equal(doc.objects['large_txt'].textStyle.resolvedSize, 200);

  // Resize to standard clamped size (120)
  const resizeLargeCmd = {
    type: 'resize_object',
    id: 'large_txt',
    bounds: { x: 100, y: 100, width: 150, height: 60 },
    textStyle: { size: 'xl', resolvedSize: 120 }
  };
  const { doc: resizedLargeDoc, inverseCmd: invLarge } = applyCommand(doc, resizeLargeCmd);
  assert.equal(resizedLargeDoc.objects['large_txt'].textStyle.resolvedSize, 120);

  // Undo resize: MUST restore exact legacy size 200 without validation error
  const { doc: unLargeDoc } = applyCommand(resizedLargeDoc, invLarge);
  assert.equal(unLargeDoc.objects['large_txt'].textStyle.resolvedSize, 200);
  assert.equal(validateDocument(unLargeDoc).valid, true);

  // Redo resize
  const { doc: reLargeDoc } = applyCommand(unLargeDoc, resizeLargeCmd);
  assert.equal(reLargeDoc.objects['large_txt'].textStyle.resolvedSize, 120);
  assert.equal(validateDocument(reLargeDoc).valid, true);

  // Packaging and extraction round-trip
  const mockHtml = `<!DOCTYPE html><html><head></head><body><script id="sabura-document" type="application/json">{"schemaVersion":"sabura/canvas/v1"}</script></body></html>`;
  const packLarge = packageHtmlWithDocument(mockHtml, unLargeDoc);
  assert.equal(packLarge.success, true);
  const extLarge = extractDocumentFromHtml(packLarge.html);
  assert.equal(extLarge.valid, true);
  assert.equal(extLarge.document.objects['large_txt'].textStyle.resolvedSize, 200);

  // Case 2: Small text size (resolvedSize: 6 < 10)
  const smallText = createDefaultObject('text', {
    id: 'small_txt',
    x: 300,
    y: 100,
    width: 60,
    height: 20,
    text: 'Fine Print',
    textStyle: { color: '#1e1e1e', size: 's', resolvedSize: 6 }
  });
  let docSmall = applyCommand(initialDoc, { type: 'create_object', object: smallText }).doc;
  assert.equal(validateDocument(docSmall).valid, true);
  assert.equal(docSmall.objects['small_txt'].textStyle.resolvedSize, 6);

  // Resize small text to 20
  const resizeSmallCmd = {
    type: 'resize_object',
    id: 'small_txt',
    bounds: { x: 300, y: 100, width: 80, height: 28 },
    textStyle: { size: 's', resolvedSize: 20 }
  };
  const { doc: resizedSmallDoc, inverseCmd: invSmall } = applyCommand(docSmall, resizeSmallCmd);
  assert.equal(resizedSmallDoc.objects['small_txt'].textStyle.resolvedSize, 20);

  // Undo resize: MUST restore exact legacy size 6 without validation error
  const { doc: unSmallDoc } = applyCommand(resizedSmallDoc, invSmall);
  assert.equal(unSmallDoc.objects['small_txt'].textStyle.resolvedSize, 6);
  assert.equal(validateDocument(unSmallDoc).valid, true);

  // Redo resize
  const { doc: reSmallDoc } = applyCommand(unSmallDoc, resizeSmallCmd);
  assert.equal(reSmallDoc.objects['small_txt'].textStyle.resolvedSize, 20);
  assert.equal(validateDocument(reSmallDoc).valid, true);

  const packSmall = packageHtmlWithDocument(mockHtml, unSmallDoc);
  assert.equal(packSmall.success, true);
  const extSmall = extractDocumentFromHtml(packSmall.html);
  assert.equal(extSmall.valid, true);
  assert.equal(extSmall.document.objects['small_txt'].textStyle.resolvedSize, 6);
});

test('F-04: Workspace pointer resize path executes exact same transform as transformObjects', () => {
  let doc = createDefaultDocument();
  const rect = createDefaultObject('rectangle', { id: 'r1', x: 100, y: 100, width: 100, height: 100 });
  const path = createDefaultObject('path', { id: 'p1', x: 250, y: 100, width: 100, height: 100, points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] });
  const text = createDefaultObject('text', { id: 't1', x: 100, y: 250, width: 80, height: 32, text: 'Hello', textStyle: { resolvedSize: 20 } });
  const freeConn = createDefaultObject('connector', { id: 'c1', from: { point: { x: 150, y: 150 } }, to: { point: { x: 300, y: 150 } } });

  doc = applyCommand(doc, { type: 'create_object', object: rect }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: path }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: text }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: freeConn }).doc;

  const origBox = getUnionBoundingBox([rect, path, text], doc);
  const targetBox = { x: 100, y: 100, width: origBox.width + 100, height: origBox.height + 50 };

  // Calculate direct pure-functional transform
  const expectedTransformed = transformObjects([rect, path, text, freeConn], origBox, targetBox);

  // Execute interactive pointer resize in Workspace
  const container = createMockContainer();
  let executedBatch = null;
  const ws = new Workspace(container, {
    getDocument: () => doc,
    onCommand: (cmd) => { doc = applyCommand(doc, cmd).doc; },
    onCommandBatch: (cmds) => {
      executedBatch = cmds;
      doc = applyCommandBatch(doc, cmds).doc;
    },
    onOpenWheel: () => {},
    onDoubleClickedObject: () => {}
  });

  ws.mode = 'editing';
  ws.selectedIds = ['r1', 'p1', 't1', 'c1'];

  // Start resize on 'se' handle
  const sePos = { x: origBox.x + origBox.width, y: origBox.y + origBox.height };
  const mockHandleEl = { getAttribute: (attr) => attr === 'data-handle' ? 'se' : null };
  ws.onPointerDown({
    clientX: sePos.x,
    clientY: sePos.y,
    button: 0,
    target: { closest: (sel) => sel === '[data-handle]' ? mockHandleEl : null }
  });
  ws.onPointerMove({ clientX: sePos.x + 100, clientY: sePos.y + 50 });
  ws.onPointerUp({ clientX: sePos.x + 100, clientY: sePos.y + 50, button: 0 });

  assert.ok(executedBatch);
  assert.equal(executedBatch.length, 4);

  // Assert each object matches expected transform exactly
  const r1Exp = expectedTransformed.find(o => o.id === 'r1');
  assert.equal(doc.objects['r1'].x, r1Exp.x);
  assert.equal(doc.objects['r1'].width, r1Exp.width);

  const p1Exp = expectedTransformed.find(o => o.id === 'p1');
  assert.deepEqual(doc.objects['p1'].points, p1Exp.points);

  const t1Exp = expectedTransformed.find(o => o.id === 't1');
  assert.equal(doc.objects['t1'].textStyle.resolvedSize, t1Exp.textStyle.resolvedSize);

  const c1Exp = expectedTransformed.find(o => o.id === 'c1');
  assert.deepEqual(doc.objects['c1'].from.point, c1Exp.from.point);
  assert.deepEqual(doc.objects['c1'].to.point, c1Exp.to.point);
});
