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
import { minifyJs } from '../scripts/build.js';

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

test('omitted seed normalization is deterministic across multiple loads', () => {
  const doc = createDefaultDocument({ title: 'Deterministic Seeds' });
  doc.objects = {
    box1: { id: 'box1', type: 'rectangle', x: 10, y: 10, width: 100, height: 60 },
    conn1: { id: 'conn1', type: 'connector', from: { id: 'box1' }, to: { point: { x: 200, y: 200 } } },
    path1: { id: 'path1', type: 'path', x: 0, y: 0, width: 50, height: 50, points: [{ x: 0, y: 0 }, { x: 50, y: 50 }] }
  };
  doc.order = ['box1', 'conn1', 'path1'];

  const norm1 = normalizeDocument(cloneDocument(doc));
  const norm2 = normalizeDocument(cloneDocument(doc));

  assert.equal(norm1.objects.box1.seed, norm2.objects.box1.seed);
  assert.equal(norm1.objects.conn1.seed, norm2.objects.conn1.seed);
  assert.equal(norm1.objects.path1.seed, norm2.objects.path1.seed);
  assert.equal(canonicalJson(norm1), canonicalJson(norm2));
});

test('nested connector endpoints strictly validate allowed properties and reject combinations', () => {
  const doc = createDefaultDocument();
  const r1 = createDefaultObject('rectangle', { id: 'r1' });
  const r2 = createDefaultObject('rectangle', { id: 'r2' });
  doc.objects = { r1, r2 };
  doc.order = ['r1', 'r2'];

  // 1. Simultaneous id and point
  const badBoth = createDefaultObject('connector', {
    id: 'c_both',
    from: { id: 'r1', point: { x: 10, y: 10 } },
    to: { id: 'r2' }
  });
  doc.objects.c_both = badBoth;
  doc.order.push('c_both');
  const valBoth = validateDocument(doc);
  assert.equal(valBoth.valid, false);
  assert.ok(valBoth.errors.some(e => e.includes('cannot contain both "id" and "point"')));

  // 2. Neither id nor point
  delete doc.objects.c_both;
  doc.order.pop();
  const badNeither = createDefaultObject('connector', {
    id: 'c_neither',
    from: { anchor: { x: 0.5, y: 0.5 } },
    to: { id: 'r2' }
  });
  doc.objects.c_neither = badNeither;
  doc.order.push('c_neither');
  const valNeither = validateDocument(doc);
  assert.equal(valNeither.valid, false);
  assert.ok(valNeither.errors.some(e => e.includes('must contain either "id"')));

  // 3. Unknown unnamespaced property on endpoint
  delete doc.objects.c_neither;
  doc.order.pop();
  const badEndpointProp = createDefaultObject('connector', {
    id: 'c_bad_prop',
    from: { id: 'r1', unknownEndpointField: 123 },
    to: { id: 'r2' }
  });
  doc.objects.c_bad_prop = badEndpointProp;
  doc.order.push('c_bad_prop');
  const valEndProp = validateDocument(doc);
  assert.equal(valEndProp.valid, false);
  assert.ok(valEndProp.errors.some(e => e.includes('Unknown unnamespaced property "unknownEndpointField"')));

  // 4. Unknown unnamespaced property on anchor
  delete doc.objects.c_bad_prop;
  doc.order.pop();
  const badAnchorProp = createDefaultObject('connector', {
    id: 'c_bad_anchor',
    from: { id: 'r1', anchor: { x: 0.5, y: 0.5, z: 0 } },
    to: { id: 'r2' }
  });
  doc.objects.c_bad_anchor = badAnchorProp;
  doc.order.push('c_bad_anchor');
  const valAnchorProp = validateDocument(doc);
  assert.equal(valAnchorProp.valid, false);
  assert.ok(valAnchorProp.errors.some(e => e.includes('Unknown unnamespaced property "z"')));

  // 5. Unknown unnamespaced property on point
  delete doc.objects.c_bad_anchor;
  doc.order.pop();
  const badPointProp = createDefaultObject('connector', {
    id: 'c_bad_point',
    from: { id: 'r1' },
    to: { point: { x: 100, y: 100, color: 'red' } }
  });
  doc.objects.c_bad_point = badPointProp;
  doc.order.push('c_bad_point');
  const valPointProp = validateDocument(doc);
  assert.equal(valPointProp.valid, false);
  assert.ok(valPointProp.errors.some(e => e.includes('Unknown unnamespaced property "color"')));

  // 6. ext:* on endpoint, anchor, and point are accepted and preserved
  delete doc.objects.c_bad_point;
  doc.order.pop();
  const validExtConn = createDefaultObject('connector', {
    id: 'c_ext',
    from: {
      id: 'r1',
      anchor: { x: 0.5, y: 0.5, 'ext:anchor_mode': 'snap' },
      'ext:port_id': 'out_1'
    },
    to: {
      point: { x: 200, y: 150, 'ext:guide': true },
      'ext:port_id': 'in_free'
    }
  });
  doc.objects.c_ext = validExtConn;
  doc.order.push('c_ext');
  const valExt = validateDocument(doc);
  assert.equal(valExt.valid, true, `Expected valid ext connector: ${valExt.errors.join(', ')}`);
});

