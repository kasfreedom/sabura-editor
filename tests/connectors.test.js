import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDocument, createDefaultObject } from '../src/core/document.js';
import { applyCommand, applyCommandBatch } from '../src/core/commands.js';
import { resolveConnectorGeometry } from '../src/core/geometry.js';

test('connectors resolve straight, elbow, and curved routes between objects', () => {
  const doc = createDefaultDocument();
  const b1 = createDefaultObject('rectangle', { id: 'b1', x: 0, y: 0, width: 100, height: 100 });
  const b2 = createDefaultObject('rectangle', { id: 'b2', x: 200, y: 0, width: 100, height: 100 });

  const { doc: doc1 } = applyCommandBatch(doc, [
    { type: 'create_object', object: b1 },
    { type: 'create_object', object: b2 }
  ]);

  const connStraight = createDefaultObject('connector', {
    id: 'c1',
    from: { id: 'b1' },
    to: { id: 'b2' },
    routing: 'straight'
  });

  const geomStraight = resolveConnectorGeometry(doc1, connStraight);
  assert.equal(Math.round(geomStraight.start.x), 100); // Right edge of b1
  assert.equal(Math.round(geomStraight.start.y), 50);  // Center Y of b1
  assert.equal(Math.round(geomStraight.end.x), 200);   // Left edge of b2
  assert.equal(Math.round(geomStraight.end.y), 50);    // Center Y of b2
  assert.ok(geomStraight.path.startsWith('M 100 50 L 200 50'));

  const connElbow = { ...connStraight, routing: 'elbow' };
  const geomElbow = resolveConnectorGeometry(doc1, connElbow);
  assert.ok(geomElbow.points.length >= 3);

  const connCurved = { ...connStraight, routing: 'curved' };
  const geomCurved = resolveConnectorGeometry(doc1, connCurved);
  assert.ok(geomCurved.path.includes('Q'));
});

test('moving connected object updates resolved connector geometry dynamically', () => {
  const doc = createDefaultDocument();
  const b1 = createDefaultObject('rectangle', { id: 'b1', x: 0, y: 0, width: 100, height: 100 });
  const b2 = createDefaultObject('rectangle', { id: 'b2', x: 200, y: 0, width: 100, height: 100 });
  const conn = createDefaultObject('connector', {
    id: 'c1',
    from: { id: 'b1' },
    to: { id: 'b2' },
    routing: 'straight'
  });

  const { doc: doc1 } = applyCommandBatch(doc, [
    { type: 'create_object', object: b1 },
    { type: 'create_object', object: b2 },
    { type: 'create_object', object: conn }
  ]);

  // Move b2 further right by +100
  const { doc: doc2 } = applyCommand(doc1, {
    type: 'move_objects',
    ids: ['b2'],
    dx: 100,
    dy: 0
  });

  const geomUpdated = resolveConnectorGeometry(doc2, doc2.objects['c1']);
  assert.equal(Math.round(geomUpdated.end.x), 300); // Now left edge of b2 is at 300!
});

test('getShapeSnapPoints and getClosestBoundaryPoint provide continuous positioning and gentle snapping', async (t) => {
  const { getShapeSnapPoints, getClosestBoundaryPoint } = await import('../src/core/geometry.js');
  const rect = createDefaultObject('rectangle', { id: 'r1', x: 100, y: 100, width: 200, height: 100 });

  const snapPoints = getShapeSnapPoints(rect);
  assert.equal(snapPoints.length, 8); // 4 side centers + 4 corners
  const topCenter = snapPoints.find(s => s.name === 'top');
  assert.ok(topCenter);
  assert.deepEqual(topCenter.point, { x: 200, y: 100 });
  assert.deepEqual(topCenter.anchor, { x: 0.5, y: 0 });

  // 1. Point very close to top-center (within 14px) -> snaps
  const nearTopCenter = getClosestBoundaryPoint(rect, { x: 205, y: 98 }, 14);
  assert.equal(nearTopCenter.snapped, true);
  assert.equal(nearTopCenter.snapName, 'top');
  assert.deepEqual(nearTopCenter.point, { x: 200, y: 100 });
  assert.deepEqual(nearTopCenter.anchor, { x: 0.5, y: 0 });

  // 2. Point along top edge far from any snap point -> continuous position
  // 30% across width = x: 100 + 0.3 * 200 = 160. Distance to corner (100) is 60px, to center (200) is 40px (> 14px)
  const continuous = getClosestBoundaryPoint(rect, { x: 160, y: 80 }, 14);
  assert.equal(continuous.snapped, false);
  assert.equal(Math.round(continuous.point.x), 160);
  assert.equal(Math.round(continuous.point.y), 100);
  assert.equal(continuous.anchor.x, 0.3);
  assert.equal(continuous.anchor.y, 0);
});

