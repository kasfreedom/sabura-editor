import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDocument, createDefaultObject } from '../src/core/document.js';
import { applyCommand, applyCommandBatch } from '../src/core/commands.js';
import { renderSelectionOverlay } from '../src/renderer/svg-renderer.js';
import { resolveConnectorGeometry, getBoundingBox, getUnionBoundingBox } from '../src/core/geometry.js';

test('multi-selection: locked objects are strictly excluded from marquee and select all', () => {
  let doc = createDefaultDocument();

  // Create 3 objects: rect1 (unlocked), rect2 (locked), rect3 (unlocked)
  const r1 = createDefaultObject('rectangle', { id: 'r1', x: 100, y: 100, width: 80, height: 60, locked: false });
  const r2 = createDefaultObject('rectangle', { id: 'r2', x: 200, y: 100, width: 80, height: 60, locked: true });
  const r3 = createDefaultObject('rectangle', { id: 'r3', x: 300, y: 100, width: 80, height: 60, locked: false });

  doc = applyCommand(doc, { type: 'create_object', object: r1 }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: r2 }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: r3 }).doc;

  // Simulate Select All
  const selectAll = Object.values(doc.objects).filter(o => !o.locked).map(o => o.id);
  assert.deepEqual(selectAll.sort(), ['r1', 'r3']);
  assert.ok(!selectAll.includes('r2'), 'Locked object must not be included in Select All');

  // Simulate Marquee covering all 3 objects [50, 50] to [450, 200]
  const mx = 50, my = 50, mr = 450, mb = 200;
  const marqueeHits = [];
  for (const obj of Object.values(doc.objects)) {
    if (obj.locked) continue;
    const b = getBoundingBox(obj);
    if (b.x < mr && b.right > mx && b.y < mb && b.bottom > my) {
      marqueeHits.push(obj.id);
    }
  }
  assert.deepEqual(marqueeHits.sort(), ['r1', 'r3']);
  assert.ok(!marqueeHits.includes('r2'), 'Locked object must not be included in Marquee');
});

test('multi-selection overlay: renders shared bounding box and count badge', () => {
  let doc = createDefaultDocument();
  const r1 = createDefaultObject('rectangle', { id: 'r1', x: 100, y: 100, width: 100, height: 80 });
  const r2 = createDefaultObject('rectangle', { id: 'r2', x: 300, y: 200, width: 100, height: 80 });
  doc = applyCommand(doc, { type: 'create_object', object: r1 }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: r2 }).doc;

  const overlay = renderSelectionOverlay(doc, ['r1', 'r2']);
  assert.ok(overlay.includes('selection-count-badge'), 'Must include selection count badge');
  assert.ok(overlay.includes('2 objects'), 'Badge must display "2 objects"');
  assert.ok(overlay.includes('stroke-dasharray="4,4"'), 'Must include dashed selection boundary');
  // Must NOT include resize handles on multi-selection
  assert.ok(!overlay.includes('data-handle="nw"'), 'Multi-selection must not display resize handles');
});

test('moving multi-selection: moves objects and updates connected connectors without double-translating', () => {
  let doc = createDefaultDocument();

  // Box A, Box B, and Connector C between them
  const boxA = createDefaultObject('rectangle', { id: 'boxA', x: 100, y: 100, width: 100, height: 100 });
  const boxB = createDefaultObject('rectangle', { id: 'boxB', x: 300, y: 100, width: 100, height: 100 });
  const conn = createDefaultObject('connector', {
    id: 'conn1',
    from: { id: 'boxA' },
    to: { id: 'boxB' }
  });

  doc = applyCommand(doc, { type: 'create_object', object: boxA }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: boxB }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: conn }).doc;

  const initialGeom = resolveConnectorGeometry(doc, doc.objects.conn1);

  // Move all 3 together by (50, 40)
  const moveRes = applyCommand(doc, {
    type: 'move_objects',
    ids: ['boxA', 'boxB', 'conn1'],
    dx: 50,
    dy: 40
  });
  doc = moveRes.doc;

  assert.equal(doc.objects.boxA.x, 150);
  assert.equal(doc.objects.boxA.y, 140);
  assert.equal(doc.objects.boxB.x, 350);
  assert.equal(doc.objects.boxB.y, 140);

  const movedGeom = resolveConnectorGeometry(doc, doc.objects.conn1);
  assert.equal(movedGeom.start.x, initialGeom.start.x + 50);
  assert.equal(movedGeom.start.y, initialGeom.start.y + 40);
  assert.equal(movedGeom.end.x, initialGeom.end.x + 50);
  assert.equal(movedGeom.end.y, initialGeom.end.y + 40);

  // Single-step undo
  const undoRes = applyCommand(doc, moveRes.inverseCmd);
  doc = undoRes.doc;
  assert.equal(doc.objects.boxA.x, 100);
  assert.equal(doc.objects.boxA.y, 100);
  assert.equal(doc.objects.boxB.x, 300);
  assert.equal(doc.objects.boxB.y, 100);
});

