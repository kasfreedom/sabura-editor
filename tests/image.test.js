import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultDocument,
  createDefaultObject,
  normalizeDocument,
  validateDocument,
  validateRasterDataUrl,
  canonicalJson
} from '../src/core/document.js';
import { applyCommand, applyCommandBatch } from '../src/core/commands.js';
import { renderObject } from '../src/renderer/svg-renderer.js';
import { resolveConnectorGeometry } from '../src/core/geometry.js';
import { ToolWheel } from '../src/ui/wheel.js';
import { SaburaApp } from '../src/main.js';
import { packageHtmlWithDocument, extractDocumentFromHtml } from '../src/storage/file-packer.js';
import fs from 'node:fs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMQD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAABAAEDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAE1/f//Z';
const WEBP = 'data:image/webp;base64,UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ0f/+ByKi/wEA';

function imageDocument(data = PNG, mimeType = 'image/png') {
  const doc = createDefaultDocument({ title: 'Images' });
  const asset = { id: 'asset_1', type: 'raster', data, mimeType, width: 1, height: 1 };
  const object = createDefaultObject('image', {
    id: 'image_1', assetId: asset.id, x: 10, y: 20, width: 480, height: 320
  }, doc.theme);
  doc.assets[asset.id] = asset;
  doc.objects[object.id] = object;
  doc.order = [object.id];
  return doc;
}

test('raster data URL validation accepts allowlisted signatures and rejects spoofed payloads', () => {
  assert.equal(validateRasterDataUrl(PNG, 'image/png').valid, true);
  assert.equal(validateRasterDataUrl(JPEG, 'image/jpeg').valid, true);
  assert.equal(validateRasterDataUrl(WEBP, 'image/webp').valid, true);
  const spoof = validateRasterDataUrl('data:image/png;base64,SGVsbG8=', 'image/png');
  assert.equal(spoof.valid, false);
  assert.ok(spoof.errors.every(error => !error.includes('SGVsbG8')));
  assert.equal(validateRasterDataUrl(PNG.slice(0, -8), 'image/png').valid, false);
  assert.equal(validateRasterDataUrl(JPEG.slice(0, -12), 'image/jpeg').valid, false);
  assert.equal(validateRasterDataUrl(WEBP.slice(0, -8), 'image/webp').valid, false);
  const oversized = validateRasterDataUrl(`data:image/png;base64,iVBORw0KGgo${'A'.repeat(14_000_000)}`, 'image/png');
  assert.equal(oversized.valid, false);
  assert.ok(oversized.errors.some(error => error.includes('source bytes')));
});

test('image canonical model validates, defaults fit, and rejects bad references/fields', () => {
  const doc = imageDocument();
  assert.equal(validateDocument(doc).valid, true);
  delete doc.objects.image_1.fit;
  assert.equal(validateDocument(doc).valid, true);
  normalizeDocument(doc);
  assert.equal(doc.objects.image_1.fit, 'contain');

  doc.objects.image_1.assetId = 'missing';
  assert.equal(validateDocument(doc).valid, false);
  doc.objects.image_1.assetId = 'asset_1';
  doc.assets.asset_1.mimeType = 'image/jpeg';
  assert.equal(validateDocument(doc).valid, false);
  doc.assets.asset_1.mimeType = 'image/png';
  doc.objects.image_1.fit = 'stretch';
  assert.equal(validateDocument(doc).valid, false);
  doc.objects.image_1.fit = 'contain';
  doc.assets.asset_1.width = 2;
  assert.equal(validateDocument(doc).valid, false);
  doc.assets.asset_1.width = 1;
  doc.assets.asset_1.width = 16_385;
  assert.equal(validateDocument(doc).valid, false);
  doc.assets.asset_1.width = 10_000;
  doc.assets.asset_1.height = 5_000;
  assert.equal(validateDocument(doc).valid, false);
});

test('image objects cannot enter the text editor contract or acquire text fields', () => {
  const doc = imageDocument();
  const before = canonicalJson(doc);
  const result = applyCommand(doc, { type: 'set_text', id: 'image_1', text: 'must not edit image' });
  assert.equal(result.inverseCmd.type, 'noop');
  assert.equal(canonicalJson(result.doc), before);
  assert.equal(validateDocument(result.doc).valid, true);
});

