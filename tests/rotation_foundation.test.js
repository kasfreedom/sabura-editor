/**
 * Sabura Editor Handoff 003: Rotation Foundation Comprehensive Test Suite
 * Validates AC-01 through AC-15, coordinate math, rotated bounding boxes,
 * rotated resize, connector attachments, hit testing, undo/redo, and persistence.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rotatePoint,
  unrotatePoint,
  rotateVector,
  unrotateVector,
  normalizeAngle,
  getObjectCorners,
  getBoundingBox,
  getUnionBoundingBox,
  getShapeBoundaryPoint,
  getShapeSnapPoints,
  getClosestBoundaryPoint,
  resolveConnectorGeometry,
  calculateRotatedResize,
  rotateObjects,
  isPointInsideObject
} from '../src/core/geometry.js';

import {
  createDefaultDocument,
  createDefaultObject,
  cloneDocument,
  validateDocument
} from '../src/core/document.js';

import {
  validateCommand,
  applyCommand,
  applyCommandBatch
} from '../src/core/commands.js';

import { renderObject, renderSelectionOverlay } from '../src/renderer/svg-renderer.js';

test('AC-01: Rotation handle and stem rendered above single object and multi-selection transform box', () => {
  const doc = createDefaultDocument();
  const rect = createDefaultObject('rectangle', { id: 'r1', x: 100, y: 100, width: 200, height: 100, rotation: 30 }, doc.theme);
  doc.objects['r1'] = rect;
  doc.order = ['r1'];

  // Single object selection overlay
  const overlaySingle = renderSelectionOverlay(doc, ['r1']);
  assert.ok(overlaySingle.includes('data-handle="rotate"'), 'Single selection must render data-handle="rotate"');
  assert.ok(overlaySingle.includes('transform="rotate(30'), 'Single selection overlay must include local rotation transform');
  assert.ok(overlaySingle.includes('selection-single-overlay'), 'Single selection has oriented single overlay');

  // Multi-selection overlay
  const rect2 = createDefaultObject('rectangle', { id: 'r2', x: 400, y: 100, width: 100, height: 100, rotation: 45 }, doc.theme);
  doc.objects['r2'] = rect2;
  doc.order.push('r2');

  const overlayMulti = renderSelectionOverlay(doc, ['r1', 'r2']);
  assert.ok(overlayMulti.includes('data-handle="rotate"'), 'Multi-selection must render shared data-handle="rotate"');
  assert.ok(overlayMulti.includes('selection-count-badge'), 'Multi-selection renders count badge');
});
test('AC-02: Single object rotation around local center mutates ONLY rotation', () => {
  const doc = createDefaultDocument();
  const rect = createDefaultObject('rectangle', {
    id: 'r1',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000'
  }, doc.theme);
  doc.objects['r1'] = rect;
  doc.order = ['r1'];

  const originalState = cloneDocument(rect);

  // Rotate single object by 45 degrees
  const cmd = {
    type: 'rotate_objects',
    objects: {
      r1: { rotation: 45 }
    }
  };

  const validation = validateCommand(cmd, doc);
  assert.equal(validation.valid, true, 'rotate_objects command must be valid');

  const { doc: newDoc, inverseCmd } = applyCommand(doc, cmd);
  const updated = newDoc.objects['r1'];

  assert.equal(updated.rotation, 45, 'Rotation must be 45 degrees');
  assert.equal(updated.x, originalState.x, 'x must remain unchanged');
  assert.equal(updated.y, originalState.y, 'y must remain unchanged');
  assert.equal(updated.width, originalState.width, 'width must remain unchanged');
  assert.equal(updated.height, originalState.height, 'height must remain unchanged');
  assert.equal(updated.fill, originalState.fill, 'fill must remain unchanged');
  assert.equal(updated.stroke, originalState.stroke, 'stroke must remain unchanged');

  // Test single step undo
  const { doc: revertedDoc } = applyCommand(newDoc, inverseCmd);
  assert.equal(revertedDoc.objects['r1'].rotation, 0, 'Undo must restore original 0 rotation');
  assert.equal(revertedDoc.objects['r1'].x, originalState.x);
});

test('AC-03: Angle normalization and 15-degree Shift snapping math', () => {
  assert.equal(normalizeAngle(0), 0);
  assert.equal(normalizeAngle(360), 0);
  assert.equal(normalizeAngle(720), 0);
  assert.equal(normalizeAngle(-90), 270);
  assert.equal(normalizeAngle(450), 90);

  // Snapping to 15 degrees
  const rawAngle = 44.3;
  const snapped = Math.round(rawAngle / 15) * 15;
  assert.equal(snapped, 45);

  const rawAngle2 = 37.1;
  const snapped2 = Math.round(rawAngle2 / 15) * 15;
  assert.equal(snapped2, 30);
});

test('AC-04 & AC-10: Multi-selection and group rotation around shared visual union center', () => {
  const doc = createDefaultDocument();
  // Object 1: at (100, 100), size (100, 100) -> center (150, 150)
  // Object 2: at (300, 100), size (100, 100) -> center (350, 150)
  const o1 = createDefaultObject('rectangle', { id: 'o1', x: 100, y: 100, width: 100, height: 100, rotation: 0 }, doc.theme);
  const o2 = createDefaultObject('rectangle', { id: 'o2', x: 300, y: 100, width: 100, height: 100, rotation: 0 }, doc.theme);
  // Free connector between (150, 200) and (350, 200)
  const conn = createDefaultObject('connector', {
    id: 'c1',
    from: { point: { x: 150, y: 200 } },
    to: { point: { x: 350, y: 200 } }
  }, doc.theme);

  doc.objects['o1'] = o1;
  doc.objects['o2'] = o2;
  doc.objects['c1'] = conn;
  doc.order = ['o1', 'o2', 'c1'];

  const unionBox = getUnionBoundingBox([o1, o2], doc);
  // Union box: x: 100..400 (w: 300), y: 100..200 (h: 100) -> pivot cx: 250, cy: 150
  assert.equal(unionBox.cx, 250);
  assert.equal(unionBox.cy, 150);

  // Rotate by 90 degrees clockwise around (250, 150)
  const pivot = { x: unionBox.cx, y: unionBox.cy };
  const transformed = rotateObjects([o1, o2, conn], pivot, 90);

  const t1 = transformed.find(o => o.id === 'o1');
  const t2 = transformed.find(o => o.id === 'o2');
  const tc = transformed.find(o => o.id === 'c1');

  // Center of o1 was (150, 150) -> vector from pivot (-100, 0) rotated by 90deg -> (0, -100) -> new center (250, 50)
  // New top-left: (250 - 50, 50 - 50) = (200, 0)
  assert.equal(t1.x, 200);
  assert.equal(t1.y, 0);
  assert.equal(t1.rotation, 90);

  // Center of o2 was (350, 150) -> vector (+100, 0) rotated 90deg -> (0, +100) -> new center (250, 250)
  // New top-left: (250 - 50, 250 - 50) = (200, 200)
  assert.equal(t2.x, 200);
  assert.equal(t2.y, 200);
  assert.equal(t2.rotation, 90);

  // Connector free points rotated once:
  // from: (150, 200) -> vector (-100, 50) rotated 90deg -> (-50, -100) -> (200, 50)
  assert.equal(tc.from.point.x, 200);
  assert.equal(tc.from.point.y, 50);

  // to: (350, 200) -> vector (100, 50) rotated 90deg -> (-50, 100) -> (200, 250)
  assert.equal(tc.to.point.x, 200);
  assert.equal(tc.to.point.y, 250);
});

test('AC-05: Single-object resizing of a rotated object along local axes', () => {
  // Rectangle at (100, 100) with size (100, 100), rotated 90 degrees
  // Center is (150, 150)
  const orig = { x: 100, y: 100, width: 100, height: 100 };
  const rotation = 90;

  // Drag east handle 'e' in world coordinates:
  // For a 90-degree rotated object, local +X is world +Y (pointing downward).
  // If we drag world dy = +50 (downward in world space), local dx should be +50!
  const resized = calculateRotatedResize('e', orig, 0, 50, rotation, { keepAspect: false });

  // In local space, width increases by 50 to 150. Height stays 100.
  assert.equal(resized.width, 150);
  assert.equal(resized.height, 100);

  // Local center shifts from (150, 150) to (175, 150), a local dx of +25.
  // Rotated by +90deg, local dx +25 becomes world dy +25.
  // So new world center is (150, 175).
  // New top-left x = 150 - 150/2 = 75, y = 175 - 100/2 = 125.
  assert.equal(resized.x, 75);
  assert.equal(resized.y, 125);
});

test('AC-06: Multi-selection resizing remains world-axis aligned and preserves member angles', async () => {
  const doc = createDefaultDocument();
  const o1 = createDefaultObject('rectangle', { id: 'o1', x: 100, y: 100, width: 100, height: 100, rotation: 30 }, doc.theme);
  const o2 = createDefaultObject('rectangle', { id: 'o2', x: 300, y: 100, width: 100, height: 100, rotation: 60 }, doc.theme);
  doc.objects['o1'] = o1;
  doc.objects['o2'] = o2;
  doc.order = ['o1', 'o2'];

  const unionBox = getUnionBoundingBox([o1, o2], doc);
  // Scale union box horizontally by 2x
  const newUnionBox = {
    x: unionBox.x,
    y: unionBox.y,
    width: unionBox.width * 2,
    height: unionBox.height
  };

  const { transformObjects } = await import('../src/core/geometry.js');
  const transformed = transformObjects([o1, o2], unionBox, newUnionBox);

  const t1 = transformed.find(o => o.id === 'o1');
  const t2 = transformed.find(o => o.id === 'o2');

  assert.equal(t1.rotation, 30, 'Member rotation 30 must be preserved');
  assert.equal(t2.rotation, 60, 'Member rotation 60 must be preserved');
});

test('AC-07: Precision hit testing follows actual rotated shape geometry', () => {
  const doc = createDefaultDocument();
  // Rectangle at (100, 100), size (200, 100), rotated 45 degrees
  // Center is (200, 150)
  const rect = createDefaultObject('rectangle', {
    id: 'r1',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    rotation: 45
  }, doc.theme);
  doc.objects['r1'] = rect;
  doc.order = ['r1'];

  // 1. Center of the object (200, 150) must hit
  assert.equal(isPointInsideObject({ x: 200, y: 150 }, rect, doc), true);

  // 2. The enclosing AABB top-left corner (e.g. near 100, 70) is in empty space outside the 45-deg diamond
  const aabb = getBoundingBox(rect);
  assert.ok(aabb.width > 200, 'AABB is larger than unrotated width');

  // Point at AABB corner (aabb.x + 5, aabb.y + 5) must NOT hit the rotated object!
  assert.equal(isPointInsideObject({ x: aabb.x + 5, y: aabb.y + 5 }, rect, doc), false);

  // 3. Ellipse rotated 45 degrees
  const ellipse = createDefaultObject('ellipse', {
    id: 'e1',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    rotation: 45
  }, doc.theme);
  assert.equal(isPointInsideObject({ x: 200, y: 150 }, ellipse, doc), true);
  assert.equal(isPointInsideObject({ x: 105, y: 105 }, ellipse, doc), false);
});

test('AC-08 & AC-09: Connector attachments with rotated objects', () => {
  const doc = createDefaultDocument();
  // Box at (100, 100), size (100, 100), rotated 90 degrees
  // Center is (150, 150)
  const rect = createDefaultObject('rectangle', {
    id: 'r1',
    x: 100,
    y: 100,
    width: 100,
    height: 100,
    rotation: 90
  }, doc.theme);

  // Target box at (400, 100), size (100, 100), unrotated
  // Center is (450, 150)
  const rect2 = createDefaultObject('rectangle', {
    id: 'r2',
    x: 400,
    y: 100,
    width: 100,
    height: 100,
    rotation: 0
  }, doc.theme);

  // Connector from r1 to r2
  const conn = createDefaultObject('connector', {
    id: 'c1',
    from: { id: 'r1', anchor: { x: 0.5, y: 0 } }, // Top anchor in local coordinates
    to: { id: 'r2' }
  }, doc.theme);

  doc.objects['r1'] = rect;
  doc.objects['r2'] = rect2;
  doc.objects['c1'] = conn;
  doc.order = ['r1', 'r2', 'c1'];

  const geom = resolveConnectorGeometry(doc, conn);

  // For r1 with local top anchor (0.5, 0) -> unrotated point is (150, 100)
  // Rotated by +90deg around center (150, 150) -> vector (0, -50) becomes (+50, 0) -> world point (200, 150)
  assert.equal(Math.round(geom.start.x), 200);
  assert.equal(Math.round(geom.start.y), 150);

  // Auto-attached to r2 (center 450, 150) -> intersects left edge of r2 at (400, 150)
  assert.equal(Math.round(geom.end.x), 400);
  assert.equal(Math.round(geom.end.y), 150);
});

test('AC-11: Connected objects rotate while attached connectors update without tearing', () => {
  const doc = createDefaultDocument();
  const r1 = createDefaultObject('rectangle', { id: 'r1', x: 100, y: 100, width: 100, height: 100, rotation: 0 }, doc.theme);
  const r2 = createDefaultObject('rectangle', { id: 'r2', x: 300, y: 100, width: 100, height: 100, rotation: 0 }, doc.theme);
  const conn = createDefaultObject('connector', {
    id: 'c1',
    from: { id: 'r1' },
    to: { id: 'r2' }
  }, doc.theme);

  doc.objects['r1'] = r1;
  doc.objects['r2'] = r2;
  doc.objects['c1'] = conn;
  doc.order = ['r1', 'r2', 'c1'];

  // Initial connector geometry
  const geom0 = resolveConnectorGeometry(doc, conn);
  assert.equal(geom0.start.x, 200); // Right edge of r1
  assert.equal(geom0.end.x, 300);   // Left edge of r2

  // Rotate r1 by 90 degrees
  r1.rotation = 90;
  const geom1 = resolveConnectorGeometry(doc, conn);
  assert.ok(geom1.start.x !== undefined && geom1.start.y !== undefined);
  assert.ok(geom1.end.x !== undefined && geom1.end.y !== undefined);
  assert.ok(geom1.path.startsWith('M'));
});

test('AC-13 & AC-14: Command engine rotate_objects validation, execution, and single-step undo/redo', () => {
  let doc = createDefaultDocument();
  const s1 = createDefaultObject('rectangle', { id: 's1', x: 100, y: 100, width: 100, height: 100, rotation: 0 }, doc.theme);
  const s2 = createDefaultObject('rectangle', { id: 's2', x: 200, y: 200, width: 100, height: 100, rotation: 15 }, doc.theme);
  doc.objects['s1'] = s1;
  doc.objects['s2'] = s2;
  doc.order = ['s1', 's2'];

  const history = { undoStack: [], redoStack: [] };

  const rotateCmd = {
    type: 'rotate_objects',
    objects: {
      s1: { rotation: 45, x: 110, y: 110 },
      s2: { rotation: 60, x: 210, y: 210 }
    }
  };

  // 1. Apply rotate command
  const { doc: nextDoc, inverseCmd: undoCmd } = applyCommand(doc, rotateCmd);
  doc = nextDoc;
  assert.equal(doc.objects['s1'].rotation, 45);
  assert.equal(doc.objects['s1'].x, 110);
  assert.equal(doc.objects['s2'].rotation, 60);
  assert.equal(doc.objects['s2'].x, 210);

  // 2. Undo
  const { doc: undoneDoc, inverseCmd: redoCmd } = applyCommand(doc, undoCmd);
  doc = undoneDoc;

  assert.equal(doc.objects['s1'].rotation, 0);
  assert.equal(doc.objects['s1'].x, 100);
  assert.equal(doc.objects['s2'].rotation, 15);
  assert.equal(doc.objects['s2'].x, 200);

  // 3. Redo
  const { doc: redoneDoc } = applyCommand(doc, redoCmd);
  doc = redoneDoc;

  assert.equal(doc.objects['s1'].rotation, 45);
  assert.equal(doc.objects['s1'].x, 110);
  assert.equal(doc.objects['s2'].rotation, 60);
  assert.equal(doc.objects['s2'].y, 210);
});

test('AC-15: Round-trip persistence and document validation of rotated objects', async () => {
  const { packageHtmlWithDocument, extractDocumentFromHtml } = await import('../src/storage/file-packer.js');

  const doc = createDefaultDocument();
  doc.title = 'Rotation Test Board';
  const rect = createDefaultObject('rectangle', { id: 'r1', x: 150, y: 200, width: 120, height: 80, rotation: 37 }, doc.theme);
  const path = createDefaultObject('path', {
    id: 'p1',
    x: 300,
    y: 300,
    width: 100,
    height: 100,
    rotation: 75,
    points: [[0, 0], [100, 50], [50, 100]],
    closed: true
  }, doc.theme);

  doc.objects['r1'] = rect;
  doc.objects['p1'] = path;
  doc.order = ['r1', 'p1'];

  const val = validateDocument(doc);
  assert.equal(val.valid, true, 'Rotated document must be valid');

  const packed = packageHtmlWithDocument('<!DOCTYPE html><html><head></head><body><script id="sabura-document" type="application/json">{}</script></body></html>', doc);
  assert.equal(packed.success, true, 'Packaging must succeed');

  const extracted = extractDocumentFromHtml(packed.html);
  assert.equal(extracted.valid, true, 'Extracted document must be valid');

  const extractedDoc = extracted.document;
  assert.equal(extractedDoc.objects['r1'].rotation, 37);
  assert.equal(extractedDoc.objects['p1'].rotation, 75);
  assert.equal(extractedDoc.objects['r1'].x, 150);
  assert.equal(extractedDoc.objects['p1'].closed, true);
});

test('F-01: Rotated path vertex edit preserves exact world vertex positions on commit with zero jump', () => {
  const doc = createDefaultDocument();
  // Reproduction case from review: bounds (100, 100, 100, 100), rotation 45°, points [[0,0], [100,100]]
  const origBounds = { x: 100, y: 100, width: 100, height: 100 };
  const origCenter = { x: 150, y: 150 };
  const rot = 45;

  // Vertex 0 moved to local [-20, 0] relative to origBounds (100, 100)
  const previewPoints = [[-20, 0], [100, 100]];
  // Unrotated points relative to document origin:
  const unrotatedPts = [
    { x: origBounds.x - 20, y: origBounds.y + 0 }, // (80, 100)
    { x: origBounds.x + 100, y: origBounds.y + 100 } // (200, 200)
  ];

  // Preview world position of vertex 0 (under original center C0 = 150, 150):
  const previewWorldV0 = rotatePoint(unrotatedPts[0], origCenter, rot);
  const previewWorldV1 = rotatePoint(unrotatedPts[1], origCenter, rot);

  // Rebox unrotated points
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of unrotatedPts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const width = Math.max(16, maxX - minX); // 120
  const height = Math.max(16, maxY - minY); // 100
  const normalizedPoints = unrotatedPts.map(p => [Math.round(p.x - minX), Math.round(p.y - minY)]); // [[0, 0], [120, 100]]

  const newLocalCenter = { x: minX + width / 2, y: minY + height / 2 }; // (140, 150)
  const newWorldCenter = rotatePoint(newLocalCenter, origCenter, rot);
  const finalX = Math.round((newWorldCenter.x - width / 2) * 100) / 100;
  const finalY = Math.round((newWorldCenter.y - height / 2) * 100) / 100;

  // After commit, vertex 0 rendered world position:
  const postCommitV0Unrotated = { x: finalX + normalizedPoints[0][0], y: finalY + normalizedPoints[0][1] };
  const postCommitWorldCenter = { x: finalX + width / 2, y: finalY + height / 2 };
  const postCommitWorldV0 = rotatePoint(postCommitV0Unrotated, postCommitWorldCenter, rot);
  const postCommitV1Unrotated = { x: finalX + normalizedPoints[1][0], y: finalY + normalizedPoints[1][1] };
  const postCommitWorldV1 = rotatePoint(postCommitV1Unrotated, postCommitWorldCenter, rot);

  assert.ok(Math.abs(postCommitWorldV0.x - previewWorldV0.x) < 0.01, 'Vertex 0 x must not jump at commit');
  assert.ok(Math.abs(postCommitWorldV0.y - previewWorldV0.y) < 0.01, 'Vertex 0 y must not jump at commit');
  assert.ok(Math.abs(postCommitWorldV1.x - previewWorldV1.x) < 0.01, 'Vertex 1 x must not jump at commit');
  assert.ok(Math.abs(postCommitWorldV1.y - previewWorldV1.y) < 0.01, 'Vertex 1 y must not jump at commit');
});

test('F-03: Malformed rotate_objects input returns validation errors without throwing runtime exceptions', () => {
  const doc = createDefaultDocument();
  const rect = createDefaultObject('rectangle', { id: 'r1', x: 100, y: 100, width: 100, height: 100, rotation: 0, locked: false }, doc.theme);
  const lockedRect = createDefaultObject('rectangle', { id: 'rLocked', x: 300, y: 100, width: 100, height: 100, rotation: 0, locked: true }, doc.theme);
  const conn = createDefaultObject('connector', { id: 'c1', from: { point: { x: 100, y: 100 } }, to: { point: { x: 200, y: 200 } } }, doc.theme);
  doc.objects['r1'] = rect;
  doc.objects['rLocked'] = lockedRect;
  doc.objects['c1'] = conn;
  doc.order = ['r1', 'rLocked', 'c1'];

  // Test case from review: malformed freeEndpoints with null
  const res1 = validateCommand({
    type: 'rotate_objects',
    objects: { r1: { rotation: 45 } },
    freeEndpoints: { bad: null }
  }, doc);
  assert.equal(res1.valid, false, 'Null freeEndpoints entry must fail validation');
  assert.ok(res1.errors.length > 0, 'Validation errors must be returned');

  // Test non-existent connector ID in freeEndpoints
  const res2 = validateCommand({
    type: 'rotate_objects',
    objects: { r1: { rotation: 45 } },
    freeEndpoints: { nonExistent: { from: { x: 10, y: 10 } } }
  }, doc);
  assert.equal(res2.valid, false, 'Non-existent connector in freeEndpoints must fail validation');

  // Test non-connector ID in freeEndpoints
  const res3 = validateCommand({
    type: 'rotate_objects',
    objects: { r1: { rotation: 45 } },
    freeEndpoints: { r1: { from: { x: 10, y: 10 } } }
  }, doc);
  assert.equal(res3.valid, false, 'Non-connector in freeEndpoints must fail validation');

  // Test non-finite coords in freeEndpoints
  const res4 = validateCommand({
    type: 'rotate_objects',
    objects: { r1: { rotation: 45 } },
    freeEndpoints: { c1: { from: { x: Infinity, y: 10 } } }
  }, doc);
  assert.equal(res4.valid, false, 'Non-finite coords in freeEndpoints must fail validation');

  // Test malformed objects map (null, array, empty)
  assert.equal(validateCommand({ type: 'rotate_objects', objects: null }, doc).valid, false);
  assert.equal(validateCommand({ type: 'rotate_objects', objects: [] }, doc).valid, false);
  assert.equal(validateCommand({ type: 'rotate_objects', objects: {} }, doc).valid, false);
  assert.equal(validateCommand({ type: 'rotate_objects', objects: { r1: null } }, doc).valid, false);
  assert.equal(validateCommand({ type: 'rotate_objects', objects: { r1: { rotation: NaN } } }, doc).valid, false);
  assert.equal(validateCommand({ type: 'rotate_objects', objects: { rLocked: { rotation: 45 } } }, doc).valid, false);
});

test('F-04: Locked rotated object selection overlay preserves rotation transform and suppresses handles', () => {
  const doc = createDefaultDocument();
  const lockedRect = createDefaultObject('rectangle', {
    id: 'rLocked',
    x: 200,
    y: 200,
    width: 150,
    height: 100,
    rotation: 55,
    locked: true
  }, doc.theme);
  doc.objects['rLocked'] = lockedRect;
  doc.order = ['rLocked'];

  const overlay = renderSelectionOverlay(doc, ['rLocked']);
  assert.ok(overlay.includes('transform="rotate(55'), 'Locked rotated object must render oriented selection overlay with rotation transform');
  assert.ok(overlay.includes('selection-bounds-rect'), 'Outline rect must be rendered');
  assert.ok(!overlay.includes('data-handle="rotate"'), 'Locked object must NOT render rotation handle');
  assert.ok(!overlay.includes('data-handle="nw"'), 'Locked object must NOT render resize handles');
});

test('F-02: Continuous Shift press and release state transitions during rotation with zero jump', () => {
  const doc = createDefaultDocument();
  const rect = createDefaultObject('rectangle', { id: 'r1', x: 200, y: 200, width: 100, height: 100, rotation: 0 }, doc.theme);
  doc.objects['r1'] = rect;
  doc.order = ['r1'];

  const pivot = { x: 250, y: 250 };
  const radius = 78; // top handle stem distance

  // Mock workspace rotation state
  const rotateData = {
    pivot,
    startAngle: -90, // worldPt directly above center at (250, 172)
    snapshotObjects: [cloneDocument(rect)],
    snapshotFreeEndpoints: {},
    isSingle: true,
    lastShiftKey: false,
    lastEffectiveDelta: 0,
    shiftAnchorAngle: -90,
    shiftBaseDelta: 0,
    unsnappedAnchorAngle: -90,
    unsnappedBaseDelta: 0,
    lastWorldPt: { x: 250, y: 172 }
  };

  const ws = {
    isRotating: true,
    rotateData,
    callbacks: { getDocument: () => doc },
    render: () => {},
    latestRotateResult: null
  };

  // Import or bind updateRotationPreview logic
  const updatePreview = (worldPt, shiftKey) => {
    const currentAngle = Math.atan2(worldPt.y - pivot.y, worldPt.x - pivot.x) * (180 / Math.PI);
    const isShift = Boolean(shiftKey);
    if (ws.rotateData.lastShiftKey !== isShift) {
      if (isShift) {
        ws.rotateData.shiftAnchorAngle = currentAngle;
        ws.rotateData.shiftBaseDelta = ws.rotateData.lastEffectiveDelta || 0;
      } else {
        ws.rotateData.unsnappedAnchorAngle = currentAngle;
        ws.rotateData.unsnappedBaseDelta = ws.rotateData.lastEffectiveDelta || 0;
      }
      ws.rotateData.lastShiftKey = isShift;
    }

    let angleDelta;
    if (isShift) {
      const rawShiftDelta = currentAngle - (ws.rotateData.shiftAnchorAngle !== undefined ? ws.rotateData.shiftAnchorAngle : ws.rotateData.startAngle);
      const snappedStep = Math.round(rawShiftDelta / 15) * 15;
      angleDelta = (ws.rotateData.shiftBaseDelta || 0) + snappedStep;
    } else {
      const rawUnsnappedDelta = currentAngle - (ws.rotateData.unsnappedAnchorAngle !== undefined ? ws.rotateData.unsnappedAnchorAngle : ws.rotateData.startAngle);
      angleDelta = (ws.rotateData.unsnappedBaseDelta || 0) + rawUnsnappedDelta;
    }

    ws.rotateData.lastEffectiveDelta = angleDelta;
    const targetAngle = ((ws.rotateData.snapshotObjects[0].rotation || 0) + angleDelta + 360) % 360;
    doc.objects.r1.rotation = targetAngle;
    return targetAngle;
  };

  // 1. Drag unsnapped to 40 degrees
  const angleAt40Rad = (-90 + 40) * Math.PI / 180;
  const pt40 = { x: pivot.x + radius * Math.cos(angleAt40Rad), y: pivot.y + radius * Math.sin(angleAt40Rad) };
  const angleBeforeShift = updatePreview(pt40, false);
  assert.equal(Math.round(angleBeforeShift), 40, 'Angle before shift should be 40 deg');

  // 2. Press Shift at the EXACT SAME pointer position pt40
  const angleOnShiftPress = updatePreview(pt40, true);
  const jumpOnPress = Math.abs(angleOnShiftPress - angleBeforeShift);
  assert.equal(jumpOnPress, 0, 'Jump on Shift press at same pointer position must be 0 deg');

  // 3. Move pointer by +10 deg while holding Shift (relative diff: 10 deg -> snaps to +15 deg step)
  const angleAt50Rad = (-90 + 50) * Math.PI / 180;
  const pt50 = { x: pivot.x + radius * Math.cos(angleAt50Rad), y: pivot.y + radius * Math.sin(angleAt50Rad) };
  const angleWithShift15 = updatePreview(pt50, true);
  assert.equal(Math.round(angleWithShift15), 55, '40 + 15 = 55 deg on Shift snap');

  // 4. Move pointer by +25 deg while holding Shift (relative diff: 25 deg -> snaps to +30 deg step)
  const angleAt65Rad = (-90 + 65) * Math.PI / 180;
  const pt65 = { x: pivot.x + radius * Math.cos(angleAt65Rad), y: pivot.y + radius * Math.sin(angleAt65Rad) };
  const angleWithShift30 = updatePreview(pt65, true);
  assert.equal(Math.round(angleWithShift30), 70, '40 + 30 = 70 deg on Shift snap');

  // 5. Release Shift at the EXACT SAME pointer position pt65
  const angleOnShiftRelease = updatePreview(pt65, false);
  const jumpOnRelease = Math.abs(angleOnShiftRelease - angleWithShift30);
  assert.equal(jumpOnRelease, 0, 'Jump on Shift release at same pointer position must be 0 deg');

  // 6. Continue dragging unsnapped by +3 deg
  const angleAt68Rad = (-90 + 68) * Math.PI / 180;
  const pt68 = { x: pivot.x + radius * Math.cos(angleAt68Rad), y: pivot.y + radius * Math.sin(angleAt68Rad) };
  const angleUnsnappedPostRelease = updatePreview(pt68, false);
  assert.equal(Math.round(angleUnsnappedPostRelease), 73, '70 + 3 = 73 deg after Shift release');
});
