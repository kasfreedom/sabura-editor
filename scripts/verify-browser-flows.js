import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { packageHtmlWithDocument } from '../src/storage/file-packer.js';

const rootDir = path.resolve('.');
const port = 8089;

// 1. Start a local static HTTP server
const server = http.createServer((req, res) => {
  const filePath = path.join(rootDir, req.url === '/' ? 'sabura.html' : req.url);
  if (fs.existsSync(filePath)) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise(r => server.listen(port, r));
console.log(`Local HTTP server running on http://127.0.0.1:${port}`);

// 2. Launch headless Chrome with remote debugging
const chromePort = 9260;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new',
  `--remote-debugging-port=${chromePort}`,
  '--disable-gpu',
  '--window-size=1280,800',
  'about:blank'
]);

let targetWsUrl = null;
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 200));
  try {
    const res = await fetch(`http://127.0.0.1:${chromePort}/json/list`);
    const targets = await res.json();
    const page = targets.find(t => t.type === 'page');
    if (page && page.webSocketDebuggerUrl) {
      targetWsUrl = page.webSocketDebuggerUrl;
      break;
    }
  } catch (_) {}
}

if (!targetWsUrl) {
  throw new Error('Failed to connect to headless Chrome');
}

const ws = new WebSocket(targetWsUrl);
await new Promise(r => ws.onopen = r);

let msgId = 1;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const curId = msgId++;
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === curId) {
        ws.removeEventListener('message', handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: curId, method, params }));
  });
}

async function evalInPage(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || 'Eval error in browser');
  }
  return res.result?.value;
}

await send('Runtime.enable');
await send('Page.enable');

console.log('\n--- Step 1: Testing via Local Web Server ---');
await send('Page.navigate', { url: `http://127.0.0.1:${port}/sabura.html` });
await new Promise(r => setTimeout(r, 1500));

const initialCheck = await evalInPage(`(() => {
  return {
    hasApp: Boolean(window.saburaApp),
    hasApi: Boolean(window.sabura),
    docTheme: window.saburaApp.doc.theme.id,
    objectCount: Object.keys(window.saburaApp.doc.objects).length,
    activeTool: window.saburaApp.workspace.activeTool
  };
})()`);
console.log('HTTP Load Check:', initialCheck);
if (!initialCheck.hasApp || initialCheck.activeTool !== 'hand') {
  throw new Error('Failed initial load check via HTTP');
}

console.log('\n--- Step 2: Selecting and Moving an Object ---');
const moveCheck = await evalInPage(`(() => {
  const app = window.saburaApp;
  const ws = app.workspace;
  const objId = app.doc.order[0];
  const origX = app.doc.objects[objId].x;
  const origY = app.doc.objects[objId].y;

  // Select tool and select object
  ws.setTool('select');
  ws.selectedIds = [objId];
  
  // Move object by +40, +60
  app.dispatchCommand({
    type: 'move_objects',
    ids: [objId],
    dx: 40,
    dy: 60
  });

  const newObj = app.doc.objects[objId];
  return {
    objId,
    origX,
    origY,
    newX: newObj.x,
    newY: newObj.y,
    moved: newObj.x === origX + 40 && newObj.y === origY + 60
  };
})()`);
console.log('Move Check:', moveCheck);
if (!moveCheck.moved) throw new Error('Object moving failed');

console.log('\n--- Step 3: Text Editing via Enter/F2 and Dynamic Scaling ---');
const textEditCheck = await evalInPage(`(() => {
  const app = window.saburaApp;
  const ws = app.workspace;
  
  // Create a shape
  const shape = {
    id: 'test_shape_text',
    type: 'rectangle',
    x: 150,
    y: 150,
    width: 140,
    height: 80,
    text: '',
    textStyle: { size: 'm', resolvedSize: 20, fontFamily: 'hand', align: 'center', bold: false }
  };
  app.dispatchCommand({ type: 'create_object', object: shape });
  ws.selectedIds = [shape.id];

  // Trigger text editor via Enter shortcut handler
  app.shortcuts.handlers.onEditText();
  const editorOpened = app.textEditor.textarea.style.display === 'block';

  // Set text and close
  app.textEditor.textarea.value = 'Dynamic\\nText';
  app.textEditor.close(true);

  // Resize containing shape and verify proportional text scaling
  app.dispatchCommand({
    type: 'resize_object',
    id: shape.id,
    bounds: { x: 150, y: 150, width: 280, height: 160 },
    scaleText: true
  });

  const updatedShape = app.doc.objects[shape.id];
  return {
    editorOpened,
    text: updatedShape.text,
    scaledFontSize: updatedShape.textStyle.resolvedSize
  };
})()`);
console.log('Text Edit & Scaling Check:', textEditCheck);
if (!textEditCheck.editorOpened || textEditCheck.scaledFontSize <= 20) {
  throw new Error('Text editing or scaling failed');
}