test('image connectors reuse rectangular anchors and rotate with the image boundary', () => {
  const doc = imageDocument();
  const image = doc.objects.image_1;
  image.rotation = 90;
  const connector = createDefaultObject('connector', {
    id: 'connector_image',
    from: { id: image.id, anchor: { x: 1, y: 0.5 } },
    to: { point: { x: 700, y: 180 } }
  });
  doc.objects[connector.id] = connector;
  doc.order.push(connector.id);
  const geometry = resolveConnectorGeometry(doc, connector);
  assert.ok(Math.abs(geometry.start.x - 250) < 0.001);
  assert.ok(Math.abs(geometry.start.y - 420) < 0.001);
  assert.equal(validateDocument(doc).valid, true);
});

test('straight, elbow, and curved connectors remain valid when attached to rotated images', () => {
  for (const routing of ['straight', 'elbow', 'curved']) {
    const doc = imageDocument();
    const image = doc.objects.image_1;
    image.rotation = 37;
    const connector = createDefaultObject('connector', {
      id: `connector_${routing}`,
      routing,
      from: { id: image.id, anchor: { x: 1, y: 0.5 } },
      to: { point: { x: 700, y: 180 } }
    });
    doc.objects[connector.id] = connector;
    doc.order.push(connector.id);
    const geometry = resolveConnectorGeometry(doc, connector);
    assert.ok(Number.isFinite(geometry.start.x) && Number.isFinite(geometry.start.y), routing);
    assert.ok(geometry.points.length >= 2, routing);
    assert.equal(validateDocument(doc).valid, true, routing);
  }
});

test('create/delete image is one atomic asset-object action with exact undo and shared asset retention', () => {
  const empty = createDefaultDocument();
  const source = imageDocument();
  const asset = source.assets.asset_1;
  const object = source.objects.image_1;
  const added = applyCommand(empty, { type: 'create_image', asset, object });
  assert.deepEqual(added.doc.assets.asset_1, asset);
  assert.deepEqual(added.doc.objects.image_1, object);

  const duplicate = applyCommand(added.doc, { type: 'duplicate_objects', ids: ['image_1'], offset: { x: 24, y: 24 } });
  const duplicateId = duplicate.doc.order[1];
  assert.equal(duplicate.doc.objects[duplicateId].assetId, 'asset_1');
  assert.equal(Object.keys(duplicate.doc.assets).length, 1);

  const removedOne = applyCommand(duplicate.doc, { type: 'delete_objects', ids: ['image_1'] });
  assert.ok(removedOne.doc.assets.asset_1);
  const removedLast = applyCommand(removedOne.doc, { type: 'delete_objects', ids: [duplicateId] });
  assert.equal(Object.keys(removedLast.doc.assets).length, 0);
  const restored = applyCommand(removedLast.doc, removedLast.inverseCmd);
  assert.ok(restored.doc.assets.asset_1);
  assert.ok(restored.doc.objects[duplicateId]);
  assert.equal(validateDocument(restored.doc).valid, true);
});

test('locked image rejects every mutation route except explicit unlock without history', () => {
  const doc = imageDocument();
  doc.objects.image_1.locked = true;
  const before = canonicalJson(doc);
  const commands = [
    { type: 'move_objects', ids: ['image_1'], dx: 20, dy: 20 },
    { type: 'resize_object', id: 'image_1', bounds: { x: 30, y: 40, width: 80, height: 80 } },
    { type: 'set_image_fit', id: 'image_1', fit: 'cover' },
    { type: 'set_image_opacity', id: 'image_1', opacity: 0.5 },
    { type: 'set_style', ids: ['image_1'], updates: { fill: '#f00' } },
    { type: 'duplicate_objects', ids: ['image_1'] },
    { type: 'delete_objects', ids: ['image_1'] },
    { type: 'reorder_objects', ids: ['image_1'], action: 'front' },
    { type: 'group_objects', ids: ['image_1', 'missing'] },
    { type: 'restore_positions', positions: { image_1: { x: 99, y: 99 } } },
    { type: 'restore_styles', styles: { image_1: { fill: '#f00', opacity: 0.2 } } },
    { type: 'restore_typography', typography: { image_1: { resolvedSize: 80 } } }
  ];
  for (const command of commands) {
    const result = applyCommand(doc, command);
    assert.equal(canonicalJson(result.doc), before, command.type);
    assert.equal(result.inverseCmd.type, 'noop', command.type);
  }
  const unlocked = applyCommand(doc, { type: 'lock_objects', ids: ['image_1'], locked: false });
  assert.equal(unlocked.doc.objects.image_1.locked, false);
});

