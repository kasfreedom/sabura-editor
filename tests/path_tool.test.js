import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDocument, createDefaultObject } from '../src/core/document.js';
import { applyCommand, validateCommand } from '../src/core/commands.js';
import { sketchSpline, generateSketchPath, generateClosedFillPath } from '../src/core/sketch.js';
import { distanceToPath } from '../src/core/geometry.js';

test('sketchSpline produces smooth cubic Bezier paths for open and closed polylines', () => {
  const pts = [[0, 0], [100, 50], [200, 20], [300, 80]];
  const prng = () => 0.5;

  // Clean mode (roughness 0): single deterministic path with C commands
  const openClean = sketchSpline(pts, prng, 0, false);
  assert.ok(openClean.startsWith('M 0.0 0.0'));
  assert.ok(openClean.includes('C'));
  assert.ok(!openClean.endsWith('Z'));

  const closedClean = sketchSpline(pts, prng, 0, true);
  assert.ok(closedClean.startsWith('M 0.0 0.0'));
  assert.ok(closedClean.includes('C'));
  assert.ok(closedClean.endsWith('Z'));

  // Rough mode (roughness 1): two passes
  const openRough = sketchSpline(pts, prng, 1, false);
  const mCount = (openRough.match(/M /g) || []).length;
  assert.equal(mCount, 2, 'Should generate 2 sketch passes');
});

test('path object creation, default fields, and validation', () => {
  const doc = createDefaultDocument();
  const lineObj = createDefaultObject('path', {
    x: 50,
    y: 50,
    width: 200,
    height: 100,
    points: [[0, 0], [100, 50], [200, 100]],
    closed: false,
    curveStyle: 'sharp',
    startArrow: false,
    endArrow: true
  }, doc.theme);

  assert.equal(lineObj.type, 'path');
  assert.equal(lineObj.closed, false);
  assert.equal(lineObj.curveStyle, 'sharp');
  assert.equal(lineObj.endArrow, true);
  assert.equal(lineObj.points.length, 3);

  // Apply create_object command
  const res1 = applyCommand(doc, { type: 'create_object', object: lineObj });
  assert.ok(res1.doc.objects[lineObj.id]);

  // Undo creates inverse delete_objects
  const resUndo = applyCommand(res1.doc, res1.inverseCmd);
  assert.equal(resUndo.doc.objects[lineObj.id], undefined);
});

test('distanceToPath performs precision hit testing for open and closed paths', () => {
  const pathObj = {
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    points: [[0, 0], [200, 0]],
    closed: false
  };

  // Point right on the line (world: 200, 100)
  const distOnLine = distanceToPath({ x: 200, y: 100 }, pathObj);
  assert.equal(distOnLine, 0);

  // Point 8px above the line
  const distNear = distanceToPath({ x: 200, y: 92 }, pathObj);
  assert.equal(Math.round(distNear), 8);

  // Point far away
  const distFar = distanceToPath({ x: 200, y: 250 }, pathObj);
  assert.equal(Math.round(distFar), 150);
});

test('set_style toggles curveStyle, closed, and arrows with atomic undo/redo', () => {
  const doc = createDefaultDocument();
  const polyObj = createDefaultObject('path', {
    x: 10,
    y: 10,
    width: 100,
    height: 100,
    points: [[0, 0], [100, 0], [100, 100]],
    closed: false,
    curveStyle: 'sharp'
  }, doc.theme);
  doc.objects[polyObj.id] = polyObj;
  doc.order.push(polyObj.id);

  // 1. Toggle to curved
  const resCurved = applyCommand(doc, {
    type: 'set_style',
    ids: [polyObj.id],
    updates: { curveStyle: 'curved' }
  });
  assert.equal(resCurved.doc.objects[polyObj.id].curveStyle, 'curved');

  // Undo restores sharp
  const undoCurved = applyCommand(resCurved.doc, resCurved.inverseCmd);
  assert.equal(undoCurved.doc.objects[polyObj.id].curveStyle, 'sharp');

  // 2. Toggle closed into polygon and add fill
  const resClosed = applyCommand(doc, {
    type: 'set_style',
    ids: [polyObj.id],
    updates: { closed: true, fill: '#ffc9c9' }
  });
  assert.equal(resClosed.doc.objects[polyObj.id].closed, true);
  assert.equal(resClosed.doc.objects[polyObj.id].fill, '#ffc9c9');

  // Undo restores open and none fill
  const undoClosed = applyCommand(resClosed.doc, resClosed.inverseCmd);
  assert.equal(undoClosed.doc.objects[polyObj.id].closed, false);

  // 3. Arrowheads on open line
  const resArrows = applyCommand(doc, {
    type: 'set_style',
    ids: [polyObj.id],
    updates: { startArrow: true, endArrow: true }
  });
  assert.equal(resArrows.doc.objects[polyObj.id].startArrow, true);
  assert.equal(resArrows.doc.objects[polyObj.id].endArrow, true);

  const undoArrows = applyCommand(resArrows.doc, resArrows.inverseCmd);
  assert.equal(undoArrows.doc.objects[polyObj.id].startArrow, false);
  assert.equal(undoArrows.doc.objects[polyObj.id].endArrow, false);
});

test('update_path_points modifies vertices and bounds with exact single-step undo/redo', () => {
  const doc = createDefaultDocument();
  const obj = createDefaultObject('path', {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    points: [[0, 0], [100, 0], [50, 100]]
  }, doc.theme);
  doc.objects[obj.id] = obj;
  doc.order.push(obj.id);

  // Command validation
  assert.ok(validateCommand({
    type: 'update_path_points',
    id: obj.id,
    points: [[0, 0], [120, 0], [50, 100]]
  }).valid);

  // Apply update_path_points
  const res1 = applyCommand(doc, {
    type: 'update_path_points',
    id: obj.id,
    points: [[0, 0], [150, 0], [50, 100]],
    bounds: { x: 0, y: 0, width: 150, height: 100 }
  });

  assert.equal(res1.doc.objects[obj.id].width, 150);
  assert.deepEqual(res1.doc.objects[obj.id].points[1], [150, 0]);

  // Undo
  const resUndo = applyCommand(res1.doc, res1.inverseCmd);
  assert.equal(resUndo.doc.objects[obj.id].width, 100);
  assert.deepEqual(resUndo.doc.objects[obj.id].points[1], [100, 0]);
});

test('generateSketchPath and generateClosedFillPath handle sharp and curved path objects', () => {
  const lineObj = {
    id: 'test-line',
    type: 'path',
    x: 10,
    y: 10,
    width: 100,
    height: 100,
    points: [[0, 0], [50, 50], [100, 100]],
    closed: false,
    curveStyle: 'curved',
    roughness: 0
  };

  const curvedStroke = generateSketchPath(lineObj);
  assert.ok(curvedStroke.includes('C'), 'Curved path should generate Bezier curves');

  lineObj.curveStyle = 'sharp';
  const sharpStroke = generateSketchPath(lineObj);
  assert.ok(sharpStroke.includes('L'), 'Sharp path should generate straight lines');
  assert.ok(!sharpStroke.includes('C'));

  // Closed polygon fill
  const polyObj = {
    id: 'test-poly',
    type: 'path',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    points: [[0, 0], [100, 0], [100, 100], [0, 100]],
    closed: true,
    curveStyle: 'curved',
    roughness: 0
  };
  const curvedFill = generateClosedFillPath(polyObj);
  assert.ok(curvedFill.endsWith('Z'), 'Closed fill path must end with Z');
  assert.ok(curvedFill.includes('C'), 'Curved closed fill must use C splines');
});
