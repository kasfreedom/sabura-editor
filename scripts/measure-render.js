// Measures interactive rendering cost on a real board in headless Chrome.
//
// Usage: node scripts/measure-render.js [board.html] [--runs N] [--cpu-throttle N]
// Default board: examples/knowledge-graphs.html (574 objects).
//
// For each scenario it sends real input through the DevTools protocol at about
// 120 Hz for one second while the page records requestAnimationFrame
// timestamps. It reports median and p95 frame time, frames longer than 20 ms
// (dropped at 60 Hz), and main-thread busy time per second of input (Chrome's
// TaskDuration metric: handlers, deferred renders, style, layout and paint).
// Numbers are machine-specific; compare runs on the same machine only.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const runsIndex = args.indexOf('--runs');
const runs = runsIndex >= 0 ? Number(args[runsIndex + 1]) : 3;
const throttleIndex = args.indexOf('--cpu-throttle');
const cpuThrottle = throttleIndex >= 0 ? Number(args[throttleIndex + 1]) : 1; // 4 approximates a mid-range laptop
const boardPath = path.resolve(args.find((a, i) => !a.startsWith('--') && !['--runs', '--cpu-throttle'].includes(args[i - 1])) || 'examples/knowledge-graphs.html');
const chromeExecutable = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sabura-render-measure-'));

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
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });

const START_RECORDING = `(() => {
  const generation = (window.__generation || 0) + 1;
  window.__generation = generation; window.__frames = []; window.__handlerMs = 0;
  const tick = (t) => { if (window.__generation !== generation) return; window.__frames.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  for (const type of ['pointermove', 'wheel']) {
    if (window.__timed?.[type]) continue;
    (window.__timed ||= {})[type] = true;
    // Capture on window runs before the editor's handlers, bubble on window after
    // them (if they let the event bubble), so the gap is the editor's handler time.
    window.addEventListener(type, () => { window.__lastStart = performance.now(); }, true);
    window.addEventListener(type, () => { window.__handlerMs += performance.now() - window.__lastStart; }, false);
  }
  return true;
})()`;

const STOP_RECORDING = `(() => {
  window.__generation = (window.__generation || 0) + 1;
  const f = window.__frames; const gaps = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
  const q = (p) => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] : NaN;
  return { frames: gaps.length, medianMs: q(0.5), p95Ms: q(0.95), over20ms: gaps.filter((g) => g > 20).length, handlerMs: window.__handlerMs };
})()`;

const taskSeconds = async () => (await send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration')?.value ?? NaN;

async function scenario(name, drive) {
  await evaluate(START_RECORDING);
  await sleep(50);
  const busyBefore = await taskSeconds();
  const started = Date.now();
  await drive();
  await sleep(50);
  const busyMs = (await taskSeconds() - busyBefore) * 1000;
  const elapsedMs = Date.now() - started;
  const stats = await evaluate(STOP_RECORDING);
  return { name, ...stats, busyMsPerSec: (busyMs / elapsedMs) * 1000 };
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
    const waiter = message.id && pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Performance.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/board.html` });
  for (let attempt = 0; attempt < 50; attempt++) {
    await sleep(100);
    if (await evaluate('Boolean(window.sabura?.agent && document.getElementById("canvas-svg"))').catch(() => false)) break;
  }
  if (cpuThrottle > 1) await send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
  await evaluate('window.sabura.setMode("editing")');
  await sleep(300);

  const objectCount = await evaluate('Object.keys(window.sabura.getDocument().objects).length');
  const target = await evaluate(`(() => {
    const host = document.getElementById('canvas-svg').parentElement;
    const el = [...host.querySelectorAll('g[data-id]')].find((g) => { const b = g.getBoundingClientRect(); return b.width > 30 && b.height > 20 && b.top > 120 && b.left > 120 && b.right < 1100 && b.bottom < 700; });
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, id: el.getAttribute('data-id') };
  })()`);

  const STEP_MS = 8; // ~120 Hz input
  const STEPS = 120;
  const results = [];
  for (let run = 0; run < runs; run++) {
    results.push(await scenario('drag shape', async () => {
      await mouse('mousePressed', target.x, target.y);
      for (let i = 1; i <= STEPS; i++) { await mouse('mouseMoved', target.x + i * 0.5, target.y + i * 0.25); await sleep(STEP_MS); }
      await mouse('mouseReleased', target.x + STEPS * 0.5, target.y + STEPS * 0.25);
    }));
    await evaluate('window.sabura.undo()');
    results.push(await scenario('wheel pan', async () => {
      for (let i = 0; i < STEPS; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: 2, deltaY: 1 }); await sleep(STEP_MS); }
    }));
    results.push(await scenario('pinch zoom', async () => {
      for (let i = 0; i < STEPS; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: i < STEPS / 2 ? -2 : 2, modifiers: 2 }); await sleep(STEP_MS); }
    }));
  }

  const summary = {};
  for (const r of results) {
    const s = (summary[r.name] ||= { medianMs: [], p95Ms: [], over20ms: [], busyMsPerSec: [], frames: [] });
    for (const k of Object.keys(s)) s[k].push(r[k]);
  }
  const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];
  console.log(`Board: ${path.basename(boardPath)} (${objectCount} objects), ${runs} runs, input ~${Math.round(1000 / STEP_MS)} Hz, CPU throttle ${cpuThrottle}x`);
  for (const [name, s] of Object.entries(summary)) {
    console.log(`${name.padEnd(12)} frame median ${median(s.medianMs).toFixed(1)} ms | p95 ${median(s.p95Ms).toFixed(1)} ms | frames >20ms ${median(s.over20ms)} of ~${median(s.frames)} | main thread busy ${median(s.busyMsPerSec).toFixed(0)} ms/s`);
  }
}

try {
  await main();
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    chrome.kill('SIGTERM');
    if (await Promise.race([exited.then(() => true), sleep(5000).then(() => false)]) === false) {
      chrome.kill('SIGKILL');
      await Promise.race([exited, sleep(2000)]);
    }
  }
  server.close();
  // Chrome's helper processes can still be flushing the profile. Leaving a temp
  // folder behind is not a test failure, so report it instead of failing.
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch (error) {
    console.warn(`warning: could not remove the temporary Chrome profile ${profile}: ${error.message}`);
  }
}
