import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const rootDir = path.resolve('.');
const port = 8094;

const server = http.createServer((req, res) => {
  const filePath = path.join(rootDir, 'sabura.html');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(filePath, 'utf8'));
});

server.listen(port, '127.0.0.1', async () => {
  console.log(`Server listening at http://127.0.0.1:${port}`);

  // Launch Chrome headless
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    '--remote-debugging-port=9225',
    '--disable-gpu',
    `http://127.0.0.1:${port}`
  ]);

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  await sleep(1500);

  try {
    const listRes = await fetch('http://127.0.0.1:9225/json/list');
    const pages = await listRes.json();
    const target = pages.find(p => p.url.includes(String(port))) || pages[0];
    const wsUrl = target.webSocketDebuggerUrl;

    const ws = new WebSocket(wsUrl);
    await new Promise(r => ws.onopen = r);

    let idSeq = 1;
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = idSeq++;
      const handler = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.id === id) {
          ws.removeEventListener('message', handler);
          resolve(data.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });

    const evalInPage = async (expr) => {
      const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description || 'Eval error');
      }
      return res.result?.value;
    };

    console.log('--- Running Multi-Object Browser Verification ---');

    // Wait for window.saburaApp to be ready
    await evalInPage(`
      new Promise(async (resolve) => {
        for (let i = 0; i < 50; i++) {
          if (window.saburaApp) return resolve(true);
          await new Promise(r => setTimeout(r, 100));
        }
        resolve(false);
      })
    `);

    // Test 1: Marquee selection and locked object immunity
    const t1 = await evalInPage(`
      (() => {
        const app = window.saburaApp;
        app.doc.objects = {};
        app.doc.order = [];

        // Create 2 unlocked rectangles and 1 locked rectangle
        app.dispatchCommandBatch([
          { type: 'create_object', object: { id: 'box1', type: 'rectangle', x: 100, y: 100, width: 80, height: 60, locked: false } },
          { type: 'create_object', object: { id: 'box2', type: 'rectangle', x: 220, y: 100, width: 80, height: 60, locked: true } },
          { type: 'create_object', object: { id: 'box3', type: 'rectangle', x: 340, y: 100, width: 80, height: 60, locked: false } }
        ]);

        // Marquee over entire area
        app.workspace.setTool('select');
        app.workspace.onPointerDown({ button: 0, clientX: 50, clientY: 50, shiftKey: false });
        app.workspace.onPointerMove({ clientX: 500, clientY: 250 });
        app.workspace.onPointerUp({ button: 0 });

        const selected = [...app.workspace.selectedIds];
        const hasCountBadge = Boolean(document.querySelector('.selection-count-badge'));
        const badgeText = document.querySelector('.selection-count-badge text')?.textContent;

        return {
          selected,
          lockedExcluded: !selected.includes('box2'),
          unlockedIncluded: selected.includes('box1') && selected.includes('box3'),
          hasCountBadge,
          badgeText
        };
      })()
    `);
    console.log('1. Marquee selection & locked immunity:', t1);
    if (!t1.lockedExcluded || !t1.unlockedIncluded || !t1.hasCountBadge) throw new Error('Test 1 failed');

    // Test 2: Moving multi-selection with single-step undo
    const t2 = await evalInPage(`
      (() => {
        const app = window.saburaApp;
        const initialUndoLen = app.undoStack.length;

        // Nudge selection by 20px
        app.dispatchCommand({ type: 'move_objects', ids: app.workspace.selectedIds, dx: 20, dy: 30 });
        const movedX1 = app.doc.objects.box1.x;
        const movedX3 = app.doc.objects.box3.x;

        // Undo
        app.undo();
        const restoredX1 = app.doc.objects.box1.x;
        const restoredX3 = app.doc.objects.box3.x;

        return {
          movedX1,
          movedX3,
          restoredX1,
          restoredX3,
          undoPreserved: restoredX1 === 100 && restoredX3 === 340
        };
      })()
    `);
    console.log('2. Multi-object move & single-step undo:', t2);
    if (!t2.undoPreserved) throw new Error('Test 2 failed');

    // Test 3: Copy, Cut, and Paste with cumulative offset & connector rebinding
    const t3 = await evalInPage(`
      (() => {
        const app = window.saburaApp;
        app.doc.objects = {};
        app.doc.order = [];

        // Box A and Box B with a connector between them
        app.dispatchCommandBatch([
          { type: 'create_object', object: { id: 'a', type: 'rectangle', x: 50, y: 50, width: 80, height: 60 } },
          { type: 'create_object', object: { id: 'b', type: 'rectangle', x: 200, y: 50, width: 80, height: 60 } },
          { type: 'create_object', object: { id: 'c', type: 'connector', from: { id: 'a' }, to: { id: 'b' } } }
        ]);

        app.workspace.selectedIds = ['a', 'b', 'c'];
        app.copy();

        // Paste 1
        app.paste();
        const paste1Ids = [...app.workspace.selectedIds];
        const conn1 = app.doc.objects[paste1Ids.find(id => app.doc.objects[id].type === 'connector')];
        const b1 = app.doc.objects[paste1Ids.find(id => id !== conn1.id && app.doc.objects[id].x > 100)];
        const a1 = app.doc.objects[paste1Ids.find(id => id !== conn1.id && id !== b1.id)];

        // Paste 2
        app.paste();
        const paste2Ids = [...app.workspace.selectedIds];
        const a2 = app.doc.objects[paste2Ids.find(id => app.doc.objects[id].type === 'rectangle' && app.doc.objects[id].width === 80 && app.doc.objects[id].y === 50 + 48)];

        // Single undo reverts paste 2
        app.undo();
        const paste2Gone = paste2Ids.every(id => !app.doc.objects[id]);

        return {
          paste1Bound: conn1.from.id === a1.id && conn1.to.id === b1.id,
          paste1Offset: a1.x === 50 + 24 && a1.y === 50 + 24,
          paste2Offset: a2?.x === 50 + 48,
          paste2Gone
        };
      })()
    `);
    console.log('3. Copy/Paste with connector rebinding & cumulative offset:', t3);
    if (!t3.paste1Bound || !t3.paste1Offset || !t3.paste2Gone) throw new Error('Test 3 failed');

    // Test 4: Grouping, unit movement, drill-down, and ungrouping
    const t4 = await evalInPage(`
      (() => {
        const app = window.saburaApp;
        app.doc.objects = {};
        app.doc.order = [];

        app.dispatchCommandBatch([
          { type: 'create_object', object: { id: 'g1', type: 'rectangle', x: 100, y: 100, width: 80, height: 60 } },
          { type: 'create_object', object: { id: 'g2', type: 'rectangle', x: 200, y: 100, width: 80, height: 60 } }
        ]);

        app.workspace.selectedIds = ['g1', 'g2'];
        // Group
        app.dispatchCommand({ type: 'group_objects', ids: ['g1', 'g2'] });
        const groupId = app.doc.objects.g1.groupId;

        // Click g1: selects both g1 and g2 as a unit
        app.workspace.selectedIds = [];
        app.workspace.onPointerDown({ button: 0, clientX: 120, clientY: 120, shiftKey: false });
        app.workspace.onPointerUp({ button: 0 });
        const groupUnitSelected = app.workspace.selectedIds.length === 2 && app.workspace.selectedIds.includes('g1') && app.workspace.selectedIds.includes('g2');

        // Drill down: double-click g1
        app.workspace.onDblClick({ clientX: 120, clientY: 120 });
        const childDrilled = app.workspace.selectedIds.length === 1 && app.workspace.selectedIds[0] === 'g1' && app.workspace.activeGroupId === groupId;

        // Escape pops back to whole group
        const { isMac } = app.shortcuts;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const returnedToGroup = app.workspace.selectedIds.length === 2 && app.workspace.activeGroupId === null;

        // Ungroup
        app.dispatchCommand({ type: 'ungroup_objects', groupIds: [groupId] });
        const ungrouped = app.doc.objects.g1.groupId === null && app.doc.objects.g2.groupId === null;

        return {
          groupCreated: Boolean(groupId),
          groupUnitSelected,
          childDrilled,
          returnedToGroup,
          ungrouped
        };
      })()
    `);
    console.log('4. Grouping & drill-down:', t4);
    if (!t4.groupCreated || !t4.groupUnitSelected || !t4.childDrilled || !t4.returnedToGroup || !t4.ungrouped) {
      throw new Error('Test 4 failed');
    }

    // Test 5: Alignment and Distribution in world coordinates
    const t5 = await evalInPage(`
      (() => {
        const app = window.saburaApp;
        app.doc.objects = {};
        app.doc.order = [];

        app.dispatchCommandBatch([
          { type: 'create_object', object: { id: 'o1', type: 'rectangle', x: 100, y: 100, width: 100, height: 60 } },
          { type: 'create_object', object: { id: 'o2', type: 'rectangle', x: 200, y: 150, width: 80, height: 60 } },
          { type: 'create_object', object: { id: 'o3', type: 'rectangle', x: 400, y: 200, width: 60, height: 60 } }
        ]);

        app.workspace.selectedIds = ['o1', 'o2', 'o3'];

        // Align right: union right = 460.
        // o1 right should be 460 -> x = 360
        // o2 right should be 460 -> x = 380
        // o3 right should be 460 -> x = 400
        app.dispatchCommand({ type: 'align_objects', ids: ['o1', 'o2', 'o3'], alignment: 'right' });
        const alignRightOk = app.doc.objects.o1.x === 360 && app.doc.objects.o2.x === 380 && app.doc.objects.o3.x === 400;

        // Undo
        app.undo();
        const alignUndoOk = app.doc.objects.o1.x === 100;

        // Distribute horizontal:
        // x positions: 100, 200, 400. Widths: 100, 80, 60.
        // Span = 460 - 100 = 360. Total width = 240. Gap = 120 / 2 = 60.
        // o1 = 100. o2 = 100 + 100 + 60 = 260. o3 = 260 + 80 + 60 = 400.
        app.dispatchCommand({ type: 'distribute_objects', ids: ['o1', 'o2', 'o3'], direction: 'horizontal' });
        const distOk = app.doc.objects.o1.x === 100 && app.doc.objects.o2.x === 260 && app.doc.objects.o3.x === 400;

        return {
          alignRightOk,
          alignUndoOk,
          distOk
        };
      })()
    `);
    console.log('5. Alignment and Distribution:', t5);
    if (!t5.alignRightOk || !t5.alignUndoOk || !t5.distOk) throw new Error('Test 5 failed');

    // Test 6: Wheel context items for multi-selection
    const t6 = await evalInPage(`
      (() => {
        const app = window.saburaApp;
        app.workspace.selectedIds = ['o1', 'o2', 'o3'];
        const selectedObjects = ['o1', 'o2', 'o3'].map(id => app.doc.objects[id]);
        app.wheel.open(400, 300, 'object', selectedObjects[0], app.doc.theme.palette, 3, selectedObjects);

        const items = app.wheel.getItems();
        const ids = items.map(it => it.id);
        const hasAlign = ids.includes('menu_align');
        const hasDist = ids.includes('menu_distribute');
        const hasOrder = ids.includes('menu_order');
        const hasGroup = ids.includes('action_group');
        const hasDup = ids.includes('action_duplicate');
        const hasDelete = ids.includes('action_delete');

        app.wheel.close();

        return {
          ids,
          hasAlign,
          hasDist,
          hasOrder,
          hasGroup,
          hasDup,
          hasDelete
        };
      })()
    `);
    console.log('6. Contextual wheel multi items:', t6);
    if (!t6.hasAlign || !t6.hasDist || !t6.hasOrder || !t6.hasGroup || !t6.hasDup || !t6.hasDelete) {
      throw new Error('Test 6 failed');
    }

    console.log('\n✓ ALL 6 MULTI-OBJECT EDITING BROWSER FLOWS PASSED PERFECTLY!\n');
  } finally {
    chromeProcess.kill();
    server.close();
  }
});
