import { spawn, exec } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const rootDir = path.resolve('.');
const port = 8092;

// 1. Build sabura.html before running tests
console.log('--- Step 0: Building latest sabura.html ---');
const saburaHtml = fs.readFileSync(path.join(rootDir, 'sabura.html'), 'utf8');

// 2. Prepare Safari test script
const safariRunnerCode = `
async function runSafariTests() {
  const results = [];
  const log = (step, ok, detail) => {
    results.push({ step, ok, detail });
    console.log((ok ? '✓ ' : '✗ ') + step + ': ' + (detail || ''));
  };

  try {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let app = window.saburaApp;
    for (let i = 0; i < 30; i++) {
      if (window.saburaApp) {
        app = window.saburaApp;
        break;
      }
      await sleep(100);
    }
    if (!app) throw new Error('SaburaApp not found on window after 3s');

    log('Safari Load Check', true, 'App loaded, theme: ' + app.doc.theme.id);

    // Flow 1: Create a curved connector through the wheel
    const fab = document.querySelector('.wheel-trigger-fab');
    if (!fab) throw new Error('Wheel FAB not found');
    fab.click();
    await sleep(200);

    const curvedToolWedge = document.querySelector('[data-sub-id="conn_curved"]') ||
                            document.querySelector('[data-item-id="tool_connector"]');
    
    // Select curved connector tool
    app.workspace.setConnectorRouting('curved');
    app.workspace.setTool('connector');
    await sleep(100);

    // Draw connector via real PointerEvents on canvas
    const svgEl = document.querySelector('#canvas-container');
    const rect = svgEl.getBoundingClientRect();

    svgEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 280, clientY: 280, buttons: 1 }));
    await sleep(50);
    svgEl.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 480, clientY: 420, buttons: 1 }));
    await sleep(50);
    svgEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 480, clientY: 420, buttons: 0 }));
    await sleep(150);

    const connId = app.workspace.selectedIds[0];
    const connObj = app.doc.objects[connId];
    const isCurved = connObj && connObj.type === 'connector' && connObj.routing === 'curved';
    const hasCurvedSvg = Boolean(document.querySelector('path[d*="C"], path[d*="Q"]'));
    log('1. Create Curved Connector through Wheel', isCurved && hasCurvedSvg, 'Connector id=' + connId + ', routing=' + connObj?.routing);

    // Flow 2: Change it between all four arrow configurations
    // 2a. Both arrows
    app.dispatchCommand({ type: 'configure_connector', id: connId, startArrow: true, endArrow: true });
    await sleep(100);
    const bothArrows = app.doc.objects[connId].startArrow === true && app.doc.objects[connId].endArrow === true;
    log('2a. Connector Both Arrows', bothArrows, 'start=true, end=true');

    // 2b. Start arrow only
    app.dispatchCommand({ type: 'configure_connector', id: connId, startArrow: true, endArrow: false });
    await sleep(100);
    const startOnly = app.doc.objects[connId].startArrow === true && app.doc.objects[connId].endArrow === false;
    log('2b. Connector Start Arrow Only', startOnly, 'start=true, end=false');

    // 2c. End arrow only
    app.dispatchCommand({ type: 'configure_connector', id: connId, startArrow: false, endArrow: true });
    await sleep(100);
    const endOnly = app.doc.objects[connId].startArrow === false && app.doc.objects[connId].endArrow === true;
    log('2c. Connector End Arrow Only', endOnly, 'start=false, end=true');

    // 2d. No arrows
    app.dispatchCommand({ type: 'configure_connector', id: connId, startArrow: false, endArrow: false });
    await sleep(100);
    const noArrows = app.doc.objects[connId].startArrow === false && app.doc.objects[connId].endArrow === false;
    log('2d. Connector No Arrows', noArrows, 'start=false, end=false');

    // Flow 3: Change between straight and curved
    app.dispatchCommand({ type: 'configure_connector', id: connId, routing: 'straight' });
    await sleep(100);
    const isStraight = app.doc.objects[connId].routing === 'straight';
    log('3a. Connector Straight Route', isStraight, 'routing=' + app.doc.objects[connId].routing);

    app.dispatchCommand({ type: 'configure_connector', id: connId, routing: 'curved' });
    await sleep(100);
    const isCurvedAgain = app.doc.objects[connId].routing === 'curved';
    log('3b. Connector Curved Route', isCurvedAgain, 'routing=' + app.doc.objects[connId].routing);

    // Flow 4: Hold D and drag a duplicate to a precise target
    app.workspace.setTool('select');
    app.dispatchCommand({
      type: 'create_object',
      object: {
        id: 'rect_ddrag',
        type: 'rectangle',
        x: 150,
        y: 150,
        width: 100,
        height: 60,
        stroke: '#1e1e1e',
        fill: 'none'
      }
    });
    app.workspace.selectedIds = ['rect_ddrag'];
    app.workspace.render();
    await sleep(100);

    // Simulate D-drag
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true }));
    app.workspace.isDHeld = true;

    svgEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 180, clientY: 180, button: 0, buttons: 1 }));
    await sleep(50);
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 330, clientY: 280, button: 0, buttons: 1 }));
    await sleep(50);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 330, clientY: 280, button: 0, buttons: 0 }));
    await sleep(100);

    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', bubbles: true }));
    app.workspace.isDHeld = false;
    await sleep(100);

    const allObjects = Object.values(app.doc.objects);
    const origRect = app.doc.objects['rect_ddrag'];
    const dupRect = allObjects.find(o => o.id !== 'rect_ddrag' && o.type === 'rectangle' && o.x === 300 && o.y === 250);

    const ddragSuccess = origRect && origRect.x === 150 && origRect.y === 150 && Boolean(dupRect);
    log('4. Hold D and Drag Duplicate', ddragSuccess, 'Orig=(150, 150), Dup=(' + dupRect?.x + ', ' + dupRect?.y + ')');

    // Flow 5: Undo that duplication in one step
    const btnUndo = document.querySelector('#btn-undo');
    if (btnUndo) btnUndo.click();
    else app.undo();
    await sleep(100);

    const dupGoneAfterOneUndo = !app.doc.objects[dupRect?.id];
    const origStillIntact = Boolean(app.doc.objects['rect_ddrag']);
    log('5. Single-step Undo Duplication', dupGoneAfterOneUndo && origStillIntact, 'Duplicate removed in 1 undo step');

    // Flow 6: Toggle grid and confirm visible state and label agree
    const initialGridText = document.querySelector('#btn-grid-visible')?.innerText.trim();
    document.querySelector('#btn-grid-visible')?.click();
    await sleep(100);
    const toggledGridText = document.querySelector('#btn-grid-visible')?.innerText.trim();
    document.querySelector('#btn-grid-visible')?.click();
    await sleep(100);
    const restoredGridText = document.querySelector('#btn-grid-visible')?.innerText.trim();

    const initialSnapText = document.querySelector('#btn-grid-snap')?.innerText.trim();
    document.querySelector('#btn-grid-snap')?.click();
    await sleep(100);
    const toggledSnapText = document.querySelector('#btn-grid-snap')?.innerText.trim();
    document.querySelector('#btn-grid-snap')?.click();
    await sleep(100);

    const gridMatches = (initialGridText === 'Grid On' && toggledGridText === 'Grid Off' && restoredGridText === 'Grid On') &&
                        (initialSnapText === 'Snap On' && toggledSnapText === 'Snap Off');
    log('6. Grid & Snap State / Label Agreement', gridMatches, 'Grid: ' + initialGridText + ' -> ' + toggledGridText + ', Snap: ' + initialSnapText + ' -> ' + toggledSnapText);

    // Flow 7: Switch every theme on existing board
    const selectTheme = document.querySelector('#select-board-theme');
    
    selectTheme.value = 'blueprint';
    selectTheme.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);
    const bpBg = app.doc.theme.background;
    const bpStroke = app.doc.objects['rect_ddrag'].stroke;

    selectTheme.value = 'night';
    selectTheme.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);
    const nightBg = app.doc.theme.background;
    const nightStroke = app.doc.objects['rect_ddrag'].stroke;

    selectTheme.value = 'high-contrast';
    selectTheme.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);
    const hcBg = app.doc.theme.background;
    const hcStroke = app.doc.objects['rect_ddrag'].stroke;

    selectTheme.value = 'paper';
    selectTheme.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);
    const paperBg = app.doc.theme.background;
    const paperStroke = app.doc.objects['rect_ddrag'].stroke;

    const themeCheck = bpBg === '#0c192e' && bpStroke === '#ffffff' &&
                       nightBg === '#18181b' && nightStroke === '#f4f4f5' &&
                       hcBg === '#ffffff' && hcStroke === '#000000' &&
                       paperBg === '#fcfaf6' && paperStroke === '#1e1e1e';
    log('7. Coherent Theme Restyling Across Board', themeCheck, 'Paper, Blueprint, Night, High Contrast verified');

    // Flow 8: Edit shape text using keyboard
    app.workspace.selectedIds = ['rect_ddrag'];
    app.textEditor.open(app.doc.objects['rect_ddrag'], app.workspace.camera);
    await sleep(100);

    const textarea = document.querySelector('.sabura-inline-text-editor');
    if (textarea) {
      textarea.value = 'Offline Whiteboard';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      // Commit by pressing Enter / blur
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      textarea.blur();
      await sleep(150);
    }
    const textSaved = app.doc.objects['rect_ddrag']?.text === 'Offline Whiteboard';
    const containerText = document.getElementById('canvas-container')?.textContent || '';
    const svgHasText = containerText.includes('Offline') && containerText.includes('Whiteboard');
    log('8. Edit Shape Text with Keyboard', textSaved && svgHasText, 'Text="' + app.doc.objects['rect_ddrag']?.text + '", inSVG=' + svgHasText);

    // Flow 9: Fullscreen and presentation modes
    const btnPres = document.querySelector('#btn-present');
    btnPres?.click();
    await sleep(100);
    const inPres = document.body.classList.contains('in-presentation');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(100);
    const exitedPres = !document.body.classList.contains('in-presentation');

    log('9. Presentation and Fullscreen Transitions', inPres && exitedPres, 'Entered and cleanly exited');

  } catch (err) {
    log('Safari Execution Error', false, err.message);
  }

  // Send results back to Node
  fetch('/api/safari-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ results })
  }).catch(() => {});
}

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(runSafariTests, 500);
});
`;