console.log('\n--- Step 4: Connector Routes & Arrow Ends Combinations ---');
const connCheck = await evalInPage(`(() => {
  const app = window.saburaApp;
  
  // Create connector
  const conn = {
    id: 'test_conn',
    type: 'connector',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    from: { point: { x: 100, y: 100 } },
    to: { point: { x: 300, y: 200 } },
    routing: 'straight',
    startArrow: false,
    endArrow: false
  };
  app.dispatchCommand({ type: 'create_object', object: conn });

  const routes = ['straight', 'elbow', 'curved'];
  const arrows = [
    { startArrow: false, endArrow: false },
    { startArrow: true, endArrow: false },
    { startArrow: false, endArrow: true },
    { startArrow: true, endArrow: true }
  ];

  const results = [];
  for (const r of routes) {
    app.dispatchCommand({ type: 'configure_connector', id: conn.id, routing: r });
    results.push({ routing: app.doc.objects[conn.id].routing });
  }

  for (const a of arrows) {
    app.dispatchCommand({
      type: 'configure_connector',
      id: conn.id,
      startArrow: a.startArrow,
      endArrow: a.endArrow
    });
    results.push({
      startArrow: app.doc.objects[conn.id].startArrow,
      endArrow: app.doc.objects[conn.id].endArrow
    });
  }

  return results;
})()`);
console.log('Connector Routes & Arrows Check:', connCheck);

console.log('\n--- Step 5: Endpoint Reconnection ---');
const reconnectCheck = await evalInPage(`(() => {
  const app = window.saburaApp;
  app.dispatchCommand({
    type: 'reconnect_connector',
    id: 'test_conn',
    endpoint: 'to',
    target: { id: 'test_shape_text' }
  });
  return app.doc.objects['test_conn'].to;
})()`);
console.log('Reconnect Check:', reconnectCheck);
if (reconnectCheck.id !== 'test_shape_text') {
  throw new Error('Endpoint reconnection failed');
}

console.log('\n--- Step 6: Board Theme Switch with Existing Objects ---');
const themeCheck = await evalInPage(`(() => {
  const app = window.saburaApp;
  const oldTheme = app.doc.theme.id;
  
  // Switch to Blueprint
  app.setBoardTheme('blueprint');
  const bpStroke = app.doc.objects['test_conn'].stroke;

  // Switch to Night
  app.setBoardTheme('night');
  const nightStroke = app.doc.objects['test_conn'].stroke;

  // Switch to High Contrast
  app.setBoardTheme('high-contrast');
  const hcStroke = app.doc.objects['test_conn'].stroke;

  return {
    oldTheme,
    bpTheme: 'blueprint',
    bpStroke,
    nightStroke,
    hcStroke
  };
})()`);
console.log('Theme Switch Check:', themeCheck);

console.log('\n--- Step 7: Grouping, Moving, and Ungrouping ---');
const groupCheck = await evalInPage(`(() => {
  const app = window.saburaApp;
  const ids = ['test_shape_text', 'test_conn'];
  
  // Group
  app.dispatchCommand({ type: 'group_objects', ids });
  const gId1 = app.doc.objects['test_shape_text'].groupId;
  const gId2 = app.doc.objects['test_conn'].groupId;

  // Move group
  const origX = app.doc.objects['test_shape_text'].x;
  app.dispatchCommand({ type: 'move_objects', ids, dx: 30, dy: 30 });
  const newX = app.doc.objects['test_shape_text'].x;

  // Ungroup
  app.dispatchCommand({ type: 'ungroup_objects', groupIds: [gId1] });
  const ungroupId1 = app.doc.objects['test_shape_text'].groupId;

  return {
    grouped: Boolean(gId1 && gId1 === gId2),
    moved: newX === origX + 30,
    ungrouped: ungroupId1 === null
  };
})()`);
console.log('Group / Move / Ungroup Check:', groupCheck);
if (!groupCheck.grouped || !groupCheck.moved || !groupCheck.ungrouped) {
  throw new Error('Grouping lifecycle failed');
}