test('duplication: rebinds internal connectors and detaches external connectors cleanly', () => {
  let doc = createDefaultDocument();

  // Internal Box 1, Internal Box 2, External Box Ext
  const b1 = createDefaultObject('rectangle', { id: 'b1', x: 100, y: 100, width: 80, height: 60 });
  const b2 = createDefaultObject('rectangle', { id: 'b2', x: 300, y: 100, width: 80, height: 60 });
  const bExt = createDefaultObject('rectangle', { id: 'bExt', x: 500, y: 100, width: 80, height: 60 });

  // connInternal: connects b1 -> b2 (both duplicated)
  const connInternal = createDefaultObject('connector', { id: 'cInt', from: { id: 'b1' }, to: { id: 'b2' } });

  // connExternal: connects b1 -> bExt (only b1 duplicated, bExt is external)
  const connExternal = createDefaultObject('connector', { id: 'cExt', from: { id: 'b1' }, to: { id: 'bExt' } });

  doc = applyCommand(doc, { type: 'create_object', object: b1 }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: b2 }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: bExt }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: connInternal }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: connExternal }).doc;

  // Duplicate b1, b2, cInt, and cExt with offset (30, 30)
  const dupRes = applyCommand(doc, {
    type: 'duplicate_objects',
    ids: ['b1', 'b2', 'cInt', 'cExt'],
    offset: { x: 30, y: 30 }
  });
  doc = dupRes.doc;

  const dupIds = dupRes.duplicatedIds;
  assert.equal(dupIds.length, 4);

  // Find duplicated objects
  const dupB1 = doc.objects[dupIds[0]];
  const dupB2 = doc.objects[dupIds[1]];
  const dupCInt = doc.objects[dupIds[2]];
  const dupCExt = doc.objects[dupIds[3]];

  assert.equal(dupB1.x, 130);
  assert.equal(dupB1.y, 130);
  assert.equal(dupB2.x, 330);
  assert.equal(dupB2.y, 130);

  // Internal connector must be rebound to the new duplicated boxes!
  assert.equal(dupCInt.from.id, dupB1.id, 'Internal connector start must be rebound to duplicated b1');
  assert.equal(dupCInt.to.id, dupB2.id, 'Internal connector end must be rebound to duplicated b2');

  // External connector: from.id is rebound to dupB1, but to.id (bExt) was external!
  assert.equal(dupCExt.from.id, dupB1.id, 'Connector from must be rebound to duplicated b1');
  assert.ok(dupCExt.to.point, 'External endpoint must be converted to a free point');
  assert.ok(!dupCExt.to.id, 'External endpoint must no longer be attached to bExt');

  // Single-step undo reverts all duplicates
  const undoRes = applyCommand(doc, dupRes.inverseCmd);
  doc = undoRes.doc;
  for (const dId of dupIds) {
    assert.ok(!doc.objects[dId], `Duplicated object ${dId} must be removed on undo`);
  }
});

