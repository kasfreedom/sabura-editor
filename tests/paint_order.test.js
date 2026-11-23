// Arrows follow the board's order like every other object, so Send to back and
// Bring to front work on them, and a click selects what is drawn on top.
// Regression: arrows used to be drawn above both of their endpoints whatever
// their order, so "Send to back" on an arrow crossing a shape did nothing, and
// clicks went by a different order than the drawing.
import test from 'node:test';
import assert from 'node:assert/strict';

import { applyCommand, applyCommandBatch } from '../src/core/commands.js';
import { createDefaultDocument, normalizeDocument } from '../src/core/document.js';
import { paintOrder } from '../src/core/geometry.js';
import { renderSceneParts } from '../src/renderer/svg-renderer.js';
import { Workspace } from '../src/ui/workspace.js';

const rect = (id, x, y, width, height) => ({ type: 'create_object', object: { id, type: 'rectangle', x, y, width, height, text: id } });

/** A and B joined by arrow k, which crosses panel C between them. */
function crossing() {
  const doc = normalizeDocument(createDefaultDocument({ title: 't' }));
  return applyCommandBatch(doc, [
    rect('A', 0, 100, 160, 80),
    rect('C', 200, 40, 160, 200),
    rect('B', 420, 100, 160, 80),
    { type: 'connect_objects', connectorId: 'k', fromId: 'A', toId: 'B' },
  ]).doc;
}
const reorder = (doc, ids, action) => applyCommand(doc, { type: 'reorder_objects', ids, action }).doc;
const drawn = (doc) => renderSceneParts(doc, { camera: { x: 0, y: 0, zoom: 1 }, selectedIds: [], showGrid: false })
  .objects.map((o) => o.id);
const clicked = (doc, point) => Workspace.prototype.findObjectAt
  .call({ callbacks: { getDocument: () => doc }, camera: { zoom: 1 } }, point)?.id;
const onPanelUnderArrow = { x: 280, y: 140 };

test('paint order is the board order, arrows included', () => {
  const doc = crossing();
  assert.deepEqual(paintOrder(doc), ['A', 'C', 'B', 'k']);
  assert.deepEqual(paintOrder(reorder(doc, ['k'], 'back')), ['k', 'A', 'C', 'B']);
  assert.deepEqual(paintOrder(reorder(doc, ['k'], 'backward')), ['A', 'C', 'k', 'B']);
});

test('Send to back puts an arrow under the shape it crosses, on screen and for clicks', () => {
  const doc = crossing();
  assert.equal(clicked(doc, onPanelUnderArrow), 'k', 'arrow on top: a click on it selects it');
  const sent = reorder(doc, ['k'], 'back');
  assert.deepEqual(drawn(sent), ['k', 'A', 'C', 'B']);
  assert.equal(clicked(sent, onPanelUnderArrow), 'C', 'arrow under the panel: the panel gets the click');
});

test('drawing and clicking agree after every kind of reorder', () => {
  for (const [ids, action] of [[['k'], 'back'], [['k'], 'backward'], [['C'], 'front'], [['B'], 'front'], [['A'], 'back']]) {
    const doc = reorder(crossing(), ids, action);
    assert.deepEqual(drawn(doc), paintOrder(doc), `${ids} ${action}`);
  }
});

test("a connector's explicit stacking pins it under or over everything", () => {
  const doc = crossing();
  const back = applyCommand(doc, { type: 'configure_connector', id: 'k', stacking: 'back' }).doc;
  assert.deepEqual(drawn(back), ['k', 'A', 'C', 'B']);
  const front = applyCommand(reorder(doc, ['k'], 'back'), { type: 'configure_connector', id: 'k', stacking: 'front' }).doc;
  assert.deepEqual(drawn(front), ['A', 'C', 'B', 'k']);
  assert.equal(clicked(front, onPanelUnderArrow), 'k');
});

test('paint order skips ids in order that have no object', () => {
  const doc = crossing();
  assert.deepEqual(paintOrder({ ...doc, order: ['ghost', ...doc.order] }), ['A', 'C', 'B', 'k']);
});
