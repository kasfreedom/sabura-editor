import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  createDefaultDocument,
  createDefaultObject,
  canonicalJson,
  validateDocument,
  normalizeDocument,
  cloneDocument,
  REVISION_EXTENSION_KEY,
  computeSha256,
  generateRevisionId,
  getShortRevisionId,
  computeContentDigest,
  validateRevisionMetadata,
  transitionRevision
} from '../src/core/document.js';
import {
  generateRevisionId as generateRawRevisionId,
  computeContentDigest as computeRawDigest,
  validateRevisionMetadata as validateRawMetadata,
  transitionRevision as transitionRawRevision
} from '../src/core/revision.js';
import { applyCommand } from '../src/core/commands.js';
import {
  extractDocumentFromHtml,
  packageHtmlWithDocument,
  sanitizeFilenameTitle
} from '../src/storage/file-packer.js';
import { Workspace } from '../src/ui/workspace.js';
import { ShortcutsCoordinator } from '../src/ui/shortcuts.js';
import { TopBar } from '../src/ui/topbar.js';
import { TextEditor } from '../src/ui/text-editor.js';
import { SaburaApp } from '../src/main.js';

// Setup minimal DOM environment for Node.js test runner
function createMockElement(tag = 'DIV') {
  const listeners = {};
  const children = [];
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    id: '',
    innerHTML: '',
    value: '',
    children,
    listeners,
    style: { display: '' },
    classList: {
      add: (cls) => { if (!el.className.includes(cls)) el.className = (el.className + ' ' + cls).trim(); },
      remove: (cls) => { el.className = el.className.replace(cls, '').trim(); },
      contains: (cls) => el.className.includes(cls)
    },
    cloneNode: () => {
      const clone = createMockElement(tag);
      clone.className = el.className;
      clone.id = el.id;
      clone.innerHTML = el.innerHTML;
      clone.outerHTML = '<!DOCTYPE html><html><head><script type="application/json" id="sabura-document">\n</script></head><body></body></html>';
      return clone;
    },
    attributes: {},
    setAttribute: (k, v) => { el.attributes[k] = String(v); },
    getAttribute: (k) => el.attributes[k] || null,
    removeAttribute: (k) => { delete el.attributes[k]; },
    closest: (sel) => {
      if (sel.includes('data-handle') && el.getAttribute('data-handle')) return el;
      return null;
    },
    appendChild: (child) => {
      children.push(child);
      if (child) child.parentNode = el;
      return child;
    },
    removeChild: (child) => {
      const idx = children.indexOf(child);
      if (idx >= 0) children.splice(idx, 1);
      if (child) child.parentNode = null;
      return child;
    },
    addEventListener: (evt, fn) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(fn);
    },
    removeEventListener: (evt, fn) => {
      if (listeners[evt]) {
        listeners[evt] = listeners[evt].filter(f => f !== fn);
      }
    },
    dispatchEvent: (evt) => {
      const type = typeof evt === 'string' ? evt : evt?.type;
      const list = listeners[type] || [];
      for (const fn of list) fn(evt);
    },
    textContent: '',
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 }),
    getContext: () => ({
      clearRect: () => {},
      beginPath: () => {},
      stroke: () => {},
      fill: () => {},
      arc: () => {},
      moveTo: () => {},
      lineTo: () => {},
      setTransform: () => {}
    }),
    focus: () => {},
    select: () => {},
    click: () => {
      el.dispatchEvent({ type: 'click' });
    },
    querySelector: (selector) => {
      const found = children.find(c => (c.id && selector.includes(c.id)) || (c.className && selector.includes(c.className)));
      if (found) return found;
      if (selector.startsWith('#')) {
        const targetId = selector.slice(1);
        if (el.id === targetId) return el;
        return getOrCreateMockElement(targetId);
      }
      if (selector.startsWith('.')) {
        const targetClass = selector.slice(1);
        if (el.className && el.className.includes(targetClass)) return el;
        if (el.innerHTML && el.innerHTML.includes(targetClass)) {
          const matched = createMockElement('DIV');
          matched.className = targetClass;
          return matched;
        }
      }
      return null;
    },
    querySelectorAll: () => []
  };
  return el;
}

const domRegistry = new Map();
function getOrCreateMockElement(id, tag = null) {
  const actualTag = tag || (id.startsWith('btn-') ? 'BUTTON' : 'DIV');
  if (!domRegistry.has(id)) {
    const el = createMockElement(actualTag);
    el.id = id;
    domRegistry.set(id, el);
  }
  return domRegistry.get(id);
}

function setDocumentSeam(doc) {
  const seam = getOrCreateMockElement('sabura-document', 'script');
  if (doc === null) {
    seam.textContent = '';
  } else {
    seam.textContent = canonicalJson(doc);
  }
}

// Pre-populate default seam and required DOM nodes for SaburaApp.init()
setDocumentSeam(createDefaultDocument({ title: 'Untitled Board' }));
getOrCreateMockElement('app', 'div');
getOrCreateMockElement('canvas-container', 'div');
getOrCreateMockElement('laser-canvas', 'canvas');
getOrCreateMockElement('btn-wheel-fab', 'button');