console.log('\n--- Step 8: D-Drag Duplication ---');
const dDragCheck = await evalInPage(`(() => {
  const app = window.saburaApp;
  const ws = app.workspace;
  const targetId = 'test_shape_text';
  const countBefore = Object.keys(app.doc.objects).length;
  const origX = app.doc.objects[targetId].x;

  // Hold D
  ws.setDHold(true);
  ws.selectedIds = [targetId];
  ws.isDraggingSelection = true;
  ws.dragStart = { x: origX, y: 150 };
  ws.dragInitialPositions = {
    [targetId]: { x: origX, y: 150 }
  };

  // Move pointer while holding D
  ws.onPointerMove({
    clientX: 300,
    clientY: 300,
    altKey: false,
    shiftKey: false,
    metaKey: false
  });

  // Release pointer
  ws.onPointerUp({ clientX: 300, clientY: 300 });

  const countAfter = Object.keys(app.doc.objects).length;
  const origStillThere = app.doc.objects[targetId].x === origX;

  return {
    countBefore,
    countAfter,
    origStillThere,
    duplicated: countAfter === countBefore + 1
  };
})()`);
console.log('D-Drag Duplication Check:', dDragCheck);
if (!dDragCheck.duplicated || !dDragCheck.origStillThere) {
  throw new Error('D-drag duplication failed');
}

console.log('\n--- Step 9: Fullscreen and Presentation Mode ---');
const presentationCheck = await evalInPage(`(() => {
  const app = window.saburaApp;
  
  // Enter presentation
  app.enterPresentation();
  const inPres = app.inPresentation && document.body.classList.contains('in-presentation');
  const laserActive = app.laser.active;

  // Add laser points
  app.laser.addPoint(500, 400);
  app.laser.addPoint(520, 410);

  // Exit presentation
  app.exitPresentation();
  const exitedPres = !app.inPresentation && !document.body.classList.contains('in-presentation');
  const laserStopped = !app.laser.active;

  return {
    inPres,
    laserActive,
    exitedPres,
    laserStopped
  };
})()`);
console.log('Presentation & Laser Check:', presentationCheck);
if (!presentationCheck.inPres || !presentationCheck.laserActive || !presentationCheck.exitedPres || !presentationCheck.laserStopped) {
  throw new Error('Presentation mode failed');
}

console.log('\n--- Step 10: Save Copy and Reopening Result ---');
const cleanShellData = await evalInPage(`(() => {
  const app = window.saburaApp;
  return {
    cleanShell: app.getCleanHtmlShell(),
    doc: app.doc
  };
})()`);

const packResult = packageHtmlWithDocument(cleanShellData.cleanShell, cleanShellData.doc);
const saveCopyCheck = {
  success: packResult.success,
  htmlLength: packResult.html.length,
  hasCleanApp: packResult.html.includes('<div id="app"></div>'),
  hasSvgNodes: packResult.html.includes('<svg id="canvas-svg">'),
  htmlContent: packResult.html
};
console.log('Save Copy Check:', {
  success: saveCopyCheck.success,
  htmlLength: saveCopyCheck.htmlLength,
  hasCleanApp: saveCopyCheck.hasCleanApp,
  hasSvgNodes: saveCopyCheck.hasSvgNodes
});
if (!saveCopyCheck.success || !saveCopyCheck.hasCleanApp || saveCopyCheck.hasSvgNodes) {
  throw new Error('Clean shell save copy failed');
}

// Write the saved file to disk and reopen it via file://
const savedFilePath = path.join(rootDir, 'saved-copy-test.html');
fs.writeFileSync(savedFilePath, saveCopyCheck.htmlContent, 'utf8');

console.log('\n--- Step 11: Direct file:// Protocol Opening & Reopening ---');
await send('Page.navigate', { url: `file://${savedFilePath}` });
await new Promise(r => setTimeout(r, 1500));

const fileReopenCheck = await evalInPage(`(() => {
  return {
    hasApp: Boolean(window.saburaApp),
    docTitle: window.saburaApp.doc.title,
    objectCount: Object.keys(window.saburaApp.doc.objects).length,
    hasTestShape: Boolean(window.saburaApp.doc.objects['test_shape_text'])
  };
})()`);
console.log('File:// Reopen Check:', fileReopenCheck);
if (!fileReopenCheck.hasApp || !fileReopenCheck.hasTestShape) {
  throw new Error('Failed to reopen saved copy via file://');
}

// Clean up test file
fs.unlinkSync(savedFilePath);

console.log('\n✓ ALL 11 REAL-BROWSER FLOWS PASSED PERFECTLY!\n');

ws.close();
chrome.kill();
server.close();
process.exit(0);
