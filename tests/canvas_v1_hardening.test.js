import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultDocument,
  createDefaultObject,
  validateDocument,
  normalizeDocument,
  canonicalJson,
  cloneDocument
} from '../src/core/document.js';
import {
  packageHtmlWithDocument,
  extractDocumentFromHtml
} from '../src/storage/file-packer.js';
import { CANVAS_SCHEMA_VERSION, OBJECT_TYPES } from '../src/core/types.js';

test('valid empty and representative documents pass strict validation', () => {
  const emptyDoc = createDefaultDocument({ title: 'Empty Canvas' });
  const emptyVal = validateDocument(emptyDoc);
  assert.equal(emptyVal.valid, true, `Empty doc errors: ${emptyVal.errors.join(', ')}`);

  // Representative document with various objects
  const repDoc = createDefaultDocument({ title: 'Representative Board' });
  const r1 = createDefaultObject('rectangle', { id: 'r1', x: 50, y: 50, width: 120, height: 80, text: 'Box 1' });
  const e1 = createDefaultObject('ellipse', { id: 'e1', x: 250, y: 50, width: 100, height: 80, fill: '#ffec99' });
  const d1 = createDefaultObject('diamond', { id: 'd1', x: 450, y: 50, width: 100, height: 100 });
  const t1 = createDefaultObject('triangle', { id: 't1', x: 600, y: 50, width: 90, height: 90 });
  const txt1 = createDefaultObject('text', { id: 'txt1', x: 50, y: 200, text: 'Notes' });
  const p1 = createDefaultObject('path', { id: 'p1', x: 200, y: 200, points: [{ x: 0, y: 0 }, { x: 50, y: 30 }, { x: 100, y: 0 }] });
  const c1 = createDefaultObject('connector', {
    id: 'c1',
    from: { id: 'r1', anchor: { x: 1, y: 0.5 } },
    to: { id: 'e1', anchor: { x: 0, y: 0.5 } },
    routing: 'curved'
  });

  repDoc.objects = { r1, e1, d1, t1, txt1, p1, c1 };
  repDoc.order = ['r1', 'e1', 'd1', 't1', 'txt1', 'p1', 'c1'];

  const repVal = validateDocument(repDoc);
  assert.equal(repVal.valid, true, `Representative doc errors: ${repVal.errors.join(', ')}`);
});

test('every supported object type validates cleanly', () => {
  for (const type of OBJECT_TYPES) {
    const doc = createDefaultDocument();
    const obj = createDefaultObject(type, { id: `obj_${type}` });
    doc.objects[obj.id] = obj;
    doc.order = [obj.id];

    const val = validateDocument(doc);
    assert.equal(val.valid, true, `Type "${type}" failed validation: ${val.errors.join(', ')}`);
  }
});

test('unsupported object types are strictly rejected', () => {
  const doc = createDefaultDocument();
  const obj = createDefaultObject('rectangle', { id: 'star_1' });
  obj.type = 'star';
  doc.objects['star_1'] = obj;
  doc.order = ['star_1'];

  const val = validateDocument(doc);
  assert.equal(val.valid, false);
  assert.ok(val.errors.some(e => e.includes('Unsupported object type "star"')));
});

test('dangling connectors referencing non-existent objects are strictly rejected', () => {
  const doc = createDefaultDocument();
  const r1 = createDefaultObject('rectangle', { id: 'r1' });
  const c1 = createDefaultObject('connector', { id: 'c1', from: { id: 'r1' }, to: { id: 'missing_target' } });

  doc.objects = { r1, c1 };
  doc.order = ['r1', 'c1'];

  const val = validateDocument(doc);
  assert.equal(val.valid, false);
  assert.ok(val.errors.some(e => e.includes('references non-existent object ID: "missing_target"')));

  // Test missing from
  const c2 = createDefaultObject('connector', { id: 'c2', from: { id: 'missing_source' }, to: { id: 'r1' } });
  doc.objects = { r1, c2 };
  doc.order = ['r1', 'c2'];
  const val2 = validateDocument(doc);
  assert.equal(val2.valid, false);
  assert.ok(val2.errors.some(e => e.includes('references non-existent object ID: "missing_source"')));
});

