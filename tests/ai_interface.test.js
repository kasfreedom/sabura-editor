/**
 * ai_interface.test.js
 * Tests for the whiteboard's structured agent-authoring interface.
 *
 * Tests actual public behavior: build artifact structure, file-packer helpers,
 * validator, and CSS/JS content hash invariants.
 * Does not mock the components under test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  createDefaultDocument,
  createDefaultObject,
  canonicalJson,
} from '../src/core/document.js';
import {
  extractDocumentFromHtml,
  packageHtmlWithDocument,
  DOCUMENT_SCRIPT_REGEX,
  sanitizeFilenameTitle,
} from '../src/storage/file-packer.js';
import { SaburaApp } from '../src/main.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const artifactPath = path.join(rootDir, 'sabura.html');

/** Reads sabura.html once; tests share this string (read-only). */
const html = fs.readFileSync(artifactPath, 'utf8');

/** Extract CSS text from inside the real <style>...</style> element. */
function extractCss(src) {
  const m = src.match(/<style>([\s\S]*?)<\/style>/i);
  assert.ok(m, 'Could not extract CSS from HTML');
  return m[1];
}

/**
 * Extract JS bundle from the bare <script>...</script> (no type= attribute).
 * The seam script has type="application/json" so it will not match.
 */
function extractJs(src) {
  const m = src.match(/<script\s*>([\s\S]*?)<\/script>/i);
  assert.ok(m, 'Could not extract JS bundle from HTML');
  return m[1];
}

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

// ── Test 1 ─────────────────────────────────────────────────────────────────────

test('1. AI contract appears before <style>', () => {
  const contractPos = html.indexOf('SABURA AI CONTRACT');
  const stylePos = html.indexOf('<style>');
  assert.ok(contractPos >= 0, 'AI contract not found in sabura.html');
  assert.ok(stylePos >= 0, '<style> element not found in sabura.html');
  assert.ok(
    contractPos < stylePos,
    `Contract at byte ${contractPos} must precede <style> at byte ${stylePos}`
  );
});

// ── Test 2 ─────────────────────────────────────────────────────────────────────

test('2. Document seam appears after the contract and before <style>', () => {
  const contractPos = html.indexOf('SABURA AI CONTRACT');
  const seamPos = html.indexOf('<script type="application/json" id="sabura-document">');
  const stylePos = html.indexOf('<style>');
  assert.ok(seamPos >= 0, 'Document seam not found in sabura.html');
  assert.ok(contractPos < seamPos, 'Contract must precede the document seam');
  assert.ok(seamPos < stylePos, 'Document seam must precede <style>');
});

// ── Test 3 ─────────────────────────────────────────────────────────────────────

test('3. Contract and seam are located within the first 8 KB', () => {
  const contractPos = html.indexOf('SABURA AI CONTRACT');
  const seamPos = html.indexOf('<script type="application/json" id="sabura-document">');
  const NEAR_LIMIT = 8192;
  assert.ok(contractPos < NEAR_LIMIT, `Contract starts at byte ${contractPos}, expected < ${NEAR_LIMIT}`);
  assert.ok(seamPos < NEAR_LIMIT, `Seam starts at byte ${seamPos}, expected < ${NEAR_LIMIT}`);
});

// ── Test 4 ─────────────────────────────────────────────────────────────────────

test('4. Contract names every public AI operation', () => {
  const contractStart = html.indexOf('<!-- SABURA AI CONTRACT');
  const contractEnd = html.indexOf('-->', contractStart) + 3;
  const contract = html.slice(contractStart, contractEnd);

  for (const op of ['readAiContract', 'getDocument', 'validateDocument', 'generateBoardFile', 'applyCommands', 'exportCanonicalJson']) {
    assert.ok(contract.includes(op), `Contract is missing public operation: ${op}`);
  }
  for (const op of ['agent.describe', 'agent.read', 'agent.apply', 'agent.undo', 'agent.redo', 'agent.focusObjects', 'agent.fitBoard', 'agent.saveCopy']) {
    assert.ok(contract.includes(op), `Contract is missing live agent operation: ${op}`);
  }
});