test('grouping and ungrouping: atomic execution, persistence, and unit integrity', () => {
  let doc = createDefaultDocument();

  const r1 = createDefaultObject('rectangle', { id: 'r1', x: 100, y: 100, width: 80, height: 60 });
  const r2 = createDefaultObject('rectangle', { id: 'r2', x: 200, y: 100, width: 80, height: 60 });
  doc = applyCommand(doc, { type: 'create_object', object: r1 }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: r2 }).doc;

  // Group r1 and r2
  const groupRes = applyCommand(doc, { type: 'group_objects', ids: ['r1', 'r2'] });
  doc = groupRes.doc;

  const gId = doc.objects.r1.groupId;
  assert.ok(gId, 'r1 must have groupId');
  assert.equal(doc.objects.r2.groupId, gId, 'r2 must have matching groupId');
  assert.ok(doc.groups[gId], 'doc.groups must contain the new group');

  // Single-step undo of grouping
  const undoGroup = applyCommand(doc, groupRes.inverseCmd);
  doc = undoGroup.doc;
  assert.equal(doc.objects.r1.groupId, null);
  assert.equal(doc.objects.r2.groupId, null);
  assert.ok(!doc.groups[gId], 'Group must be deleted on undo');

  // Re-group and then test ungroup
  doc = applyCommand(doc, { type: 'group_objects', ids: ['r1', 'r2'] }).doc;
  const newGid = doc.objects.r1.groupId;

  const ungroupRes = applyCommand(doc, { type: 'ungroup_objects', groupIds: [newGid] });
  doc = ungroupRes.doc;
  assert.equal(doc.objects.r1.groupId, null);
  assert.equal(doc.objects.r2.groupId, null);
  assert.ok(!doc.groups[newGid]);

  // Undo ungrouping restores group
  const undoUngroup = applyCommand(doc, ungroupRes.inverseCmd);
  doc = undoUngroup.doc;
  assert.equal(doc.objects.r1.groupId, newGid);
  assert.equal(doc.objects.r2.groupId, newGid);
  assert.ok(doc.groups[newGid]);
});

test('alignment: left, center, right, top, middle, bottom in world coordinates with single undo', () => {
  let doc = createDefaultDocument();
  const a = createDefaultObject('rectangle', { id: 'a', x: 100, y: 100, width: 100, height: 50 });
  const b = createDefaultObject('rectangle', { id: 'b', x: 200, y: 200, width: 80, height: 60 });
  const c = createDefaultObject('rectangle', { id: 'c', x: 400, y: 300, width: 60, height: 40 });

  doc = applyCommand(doc, { type: 'create_object', object: a }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: b }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: c }).doc;

  // Align Left: Union x = 100. All objects should have x = 100
  const alignLeft = applyCommand(doc, { type: 'align_objects', ids: ['a', 'b', 'c'], alignment: 'left' });
  doc = alignLeft.doc;
  assert.equal(doc.objects.a.x, 100);
  assert.equal(doc.objects.b.x, 100);
  assert.equal(doc.objects.c.x, 100);

  // Undo restores original positions
  doc = applyCommand(doc, alignLeft.inverseCmd).doc;
  assert.equal(doc.objects.a.x, 100);
  assert.equal(doc.objects.b.x, 200);
  assert.equal(doc.objects.c.x, 400);

  // Align Top: Union y = 100. All objects should have y = 100
  const alignTop = applyCommand(doc, { type: 'align_objects', ids: ['a', 'b', 'c'], alignment: 'top' });
  doc = alignTop.doc;
  assert.equal(doc.objects.a.y, 100);
  assert.equal(doc.objects.b.y, 100);
  assert.equal(doc.objects.c.y, 100);

  doc = applyCommand(doc, alignTop.inverseCmd).doc;
  assert.equal(doc.objects.b.y, 200);
  assert.equal(doc.objects.c.y, 300);
});

