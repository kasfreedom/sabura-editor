/**
 * Sabura Single-File Bundler.
 *
 * Compiles modular ES sources, styles, and initial canonical document into a standalone,
 * 100% offline self-running sabura.html file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';
import { createDefaultDocument, createDefaultObject, canonicalJson, validateDocument } from '../src/core/document.js';
import { extractDocumentFromHtml } from '../src/storage/file-packer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Source files in dependency order
const moduleFiles = [
  'src/core/types.js',
  'src/core/color.js',
  'src/core/geometry.js',
  'src/core/revision.js',
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

export async function minifyJs(code) {
  const result = await minify(code, {
    // Keep names stable for readable stack traces and the opaque runtime
    // contract, while enabling safe AST compression to preserve the runtime
    // budget as native features are added.
    compress: true,
    mangle: false,
    format: {
      comments: false
    }
  });
  return result.code;
}

export async function bundleModules() {
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

    codeBlocks.push(`// --- Module: ${relPath} ---\n${code.trim()}`);
  }

  const rawBundle = `(() => {\n'use strict';\n\n${codeBlocks.join('\n\n')}\n})();`;

  // Syntax-safe minification using proven AST-based parser (Terser).
  // Retains original variable and function names (mangle: false) and no compression (compress: false)
  // while safely stripping comments and unnecessary whitespace without regex or heuristic pitfalls.
  return await minifyJs(rawBundle);
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

const AI_CONTRACT = `<!-- SABURA AI CONTRACT
OVERVIEW
  Sabura is an AI-first offline whiteboard. This file has two sections:
    1. A small, editable board document (sabura/canvas/v1 JSON) — readable and replaceable.
    2. An opaque application runtime (CSS + JS) — treat as a sealed black box.
  Stop reading at &lt;style&gt;. Do not read, reproduce, or modify anything from &lt;style&gt; onward.

BROWSER-AGENT WORKFLOW  (preferred)
  1. Open sabura.html in a browser.
  2. Call window.sabura.readAiContract() -> { found, contract }
  3. Call window.sabura.getDocument() to read the current board (optional).
  4. Build your document object using the schema below.
  5. Call window.sabura.validateDocument(doc) -> { valid, errors[] }
  6. Call window.sabura.generateBoardFile(doc) -> { success, filename, byteLength }
     A complete HTML board file is downloaded. The runtime is never returned to you.
  7. Return the downloaded file without opening or reading it.

FILE-TOOL WORKFLOW  (fallback — no browser)
  1. Read only the contract and the document seam below. Stop before &lt;style&gt;.
  2. Locate the seam markers (angle brackets shown escaped for safety):
       &lt;script type="application/json" id="sabura-document"&gt;
       &lt;/script&gt;
  3. Replace only the JSON between those two markers with your new canonical JSON.
  4. Encode every literal < as \\u003C inside the JSON.
  5. Copy the remainder of the file through your tools without loading it into context.
  6. Never inspect, reformat, or regenerate the runtime. Return the resulting HTML file.

SCHEMA  sabura/canvas/v1
  Required top-level fields:
    schemaVersion  "sabura/canvas/v1"
    id             non-empty string
    title          string
    theme          { background, gridColor, palette[], defaultFill, defaultStroke,
                     defaultStrokeWidth, defaultOpacity, defaultRoughness,
                     defaultFontSize ("s"|"m"|"l"|"xl"),
                     defaultFontFamily ("sans"|"serif"|"mono"|"hand") }
    objects        { [objectId]: object }  where key === object.id
    order          string[]  bottom-to-top paint order (z-index)
    groups         { [groupId]: { id, name } }
    assets         { [assetId]: asset }

  Supported types: rectangle, ellipse, diamond, triangle, text, connector, path, image

  Common object fields: id, type, x, y, width, height, rotation, opacity,
    locked, groupId, plus style/text fields as applicable.

  Connector (type: connector):
    from, to — endpoint: { "id": "target_id" }
                          { "id": "target_id", "anchor": { "x": 0..1, "y": 0..1 } }
                          { "point": { "x": number, "y": number } }
    routing: "straight" | "elbow" | "curved"
    curveSide: 1 | -1,  startArrow: bool,  endArrow: bool

  Path (type: path):
    points: [{ "x": number, "y": number }, ...]
    closed: bool,  curveStyle: "sharp" | "curved",  startArrow: bool,  endArrow: bool

  Image: type "image", assetId -> a raster asset, fit "contain"|"cover" (default
    "contain"), plus x/y/width/height/rotation/opacity/locked/groupId.
  Raster asset: { id, type:"raster", data:"data:image/{png|jpeg|webp};base64,...",
    mimeType, width, height }. Data must be valid, <=10 MiB, <=16,384px/axis,
    and <=40,000,000 decoded pixels.

  Grouping: set object.groupId to a key that exists in the top-level groups map.
  Extensions: unknown properties are rejected unless prefixed "ext:" (e.g. "ext:myMeta").
  Escaping: every literal < in JSON string values must be encoded as \\u003C.

PUBLIC API  (window.sabura.*)
  readAiContract()        -> { found: bool, contract: string }
  getDocument()           -> board document object (deep copy)
  validateDocument(doc)   -> { valid: bool, errors: string[] }
  generateBoardFile(doc)  -> { success: bool, filename, byteLength } | { success: false, errors[] }
  applyCommands(cmds[])   -> { success: bool, document?, errors? }
  exportCanonicalJson()   -> canonical JSON string
  undo() / redo()  /  subscribe(listener) -> unsubscribe fn

  generateBoardFile() never returns the HTML source. The runtime remains opaque.
-->`;

function generateHtml(css, bundledJs, serializedDoc) {
  return `<!DOCTYPE html>
<html lang="en" data-ui-theme="system">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Sabura - AI-First Offline Whiteboard</title>

${AI_CONTRACT}

  <script type="application/json" id="sabura-document">
${serializedDoc}
  </script>

  <!-- Opaque application runtime begins here. Do not read or modify. -->
  <style>
${css}
  </style>
</head>
<body>
  <div id="app"></div>
  <script>
${bundledJs}
  </script>
</body>
</html>`;
}

async function build() {
  console.log('Building Sabura self-contained distribution...');

  const cssPath = path.join(rootDir, 'styles/sabura.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  const bundledJs = await bundleModules();
  const sampleDoc = createSampleBoard();
  const serializedSample = canonicalJson(sampleDoc);

  const emptyDoc = createDefaultDocument({ title: 'Untitled Board' });
  const serializedEmpty = canonicalJson(emptyDoc);

  const sampleHtml = generateHtml(css, bundledJs, serializedSample).replace(/[ \t]+$/gm, '').trimEnd() + '\n';
  const emptyHtml = generateHtml(css, bundledJs, serializedEmpty).replace(/[ \t]+$/gm, '').trimEnd() + '\n';

  const outputPath = path.join(rootDir, 'sabura.html');
  fs.writeFileSync(outputPath, sampleHtml, 'utf8');

  // Verify built file integrity
  const extracted = extractDocumentFromHtml(sampleHtml);
  if (!extracted.valid) {
    throw new Error(`Build verification failed: ${extracted.errors.join(', ')}`);
  }

  // Exact byte measurements directly from output file
  const sampleTotalBytes = fs.statSync(outputPath).size;
  const samplePayloadBytes = Buffer.byteLength(serializedSample, 'utf8');
  const emptyTotalBytes = Buffer.byteLength(emptyHtml, 'utf8');
  const emptyPayloadBytes = Buffer.byteLength(serializedEmpty, 'utf8');
  const aiContractBytes = Buffer.byteLength(AI_CONTRACT, 'utf8');
  const fixedShellBytes = sampleTotalBytes - samplePayloadBytes - aiContractBytes;
  const runtimeBytes = sampleTotalBytes - samplePayloadBytes;
  const runtimeBudgetBytes = 524288;

  console.log('\n=== Sabura Artifact Byte Report ===');
  console.log(`- Fixed Shell:              ${fixedShellBytes.toLocaleString()} bytes`);
  console.log(`- Embedded AI Contract:     ${aiContractBytes.toLocaleString()} bytes`);
  console.log(`- Empty Document Payload:   ${emptyPayloadBytes.toLocaleString()} bytes`);
  console.log(`- Sample Document Payload:  ${samplePayloadBytes.toLocaleString()} bytes`);
  console.log(`- Empty-Board Total:        ${emptyTotalBytes.toLocaleString()} bytes (${(emptyTotalBytes / 1024).toFixed(1)} KiB)`);
  console.log(`- Representative Sample:    ${sampleTotalBytes.toLocaleString()} bytes (${(sampleTotalBytes / 1024).toFixed(1)} KiB)`);
  console.log(`- Runtime (payload-free):   ${runtimeBytes.toLocaleString()} bytes (${(runtimeBytes / 1024).toFixed(1)} KiB)`);
  console.log(`- Runtime Budget Target:    ${runtimeBudgetBytes.toLocaleString()} bytes (512 KiB)`);
  console.log(`- Runtime Headroom:         ${(runtimeBudgetBytes - runtimeBytes).toLocaleString()} bytes under budget\n`);

  if (runtimeBytes >= runtimeBudgetBytes) {
    throw new Error(`Editor runtime (${runtimeBytes} bytes, document payload excluded) must remain below the ${runtimeBudgetBytes}-byte (512 KiB) limit!`);
  }

  console.log(`✓ Successfully created sabura.html (${(sampleTotalBytes / 1024).toFixed(1)} KiB)`);
}

if (process.argv[1] && import.meta.filename && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  build().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