test('malformed connector points, anchors, and routing are strictly rejected', () => {
  const doc = createDefaultDocument();
  const r1 = createDefaultObject('rectangle', { id: 'r1' });
  const r2 = createDefaultObject('rectangle', { id: 'r2' });

  // Out of bounds anchor (must be 0..1)
  const badAnchor = createDefaultObject('connector', {
    id: 'c1',
    from: { id: 'r1', anchor: { x: 1.5, y: 0.5 } },
    to: { id: 'r2' }
  });
  doc.objects = { r1, r2, c1: badAnchor };
  doc.order = ['r1', 'r2', 'c1'];
  assert.equal(validateDocument(doc).valid, false);

  // Negative anchor
  badAnchor.from.anchor = { x: -0.2, y: 0.5 };
  assert.equal(validateDocument(doc).valid, false);

  // Non-numeric point
  const badPoint = createDefaultObject('connector', {
    id: 'c2',
    from: { point: { x: 'invalid', y: 50 } },
    to: { id: 'r2' }
  });
  doc.objects = { r1, r2, c2: badPoint };
  doc.order = ['r1', 'r2', 'c2'];
  assert.equal(validateDocument(doc).valid, false);

  // Unsupported routing
  const badRouting = createDefaultObject('connector', {
    id: 'c3',
    from: { id: 'r1' },
    to: { id: 'r2' },
    routing: 'zigzag'
  });
  doc.objects = { r1, r2, c3: badRouting };
  doc.order = ['r1', 'r2', 'c3'];
  const valRouting = validateDocument(doc);
  assert.equal(valRouting.valid, false);
  assert.ok(valRouting.errors.some(e => e.includes('unsupported routing')));
});

test('invalid groups and missing groupId references are strictly rejected', () => {
  const doc = createDefaultDocument();
  const r1 = createDefaultObject('rectangle', { id: 'r1', groupId: 'group_non_existent' });
  doc.objects = { r1 };
  doc.order = ['r1'];

  const val = validateDocument(doc);
  assert.equal(val.valid, false);
  assert.ok(val.errors.some(e => e.includes('references non-existent groupId: "group_non_existent"')));

  // Group ID mismatch in groups record
  doc.groups = {
    group_1: { id: 'group_mismatch', name: 'Group 1' }
  };
  r1.groupId = 'group_1';
  const val2 = validateDocument(doc);
  assert.equal(val2.valid, false);
  assert.ok(val2.errors.some(e => e.includes('Group id mismatch')));
});

test('invalid and incomplete order arrays are strictly rejected', () => {
  const doc = createDefaultDocument();
  const r1 = createDefaultObject('rectangle', { id: 'r1' });
  const r2 = createDefaultObject('rectangle', { id: 'r2' });
  doc.objects = { r1, r2 };

  // 1. Order referencing non-existent object
  doc.order = ['r1', 'ghost_object', 'r2'];
  assert.equal(validateDocument(doc).valid, false);

  // 2. Duplicate order entries
  doc.order = ['r1', 'r2', 'r1'];
  assert.equal(validateDocument(doc).valid, false);

  // 3. Object in doc.objects missing from order
  doc.order = ['r1']; // r2 omitted
  const valIncomplete = validateDocument(doc);
  assert.equal(valIncomplete.valid, false);
  assert.ok(valIncomplete.errors.some(e => e.includes('missing from document order list')));
});