if (typeof window === 'undefined') {
  globalThis.window = {
    innerWidth: 1000,
    innerHeight: 800,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}
if (typeof requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
if (typeof document === 'undefined') {
  globalThis.document = {
    activeElement: null,
    documentElement: createMockElement('html'),
    body: createMockElement('body'),
    createElement: (tag) => createMockElement(tag),
    getElementById: (id) => getOrCreateMockElement(id),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}

test('1. Pure-JS SHA-256 matches Node crypto across diverse inputs', () => {
  const testInputs = [
    '',
    'hello world',
    'Sabura offline-first whiteboard',
    'Unicode test: 日本語 العربية 🎨 ✨ 1234567890 !@#$%^&*()_+',
    '{"id":"doc-1","schemaVersion":"sabura/canvas/v1","title":"Test","theme":{"id":"paper"}}',
    'A'.repeat(5000)
  ];

  for (const input of testInputs) {
    const expected = crypto.createHash('sha256').update(input, 'utf8').digest('hex');
    const actual = computeSha256(input);
    assert.equal(actual, expected, `SHA-256 mismatch for input length ${input.length}`);
  }
});

test('2. computeContentDigest includes all persisted fields and excludes ext:sabura:revision', () => {
  const doc = createDefaultDocument({ title: 'Digest Test' });
  const rect = createDefaultObject('rectangle', { x: 100, y: 100, width: 200, height: 100 });
  doc.objects[rect.id] = rect;
  doc.order = [rect.id];
  doc['ext:custom_tag'] = 'metadata';

  const digestBefore = computeContentDigest(doc, canonicalJson);
  assert.ok(digestBefore.startsWith('sha256:'));
  assert.equal(digestBefore.length, 7 + 64);

  // Adding ext:sabura:revision does NOT change content digest
  const docWithRev = cloneDocument(doc);
  docWithRev[REVISION_EXTENSION_KEY] = {
    version: 1,
    revisionId: generateRevisionId(),
    parentId: null,
    contentDigest: digestBefore
  };

  const digestAfter = computeContentDigest(docWithRev, canonicalJson);
  assert.equal(digestAfter, digestBefore, 'Digest must ignore ext:sabura:revision property');

  // Modifying an actual document property (e.g. title) MUST change content digest
  const docModified = cloneDocument(doc);
  docModified.title = 'Digest Test Renamed';
  const digestModified = computeContentDigest(docModified, canonicalJson);
  assert.notEqual(digestModified, digestBefore, 'Content digest must change when document content changes');
});

test('3. F-04: Strict revision metadata validation and self-parenting prohibition', () => {
  const doc = createDefaultDocument({ title: 'Validation Test' });
  const validDigest = computeContentDigest(doc, canonicalJson);
  const revId = '4a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d';

  // Valid revision metadata
  doc[REVISION_EXTENSION_KEY] = {
    version: 1,
    revisionId: revId,
    parentId: null,
    contentDigest: validDigest
  };

  const validRes = validateRevisionMetadata(doc, canonicalJson);
  assert.equal(validRes.valid, true);
  assert.equal(validRes.errors.length, 0);

  // 1. Explicit null metadata is malformed, NOT treated as legacy
  const nullMetaDoc = cloneDocument(doc);
  nullMetaDoc[REVISION_EXTENSION_KEY] = null;
  const nullRes = validateRevisionMetadata(nullMetaDoc, canonicalJson);
  assert.equal(nullRes.valid, false, 'Explicit null metadata must be rejected');
  assert.ok(nullRes.errors.some(e => e.includes('must be an object')));
  const nullDocVal = validateDocument(nullMetaDoc, { verifyDigest: true });
  assert.equal(nullDocVal.valid, false, 'validateDocument must reject explicit null metadata');

  // 2. Non-hex revisionId rejected
  const nonHexDoc = cloneDocument(doc);
  nonHexDoc[REVISION_EXTENSION_KEY].revisionId = 'not-hex-revision-id';
  const nonHexRes = validateRevisionMetadata(nonHexDoc, canonicalJson);
  assert.equal(nonHexRes.valid, false);
  assert.ok(nonHexRes.errors.some(e => e.includes('lowercase hex')));

  // 3. Short revisionId (<12 hex chars) rejected
  const shortDoc = cloneDocument(doc);
  shortDoc[REVISION_EXTENSION_KEY].revisionId = 'abcdef12345'; // 11 chars
  const shortRes = validateRevisionMetadata(shortDoc, canonicalJson);
  assert.equal(shortRes.valid, false);
  assert.ok(shortRes.errors.some(e => e.includes('at least 12')));

  // 4. Self-parented revision rejected
  const selfParentDoc = cloneDocument(doc);
  selfParentDoc[REVISION_EXTENSION_KEY].parentId = selfParentDoc[REVISION_EXTENSION_KEY].revisionId;
  const selfParentRes = validateRevisionMetadata(selfParentDoc, canonicalJson);
  assert.equal(selfParentRes.valid, false);
  assert.ok(selfParentRes.errors.some(e => e.includes('cannot be its own parent')));

  // 5. Non-hex parentId rejected
  const nonHexParentDoc = cloneDocument(doc);
  nonHexParentDoc[REVISION_EXTENSION_KEY].parentId = 'invalid-parent-id';
  const nonHexParentRes = validateRevisionMetadata(nonHexParentDoc, canonicalJson);
  assert.equal(nonHexParentRes.valid, false);
  assert.ok(nonHexParentRes.errors.some(e => e.includes('parentId must be null or a lowercase hex string')));

  // 6. Stale digest detection
  const staleDoc = cloneDocument(doc);
  staleDoc.title = 'Tampered Without Updating Digest';
  const staleRes = validateRevisionMetadata(staleDoc, canonicalJson);
  assert.equal(staleRes.valid, false);
  assert.ok(staleRes.errors.some(e => e.includes('Stale or mismatched revision metadata')));
});

test('4. F-03: Minimal-field document normalization round-trip preserves revision and digest', () => {
  // Create a minimally specified valid document with a minimal rectangle
  const minimalDoc = {
    schemaVersion: 'sabura/canvas/v1',
    id: 'doc-minimal',
    title: 'Minimal Document',
    theme: {
      id: 'paper',
      background: '#fdfbf7',
      palette: ['#1e1e1e', '#e03131']
    },
    objects: {
      r1: {
        id: 'r1',
        type: 'rectangle',
        x: 10,
        y: 10,
        width: 60,
        height: 40
      }
    },
    order: ['r1'],
    groups: {},
    assets: {}
  };

  // Stamp with initial revision
  const transition = transitionRevision(minimalDoc, null, canonicalJson);
  minimalDoc[REVISION_EXTENSION_KEY] = transition.revisionRecord;

  // Package into HTML shell
  const shell = '<!DOCTYPE html><html><head><script type="application/json" id="sabura-document">\n</script></head><body></body></html>';
  const packRes = packageHtmlWithDocument(shell, minimalDoc);
  assert.equal(packRes.success, true);

  // Extract document from HTML
  const extractRes = extractDocumentFromHtml(packRes.html);
  assert.equal(extractRes.valid, true);
  const loadedDoc = extractRes.document;

  // The loaded (normalized) document must pass strict digest-enabled validation
  const validation = validateDocument(loadedDoc, { verifyDigest: true });
  assert.equal(validation.valid, true, `Loaded document must be valid with matching digest: ${validation.errors?.join(', ')}`);

  // An unchanged save of the loaded document must retain the existing revision without creating a new one
  const unchangedTransition = transitionRevision(loadedDoc, loadedDoc[REVISION_EXTENSION_KEY], canonicalJson);
  assert.equal(unchangedTransition.changed, false, 'Unchanged loaded document must not register as changed');
  assert.equal(unchangedTransition.revisionRecord.revisionId, transition.revisionRecord.revisionId);
  assert.equal(unchangedTransition.revisionRecord.parentId, transition.revisionRecord.parentId);
  assert.equal(unchangedTransition.revisionRecord.contentDigest, transition.revisionRecord.contentDigest);
});

test('5. F-05: Secure entropy requirement and safe error handling', () => {
  // 1. Normal environment with crypto succeeds
  const normalId = generateRevisionId();
  assert.equal(typeof normalId, 'string');
  assert.equal(normalId.length, 32);
  assert.ok(/^[0-9a-f]{32}$/.test(normalId));

  // 2. Missing crypto throws Error without falling back to Math.random
  const origCrypto = globalThis.crypto;
  try {
    delete globalThis.crypto;
    assert.throws(
      () => generateRevisionId(),
      /Secure entropy source .* is required/
    );
  } finally {
    globalThis.crypto = origCrypto;
  }

  // 3. Throwing crypto throws Error safely
  try {
    globalThis.crypto = {
      getRandomValues: () => { throw new Error('Hardware entropy failure'); }
    };
    assert.throws(
      () => generateRevisionId(),
      /Hardware entropy failure/
    );
  } finally {
    globalThis.crypto = origCrypto;
  }
});

test('6. Complete lineage (A -> B -> B_unchanged -> C) and two independent recipient branches', () => {
  const docA = createDefaultDocument({ title: 'Lineage Root' });
  const transA = transitionRevision(docA, null, canonicalJson);
  assert.equal(transA.changed, true);
  assert.equal(transA.revisionRecord.parentId, null);
  const revA = transA.revisionRecord;
  docA[REVISION_EXTENSION_KEY] = revA;

  // Edit A to produce B
  const docB = cloneDocument(docA);
  docB.title = 'Lineage Step B';
  const transB = transitionRevision(docB, revA, canonicalJson);
  assert.equal(transB.changed, true);
  assert.equal(transB.revisionRecord.parentId, revA.revisionId);
  const revB = transB.revisionRecord;
  docB[REVISION_EXTENSION_KEY] = revB;

  // Unchanged save of B retains B
  const transBUnchanged = transitionRevision(docB, revB, canonicalJson);
  assert.equal(transBUnchanged.changed, false);
  assert.equal(transBUnchanged.revisionRecord.revisionId, revB.revisionId);
  assert.equal(transBUnchanged.revisionRecord.parentId, revA.revisionId);

  // Edit B to produce C
  const docC = cloneDocument(docB);
  docC.title = 'Lineage Step C';
  const transC = transitionRevision(docC, revB, canonicalJson);
  assert.equal(transC.changed, true);
  assert.equal(transC.revisionRecord.parentId, revB.revisionId);

  // Two independent branches starting from A:
  // Recipient 1 modifies docA -> Branch 1
  const docBranch1 = cloneDocument(docA);
  docBranch1.title = 'Branch 1 Feature';
  const transBranch1 = transitionRevision(docBranch1, revA, canonicalJson);

  // Recipient 2 modifies docA -> Branch 2
  const docBranch2 = cloneDocument(docA);
  docBranch2.title = 'Branch 2 Feature';
  const transBranch2 = transitionRevision(docBranch2, revA, canonicalJson);

  assert.equal(transBranch1.revisionRecord.parentId, revA.revisionId);
  assert.equal(transBranch2.revisionRecord.parentId, revA.revisionId);
  assert.notEqual(transBranch1.revisionRecord.revisionId, transBranch2.revisionRecord.revisionId, 'Independent branches must generate distinct revision IDs');
  assert.notEqual(transBranch1.revisionRecord.contentDigest, transBranch2.revisionRecord.contentDigest);
});

test('7. F-01: Presentation mode blocks editing routes and undo, restores UI and camera on exit', () => {
  const container = createMockElement('div');
  const app = new SaburaApp();
  app.doc = createDefaultDocument({ title: 'Presentation Test' });
  const rect = createDefaultObject('rectangle', { x: 0, y: 0, width: 100, height: 100 });
  app.doc.objects[rect.id] = rect;
  app.doc.order = [rect.id];

  let cameraRerendered = false;
  app.workspace = {
    camera: { x: 50, y: 50, zoom: 1.5 },
    cancelGesture: () => {},
    selectedIds: [rect.id],
    mode: 'editing',
    setMode: (m) => { app.workspace.mode = m; },
    fitToContent: () => { app.workspace.camera = { x: 0, y: 0, zoom: 1.0 }; },
    render: () => { cameraRerendered = true; }
  };
  app.wheelFab = createMockElement('div');
  app.wheel = { close: () => {} };
  app.laser = { start: () => {}, stop: () => {}, resize: () => {} };
  app.topbar = { update: () => {} };
  app.mode = 'editing';

  // Apply a command to test undo later
  app.dispatchCommand({ type: 'move_objects', ids: [rect.id], dx: 20, dy: 0 });
  assert.equal(app.doc.objects[rect.id].x, 20);
  assert.equal(app.undoStack.length, 1);

  // Setup ShortcutsCoordinator with real production condition
  const shortcuts = new ShortcutsCoordinator({
    isReadingMode: () => app.mode === 'reading' || Boolean(app.inPresentation),
    isTextEditing: () => false,
    onUndo: () => app.undo(),
    onRedo: () => app.redo()
  });

  // 1. Enter Presentation
  app.enterPresentation();
  assert.equal(app.inPresentation, true);
  assert.equal(app.workspace.mode, 'reading', 'Workspace must be in reading mode during presentation');
  assert.equal(app.wheelFab.style.display, 'none', 'Wheel FAB must be hidden in presentation');
  assert.equal(app.workspace.selectedIds.length, 0, 'Selection must be cleared upon entering presentation');

  // Attempt Undo via shortcut during presentation -> MUST BE BLOCKED
  shortcuts.onKeyDown({
    key: 'z',
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    preventDefault: () => {}
  });
  assert.equal(app.doc.objects[rect.id].x, 20, 'Undo shortcut must not modify content during presentation');
  assert.equal(app.undoStack.length, 1);

  // 2. Exit Presentation
  cameraRerendered = false;
  app.exitPresentation();
  assert.equal(app.inPresentation, false);
  assert.equal(app.mode, 'editing', 'Mode must be restored to editing');
  assert.equal(app.workspace.mode, 'editing', 'Workspace mode must be restored to editing');
  assert.equal(app.wheelFab.style.display, '', 'Wheel FAB must be visible after exit');
  assert.equal(app.workspace.camera.x, 50, 'Original camera must be restored');
  assert.equal(app.workspace.camera.zoom, 1.5);
  assert.equal(cameraRerendered, true, 'Canvas must be re-rendered on exit');

  // Now in editing mode, undo shortcut works
  shortcuts.onKeyDown({
    key: 'z',
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    preventDefault: () => {}
  });
  assert.equal(app.doc.objects[rect.id].x, 0, 'Undo works again once exited to editing mode');
});

test('8. F-02: Real TextEditor commits pending text on View, Present, and Save Copy', () => {
  const container = createMockElement('div');
  const app = new SaburaApp();
  app.isCorrupted = false;
  app.loadErrors = [];
  app.doc = createDefaultDocument({ title: 'Text Editor Lifecycle' });
  const textObj = createDefaultObject('text', { id: 't1', text: 'original text', x: 10, y: 10, width: 100, height: 40 });
  app.doc.objects[textObj.id] = textObj;
  app.doc.order = [textObj.id];

  // Real TextEditor with actual Sabura set_text command contract
  const realTextEditor = new TextEditor(container, (objId, newText) => {
    app.dispatchCommand({
      type: 'set_text',
      id: objId,
      text: newText
    });
  });
  app.textEditor = realTextEditor;

  app.workspace = {
    camera: { x: 0, y: 0, zoom: 1 },
    cancelGesture: () => {},
    selectedIds: ['t1'],
    setMode: () => {},
    render: () => {},
    fitToContent: () => {}
  };
  app.topbar = { update: () => {} };
  app.wheel = { close: () => {} };
  app.laser = { start: () => {}, stop: () => {}, resize: () => {} };
  app.mode = 'editing';

  // 1. Open editor with original text, put pending text in textarea, switch to Reading (View)
  realTextEditor.open(textObj, app.workspace.camera);
  assert.equal(realTextEditor.textarea.style.display, 'block');
  realTextEditor.textarea.value = 'pending text from view';

  // Switch to Reading -> must commit pending text
  app.setMode('reading');
  assert.equal(realTextEditor.textarea.style.display, 'none');
  assert.equal(app.doc.objects['t1'].text, 'pending text from view', 'Pending text must commit on setMode reading');

  // 2. Re-open, modify text, call Save Copy
  app.mode = 'editing';
  realTextEditor.open(app.doc.objects['t1'], app.workspace.camera);
  realTextEditor.textarea.value = 'pending text from save copy';

  // Mock download functions for saveCopy
  globalThis.Blob = class { constructor() { this.size = 1024; } };
  globalThis.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} };

  const saveRes = app.saveCopy();
  assert.equal(saveRes.success, true);
  assert.equal(realTextEditor.textarea.style.display, 'none');
  assert.equal(app.doc.objects['t1'].text, 'pending text from save copy', 'Pending text must commit on saveCopy');
  assert.ok(app.exportBaseline.contentDigest.startsWith('sha256:'));

  // 3. Re-open, modify text, enter presentation
  realTextEditor.open(app.doc.objects['t1'], app.workspace.camera);
  realTextEditor.textarea.value = 'pending text from presentation';
  app.enterPresentation();
  assert.equal(realTextEditor.textarea.style.display, 'none');
  assert.equal(app.doc.objects['t1'].text, 'pending text from presentation', 'Pending text must commit on enterPresentation');
  app.exitPresentation();
});

test('9. Workspace and shortcuts interaction suppression in Reading mode', () => {
  const doc = createDefaultDocument();
  const rect = createDefaultObject('rectangle', { id: 'r1', x: 10, y: 10, width: 80, height: 60 });
  doc.objects[rect.id] = rect;
  doc.order = [rect.id];

  const container = createMockElement('div');
  const ws = new Workspace(container, {
    getDocument: () => doc,
    onCommand: () => {},
    onCommandBatch: () => {},
    onOpenWheel: () => {},
    onDoubleClickedObject: () => {}
  });
  ws.setMode('reading');
  assert.equal(ws.mode, 'reading');

  // SVG rendering suppresses selection handles, bounding boxes, draft previews in reading mode
  ws.selectedIds = ['r1'];
  ws.render();
  assert.ok(!container.innerHTML.includes('data-handle='), 'Reading mode must not render selection handles');

  // Switch to editing mode -> selection handles appear
  ws.setMode('editing');
  ws.selectedIds = ['r1'];
  ws.render();
  assert.ok(container.innerHTML.includes('data-handle='), 'Editing mode renders selection handles');

  // Shortcuts suppression in reading mode
  let toolSwitched = false;
  let undoTriggered = false;
  const shortcuts = new ShortcutsCoordinator({
    isReadingMode: () => true,
    isTextEditing: () => false,
    onSelectTool: () => { toolSwitched = true; },
    onUndo: () => { undoTriggered = true; }
  });

  // Tool key 'r' (rectangle) blocked
  shortcuts.onKeyDown({ key: 'r', preventDefault: () => {} });
  assert.equal(toolSwitched, false, 'Tool keys must be blocked in reading mode');

  // Undo blocked
  shortcuts.onKeyDown({ key: 'z', metaKey: true, preventDefault: () => {} });
  assert.equal(undoTriggered, false, 'Undo must be blocked in reading mode');
});

test('10. Initial mode determination: empty document boots to editing, populated boots to reading', () => {
  // 1. Valid empty document seam fed through actual application initialization
  const emptyDoc = createDefaultDocument({ title: 'Empty Board' });
  setDocumentSeam(emptyDoc);

  const appEmpty = new SaburaApp();
  assert.equal(appEmpty.isCorrupted, false, 'App should load successfully from valid empty seam');
  assert.equal(appEmpty.mode, 'editing', 'Empty board must boot SaburaApp into editing mode');
  assert.equal(appEmpty.workspace.mode, 'editing', 'Empty board must boot Workspace into editing mode');
  assert.equal(appEmpty.workspace.camera.x, 0, 'Empty board keeps default camera x');
  assert.equal(appEmpty.workspace.camera.y, 0, 'Empty board keeps default camera y');
  assert.equal(appEmpty.workspace.camera.zoom, 1.0, 'Empty board keeps default zoom');

  // 2. Valid populated document seam fed through actual application initialization
  const popDoc = createDefaultDocument({ title: 'Populated Board' });
  const rect = createDefaultObject('rectangle', { id: 'r1', x: 200, y: 300, width: 400, height: 200 });
  popDoc.objects[rect.id] = rect;
  popDoc.order = [rect.id];
  setDocumentSeam(popDoc);

  const appPopulated = new SaburaApp();
  assert.equal(appPopulated.isCorrupted, false, 'App should load successfully from valid populated seam');
  assert.equal(appPopulated.mode, 'reading', 'Populated board must boot SaburaApp into reading mode');
  assert.equal(appPopulated.workspace.mode, 'reading', 'Populated board must boot Workspace into reading mode');
  assert.notEqual(appPopulated.workspace.camera.x, 0, 'fitToContent(60) must reposition camera x for content bounds');
  assert.notEqual(appPopulated.workspace.camera.y, 0, 'fitToContent(60) must reposition camera y for content bounds');
});

test('11. extractDocumentFromHtml and packageHtmlWithDocument validation guards', () => {
  const doc = createDefaultDocument({ title: 'Extraction Security' });
  const trans = transitionRevision(doc, null, canonicalJson);
  doc[REVISION_EXTENSION_KEY] = trans.revisionRecord;

  const validHtml = '<!DOCTYPE html><html><head><script type="application/json" id="sabura-document">\n' +
    canonicalJson(doc) + '\n</script></head><body></body></html>';

  const validRes = extractDocumentFromHtml(validHtml);
  assert.equal(validRes.valid, true);
  assert.ok(validRes.document[REVISION_EXTENSION_KEY]);

  // Tampered title without digest update fails
  const tamperedDoc = cloneDocument(doc);
  tamperedDoc.title = 'Hacked Title';
  const tamperedHtml = '<!DOCTYPE html><html><head><script type="application/json" id="sabura-document">\n' +
    canonicalJson(tamperedDoc) + '\n</script></head><body></body></html>';
  const tamperedRes = extractDocumentFromHtml(tamperedHtml);
  assert.equal(tamperedRes.valid, false);
  assert.ok(tamperedRes.errors.some(e => e.includes('Stale or mismatched revision metadata')));

  // Malformed non-object revision metadata in HTML seam fails
  const malformedDoc = cloneDocument(doc);
  malformedDoc[REVISION_EXTENSION_KEY] = 'not-an-object';
  const malformedHtml = '<!DOCTYPE html><html><head><script type="application/json" id="sabura-document">\n' +
    canonicalJson(malformedDoc) + '\n</script></head><body></body></html>';
  const malformedRes = extractDocumentFromHtml(malformedHtml);
  assert.equal(malformedRes.valid, false);
  assert.ok(malformedRes.errors.some(e => e.includes('must be an object')));
});

test('12. Save Copy failure preserves export baseline and undo history, and remains retryable', () => {
  const app = new SaburaApp();
  app.isCorrupted = false;
  app.loadErrors = [];
  app.topbar = { update: () => {} };
  app.workspace = { render: () => {}, cancelGesture: () => {} };
  app.doc = createDefaultDocument({ title: 'Retry Test' });
  const rect = createDefaultObject('rectangle', { id: 'r1', x: 10, y: 10, width: 50, height: 50 });
  app.doc.objects[rect.id] = rect;
  app.doc.order = [rect.id];

  // Initial baseline
  const transA = transitionRevision(app.doc, null, canonicalJson);
  app.exportBaseline = { ...transA.revisionRecord };
  app.doc[REVISION_EXTENSION_KEY] = { ...transA.revisionRecord };

  // Make an edit
  app.dispatchCommand({ type: 'move_objects', ids: ['r1'], dx: 25, dy: 0 });
  assert.equal(app.status, 'Changed');
  assert.equal(app.undoStack.length, 1);

  // Trigger save failure by injecting throwing packaging
  const origPack = packageHtmlWithDocument;
  app.getCleanHtmlShell = () => '<!DOCTYPE html><html><head></head><body></body></html>';

  // Incomplete HTML shell fails packageHtmlWithDocument (no seam found)
  const failRes = app.saveCopy();
  assert.equal(failRes.success, false);
  assert.equal(app.status, 'Error');
  assert.equal(app.exportBaseline.revisionId, transA.revisionRecord.revisionId, 'Export baseline must not advance on failure');
  assert.equal(app.undoStack.length, 1, 'Undo history must be preserved on save failure');
  assert.equal(app.doc.objects['r1'].x, 35, 'Document content must remain intact');
  assert.equal(app.isSaving, false, 'isSaving latch must unlock on failure');

  // Retrying with valid shell succeeds
  app.getCleanHtmlShell = () => '<!DOCTYPE html><html><head><script type="application/json" id="sabura-document">\n</script></head><body></body></html>';
  globalThis.Blob = class { constructor() { this.size = 2048; } };
  globalThis.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} };

  const retryRes = app.saveCopy();
  assert.equal(retryRes.success, true);
  assert.equal(app.status, 'Copy requested');
  assert.notEqual(app.exportBaseline.revisionId, transA.revisionRecord.revisionId, 'Export baseline advances on successful retry');
  assert.equal(app.exportBaseline.parentId, transA.revisionRecord.revisionId);
});

