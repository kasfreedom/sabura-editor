import test from 'node:test';
import assert from 'node:assert/strict';

import { AgentApi, AGENT_PUBLIC_COMMAND_SCHEMAS, AGENT_PUBLIC_COMMAND_TYPES } from '../src/agent-api.js';
import { SaburaApp } from '../src/main.js';
import { canonicalJson, createDefaultDocument, createDefaultObject } from '../src/core/document.js';
import { checkJsonSchema, SUPPORTED_SCHEMA_KEYWORDS } from '../src/core/json-schema.js';

function makeApp() {
  const app = Object.create(SaburaApp.prototype);
  app.doc = createDefaultDocument({ id: 'schema_board', title: 'Schema' });
  Object.assign(app, { status: 'Clean', mode: 'editing', isCorrupted: false, inPresentation: false, isSaving: false,
    pendingImageReader: null, pendingImageDecode: null, undoStack: [], redoStack: [], subscribers: new Set() });
  app.updateUI = () => {};
  app.workspace = { selectedIds: [], activeGroupId: null, camera: { x: 0, y: 0, zoom: 1 },
    container: { getBoundingClientRect: () => ({ width: 900, height: 600 }) }, hasActiveInteraction: () => false };
  app.textEditor = { targetObject: null, textarea: { style: { display: 'none' } } };
  app.agentApi = new AgentApi(app);
  return app;
}

const rect = (id, extra = {}) => ({ type: 'create_object', object: { id, type: 'rectangle', x: 0, y: 0, width: 100, height: 60, ...extra } });
let seq = 0;
const apply = (app, commands) => app.agentApi.apply({ requestId: `r${++seq}`, expectedEditToken: app.agentApi.editToken(), commands });

/** Applies `commands` and asserts the batch was refused with nothing changed. */
function assertRejected(commands, { code = 'INVALID_COMMAND', index, message, path } = {}) {
  const app = makeApp();
  const before = canonicalJson(app.doc);
  const result = apply(app, commands);
  assert.equal(result.success, false, `accepted: ${JSON.stringify(commands)}`);
  const [error] = result.errors;
  assert.equal(error.code, code);
  if (index !== undefined) assert.equal(error.commandIndex, index);
  if (message) assert.match(error.message, message);
  if (path) assert.equal(error.path, path);
  assert.equal(canonicalJson(app.doc), before, 'a refused batch changes nothing');
  return error;
}

// --- Regression: the claude.ai run -----------------------------------------

test('group_objects with a misspelled ids field is refused, not silently ignored (regression)', () => {
  // Exactly what Claude sent in the claude.ai test: objectIds instead of ids.
  assertRejected([
    rect('queue'), rect('worker'),
    { type: 'group_objects', objectIds: ['queue', 'worker'], groupId: 'backend', name: 'Backend' }
  ], { index: 2, message: /ids is required \(unknown field: objectIds\)/, path: 'commands[2].ids' });
});

test('unknown fields are refused at every level, with the path to the field', () => {
  assertRejected([rect('a'), { type: 'set_text', id: 'a', text: 'x', bogus: 1 }],
    { index: 1, message: /bogus/, path: 'commands[1].bogus' });
  assertRejected([rect('a', { colour: '#ff0000' })],
    { index: 0, message: /colour/, path: 'commands[0].object.colour' });
  assertRejected([rect('a'), { type: 'set_style', ids: ['a'], updates: { fillColor: '#fff' } }],
    { index: 1, message: /fillColor/, path: 'commands[1].updates.fillColor' });
});

test('missing required fields and wrong value types are refused', () => {
  assertRejected([rect('a'), { type: 'move_objects', ids: ['a'], dx: 10 }], { index: 1, message: /dy/ });
  assertRejected([rect('a'), { type: 'move_objects', ids: ['a'], dx: '10', dy: 0 }], { index: 1, message: /dx/ });
  assertRejected([rect('a'), { type: 'delete_objects', ids: [] }], { index: 1, message: /ids/ });
  assertRejected([rect('a'), { type: 'set_style', ids: ['a'], updates: { opacity: 2 } }], { index: 1, message: /opacity/ });
  assertRejected([rect('a', { width: 0 })], { index: 0, message: /width/ });
  assertRejected([rect('a'), { type: 'reorder_objects', ids: ['a'], action: 'sideways' }], { index: 1 });
});