test('restore commands atomically protect locked image order and group state', () => {
  const makeDocument = () => {
    const doc = imageDocument();
    doc.objects.image_1.locked = true;
    doc.objects.shape_1 = createDefaultObject('rectangle', { id: 'shape_1' }, doc.theme);
    doc.order.push('shape_1');
    return doc;
  };
  const expectBlocked = (doc, command) => {
    const before = canonicalJson(doc);
    const result = applyCommand(doc, command);
    assert.equal(canonicalJson(result.doc), before, command.type);
    assert.equal(result.inverseCmd.type, 'noop', command.type);
  };

  const orderDoc = makeDocument();
  expectBlocked(orderDoc, { type: 'restore_order', order: ['shape_1', 'image_1'] });
  orderDoc.objects.image_1.locked = false;
  const reordered = applyCommand(orderDoc, { type: 'restore_order', order: ['shape_1', 'image_1'] });
  assert.deepEqual(reordered.doc.order, ['shape_1', 'image_1']);
  assert.equal(reordered.inverseCmd.type, 'restore_order');

  const assignmentDoc = makeDocument();
  expectBlocked(assignmentDoc, {
    type: 'restore_groups',
    groupIds: { image_1: 'group_new', shape_1: 'group_new' },
    removeGroup: null
  });
  expectBlocked(assignmentDoc, {
    type: 'restore_ungroup',
    groups: { group_new: { id: 'group_new', name: 'Restored' } },
    members: { image_1: 'group_new', shape_1: 'group_new' }
  });

  const memberDoc = makeDocument();
  memberDoc.groups.group_locked = { id: 'group_locked', name: 'Locked group' };
  memberDoc.objects.image_1.groupId = 'group_locked';
  memberDoc.objects.shape_1.groupId = 'group_locked';
  expectBlocked(memberDoc, {
    type: 'restore_groups',
    groupIds: { shape_1: null },
    removeGroup: 'group_locked'
  });
  expectBlocked(memberDoc, {
    type: 'restore_ungroup',
    groups: { group_locked: { id: 'group_locked', name: 'Changed group' } },
    members: { shape_1: null }
  });

  const unlockedDoc = makeDocument();
  unlockedDoc.objects.image_1.locked = false;
  const restoredGroup = applyCommand(unlockedDoc, {
    type: 'restore_groups',
    groupIds: { image_1: 'group_unlocked', shape_1: 'group_unlocked' }
  });
  assert.equal(restoredGroup.doc.objects.image_1.groupId, 'group_unlocked');
  assert.equal(restoredGroup.doc.objects.shape_1.groupId, 'group_unlocked');
  const restoredUngroup = applyCommand(unlockedDoc, {
    type: 'restore_ungroup',
    groups: { group_unlocked: { id: 'group_unlocked', name: 'Unlocked group' } },
    members: { image_1: 'group_unlocked', shape_1: 'group_unlocked' }
  });
  assert.equal(restoredUngroup.doc.objects.image_1.groupId, 'group_unlocked');
  assert.equal(restoredUngroup.doc.objects.shape_1.groupId, 'group_unlocked');
});