test('distribution: horizontal and vertical with equal gaps and single undo', () => {
  let doc = createDefaultDocument();
  // 3 boxes with width 40: at x=0, x=100, x=300
  // Span = 300 + 40 - 0 = 340. Total box width = 120. Total gap = 220.
  // Gap per space = 220 / 2 = 110.
  // Box 0: x = 0
  // Box 1: x = 0 + 40 + 110 = 150
  // Box 2: x = 150 + 40 + 110 = 300
  const a = createDefaultObject('rectangle', { id: 'a', x: 0, y: 100, width: 40, height: 40 });
  const b = createDefaultObject('rectangle', { id: 'b', x: 100, y: 100, width: 40, height: 40 });
  const c = createDefaultObject('rectangle', { id: 'c', x: 300, y: 100, width: 40, height: 40 });

  doc = applyCommand(doc, { type: 'create_object', object: a }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: b }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: c }).doc;

  const distRes = applyCommand(doc, { type: 'distribute_objects', ids: ['a', 'b', 'c'], direction: 'horizontal' });
  doc = distRes.doc;

  assert.equal(doc.objects.a.x, 0);
  assert.equal(doc.objects.b.x, 150);
  assert.equal(doc.objects.c.x, 300);

  // Undo
  doc = applyCommand(doc, distRes.inverseCmd).doc;
  assert.equal(doc.objects.b.x, 100);
});

test('object ordering: front, back, forward, backward with reversible single-step undo', () => {
  let doc = createDefaultDocument();
  const a = createDefaultObject('rectangle', { id: 'a', x: 0, y: 0, width: 50, height: 50 });
  const b = createDefaultObject('rectangle', { id: 'b', x: 10, y: 10, width: 50, height: 50 });
  const c = createDefaultObject('rectangle', { id: 'c', x: 20, y: 20, width: 50, height: 50 });

  doc = applyCommand(doc, { type: 'create_object', object: a }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: b }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: c }).doc;

  assert.deepEqual(doc.order, ['a', 'b', 'c']);

  // Send 'c' to back
  const backRes = applyCommand(doc, { type: 'reorder_objects', ids: ['c'], action: 'back' });
  doc = backRes.doc;
  assert.deepEqual(doc.order, ['c', 'a', 'b']);

  // Undo send to back
  doc = applyCommand(doc, backRes.inverseCmd).doc;
  assert.deepEqual(doc.order, ['a', 'b', 'c']);

  // Bring 'a' to front
  const frontRes = applyCommand(doc, { type: 'reorder_objects', ids: ['a'], action: 'front' });
  doc = frontRes.doc;
  assert.deepEqual(doc.order, ['b', 'c', 'a']);

  doc = applyCommand(doc, frontRes.inverseCmd).doc;
  assert.deepEqual(doc.order, ['a', 'b', 'c']);
});

