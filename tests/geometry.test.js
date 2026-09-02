import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBoundingBox,
  getUnionBoundingBox,
  getShapeBoundaryPoint,
  resolveConnectorGeometry,
  calculateResize,
  calculateSnapping,
  alignObjects,
  distributeObjects,
  distanceToConnector
} from '../src/core/geometry.js';
import { createDefaultDocument, createDefaultObject } from '../src/core/document.js';

test('getBoundingBox and getUnionBoundingBox calculations', () => {
  const o1 = { x: 10, y: 20, width: 100, height: 50 };
  const o2 = { x: 50, y: 40, width: 100, height: 60 };

  const box1 = getBoundingBox(o1);
  assert.equal(box1.cx, 60);
  assert.equal(box1.cy, 45);
  assert.equal(box1.right, 110);
  assert.equal(box1.bottom, 70);

  const union = getUnionBoundingBox([o1, o2]);
  assert.equal(union.x, 10);
  assert.equal(union.y, 20);
  assert.equal(union.right, 150);
  assert.equal(union.bottom, 100);
  assert.equal(union.width, 140);
  assert.equal(union.height, 80);
});

test('getShapeBoundaryPoint computes accurate boundary hits', () => {
  const rect = { type: 'rectangle', x: 100, y: 100, width: 100, height: 100 };
  // Center is (150, 150)
  // Target to right (300, 150): should hit right edge at (200, 150)
  const ptRight = getShapeBoundaryPoint(rect, { x: 300, y: 150 });
  assert.equal(Math.round(ptRight.x), 200);
  assert.equal(Math.round(ptRight.y), 150);

  // Target above (150, 0): should hit top edge at (150, 100)
  const ptTop = getShapeBoundaryPoint(rect, { x: 150, y: 0 });
  assert.equal(Math.round(ptTop.x), 150);
  assert.equal(Math.round(ptTop.y), 100);

  // Ellipse test: circle at (150, 150) with radius 50
  const circle = { type: 'ellipse', x: 100, y: 100, width: 100, height: 100 };
  const circleRight = getShapeBoundaryPoint(circle, { x: 300, y: 150 });
  assert.equal(Math.round(circleRight.x), 200);
  assert.equal(Math.round(circleRight.y), 150);
});

test('calculateResize handles 8 handles, aspect ratio, and center symmetry', () => {
  const orig = { x: 100, y: 100, width: 100, height: 100 };

  // Drag 'se' handle by +20, +30
  const r1 = calculateResize('se', orig, 20, 30);
  assert.equal(r1.width, 120);
  assert.equal(r1.height, 130);
  assert.equal(r1.x, 100);
  assert.equal(r1.y, 100);

  // Drag 'se' handle with keepAspect
  const r2 = calculateResize('se', orig, 20, 50, { keepAspect: true });
  assert.equal(r2.width, 150);
  assert.equal(r2.height, 150);

  // Drag 'e' handle with fromCenter (symmetrical)
  const r3 = calculateResize('e', orig, 20, 0, { fromCenter: true });
  assert.equal(r3.width, 140);
  assert.equal(r3.x, 80); // centered around original cx 150
});

test('calculateSnapping aligns to other object edges and centers', () => {
  const staticBox = { x: 100, y: 100, width: 100, height: 100 };
  const dragged = { x: 98, y: 250, width: 80, height: 80 }; // Close to x = 100

  const snap = calculateSnapping(dragged, [staticBox], { tolerance: 5 });
  assert.equal(snap.x, 100); // Snapped to left edge of staticBox
  assert.equal(snap.guides.length > 0, true);
});

test('alignObjects and distributeObjects', () => {
  const o1 = { id: '1', x: 10, y: 10, width: 50, height: 50 };
  const o2 = { id: '2', x: 100, y: 30, width: 50, height: 50 };

  // Align left: o1 stays at 10, o2 moves from 100 to 10 (dx: -90)
  const leftAlign = alignObjects([o1, o2], 'left');
  assert.equal(leftAlign['1'].dx, 0);
  assert.equal(leftAlign['2'].dx, -90);

  // Distribute horizontal
  const o3 = { id: '3', x: 250, y: 10, width: 50, height: 50 };
  const dist = distributeObjects([o1, o2, o3], 'horizontal');
  assert.ok(dist['2']);
});

test('distanceToConnector performs precision hit testing instead of broad bounding box', () => {
  const doc = createDefaultDocument();
  // Diagonal connector from (0, 0) to (200, 200)
  // Broad bounding box is 200x200 covering (0,0) to (200,200)
  const conn = createDefaultObject('connector', {
    id: 'conn1',
    from: { point: { x: 0, y: 0 } },
    to: { point: { x: 200, y: 200 } },
    routing: 'straight'
  });
  doc.objects['conn1'] = conn;

  // Point right next to the line (100, 102) -> distance should be ~1.4px <= 10px
  const closeDist = distanceToConnector({ x: 100, y: 102 }, conn, doc);
  assert.ok(closeDist <= 2, `Expected distance <= 2, got ${closeDist}`);

  // Point in top-right of bounding box (190, 10) -> inside broad box, but far from line
  // Distance to y=x line from (190, 10) is |190 - 10| / sqrt(2) = 127.28px
  const farDist = distanceToConnector({ x: 190, y: 10 }, conn, doc);
  assert.ok(farDist > 100, `Expected distance > 100, got ${farDist}`);

  // Curved connector
  const curvedConn = createDefaultObject('connector', {
    id: 'conn2',
    from: { point: { x: 0, y: 0 } },
    to: { point: { x: 200, y: 0 } },
    routing: 'curved'
  });
  doc.objects['conn2'] = curvedConn;
  // Curve passes through (100, 20) at apex
  const curvedCloseDist = distanceToConnector({ x: 100, y: 21 }, curvedConn, doc);
  assert.ok(curvedCloseDist <= 2, `Expected curved close distance <= 2, got ${curvedCloseDist}`);
});