test('13. TextEditor blur commits pending text without double-commit on subsequent close', () => {
  const container = createMockElement('div');
  const commits = [];
  const editor = new TextEditor(container, (objId, text) => {
    commits.push({ objId, text });
  });

  const obj = { id: 't1', text: 'initial', x: 0, y: 0, width: 100, height: 30 };
  editor.open(obj, { x: 0, y: 0, zoom: 1 });
  editor.textarea.value = 'updated on blur';

  // 1. Blur commits
  editor.onBlur();
  assert.equal(commits.length, 1);
  assert.equal(commits[0].text, 'updated on blur');
  assert.equal(editor.textarea.style.display, 'none');

  // 2. Subsequent close(true) (e.g. from saveCopy or mode change) does NOT double-commit
  editor.close(true);
  assert.equal(commits.length, 1, 'Subsequent close must not trigger duplicate commit');
});

test('14. F-07: Incomplete resize cancellation restores persisted bounds and text resolvedSize without uncommitted mutation', () => {
  const container = createMockElement('div');
  const app = new SaburaApp();
  app.isCorrupted = false;
  app.loadErrors = [];
  app.doc = createDefaultDocument({ title: 'Resize Cancellation' });

  // 1. Shape with text and existing resolvedSize: 20
  const rect = createDefaultObject('rectangle', {
    id: 'r_text',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    text: 'Resize Test',
    textStyle: { size: 'm', resolvedSize: 20, fontFamily: 'sans', align: 'center', bold: false, color: '#1e1e1e' }
  });
  app.doc.objects[rect.id] = rect;
  app.doc.order = [rect.id];

  // Stamp initial baseline
  const baseline = transitionRevision(app.doc, null, canonicalJson);
  app.doc[REVISION_EXTENSION_KEY] = { ...baseline.revisionRecord };
  app.exportBaseline = { ...baseline.revisionRecord };
  const baselineDigest = baseline.revisionRecord.contentDigest;
  const baselineRevId = baseline.revisionRecord.revisionId;

  // Real Workspace instance connected to app
  const ws = new Workspace(container, {
    getDocument: () => app.doc,
    onCommand: (cmd) => app.dispatchCommand(cmd),
    onCommandBatch: (cmds) => app.dispatchCommandBatch(cmds),
    onOpenWheel: () => {},
    onDoubleClickedObject: () => {},
    onZoomChange: () => {}
  });
  app.workspace = ws;
  app.mode = 'editing';
  ws.setMode('editing');
  ws.selectedIds = ['r_text'];

  const handleEl = createMockElement('rect');
  handleEl.setAttribute('data-handle', 'se');

  // Emulate pointerdown on southeast handle at (100, 100)
  ws.onPointerDown({
    button: 0,
    clientX: 100,
    clientY: 100,
    target: handleEl,
    preventDefault: () => {}
  });
  assert.equal(ws.isResizing, true);

  // Emulate pointermove to (200, 200) without pointerup -> previewing resize
  ws.onPointerMove({
    clientX: 200,
    clientY: 200,
    preventDefault: () => {}
  });
  assert.equal(rect.width, 200, 'Preview should expand width to 200');
  assert.equal(rect.height, 200, 'Preview should expand height to 200');
  assert.equal(rect.textStyle.resolvedSize, 40, 'Preview should scale text resolvedSize to 40');

  // Case A: Mode transition to Reading (View) during active resize
  app.setMode('reading');
  assert.equal(ws.isResizing, false, 'Resize state must be cleared');
  assert.equal(rect.width, 100, 'Width must be restored to original 100');
  assert.equal(rect.height, 100, 'Height must be restored to original 100');
  assert.equal(rect.textStyle.resolvedSize, 20, 'resolvedSize must be restored to original 20');
  assert.equal(app.undoStack.length, 0, 'No undo entry must be created on cancelled gesture');
  assert.equal(computeContentDigest(app.doc, canonicalJson), baselineDigest, 'Canonical digest must match baseline');

  // Case B: Present transition during active resize
  app.setMode('editing');
  ws.selectedIds = ['r_text'];
  ws.onPointerDown({
    button: 0,
    clientX: 100,
    clientY: 100,
    target: handleEl,
    preventDefault: () => {}
  });
  ws.onPointerMove({
    clientX: 200,
    clientY: 200,
    preventDefault: () => {}
  });
  assert.equal(rect.width, 200);
  assert.equal(rect.textStyle.resolvedSize, 40);

  app.enterPresentation();
  assert.equal(rect.width, 100, 'Bounds restored on enterPresentation');
  assert.equal(rect.textStyle.resolvedSize, 20, 'resolvedSize restored on enterPresentation');
  assert.equal(app.undoStack.length, 0);

  app.exitPresentation();
  assert.equal(rect.width, 100);
  assert.equal(rect.textStyle.resolvedSize, 20);

  // Case C: Save Copy during active resize
  ws.selectedIds = ['r_text'];
  ws.onPointerDown({
    button: 0,
    clientX: 100,
    clientY: 100,
    target: handleEl,
    preventDefault: () => {}
  });
  ws.onPointerMove({
    clientX: 200,
    clientY: 200,
    preventDefault: () => {}
  });
  assert.equal(rect.width, 200);
  assert.equal(rect.textStyle.resolvedSize, 40);

  globalThis.Blob = class { constructor() { this.size = 2048; } };
  globalThis.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} };
  app.getCleanHtmlShell = () => '<!DOCTYPE html><html><head><script type="application/json" id="sabura-document">\n</script></head><body></body></html>';

  const saveRes = app.saveCopy();
  assert.equal(saveRes.success, true);
  assert.equal(saveRes.changed, false, 'Uncommitted gesture must not trigger changed: true');
  assert.equal(saveRes.revisionId, baselineRevId, 'Save Copy must retain baseline revision ID');
  assert.equal(app.doc[REVISION_EXTENSION_KEY].revisionId, baselineRevId, 'Document revision ID must remain unchanged');
  assert.equal(rect.width, 100, 'Width must be restored on Save Copy');
  assert.equal(rect.textStyle.resolvedSize, 20, 'resolvedSize must be restored on Save Copy');

  // Case D: Shape WITHOUT resolvedSize initially present in textStyle
  delete rect.textStyle.resolvedSize;
  const noSizeBaseline = transitionRevision(app.doc, null, canonicalJson);
  app.doc[REVISION_EXTENSION_KEY] = { ...noSizeBaseline.revisionRecord };
  app.exportBaseline = { ...noSizeBaseline.revisionRecord };

  ws.selectedIds = ['r_text'];
  ws.onPointerDown({
    button: 0,
    clientX: 100,
    clientY: 100,
    target: handleEl,
    preventDefault: () => {}
  });
  ws.onPointerMove({
    clientX: 200,
    clientY: 200,
    preventDefault: () => {}
  });
  assert.ok('resolvedSize' in rect.textStyle, 'Preview creates resolvedSize');

  app.setMode('reading');
  assert.equal('resolvedSize' in rect.textStyle, false, 'resolvedSize key must be deleted if not initially present');
  assert.equal(rect.width, 100);
  assert.equal(rect.height, 100);
});