test('custom connection anchor moves with object, scales on resize, and adapts to shape change', () => {
  const doc = createDefaultDocument();
  const b1 = createDefaultObject('rectangle', { id: 'b1', x: 100, y: 100, width: 200, height: 100 });
  const b2 = createDefaultObject('rectangle', { id: 'b2', x: 500, y: 100, width: 200, height: 100 });

  // Connector with custom anchor at 25% along top edge of b1
  const conn = createDefaultObject('connector', {
    id: 'c1',
    from: { id: 'b1', anchor: { x: 0.25, y: 0 } },
    to: { id: 'b2' },
    routing: 'straight'
  });

  const { doc: doc1 } = applyCommandBatch(doc, [
    { type: 'create_object', object: b1 },
    { type: 'create_object', object: b2 },
    { type: 'create_object', object: conn }
  ]);

  // Initial resolved position: x = 100 + 0.25 * 200 = 150, y = 100
  const geom1 = resolveConnectorGeometry(doc1, doc1.objects['c1']);
  assert.equal(Math.round(geom1.start.x), 150);
  assert.equal(Math.round(geom1.start.y), 100);

  // 1. Move b1 by (dx: 80, dy: 40)
  const { doc: docMoved } = applyCommand(doc1, {
    type: 'move_objects',
    ids: ['b1'],
    dx: 80,
    dy: 40
  });
  const geomMoved = resolveConnectorGeometry(docMoved, docMoved.objects['c1']);
  assert.equal(Math.round(geomMoved.start.x), 230); // 150 + 80
  assert.equal(Math.round(geomMoved.start.y), 140); // 100 + 40

  // 2. Resize b1 from width 200 to 400
  const { doc: docResized } = applyCommand(doc1, {
    type: 'resize_object',
    id: 'b1',
    bounds: { x: 100, y: 100, width: 400, height: 100 }
  });
  const geomResized = resolveConnectorGeometry(docResized, docResized.objects['c1']);
  assert.equal(Math.round(geomResized.start.x), 200); // 100 + 0.25 * 400 = 200!
  assert.equal(Math.round(geomResized.start.y), 100);

  // 3. Change shape from rectangle to ellipse
  const { doc: docMorphed } = applyCommand(doc1, {
    type: 'change_shape',
    id: 'b1',
    newType: 'ellipse'
  });
  const geomMorphed = resolveConnectorGeometry(docMorphed, docMorphed.objects['c1']);
  // Point remains on the top perimeter of the ellipse
  assert.ok(geomMorphed.start.x >= 100 && geomMorphed.start.x <= 300);
  assert.ok(geomMorphed.start.y >= 100 && geomMorphed.start.y <= 150);
});

