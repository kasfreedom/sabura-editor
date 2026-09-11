import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDocumentFromHtml } from '../src/storage/file-packer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('sabura.html build integrity and self-contained verification', () => {
  const htmlPath = path.join(rootDir, 'sabura.html');
  assert.ok(fs.existsSync(htmlPath), 'sabura.html must exist');

  const content = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(content.startsWith('<!DOCTYPE html>'));
  assert.ok(content.includes('<script type="application/json" id="sabura-document">'));
  assert.ok(content.includes('<style id="sabura-runtime-style">'));
  assert.ok(content.includes('<script id="sabura-runtime-script">'));
  assert.ok(content.includes('SaburaApp'));
  assert.ok(content.includes('id="sabura-vs-sprite"'), 'visual-system sprite must be embedded exactly once');
  assert.equal((content.match(/<svg id="sabura-vs-sprite"/g) || []).length, 1);
  assert.ok(content.includes('id="sabura-vs-icon-edit"'));
  assert.ok(content.includes('id="sabura-vs-app-icon"'));
  assert.doesNotMatch(content, /id="icon-(?:edit|view|wheel)"/, 'generic package icon IDs must be namespaced');
  assert.doesNotMatch(content, /class="(?:line|ghost)"/, 'generic package SVG classes must be namespaced');

  // Informational links are allowed, but the offline runtime must not acquire
  // any other external URL or network-loaded script, style, font, or image.
  const matches = content.match(/https?:\/\/[^"'\s]+/g) || [];
  const allowedLinks = new Set(['https://kasfreedom.github.io/sabura-editor/']);
  const unexpectedUrls = matches.filter(url => !allowedLinks.has(url));
  assert.deepEqual(unexpectedUrls, [], `Unexpected external URLs in offline bundle: ${unexpectedUrls.join(', ')}`);
  assert.doesNotMatch(content, /<(?:script|img)[^>]+src=["']https?:\/\//i);
  assert.doesNotMatch(content, /<link[^>]+href=["']https?:\/\//i);

  // Extract embedded document
  const extracted = extractDocumentFromHtml(content);
  assert.equal(extracted.valid, true, `Document seam validation errors: ${extracted.errors.join(', ')}`);
  assert.equal(extracted.document.schemaVersion, 'sabura/canvas/v1');
  assert.equal(extracted.document.id, 'board_welcome', 'bundled sample board ID must be reproducible');
  assert.deepEqual(
    extracted.document.order.map(id => extracted.document.objects[id].seed),
    [101, 102, 103, 104],
    'bundled sample sketch seeds must be reproducible'
  );
  assert.ok(Object.keys(extracted.document.objects).length > 0);
});