test('minimal valid theme normalizes safely and allows creating new rectangle', () => {
  const minimalDoc = {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    id: 'board_minimal',
    title: 'Minimal Theme Board',
    theme: {
      background: '#222222',
      palette: ['#ffffff', '#ff0000']
    },
    objects: {},
    order: [],
    groups: {},
    assets: {}
  };

  const validationInitial = validateDocument(minimalDoc);
  assert.equal(validationInitial.valid, true, `Minimal doc must be valid: ${validationInitial.errors.join(', ')}`);

  const normalizedDoc = normalizeDocument(cloneDocument(minimalDoc));
  assert.equal(normalizedDoc.theme.defaultStroke, '#1e1e1e');
  assert.equal(normalizedDoc.theme.defaultFill, 'none');

  // Create new rectangle with the theme
  const newRect = createDefaultObject('rectangle', { x: 40, y: 40, width: 120, height: 80 }, normalizedDoc.theme);
  assert.equal(typeof newRect.stroke, 'string');
  assert.equal(typeof newRect.fill, 'string');
  assert.equal(typeof newRect.strokeWidth, 'number');

  normalizedDoc.objects[newRect.id] = newRect;
  normalizedDoc.order.push(newRect.id);

  const finalVal = validateDocument(normalizedDoc);
  assert.equal(finalVal.valid, true, `Document after adding rectangle must be valid: ${finalVal.errors.join(', ')}`);
});

test('missing or empty sabura-document seam is treated as corrupted', () => {
  // 1. Missing seam in HTML
  const missingHtml = '<!DOCTYPE html><html><body><div id="app"></div></body></html>';
  const extractMissing = extractDocumentFromHtml(missingHtml);
  assert.equal(extractMissing.valid, false);
  assert.ok(extractMissing.errors.some(e => e.includes('No <script id="sabura-document"> tag found')));

  // 2. Empty seam in HTML
  const emptyHtml = '<!DOCTYPE html><html><body><script type="application/json" id="sabura-document"></script></body></html>';
  const extractEmpty = extractDocumentFromHtml(emptyHtml);
  assert.equal(extractEmpty.valid, false);
  assert.ok(extractEmpty.errors.some(e => e.includes('seam is empty')));

  // 3. Whitespace-only seam in HTML
  const whitespaceHtml = '<!DOCTYPE html><html><body><script type="application/json" id="sabura-document">   \n\t  </script></body></html>';
  const extractWhitespace = extractDocumentFromHtml(whitespaceHtml);
  assert.equal(extractWhitespace.valid, false);
  assert.ok(extractWhitespace.errors.some(e => e.includes('seam is empty')));
});

test('minifyJs parses and preserves tricky regex and division ambiguities safely', async () => {
  const sampleCode = `
    const enabled = true;
    const value = '/*';
    let matched = false;
    if (enabled) /[/*]/.test(value); matched = /[/*]/.test(value);
    const quotient = 100 / 2 / 5;
    const regexInGroup = (/test\\/pattern/i).test('test/pattern');
    const complexExpr = (10 / 2) + (20 / 4);
    /* Multi-line comment to strip */
    // Line comment to strip
    globalThis.__testMinifyResult = { matched, quotient, regexInGroup, complexExpr };
  `;

  const minified = await minifyJs(sampleCode);

  assert.ok(!minified.includes('Multi-line comment to strip'));
  assert.ok(!minified.includes('Line comment to strip'));

  // The generated bundle must parse and execute correctly
  delete globalThis.__testMinifyResult;
  const fn = new Function(minified);
  fn();
  assert.equal(globalThis.__testMinifyResult.matched, true);
  assert.equal(globalThis.__testMinifyResult.quotient, 10);
  assert.equal(globalThis.__testMinifyResult.regexInGroup, true);
  assert.equal(globalThis.__testMinifyResult.complexExpr, 10);
  delete globalThis.__testMinifyResult;
});

