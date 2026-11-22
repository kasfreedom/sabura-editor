// Verifies that incremental canvas updates produce exactly the DOM a full render
// produces, after real interactions on a real board in headless Chrome. Also
// checks that the inline text box follows pan and zoom, and that the editor
// starts where browser storage is blocked (data: URLs, sandboxed embeds).
//
// Usage: node scripts/verify-incremental-render-e2e.js [board.html]
//
// After each step it serializes the canvas, forces a full re-render (hiding and
// showing the grid changes the backdrop, which always rebuilds the canvas), and
// compares the two serializations. Any stale or misplaced node fails the run.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const boardPath = path.resolve(process.argv[2] || 'examples/knowledge-graphs.html');
const chromeExecutable = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sabura-incremental-e2e-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const listen = (server, port = 0) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => resolve(server.address().port));
});

const server = http.createServer((request, response) => {
  if (request.url === '/board.html') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(fs.readFileSync(boardPath));
    return;
  }
  response.writeHead(404);
  response.end();
});

let socket = null;
let chrome = null;
let nextId = 1;
const pending = new Map();
const browserErrors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} got no reply in 15 s`)); }, 15000);
  pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
const key = async (keyName, code, modifiers = 0, text = undefined) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, modifiers, text, windowsVirtualKeyCode: keyName.length === 1 ? keyName.toUpperCase().charCodeAt(0) : 0 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, modifiers });
};
const CMD = process.platform === 'darwin' ? 4 : 2;

const SNAPSHOT = `document.getElementById('canvas-svg').parentElement.innerHTML`;
// Reading mode hides the grid button, so there the full render happens in
// editing mode and switching back to reading is applied on top of it.
const TOGGLE_GRID_TWICE = `(async () => {
  const frame = () => new Promise((r) => setTimeout(r, 30));
  const mode = window.sabura.getMode();
  if (mode !== 'editing') { window.sabura.setMode('editing'); await frame(); }
  const button = document.querySelector('#btn-grid-visible');
  button.click(); await frame(); button.click(); await frame();
  if (mode !== 'editing') { window.sabura.setMode(mode); await frame(); }
  return true;
})()`;

const results = [];
async function check(step) {
  await sleep(60);
  const patched = await evaluate(SNAPSHOT);
  await evaluate(TOGGLE_GRID_TWICE);
  const full = await evaluate(SNAPSHOT);
  const ok = patched === full;
  let detail = '';
  if (!ok) {
    let i = 0;
    while (i < patched.length && patched[i] === full[i]) i++;
    detail = `first difference at ${i}:\n  patched: ${patched.slice(Math.max(0, i - 80), i + 120)}\n  full:    ${full.slice(Math.max(0, i - 80), i + 120)}`;
  }
  results.push({ step, ok, detail, nodes: (patched.match(/<[a-z]/g) || []).length });
  console.log(`${ok ? '✓' : '✗'} ${step}${ok ? '' : `\n${detail}`}`);
}

async function main() {
  const serverPort = await listen(server);
  const probe = http.createServer();
  const chromePort = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  chrome = spawn(chromeExecutable, ['--headless=new', `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });

  let debuggerUrl = null;
  for (let attempt = 0; attempt < 50 && !debuggerUrl; attempt++) {
    await sleep(100);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${chromePort}/json/list`)).json();
      debuggerUrl = targets.find((t) => t.type === 'page')?.webSocketDebuggerUrl || null;
    } catch (_) { /* Chrome still starting */ }
  }
  if (!debuggerUrl) throw new Error('Could not connect to Chrome DevTools Protocol');
  socket = new WebSocket(debuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    // The board has unsaved edits by now, so leaving it asks "Leave site?".
    if (message.method === 'Page.javascriptDialogOpening') {
      socket.send(JSON.stringify({ id: nextId++, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      browserErrors.push(message.params?.exceptionDetails?.exception?.description || 'Uncaught exception');
      return;
    }
    const waiter = message.id && pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/board.html` });
  for (let attempt = 0; attempt < 50; attempt++) {
    await sleep(100);
    if (await evaluate('Boolean(window.sabura?.agent && document.getElementById("canvas-svg"))').catch(() => false)) break;
  }
  await evaluate('window.sabura.setMode("editing")');
  await sleep(300);
  await check('initial load');

  const target = await evaluate(`(() => {
    const host = document.getElementById('canvas-svg').parentElement;
    const el = [...host.querySelectorAll('#objects-layer > g[data-id]')].find((g) => { const b = g.getBoundingClientRect(); return b.width > 30 && b.height > 20 && b.top > 120 && b.left > 120 && b.right < 1100 && b.bottom < 700; });
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  })()`);

  // Drag a shape (moves it and any connectors that follow it). Mid-drag, the
  // coalesced frame must already have moved the shape on screen.
  // The editor hit-tests by geometry, so measure the object it selected on
  // mouse-down, not whatever DOM element happens to be under the point.
  const twoFrames = () => evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
  await mouse('mousePressed', target.x, target.y);
  await twoFrames();
  const draggedId = await evaluate('window.sabura.agent.read().selection.ids[0]');
  const boxOf = () => evaluate(`(() => { const b = document.querySelector('#objects-layer > [data-id="${draggedId}"]').getBoundingClientRect(); return { x: b.left, y: b.top }; })()`);
  const startBox = await boxOf();
  for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', target.x + i * 3, target.y + i * 2); await sleep(8); }
  await twoFrames();
  const midBox = await boxOf();
  const moved = { x: midBox.x - startBox.x, y: midBox.y - startBox.y };
  const followsPointer = Math.abs(moved.x - 30) <= 4 && Math.abs(moved.y - 20) <= 4;
  results.push({ step: 'shape follows the pointer mid-drag', ok: followsPointer, detail: JSON.stringify(moved) });
  console.log(`${followsPointer ? '✓' : '✗'} shape follows the pointer mid-drag (moved ${moved.x.toFixed(1)}, ${moved.y.toFixed(1)}; expected 30, 20)`);
  for (let i = 11; i <= 20; i++) { await mouse('mouseMoved', target.x + i * 3, target.y + i * 2); await sleep(8); }
  await mouse('mouseReleased', target.x + 60, target.y + 40);
  await check('drag shape');

  // Pan and zoom with the wheel. The camera transform must update while the
  // wheel is still turning, not only afterwards.
  const transformOf = () => evaluate(`document.getElementById('world-layer').getAttribute('transform')`);
  const transformBefore = await transformOf();
  for (let i = 0; i < 5; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: 6, deltaY: 4 }); await sleep(8); }
  await twoFrames();
  const panned = (await transformOf()) !== transformBefore;
  results.push({ step: 'camera follows the wheel mid-pan', ok: panned, detail: '' });
  console.log(`${panned ? '✓' : '✗'} camera follows the wheel mid-pan`);
  for (let i = 5; i < 20; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: 6, deltaY: 4 }); await sleep(8); }
  await check('wheel pan');
  for (let i = 0; i < 10; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: -3, modifiers: 2 }); await sleep(8); }
  await check('zoom');

  // The inline text box stays over its shape while the camera moves mid-edit.
  const editTarget = await evaluate(`(() => {
    const doc = window.sabura.getDocument();
    const editable = (id) => { const o = doc.objects[id]; return o && !o.locked && ['rectangle', 'ellipse', 'diamond', 'text'].includes(o.type); };
    const el = [...document.querySelectorAll('#objects-layer > g[data-id]')].find((g) => {
      const b = g.getBoundingClientRect(); const cx = b.left + b.width / 2; const cy = b.top + b.height / 2;
      return editable(g.getAttribute('data-id')) && b.width > 40 && b.height > 20 && cx > 300 && cx < 1000 && cy > 150 && cy < 600;
    });
    if (!el) throw new Error('no editable shape in view for the text box check');
    const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, id: el.getAttribute('data-id') };
  })()`);
  await mouse('mousePressed', editTarget.x, editTarget.y, { clickCount: 1 }); await mouse('mouseReleased', editTarget.x, editTarget.y, { clickCount: 1 });
  await mouse('mousePressed', editTarget.x, editTarget.y, { clickCount: 2 }); await mouse('mouseReleased', editTarget.x, editTarget.y, { clickCount: 2 });
  await twoFrames();
  const boxes = () => evaluate(`(() => {
    const t = document.getElementById('sabura-inline-text-editor').getBoundingClientRect();
    const s = document.querySelector('#objects-layer > [data-id="${editTarget.id}"]').getBoundingClientRect();
    return { open: document.getElementById('sabura-inline-text-editor').style.display === 'block', tx: t.left + t.width / 2, ty: t.top + t.height / 2, sx: s.left + s.width / 2, sy: s.top + s.height / 2 };
  })()`);
  const beforeEdit = await boxes();
  // Wheel over the canvas, away from the text box and any toolbar.
  const wheelAt = await evaluate(`(() => {
    const canvas = document.getElementById('canvas-svg').parentElement;
    for (const [x, y] of [[640, 400], [900, 300], [300, 250], [900, 600], [250, 550]]) {
      if (canvas.contains(document.elementFromPoint(x, y))) return { x, y };
    }
    throw new Error('no canvas point free for the wheel');
  })()`);
  for (let i = 0; i < 5; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...wheelAt, deltaX: 8, deltaY: 6 }); await sleep(8); }
  for (let i = 0; i < 4; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...wheelAt, deltaX: 0, deltaY: -3, modifiers: 2 }); await sleep(8); }
  await twoFrames();
  const afterEdit = await boxes();
  const shapeMoved = Math.hypot(afterEdit.sx - beforeEdit.sx, afterEdit.sy - beforeEdit.sy) > 10;
  const boxFollows = beforeEdit.open && afterEdit.open && shapeMoved
    && Math.abs((afterEdit.tx - afterEdit.sx) - (beforeEdit.tx - beforeEdit.sx)) <= 2
    && Math.abs((afterEdit.ty - afterEdit.sy) - (beforeEdit.ty - beforeEdit.sy)) <= 2;
  results.push({ step: 'text box follows pan and zoom', ok: boxFollows, detail: JSON.stringify({ beforeEdit, afterEdit }) });
  console.log(`${boxFollows ? '✓' : '✗'} text box follows pan and zoom${boxFollows ? '' : ` ${JSON.stringify({ beforeEdit, afterEdit })}`}`);
  await key('Escape', 'Escape');
  await check('after text editing');

  // Selection on and off.
  const shape = await evaluate(`(() => {
    const el = [...document.querySelectorAll('#objects-layer > g[data-id]')].find((g) => { const b = g.getBoundingClientRect(); return b.width > 30 && b.height > 20 && b.top > 120 && b.left > 120 && b.right < 1100 && b.bottom < 700; });
    const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  })()`);
  await mouse('mousePressed', shape.x, shape.y); await mouse('mouseReleased', shape.x, shape.y);
  await check('select shape');
  await key('a', 'KeyA', CMD);
  await check('select all');
  await key('Escape', 'Escape');
  await check('deselect');

  // Marquee drag on empty canvas.
  await mouse('mousePressed', 20, 780); for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', 20 + i * 10, 780 - i * 10); await sleep(8); }
  await mouse('mouseReleased', 120, 680);
  await check('marquee');

  // Copy, paste, undo, redo through the keyboard.
  await mouse('mousePressed', shape.x, shape.y); await mouse('mouseReleased', shape.x, shape.y);
  await key('c', 'KeyC', CMD); await key('v', 'KeyV', CMD);
  await check('paste');
  await key('z', 'KeyZ', CMD);
  await check('undo');
  await key('z', 'KeyZ', CMD | 8);
  await check('redo');

  // Board theme change and reading mode.
  await evaluate(`(() => { const s = window.sabura.agent.read(); return window.sabura.agent.apply({ requestId: 'theme-' + Date.now(), expectedEditToken: s.editToken, commands: [{ type: 'set_board_theme', themeId: 'night' }] }); })()`);
  await check('theme change');
  await evaluate('window.sabura.setMode("reading")');
  await check('reading mode');

  // Blocked storage: in a data: URL even reading localStorage throws. The editor
  // must still start (it used to crash before drawing anything).
  const errorsBefore = browserErrors.length;
  const dataUrl = `data:text/html;base64,${fs.readFileSync(boardPath).toString('base64')}`;
  await send('Page.navigate', { url: dataUrl });
  let started = false;
  for (let attempt = 0; attempt < 50 && !started; attempt++) {
    await sleep(100);
    started = await evaluate('Boolean(window.sabura?.agent && document.getElementById("canvas-svg"))').catch(() => false);
  }
  const storageBlocked = await evaluate('(() => { try { localStorage.length; return false; } catch (_) { return true; } })()').catch(() => null);
  const startsOk = started && storageBlocked === true && browserErrors.length === errorsBefore;
  results.push({ step: 'starts with storage blocked', ok: startsOk, detail: '' });
  console.log(`${startsOk ? '✓' : '✗'} starts with storage blocked (started ${started}, storage blocked ${storageBlocked})`);

  const failed = results.filter((r) => !r.ok);
  if (browserErrors.length) console.log(`Browser errors:\n  ${browserErrors.join('\n  ')}`);
  console.log(`${results.length - failed.length}/${results.length} steps match a full render`);
  if (failed.length || browserErrors.length) process.exitCode = 1;
}

try {
  await main();
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    chrome.kill('SIGTERM');
    await Promise.race([exited, sleep(3000)]);
  }
  server.close();
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
