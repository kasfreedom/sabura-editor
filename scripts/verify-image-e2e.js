import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// Deterministic native-browser acceptance coverage for Handoff 004. This uses
// Chrome's file-input, pointer, Blob, and iframe APIs with no dependencies.
const rootDir = path.resolve('.');
const port = 8093;
const chromePort = 9261;
const fixtures = {
  png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  jpeg: '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMQD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAABAAEDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAE1/f//Z',
  webp: 'UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ0f/+ByKi/wEA'
};

const server = http.createServer((req, res) => {
  const requested = decodeURIComponent((req.url || '/').split('?')[0]);
  if (requested === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const filePath = path.join(rootDir, requested === '/' ? 'sabura.html' : requested.replace(/^\/+/, ''));
  if (filePath === path.join(rootDir, 'sabura.html') && fs.existsSync(filePath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(404);
    res.end();
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${chromePort}`, '--disable-gpu',
  '--window-size=1280,800', 'about:blank'
]);

let ws;
try {
  let targetWsUrl;
  for (let i = 0; i < 50; i++) {
    await new Promise(resolve => setTimeout(resolve, 150));
    try {
      const response = await fetch(`http://127.0.0.1:${chromePort}/json/list`);
      const targets = await response.json();
      const page = targets.find(target => target.type === 'page');
      if (page?.webSocketDebuggerUrl) { targetWsUrl = page.webSocketDebuggerUrl; break; }
    } catch (_) {}
  }
  if (!targetWsUrl) throw new Error('Failed to connect to headless Chrome');
  ws = new WebSocket(targetWsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let messageId = 1;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = messageId++;
    const handler = event => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener('message', handler);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed');
    return result.result?.value;
  };
  const mouse = (type, x, y, modifiers = 0) => send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: type === 'mousePressed' ? 1 : 0, modifiers
  });
  const physicalDrag = async (from, to, modifiers = 0) => {
    await mouse('mousePressed', from.x, from.y, modifiers);
    await mouse('mouseMoved', to.x, to.y, modifiers);
    await mouse('mouseReleased', to.x, to.y, modifiers);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  const earlyErrors = [];
  const earlyErrorHandler = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      earlyErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'Runtime exception');
    } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      earlyErrors.push(message.params.entry.text || 'Console error');
    }
  };
  ws.addEventListener('message', earlyErrorHandler);
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/sabura.html` });
  await new Promise(resolve => setTimeout(resolve, 1200));

  // The page flow asks for a physical drag through a binding. This keeps
  // pointer routing in Chrome rather than invoking Workspace methods directly.
  await send('Runtime.addBinding', { name: '__saburaPhysicalDrag' });
  const bindingHandler = async event => {
    const message = JSON.parse(event.data);
    if (message.method !== 'Runtime.bindingCalled' || message.params.name !== '__saburaPhysicalDrag') return;
    const request = JSON.parse(message.params.payload);
    await physicalDrag(request.from, request.to, request.modifiers || 0);
    await evaluate('window.__resolveSaburaPhysicalDrag?.()');
  };
  ws.addEventListener('message', bindingHandler);

  const result = await evaluate(`(async () => {
    const app = window.saburaApp;
    if (!app) throw new Error('SaburaApp did not load');
    app.setMode('editing');
    const errors = [];
    const alerts = [];
    window.addEventListener('error', event => errors.push(String(event.message)));
    window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
    window.alert = message => alerts.push(String(message));
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const blobs = ${JSON.stringify(fixtures)};
    const mimeByKind = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
    const fileFor = (kind, name = kind + (kind === 'jpeg' ? '.jpg' : '.' + kind)) => {
      const raw = atob(blobs[kind]);
      return new File([Uint8Array.from(raw, ch => ch.charCodeAt(0))], name, { type: mimeByKind[kind] });
    };
    const objectsFor = doc => Object.values(doc.objects).filter(object => object.type === 'image');
    const imageCount = () => objectsFor(app.doc).length;
    const waitForImageCount = async count => {
      for (let i = 0; i < 60; i++) { if (imageCount() >= count) return true; await sleep(40); }
      return false;
    };
    const input = document.getElementById('image-file-input');
    const importThroughInput = async (kind, expectedCount) => {
      const transfer = new DataTransfer();
      transfer.items.add(fileFor(kind));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return waitForImageCount(expectedCount);
    };
    const physical = (from, to, modifiers = 0) => new Promise(resolve => {
      window.__resolveSaburaPhysicalDrag = resolve;
      window.__saburaPhysicalDrag(JSON.stringify({ from, to, modifiers }));
    });

    // Entry wheel and exact lowercase shortcut share the native picker action.
    const canvasItems = app.wheel.getCanvasItems();
    const entryWheel = canvasItems.length === 8 && canvasItems[3]?.id === 'image_import' &&
      canvasItems[0]?.subItems?.map(item => item.id).join(',') ===
        'shape_rectangle,shape_ellipse,shape_diamond,shape_triangle,tool_line';
    const nativeInputClick = input.click.bind(input);
    let shortcutClicks = 0;
    input.click = () => { shortcutClicks++; };
    const expectedShortcutPoint = app.workspace.screenToWorld(612, 347);
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 612, clientY: 347 }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i' }));
    const shortcutPoint = { ...app.imageImportPoint };
    for (const event of [
      new KeyboardEvent('keydown', { key: 'I', shiftKey: true }),
      new KeyboardEvent('keydown', { key: 'i', shiftKey: true }),
      new KeyboardEvent('keydown', { key: 'i', ctrlKey: true }),
      new KeyboardEvent('keydown', { key: 'i', metaKey: true }),
      new KeyboardEvent('keydown', { key: 'i', altKey: true })
    ]) window.dispatchEvent(event);
    app.setMode('reading');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i' }));
    app.setMode('editing');
    app.inPresentation = true;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i' }));
    app.inPresentation = false;
    const typingInput = document.createElement('input');
    document.body.appendChild(typingInput);
    typingInput.focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i' }));
    typingInput.remove();
    const shortcutExact = shortcutClicks === 1 && shortcutPoint.x === expectedShortcutPoint.x &&
      shortcutPoint.y === expectedShortcutPoint.y;
    input.click = nativeInputClick;

    // Actual wheel -> native input boundary for PNG, JPEG, and WebP.
    app.handleWheelAction('image_import');
    const inputBoundary = await importThroughInput('png', 1);
    app.handleWheelAction('image_import');
    const jpegBoundary = await importThroughInput('jpeg', 2);
    app.handleWheelAction('image_import');
    const webpBoundary = await importThroughInput('webp', 3);
    const imported = objectsFor(app.doc);
    const mimeCoverage = imported.map(object => app.doc.assets[object.assetId].mimeType).sort();
    let png = imported[0];
    let second = imported[1];
    const pngId = png.id;
    const secondId = second.id;
    const livePng = () => app.doc.objects[pngId];
    const liveSecond = () => app.doc.objects[secondId];

    // Native DataTransfer/File drop at a non-default camera point.
    app.workspace.camera = { x: 80, y: 50, zoom: 2 };
    const dropPoint = { clientX: 680, clientY: 450 };
    const dropTransfer = new DataTransfer();
    dropTransfer.items.add(fileFor('png', 'dropped.png'));
    const dragOver = new DragEvent('dragover', { ...dropPoint, dataTransfer: dropTransfer, bubbles: true, cancelable: true });
    document.getElementById('app').dispatchEvent(dragOver);
    const dropAffordance = dragOver.defaultPrevented && document.getElementById('canvas-container').classList.contains('image-drop-active');
    app.setMode('reading');
    const modeClearedAffordance = !document.getElementById('canvas-container').classList.contains('image-drop-active');
    app.setMode('editing');
    document.getElementById('app').dispatchEvent(new DragEvent('dragover', {
      ...dropPoint, dataTransfer: dropTransfer, bubbles: true, cancelable: true
    }));
    const dragExit = new DragEvent('dragleave', { dataTransfer: dropTransfer, bubbles: true, cancelable: true, relatedTarget: null });
    document.getElementById('app').dispatchEvent(dragExit);
    const dragExitCleared = !document.getElementById('canvas-container').classList.contains('image-drop-active');
    const undoBeforeDrop = app.undoStack.length;
    const nativeDrop = new DragEvent('drop', { ...dropPoint, dataTransfer: dropTransfer, bubbles: true, cancelable: true });
    document.getElementById('app').dispatchEvent(nativeDrop);
    const dropImported = await waitForImageCount(4);
    const dropped = objectsFor(app.doc).find(object => !imported.some(previous => previous.id === object.id));
    const dropPlaced = Boolean(dropped && Math.abs(dropped.x + dropped.width / 2 - 300) < 0.001 &&
      Math.abs(dropped.y + dropped.height / 2 - 200) < 0.001);
    const dropSelected = app.workspace.selectedIds.length === 1 && app.workspace.selectedIds[0] === dropped?.id;
    const dropHistory = app.undoStack.length === undoBeforeDrop + 1 && app.redoStack.length === 0;
    const dropUndone = app.undo() && !app.doc.objects[dropped?.id];
    const dropRedone = app.redo() && Boolean(app.doc.objects[dropped?.id]);

    const dropNoOpState = () => JSON.stringify({
      doc: window.sabura.exportCanonicalJson(), undo: app.undoStack.length, redo: app.redoStack.length,
      selected: app.workspace.selectedIds, status: app.status
    });
    const beforeRejectedDrops = dropNoOpState();
    const multipleTransfer = new DataTransfer();
    multipleTransfer.items.add(fileFor('png', 'one.png'));
    multipleTransfer.items.add(fileFor('jpeg', 'two.jpg'));
    document.getElementById('app').dispatchEvent(new DragEvent('drop', {
      ...dropPoint, dataTransfer: multipleTransfer, bubbles: true, cancelable: true
    }));
    const textTransfer = new DataTransfer();
    textTransfer.items.add(new File(['plain'], 'plain.txt', { type: 'text/plain' }));
    document.getElementById('app').dispatchEvent(new DragEvent('drop', {
      ...dropPoint, dataTransfer: textTransfer, bubbles: true, cancelable: true
    }));
    const rejectedDropNoOp = dropNoOpState() === beforeRejectedDrops &&
      alerts.some(message => message.toLowerCase().includes('one image at a time'));

    app.setMode('reading');
    const beforeReadingDrop = dropNoOpState();
    const readingDrop = new DragEvent('drop', { ...dropPoint, dataTransfer: dropTransfer, bubbles: true, cancelable: true });
    document.getElementById('app').dispatchEvent(readingDrop);
    const readingDropSuppressed = readingDrop.defaultPrevented && dropNoOpState() === beforeReadingDrop;
    app.setMode('editing');
    app.inPresentation = true;
    const beforePresentationDrop = dropNoOpState();
    const presentationDrop = new DragEvent('drop', { ...dropPoint, dataTransfer: dropTransfer, bubbles: true, cancelable: true });
    document.getElementById('app').dispatchEvent(presentationDrop);
    const presentationDropSuppressed = presentationDrop.defaultPrevented && dropNoOpState() === beforePresentationDrop;
    app.inPresentation = false;

    // Duplicate through the app action so two image objects intentionally share
    // one canonical asset before the save/reopen assertion.
    app.workspace.selectedIds = [png.id];
    app.handleWheelAction('action_duplicate');
    const sharedDuplicate = objectsFor(app.doc).find(object => object.id !== pngId && object.assetId === livePng().assetId);
    const sharedDuplicateId = sharedDuplicate?.id;
    const sharedAsset = Boolean(sharedDuplicate && app.doc.assets[livePng().assetId] && app.doc.assets[livePng().assetId].data === app.doc.assets[sharedDuplicate.assetId].data);

    // The deterministic 1x1 fixtures import at intrinsic size. Give the two
    // interaction targets roomy, known bounds before testing pointer routing.
    app.dispatchCommand({ type: 'resize_object', id: pngId, bounds: { x: 100, y: 120, width: 240, height: 160 } });
    app.dispatchCommand({ type: 'resize_object', id: secondId, bounds: { x: 520, y: 120, width: 200, height: 140 } });
    png = livePng(); second = liveSecond();
    app.workspace.selectedIds = [pngId];
    app.wheel.open(280, 220, 'object', png, app.doc.theme.palette, 1, [png]);
    const imageWheelItems = app.wheel.getItems();
    const imageWheel = imageWheelItems.length === 8 && imageWheelItems.some(item => item.id === 'menu_image_fit') &&
      imageWheelItems.every(item => !['menu_style', 'menu_ink', 'menu_type'].includes(item.id));
    app.wheel.close();

    // Picker cancellation and malformed payload are no-op/error paths.
    const countBeforeReject = imageCount();
    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const cancelNoOp = imageCount() === countBeforeReject;
    const badTransfer = new DataTransfer();
    badTransfer.items.add(new File([new TextEncoder().encode('not an image')], 'spoof.png', { type: 'image/png' }));
    input.files = badTransfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(120);
    const errorNoPartial = imageCount() === countBeforeReject && alerts.length > 0 && !alerts.some(message => message.includes('not an image'));

    // A delayed native reader must not commit when Editing ends before callback.
    const originalReader = window.FileReader;
    let delayedReader;
    window.FileReader = class DelayedReader { readAsDataURL() { delayedReader = this; } abort() { this.aborted = true; } };
    const countBeforeModeCancel = imageCount();
    app.importImageFile(fileFor('png'), { x: 400, y: 300 });
    app.setMode('reading');
    delayedReader.onload?.();
    await sleep(30);
    const modeCancelNoOp = imageCount() === countBeforeModeCancel && app.mode === 'reading';
    window.FileReader = originalReader;
    app.setMode('editing');

    // Non-default zoom/pan, then real pointer move, resize, and snapped rotation.
    app.workspace.camera = { x: 97, y: 63, zoom: 1.65 };
    app.workspace.selectedIds = [png.id];
    app.workspace.render();
    const screen = point => app.workspace.worldToScreen(point.x, point.y);
    const center = object => {
      const element = document.querySelector('[data-id="' + object.id + '"]');
      if (element) { const box = element.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; }
      return screen({ x: object.x + object.width / 2, y: object.y + object.height / 2 });
    };
    const handle = id => {
      const element = document.querySelector('[data-handle="' + id + '"]');
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    };
    const beforeMove = { x: livePng().x, y: livePng().y };
    const moveFrom = center(livePng());
    await physical(moveFrom, { x: moveFrom.x + 46, y: moveFrom.y + 31 });
    png = livePng();
    const moved = png.x !== beforeMove.x && png.y !== beforeMove.y;
    const movedX = png.x;
    const movedY = png.y;
    const moveUndone = app.undo() && livePng().x === beforeMove.x && livePng().y === beforeMove.y;
    const moveRedone = app.redo() && livePng().x === movedX && livePng().y === movedY;
    png = livePng();
    const beforeResize = { width: png.width, height: png.height };
    app.workspace.selectedIds = [pngId]; app.workspace.render();
    const se = handle('se');
    if (!se) throw new Error('Image resize handle was not rendered');
    await physical(se, { x: se.x + 52, y: se.y + 28 });
    png = livePng();
    const resized = png.width !== beforeResize.width && png.height !== beforeResize.height;
    app.workspace.selectedIds = [pngId]; app.workspace.render();
    const rotationHandle = handle('rotate');
    if (!rotationHandle) throw new Error('Image rotate handle was not rendered');
    const pivot = center(livePng());
    await physical(rotationHandle, { x: pivot.x + 110, y: pivot.y + 20 }, 8);
    png = livePng();
    const rotated = Math.abs(png.rotation || 0) > 0;

    // Create an attached connector before grouping, through the real pointer path.
    app.workspace.setTool('connector');
    await physical(center(livePng()), center(liveSecond()));
    let connector = Object.values(app.doc.objects).filter(object => object.type === 'connector').at(-1);
    const attachedConnector = Boolean(connector && (connector.from?.id === pngId || connector.to?.id === pngId) && (connector.from?.id === secondId || connector.to?.id === secondId));

    // Physical multi-selection movement and image-only group controls.
    app.workspace.selectedIds = [pngId, secondId]; app.workspace.render();
    const beforeMulti = { x: liveSecond().x, y: liveSecond().y };
    // Start on a selected image itself; the union midpoint may be empty space
    // when the two images are deliberately separated for connector testing.
    const multiStart = center(livePng());
    await physical(multiStart, { x: multiStart.x + 24, y: multiStart.y + 18 });
    second = liveSecond();
    const multiMoved = second.x !== beforeMulti.x || second.y !== beforeMulti.y;
    app.workspace.selectedIds = [pngId, secondId];
    app.handleWheelAction('action_group');
    png = livePng(); second = liveSecond();
    const grouped = Boolean(png.groupId && second.groupId);

    // Delete one of the shared references and restore it through exact undo/redo.
    app.workspace.selectedIds = [sharedDuplicateId];
    app.handleWheelAction('action_delete');
    const sharedRetainedAfterDelete = Boolean(app.doc.assets[png.assetId] && !app.doc.objects[sharedDuplicateId]);
    const deleteUndone = app.undo() && Boolean(app.doc.objects[sharedDuplicateId]);
    const deleteRedone = app.redo() && !app.doc.objects[sharedDuplicateId] && Boolean(app.doc.assets[png.assetId]);
    app.undo();
    png = livePng();

    // Lock through the image wheel, then prove physical movement is suppressed.
    app.workspace.selectedIds = [pngId]; app.workspace.setTool('select'); app.workspace.render();
    app.handleWheelAction('action_lock');
    png = livePng();
    const lockedX = png.x;
    const lockedCenter = center(png);
    await physical(lockedCenter, { x: lockedCenter.x + 60, y: lockedCenter.y + 60 });
    png = livePng();
    const lockedPreserved = png.locked === true && png.x === lockedX;

    // Capture Save Copy's actual Blob and reopen it offline in a second document.
    let capturedBlob = null;
    const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
    const nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { capturedBlob = blob; return nativeCreateObjectURL(blob); };
    URL.revokeObjectURL = url => nativeRevokeObjectURL(url);
    app.handleWheelAction('action_unlock');
    app.workspace.selectedIds = [pngId];
    app.handleWheelAction('image_fit_cover');
    app.handleWheelAction('opacity_75', { value: 0.75 });
    png = livePng();
    const preSaveDoc = JSON.parse(JSON.stringify(app.doc));
    const preSaveImages = objectsFor(preSaveDoc);
    const preSaveImageIds = new Set(preSaveImages.map(object => object.id));
    const preSaveImageFields = ['assetId', 'fit', 'opacity', 'x', 'y', 'width', 'height', 'rotation', 'groupId', 'locked'];
    const imageSnapshot = object => Object.fromEntries(preSaveImageFields.map(field => [field, object[field] ?? null]));
    const preSaveConnectors = Object.values(preSaveDoc.objects).filter(object => object.type === 'connector' &&
      (preSaveImageIds.has(object.from?.id) || preSaveImageIds.has(object.to?.id)));
    const connectorSnapshot = connectorObject => ({
      from: connectorObject.from ?? null, to: connectorObject.to ?? null,
      routing: connectorObject.routing ?? null, curveSide: connectorObject.curveSide ?? null,
      curveDistance: connectorObject.curveDistance ?? null, elbowOffset: connectorObject.elbowOffset ?? null
    });
    const rotatedBoundary = (object, target) => {
      const angle = -(object.rotation || 0) * Math.PI / 180;
      const cx = object.x + object.width / 2; const cy = object.y + object.height / 2;
      const tx = target.x - cx; const ty = target.y - cy;
      const dx = tx * Math.cos(angle) - ty * Math.sin(angle);
      const dy = tx * Math.sin(angle) + ty * Math.cos(angle);
      const scale = Math.min((object.width / 2) / Math.max(Math.abs(dx), 0.000001), (object.height / 2) / Math.max(Math.abs(dy), 0.000001));
      const lx = dx * scale; const ly = dy * scale;
      const outAngle = -angle;
      return { x: cx + lx * Math.cos(outAngle) - ly * Math.sin(outAngle), y: cy + lx * Math.sin(outAngle) + ly * Math.cos(outAngle) };
    };
    const connectorGeometry = (doc, connectorObject) => {
      const from = doc.objects[connectorObject.from?.id]; const to = doc.objects[connectorObject.to?.id];
      if (!from || !to) return null;
      const fromCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
      const toCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
      return { start: rotatedBoundary(from, fromCenter), end: rotatedBoundary(to, toCenter) };
    };
    const saved = app.saveCopy();
    const savedHtml = capturedBlob ? await capturedBlob.text() : '';
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    const iframeErrors = [];
    iframe.src = nativeCreateObjectURL(new Blob([savedHtml], { type: 'text/html' }));
    await new Promise(resolve => iframe.addEventListener('load', resolve, { once: true }));
    iframe.contentWindow.addEventListener('error', event => iframeErrors.push(String(event.message)));
    await sleep(300);
    const reopenedApp = iframe.contentWindow.saburaApp;
    const reopenedDoc = reopenedApp?.doc;
    const reopenedNativeImage = Boolean(iframe.contentDocument.querySelector('image[href^="data:image/"]'));
    const reopenedMetadata = Boolean(reopenedDoc?.assets?.[png.assetId]?.mimeType === 'image/png' && reopenedDoc?.objects?.[png.id]?.fit === 'cover');
    const reopenedImages = reopenedDoc ? objectsFor(reopenedDoc) : [];
    const reopenedSharedIds = reopenedImages.filter(object => object.assetId === png.assetId).map(object => object.id);
    const reopenedSharedAsset = reopenedSharedIds.length >= 2 && new Set(reopenedImages.map(object => object.assetId)).size < reopenedImages.length &&
      reopenedDoc.assets[png.assetId]?.data === app.doc.assets[png.assetId]?.data;
    const reopenedAssetState = reopenedImages.length === preSaveImages.length && preSaveImages.every(before => {
      const after = reopenedDoc.objects[before.id];
      const beforeAsset = preSaveDoc.assets[before.assetId];
      const afterAsset = reopenedDoc.assets[beforeAsset?.id];
      return after && afterAsset && JSON.stringify(imageSnapshot(after)) === JSON.stringify(imageSnapshot(before)) &&
        JSON.stringify({ data: afterAsset.data, mimeType: afterAsset.mimeType, width: afterAsset.width, height: afterAsset.height }) ===
        JSON.stringify({ data: beforeAsset.data, mimeType: beforeAsset.mimeType, width: beforeAsset.width, height: beforeAsset.height });
    });
    const reopenedOrder = JSON.stringify(reopenedDoc?.order) === JSON.stringify(preSaveDoc.order);
    const reopenedGroups = JSON.stringify(reopenedDoc?.groups) === JSON.stringify(preSaveDoc.groups);
    const reopenedConnectors = preSaveConnectors.length > 0 && preSaveConnectors.every(before => {
      const after = reopenedDoc?.objects?.[before.id];
      const beforeGeometry = connectorGeometry(preSaveDoc, before);
      const afterGeometry = after && connectorGeometry(reopenedDoc, after);
      const close = (a, b) => a && b && Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;
      return after && JSON.stringify(connectorSnapshot(after)) === JSON.stringify(connectorSnapshot(before)) &&
        close(beforeGeometry?.start, afterGeometry?.start) && close(beforeGeometry?.end, afterGeometry?.end);
    });
    const reopenedRevisionRecord = reopenedDoc?.['ext:sabura:revision'];
    const savedRevisionRecord = app.doc?.['ext:sabura:revision'];
    const revisionFields = ['version', 'revisionId', 'parentId', 'contentDigest'];
    const reopenedRevision = Boolean(reopenedRevisionRecord && savedRevisionRecord
      && revisionFields.every((field) => reopenedRevisionRecord[field] === savedRevisionRecord[field]));
    const reopenedPixelByAsset = Object.fromEntries(await Promise.all([...new Set(reopenedImages.map(object => object.assetId))].map(async assetId => {
      const source = reopenedDoc.assets[assetId]?.data;
      const mimeType = reopenedDoc.assets[assetId]?.mimeType;
      if (!source || !mimeType) return [assetId, false];
      const valid = await new Promise(resolve => {
        const probe = new iframe.contentWindow.Image();
        probe.onload = () => resolve(probe.naturalWidth === reopenedDoc.assets[assetId].width && probe.naturalHeight === reopenedDoc.assets[assetId].height);
        probe.onerror = () => resolve(false);
        probe.src = source;
      });
      return [assetId, valid];
    })));
    const reopenedAllFormats = ['image/png', 'image/jpeg', 'image/webp'].every(mimeType => {
      const asset = Object.values(reopenedDoc?.assets || {}).find(candidate => candidate.mimeType === mimeType);
      return Boolean(asset && reopenedPixelByAsset[asset.id]);
    });
    const resourceUrls = performance.getEntriesByType('resource').map(entry => entry.name).filter(url => url.startsWith('http'));
    const reopenedResourceUrls = reopenedApp?.window?.performance?.getEntriesByType?.('resource')?.map(entry => entry.name).filter(url => url.startsWith('http')) ||
      iframe.contentWindow.performance.getEntriesByType('resource').map(entry => entry.name).filter(url => url.startsWith('http'));
    const noUnexpectedNetwork = [...resourceUrls, ...reopenedResourceUrls].every(url => url.startsWith('http://127.0.0.1:' + ${port}));
    return {
      inputBoundary, jpegBoundary, webpBoundary, mimeCoverage, entryWheel, shortcutExact,
      dropAffordance, modeClearedAffordance, dragExitCleared, dropImported, dropPlaced, dropSelected, dropHistory, dropUndone, dropRedone,
      rejectedDropNoOp, readingDropSuppressed, presentationDropSuppressed,
      cancelNoOp, errorNoPartial, modeCancelNoOp,
      sharedAsset, moved, moveUndone, moveRedone, resized, rotated, multiMoved, grouped,
      imageWheel,
      sharedRetainedAfterDelete, deleteUndone, deleteRedone, attachedConnector, lockedPreserved,
      connectorEndpoints: connector ? { from: connector.from, to: connector.to } : null,
      saveCopy: saved?.success === true && savedHtml.length > 0,
      offlineReopen: Boolean(reopenedApp && reopenedDoc), reopenedNativeImage,
      reopenedMetadata, reopenedAssetState, reopenedOrder, reopenedGroups, reopenedConnectors,
      reopenedSharedAsset, reopenedRevision, reopenedPixels: Object.values(reopenedPixelByAsset).every(Boolean), reopenedAllFormats, noUnexpectedNetwork,
      errors: errors.concat(iframeErrors), alerts
    };
  })()`);

  ws.removeEventListener('message', bindingHandler);
  ws.removeEventListener('message', earlyErrorHandler);
  result.errors = [...earlyErrors, ...result.errors];
  console.log('Focused Chrome image verification:', JSON.stringify(result, null, 2));
  const passed = result.inputBoundary && result.jpegBoundary && result.webpBoundary &&
    result.mimeCoverage.join(',') === 'image/jpeg,image/png,image/webp' && result.entryWheel && result.shortcutExact &&
    result.dropAffordance && result.modeClearedAffordance && result.dragExitCleared && result.dropImported && result.dropPlaced && result.dropSelected && result.dropHistory &&
    result.dropUndone && result.dropRedone && result.rejectedDropNoOp && result.readingDropSuppressed && result.presentationDropSuppressed &&
    result.cancelNoOp && result.errorNoPartial && result.modeCancelNoOp &&
    result.sharedAsset && result.imageWheel && result.moved && result.moveUndone && result.moveRedone && result.resized && result.rotated && result.multiMoved && result.grouped &&
    result.sharedRetainedAfterDelete && result.deleteUndone && result.deleteRedone && result.attachedConnector && result.lockedPreserved &&
    result.saveCopy && result.offlineReopen && result.reopenedNativeImage && result.reopenedPixels && result.reopenedAllFormats && result.reopenedMetadata &&
    result.reopenedAssetState && result.reopenedOrder && result.reopenedGroups && result.reopenedConnectors && result.reopenedSharedAsset &&
    result.reopenedRevision && result.noUnexpectedNetwork && result.errors.length === 0;
  if (!passed) process.exitCode = 1;
} finally {
  ws?.close();
  chrome.kill();
  server.close();
}
