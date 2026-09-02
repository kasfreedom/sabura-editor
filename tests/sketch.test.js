import test from 'node:test';
import assert from 'node:assert/strict';
import { createPRNG, generateSketchPath } from '../src/core/sketch.js';

test('Mulberry32 PRNG is strictly deterministic given a seed', () => {
  const prngA = createPRNG(42891);
  const prngB = createPRNG(42891);

  const seqA = Array.from({ length: 10 }, () => prngA());
  const seqB = Array.from({ length: 10 }, () => prngB());

  assert.deepEqual(seqA, seqB);
});

test('generateSketchPath produces identical SVG strings on repeated runs', () => {
  const rectObj = {
    type: 'rectangle',
    x: 100,
    y: 100,
    width: 200,
    height: 120,
    roughness: 1,
    seed: 987654
  };

  const path1 = generateSketchPath(rectObj);
  const path2 = generateSketchPath(rectObj);
  const path3 = generateSketchPath(rectObj);

  assert.ok(path1.length > 0);
  assert.equal(path1, path2);
  assert.equal(path2, path3);

  // Different seed produces different path
  const pathDiff = generateSketchPath({ ...rectObj, seed: 123456 });
  assert.notEqual(path1, pathDiff);
});

test('clean mode (roughness 0) produces geometric SVG path', () => {
  const ellipse = {
    type: 'ellipse',
    x: 50,
    y: 50,
    width: 100,
    height: 100,
    roughness: 0,
    seed: 1
  };

  const path = generateSketchPath(ellipse);
  assert.ok(path.startsWith('M'));
  assert.ok(path.includes('A 50 50'));
  assert.ok(path.endsWith('Z'));
});
