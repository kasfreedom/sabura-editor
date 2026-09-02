/**
 * ai_interface.test.js
 * Tests for the AI-first whiteboard generator interface.
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
} from '../src/storage/file-packer.js';

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

test('14. Final artifact remains below 300 KiB (307,200 bytes) budget', () => {
  const BUDGET_BYTES = 307_200;
  const actualBytes = Buffer.byteLength(html, 'utf8');
  assert.ok(
    actualBytes <= BUDGET_BYTES,
    `Artifact is ${actualBytes} bytes — exceeds 300 KiB budget (${BUDGET_BYTES} bytes)`
  );
});