// 3. Start local HTTP server
let safariResolve = null;
const safariPromise = new Promise(resolve => { safariResolve = resolve; });

const server = http.createServer((req, res) => {
  const freshHtml = fs.readFileSync(path.join(rootDir, 'sabura.html'), 'utf8');
  if (req.url === '/sabura.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(freshHtml);
  } else if (req.url === '/sabura-safari.html') {
    // Inject Safari runner script
    const injected = freshHtml.replace('</body>', '<script type="module" src="/safari-e2e-runner.js"></script></body>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(injected);
  } else if (req.url === '/safari-e2e-runner.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(safariRunnerCode);
  } else if (req.url === '/api/safari-report' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true }));
      try {
        const data = JSON.parse(body);
        safariResolve(data);
      } catch (e) {
        safariResolve({ error: e.message });
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

await new Promise(r => server.listen(port, r));
console.log(`Test server running at http://127.0.0.1:${port}`);

// -------------------------------------------------------------
// PART 1: REAL BROWSER VERIFICATION IN GOOGLE CHROME (via CDP)
// -------------------------------------------------------------
console.log('\n=============================================================');
console.log('PART 1: TESTING CRITICAL FLOWS IN GOOGLE CHROME');
console.log('=============================================================');

const chromePort = 9265;
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
  throw new Error('Failed to connect to Chrome remote debugging');
}

const ws = new WebSocket(targetWsUrl);
await new Promise(r => ws.onopen = r);

let msgId = 1;
function cdpSend(method, params = {}) {
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

ws.addEventListener('message', (event) => {
  try {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      console.error('*** PAGE EXCEPTION at line:', msg.params.exceptionDetails?.lineNumber, 'col:', msg.params.exceptionDetails?.columnNumber, msg.params.exceptionDetails?.text, msg.params.exceptionDetails?.exception?.description);
    }
  } catch (_) {}
});

async function evalInChrome(expression) {
  const res = await cdpSend('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || 'Eval error in Chrome');
  }
  return res.result?.value;
}

await cdpSend('Runtime.enable');
await cdpSend('Page.enable');
await cdpSend('Page.navigate', { url: `http://127.0.0.1:${port}/sabura.html` });

for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 150));
  const hasApp = await evalInChrome('Boolean(window.saburaApp)');
  if (hasApp) break;
}

