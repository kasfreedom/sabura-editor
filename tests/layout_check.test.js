// Layout warnings: labels that don't fit their shape, and overlapping shapes.
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkLayout } from '../src/core/layout-check.js';
import { layoutReport } from '../src/board-file.js';

const shape = (id, type, x, y, width, height, text, resolvedSize) => ({
  id, type, x, y, width, height, text, ...(resolvedSize ? { textStyle: { resolvedSize } } : {}),
});
const board = (...objects) => ({
  order: objects.map((o) => o.id),
  objects: Object.fromEntries(objects.map((o) => [o.id, o])),
});
const codes = (doc) => checkLayout(doc).map((w) => `${w.code}:${w.ids.join(',')}`);
const suggestion = (warning) => warning.message.match(/about (\d+)x(\d+)/).slice(1).map(Number);

test('a label that fits its shape gives no warning', () => {
  assert.deepEqual(codes(board(shape('api', 'rectangle', 0, 0, 180, 80, 'API gateway'))), []);
  assert.deepEqual(codes(board(shape('ok', 'ellipse', 0, 0, 220, 90, 'Order placed'))), []);
});

test('the same label overflows a narrower shape type at the same size', () => {
  const text = 'Customer places order';
  assert.deepEqual(codes(board(shape('r', 'rectangle', 0, 0, 160, 70, text))), []);
  assert.deepEqual(codes(board(shape('e', 'ellipse', 0, 0, 160, 70, text))), ['TEXT_OVERFLOW:e']);
  assert.deepEqual(codes(board(shape('d', 'diamond', 0, 0, 160, 70, text))), ['TEXT_OVERFLOW:d']);
});

test('a single word wider than the shape is reported even when height is fine', () => {
  assert.deepEqual(codes(board(shape('w', 'rectangle', 0, 0, 90, 200, 'Internationalization'))), ['TEXT_OVERFLOW:w']);
});

test('larger text needs more room', () => {
  assert.deepEqual(codes(board(shape('s', 'rectangle', 0, 0, 180, 60, 'Payment service', 14))), []);
  assert.deepEqual(codes(board(shape('l', 'rectangle', 0, 0, 180, 60, 'Payment service', 36))), ['TEXT_OVERFLOW:l']);
});

test('the suggested size clears the warning', () => {
  for (const type of ['rectangle', 'ellipse', 'diamond', 'triangle']) {
    const tight = shape('x', type, 0, 0, 120, 60, 'Notify customer: payment failed');
    const [warning] = checkLayout(board(tight));
    assert.equal(warning?.code, 'TEXT_OVERFLOW', type);
    const [width, height] = suggestion(warning);
    assert.deepEqual(codes(board({ ...tight, width, height })), [], `${type} at ${width}x${height}`);
  }
});

test('overlapping shapes are reported; one shape fully inside another is not', () => {
  assert.deepEqual(codes(board(
    shape('a', 'rectangle', 0, 0, 180, 80, 'A'),
    shape('b', 'rectangle', 100, 40, 180, 80, 'B'),
  )), ['OVERLAP:a,b']);
  assert.deepEqual(codes(board(
    shape('panel', 'rectangle', 0, 0, 400, 300, 'Panel'),
    shape('inner', 'ellipse', 40, 40, 160, 80, 'Inside'),
  )), []);
});

test('unlabelled shapes may overlap: drawings are built that way', () => {
  assert.deepEqual(codes(board(
    shape('chimney', 'rectangle', 0, 0, 40, 120, ''),
    shape('cap', 'rectangle', -5, -10, 50, 20, undefined),
    shape('caption', 'text', 60, 0, 120, 30, 'Factory'),
  )), []);
});

test('shapes that only touch, or connectors crossing shapes, are not overlaps', () => {
  assert.deepEqual(codes(board(
    shape('a', 'rectangle', 0, 0, 180, 80, 'A'),
    shape('b', 'rectangle', 178, 0, 180, 80, 'B'),
    { id: 'k', type: 'connector', from: { id: 'a' }, to: { id: 'b' } },
  )), []);
});

test('the report lists messages and the total, capped at 20 messages', () => {
  const many = Array.from({ length: 25 }, (_, i) => shape(`s${i}`, 'diamond', i * 300, 0, 60, 40, 'Much too long for this diamond'));
  const report = layoutReport(board(...many));
  assert.equal(report.warningsTotal, 25);
  assert.equal(report.warnings.length, 20);
  assert.match(report.warnings[0], /^TEXT_OVERFLOW "s0"/);
});