test('regression: default board 3 shapes + attached connector selection bounds, align, distribute, and undo/redo', () => {
  let doc = createDefaultDocument({ title: 'Welcome to Sabura' });

  const titleBox = createDefaultObject('rectangle', {
    id: 'shape_intro',
    x: 80,
    y: 80,
    width: 340,
    height: 100
  });

  const ideaBox = createDefaultObject('ellipse', {
    id: 'shape_idea',
    x: 100,
    y: 250,
    width: 150,
    height: 95
  });

  const coreBox = createDefaultObject('diamond', {
    id: 'shape_core',
    x: 360,
    y: 235,
    width: 150,
    height: 120
  });

  const connector = createDefaultObject('connector', {
    id: 'conn_1',
    from: { id: 'shape_idea' },
    to: { id: 'shape_core' },
    routing: 'curved'
  });

  doc = applyCommand(doc, { type: 'create_object', object: titleBox }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: ideaBox }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: coreBox }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: connector }).doc;

  // 1. Marquee selection covering all 4 objects [50, 50] to [600, 400]
  const mx = 50, my = 50, mr = 600, mb = 400;
  const marqueeHits = [];
  for (const obj of Object.values(doc.objects)) {
    if (obj.locked) continue;
    const b = getBoundingBox(obj, doc);
    assert.ok(b, `Bounding box for ${obj.id} must be non-null`);
    if (b.x < mr && b.right > mx && b.y < mb && b.bottom > my) {
      marqueeHits.push(obj.id);
    }
  }
  assert.equal(marqueeHits.length, 4, 'All 4 objects must be selected by marquee');

  // 2. Selection overlay: shared boundary must match real visual extent (x: 80, y: 80), NOT (0, 0)!
  const unionBox = getUnionBoundingBox(Object.values(doc.objects), doc);
  assert.equal(unionBox.x, 80, 'Selection boundary minX must be 80, not 0');
  assert.equal(unionBox.y, 80, 'Selection boundary minY must be 80, not 0');
  assert.equal(unionBox.right, 510, 'Selection boundary right must be 510');
  assert.equal(unionBox.bottom, 355, 'Selection boundary bottom must be 355');

  const overlayHtml = renderSelectionOverlay(doc, ['shape_intro', 'shape_idea', 'shape_core', 'conn_1']);
  assert.ok(overlayHtml.includes('rect x="76" y="76" width="438" height="283"'), 'Overlay rect must enclose real visual extent with 4px padding');
  assert.ok(overlayHtml.includes('4 objects'), 'Count badge must display "4 objects"');

  // 3. Apply Align Left
  const alignCmd = { type: 'align_objects', ids: ['shape_intro', 'shape_idea', 'shape_core', 'conn_1'], alignment: 'left' };
  const alignRes = applyCommand(doc, alignCmd);
  doc = alignRes.doc;

  // Leftmost spatial object (shape_intro at x=80) remains stationary
  assert.equal(doc.objects.shape_intro.x, 80, 'shape_intro must remain stationary at x=80');
  // Other spatial objects align to x=80
  assert.equal(doc.objects.shape_idea.x, 80, 'shape_idea must align to x=80');
  assert.equal(doc.objects.shape_core.x, 80, 'shape_core must align to x=80');

  // Connector stays attached and visually correct
  assert.equal(doc.objects.conn_1.from.id, 'shape_idea');
  assert.equal(doc.objects.conn_1.to.id, 'shape_core');
  const connGeomAfterAlign = resolveConnectorGeometry(doc, doc.objects.conn_1);
  assert.ok(!isNaN(connGeomAfterAlign.start.x) && !isNaN(connGeomAfterAlign.start.y));
  assert.ok(!isNaN(connGeomAfterAlign.end.x) && !isNaN(connGeomAfterAlign.end.y));
  assert.ok(connGeomAfterAlign.start.x >= 80 && connGeomAfterAlign.end.x >= 80, 'Connector endpoints follow aligned shapes');

  // 4. Single-step Undo and Redo
  const undoRes = applyCommand(doc, alignRes.inverseCmd);
  doc = undoRes.doc;
  assert.equal(doc.objects.shape_intro.x, 80);
  assert.equal(doc.objects.shape_idea.x, 100, 'shape_idea x must be restored to 100 on undo');
  assert.equal(doc.objects.shape_core.x, 360, 'shape_core x must be restored to 360 on undo');

  const redoRes = applyCommand(doc, alignCmd);
  doc = redoRes.doc;
  assert.equal(doc.objects.shape_idea.x, 80, 'shape_idea x must be re-aligned to 80 on redo');
  assert.equal(doc.objects.shape_core.x, 80, 'shape_core x must be re-aligned to 80 on redo');

  // Restore back to original positions for distribution test
  doc = applyCommand(doc, redoRes.inverseCmd).doc;

  // 5. Distribute Horizontal
  const distCmd = { type: 'distribute_objects', ids: ['shape_intro', 'shape_idea', 'shape_core', 'conn_1'], direction: 'horizontal' };
  const distRes = applyCommand(doc, distCmd);
  doc = distRes.doc;

  // Sorted by x: shape_intro (x: 80, w: 340), shape_idea (x: 100, w: 150), shape_core (x: 360, w: 150)
  // Total span = (360 + 150) - 80 = 430. Total width = 340 + 150 + 150 = 640.
  // Gaps are calculated evenly without connector interference.
  assert.equal(doc.objects.shape_intro.x, 80, 'First object in distribute remains at min');
  assert.ok(!isNaN(doc.objects.shape_idea.x));
  assert.ok(!isNaN(doc.objects.shape_core.x));

  // Single-step undo of distribution
  doc = applyCommand(doc, distRes.inverseCmd).doc;
  assert.equal(doc.objects.shape_intro.x, 80);
  assert.equal(doc.objects.shape_idea.x, 100);
  assert.equal(doc.objects.shape_core.x, 360);
});