// ── Test 5 ─────────────────────────────────────────────────────────────────────

test('5. Contract documents both browser-agent and file-tool workflows', () => {
  const contractStart = html.indexOf('<!-- SABURA AI CONTRACT');
  const contractEnd = html.indexOf('-->', contractStart) + 3;
  const contract = html.slice(contractStart, contractEnd);
  assert.ok(contract.includes('BROWSER-AGENT WORKFLOW'), 'Contract missing BROWSER-AGENT WORKFLOW');
  assert.ok(contract.includes('FILE-TOOL WORKFLOW'), 'Contract missing FILE-TOOL WORKFLOW');
});

// ── Test 6 ─────────────────────────────────────────────────────────────────────

test('6. Contract explicitly labels the runtime as opaque', () => {
  const contractStart = html.indexOf('<!-- SABURA AI CONTRACT');
  const contractEnd = html.indexOf('-->', contractStart) + 3;
  const contract = html.slice(contractStart, contractEnd);
  assert.ok(
    contract.toLowerCase().includes('opaque'),
    'Contract must use the word "opaque" to describe the runtime'
  );
});

// ── Test 7 ─────────────────────────────────────────────────────────────────────

test('7. Valid document packages and round-trips successfully', () => {
  const doc = createDefaultDocument({ title: 'Round-Trip Test', id: 'board_roundtrip' });
  const rect = createDefaultObject('rectangle', { id: 'r1', text: 'Hello AI' });
  doc.objects['r1'] = rect;
  doc.order = ['r1'];

  const packResult = packageHtmlWithDocument(html, doc);
  assert.ok(packResult.success, 'packageHtmlWithDocument should succeed');

  const extracted = extractDocumentFromHtml(packResult.html);
  assert.ok(extracted.valid, `Extracted document invalid: ${extracted.errors.join(', ')}`);
  assert.equal(extracted.document.id, 'board_roundtrip');
  assert.equal(extracted.document.title, 'Round-Trip Test');
  assert.equal(extracted.document.objects['r1'].text, 'Hello AI');
});

// ── Test 8 ─────────────────────────────────────────────────────────────────────

test('8. Invalid document input is rejected by packageHtmlWithDocument', () => {
  const badDoc = { notADoc: true };
  const packResult = packageHtmlWithDocument(html, badDoc);
  assert.equal(packResult.success, false, 'Should reject invalid document');
  assert.ok(packResult.error && packResult.error.length > 0, 'Should report error message');
  assert.equal(packResult.html, '', 'No HTML should be generated on failure');
});

// ── Test 9 ─────────────────────────────────────────────────────────────────────

test('9. Invalid generation does not modify sabura.html on disk', () => {
  const originalLength = Buffer.byteLength(html, 'utf8');
  const badDoc = { schemaVersion: 'sabura/canvas/v1', id: '' }; // missing required fields
  const packResult = packageHtmlWithDocument(html, badDoc);
  assert.equal(packResult.success, false, 'Should fail for incomplete document');
  // Verify the file on disk is untouched
  const currentLength = Buffer.byteLength(fs.readFileSync(artifactPath, 'utf8'), 'utf8');
  assert.equal(currentLength, originalLength, 'sabura.html must not be modified on packaging failure');
});

// ── Test 10 ────────────────────────────────────────────────────────────────────

test('10. CSS content hash is unchanged after packaging', () => {
  const origCssHash = sha256(extractCss(html));
  const doc = createDefaultDocument({ title: 'CSS Hash Test', id: 'board_csshash' });
  const packResult = packageHtmlWithDocument(html, doc);
  assert.ok(packResult.success);
  const genCssHash = sha256(extractCss(packResult.html));
  assert.equal(genCssHash, origCssHash, 'CSS content hash must be identical after packaging');
});

// ── Test 11 ────────────────────────────────────────────────────────────────────

