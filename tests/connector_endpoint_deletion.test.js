import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand } from '../src/core/commands.js';
import { createDefaultDocument, createDefaultObject, validateDocument } from '../src/core/document.js';
import { resolveConnectorGeometry } from '../src/core/geometry.js';
import { extractDocumentFromHtml, packageHtmlWithDocument } from '../src/storage/file-packer.js';
import { SaburaApp } from '../src/main.js';

const HTML_SHELL = '<!doctype html><html><body><script type="application/json" id="sabura-document">{}</script></body></html>';

function makeAttachedDocument({ routing = 'straight', explicit = false, transformed = false } = {}) {
  const doc = createDefaultDocument({ title: 'Connector deletion regression' });
  const source = createDefaultObject('rectangle', { id: 'source', x: 40, y: 80, width: 120, height: 80 }, doc.theme);
  const destination = createDefaultObject('rectangle', { id: 'destination', x: 320, y: 100, width: 140, height: 90 }, doc.theme);
  const connector = createDefaultObject('connector', {
    id: 'connector',
    from: explicit ? { id: source.id, anchor: { x: 0.75, y: 0.2 } } : { id: source.id },
    to: explicit ? { id: destination.id, anchor: { x: 0.15, y: 0.8 } } : { id: destination.id },
    routing
  }, doc.theme);
  doc.objects = { source, destination, connector };
  doc.order = ['source', 'destination', 'connector'];

  if (!transformed) return doc;

  let current = applyCommand(doc, {
    type: 'move_objects', ids: ['destination'], dx: 85, dy: -35
  }).doc;
  current = applyCommand(current, {
    type: 'resize_object', id: 'destination', bounds: { x: 405, y: 65, width: 210, height: 125 }
  }).doc;
  current = applyCommand(current, {
    type: 'rotate_objects', objects: { destination: { rotation: 37 } }
  }).doc;
  return current;
}

function assertFiniteConnector(doc) {
  const connector = doc.objects.connector;
  for (const endpoint of [connector.from, connector.to]) {
    if (!endpoint.point) continue;
    assert.equal(Number.isFinite(endpoint.point.x), true);
    assert.equal(Number.isFinite(endpoint.point.y), true);
  }
  const geometry = resolveConnectorGeometry(doc, connector);
  for (const point of [geometry.start, geometry.end, ...geometry.points]) {
    assert.equal(Number.isFinite(point.x), true);
    assert.equal(Number.isFinite(point.y), true);
  }
  assert.equal(geometry.path.includes('NaN'), false);
  assert.equal(geometry.path.includes('Infinity'), false);
}

function verifyDeletion({ routing, explicit, transformed, deletedIds }) {
  const original = makeAttachedDocument({ routing, explicit, transformed });
  const originalConnector = original.objects.connector;
  const before = resolveConnectorGeometry(original, originalConnector);

  const deleted = applyCommand(original, { type: 'delete_objects', ids: deletedIds });
  const connector = deleted.doc.objects.connector;

  if (deletedIds.includes('source')) {
    assert.deepEqual(connector.from, { point: before.start });
  } else {
    assert.deepEqual(connector.from, originalConnector.from);
  }
  if (deletedIds.includes('destination')) {
    assert.deepEqual(connector.to, { point: before.end });
  } else {
    assert.deepEqual(connector.to, originalConnector.to);
  }

  assertFiniteConnector(deleted.doc);
  assert.deepEqual(validateDocument(deleted.doc), { valid: true, errors: [] });

  const packed = packageHtmlWithDocument(HTML_SHELL, deleted.doc);
  assert.equal(packed.success, true);
  const reopened = extractDocumentFromHtml(packed.html);
  assert.equal(reopened.valid, true);
  assert.deepEqual(reopened.document.objects.connector, connector);

  const undone = applyCommand(deleted.doc, deleted.inverseCmd);
  assert.deepEqual(undone.doc, original);
  const redone = applyCommand(undone.doc, undone.inverseCmd);
  assert.deepEqual(redone.doc, deleted.doc);
}

for (const routing of ['straight', 'elbow', 'curved']) {
  for (const explicit of [false, true]) {
    for (const transformed of [false, true]) {
      for (const deletion of [
        { name: 'source', ids: ['source'] },
        { name: 'destination', ids: ['destination'] },
        { name: 'both endpoints', ids: ['destination', 'source'] }
      ]) {
        test(`${routing} connector with ${explicit ? 'explicit' : 'automatic'} anchors detaches ${deletion.name}${transformed ? ' after transforms' : ''}`, () => {
          verifyDeletion({ routing, explicit, transformed, deletedIds: deletion.ids });
        });
      }
    }
  }
}

test('application history records endpoint deletion and restores it through Undo and Redo', () => {
  const original = makeAttachedDocument();
  const app = Object.create(SaburaApp.prototype);
  app.doc = original;
  app.undoStack = [];
  app.redoStack = [];
  app.status = 'Clean';
  app.updateUI = () => {};
  app.notifySubscribers = () => {};

  assert.equal(app.dispatchCommand({ type: 'delete_objects', ids: ['destination'] }), true);
  assert.equal(app.undoStack.length, 1);
  assert.equal(app.undo(), true);
  assert.deepEqual(app.doc, original);
  assert.equal(app.redo(), true);
  assert.equal(app.doc.objects.destination, undefined);
  assertFiniteConnector(app.doc);
});