test('spatial count threshold: align requires >= 2 spatial objects, distribute requires >= 3', () => {
  let doc = createDefaultDocument();
  const r1 = createDefaultObject('rectangle', { id: 'r1', x: 100, y: 100, width: 80, height: 60 });
  const c1 = createDefaultObject('connector', { id: 'c1', from: { id: 'r1' }, to: { point: { x: 300, y: 300 } } });

  doc = applyCommand(doc, { type: 'create_object', object: r1 }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: c1 }).doc;

  // 1 spatial object + 1 connector = 1 spatial object: Align must be a no-op!
  const alignRes = applyCommand(doc, { type: 'align_objects', ids: ['r1', 'c1'], alignment: 'left' });
  assert.equal(alignRes.inverseCmd.type, 'noop', 'Align with only 1 spatial object must be noop');
  assert.equal(alignRes.doc.objects.r1.x, 100);

  // Add 1 more spatial object: now 2 spatial objects: Align works, Distribute must be no-op!
  const r2 = createDefaultObject('rectangle', { id: 'r2', x: 250, y: 100, width: 80, height: 60 });
  doc = applyCommand(doc, { type: 'create_object', object: r2 }).doc;

  const distRes = applyCommand(doc, { type: 'distribute_objects', ids: ['r1', 'r2', 'c1'], direction: 'horizontal' });
  assert.equal(distRes.inverseCmd.type, 'noop', 'Distribute with only 2 spatial objects must be noop');
});

test('grouped objects move together atomically and restore on undo', () => {
  let doc = createDefaultDocument();
  const r1 = createDefaultObject('rectangle', { id: 'r1', x: 100, y: 100, width: 80, height: 60 });
  const r2 = createDefaultObject('rectangle', { id: 'r2', x: 200, y: 150, width: 80, height: 60 });
  const conn = createDefaultObject('connector', { id: 'c1', from: { id: 'r1' }, to: { id: 'r2' } });

  doc = applyCommand(doc, { type: 'create_object', object: r1 }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: r2 }).doc;
  doc = applyCommand(doc, { type: 'create_object', object: conn }).doc;

  // Group r1 and r2
  const groupRes = applyCommand(doc, { type: 'group_objects', ids: ['r1', 'r2'] });
  doc = groupRes.doc;
  const gId = doc.objects.r1.groupId;
  assert.ok(gId);
  assert.equal(doc.objects.r2.groupId, gId);

  // When moving the group by dx: 60, dy: 40:
  // Both members must move by the exact same delta!
  const groupMembers = Object.values(doc.objects).filter(o => o.groupId === gId).map(o => o.id);
  assert.deepEqual(groupMembers.sort(), ['r1', 'r2']);

  const moveRes = applyCommand(doc, {
    type: 'move_objects',
    ids: groupMembers,
    dx: 60,
    dy: 40
  });
  doc = moveRes.doc;

  assert.equal(doc.objects.r1.x, 160);
  assert.equal(doc.objects.r1.y, 140);
  assert.equal(doc.objects.r2.x, 260);
  assert.equal(doc.objects.r2.y, 190);

  // Attached connector resolves dynamically between moved group members
  const geom = resolveConnectorGeometry(doc, doc.objects.c1);
  assert.ok(geom.start.x >= 160 && geom.start.x <= 240);
  assert.ok(geom.end.x >= 260 && geom.end.x <= 340);

  // Single step undo restores both objects
  doc = applyCommand(doc, moveRes.inverseCmd).doc;
  assert.equal(doc.objects.r1.x, 100);
  assert.equal(doc.objects.r1.y, 100);
  assert.equal(doc.objects.r2.x, 200);
  assert.equal(doc.objects.r2.y, 150);
});