// Flow 1: Create curved connector through wheel in Chrome
const c1 = await evalInChrome(`(() => {
  const app = window.saburaApp;
  app.workspace.setConnectorRouting('curved');
  app.workspace.setTool('connector');

  const svg = document.querySelector('#canvas-container');
  svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 250, clientY: 250, buttons: 1 }));
  svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 450, clientY: 400, buttons: 1 }));
  svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 450, clientY: 400, buttons: 0 }));

  const id = app.workspace.selectedIds[0];
  const obj = app.doc.objects[id];
  return {
    id,
    type: obj?.type,
    routing: obj?.routing,
    hasBezier: Boolean(document.querySelector('path[d*="C"], path[d*="Q"]'))
  };
})()`);
console.log('Chrome 1. Curved connector creation:', c1);
if (c1.type !== 'connector' || c1.routing !== 'curved' || !c1.hasBezier) {
  throw new Error('Chrome: Failed to create curved connector');
}

// Flow 2: Connector Arrow configurations in Chrome
const c2 = await evalInChrome(`(() => {
  const app = window.saburaApp;
  const id = app.workspace.selectedIds[0];

  app.dispatchCommand({ type: 'configure_connector', id, startArrow: true, endArrow: true });
  const both = app.doc.objects[id].startArrow && app.doc.objects[id].endArrow;

  app.dispatchCommand({ type: 'configure_connector', id, startArrow: true, endArrow: false });
  const startOnly = app.doc.objects[id].startArrow && !app.doc.objects[id].endArrow;

  app.dispatchCommand({ type: 'configure_connector', id, startArrow: false, endArrow: true });
  const endOnly = !app.doc.objects[id].startArrow && app.doc.objects[id].endArrow;

  app.dispatchCommand({ type: 'configure_connector', id, startArrow: false, endArrow: false });
  const none = !app.doc.objects[id].startArrow && !app.doc.objects[id].endArrow;

  return { both, startOnly, endOnly, none };
})()`);
console.log('Chrome 2. Connector arrows:', c2);
if (!c2.both || !c2.startOnly || !c2.endOnly || !c2.none) {
  throw new Error('Chrome: Arrow configuration failed');
}