test('11. JavaScript bundle hash is unchanged after packaging', () => {
  const origJsHash = sha256(extractJs(html));
  const doc = createDefaultDocument({ title: 'JS Hash Test', id: 'board_jshash' });
  const packResult = packageHtmlWithDocument(html, doc);
  assert.ok(packResult.success);
  const genJsHash = sha256(extractJs(packResult.html));
  assert.equal(genJsHash, origJsHash, 'JS bundle hash must be identical after packaging');
});

// ── Test 12 ────────────────────────────────────────────────────────────────────

test('12. Literal < characters in document text are serialized as \\u003C', () => {
  const doc = createDefaultDocument({ title: 'Escape Test' });
  const obj = createDefaultObject('text', { id: 'txt1', text: '<script>alert(1)</script>' });
  doc.objects['txt1'] = obj;
  doc.order = ['txt1'];

  const serialized = canonicalJson(doc);
  assert.ok(!serialized.includes('<script'), 'canonicalJson must not emit literal <script');
  assert.ok(serialized.includes('\\u003C'), 'canonicalJson must encode < as \\u003C');

  // Value must survive round-trip
  const packResult = packageHtmlWithDocument(html, doc);
  assert.ok(packResult.success);
  const extracted = extractDocumentFromHtml(packResult.html);
  assert.ok(extracted.valid);
  assert.equal(extracted.document.objects['txt1'].text, '<script>alert(1)</script>');
});

// ── Test 13 ────────────────────────────────────────────────────────────────────

test('13. Unicode content produces UTF-8 byte count larger than JS string length', () => {
  // Arabic "مرحبا" = 5 JS chars, 10 UTF-8 bytes
  const arabicText = 'مرحبا بالذكاء الاصطناعي';
  assert.ok(
    Buffer.byteLength(arabicText, 'utf8') > arabicText.length,
    'Arabic text must have more UTF-8 bytes than JS chars'
  );

  const doc = createDefaultDocument({ title: arabicText, id: 'board_unicode' });
  const packResult = packageHtmlWithDocument(html, doc);
  assert.ok(packResult.success);

  const genUtf8 = Buffer.byteLength(packResult.html, 'utf8');
  const genJsLen = packResult.html.length;
  assert.ok(
    genUtf8 > genJsLen,
    `Arabic title must make UTF-8 bytes (${genUtf8}) > JS string length (${genJsLen})`
  );
});

// ── Test 14 ────────────────────────────────────────────────────────────────────

test('14. Generated editor runtime remains below 512 KiB with document payload excluded', () => {
  const BUDGET_BYTES = 524_288;
  const actualBytes = Buffer.byteLength(html, 'utf8');
  const seam = html.match(/<script type="application\/json" id="sabura-document">\s*([\s\S]*?)\s*<\/script>/i);
  assert.ok(seam, 'Document seam must exist for runtime measurement');
  const runtimeBytes = actualBytes - Buffer.byteLength(seam[1].trim(), 'utf8');
  assert.ok(
    runtimeBytes < BUDGET_BYTES,
    `Runtime is ${runtimeBytes} bytes — exceeds 512 KiB budget (${BUDGET_BYTES} bytes)`
  );
});

// ── Test 15 ────────────────────────────────────────────────────────────────────

