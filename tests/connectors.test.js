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