test('blocked locked-image restore batches create no reducer or public API history', () => {
  const doc = imageDocument();
  doc.objects.image_1.locked = true;
  doc.objects.image_1.groupId = 'group_locked';
  doc.objects.shape_1 = createDefaultObject('rectangle', {
    id: 'shape_1',
    groupId: 'group_locked'
  }, doc.theme);
  doc.groups.group_locked = { id: 'group_locked', name: 'Locked group' };
  doc.order.push('shape_1');
  const commands = [
    { type: 'restore_order', order: ['shape_1', 'image_1'] },
    { type: 'restore_groups', groupIds: { shape_1: null }, removeGroup: 'group_locked' },
    {
      type: 'restore_ungroup',
      groups: { group_locked: { id: 'group_locked', name: 'Changed group' } },
      members: { shape_1: null }
    }
  ];
  const before = canonicalJson(doc);

  for (const command of commands) {
    const batch = applyCommandBatch(doc, [command]);
    assert.equal(canonicalJson(batch.doc), before, command.type);
    assert.equal(batch.inverseCmd.type, 'noop', command.type);
  }

  const app = Object.create(SaburaApp.prototype);
  app.doc = doc;
  app.isCorrupted = false;
  app.undoStack = [];
  app.redoStack = [];
  app.status = 'Clean';
  app.updateUI = () => {};
  app.notifySubscribers = () => {};
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    app.exposeApi();
    const result = globalThis.window.sabura.applyCommands(commands);
    assert.equal(result.success, true);
    assert.equal(canonicalJson(app.doc), before);
    assert.equal(app.undoStack.length, 0);
    assert.equal(app.redoStack.length, 0);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('cut and paste preserves sole and shared image asset ownership', () => {
  const source = imageDocument();
  const app = Object.create(SaburaApp.prototype);
  app.doc = source;
  app.workspace = { selectedIds: ['image_1'], activeGroupId: null, render() {} };
  app.dispatchCommand = command => { app.doc = applyCommand(app.doc, command).doc; };
  app.dispatchCommandBatch = commands => { app.doc = applyCommandBatch(app.doc, commands).doc; };
  app.copy();
  app.cut();
  assert.equal(Object.keys(app.doc.assets).length, 0);
  app.paste();
  assert.equal(Object.keys(app.doc.assets).length, 1);
  assert.equal(Object.values(app.doc.objects).filter(object => object.type === 'image').length, 1);

  const shared = imageDocument();
  const duplicate = applyCommand(shared, { type: 'duplicate_objects', ids: ['image_1'] });
  const duplicateId = duplicate.doc.order[1];
  const sharedApp = Object.create(SaburaApp.prototype);
  sharedApp.doc = duplicate.doc;
  sharedApp.workspace = { selectedIds: ['image_1'], activeGroupId: null, render() {} };
  sharedApp.dispatchCommand = command => { sharedApp.doc = applyCommand(sharedApp.doc, command).doc; };
  sharedApp.dispatchCommandBatch = commands => { sharedApp.doc = applyCommandBatch(sharedApp.doc, commands).doc; };
  sharedApp.copy();
  sharedApp.cut();
  sharedApp.paste();
  assert.equal(Object.keys(sharedApp.doc.assets).length, 1);
  assert.equal(Object.values(sharedApp.doc.objects).filter(object => object.type === 'image').length, 2);
  assert.equal(sharedApp.doc.objects[duplicateId].assetId, 'asset_1');
});

test('application cut/paste image history restores assets across undo and redo', () => {
  const app = Object.create(SaburaApp.prototype);
  app.doc = imageDocument();
  app.workspace = { selectedIds: ['image_1'], activeGroupId: null, render() {} };
  app.undoStack = [];
  app.redoStack = [];
  app.exportBaseline = null;
  app.status = 'Clean';
  app.subscribers = new Set();
  app.updateUI = () => {};
  app.dispatchCommand = SaburaApp.prototype.dispatchCommand.bind(app);
  app.dispatchCommandBatch = SaburaApp.prototype.dispatchCommandBatch.bind(app);

  app.copy();
  app.cut();
  assert.equal(Object.keys(app.doc.objects).length, 0);
  assert.equal(Object.keys(app.doc.assets).length, 0, 'cut removes the final live asset reference');
  assert.equal(app.undo(), true);
  assert.ok(app.doc.objects.image_1);
  assert.deepEqual(app.doc.assets.asset_1, imageDocument().assets.asset_1);
  assert.equal(app.redo(), true);
  assert.equal(Object.keys(app.doc.objects).length, 0);
  assert.equal(Object.keys(app.doc.assets).length, 0);

  app.paste();
  const pasted = Object.values(app.doc.objects).find(object => object.type === 'image');
  assert.ok(pasted);
  assert.equal(pasted.assetId, 'asset_1');
  assert.equal(Object.keys(app.doc.assets).length, 1);
  assert.equal(app.undo(), true);
  assert.equal(Object.keys(app.doc.objects).length, 0);
  assert.equal(Object.keys(app.doc.assets).length, 0);
  assert.equal(app.redo(), true);
  assert.equal(Object.keys(app.doc.objects).length, 1);
  assert.equal(Object.keys(app.doc.assets).length, 1);
  assert.equal(validateDocument(app.doc).valid, true);

  const sharedApp = Object.create(SaburaApp.prototype);
  const sharedDoc = imageDocument();
  const sharedResult = applyCommand(sharedDoc, { type: 'duplicate_objects', ids: ['image_1'] });
  sharedApp.doc = sharedResult.doc;
  const sharedId = sharedApp.doc.order[1];
  sharedApp.workspace = { selectedIds: ['image_1'], activeGroupId: null, render() {} };
  sharedApp.undoStack = [];
  sharedApp.redoStack = [];
  sharedApp.exportBaseline = null;
  sharedApp.status = 'Clean';
  sharedApp.subscribers = new Set();
  sharedApp.updateUI = () => {};
  sharedApp.dispatchCommand = SaburaApp.prototype.dispatchCommand.bind(sharedApp);
  sharedApp.dispatchCommandBatch = SaburaApp.prototype.dispatchCommandBatch.bind(sharedApp);
  sharedApp.copy();
  sharedApp.cut();
  assert.ok(sharedApp.doc.objects[sharedId]);
  assert.ok(sharedApp.doc.assets.asset_1, 'shared asset survives cutting one reference');
  assert.equal(sharedApp.undo(), true);
  assert.equal(sharedApp.redo(), true);
  sharedApp.paste();
  const sharedPasted = Object.values(sharedApp.doc.objects).find(object => object.id !== sharedId && object.id !== 'image_1');
  assert.ok(sharedPasted);
  assert.equal(sharedPasted.assetId, 'asset_1');
  assert.equal(Object.keys(sharedApp.doc.assets).length, 1);
  assert.equal(validateDocument(sharedApp.doc).valid, true);
});

test('image wheels keep eight slots and omit shape controls in single and all-image multi contexts', () => {
  const doc = imageDocument();
  const wheel = Object.create(ToolWheel.prototype);
  wheel.selectedObjects = [doc.objects.image_1];
  wheel.selectedObject = doc.objects.image_1;
  wheel.selectedCount = 1;
  wheel.context = 'object';
  const single = wheel.getItems();
  assert.equal(single.length, 8);
  assert.ok(single.some(item => item.id === 'menu_image_fit'));
  assert.ok(single.every(item => !['menu_style', 'menu_ink', 'menu_type'].includes(item.id)));
  assert.equal(single[3].id, 'action_duplicate');
  assert.equal(single[4].id, 'menu_order');
  assert.equal(single[7].id, 'action_delete');

  const duplicate = applyCommand(doc, { type: 'duplicate_objects', ids: ['image_1'] });
  wheel.selectedObjects = Object.values(duplicate.doc.objects).filter(object => object.type === 'image');
  wheel.selectedObject = wheel.selectedObjects[0];
  wheel.selectedCount = 2;
  const multi = wheel.getItems();
  assert.equal(multi.length, 8);
  assert.ok(multi.some(item => item.id === 'menu_image_fit'));
  assert.ok(multi.every(item => !['menu_style', 'menu_ink', 'menu_type'].includes(item.id)));
  assert.equal(multi[3].id, 'action_duplicate');
  assert.equal(multi[4].id, 'menu_order');
  assert.equal(multi[7].id, 'action_delete');

  doc.objects.image_1.locked = true;
  wheel.selectedObjects = [doc.objects.image_1];
  wheel.selectedObject = doc.objects.image_1;
  wheel.selectedCount = 1;
  const lockedSingle = wheel.getItems();
  assert.equal(lockedSingle[3].disabled, true);
  assert.equal(lockedSingle[4].disabled, true);
  assert.equal(lockedSingle[5].id, 'action_unlock');
  assert.equal(lockedSingle[7].disabled, true);

  const lockedMultiDoc = imageDocument();
  const lockedDuplicate = applyCommand(lockedMultiDoc, { type: 'duplicate_objects', ids: ['image_1'] }).doc;
  for (const object of Object.values(lockedDuplicate.objects)) {
    if (object.type === 'image') object.locked = true;
  }
  wheel.selectedObjects = Object.values(lockedDuplicate.objects).filter(object => object.type === 'image');
  wheel.selectedObject = wheel.selectedObjects[0];
  wheel.selectedCount = 2;
  const lockedMulti = wheel.getItems();
  assert.equal(lockedMulti[3].id, 'action_duplicate');
  assert.equal(lockedMulti[3].disabled, true);
  assert.equal(lockedMulti[4].id, 'menu_order');
  assert.equal(lockedMulti[4].disabled, true);
  assert.equal(lockedMulti[5].id, 'action_unlock');
  assert.equal(lockedMulti[7].id, 'action_delete');
  assert.equal(lockedMulti[7].disabled, true);
});

test('image fit rendering uses native SVG image and clips cover without changing bytes', () => {
  const doc = imageDocument();
  const image = doc.objects.image_1;
  const contain = renderObject(doc, image);
  assert.match(contain, /<image[^>]+preserveAspectRatio="xMidYMid meet"/);
  assert.doesNotMatch(contain, /preserveAspectRatio="xMidYMid slice"/);
  image.fit = 'cover';
  image.rotation = 37;
  const cover = renderObject(doc, image);
  assert.match(cover, /<clipPath id="clip-image-[^"]+"/);
  assert.match(cover, /preserveAspectRatio="xMidYMid slice"/);
  assert.match(cover, /transform="rotate\(37/);
  assert.equal(canonicalJson(doc).includes(PNG), true);
});

test('cover clip IDs remain distinct for IDs that normalize to the same legacy value', () => {
  const doc = imageDocument();
  const second = createDefaultObject('image', {
    id: 'cover_a', assetId: 'asset_1', x: 520, y: 20, width: 480, height: 320, fit: 'cover'
  }, doc.theme);
  doc.objects['cover a'] = { ...doc.objects.image_1, id: 'cover a', fit: 'cover' };
  doc.objects[second.id] = second;
  const firstMarkup = renderObject(doc, doc.objects['cover a']);
  const secondMarkup = renderObject(doc, second);
  const firstClip = firstMarkup.match(/clipPath id="([^"]+)"/)?.[1];
  const secondClip = secondMarkup.match(/clipPath id="([^"]+)"/)?.[1];
  assert.ok(firstClip && secondClip);
  assert.notEqual(firstClip, secondClip);
});

test('batch image creation rolls back when the resulting document is invalid', () => {
  const doc = createDefaultDocument();
  const source = imageDocument();
  assert.throws(() => applyCommandBatch(doc, [
    { type: 'create_asset', asset: source.assets.asset_1 },
    { type: 'create_object', object: { ...source.objects.image_1, assetId: 'missing' } }
  ]), /resulting document is invalid|Batch execution failed/);
  assert.deepEqual(doc.assets, {});
  assert.deepEqual(doc.objects, {});
});

test('packaging and reopening preserves raster bytes and image metadata offline', () => {
  const doc = imageDocument();
  const shell = fs.readFileSync(new URL('../sabura.html', import.meta.url), 'utf8');
  const packed = packageHtmlWithDocument(shell, doc);
  assert.equal(packed.success, true);
  assert.ok(packed.html.includes(PNG));
  const reopened = extractDocumentFromHtml(packed.html);
  assert.equal(reopened.valid, true);
  assert.deepEqual(reopened.document.assets.asset_1, doc.assets.asset_1);
  assert.equal(reopened.document.objects.image_1.assetId, 'asset_1');
  const repacked = packageHtmlWithDocument(packed.html, reopened.document);
  assert.equal(repacked.success, true, 'normalized reopened image documents remain packageable');
});

test('async image import is cancelled when Editing ends before native callbacks commit', () => {
  const originalReader = globalThis.FileReader;
  const originalImage = globalThis.Image;
  let reader;
  globalThis.FileReader = class DeferredReader {
    readAsDataURL() { reader = this; }
    abort() { this.aborted = true; }
  };
  globalThis.Image = class DeferredImage {
    set src(value) { this.data = value; }
    get naturalWidth() { return 1; }
    get naturalHeight() { return 1; }
  };

  try {
    const app = Object.create(SaburaApp.prototype);
    app.doc = createDefaultDocument({ title: 'Async image cancellation' });
    app.mode = 'editing';
    app.isSaving = false;
    app.imageImportToken = 0;
    app.pendingImageReader = null;
    app.pendingImageDecode = null;
    app.undoStack = [];
    app.redoStack = [];
    app.workspace = {
      selectedIds: [],
      cancelGesture() {},
      setMode() {},
      render() {},
      setTool() {}
    };
    app.wheel = { close() {} };
    app.helpModal = { close() {} };
    app.updateUI = () => {};
    app.reportImageImportError = message => { throw new Error(`unexpected import error: ${message}`); };
    app.dispatchCommand = () => { throw new Error('cancelled import must not dispatch'); };

    app.importImageFile(new File([Buffer.from(PNG.split(',')[1], 'base64')], 'tiny.png', { type: 'image/png' }), { x: 100, y: 100 });
    assert.ok(reader, 'native reader should be started');
    app.setMode('reading');
    reader.result = PNG;
    reader.onload();
    assert.equal(Object.keys(app.doc.objects).length, 0);
    assert.equal(Object.keys(app.doc.assets).length, 0);
    assert.equal(app.pendingImageReader, null);
    assert.equal(app.pendingImageDecode, null);
  } finally {
    if (originalReader === undefined) delete globalThis.FileReader;
    else globalThis.FileReader = originalReader;
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
  }
});

test('pending image imports are cancelled by Presentation and Save Copy boundaries', () => {
  const originalReader = globalThis.FileReader;
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  const readers = [];
  globalThis.FileReader = class DeferredReader {
    readAsDataURL() { readers.push(this); }
    abort() { this.aborted = true; }
  };
  globalThis.Image = class DeferredImage {};
  globalThis.document = {
    body: { classList: { add() {}, remove() {} } },
    documentElement: {},
    fullscreenElement: null
  };

  const makeApp = () => {
    const app = Object.create(SaburaApp.prototype);
    app.doc = createDefaultDocument({ title: 'Boundary cancellation' });
    app.mode = 'editing';
    app.isSaving = false;
    app.imageImportToken = 0;
    app.pendingImageReader = null;
    app.pendingImageDecode = null;
    app.undoStack = [];
    app.redoStack = [];
    app.workspace = {
      camera: { x: 0, y: 0, zoom: 1 },
      selectedIds: [],
      cancelGesture() {},
      setMode() {},
      fitToContent() {},
      render() {}
    };
    app.textEditor = null;
    app.wheel = { close() {} };
    app.helpModal = { close() {} };
    app.wheelFab = null;
    app.laser = { start() {}, resize() {}, stop() {} };
    app.updateUI = () => {};
    app.notifySubscribers = () => {};
    app.getCleanHtmlShell = () => '';
    app.reportImageImportError = message => { throw new Error(`unexpected import error: ${message}`); };
    app.dispatchCommand = () => { throw new Error('cancelled import must not dispatch'); };
    return app;
  };
  const file = new File([Buffer.from(PNG.split(',')[1], 'base64')], 'tiny.png', { type: 'image/png' });

  try {
    const presentationApp = makeApp();
    presentationApp.importImageFile(file, { x: 100, y: 100 });
    const presentationReader = readers.at(-1);
    presentationApp.enterPresentation();
    presentationReader.result = PNG;
    presentationReader.onload();
    assert.equal(Object.keys(presentationApp.doc.objects).length, 0);
    assert.equal(Object.keys(presentationApp.doc.assets).length, 0);
    assert.deepEqual(presentationApp.workspace.selectedIds, []);
    assert.equal(presentationApp.undoStack.length, 0);

    const saveApp = makeApp();
    saveApp.importImageFile(file, { x: 100, y: 100 });
    const saveReader = readers.at(-1);
    const saveResult = saveApp.saveCopy();
    saveReader.result = PNG;
    saveReader.onload();
    assert.equal(saveResult.success, false);
    assert.equal(Object.keys(saveApp.doc.objects).length, 0);
    assert.equal(Object.keys(saveApp.doc.assets).length, 0);
    assert.deepEqual(saveApp.workspace.selectedIds, []);
    assert.equal(saveApp.undoStack.length, 0);
  } finally {
    if (originalReader === undefined) delete globalThis.FileReader;
    else globalThis.FileReader = originalReader;
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('native image drops prevent navigation, preserve no-op history, and use camera coordinates', () => {
  const app = Object.create(SaburaApp.prototype);
  app.doc = createDefaultDocument({ title: 'Drop entry point' });
  app.mode = 'editing';
  app.inPresentation = false;
  app.undoStack = [];
  app.redoStack = [{ type: 'noop' }];
  app.status = 'Clean';
  app.appElement = { contains: target => target === 'inside' };
  let dropActive = false;
  app.canvasContainer = {
    classList: { toggle: (_, active) => { dropActive = active; } }
  };
  app.workspace = {
    screenToWorld: (x, y) => ({ x: (x - 40) / 2, y: (y + 20) / 2 })
  };
  const imported = [];
  const errors = [];
  app.importImageFile = (file, point) => imported.push({ file, point });
  app.reportImageImportError = message => errors.push(message);
  const png = new File(['png'], 'one.png', { type: 'image/png' });
  const jpeg = new File(['jpeg'], 'two.jpg', { type: 'image/jpeg' });
  const transfer = files => ({
    items: files.map(file => ({ kind: 'file', type: file.type })),
    files,
    dropEffect: 'none'
  });
  const event = (dataTransfer, extras = {}) => ({
    dataTransfer,
    clientX: 240,
    clientY: 180,
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    ...extras
  });
  const before = canonicalJson(app.doc);

  const over = event(transfer([png]));
  app.handleImageDragOver(over);
  assert.equal(over.prevented, true);
  assert.equal(over.dataTransfer.dropEffect, 'copy');
  assert.equal(dropActive, true);
  app.handleImageDragLeave({ relatedTarget: 'inside' });
  assert.equal(dropActive, true, 'moving within the editor keeps the affordance');
  app.handleImageDragLeave({ relatedTarget: null });
  assert.equal(dropActive, false, 'leaving the editor clears the affordance');

  const multiple = event(transfer([png, jpeg]));
  app.handleImageDrop(multiple);
  assert.equal(multiple.prevented, true);
  assert.equal(multiple.stopped, true);
  assert.deepEqual(errors, ['Drop one image at a time.']);
  assert.equal(imported.length, 0);
  assert.equal(canonicalJson(app.doc), before);
  assert.equal(app.undoStack.length, 0);
  assert.equal(app.redoStack.length, 1, 'rejected drop preserves redo history');

  const single = event(transfer([png]));
  app.handleImageDrop(single);
  assert.deepEqual(imported, [{ file: png, point: { x: 100, y: 100 } }]);
  assert.equal(dropActive, false);

  app.mode = 'reading';
  const reading = event(transfer([jpeg]));
  app.handleImageDrop(reading);
  assert.equal(reading.prevented, true, 'Reading still prevents browser navigation');
  assert.equal(imported.length, 1, 'Reading cannot import');
  app.mode = 'editing';
  app.inPresentation = true;
  const presentation = event(transfer([jpeg]));
  app.handleImageDrop(presentation);
  assert.equal(presentation.prevented, true);
  assert.equal(imported.length, 1, 'Presentation cannot import');
});
