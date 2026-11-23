// Opt-in visible group frames: group_objects { frame: true } draws a labelled
// frame around the group's members. Plain groups stay invisible.
import test from 'node:test';
import assert from 'node:assert/strict';

import { applyCommand, applyCommandBatch } from '../src/core/commands.js';
import { canonicalJson, createDefaultDocument, normalizeDocument, validateDocument } from '../src/core/document.js';
import { getUnionBoundingBox } from '../src/core/geometry.js';
import { joinSceneParts, renderSceneParts } from '../src/renderer/svg-renderer.js';
import { planScenePatch } from '../src/renderer/scene-patch.js';
import { AGENT_PUBLIC_COMMAND_SCHEMAS } from '../src/agent-api.js';

const rect = (id, x, y) => ({ type: 'create_object', object: { id, type: 'rectangle', x, y, width: 100, height: 60, text: id } });
function board(groupExtra = {}) {
  const doc = normalizeDocument(createDefaultDocument({ title: 't' }));
  return applyCommandBatch(doc, [rect('a', 0, 0), rect('b', 200, 0), rect('c', 0, 300),
    { type: 'group_objects', ids: ['a', 'b'], groupId: 'g', name: 'Backend <team>', ...groupExtra }]).doc;
}
const parts = (doc) => renderSceneParts(doc, { camera: { x: 0, y: 0, zoom: 1 }, selectedIds: [], showGrid: false });

test('group_objects with frame: true records it and the board stays valid', () => {
  const doc = board({ frame: true });
  assert.equal(doc.groups.g.frame, true);
  assert.equal(validateDocument(doc).valid, true);
  assert.ok(AGENT_PUBLIC_COMMAND_SCHEMAS.group_objects.properties.frame, 'agents can see the option');
});

test('a framed group draws one labelled frame around its members; plain groups draw none', () => {
  const framed = parts(board({ frame: true })).frames;
  assert.equal((framed.match(/class="group-frame"/g) || []).length, 1);
  assert.match(framed, /Backend &lt;team&gt;/, 'name is escaped');
  const doc = board({ frame: true });
  const box = getUnionBoundingBox([doc.objects.a, doc.objects.b], doc);
  const m = framed.match(/<rect[^>]*class="group-frame-box"[^>]*x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
  assert.ok(m, framed);
  const [x, y, w, h] = m.slice(1).map(Number);
  assert.ok(x < box.x && y < box.y && x + w > box.x + box.width && y + h > box.y + box.height, 'frame encloses the members');
  assert.equal(parts(board()).frames, '', 'plain group: no frame');
});

test('frames sit under the shapes in the canvas', () => {
  const svg = joinSceneParts(parts(board({ frame: true })));
  const frames = svg.indexOf('id="frames-layer"');
  assert.ok(frames >= 0, 'frames layer present');
  assert.ok(frames < svg.indexOf('id="objects-layer"'));
});

test('moving a member updates the frame without rebuilding the object layer', () => {
  const doc = board({ frame: true });
  const moved = applyCommand(doc, { type: 'move_objects', ids: ['a'], dx: -40, dy: 0 }).doc;
  const plan = planScenePatch(parts(doc), parts(moved));
  assert.equal(plan.full, false);
  assert.equal(plan.frames, true);
  assert.deepEqual(plan.objects.replace.map((i) => parts(moved).objects[i].id), ['a']);
});

test('ungroup then undo brings the frame back exactly', () => {
  const doc = board({ frame: true });
  const ungrouped = applyCommand(doc, { type: 'ungroup_objects', groupIds: ['g'] });
  assert.equal(parts(ungrouped.doc).frames, '');
  const undone = applyCommand(ungrouped.doc, ungrouped.inverseCmd);
  assert.equal(canonicalJson(undone.doc), canonicalJson(doc));
});

test('frame must be a boolean', () => {
  const doc = board({ frame: true });
  doc.groups.g.frame = 'yes';
  assert.equal(validateDocument(doc).valid, false);
});