test('15. F-09: Inline text editor has stable id, name, and accessibility form semantics', () => {
  const container = createMockElement('div');
  const commits = [];
  const editor = new TextEditor(container, (objId, text) => {
    commits.push({ objId, text });
  });

  // Check element attributes and accessibility properties
  assert.equal(editor.textarea.id, 'sabura-inline-text-editor');
  assert.equal(editor.textarea.name, 'sabura-inline-text-editor');
  assert.equal(editor.textarea.className, 'sabura-inline-text-editor');
  assert.equal(editor.textarea.getAttribute('aria-label'), 'Edit shape or canvas text');
  assert.equal(editor.textarea.getAttribute('autocomplete'), 'off');
  assert.equal(editor.textarea.getAttribute('autocorrect'), 'off');
  assert.equal(editor.textarea.getAttribute('autocapitalize'), 'off');
  assert.equal(editor.textarea.getAttribute('spellcheck'), 'false');
  assert.equal(editor.textarea.style.display, 'none');

  // Verify lifecycle with proper semantics intact
  const obj = { id: 'text_sem', text: 'Semantics Test', x: 50, y: 50, width: 120, height: 40 };
  editor.open(obj, { x: 0, y: 0, zoom: 1 });
  assert.equal(editor.textarea.style.display, 'block');
  assert.equal(editor.textarea.value, 'Semantics Test');

  // Blur commits
  editor.textarea.value = 'Committed Semantic Text';
  editor.onBlur();
  assert.equal(commits.length, 1);
  assert.equal(commits[0].text, 'Committed Semantic Text');
  assert.equal(editor.textarea.style.display, 'none');
});