test('15. Filename generation for non-Latin and punctuation titles', async () => {
  // 1. Arabic-only title
  const arabicTitle = 'مرحبا بالعالم';
  const safeArabic = sanitizeFilenameTitle(arabicTitle, 'board');
  assert.equal(safeArabic, 'board', 'Arabic-only title must fall back to "board"');

  // 2. Punctuation-only title
  const punctTitle = '!@#$%^&*()---_+=[]{}';
  const safePunct = sanitizeFilenameTitle(punctTitle, 'board');
  assert.equal(safePunct, 'board', 'Punctuation-only title must fall back to "board"');

  // 3. Ordinary Latin title
  const latinTitle = 'Architecture Review 2026';
  const safeLatin = sanitizeFilenameTitle(latinTitle, 'board');
  assert.equal(safeLatin, 'architecture-review-2026', 'Latin title must be converted to hyphenated slug');

  // Test generateBoardFile produces valid filenames for each
  const app = Object.create(SaburaApp.prototype);
  app.doc = createDefaultDocument();
  app.loadErrors = [];
  app.isCorrupted = false;
  app.originalHtml = html;
  app.subscribers = new Set();
  app.undoStack = [];
  app.redoStack = [];
  app.getCleanHtmlShell = () => html;

  const origWindow = globalThis.window;
  const origDocument = globalThis.document;
  const origURL = globalThis.URL;
  const origBlob = globalThis.Blob;

  try {
    globalThis.window = {};
    globalThis.document = {
      body: { appendChild: () => {}, removeChild: () => {} },
      createElement: () => ({ click: () => {} })
    };
    globalThis.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} };
    globalThis.Blob = class { constructor() { this.size = 1000; } };

    app.exposeApi();
    const sabura = globalThis.window.sabura;

    const resArabic = sabura.generateBoardFile(createDefaultDocument({ title: arabicTitle }));
    assert.equal(resArabic.success, true);
    assert.ok(resArabic.filename.startsWith('sabura-board-'), `Expected sabura-board-*, got ${resArabic.filename}`);
    assert.ok(resArabic.filename.endsWith('.html'));

    const resPunct = sabura.generateBoardFile(createDefaultDocument({ title: punctTitle }));
    assert.equal(resPunct.success, true);
    assert.ok(resPunct.filename.startsWith('sabura-board-'), `Expected sabura-board-*, got ${resPunct.filename}`);
    assert.ok(resPunct.filename.endsWith('.html'));

    const resLatin = sabura.generateBoardFile(createDefaultDocument({ title: latinTitle }));
    assert.equal(resLatin.success, true);
    assert.ok(resLatin.filename.startsWith('sabura-architecture-review-2026-'), `Expected sabura-architecture-review-2026-*, got ${resLatin.filename}`);
    assert.ok(resLatin.filename.endsWith('.html'));

    // Allow triggerFileDownload cleanup timer (200ms) to complete before restoring globals
    await new Promise(r => setTimeout(r, 250));
  } finally {
    globalThis.window = origWindow;
    globalThis.document = origDocument;
    globalThis.URL = origURL;
    globalThis.Blob = origBlob;
  }
});

// ── Test 16 ────────────────────────────────────────────────────────────────────

test('16. generateBoardFile operational failure when triggerFileDownload throws', () => {
  const app = Object.create(SaburaApp.prototype);
  app.doc = createDefaultDocument();
  app.loadErrors = [];
  app.isCorrupted = false;
  app.originalHtml = html;
  app.subscribers = new Set();
  app.undoStack = [];
  app.redoStack = [];
  app.getCleanHtmlShell = () => html;

  const origWindow = globalThis.window;
  const origDocument = globalThis.document;
  const origURL = globalThis.URL;
  const origBlob = globalThis.Blob;

  try {
    globalThis.window = {};
    globalThis.document = {
      body: { appendChild: () => {}, removeChild: () => {} },
      createElement: () => ({ click: () => {} })
    };
    // Simulate triggerFileDownload failure (e.g. Blob allocation leaking runtime HTML)
    globalThis.URL = {
      createObjectURL: () => {
        throw new Error('Disk quota exceeded: <style>body{background:red}</style>');
      },
      revokeObjectURL: () => {}
    };
    globalThis.Blob = class { constructor() { this.size = 1000; } };

    app.exposeApi();
    const sabura = globalThis.window.sabura;

    const validDoc = createDefaultDocument({ title: 'Failure Test' });
    const result = sabura.generateBoardFile(validDoc);

    // 1. Returns structured failure, does not throw uncaught exception
    assert.equal(result.success, false, 'Must return success: false');
    assert.ok(Array.isArray(result.errors), 'Must return errors array');
    assert.ok(result.errors.length > 0, 'Must contain error message');

    // 2. No HTML or runtime source appears in error message or response
    assert.equal(result.html, undefined, 'Must not expose html property in response');
    assert.equal(result.source, undefined, 'Must not expose source property in response');
    assert.equal(result.runtime, undefined, 'Must not expose runtime property in response');
    const combinedErrors = result.errors.join(' ');
    assert.ok(!combinedErrors.includes('<style>'), 'Error message must not contain <style> tag');
    assert.ok(!combinedErrors.includes('</style>'), 'Error message must not contain </style> tag');
  } finally {
    globalThis.window = origWindow;
    globalThis.document = origDocument;
    globalThis.URL = origURL;
    globalThis.Blob = origBlob;
  }
});