test('unknown unnamespaced properties are rejected to prevent hiding AI typos', () => {
  // Misspelled property on object
  const doc = createDefaultDocument();
  const r1 = createDefaultObject('rectangle', { id: 'r1' });
  r1.backgroundColor = '#ff0000'; // Typo for fill
  doc.objects = { r1 };
  doc.order = ['r1'];

  const valObj = validateDocument(doc);
  assert.equal(valObj.valid, false);
  assert.ok(valObj.errors.some(e => e.includes('Unknown unnamespaced property "backgroundColor"')));

  // Typo on document root
  delete r1.backgroundColor;
  doc.authorName = 'AI Agent';
  const valDoc = validateDocument(doc);
  assert.equal(valDoc.valid, false);
  assert.ok(valDoc.errors.some(e => e.includes('Unknown unnamespaced property "authorName" on document')));

  // Typo on theme
  delete doc.authorName;
  doc.theme.gridSpacing = 20;
  const valTheme = validateDocument(doc);
  assert.equal(valTheme.valid, false);
  assert.ok(valTheme.errors.some(e => e.includes('Unknown unnamespaced property "gridSpacing" on theme')));
});

test('ext:* properties are preserved and round-trip through load and save', () => {
  const doc = createDefaultDocument({ title: 'Extensions Test' });
  doc['ext:generation_prompt'] = 'Draw an architecture overview';
  doc.theme['ext:contrast_ratio'] = 4.5;

  const r1 = createDefaultObject('rectangle', {
    id: 'r1',
    x: 10,
    y: 20,
    width: 100,
    height: 60,
    text: 'Frontend'
  });
  r1['ext:component_type'] = 'client';
  r1['ext:confidence'] = 0.98;
  r1.textStyle['ext:line_height'] = 1.4;

  doc.groups['g1'] = { id: 'g1', name: 'UI Layer', 'ext:collapsed_by_default': false };
  r1.groupId = 'g1';

  doc.objects = { r1 };
  doc.order = ['r1'];

  // Strict validation MUST accept ext:* properties
  const val = validateDocument(doc);
  assert.equal(val.valid, true, `Extensions validation errors: ${val.errors.join(', ')}`);

  // Canonical serialization must preserve them
  const jsonStr = canonicalJson(doc);
  assert.ok(jsonStr.includes('"ext:generation_prompt"'));
  assert.ok(jsonStr.includes('"ext:component_type"'));
  assert.ok(jsonStr.includes('"ext:collapsed_by_default"'));

  // Package into HTML and extract back
  const htmlShell = '<!DOCTYPE html><html><head></head><body><div id="app"></div><script type="application/json" id="sabura-document">\n{}\n</script></body></html>';
  const pack = packageHtmlWithDocument(htmlShell, doc);
  assert.equal(pack.success, true);

  const extracted = extractDocumentFromHtml(pack.html);
  assert.equal(extracted.valid, true);
  assert.equal(extracted.document['ext:generation_prompt'], 'Draw an architecture overview');
  assert.equal(extracted.document.objects.r1['ext:component_type'], 'client');
  assert.equal(extracted.document.groups.g1['ext:collapsed_by_default'], false);
});

test('HTML injection strings are safely encoded as \\u003C and never executed', () => {
  const doc = createDefaultDocument({ title: 'Safety Test' });
  const maliciousText = '</script><ScRiPt>alert("XSS")</sCrIpt><img src=x onerror=alert(1)> & "quotes" \'apostrophe\' ❤ 日本語';
  const r1 = createDefaultObject('rectangle', {
    id: 'r1',
    x: 10,
    y: 10,
    width: 200,
    height: 100,
    text: maliciousText
  });
  doc.objects = { r1 };
  doc.order = ['r1'];

  const serialized = canonicalJson(doc);

  // Critical safety assertions:
  // 1. Literal '<' must NEVER exist in output
  assert.ok(!serialized.includes('<'), 'Output JSON must not contain literal "<"');
  // 2. Closing script tags in any casing must be broken by unicode escaping
  assert.ok(!serialized.toLowerCase().includes('</script>'), 'Output JSON must not contain closing script tag');
  // 3. Encoded \\u003C must be present
  assert.ok(serialized.includes('\\u003C'), 'Output JSON must encode "<" as "\\u003C"');

  // 4. Round-trip through HTML embedding
  const htmlShell = '<!DOCTYPE html><html><head></head><body><div id="app"></div><script type="application/json" id="sabura-document">\n{}\n</script></body></html>';
  const pack = packageHtmlWithDocument(htmlShell, doc);
  assert.equal(pack.success, true);

  // In the packaged HTML, within the script tag, there must be NO literal '</script>' that closes it early
  const extracted = extractDocumentFromHtml(pack.html);
  assert.equal(extracted.valid, true);
  assert.equal(extracted.document.objects.r1.text, maliciousText, 'Text must be extracted with 100% original fidelity');
});

