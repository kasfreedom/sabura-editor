// Connector text is drawn as an arrow label (regression: it was stored, listed
// to agents as a label, and never drawn).
import test from 'node:test';
import assert from 'node:assert/strict';

import { AgentApi } from '../src/agent-api.js';
import { SaburaApp } from '../src/main.js';
import { applyCommandBatch } from '../src/core/commands.js';
import { createDefaultDocument, normalizeDocument, validateDocument } from '../src/core/document.js';
import { getConnectorLabelPoint, resolveConnectorGeometry } from '../src/core/geometry.js';
import { renderSceneParts } from '../src/renderer/svg-renderer.js';

const rect = (id, x, y) => ({ type: 'create_object', object: { id, type: 'rectangle', x, y, width: 100, height: 60 } });
function board(connector) {
  let doc = normalizeDocument(createDefaultDocument({ title: 't' }));
  doc = applyCommandBatch(doc, [rect('a', 0, 0), rect('b', 400, 0), rect('c', 400, 300),
    { type: 'connect_objects', connectorId: 'k', fromId: 'a', toId: 'b', ...connector }]).doc;
  return doc;
}
const markupOf = (doc, id) => renderSceneParts(doc, { camera: { x: 0, y: 0, zoom: 1 }, selectedIds: [], showGrid: false })
  .objects.find((o) => o.id === id).markup;
const textAt = (markup) => {
  const m = markup.match(/<text[^>]*\sx="([-\d.]+)"[^>]*\sy="([-\d.]+)"/);
  return m && { x: Number(m[1]), y: Number(m[2]) };
};

test('connect_objects accepts a label and the arrow draws it at its middle', () => {
  const doc = board({ text: 'Yes' });
  assert.equal(validateDocument(doc).valid, true);
  assert.equal(doc.objects.k.text, 'Yes');
  const markup = markupOf(doc, 'k');
  assert.match(markup, /class="connector-label"/);
  assert.match(markup, />Yes</);
  const geom = resolveConnectorGeometry(doc, doc.objects.k);
  const mid = getConnectorLabelPoint(geom);
  assert.deepEqual(mid, { x: (geom.start.x + geom.end.x) / 2, y: (geom.start.y + geom.end.y) / 2 });
  const at = textAt(markup);
  assert.ok(Math.abs(at.x - mid.x) < 0.01, 'centred horizontally on the midpoint');
});

test('the label sits on a background patch so the line does not strike through it', () => {
  const markup = markupOf(board({ text: 'publish events' }), 'k');
  assert.match(markup, /<rect[^>]*class="connector-label-bg"/);
  assert.ok(markup.indexOf('connector-label-bg') < markup.indexOf('<text'), 'patch is under the text');
});

test('curved and elbow arrows put the label on their own midpoints', () => {
  const curved = board({ text: 'loop', routing: 'curved', curveDistance: 80 });
  const cg = resolveConnectorGeometry(curved, curved.objects.k);
  assert.deepEqual(getConnectorLabelPoint(cg), cg.curveMidpoint);
  const elbowDoc = normalizeDocument(createDefaultDocument({ title: 't' }));
  const elbow = applyCommandBatch(elbowDoc, [rect('a', 0, 0), rect('c', 400, 300),
    { type: 'connect_objects', connectorId: 'k', fromId: 'a', toId: 'c', routing: 'elbow', text: 'No' }]).doc;
  const eg = resolveConnectorGeometry(elbow, elbow.objects.k);
  assert.deepEqual(getConnectorLabelPoint(eg), eg.elbowMidpoint);
  assert.ok(Math.abs(textAt(markupOf(elbow, 'k')).x - eg.elbowMidpoint.x) < 0.01);
});

test('label text is escaped and multi-line labels keep their lines', () => {
  const markup = markupOf(board({ text: '<b>&</b>\nline 2' }), 'k');
  assert.doesNotMatch(markup, /<b>/);
  assert.match(markup, /&lt;b&gt;&amp;&lt;\/b&gt;/);
  assert.equal((markup.match(/<tspan/g) || []).length, 2);
});

test('arrows without text draw no label', () => {
  for (const text of [undefined, '', '   ']) {
    const markup = markupOf(board(text === undefined ? {} : { text }), 'k');
    assert.doesNotMatch(markup, /connector-label/, JSON.stringify(text));
  }
});

test('the agent can label an arrow when connecting, and relabel it with set_text', () => {
  const app = Object.create(SaburaApp.prototype);
  app.doc = createDefaultDocument({ id: 'labels', title: 'Labels' });
  Object.assign(app, { status: 'Clean', mode: 'editing', isCorrupted: false, inPresentation: false, isSaving: false,
    pendingImageReader: null, pendingImageDecode: null, undoStack: [], redoStack: [], subscribers: new Set() });
  app.updateUI = () => {};
  app.workspace = { selectedIds: [], activeGroupId: null, camera: { x: 0, y: 0, zoom: 1 },
    container: { getBoundingClientRect: () => ({ width: 900, height: 600 }) }, hasActiveInteraction: () => false };
  app.textEditor = { targetObject: null, textarea: { style: { display: 'none' } } };
  app.agentApi = new AgentApi(app);
  const apply = (id, commands) => app.agentApi.apply({ requestId: id, expectedEditToken: app.agentApi.editToken(), commands });
  const made = apply('l1', [rect('a', 0, 0), rect('b', 400, 0), { type: 'connect_objects', connectorId: 'k', fromId: 'a', toId: 'b', text: 'Yes' }]);
  assert.equal(made.success, true, JSON.stringify(made.errors));
  assert.equal(app.doc.objects.k.text, 'Yes');
  const renamed = apply('l2', [{ type: 'set_text', id: 'k', text: 'No' }]);
  assert.equal(renamed.success, true, JSON.stringify(renamed.errors));
  assert.equal(app.doc.objects.k.text, 'No');
});