// ── Test 17 ────────────────────────────────────────────────────────────────────

test('17. generateBoardFile operational failure when clean shell generation throws', () => {
  const app = Object.create(SaburaApp.prototype);
  app.doc = createDefaultDocument();
  app.loadErrors = [];
  app.isCorrupted = false;
  app.originalHtml = html;
  app.subscribers = new Set();
  app.undoStack = [];
  app.redoStack = [];

  // Simulate getCleanHtmlShell throwing with sensitive HTML/script tags
  app.getCleanHtmlShell = () => {
    throw new Error('DOM clone crashed: <script>function runtimeBundle(){}</script>');
  };

  const origWindow = globalThis.window;
  try {
    globalThis.window = {};
    app.exposeApi();
    const sabura = globalThis.window.sabura;

    const validDoc = createDefaultDocument({ title: 'DOM Error Test' });
    const result = sabura.generateBoardFile(validDoc);

    // 1. Returns structured failure without throwing
    assert.equal(result.success, false);
    assert.ok(Array.isArray(result.errors));
    assert.ok(result.errors.length > 0);

    // 2. No HTML or runtime content in error or response
    assert.equal(result.html, undefined);
    assert.equal(result.source, undefined);
    assert.equal(result.runtime, undefined);
    const combinedErrors = result.errors.join(' ');
    assert.ok(!combinedErrors.includes('<script>'), 'Error must not contain <script>');
    assert.ok(!combinedErrors.includes('runtimeBundle'), 'Error must not contain runtime code');
  } finally {
    globalThis.window = origWindow;
  }
});

// ── Test 18 ────────────────────────────────────────────────────────────────────

test('18. generateBoardFile operational failure when base shell is missing seam', () => {
  const app = Object.create(SaburaApp.prototype);
  app.doc = createDefaultDocument();
  app.loadErrors = [];
  app.isCorrupted = false;
  app.originalHtml = html;
  app.subscribers = new Set();
  app.undoStack = [];
  app.redoStack = [];
  // Shell missing sabura-document seam
  app.getCleanHtmlShell = () => '<!DOCTYPE html><html><head></head><body>No seam here</body></html>';

  const origWindow = globalThis.window;
  try {
    globalThis.window = {};
    app.exposeApi();
    const sabura = globalThis.window.sabura;

    const validDoc = createDefaultDocument({ title: 'No Seam Test' });
    const result = sabura.generateBoardFile(validDoc);

    assert.equal(result.success, false);
    assert.ok(Array.isArray(result.errors));
    assert.ok(result.errors[0].includes('missing sabura-document seam'));
    assert.equal(result.html, undefined);
    assert.equal(result.source, undefined);
    assert.equal(result.runtime, undefined);
  } finally {
    globalThis.window = origWindow;
  }
});

// ── Test 19 ────────────────────────────────────────────────────────────────────