test('table-driven validation rejects invalid theme and object values rather than silently normalizing', () => {
  // Theme invalid cases
  const themeCases = [
    { name: 'theme.id is non-string', patch: { id: 123 }, expectError: 'Theme id must be a string' },
    { name: 'theme.name is non-string', patch: { name: false }, expectError: 'Theme name must be a string' },
    { name: 'theme.background is empty string', patch: { background: '' }, expectError: 'Theme background must be a valid non-empty string' },
    { name: 'theme.background is non-string', patch: { background: 42 }, expectError: 'Theme background must be a valid non-empty string' },
    { name: 'theme.gridColor is non-string', patch: { gridColor: true }, expectError: 'Theme gridColor must be a string' },
    { name: 'theme.defaultFill is non-string', patch: { defaultFill: 123 }, expectError: 'Theme defaultFill must be a string' },
    { name: 'theme.defaultStroke is non-string', patch: { defaultStroke: null }, expectError: 'Theme defaultStroke must be a string' },
    { name: 'theme.palette is empty array', patch: { palette: [] }, expectError: 'Theme palette must be a non-empty array' },
    { name: 'theme.palette contains non-string', patch: { palette: ['#000', 123] }, expectError: 'Theme palette entry at index 1 must be a string' },
    { name: 'theme.defaultStrokeWidth is negative', patch: { defaultStrokeWidth: -1 }, expectError: 'Theme defaultStrokeWidth must be a finite non-negative number' },
    { name: 'theme.defaultStrokeWidth is NaN', patch: { defaultStrokeWidth: NaN }, expectError: 'Theme defaultStrokeWidth must be a finite non-negative number' },
    { name: 'theme.defaultOpacity is negative', patch: { defaultOpacity: -0.1 }, expectError: 'Theme defaultOpacity must be a finite number from 0 through 1' },
    { name: 'theme.defaultOpacity is > 1', patch: { defaultOpacity: 1.5 }, expectError: 'Theme defaultOpacity must be a finite number from 0 through 1' },
    { name: 'theme.defaultRoughness is negative', patch: { defaultRoughness: -1 }, expectError: 'Theme defaultRoughness must be a finite non-negative number' },
    { name: 'theme.defaultFontSize is invalid', patch: { defaultFontSize: 'huge' }, expectError: 'Theme defaultFontSize must be one of: s, m, l, xl' },
    { name: 'theme.defaultFontFamily is invalid', patch: { defaultFontFamily: 'comic' }, expectError: 'Theme defaultFontFamily must be one of: sans, serif, mono, hand' }
  ];

  for (const tc of themeCases) {
    const doc = createDefaultDocument();
    Object.assign(doc.theme, tc.patch);
    const val = validateDocument(doc);
    assert.equal(val.valid, false, `Expected failure for ${tc.name}`);
    assert.ok(val.errors.some(e => e.includes(tc.expectError)), `Expected error containing "${tc.expectError}" for ${tc.name}, got: ${val.errors.join('; ')}`);
  }

  // Object invalid cases
  const objectCases = [
    { name: 'fill is non-string', patch: { fill: 123 }, expectError: 'fill must be a string' },
    { name: 'seed is zero', patch: { seed: 0 }, expectError: 'seed must be a positive integer' },
    { name: 'seed is negative', patch: { seed: -10 }, expectError: 'seed must be a positive integer' },
    { name: 'seed is non-integer float', patch: { seed: 3.14 }, expectError: 'seed must be a positive integer' },
    { name: 'seed is non-number', patch: { seed: 'seed1' }, expectError: 'seed must be a positive integer' },
    { name: 'seed exceeds 31-bit integer range', patch: { seed: 2147483648 }, expectError: 'seed must be a positive integer' },
    { name: 'autoWidth is non-boolean', patch: { autoWidth: 'true' }, expectError: 'autoWidth must be a boolean' },
    { name: 'autoHeight is non-boolean', patch: { autoHeight: 1 }, expectError: 'autoHeight must be a boolean' },
    { name: 'stroke is non-string', patch: { stroke: 123 }, expectError: 'stroke must be a string' },
    { name: 'strokeWidth is negative', patch: { strokeWidth: -1 }, expectError: 'strokeWidth must be a finite non-negative number' },
    { name: 'strokeStyle is invalid', patch: { strokeStyle: 'wavy' }, expectError: 'strokeStyle must be one of' },
    { name: 'opacity is < 0', patch: { opacity: -0.2 }, expectError: 'opacity must be a finite number between 0 and 1' },
    { name: 'opacity is > 1', patch: { opacity: 1.2 }, expectError: 'opacity must be a finite number between 0 and 1' },
    { name: 'roughness is negative', patch: { roughness: -0.5 }, expectError: 'roughness must be a finite non-negative number' },
    { name: 'rotation is NaN', patch: { rotation: NaN }, expectError: 'rotation must be a finite number' },
    { name: 'locked is non-boolean', patch: { locked: 'false' }, expectError: 'locked must be a boolean' },
    { name: 'text is non-string', patch: { text: 123 }, expectError: 'text must be a string' },
    { name: 'textStyle.size is invalid', patch: { textStyle: { size: 'huge' } }, expectError: 'textStyle.size must be one of' },
    { name: 'textStyle.resolvedSize is 0', patch: { textStyle: { resolvedSize: 0 } }, expectError: 'textStyle.resolvedSize must be a finite positive number' },
    { name: 'textStyle.bold is non-boolean', patch: { textStyle: { bold: 'yes' } }, expectError: 'textStyle.bold must be a boolean' },
    { name: 'textStyle.align is invalid', patch: { textStyle: { align: 'justify' } }, expectError: 'textStyle.align must be one of' },
    { name: 'textStyle.fontFamily is invalid', patch: { textStyle: { fontFamily: 'arial' } }, expectError: 'textStyle.fontFamily must be one of' },
    { name: 'textStyle.color is non-string', patch: { textStyle: { color: 42 } }, expectError: 'textStyle.color must be a string' },
    { name: 'x is NaN', patch: { x: NaN }, expectError: 'coordinates (x, y) must be finite numbers' },
    { name: 'width is 0', patch: { width: 0 }, expectError: 'width must be a finite positive number' },
    { name: 'height is negative', patch: { height: -20 }, expectError: 'height must be a finite positive number' }
  ];

  for (const tc of objectCases) {
    const doc = createDefaultDocument();
    const rect = createDefaultObject('rectangle', { id: 'test_obj' });
    Object.assign(rect, tc.patch);
    doc.objects = { test_obj: rect };
    doc.order = ['test_obj'];
    const val = validateDocument(doc);
    assert.equal(val.valid, false, `Expected failure for ${tc.name}`);
    assert.ok(val.errors.some(e => e.includes(tc.expectError)), `Expected error containing "${tc.expectError}" for ${tc.name}, got: ${val.errors.join('; ')}`);
  }

  // Path point unknown unnamespaced properties
  const docPath = createDefaultDocument();
  const pathObj = createDefaultObject('path', {
    id: 'p1',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10, invalidPointProp: 'bad' }
    ]
  });
  docPath.objects = { p1: pathObj };
  docPath.order = ['p1'];
  const valPath = validateDocument(docPath);
  assert.equal(valPath.valid, false);
  assert.ok(valPath.errors.some(e => e.includes('Unknown unnamespaced property "invalidPointProp"')));

  // Connector endpoints invalid range/value
  const docConn = createDefaultDocument();
  const r1 = createDefaultObject('rectangle', { id: 'r1' });
  const r2 = createDefaultObject('rectangle', { id: 'r2' });
  const connBadAnchor = createDefaultObject('connector', {
    id: 'c1',
    from: { id: 'r1', anchor: { x: -0.1, y: 0.5 } },
    to: { id: 'r2' }
  });
  docConn.objects = { r1, r2, c1: connBadAnchor };
  docConn.order = ['r1', 'r2', 'c1'];
  const valConn = validateDocument(docConn);
  assert.equal(valConn.valid, false);
  assert.ok(valConn.errors.some(e => e.includes('must be normalized between 0 and 1')));
});