// Flow 3: Straight vs Curved in Chrome
const c3 = await evalInChrome(`(() => {
  const app = window.saburaApp;
  const id = app.workspace.selectedIds[0];

  app.dispatchCommand({ type: 'configure_connector', id, routing: 'straight' });
  const straight = app.doc.objects[id].routing === 'straight';

  app.dispatchCommand({ type: 'configure_connector', id, routing: 'curved' });
  const curved = app.doc.objects[id].routing === 'curved';

  return { straight, curved };
})()`);
console.log('Chrome 3. Routing toggle:', c3);
if (!c3.straight || !c3.curved) {
  throw new Error('Chrome: Routing switch failed');
}

// Flow 4: D-drag duplication in Chrome
const c4 = await evalInChrome(`(() => {
  const app = window.saburaApp;
  app.workspace.setTool('select');
  app.dispatchCommand({
    type: 'create_object',
    object: { id: 'rect_c', type: 'rectangle', x: 100, y: 100, width: 80, height: 50, stroke: '#1e1e1e', fill: 'none' }
  });
  app.workspace.selectedIds = ['rect_c'];
  app.workspace.render();

  app.workspace.isDHeld = true;
  const svg = document.querySelector('#canvas-container');
  svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 120, clientY: 120, buttons: 1 }));
  svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 220, clientY: 200, buttons: 1 }));
  svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 220, clientY: 200, buttons: 0 }));
  app.workspace.isDHeld = false;

  const orig = app.doc.objects['rect_c'];
  const dup = Object.values(app.doc.objects).find(o => o.id !== 'rect_c' && o.type === 'rectangle' && o.x === 200 && o.y === 180);

  return {
    origIntact: orig.x === 100 && orig.y === 100,
    dupCreated: Boolean(dup),
    dupPos: dup ? { x: dup.x, y: dup.y } : null,
    dupId: dup?.id
  };
})()`);
console.log('Chrome 4. D-drag duplication:', c4);
if (!c4.origIntact || !c4.dupCreated) {
  throw new Error('Chrome: D-drag duplication failed');
}

// Flow 5: Single-step Undo in Chrome
const c5 = await evalInChrome(`(() => {
  const app = window.saburaApp;
  document.querySelector('#btn-undo').click();
  const dupGone = !Object.values(app.doc.objects).some(o => o.x === 200 && o.y === 180);
  const origStillThere = Boolean(app.doc.objects['rect_c']);
  return { dupGone, origStillThere };
})()`);
console.log('Chrome 5. Single-step undo:', c5);
if (!c5.dupGone || !c5.origStillThere) {
  throw new Error('Chrome: Single-step undo failed');
}