test('group_objects needs at least two existing, unlocked objects (regression: was a silent no-op)', () => {
  // Earlier commands in the same batch count: a member deleted or locked first is not usable.
  assertRejected([rect('a'), rect('b'), { type: 'delete_objects', ids: ['b'] }, { type: 'group_objects', ids: ['a', 'b'], groupId: 'g' }], { index: 3, message: /not found: b/ });
  assertRejected([rect('a'), rect('b'), { type: 'lock_objects', ids: ['b'], locked: true }, { type: 'group_objects', ids: ['a', 'b'], groupId: 'g' }], { index: 3, message: /only 1/ });
  // delete_objects skips locked objects, so a locked member is reported as locked, not missing.
  assertRejected([rect('a'), rect('b', { locked: true }), { type: 'delete_objects', ids: ['b'] }, { type: 'group_objects', ids: ['a', 'b'], groupId: 'g' }], { index: 3, message: /only 1.*locked/ });
  assertRejected([rect('a'), { type: 'group_objects', ids: ['a'], groupId: 'g' }], { index: 1, message: /two/ });
  assertRejected([rect('a'), { type: 'group_objects', ids: ['a', 'missing'], groupId: 'g' }], { index: 1, message: /missing|two/ });
  assertRejected([rect('a'), rect('b', { locked: true }), { type: 'group_objects', ids: ['a', 'b'], groupId: 'g' }], { index: 2, message: /two|locked/ });
});

// --- Still accepted ---------------------------------------------------------

test('well-formed commands still apply, including ext: extension fields and objects created earlier in the batch', () => {
  const app = makeApp();
  const result = apply(app, [
    rect('a', { 'ext:acme:note': { any: 'thing' } }),
    rect('b'),
    { type: 'group_objects', ids: ['a', 'b'], groupId: 'g', name: 'Backend' },
    { type: 'connect_objects', connectorId: 'c', fromId: 'a', toId: 'b', toAnchor: { x: 0, y: 0.5 } },
    { type: 'set_style', ids: ['a'], updates: { fill: '#ffffff', opacity: 0.5 } }
  ]);
  assert.equal(result.success, true, JSON.stringify(result.errors));
  assert.equal(app.doc.groups.g.name, 'Backend');
  assert.equal(app.doc.objects.b.groupId, 'g');
  // Unlocking earlier in the batch makes a locked object groupable.
  const unlocked = apply(app, [rect('d', { locked: true }), rect('e'), { type: 'lock_objects', ids: ['d'], locked: false },
    { type: 'group_objects', ids: ['d', 'e'], groupId: 'g2' }]);
  assert.equal(unlocked.success, true, JSON.stringify(unlocked.errors));
});

test('a full default object (as the connector load path replays it) is accepted', () => {
  const app = makeApp();
  const object = createDefaultObject('rectangle', { id: 'full', x: 1, y: 2, width: 30, height: 40, text: 'hi' });
  const result = apply(app, [{ type: 'create_object', object }]);
  assert.equal(result.success, true, JSON.stringify(result.errors));
});

// --- The schema checker itself ----------------------------------------------

test('every published command schema uses only keywords the checker enforces', () => {
  const seen = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      seen.add(key);
      if (['properties', 'patternProperties'].includes(key)) Object.values(value).forEach(walk);
      else if (typeof value === 'object') walk(value);
    }
  };
  for (const type of AGENT_PUBLIC_COMMAND_TYPES) walk(AGENT_PUBLIC_COMMAND_SCHEMAS[type]);
  const unchecked = [...seen].filter((k) => !SUPPORTED_SCHEMA_KEYWORDS.has(k));
  assert.deepEqual(unchecked, [], 'a schema keyword the checker would silently ignore');
});

test('the checker refuses a schema keyword it does not implement instead of ignoring it', () => {
  assert.throws(() => checkJsonSchema('x', { type: 'string', pattern: '^a' }), /pattern/);
});

test('checker basics: types, type lists, prefixItems, uniqueItems, anyOf, oneOf', () => {
  const ok = (value, schema) => assert.deepEqual(checkJsonSchema(value, schema), [], JSON.stringify(value));
  const bad = (value, schema) => assert.notDeepEqual(checkJsonSchema(value, schema), [], JSON.stringify(value));
  ok(3, { type: 'integer' }); bad(3.5, { type: 'integer' }); bad(true, { type: 'number' }); bad(Number.NaN, { type: 'number' });
  ok(null, { type: ['string', 'null'] }); bad(1, { type: ['string', 'null'] });
  ok([1, 2], { type: 'array', prefixItems: [{ type: 'number' }, { type: 'number' }], minItems: 2, maxItems: 2 });
  bad([1, 'a'], { type: 'array', prefixItems: [{ type: 'number' }, { type: 'number' }] });
  bad(['a', 'a'], { type: 'array', uniqueItems: true });
  ok({ themeId: 'x' }, { anyOf: [{ required: ['themeId'] }, { required: ['theme'] }] });
  bad({}, { anyOf: [{ required: ['themeId'] }, { required: ['theme'] }] });
  bad({ a: 1 }, { oneOf: [{ type: 'object' }, { type: 'object' }] });
  bad([], { type: 'object' }); bad(null, { type: 'object' });
  ok(1, { exclusiveMinimum: 0 }); bad(0, { exclusiveMinimum: 0 });
  bad({}, { type: 'object', minProperties: 1 });
});
