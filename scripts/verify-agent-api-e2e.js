import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const rootDir = path.resolve('.');
const artifactPath = path.join(rootDir, 'sabura.html');
const chromeExecutable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'sabura-agent-e2e-'));
let savedHtml = null;
let chrome = null;
let socket = null;

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function reservePort() {
  const probe = http.createServer();
  const port = await listen(probe);
  await new Promise(resolve => probe.close(resolve));
  return port;
}

const server = http.createServer((request, response) => {
  if (request.url === '/favicon.ico') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.url === '/' || request.url === '/sabura.html') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(fs.readFileSync(artifactPath));
    return;
  }
  if (request.url === '/saved-agent.html' && savedHtml) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(savedHtml);
    return;
  }
  response.writeHead(404);
  response.end();
});

let messageId = 1;
const pending = new Map();
const browserErrors = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = messageId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed');
  }
  return result.result?.value;
}

async function waitFor(expression, description) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await evaluate(expression).catch(() => false)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

try {
  if (!fs.existsSync(artifactPath)) throw new Error('sabura.html is missing; run npm run build first');
  const serverPort = await listen(server);
  const chromePort = await reservePort();

  chrome = spawn(chromeExecutable, [
    '--headless=new',
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${chromeProfile}`,
    '--disable-gpu',
    '--no-first-run',
    '--window-size=1280,800',
    'about:blank'
  ], { stdio: 'ignore' });

  let debuggerUrl = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      const response = await fetch(`http://127.0.0.1:${chromePort}/json/list`);
      const targets = await response.json();
      debuggerUrl = targets.find(target => target.type === 'page')?.webSocketDebuggerUrl || null;
      if (debuggerUrl) break;
    } catch (_) {}
  }
  if (!debuggerUrl) throw new Error('Could not connect to Chrome DevTools Protocol');

  socket = new WebSocket(debuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params?.exceptionDetails;
      browserErrors.push(details?.exception?.description || details?.text || 'Uncaught browser exception');
      return;
    }
    if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
      browserErrors.push(message.params.entry.text || 'Browser error log entry');
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  // Exercise the built artifact through the WebMCP registration boundary even
  // when the locally installed Chrome does not expose the experimental native
  // API. This shim implements only the current registerTool contract; it is not
  // evidence of native browser-agent availability.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const registrations = [];
      Object.defineProperty(document, 'modelContext', {
        configurable: true,
        value: {
          registrations,
          async registerTool(tool, options = {}) {
            if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            registrations.push(tool);
            options.signal?.addEventListener('abort', () => {
              const index = registrations.indexOf(tool);
              if (index >= 0) registrations.splice(index, 1);
            }, { once: true });
          },
          async getTools() {
            return registrations.map(({ execute, ...metadata }) => metadata);
          },
          async executeTool(registeredTool, input = {}, options = {}) {
            const tool = registrations.find(candidate => candidate.name === registeredTool.name);
            if (!tool) throw new DOMException('Unknown tool', 'NotFoundError');
            const inputObject = typeof input === 'string' ? JSON.parse(input) : input;
            const signal = options.signal || new AbortController().signal;
            return JSON.stringify(await tool.execute(inputObject, { signal }));
          }
        }
      });
    })()`
  });
  await send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/sabura.html` });
  await waitFor('Boolean(window.sabura?.agent && window.saburaApp)', 'built Sabura agent API');
  await waitFor('document.modelContext?.registrations?.length === 7', 'seven Sabura WebMCP tool registrations');

  const webMcpContract = await evaluate(`(async () => {
    const tools = await document.modelContext.getTools();
    const read = tools.find(tool => tool.name === 'sabura_read_board');
    const signal = new AbortController().signal;
    const snapshot = JSON.parse(await document.modelContext.executeTool(read, {}, { signal }));
    return {
      names: tools.map(tool => tool.name),
      readAnnotations: read.annotations,
      editSchemaStrict: tools.find(tool => tool.name === 'sabura_edit_board').inputSchema.additionalProperties === false,
      snapshotSuccess: snapshot.success,
      apiVersion: snapshot.apiVersion
    };
  })()`);
  if (JSON.stringify(webMcpContract.names) !== JSON.stringify([
    'sabura_read_board', 'sabura_edit_board', 'sabura_undo', 'sabura_redo',
    'sabura_focus_objects', 'sabura_fit_board', 'sabura_save_copy'
  ]) || !webMcpContract.readAnnotations.readOnlyHint ||
      !webMcpContract.readAnnotations.untrustedContentHint ||
      !webMcpContract.editSchemaStrict || !webMcpContract.snapshotSuccess ||
      webMcpContract.apiVersion !== 'sabura/agent/v1') {
    throw new Error(`WebMCP browser contract failed: ${JSON.stringify(webMcpContract)}`);
  }

  await evaluate(`(() => {
    window.__agentProofErrors = [];
    window.addEventListener('error', event => window.__agentProofErrors.push(String(event.error?.message || event.message)));
    window.addEventListener('unhandledrejection', event => window.__agentProofErrors.push(String(event.reason?.message || event.reason)));
    const editButton = document.getElementById('btn-edit');
    if (!editButton) throw new Error('Reading-mode Edit button was not rendered');
    editButton.click();
    return true;
  })()`);

  const initial = await evaluate(`(() => {
    const description = window.sabura.agent.describe();
    const snapshot = window.sabura.agent.read();
    return {
      apiVersion: description.apiVersion,
      commandVersion: description.commandSchemaVersion,
      existingHumanIds: snapshot.document.order.slice(),
      initialObjectCount: snapshot.document.order.length,
      mode: snapshot.mode,
      editToken: snapshot.editToken
    };
  })()`);
  if (initial.apiVersion !== 'sabura/agent/v1' || initial.commandVersion !== 'sabura/commands/v1') {
    throw new Error('Discovery returned unexpected versions');
  }
  if (initial.initialObjectCount < 1 || initial.mode !== 'editing') {
    throw new Error('Disposable board did not retain existing human content or enter Editing mode');
  }

  const created = await evaluate(`(async () => {
    const token = window.sabura.agent.read().editToken;
    const request = {
      requestId: 'e2e-create-story',
      expectedEditToken: token,
      commands: [
        { type: 'create_object', object: { id: 'agent_a', type: 'rectangle', x: 80, y: 450, width: 160, height: 90, text: 'Draft A' } },
        { type: 'create_object', object: { id: 'agent_b', type: 'ellipse', x: 360, y: 450, width: 160, height: 90, text: 'Draft B' } },
        { type: 'create_object', object: { id: 'agent_c', type: 'diamond', x: 650, y: 450, width: 160, height: 100, text: 'Draft C' } },
        { type: 'connect_objects', connectorId: 'agent_ab', fromId: 'agent_a', toId: 'agent_b', routing: 'straight' },
        { type: 'connect_objects', connectorId: 'agent_bc', fromId: 'agent_b', toId: 'agent_c', routing: 'curved' }
      ]
    };
    const editTool = (await document.modelContext.getTools()).find(tool => tool.name === 'sabura_edit_board');
    const result = JSON.parse(await document.modelContext.executeTool(editTool, request));
    window.__agentCreateRequest = request;
    const connectorPath = document.querySelector('#elem-agent_ab path')?.getAttribute('d');
    return { result, connectorPath, historyLength: window.saburaApp.undoStack.length };
  })()`);
  if (!created.result.success || created.result.affected.created.length !== 5 || created.historyLength !== 1) {
    throw new Error(`Atomic creation failed: ${JSON.stringify(created)}`);
  }

  const refined = await evaluate(`(async () => {
    const token = window.sabura.agent.read().editToken;
    const editTool = (await document.modelContext.getTools()).find(tool => tool.name === 'sabura_edit_board');
    const result = JSON.parse(await document.modelContext.executeTool(editTool, {
      requestId: 'e2e-refine-story',
      expectedEditToken: token,
      commands: [
        { type: 'move_objects', ids: ['agent_b'], dx: 0, dy: 120 },
        { type: 'set_text', id: 'agent_a', text: 'Ingress' },
        { type: 'set_text', id: 'agent_b', text: 'Transform' },
        { type: 'set_text', id: 'agent_c', text: 'Publish' },
        { type: 'set_style', ids: ['agent_a'], updates: { fill: '#a5d8ff' } },
        { type: 'set_style', ids: ['agent_b'], updates: { fill: '#b2f2bb' } },
        { type: 'set_style', ids: ['agent_c'], updates: { fill: '#ffec99' } }
      ]
    }));
    return {
      result,
      connectorPath: document.querySelector('#elem-agent_ab path')?.getAttribute('d'),
      historyLength: window.saburaApp.undoStack.length,
      document: window.sabura.agent.read().document
    };
  })()`);
  if (!refined.result.success || refined.historyLength !== 2 || refined.connectorPath === created.connectorPath) {
    throw new Error('Atomic refinement or connector-follow behavior failed');
  }

  const history = await evaluate(`(async () => {
    const tools = await document.modelContext.getTools();
    const beforeUndo = window.sabura.agent.read();
    const undoTool = tools.find(tool => tool.name === 'sabura_undo');
    const redoTool = tools.find(tool => tool.name === 'sabura_redo');
    const undo = JSON.parse(await document.modelContext.executeTool(undoTool, {
      requestId: 'e2e-undo', expectedEditToken: beforeUndo.editToken
    }));
    const afterUndo = window.sabura.agent.read();
    const redo = JSON.parse(await document.modelContext.executeTool(redoTool, {
      requestId: 'e2e-redo', expectedEditToken: afterUndo.editToken
    }));
    const afterRedo = window.sabura.agent.read();
    return { undo, redo, afterUndo, afterRedo };
  })()`);
  if (!history.undo.success || !history.redo.success || history.afterUndo.document.objects.agent_b.y !== 450 || history.afterRedo.document.objects.agent_b.y !== 570) {
    throw new Error('Agent Undo/Redo did not restore the atomic refinement');
  }

  const invalid = await evaluate(`(async () => {
    const before = window.sabura.agent.read();
    const historyLength = window.saburaApp.undoStack.length;
    const editTool = (await document.modelContext.getTools()).find(tool => tool.name === 'sabura_edit_board');
    const result = JSON.parse(await document.modelContext.executeTool(editTool, {
      requestId: 'e2e-invalid',
      expectedEditToken: before.editToken,
      commands: [
        { type: 'create_object', object: { id: 'agent_partial', type: 'rectangle', x: 0, y: 0, width: 80, height: 60 } },
        { type: 'connect_objects', connectorId: 'agent_invalid_edge', fromId: 'agent_partial', toId: 'missing_target' }
      ]
    }));
    const after = window.sabura.agent.read();
    return {
      result,
      unchanged: JSON.stringify(before.document) === JSON.stringify(after.document),
      tokenUnchanged: JSON.stringify(before.editToken) === JSON.stringify(after.editToken),
      historyUnchanged: historyLength === window.saburaApp.undoStack.length,
      partialExists: Boolean(after.document.objects.agent_partial)
    };
  })()`);
  if (invalid.result.success || !invalid.unchanged || !invalid.tokenUnchanged || !invalid.historyUnchanged || invalid.partialExists) {
    throw new Error('Invalid batch was not fully atomic');
  }

  const concurrency = await evaluate(`(async () => {
    const staleToken = window.sabura.agent.read().editToken;
    const themeSelect = document.getElementById('select-board-theme');
    themeSelect.value = 'blueprint';
    themeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    const afterHuman = window.sabura.agent.read();
    const editTool = (await document.modelContext.getTools()).find(tool => tool.name === 'sabura_edit_board');
    const stale = JSON.parse(await document.modelContext.executeTool(editTool, {
      requestId: 'e2e-stale',
      expectedEditToken: staleToken,
      commands: [{ type: 'set_text', id: 'agent_a', text: 'Must not apply' }]
    }));
    const retry = JSON.parse(await document.modelContext.executeTool(editTool, window.__agentCreateRequest));
    const final = window.sabura.agent.read();
    return {
      humanAdvancedToken: afterHuman.editToken.sequence > staleToken.sequence,
      stale,
      retry,
      agentACount: final.document.order.filter(id => id === 'agent_a').length,
      protectedText: final.document.objects.agent_a.text,
      mappedFills: [final.document.objects.agent_a.fill, final.document.objects.agent_b.fill, final.document.objects.agent_c.fill]
    };
  })()`);
  if (!concurrency.humanAdvancedToken || concurrency.stale.success || concurrency.stale.errors[0].code !== 'STALE_EDIT' ||
      !concurrency.retry.success || concurrency.agentACount !== 1 || concurrency.protectedText !== 'Ingress') {
    throw new Error('Stale-write protection or idempotent retry failed');
  }

  const viewport = await evaluate(`(async () => {
    const before = window.sabura.agent.read();
    const tools = await document.modelContext.getTools();
    const focusTool = tools.find(tool => tool.name === 'sabura_focus_objects');
    const fitTool = tools.find(tool => tool.name === 'sabura_fit_board');
    const focus = JSON.parse(await document.modelContext.executeTool(focusTool, {
      ids: ['agent_a', 'agent_b', 'agent_c'], padding: 90
    }));
    const fit = JSON.parse(await document.modelContext.executeTool(fitTool, {}));
    const after = window.sabura.agent.read();
    return {
      focus,
      fit,
      tokenUnchanged: JSON.stringify(before.editToken) === JSON.stringify(after.editToken),
      documentUnchanged: JSON.stringify(before.document) === JSON.stringify(after.document)
    };
  })()`);
  if (!viewport.focus.success || !viewport.fit.success || !viewport.tokenUnchanged || !viewport.documentUnchanged) {
    throw new Error('Viewport operations changed persistent editor state');
  }

  const save = await evaluate(`(async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = blob => {
      window.__agentSavedBlob = blob;
      return originalCreateObjectURL.call(URL, blob);
    };
    const saveTool = (await document.modelContext.getTools()).find(tool => tool.name === 'sabura_save_copy');
    const result = JSON.parse(await document.modelContext.executeTool(saveTool, {}));
    const html = window.__agentSavedBlob ? await window.__agentSavedBlob.text() : null;
    return { result, html, liveDocument: window.sabura.agent.read().document };
  })()`);
  if (!save.result.success || !save.result.exportPrepared || !save.result.downloadRequested || save.result.deliveryConfirmed !== false || !save.html) {
    throw new Error('Agent Save Copy did not report or prepare the expected artifact');
  }
  savedHtml = save.html;

  await send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/saved-agent.html` });
  await waitFor('Boolean(window.sabura?.agent && window.saburaApp)', 'saved Sabura copy');
  const reopened = await evaluate(`(() => {
    const snapshot = window.sabura.agent.read();
    const doc = snapshot.document;
    const validation = window.sabura.validateDocument(doc);
    return {
      valid: validation.valid,
      idsPresent: ['agent_a', 'agent_b', 'agent_c', 'agent_ab', 'agent_bc'].every(id => Boolean(doc.objects[id])),
      labels: [doc.objects.agent_a.text, doc.objects.agent_b.text, doc.objects.agent_c.text],
      fills: [doc.objects.agent_a.fill, doc.objects.agent_b.fill, doc.objects.agent_c.fill],
      attachments: [doc.objects.agent_ab.from.id, doc.objects.agent_ab.to.id, doc.objects.agent_bc.from.id, doc.objects.agent_bc.to.id],
      hasRevision: Boolean(doc['ext:sabura:revision']?.revisionId),
      existingHumanPreserved: ${JSON.stringify(initial.existingHumanIds)}.every(id => Boolean(doc.objects[id])),
      errors: window.__agentProofErrors || []
    };
  })()`);
  if (!reopened.valid || !reopened.idsPresent || !reopened.hasRevision || !reopened.existingHumanPreserved ||
      JSON.stringify(reopened.labels) !== JSON.stringify(['Ingress', 'Transform', 'Publish']) ||
      JSON.stringify(reopened.fills) !== JSON.stringify(concurrency.mappedFills) ||
      JSON.stringify(reopened.attachments) !== JSON.stringify(['agent_a', 'agent_b', 'agent_b', 'agent_c']) ||
      reopened.errors.length > 0) {
    throw new Error(`Saved-copy verification failed: ${JSON.stringify(reopened)}`);
  }
  if (browserErrors.length > 0) {
    throw new Error(`Uncaught browser errors: ${JSON.stringify(browserErrors)}`);
  }

  console.log(JSON.stringify({
    success: true,
    apiVersion: initial.apiVersion,
    webMcpShimContract: webMcpContract,
    existingHumanObjects: initial.initialObjectCount,
    atomicCreateHistoryEntries: created.historyLength,
    atomicRefineHistoryEntries: refined.historyLength - created.historyLength,
    invalidBatchCode: invalid.result.errors[0].code,
    staleBatchCode: concurrency.stale.errors[0].code,
    idempotentRetryObjectCount: concurrency.agentACount,
    viewportStateOnly: viewport.tokenUnchanged && viewport.documentUnchanged,
    uncaughtBrowserErrors: browserErrors.length,
    save: save.result,
    reopened
  }, null, 2));
} finally {
  for (const waiter of pending.values()) waiter.reject(new Error('Browser verification stopped'));
  pending.clear();
  try { socket?.close(); } catch (_) {}
  try { chrome?.kill('SIGTERM'); } catch (_) {}
  await new Promise(resolve => server.close(resolve));
  try { fs.rmSync(chromeProfile, { recursive: true, force: true }); } catch (_) {}
}
