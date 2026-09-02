import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDocument, createDefaultObject } from '../src/core/document.js';
import { extractDocumentFromHtml, packageHtmlWithDocument } from '../src/storage/file-packer.js';

test('file-packer replaces seam and round-trips correctly', () => {
  const baseHtml = `<!DOCTYPE html>
<html>
<head><title>Sabura</title></head>
<body>
<div id="app"></div>
<script type="application/json" id="sabura-document">
{
  "dummy": true
}
</script>
<script>console.log("app shell");</script>
</body>
</html>`;

  const doc = createDefaultDocument({ title: 'My Saved Board' });
  const rect = createDefaultObject('rectangle', { id: 'r1', text: 'Preserved Shape' });
  doc.objects['r1'] = rect;
  doc.order = ['r1'];

  const packResult = packageHtmlWithDocument(baseHtml, doc);
  assert.equal(packResult.success, true);
  assert.ok(packResult.html.includes('id="sabura-document"'));
  assert.ok(packResult.html.includes('Preserved Shape'));
  assert.ok(packResult.html.includes('<script>console.log("app shell");</script>'));

  // Extract from packaged HTML
  const extractResult = extractDocumentFromHtml(packResult.html);
  assert.equal(extractResult.valid, true);
  assert.equal(extractResult.document.title, 'My Saved Board');
  assert.equal(extractResult.document.objects['r1'].text, 'Preserved Shape');
});

test('file-packer handles special characters and quotes safely', () => {
  const baseHtml = `<script type="application/json" id="sabura-document">{}</script>`;
  const doc = createDefaultDocument({ title: 'Quote "Test" & <script>' });
  const rect = createDefaultObject('rectangle', { id: 'r1', text: '</script><div class="danger">alert</div>' });
  doc.objects['r1'] = rect;
  doc.order = ['r1'];

  const packResult = packageHtmlWithDocument(baseHtml, doc);
  assert.equal(packResult.success, true);

  const extractResult = extractDocumentFromHtml(packResult.html);
  assert.equal(extractResult.valid, true);
  assert.equal(extractResult.document.objects['r1'].text, '</script><div class="danger">alert</div>');
});
