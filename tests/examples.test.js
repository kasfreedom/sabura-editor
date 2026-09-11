import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractDocumentFromHtml } from '../src/storage/file-packer.js';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');

function ownedFragment(html, tag, id) {
  const openingTag = `<${tag} id="${id}">`;
  const start = html.indexOf(openingTag);
  const end = html.indexOf(`</${tag}>`, start);
  assert.notEqual(start, -1, `Missing ${id}`);
  assert.notEqual(end, -1, `Missing closing ${tag} for ${id}`);
  return html.slice(start + openingTag.length, end);
}

test('Knowledge Graphs example is valid and uses the current Sabura runtime', () => {
  const editorHtml = fs.readFileSync(path.join(rootDir, 'sabura.html'), 'utf8');
  const exampleHtml = fs.readFileSync(path.join(rootDir, 'examples', 'knowledge-graphs.html'), 'utf8');
  const extracted = extractDocumentFromHtml(exampleHtml);

  assert.equal(extracted.valid, true, extracted.errors.join(', '));
  assert.equal(extracted.document.title, 'Knowledge graphs — from scattered facts to connected understanding');
  assert.ok(Object.keys(extracted.document.objects).length > 500);
  assert.ok(Object.values(extracted.document.objects).some(object => object.type === 'connector'));
  assert.equal(
    ownedFragment(exampleHtml, 'style', 'sabura-runtime-style'),
    ownedFragment(editorHtml, 'style', 'sabura-runtime-style')
  );
  assert.equal(
    ownedFragment(exampleHtml, 'script', 'sabura-runtime-script'),
    ownedFragment(editorHtml, 'script', 'sabura-runtime-script')
  );
});