test('19. Regression: synchronous repeated generateBoardFile calls produce identical byte size and leak no anchors', () => {
  const app = Object.create(SaburaApp.prototype);
  app.doc = createDefaultDocument();
  app.loadErrors = [];
  app.isCorrupted = false;
  app.originalHtml = html;
  app.subscribers = new Set();
  app.undoStack = [];
  app.redoStack = [];

  const capturedBlobs = [];
  const origWindow = globalThis.window;
  const origDocument = globalThis.document;
  const origURL = globalThis.URL;
  const origBlob = globalThis.Blob;

  try {
    const liveBody = {
      children: [],
      appendChild: (node) => {
        liveBody.children.push(node);
      },
      removeChild: (node) => {
        const idx = liveBody.children.indexOf(node);
        if (idx >= 0) liveBody.children.splice(idx, 1);
      }
    };

    globalThis.window = {};
    globalThis.document = {
      body: liveBody,
      createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        download: '',
        href: '',
        click: () => {},
        parentNode: liveBody
      })
    };

    globalThis.URL = {
      createObjectURL: (blob) => {
        capturedBlobs.push(blob.content);
        return 'blob:mock-download-url';
      },
      revokeObjectURL: () => {}
    };

    globalThis.Blob = class {
      constructor(parts) {
        this.content = parts.join('');
        this.size = Buffer.byteLength(this.content, 'utf8');
      }
    };

    // Use live body state to simulate DOM cloning
    app.getCleanHtmlShell = () => {
      const hasAnchors = liveBody.children.some(c => c.download !== undefined);
      if (hasAnchors) {
        return html.replace('</body>', '<a download="leaked" href="blob:leaked"></a></body>');
      }
      return html;
    };

    app.exposeApi();
    const sabura = globalThis.window.sabura;

    const testDoc = createDefaultDocument({ title: 'Synchronous Repetition Test', id: 'board_repeat' });
    const rect = createDefaultObject('rectangle', { id: 'r1', text: 'Repeat Object' });
    testDoc.objects['r1'] = rect;
    testDoc.order = ['r1'];

    // Call generateBoardFile twice synchronously with the same document
    const res1 = sabura.generateBoardFile(testDoc);
    const res2 = sabura.generateBoardFile(testDoc);

    // 1. Both calls succeed
    assert.equal(res1.success, true);
    assert.equal(res2.success, true);

    // 2. Both generated Blob contents have identical byte sizes
    assert.equal(capturedBlobs.length, 2);
    const blob1Bytes = Buffer.byteLength(capturedBlobs[0], 'utf8');
    const blob2Bytes = Buffer.byteLength(capturedBlobs[1], 'utf8');
    assert.equal(res1.byteLength, res2.byteLength, 'Returned byteLength must be identical');
    assert.equal(blob1Bytes, blob2Bytes, 'Captured Blob contents must have identical byte sizes');

    // 3. Neither generated HTML contains a temporary download anchor or blob URL
    for (let i = 0; i < capturedBlobs.length; i++) {
      const blobHtml = capturedBlobs[i];
      assert.ok(!blobHtml.includes('<a download'), `Blob [${i}] must not contain temporary download anchor`);
      assert.ok(!blobHtml.includes('blob:'), `Blob [${i}] must not contain blob: URL`);
    }

    // 4. CSS and JavaScript hashes remain identical
    const cssHash1 = sha256(extractCss(capturedBlobs[0]));
    const cssHash2 = sha256(extractCss(capturedBlobs[1]));
    assert.equal(cssHash1, cssHash2, 'CSS hashes must remain identical');

    const jsHash1 = sha256(extractJs(capturedBlobs[0]));
    const jsHash2 = sha256(extractJs(capturedBlobs[1]));
    assert.equal(jsHash1, jsHash2, 'JS bundle hashes must remain identical');

    // 5. The second document remains valid
    const extracted2 = extractDocumentFromHtml(capturedBlobs[1]);
    assert.equal(extracted2.valid, true, 'Second generated document must be valid');
    assert.equal(extracted2.document.id, 'board_repeat');
    assert.equal(extracted2.document.objects['r1'].text, 'Repeat Object');
  } finally {
    globalThis.window = origWindow;
    globalThis.document = origDocument;
    globalThis.URL = origURL;
    globalThis.Blob = origBlob;
  }
});
