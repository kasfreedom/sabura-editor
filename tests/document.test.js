import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultDocument,
  validateDocument,
  cloneDocument,
  canonicalJson,
  createDefaultObject
} from '../src/core/document.js';
import { CANVAS_SCHEMA_VERSION, THEME_PRESETS } from '../src/core/types.js';

test('createDefaultDocument generates a valid initial document', () => {
  const doc = createDefaultDocument({ title: 'Test Board' });
  assert.equal(doc.schemaVersion, CANVAS_SCHEMA_VERSION);
  assert.equal(doc.title, 'Test Board');
  assert.ok(doc.id.startsWith('board_'));
  assert.equal(doc.theme.id, 'paper');
  assert.deepEqual(doc.objects, {});
  assert.deepEqual(doc.order, []);

  const val = validateDocument(doc);
  assert.equal(val.valid, true, `Validation errors: ${val.errors.join(', ')}`);
});

test('validateDocument catches invalid documents and corrupted fields', () => {
  assert.equal(validateDocument(null).valid, false);
  assert.equal(validateDocument({}).valid, false);

  const invalidVersion = createDefaultDocument();
  invalidVersion.schemaVersion = 'invalid/v0';
  assert.equal(validateDocument(invalidVersion).valid, false);

  const badOrder = createDefaultDocument();
  badOrder.order = ['non_existent_id'];
  assert.equal(validateDocument(badOrder).valid, false);

  const dupOrder = createDefaultDocument();
  const obj = createDefaultObject('rectangle', { id: 'rect_1' });
  dupOrder.objects['rect_1'] = obj;
  dupOrder.order = ['rect_1', 'rect_1'];
  assert.equal(validateDocument(dupOrder).valid, false);
});

test('createDefaultObject generates valid objects for all types', () => {
  const rect = createDefaultObject('rectangle', { x: 10, y: 20, width: 100, height: 80 });
  assert.equal(rect.type, 'rectangle');
  assert.equal(rect.x, 10);
  assert.equal(rect.width, 100);
  assert.equal(rect.seed > 0, true);

  const conn = createDefaultObject('connector', { from: { id: 'a' }, to: { id: 'b' } });
  assert.equal(conn.type, 'connector');
  assert.equal(conn.from.id, 'a');
  assert.equal(conn.to.id, 'b');

  const path = createDefaultObject('path', { points: [[0, 0], [10, 10]] });
  assert.equal(path.type, 'path');
  assert.equal(path.points.length, 2);
});

test('canonicalJson produces deterministic sorted-key JSON and escapes script tags', () => {
  const objA = { z: 1, a: 2, m: { y: 3, x: 4 } };
  const objB = { a: 2, m: { x: 4, y: 3 }, z: 1 };
  assert.equal(canonicalJson(objA), canonicalJson(objB));

  const textWithScript = { text: 'Hello </script><script>alert(1)</script>' };
  const jsonStr = canonicalJson(textWithScript);
  assert.ok(!jsonStr.includes('</script>'));
  assert.ok(jsonStr.includes('<\\/script>'));
});
