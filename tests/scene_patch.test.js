import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDocument, createDefaultObject } from '../src/core/document.js';
import { applyCommand } from '../src/core/commands.js';
import { renderSceneParts, renderSvgScene, joinSceneParts } from '../src/renderer/svg-renderer.js';
import { planScenePatch } from '../src/renderer/scene-patch.js';

function board() {
  const doc = createDefaultDocument({ title: 'Patch' });
  const add = (obj) => { doc.objects[obj.id] = obj; doc.order.push(obj.id); };
  add(createDefaultObject('rectangle', { id: 'a', x: 0, y: 0, width: 120, height: 80, text: 'A' }));
  add(createDefaultObject('ellipse', { id: 'b', x: 240, y: 0, width: 120, height: 80, text: 'B' }));
  add(createDefaultObject('rectangle', { id: 'c', x: 0, y: 200, width: 120, height: 80 }));
  add(createDefaultObject('connector', { id: 'k', from: { id: 'a' }, to: { id: 'b' } }));
  return doc;
}

const camera = (x = 0, y = 0, zoom = 1) => ({ x, y, zoom });
const parts = (doc, runtime = {}) => renderSceneParts(doc, { camera: camera(), selectedIds: [], showGrid: true, ...runtime });

test('joining scene parts reproduces the full scene render', () => {
  const doc = board();
  const runtime = { camera: camera(10, 20, 1.5), selectedIds: ['a'], showGrid: true, marquee: { startX: 0, startY: 0, currentX: 5, currentY: 5 } };
  assert.equal(joinSceneParts(renderSceneParts(doc, runtime)), renderSvgScene(doc, runtime));
});

test('every object renders as exactly one top-level element with its data-id', () => {
  const { objects } = parts(board(), { selectedIds: ['a', 'k'] });
  for (const { id, markup } of objects) {
    assert.match(markup.trimStart(), new RegExp(`^<g id="elem-[^"]*" data-id="${id}"`));
    assert.ok(markup.trimEnd().endsWith('</g>'), id);
  }
});

test('first render and backdrop changes need a full render', () => {
  const doc = board();
  assert.deepEqual(planScenePatch(null, parts(doc)), { full: true });
  assert.equal(planScenePatch(parts(doc), parts(doc, { showGrid: false })).full, true);
  const night = applyCommand(doc, { type: 'set_board_theme', themeId: 'night' }).doc;
  assert.equal(planScenePatch(parts(doc), parts(night)).full, true);
});

test('an identical frame changes nothing', () => {
  const doc = board();
  const plan = planScenePatch(parts(doc), parts(doc));
  assert.deepEqual(plan, { full: false, defs: false, transform: false, frames: false, overlay: false, objects: { rebuild: false, replace: [] } });
});

test('panning and zooming touch only the transform and grid, never objects', () => {
  const doc = board();
  const pan = planScenePatch(parts(doc), parts(doc, { camera: camera(37, -12) }));
  assert.equal(pan.transform, true);
  assert.equal(pan.defs, true, 'the grid pattern follows the camera');
  assert.deepEqual(pan.objects, { rebuild: false, replace: [] });

  const zoom = planScenePatch(parts(doc), parts(doc, { camera: camera(0, 0, 2) }));
  assert.equal(zoom.transform, true);
  assert.deepEqual(zoom.objects, { rebuild: false, replace: [] });
});

test('moving a shape replaces only that shape and the connector that follows it', () => {
  const doc = board();
  const moved = applyCommand(doc, { type: 'move_objects', ids: ['a'], dx: 30, dy: 10 }).doc;
  const before = parts(doc);
  const after = parts(moved);
  const plan = planScenePatch(before, after);
  assert.equal(plan.full, false);
  assert.deepEqual(plan.objects.replace.map((i) => after.objects[i].id).sort(), ['a', 'k']);
});

test('selection changes replace the selected object and redraw the overlay', () => {
  const doc = board();
  const plan = planScenePatch(parts(doc), parts(doc, { selectedIds: ['c'] }));
  assert.equal(plan.overlay, true);
  assert.equal(plan.objects.rebuild, false);
});

test('changing paint order or object membership rebuilds the object layer', () => {
  const doc = board();
  const reordered = applyCommand(doc, { type: 'reorder_objects', ids: ['a'], action: 'front' }).doc;
  assert.deepEqual(planScenePatch(parts(doc), parts(reordered)).objects, { rebuild: true });
  const deleted = applyCommand(doc, { type: 'delete_objects', ids: ['c'] }).doc;
  assert.deepEqual(planScenePatch(parts(doc), parts(deleted)).objects, { rebuild: true });
});

test('changing most objects at once rebuilds instead of patching one by one', () => {
  const doc = createDefaultDocument({ title: 'Many' });
  for (let i = 0; i < 100; i++) {
    const obj = createDefaultObject('rectangle', { id: `r${i}`, x: i * 10, y: 0, width: 20, height: 20 });
    doc.objects[obj.id] = obj; doc.order.push(obj.id);
  }
  const ids = doc.order.slice(0, 80);
  const moved = applyCommand(doc, { type: 'move_objects', ids, dx: 5, dy: 5 }).doc;
  assert.deepEqual(planScenePatch(parts(doc), parts(moved)).objects, { rebuild: true });
});

// --- Render coalescing ------------------------------------------------------

test('renders during pointer moves and wheel coalesce to one per frame; other renders stay synchronous', async () => {
  const { Workspace } = await import('../src/ui/workspace.js');
  const frames = new Map();
  let nextFrame = 1;
  globalThis.requestAnimationFrame = (fn) => { const id = nextFrame++; frames.set(id, fn); return id; };
  globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
  try {
    const ws = Object.create(Workspace.prototype);
    ws.hotInputDepth = 0;
    ws.pendingFrame = null;
    let drawn = 0;
    ws.renderNow = () => { drawn++; };

    // Three events inside one frame: nothing drawn yet, one frame scheduled.
    for (let i = 0; i < 3; i++) ws.runHotInput(function () { this.render(); this.render(); });
    assert.equal(drawn, 0);
    assert.equal(frames.size, 1);

    // The frame draws once.
    for (const [id, fn] of [...frames]) { frames.delete(id); fn(); }
    assert.equal(drawn, 1);
    assert.equal(ws.pendingFrame, null);

    // A synchronous render (pointerup, command, mode switch) draws now and
    // cancels the pending frame so it never draws stale state afterwards.
    ws.runHotInput(function () { this.render(); });
    assert.equal(frames.size, 1);
    ws.render();
    assert.equal(drawn, 2);
    assert.equal(frames.size, 0);

    // A throwing handler still leaves later renders synchronous.
    assert.throws(() => ws.runHotInput(() => { throw new Error('boom'); }), /boom/);
    ws.render();
    assert.equal(drawn, 3);
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});

test('without requestAnimationFrame (Node, tests) every render is synchronous', async () => {
  const { Workspace } = await import('../src/ui/workspace.js');
  const ws = Object.create(Workspace.prototype);
  ws.hotInputDepth = 0;
  ws.pendingFrame = null;
  let drawn = 0;
  ws.renderNow = () => { drawn++; };
  ws.runHotInput(function () { this.render(); });
  assert.equal(drawn, 1);
});
