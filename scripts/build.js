/**
 * Sabura Single-File Bundler.
 * 
 * Compiles modular ES sources, styles, and initial canonical document into a standalone,
 * 100% offline self-running sabura.html file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultDocument, createDefaultObject, canonicalJson, validateDocument } from '../src/core/document.js';
import { extractDocumentFromHtml } from '../src/storage/file-packer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Source files in dependency order
const moduleFiles = [
  'src/core/types.js',
  'src/core/geometry.js',
  'src/core/document.js',
  'src/core/commands.js',
  'src/core/sketch.js',
  'src/storage/file-packer.js',
  'src/renderer/laser.js',
  'src/renderer/svg-renderer.js',
  'src/ui/wheel.js',
  'src/ui/text-editor.js',
  'src/ui/topbar.js',
  'src/ui/shortcuts.js',
  'src/ui/zoom-toolbar.js',
  'src/ui/help-modal.js',
  'src/ui/workspace.js',
  'src/main.js'
];

function bundleModules() {
  const codeBlocks = [];

  for (const relPath of moduleFiles) {
    const fullPath = path.join(rootDir, relPath);
    let code = fs.readFileSync(fullPath, 'utf8');

    // Strip ES module imports
    code = code.replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '');

    // Convert export declarations to local declarations
    code = code.replace(/export\s+(const|let|var|function|class)\s+/g, '$1 ');

    // Strip named export blocks: export { ... };
    code = code.replace(/export\s*\{[\s\S]*?\};?/g, '');

    // Strip default exports: export default ...
    code = code.replace(/export\s+default\s+/g, '');

    // Strip block comments (JSDoc and multi-line comments)
    code = code.replace(/\/\*[\s\S]*?\*\//g, '');

    // Strip single-line comments (lines starting with //)
    code = code.split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n');

    // Collapse multiple empty lines
    code = code.replace(/\n\s*\n\s*\n/g, '\n\n');

    codeBlocks.push(`// --- Module: ${relPath} ---\n${code.trim()}`);
  }

  return `(() => {\n'use strict';\n\n${codeBlocks.join('\n\n')}\n})();`;
}

function createSampleBoard() {
  const doc = createDefaultDocument({ title: 'Welcome to Sabura' });

  // Add welcome shapes
  const titleBox = createDefaultObject('rectangle', {
    id: 'shape_intro',
    x: 80,
    y: 80,
    width: 340,
    height: 100,
    fill: '#ffec99',
    stroke: '#1e1e1e',
    strokeWidth: 2,
    roughness: 1,
    text: 'Sabura Whiteboard\nExcalidraw sketch feel + Concepts precision dial',
    textStyle: { size: 'm', resolvedSize: 18, fontFamily: 'hand', align: 'center', bold: true }
  }, doc.theme);

  const ideaBox = createDefaultObject('ellipse', {
    id: 'shape_idea',
    x: 100,
    y: 250,
    width: 150,
    height: 95,
    fill: '#a5d8ff',
    stroke: '#1971c2',
    strokeWidth: 2,
    roughness: 1,
    text: 'Press Q for\nConcepts Wheel',
    textStyle: { size: 's', resolvedSize: 16, fontFamily: 'hand', align: 'center', bold: false }
  }, doc.theme);

  const coreBox = createDefaultObject('diamond', {
    id: 'shape_core',
    x: 360,
    y: 235,
    width: 150,
    height: 120,
    fill: '#b2f2bb',
    stroke: '#2f9e44',
    strokeWidth: 2,
    roughness: 1,
    text: '100% Offline\nSingle-File HTML',
    textStyle: { size: 's', resolvedSize: 15, fontFamily: 'hand', align: 'center', bold: false }
  }, doc.theme);

  const connector = createDefaultObject('connector', {
    id: 'conn_1',
    from: { id: 'shape_idea' },
    to: { id: 'shape_core' },
    routing: 'curved',
    stroke: '#1e1e1e',
    strokeWidth: 2,
    endArrow: true
  }, doc.theme);

  doc.objects[titleBox.id] = titleBox;
  doc.objects[ideaBox.id] = ideaBox;
  doc.objects[coreBox.id] = coreBox;
  doc.objects[connector.id] = connector;
  doc.order = [titleBox.id, ideaBox.id, coreBox.id, connector.id];

  return doc;
}

const AI_CONTRACT = `  <!-- SABURA AI CONTRACT
  schemaVersion: "sabura/canvas/v1"
  The diagram document is canonical JSON stored in the script element below with id="sabura-document".
  Do not modify any HTML, CSS, or JavaScript outside this script tag seam.
  Required top-level keys:
  - schemaVersion: "sabura/canvas/v1"
  - id: non-empty string board identifier
  - title: string
  - theme: { background: string, palette: string[], ... }
  - objects: map of { [objectId]: object } where key === object.id
  - order: array of object IDs defining bottom-to-top paint order / z-index
  - groups: map of { [groupId]: { id: groupId, name: string } }
  - assets: map of { [assetId]: asset }
  Supported object types: rectangle, ellipse, diamond, triangle, text, connector, path.
  Object fields:
  - Common: id, type, stroke, strokeWidth, strokeStyle ("solid"|"dashed"|"dotted"), fill, opacity (0..1), roughness (>=0), seed (int), locked (bool), groupId (string|null), text, textStyle ({ size, resolvedSize, fontFamily, bold, align, color })
  - Shape text: stored directly in the object's text and textStyle fields
  - Grouping: set object.groupId to an existing group in top-level groups record
  - Shapes & Text: require numeric x, y, width, height
  - Connectors: require from and to endpoints, each formatted as either:
    { "id": "target_id" }
    { "id": "target_id", "anchor": { "x": 0..1, "y": 0..1 } }
    { "point": { "x": number, "y": number } }
    routing: "straight" | "elbow" | "curved", curveSide (1 | -1), startArrow (bool), endArrow (bool)
  - Paths: require points array of [{x,y}, ...] or [[x,y], ...], closed (bool), curveStyle ("sharp"|"curved"), startArrow (bool), endArrow (bool)
  - Extensions: unknown properties are strictly rejected unless namespaced with "ext:*" (e.g. "ext:myMeta")
  - Escaping: every literal "<" in JSON text must be encoded as "\\u003C" to prevent HTML parsing breaks
  -->`;

function generateHtml(css, bundledJs, serializedDoc) {
  return `<!DOCTYPE html>
<html lang="en" data-ui-theme="system">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Sabura - AI-First Offline Whiteboard</title>
  <style>
${css}
  </style>
</head>
<body>
  <div id="app"></div>

${AI_CONTRACT}
  <!-- Sabura Persisted Document Seam -->
  <script type="application/json" id="sabura-document">
${serializedDoc}
  </script>

  <!-- Sabura Standalone Application Bundle -->
  <script>
${bundledJs}
  </script>
</body>
</html>`;
}

function build() {
  console.log('Building Sabura self-contained distribution...');

  const cssPath = path.join(rootDir, 'styles/sabura.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  const bundledJs = bundleModules();
  const sampleDoc = createSampleBoard();
  const serializedSample = canonicalJson(sampleDoc);

  const emptyDoc = createDefaultDocument({ title: 'Untitled Board' });
  const serializedEmpty = canonicalJson(emptyDoc);

  const sampleHtml = generateHtml(css, bundledJs, serializedSample);
  const emptyHtml = generateHtml(css, bundledJs, serializedEmpty);

  const outputPath = path.join(rootDir, 'sabura.html');
  fs.writeFileSync(outputPath, sampleHtml, 'utf8');

  // Verify built file integrity
  const extracted = extractDocumentFromHtml(sampleHtml);
  if (!extracted.valid) {
    throw new Error(`Build verification failed: ${extracted.errors.join(', ')}`);
  }

  // Exact byte measurements
  const sampleTotalBytes = Buffer.byteLength(sampleHtml, 'utf8');
  const samplePayloadBytes = Buffer.byteLength(serializedSample, 'utf8');
  const emptyTotalBytes = Buffer.byteLength(emptyHtml, 'utf8');
  const emptyPayloadBytes = Buffer.byteLength(serializedEmpty, 'utf8');
  const aiContractBytes = Buffer.byteLength(AI_CONTRACT, 'utf8');
  const fixedShellBytes = sampleTotalBytes - samplePayloadBytes - aiContractBytes;

  console.log('\n=== Sabura Artifact Byte Report ===');
  console.log(`- Fixed Shell:              ${fixedShellBytes.toLocaleString()} bytes`);
  console.log(`- Embedded AI Contract:     ${aiContractBytes.toLocaleString()} bytes`);
  console.log(`- Empty Document Payload:   ${emptyPayloadBytes.toLocaleString()} bytes`);
  console.log(`- Sample Document Payload:  ${samplePayloadBytes.toLocaleString()} bytes`);
  console.log(`- Empty-Board Total:        ${emptyTotalBytes.toLocaleString()} bytes (${(emptyTotalBytes / 1024).toFixed(1)} KiB)`);
  console.log(`- Representative Sample:    ${sampleTotalBytes.toLocaleString()} bytes (${(sampleTotalBytes / 1024).toFixed(1)} KiB)`);
  console.log(`- 300 KiB Budget Target:    307,200 bytes`);
  console.log(`- Budget Headroom:          ${(307200 - emptyTotalBytes).toLocaleString()} bytes under budget\n`);

  if (emptyTotalBytes > 307200) {
    throw new Error(`Empty board size (${emptyTotalBytes} bytes) exceeds the 307,200-byte (300 KiB) limit!`);
  }

  console.log(`✓ Successfully created sabura.html (${(sampleTotalBytes / 1024).toFixed(1)} KiB)`);
}

build();

