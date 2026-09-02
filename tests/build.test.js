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
  assert.ok(content.includes('SaburaApp'));

  // Ensure zero external network URLs or CDNs
  const matches = content.match(/https?:\/\/[^"'\s]+/g) || [];
  assert.deepEqual(matches, [], `Expected 0 external URLs in offline bundle, found: ${matches.join(', ')}`);

  // Extract embedded document
  const extracted = extractDocumentFromHtml(content);
  assert.equal(extracted.valid, true, `Document seam validation errors: ${extracted.errors.join(', ')}`);
  assert.equal(extracted.document.schemaVersion, 'sabura/canvas/v1');
  assert.ok(Object.keys(extracted.document.objects).length > 0);
});