test('16. F-08: TopBar renders all essential actions in Reading and Editing, keyboard focusable and callable', () => {
  domRegistry.clear();
  const container = createMockElement('div');
  let modeChangedTo = null;
  let presentCalled = false;
  let saveCopyCalled = false;

  const topbar = new TopBar(container, {
    onSetMode: (m) => { modeChangedTo = m; },
    onPresent: () => { presentCalled = true; },
    onSaveCopy: () => { saveCopyCalled = true; }
  });

  const doc = createDefaultDocument({ title: 'Very Long Title For Mobile Truncation Test' });

  // 1. Reading mode
  topbar.update(doc, 'Clean', 'system', true, true, 'reading');
  const btnEdit = topbar.barEl.querySelector('#btn-edit');
  const btnPresent = topbar.barEl.querySelector('#btn-present');
  const btnSave = topbar.barEl.querySelector('#btn-save');

  assert.ok(btnEdit, 'Edit button must exist in Reading mode');
  assert.ok(btnPresent, 'Present button must exist in Reading mode');
  assert.ok(btnSave, 'Save Copy button must exist in Reading mode');

  // Essential actions are HTML button elements (standard keyboard focusable)
  assert.equal(btnEdit.tagName, 'BUTTON');
  assert.equal(btnPresent.tagName, 'BUTTON');
  assert.equal(btnSave.tagName, 'BUTTON');

  // Action callbacks
  btnEdit.click();
  assert.equal(modeChangedTo, 'editing');
  btnPresent.click();
  assert.equal(presentCalled, true);
  btnSave.click();
  assert.equal(saveCopyCalled, true);

  // 2. Editing mode
  modeChangedTo = null;
  presentCalled = false;
  saveCopyCalled = false;
  topbar.update(doc, 'Changed', 'system', true, true, 'editing');

  const btnView = topbar.barEl.querySelector('#btn-view');
  const btnPresentEdit = topbar.barEl.querySelector('#btn-present');
  const btnSaveEdit = topbar.barEl.querySelector('#btn-save');
  const secondaryGroup = topbar.barEl.querySelector('.topbar-secondary-actions');
  const btnUndo = topbar.barEl.querySelector('#btn-undo');
  const btnRedo = topbar.barEl.querySelector('#btn-redo');
  const btnFullscreen = topbar.barEl.querySelector('#btn-fullscreen');

  assert.ok(btnView, 'View button must exist in Editing mode');
  assert.ok(btnPresentEdit, 'Present button must exist in Editing mode');
  assert.ok(btnSaveEdit, 'Save Copy button must exist in Editing mode');
  assert.ok(secondaryGroup, 'Secondary actions group must exist in Editing mode');
  assert.ok(btnUndo, 'Undo button must exist');
  assert.ok(btnRedo, 'Redo button must exist');
  assert.ok(btnFullscreen, 'Fullscreen button must exist');

  btnView.click();
  assert.equal(modeChangedTo, 'reading');
  btnPresentEdit.click();
  assert.equal(presentCalled, true);
  btnSaveEdit.click();
  assert.equal(saveCopyCalled, true);
});