test('multiple connectors on one object maintain independent connection points', () => {
  const doc = createDefaultDocument();
  const box = createDefaultObject('rectangle', { id: 'main_box', x: 200, y: 200, width: 200, height: 200 });
  const c1 = createDefaultObject('connector', { id: 'c1', from: { id: 'main_box', anchor: { x: 0.5, y: 0 } }, to: { point: { x: 300, y: 50 } } }); // Top center
  const c2 = createDefaultObject('connector', { id: 'c2', from: { id: 'main_box', anchor: { x: 1, y: 0.5 } }, to: { point: { x: 550, y: 300 } } }); // Right center
  const c3 = createDefaultObject('connector', { id: 'c3', from: { id: 'main_box' }, to: { point: { x: 300, y: 550 } } }); // Auto (towards bottom)

  const { doc: doc1 } = applyCommandBatch(doc, [
    { type: 'create_object', object: box },
    { type: 'create_object', object: c1 },
    { type: 'create_object', object: c2 },
    { type: 'create_object', object: c3 }
  ]);

  const g1 = resolveConnectorGeometry(doc1, doc1.objects['c1']);
  const g2 = resolveConnectorGeometry(doc1, doc1.objects['c2']);
  const g3 = resolveConnectorGeometry(doc1, doc1.objects['c3']);

  assert.equal(Math.round(g1.start.x), 300);
  assert.equal(Math.round(g1.start.y), 200); // Top

  assert.equal(Math.round(g2.start.x), 400);
  assert.equal(Math.round(g2.start.y), 300); // Right

  assert.equal(Math.round(g3.start.x), 300);
  assert.equal(Math.round(g3.start.y), 400); // Auto resolves bottom edge
});

test('connection point changes, reconnection, whitespace detachment, and auto reset each support Undo and Redo', () => {
  const doc = createDefaultDocument();
  const b1 = createDefaultObject('rectangle', { id: 'b1', x: 0, y: 0, width: 100, height: 100 });
  const b2 = createDefaultObject('rectangle', { id: 'b2', x: 200, y: 0, width: 100, height: 100 });
  const conn = createDefaultObject('connector', { id: 'c1', from: { id: 'b1' }, to: { id: 'b2' } });

  const { doc: doc1 } = applyCommandBatch(doc, [
    { type: 'create_object', object: b1 },
    { type: 'create_object', object: b2 },
    { type: 'create_object', object: conn }
  ]);

  // 1. Adjust connection point on b1 to custom anchor (top-left corner)
  const { doc: docAnchor, inverseCmd: undoAnchor } = applyCommand(doc1, {
    type: 'reconnect_connector',
    id: 'c1',
    endpoint: 'from',
    target: { id: 'b1', anchor: { x: 0, y: 0 } }
  });
  assert.deepEqual(docAnchor.objects['c1'].from.anchor, { x: 0, y: 0 });

  // Undo returns to auto (no anchor)
  const { doc: docUndone1 } = applyCommand(docAnchor, undoAnchor);
  assert.equal(docUndone1.objects['c1'].from.anchor, undefined);

  // 2. Reconnect to b2 (both ends connected to b2)
  const { doc: docReconn, inverseCmd: undoReconn } = applyCommand(docAnchor, {
    type: 'reconnect_connector',
    id: 'c1',
    endpoint: 'from',
    target: { id: 'b2', anchor: { x: 0.5, y: 1 } }
  });
  assert.equal(docReconn.objects['c1'].from.id, 'b2');

  const { doc: docUndone2 } = applyCommand(docReconn, undoReconn);
  assert.equal(docUndone2.objects['c1'].from.id, 'b1');
  assert.deepEqual(docUndone2.objects['c1'].from.anchor, { x: 0, y: 0 });

  // 3. Detach to free whitespace point
  const { doc: docDetached, inverseCmd: undoDetach } = applyCommand(docAnchor, {
    type: 'reconnect_connector',
    id: 'c1',
    endpoint: 'from',
    target: { point: { x: 50, y: -80 } }
  });
  assert.deepEqual(docDetached.objects['c1'].from, { point: { x: 50, y: -80 } });

  const { doc: docUndone3 } = applyCommand(docDetached, undoDetach);
  assert.equal(docUndone3.objects['c1'].from.id, 'b1');
  assert.deepEqual(docUndone3.objects['c1'].from.anchor, { x: 0, y: 0 });

  // 4. Auto connection point reset (clears anchor)
  const { doc: docAuto, inverseCmd: undoAuto } = applyCommand(docAnchor, {
    type: 'reconnect_connector',
    id: 'c1',
    endpoint: 'from',
    target: { id: 'b1' }
  });
  assert.equal(docAuto.objects['c1'].from.anchor, undefined);

  const { doc: docUndone4 } = applyCommand(docAuto, undoAuto);
  assert.deepEqual(docUndone4.objects['c1'].from.anchor, { x: 0, y: 0 });
});