test('deterministic serialization produces identical bytes regardless of key insertion order', () => {
  const docA = {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    title: 'Determinism',
    id: 'b1',
    theme: { palette: ['#000'], background: '#fff' },
    order: ['o1'],
    objects: {
      o1: {
        width: 100,
        height: 80,
        y: 20,
        x: 10,
        type: 'rectangle',
        id: 'o1',
        stroke: '#000'
      }
    },
    groups: {},
    assets: {}
  };

  const docB = {
    assets: {},
    groups: {},
    objects: {
      o1: {
        id: 'o1',
        stroke: '#000',
        type: 'rectangle',
        x: 10,
        height: 80,
        y: 20,
        width: 100
      }
    },
    order: ['o1'],
    theme: { background: '#fff', palette: ['#000'] },
    id: 'b1',
    title: 'Determinism',
    schemaVersion: CANVAS_SCHEMA_VERSION
  };

  assert.equal(canonicalJson(docA), canonicalJson(docB), 'Different object key orderings must serialize identically');
});

test('loading and saving an AI-modified HTML fixture round-trips cleanly', () => {
  // Simulate an AI opening a Sabura file, parsing the JSON seam, adding a new service box, and writing it back
  const baseDoc = createDefaultDocument({ title: 'AI Edited Board' });
  const clientBox = createDefaultObject('rectangle', { id: 'svc_client', x: 50, y: 50, width: 140, height: 80, text: 'Client App' });
  baseDoc.objects = { svc_client: clientBox };
  baseDoc.order = ['svc_client'];

  const baseHtml = `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
  <div id="app"></div>
  <script type="application/json" id="sabura-document">
${canonicalJson(baseDoc)}
  </script>
</body>
</html>`;

  // AI extracts document
  const extracted = extractDocumentFromHtml(baseHtml);
  assert.equal(extracted.valid, true);

  // AI performs edit: adds API Gateway, connects client to API Gateway
  const aiDoc = extracted.document;
  const apiGateway = createDefaultObject('rectangle', {
    id: 'svc_api',
    x: 280,
    y: 50,
    width: 140,
    height: 80,
    text: 'API Gateway',
    'ext:ai_summary': 'Added by AI agent to route traffic'
  });
  const conn = createDefaultObject('connector', {
    id: 'conn_client_api',
    from: { id: 'svc_client', anchor: { x: 1, y: 0.5 } },
    to: { id: 'svc_api', anchor: { x: 0, y: 0.5 } },
    routing: 'straight',
    endArrow: true
  });

  aiDoc.objects['svc_api'] = apiGateway;
  aiDoc.objects['conn_client_api'] = conn;
  aiDoc.order.push('svc_api', 'conn_client_api');

  // Repackage modified document into HTML
  const aiPacked = packageHtmlWithDocument(baseHtml, aiDoc);
  assert.equal(aiPacked.success, true);

  // Re-open saved HTML and verify all AI changes persisted accurately
  const reloaded = extractDocumentFromHtml(aiPacked.html);
  assert.equal(reloaded.valid, true);
  assert.equal(Object.keys(reloaded.document.objects).length, 3);
  assert.equal(reloaded.document.objects.svc_api['ext:ai_summary'], 'Added by AI agent to route traffic');
  assert.equal(reloaded.document.objects.conn_client_api.from.id, 'svc_client');
  assert.equal(reloaded.document.objects.conn_client_api.to.id, 'svc_api');
  assert.deepEqual(reloaded.document.order, ['svc_client', 'svc_api', 'conn_client_api']);
});