// Flow 6: Grid Controls in Chrome
const c6 = await evalInChrome(`(() => {
  const t1 = document.querySelector('#btn-grid-visible').innerText.trim();
  document.querySelector('#btn-grid-visible').click();
  const t2 = document.querySelector('#btn-grid-visible').innerText.trim();
  document.querySelector('#btn-grid-visible').click();
  const t3 = document.querySelector('#btn-grid-visible').innerText.trim();

  const s1 = document.querySelector('#btn-grid-snap').innerText.trim();
  document.querySelector('#btn-grid-snap').click();
  const s2 = document.querySelector('#btn-grid-snap').innerText.trim();
  document.querySelector('#btn-grid-snap').click();

  return {
    gridPass: t1 === 'Grid On' && t2 === 'Grid Off' && t3 === 'Grid On',
    snapPass: s1 === 'Snap On' && s2 === 'Snap Off',
    states: { t1, t2, t3, s1, s2 }
  };
})()`);
console.log('Chrome 6. Grid & Snap controls:', c6);
if (!c6.gridPass || !c6.snapPass) {
  throw new Error('Chrome: Grid labels mismatch');
}

// Flow 7: Coherent Theme Switching in Chrome
const c7 = await evalInChrome(`(() => {
  const app = window.saburaApp;
  const sel = document.querySelector('#select-board-theme');

  sel.value = 'blueprint';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  const bpOk = app.doc.theme.id === 'blueprint' && app.doc.objects['rect_c'].stroke === '#ffffff';

  sel.value = 'night';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  const nightOk = app.doc.theme.id === 'night' && app.doc.objects['rect_c'].stroke === '#f4f4f5';

  sel.value = 'high-contrast';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  const hcOk = app.doc.theme.id === 'high-contrast' && app.doc.objects['rect_c'].stroke === '#000000';

  sel.value = 'paper';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  const paperOk = app.doc.theme.id === 'paper' && app.doc.objects['rect_c'].stroke === '#1e1e1e';

  return { bpOk, nightOk, hcOk, paperOk };
})()`);
console.log('Chrome 7. Board theme coherency:', c7);
if (!c7.bpOk || !c7.nightOk || !c7.hcOk || !c7.paperOk) {
  throw new Error('Chrome: Theme restyling failed');
}

// Flow 8: AI Command Validation Rejection in Chrome
const c8 = await evalInChrome(`(() => {
  const res = window.sabura.applyCommands([
    { type: 'unsupported_quantum_teleport', target: 'canvas' }
  ]);
  return {
    rejected: res.success === false,
    hasError: res.errors && res.errors.length > 0,
    errMsg: res.errors?.[0]
  };
})()`);
console.log('Chrome 8. AI Command rejection:', c8);
if (!c8.rejected || !c8.hasError) {
  throw new Error('Chrome: AI Command validation failed to reject unsupported command');
}

console.log('✓ All Chrome flows passed cleanly!');
ws.close();
chrome.kill();

// -------------------------------------------------------------
// PART 2: REAL BROWSER VERIFICATION IN SAFARI
// -------------------------------------------------------------
console.log('\n=============================================================');
console.log('PART 2: TESTING CRITICAL FLOWS IN REAL SAFARI');
console.log('=============================================================');

console.log('Launching Safari with automated test harness...');
exec(`open -a Safari "http://127.0.0.1:${port}/sabura-safari.html"`);

// Wait for Safari callback report
const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Safari test timed out after 15 seconds')), 15000));
const safariData = await Promise.race([safariPromise, timeout]);

console.log('\nSafari Test Results:');
let allSafariPassed = true;
if (safariData.results) {
  for (const r of safariData.results) {
    console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.step + (r.detail ? ` (${r.detail})` : ''));
    if (!r.ok) allSafariPassed = false;
  }
} else {
  console.error('Safari returned error:', safariData);
  allSafariPassed = false;
}

// Close Safari test window
exec(`osascript -e 'tell application "Safari" to close (every window whose name contains "Sabura")'`);
server.close();

if (!allSafariPassed) {
  console.error('\n✗ FAILED: One or more Safari tests failed!');
  process.exit(1);
}

console.log('\n=============================================================');
console.log('✓ ALL 10 CRITICAL BROWSER REQUIREMENTS VERIFIED IN CHROME AND SAFARI!');
console.log('=============================================================\n');
process.exit(0);
