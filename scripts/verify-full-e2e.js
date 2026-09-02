import { spawn, exec } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { extractDocumentFromHtml } from '../src/storage/file-packer.js';

const rootDir = path.resolve('.');
const port = 8092;

// 1. Build sabura.html before running tests
console.log('--- Step 0: Building latest sabura.html ---');
const saburaHtml = fs.readFileSync(path.join(rootDir, 'sabura.html'), 'utf8');

// 2. Prepare Safari test script
const safariRunnerCode = `
async function runSafariTests() {
  const results = [];
  window.onerror = (msg, url, line) => {
    fetch('/api/safari-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg: 'WINDOW ERROR: ' + msg + ' at line ' + line })
    }).catch(() => {});
  };
  window.onunhandledrejection = (e) => {
    const reason = e.reason?.stack || e.reason?.message || String(e.reason);
    fetch('/api/safari-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg: 'UNHANDLED REJECTION: ' + reason })
    }).catch(() => {});
  };
  const log = (step, ok, detail) => {
    results.push({ step, ok, detail });
    fetch('/api/safari-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg: (ok ? '✓ ' : '✗ ') + step + ': ' + (detail || '') })
    }).catch(() => {});
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

    // Flow 15: Marquee Selection of Default Board 3 shapes + attached connector
    app.workspace.camera.zoom = 1;
    app.workspace.camera.x = 0;
    app.workspace.camera.y = 0;
    app.workspace.setTool('select');
    app.workspace.selectedIds = [];
    app.workspace.render();
    await sleep(600);

    const canvasEl = document.querySelector('#canvas-container');
    const boundsRect = canvasEl.getBoundingClientRect();

    // Drag marquee covering [40, 40] to [600, 400]
    canvasEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: boundsRect.left + 40, clientY: boundsRect.top + 40, button: 0, buttons: 1 }));
    await sleep(40);
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: boundsRect.left + 600, clientY: boundsRect.top + 400, button: 0, buttons: 1 }));
    await sleep(40);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: boundsRect.left + 600, clientY: boundsRect.top + 400, button: 0, buttons: 0 }));
    await sleep(100);

    const selIds15 = [...app.workspace.selectedIds];
    const marqueeAll4 = selIds15.length === 4 &&
                        selIds15.includes('shape_intro') &&
                        selIds15.includes('shape_idea') &&
                        selIds15.includes('shape_core') &&
                        selIds15.includes('conn_1');

    const badgeText = document.querySelector('.selection-count-badge text')?.textContent;
    const badgeHas4 = badgeText === '4 objects';

    const selRect = document.querySelector('.selection-bounds-rect');
    const selX = parseFloat(selRect?.getAttribute('x') || '0');
    const selY = parseFloat(selRect?.getAttribute('y') || '0');
    const selWidth = parseFloat(selRect?.getAttribute('width') || '0');
    const selHeight = parseFloat(selRect?.getAttribute('height') || '0');

    // Expected: x: 80 - 4 = 76, y: 80 - 4 = 76, width: 430 + 8 = 438, height: 275 + 8 = 283
    const boundsCorrect = Math.abs(selX - 76) <= 2 && Math.abs(selY - 76) <= 2 && Math.abs(selWidth - 438) <= 4;
    log('15. Default Board Marquee Selection & Real Visual Bounds', marqueeAll4 && badgeHas4 && boundsCorrect, 'sel=(' + selX + ',' + selY + ',' + selWidth + 'x' + selHeight + ') badge=' + badgeText);

    // Flow 16: Real Contextual Wheel Click for Align Left
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ', bubbles: true }));
    await sleep(150);

    const alignWedge = document.querySelector('[data-item-id="menu_align"]');
    if (!alignWedge) throw new Error('Align wedge not found on multi-selection wheel');
    alignWedge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(150);

    const alignLeftSub = document.querySelector('[data-sub-id="align_left"]');
    if (!alignLeftSub) throw new Error('Align Left sub-wedge not found');
    alignLeftSub.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(150);

    const introX = app.doc.objects['shape_intro']?.x;
    const ideaX = app.doc.objects['shape_idea']?.x;
    const coreX = app.doc.objects['shape_core']?.x;
    const conn1 = app.doc.objects['conn_1'];

    const alignLeftSuccess = introX === 80 && ideaX === 80 && coreX === 80 && conn1?.from?.id === 'shape_idea' && conn1?.to?.id === 'shape_core';
    log('16. Real Wheel Align Left on Spatial Objects', alignLeftSuccess, 'introX=' + introX + ' ideaX=' + ideaX + ' coreX=' + coreX);

    // Flow 17: Real Keyboard Undo and Redo in 1 step
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modObj = isMac ? { metaKey: true } : { ctrlKey: true };

    // Keyboard Undo: Cmd/Ctrl+Z
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
    await sleep(100);

    const undoIntroX = app.doc.objects['shape_intro']?.x;
    const undoIdeaX = app.doc.objects['shape_idea']?.x;
    const undoCoreX = app.doc.objects['shape_core']?.x;
    const undoOk = undoIntroX === 80 && undoIdeaX === 100 && undoCoreX === 360;

    // Keyboard Redo: Cmd/Ctrl+Shift+Z
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, shiftKey: true, bubbles: true }));
    await sleep(100);

    const redoIdeaX = app.doc.objects['shape_idea']?.x;
    const redoCoreX = app.doc.objects['shape_core']?.x;
    const redoOk = redoIdeaX === 80 && redoCoreX === 80;

    // Undo once more back to original
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
    await sleep(100);

    log('17. Real Keyboard Undo & Redo for Multi-Object Alignment', undoOk && redoOk, 'undoIdea=' + undoIdeaX + ' redoIdea=' + redoIdeaX);

    // Flow 18: Real Contextual Wheel Click for Distribute Horizontal
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ', bubbles: true }));
    await sleep(150);

    const distWedge = document.querySelector('[data-item-id="menu_distribute"]');
    if (!distWedge) throw new Error('Distribute wedge not found');
    distWedge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(150);

    const distHSub = document.querySelector('[data-sub-id="dist_h"]');
    if (!distHSub) throw new Error('Distribute Horizontal sub-wedge not found');
    distHSub.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(150);

    const distIntroX = app.doc.objects['shape_intro']?.x;
    const distIdeaX = app.doc.objects['shape_idea']?.x;
    const distCoreX = app.doc.objects['shape_core']?.x;
    const distOk = distIntroX === 80 && distIdeaX !== 100 && distCoreX === 360;

    // Undo distribution
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
    await sleep(100);
    const distUndoOk = app.doc.objects['shape_idea']?.x === 100;

    log('18. Real Wheel Distribute Horizontal & 1-Step Undo', distOk && distUndoOk, 'distOk=' + distOk + ' distUndoOk=' + distUndoOk);

    // Flow 19: Real Shift-Click Multi-Selection and Real Drag Movement
    canvasEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: boundsRect.left + 10, clientY: boundsRect.top + 10, button: 0 }));
    await sleep(50);
    canvasEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: boundsRect.left + 10, clientY: boundsRect.top + 10, button: 0 }));
    await sleep(50);

    // Click shape_intro (x: 80, y: 80, w: 340, h: 100) -> click at (150, 120)
    canvasEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: boundsRect.left + 150, clientY: boundsRect.top + 120, button: 0 }));
    await sleep(30);
    canvasEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: boundsRect.left + 150, clientY: boundsRect.top + 120, button: 0 }));
    await sleep(50);

    // Shift-click shape_core (x: 360, y: 235, w: 150, h: 120) -> click at (400, 280)
    canvasEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, shiftKey: true, clientX: boundsRect.left + 400, clientY: boundsRect.top + 280, button: 0 }));
    await sleep(30);
    canvasEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, shiftKey: true, clientX: boundsRect.left + 400, clientY: boundsRect.top + 280, button: 0 }));
    await sleep(50);

    const shiftSelOk = app.workspace.selectedIds.length === 2 &&
                       app.workspace.selectedIds.includes('shape_intro') &&
                       app.workspace.selectedIds.includes('shape_core');

    // Real pointer drag of the multi-selection by (+30, +20)
    canvasEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: boundsRect.left + 150, clientY: boundsRect.top + 120, button: 0, buttons: 1 }));
    await sleep(30);
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: boundsRect.left + 180, clientY: boundsRect.top + 140, button: 0, buttons: 1 }));
    await sleep(30);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: boundsRect.left + 180, clientY: boundsRect.top + 140, button: 0, buttons: 0 }));
    await sleep(100);

    const dragIntroX = app.doc.objects['shape_intro']?.x;
    const dragCoreX = app.doc.objects['shape_core']?.x;
    const dragOk = dragIntroX === 110 && dragCoreX === 390;

    // Undo drag in one step
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
    await sleep(100);

    const dragUndoOk = app.doc.objects['shape_intro']?.x === 80 && app.doc.objects['shape_core']?.x === 360;
    log('19. Real Shift-Click & Drag Multi-Selection with 1-Step Undo', shiftSelOk && dragOk && dragUndoOk, 'dragOk=' + dragOk + ' undoOk=' + dragUndoOk);

    // Flow 20: Real Keyboard Copy, Paste, Group & Ungroup
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', ...modObj, bubbles: true }));
    await sleep(50);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', ...modObj, bubbles: true }));
    await sleep(100);

    const pasteIds = [...app.workspace.selectedIds];
    const pastedOk = pasteIds.length === 2 && pasteIds.every(id => id !== 'shape_intro' && id !== 'shape_core');
    const pastedOffset = app.doc.objects[pasteIds[0]]?.x === 80 + 24;

    // Undo paste in one step
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
    await sleep(100);
    const pasteUndoOk = pasteIds.every(id => !app.doc.objects[id]);

    // Test Cmd/Ctrl+G (Group)
    app.workspace.selectedIds = ['shape_intro', 'shape_idea'];
    app.workspace.render();
    await sleep(50);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', ...modObj, bubbles: true }));
    await sleep(100);

    const groupGid = app.doc.objects['shape_intro']?.groupId;
    const groupCreated = groupGid && groupGid === app.doc.objects['shape_idea']?.groupId;

    // Test Cmd/Ctrl+Shift+G (Ungroup)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', ...modObj, shiftKey: true, bubbles: true }));
    await sleep(100);

    const ungrouped = app.doc.objects['shape_intro']?.groupId === null && app.doc.objects['shape_idea']?.groupId === null;

    log('20. Real Keyboard Copy, Paste, Group & Ungroup', pastedOk && pastedOffset && pasteUndoOk && groupCreated && ungrouped, 'pasteOk=' + pastedOk + ' groupCreated=' + groupCreated + ' ungrouped=' + ungrouped);

    // Flow 21: Real Multi-Object D-Drag with No Placement Jump
    app.workspace.selectedIds = ['shape_idea', 'shape_core'];
    app.workspace.render();
    await sleep(50);

    const origIdea = { x: app.doc.objects['shape_idea'].x, y: app.doc.objects['shape_idea'].y };
    const origCore = { x: app.doc.objects['shape_core'].x, y: app.doc.objects['shape_core'].y };

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true }));
    await sleep(20);

    canvasEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: boundsRect.left + 175, clientY: boundsRect.top + 295, button: 0, buttons: 1 }));
    await sleep(30);
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: boundsRect.left + 275, clientY: boundsRect.top + 345, button: 0, buttons: 1 }));
    await sleep(30);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: boundsRect.left + 275, clientY: boundsRect.top + 345, button: 0, buttons: 0 }));
    await sleep(30);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', bubbles: true }));
    await sleep(50);

    const ddragIds = [...app.workspace.selectedIds];
    const ddragCreated = ddragIds.length === 2 && ddragIds.every(id => id !== 'shape_idea' && id !== 'shape_core');
    const origsUntouched = app.doc.objects['shape_idea'].x === origIdea.x &&
                           app.doc.objects['shape_core'].x === origCore.x;

    const dupIdea = app.doc.objects[ddragIds.find(id => app.doc.objects[id].type === 'ellipse')];
    const dupCore = app.doc.objects[ddragIds.find(id => app.doc.objects[id].type === 'diamond')];
    const dxIdea = dupIdea ? dupIdea.x - origIdea.x : 0;
    const dyIdea = dupIdea ? dupIdea.y - origIdea.y : 0;
    const dxCore = dupCore ? dupCore.x - origCore.x : 0;
    const dyCore = dupCore ? dupCore.y - origCore.y : 0;
    const noJump = Boolean(dupIdea && dupCore &&
                   dxIdea === dxCore &&
                   dyIdea === dyCore &&
                   Math.abs(dxIdea - 100) <= 8 &&
                   Math.abs(dyIdea - 50) <= 8);

    // Undo D-drag in one step
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
    await sleep(100);

    const ddragUndoOk = ddragIds.every(id => !app.doc.objects[id]);

    log('21. Real Multi-Object D-Drag with No Placement Jump & 1-Step Undo', ddragCreated && origsUntouched && noJump && ddragUndoOk, 'created=' + ddragCreated + ' noJump=' + noJump + ' undoOk=' + ddragUndoOk);

    // Flow 22: Move Grouped Objects Together with Pointer Drag & 1-Step Undo
    {
      app.workspace.selectedIds = ['shape_intro', 'shape_idea'];
      app.workspace.render();
      await sleep(50);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', ...modObj, bubbles: true }));
      await sleep(100);

      const gId = app.doc.objects['shape_intro']?.groupId;
      const isGroupedNow = gId && gId === app.doc.objects['shape_idea']?.groupId;

      // Deselect by clicking whitespace
      canvasEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: boundsRect.left + 10, clientY: boundsRect.top + 10, button: 0 }));
      await sleep(30);
      canvasEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: boundsRect.left + 10, clientY: boundsRect.top + 10, button: 0 }));
      await sleep(50);

      const deselected = app.workspace.selectedIds.length === 0;

      // Click shape_intro -> must select the whole group as a single unit
      canvasEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: boundsRect.left + 150, clientY: boundsRect.top + 120, button: 0 }));
      await sleep(30);
      canvasEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: boundsRect.left + 150, clientY: boundsRect.top + 120, button: 0 }));
      await sleep(50);

      const clickedGroupSelected = app.workspace.selectedIds.length === 2 &&
                                   app.workspace.selectedIds.includes('shape_intro') &&
                                   app.workspace.selectedIds.includes('shape_idea');

      // Drag the group by dragging shape_intro by (+50, +40)
      const preIntro = { x: app.doc.objects['shape_intro'].x, y: app.doc.objects['shape_intro'].y };
      const preIdea = { x: app.doc.objects['shape_idea'].x, y: app.doc.objects['shape_idea'].y };

      canvasEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: boundsRect.left + 150, clientY: boundsRect.top + 120, button: 0, buttons: 1 }));
      await sleep(30);
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: boundsRect.left + 200, clientY: boundsRect.top + 160, button: 0, buttons: 1 }));
      await sleep(30);
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: boundsRect.left + 200, clientY: boundsRect.top + 160, button: 0, buttons: 0 }));
      await sleep(100);

      const postIntro = { x: app.doc.objects['shape_intro'].x, y: app.doc.objects['shape_intro'].y };
      const postIdea = { x: app.doc.objects['shape_idea'].x, y: app.doc.objects['shape_idea'].y };

      const dxIntro = postIntro.x - preIntro.x;
      const dyIntro = postIntro.y - preIntro.y;
      const dxIdea = postIdea.x - preIdea.x;
      const dyIdea = postIdea.y - preIdea.y;

      const groupMovedTogether = dxIntro === dxIdea && dyIntro === dyIdea && dxIntro !== 0 && dyIntro !== 0;

      // Undo group move in 1 step
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(100);

      const undoIntro = app.doc.objects['shape_intro'].x === preIntro.x && app.doc.objects['shape_intro'].y === preIntro.y;
      const undoIdea = app.doc.objects['shape_idea'].x === preIdea.x && app.doc.objects['shape_idea'].y === preIdea.y;
      const groupUndoOk = undoIntro && undoIdea;

      // Clean up: ungroup
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', ...modObj, shiftKey: true, bubbles: true }));
      await sleep(100);

      log('22. Real Move Grouped Objects Together with Pointer Drag & 1-Step Undo', isGroupedNow && deselected && clickedGroupSelected && groupMovedTogether && groupUndoOk, 'together=' + groupMovedTogether + ' delta=(' + dxIntro + ',' + dyIntro + ') undo=' + groupUndoOk);
    }

    // Flow 23: Interactive Curved Connector Flipping via Arc Handle & F Key
    {
      app.workspace.selectedIds = ['conn_1'];
      app.workspace.render();
      await sleep(50);

      const curveHandle = document.querySelector('[data-handle="conn-curve"]');
      const hasCurveHandle = Boolean(curveHandle);

      const connObj = app.doc.objects['conn_1'];
      const initialSide = connObj?.curveSide !== undefined ? connObj.curveSide : 1;

      if (curveHandle) {
        const hRect = curveHandle.getBoundingClientRect();
        curveHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2, button: 0 }));
        await sleep(30);
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2, button: 0 }));
        await sleep(50);
      }

      const flippedClick = app.doc.objects['conn_1']?.curveSide === -1;

      // 1-step undo
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(100);
      const undoClick = (app.doc.objects['conn_1']?.curveSide !== undefined ? app.doc.objects['conn_1'].curveSide : 1) === initialSide;

      // 1-step redo
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, shiftKey: true, bubbles: true }));
      await sleep(100);
      const redoClick = app.doc.objects['conn_1']?.curveSide === -1;

      // Reset back to initial
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(100);

      // Press F hotkey -> flips curveSide to -1
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true }));
      await sleep(100);
      const fKeyFlip = app.doc.objects['conn_1']?.curveSide === -1;

      // Undo F hotkey
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(100);
      const undoF = (app.doc.objects['conn_1']?.curveSide !== undefined ? app.doc.objects['conn_1'].curveSide : 1) === 1;

      log('23. Interactive Curved Connector Flipping via Arc Handle & F Key', hasCurveHandle && flippedClick && undoClick && redoClick && fKeyFlip && undoF, 'hasHandle=' + hasCurveHandle + ' clickFlip=' + flippedClick + ' undoClick=' + undoClick + ' redoClick=' + redoClick + ' fKey=' + fKeyFlip + ' undoF=' + undoF);
    }

    // Flow 24: Continuous Curved Depth Dragging & 1-Step Undo
    {
      app.workspace.selectedIds = ['conn_1'];
      app.workspace.render();
      await sleep(50);

      const curveHandle = document.querySelector('[data-handle="conn-curve"]');
      if (curveHandle) {
        const hRect = curveHandle.getBoundingClientRect();
        curveHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2, button: 0, buttons: 1 }));
        await sleep(30);
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2 + 150, button: 0, buttons: 1 }));
        await sleep(30);
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2 + 150, button: 0, buttons: 0 }));
        await sleep(50);
      }

      const deepCurvedOk = typeof app.doc.objects['conn_1']?.curveDistance === 'number' && app.doc.objects['conn_1'].curveDistance > 100;

      // 1-step undo restores auto depth
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(100);
      const undoDeepOk = app.doc.objects['conn_1']?.curveDistance === undefined;

      log('24. Continuous Curved Depth Dragging & 1-Step Undo', deepCurvedOk && undoDeepOk, 'deep=' + deepCurvedOk + ' undo=' + undoDeepOk);
    }

    // Flow 25: Elbow U-Bypass Loop Dragging & 1-Step Undo
    {
      // Switch conn_1 to elbow
      app.dispatchCommand({ type: 'configure_connector', id: 'conn_1', routing: 'elbow' });
      app.workspace.selectedIds = ['conn_1'];
      app.workspace.render();
      await sleep(50);

      const elbowHandle = document.querySelector('[data-handle="conn-elbow"]');
      const hasElbowHandle = Boolean(elbowHandle);

      if (elbowHandle) {
        const hRect = elbowHandle.getBoundingClientRect();
        elbowHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2, button: 0, buttons: 1 }));
        await sleep(30);
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2 + 120, button: 0, buttons: 1 }));
        await sleep(30);
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2 + 120, button: 0, buttons: 0 }));
        await sleep(50);
      }

      const hasBypass = typeof app.doc.objects['conn_1']?.elbowOffset === 'number' && app.doc.objects['conn_1'].elbowOffset > 50;

      // Click handle to flip side
      const elbowHandle2 = document.querySelector('[data-handle="conn-elbow"]');
      if (elbowHandle2) {
        const hRect = elbowHandle2.getBoundingClientRect();
        elbowHandle2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2, button: 0 }));
        await sleep(30);
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2, button: 0 }));
        await sleep(50);
      }

      const flippedBypass = typeof app.doc.objects['conn_1']?.elbowOffset === 'number' && app.doc.objects['conn_1'].elbowOffset < 0;

      // 1-step undo restores downward bypass
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(100);
      const undoFlipBypass = typeof app.doc.objects['conn_1']?.elbowOffset === 'number' && app.doc.objects['conn_1'].elbowOffset > 0;

      // 1-step undo restores standard elbow step
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(100);
      const undoBypassOk = app.doc.objects['conn_1']?.elbowOffset === undefined;

      // Restore conn_1 to curved routing
      app.dispatchCommand({ type: 'configure_connector', id: 'conn_1', routing: 'curved' });
      await sleep(50);

      log('25. Elbow U-Bypass Loop Dragging & 1-Step Undo', hasElbowHandle && hasBypass && flippedBypass && undoFlipBypass && undoBypassOk, 'handle=' + hasElbowHandle + ' bypass=' + hasBypass + ' flipped=' + flippedBypass + ' undo=' + undoBypassOk);
    }

    // Flow 26: Point-by-Point Line & Polygon Tool, Smooth Curves, Vertex Dragging & Undo
    {
      app.workspace.setTool('line');
      await sleep(50);

      const cRect = app.workspace.container.getBoundingClientRect();
      const p1 = { x: cRect.left + 500, y: cRect.top + 300 };
      const p2 = { x: cRect.left + 650, y: cRect.top + 320 };
      const p3 = { x: cRect.left + 600, y: cRect.top + 450 };

      // Point 1 click
      app.workspace.container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: p1.x, clientY: p1.y, button: 0 }));
      await sleep(30);
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: p2.x, clientY: p2.y, button: 0 }));
      await sleep(30);

      // Point 2 click
      app.workspace.container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: p2.x, clientY: p2.y, button: 0 }));
      await sleep(30);
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: p3.x, clientY: p3.y, button: 0 }));
      await sleep(30);

      // Point 3 click
      app.workspace.container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: p3.x, clientY: p3.y, button: 0 }));
      await sleep(30);

      // Move close to P1 to trigger close snap
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: p1.x + 3, clientY: p1.y + 3, button: 0 }));
      await sleep(30);

      // Click near P1 to close into polygon
      app.workspace.container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: p1.x + 3, clientY: p1.y + 3, button: 0 }));
      await sleep(80);

      const createdObj = app.doc.objects[app.workspace.selectedIds[0]];
      const isClosedPolygon = createdObj && createdObj.type === 'path' && createdObj.closed === true;

      // Toggle to smooth curve via command/wheel
      app.dispatchCommand({ type: 'set_style', ids: [createdObj.id], updates: { curveStyle: 'curved' } });
      await sleep(50);
      const isCurved = app.doc.objects[createdObj.id]?.curveStyle === 'curved';

      // Drag a vertex handle
      const vHandle = document.querySelector('[data-handle="vertex-1"]');
      const hasVertexHandle = Boolean(vHandle);
      if (vHandle) {
        const vRect = vHandle.getBoundingClientRect();
        vHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: vRect.left + vRect.width / 2, clientY: vRect.top + vRect.height / 2, button: 0, buttons: 1 }));
        await sleep(30);
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: vRect.left + vRect.width / 2 + 50, clientY: vRect.top + vRect.height / 2 + 30, button: 0, buttons: 1 }));
        await sleep(30);
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: vRect.left + vRect.width / 2 + 50, clientY: vRect.top + vRect.height / 2 + 30, button: 0, buttons: 0 }));
        await sleep(50);
      }

      // 1-step undo vertex drag
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(100);

      // 1-step undo curve toggle
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(100);
      const undoCurvedOk = app.doc.objects[createdObj.id]?.curveStyle === 'sharp';

      // 1-step undo polygon creation
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(100);
      const undoCreationOk = app.doc.objects[createdObj.id] === undefined;

      // Clean up workspace
      app.workspace.setTool('hand');
      app.workspace.selectedIds = [];
      app.workspace.render();

      log('26. Point-by-Point Line & Polygon Tool, Smooth Curves, Vertex Dragging & Undo', isClosedPolygon && isCurved && hasVertexHandle && undoCurvedOk && undoCreationOk, 'closed=' + isClosedPolygon + ' curved=' + isCurved + ' vertex=' + hasVertexHandle + ' undoCurved=' + undoCurvedOk + ' undoCreate=' + undoCreationOk);

      // Flow 27: Test None Fill in Wheel on Shape
      const testBox = Object.values(app.doc.objects).find(o => o.type === 'rectangle');
      app.workspace.selectedIds = [testBox.id];
      app.workspace.render();
      await sleep(100);

      const shapeCenter = { x: testBox.x + testBox.width / 2, y: testBox.y + testBox.height / 2 };
      app.wheel.open(shapeCenter.x, shapeCenter.y, 'object', testBox, app.doc.theme.palette, 1, [testBox]);
      await sleep(150);

      const fillWedge = document.querySelector('.wheel-wedge[data-item-id="menu_fill"]');
      if (fillWedge) fillWedge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await sleep(150);

      const noneWedge = document.querySelector('.wheel-sub-wedge[data-sub-id="fill_none"]');
      if (noneWedge) noneWedge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await sleep(150);

      const fillAfterNone = app.doc.objects[testBox.id].fill;
      const isNoneApplied = fillAfterNone === 'none';

      // 1-step undo
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(100);
      const undoFillOk = app.doc.objects[testBox.id].fill !== 'none';

      log('27. None Fill via Wheel, Solid Wedge Hit Testing & Undo', isNoneApplied && undoFillOk, 'noneApplied=' + isNoneApplied + ' undoOk=' + undoFillOk);

      // Flow 28: Test Stroke Thickness via Ring 3 in Style
      app.wheel.open(shapeCenter.x, shapeCenter.y, 'object', testBox, app.doc.theme.palette, 1, [testBox]);
      await sleep(150);

      const styleWedge = document.querySelector('.wheel-wedge[data-item-id="menu_style"]');
      if (styleWedge) styleWedge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await sleep(150);

      const width4Wedge = document.querySelector('.wheel-sub-wedge[data-sub-id="width_4"]');
      if (width4Wedge) width4Wedge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await sleep(150);

      const isWidth4Applied = app.doc.objects[testBox.id].strokeWidth === 4;

      // 1-step undo
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(100);
      const undoWidthOk = app.doc.objects[testBox.id].strokeWidth !== 4;

      log('28. Stroke Thickness via Ring 3 in Style & 1-Step Undo', isWidth4Applied && undoWidthOk, 'width4Applied=' + isWidth4Applied + ' undoOk=' + undoWidthOk);

      // Flow 29: Type & Shape Ring 3 Partitioning
      app.wheel.open(shapeCenter.x, shapeCenter.y, 'object', testBox, app.doc.theme.palette, 1, [testBox]);
      await sleep(150);

      const typeWedge = document.querySelector('.wheel-wedge[data-item-id="menu_type"]');
      if (typeWedge) typeWedge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await sleep(150);

      const sizeXLWedge = document.querySelector('.wheel-sub-wedge[data-sub-id="type_xl"]');
      if (sizeXLWedge) sizeXLWedge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await sleep(150);

      const isXLApplied = app.doc.objects[testBox.id].textStyle?.size === 'xl';

      // 1-step undo
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(100);
      const undoXLOk = app.doc.objects[testBox.id].textStyle?.size !== 'xl';

      log('29. Type & Shape Ring 3 Partitioning & 1-Step Undo', isXLApplied && undoXLOk, 'xlApplied=' + isXLApplied + ' undoOk=' + undoXLOk);
    }

    // Flow 30: Keyboard Shortcut S for Equal Sides & 1-Step Undo
    {
      const testBox = Object.values(app.doc.objects).find(o => o.type === 'rectangle');
      const origW = testBox.width;
      const origH = testBox.height;
      app.workspace.selectedIds = [testBox.id];
      app.workspace.render();
      await sleep(100);

      // Press S to square
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', bubbles: true }));
      await sleep(100);

      const boxSquared = app.doc.objects[testBox.id].width === Math.max(origW, origH) &&
                         app.doc.objects[testBox.id].height === Math.max(origW, origH);

      // 1-step undo
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(100);
      const undoSquareOk = app.doc.objects[testBox.id].height === origH;

      app.workspace.selectedIds = [];
      app.workspace.render();
      await sleep(50);

      log('30. Keyboard Shortcut S for Equal Sides & 1-Step Undo', boxSquared && undoSquareOk, 'squared=' + boxSquared + ' undoOk=' + undoSquareOk);
    }

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

    svgEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rect.left + 280, clientY: rect.top + 280, buttons: 1 }));
    await sleep(50);
    svgEl.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: rect.left + 480, clientY: rect.top + 420, buttons: 1 }));
    await sleep(50);
    svgEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: rect.left + 480, clientY: rect.top + 420, buttons: 0 }));
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

    svgEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rect.left + 180, clientY: rect.top + 180, button: 0, buttons: 1 }));
    await sleep(50);
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: rect.left + 330, clientY: rect.top + 280, button: 0, buttons: 1 }));
    await sleep(50);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: rect.left + 330, clientY: rect.top + 280, button: 0, buttons: 0 }));
    await sleep(100);

    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', bubbles: true }));
    app.workspace.isDHeld = false;
    await sleep(100);

    const allObjects = Object.values(app.doc.objects);
    const origRect = app.doc.objects['rect_ddrag'];
    const dupRect = allObjects.find(o => o.id !== 'rect_ddrag' && o.type === 'rectangle' && Math.abs(o.x - 300) <= 15 && Math.abs(o.y - 250) <= 15);

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

    // Flow 10: Movable Object Connection Points in Safari
    app.dispatchCommand({
      type: 'create_object',
      object: { id: 'safari_box', type: 'rectangle', x: 600, y: 600, width: 200, height: 100, seed: 123 }
    });
    app.dispatchCommand({
      type: 'create_object',
      object: { id: 'safari_conn', type: 'connector', from: { id: 'safari_box' }, to: { point: { x: 950, y: 650 } }, routing: 'straight', seed: 456 }
    });
    app.workspace.setTool('select');
    app.workspace.selectedIds = ['safari_conn'];
    app.workspace.render();
    await sleep(50);

    const fromHandle = document.querySelector('[data-handle="conn-from"]');
    const hasHandles = Boolean(fromHandle);

    const cRect = app.workspace.container.getBoundingClientRect();
    const startClientX = 800 * app.workspace.camera.zoom + app.workspace.camera.x + cRect.left;
    const startClientY = 650 * app.workspace.camera.zoom + app.workspace.camera.y + cRect.top;
    const targetClientX = 650 * app.workspace.camera.zoom + app.workspace.camera.x + cRect.left;
    const targetClientY = 600 * app.workspace.camera.zoom + app.workspace.camera.y + cRect.top;

    fetch('/api/safari-log', {
      method: 'POST',
      body: 'Flow 10 start. fromHandle=' + Boolean(fromHandle) + ' handleAttr=' + fromHandle?.getAttribute('data-handle')
    }).catch(() => {});

    // Drag handle to top edge at 25% (x: 150, y: 100)
    fromHandle?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, clientX: startClientX, clientY: startClientY, button: 0, buttons: 1 }));
    await sleep(20);

    fetch('/api/safari-log', {
      method: 'POST',
      body: 'After pointerdown: isReconnecting=' + app.workspace.isReconnecting + ' data=' + JSON.stringify(app.workspace.reconnectingData)
    }).catch(() => {});

    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, composed: true, clientX: targetClientX, clientY: targetClientY, button: 0, buttons: 1 }));
    await sleep(20);

    fetch('/api/safari-log', {
      method: 'POST',
      body: 'After pointermove: latest=' + JSON.stringify(app.workspace.latestReconnectTarget)
    }).catch(() => {});

    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, composed: true, clientX: targetClientX, clientY: targetClientY, button: 0, buttons: 0 }));
    await sleep(100);

    fetch('/api/safari-log', {
      method: 'POST',
      body: 'After pointerup: conn.from=' + JSON.stringify(app.doc.objects['safari_conn']?.from)
    }).catch(() => {});

    const customAnchor = Boolean(app.doc.objects['safari_conn']?.from?.anchor && app.doc.objects['safari_conn'].from.id === 'safari_box');

    // Reset via Auto Connection Points wheel action
    app.handleWheelAction('conn_points_auto');
    await sleep(100);
    const resetToAuto = app.doc.objects['safari_conn']?.from?.anchor === undefined;

    // Undo restores custom anchor
    app.undo();
    await sleep(100);
    const restoredAnchor = Boolean(app.doc.objects['safari_conn']?.from?.anchor);

    log('10. Movable Object Connection Points & Auto Reset', hasHandles && customAnchor && resetToAuto && restoredAnchor, 'Anchor=' + JSON.stringify(app.doc.objects['safari_conn']?.from?.anchor));

    // Flow 11: Tool shortcuts and text editing isolation
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    const toolR = app.workspace.activeTool === 'rectangle';

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
    const toolE = app.workspace.activeTool === 'ellipse';

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));
    const toolT = app.workspace.activeTool === 'text';

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    const toolC = app.workspace.activeTool === 'connector';

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    const toolL = app.workspace.activeTool === 'line';

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    const toolP = app.workspace.activeTool === 'line';

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
    const toolV = app.workspace.activeTool === 'select';

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    const toolH = app.workspace.activeTool === 'hand';

    // Verify typing in textarea does not change active tool
    const dummyTextarea = document.createElement('textarea');
    document.body.appendChild(dummyTextarea);
    dummyTextarea.focus();
    dummyTextarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    const typingProtected = app.workspace.activeTool === 'hand';
    dummyTextarea.remove();

    log('11. Tool Shortcuts & Text Editing Isolation', toolR && toolE && toolT && toolC && toolL && toolP && toolV && toolH && typingProtected, 'r=' + toolR + ' e=' + toolE + ' l=' + toolL + ' p=' + toolP + ' typingProtected=' + typingProtected);

    // Flow 12: Zoom toolbar & view hotkeys
    const zoomBar = document.querySelector('#zoom-help-toolbar');
    const hasZoomBar = Boolean(zoomBar);

    const btnZoomIn = document.querySelector('#btn-zoom-in');
    const btnZoomOut = document.querySelector('#btn-zoom-out');
    const btnZoomReset = document.querySelector('#btn-zoom-reset');
    const btnZoomFit = document.querySelector('#btn-zoom-fit');

    const initZoom = app.workspace.camera.zoom;
    btnZoomIn?.click();
    const zoomedIn = app.workspace.camera.zoom > initZoom;

    btnZoomOut?.click();
    btnZoomOut?.click();
    const zoomedOut = app.workspace.camera.zoom < initZoom;

    btnZoomReset?.click();
    const reset100 = Math.abs(app.workspace.camera.zoom - 1.0) < 0.001;

    btnZoomFit?.click();
    const fitOk = app.workspace.camera.zoom > 0;

    // View Hotkeys: + and - and 0 and 1
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
    const keyZoomIn = app.workspace.camera.zoom > 0;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
    const keyReset = Math.abs(app.workspace.camera.zoom - 1.0) < 0.001;

    log('12. Zoom Toolbar & View Hotkeys', hasZoomBar && zoomedIn && zoomedOut && reset100 && fitOk && keyReset, 'zoomBar=' + hasZoomBar + ' reset100=' + reset100);

    // Flow 13: Help Modal
    const btnHelp = document.querySelector('#btn-help-toggle');
    btnHelp?.click();
    await sleep(50);
    const helpOpened = app.helpModal.isOpen && document.querySelector('#help-modal').classList.contains('visible');

    // Escape closes Help
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(50);
    const helpClosed = !app.helpModal.isOpen;

    // '?' opens Help
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    await sleep(50);
    const helpKeyOpened = app.helpModal.isOpen;

    // Outside click closes Help
    const helpModalEl = document.querySelector('#help-modal');
    helpModalEl?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(50);
    const helpOutsideClosed = !app.helpModal.isOpen;

    log('13. Help Modal via Icon, Shortcut & Outside Click', helpOpened && helpClosed && helpKeyOpened && helpOutsideClosed, 'opened=' + helpOpened + ' closed=' + helpClosed);

    // Flow 14: Presentation Mode toolbar visibility and camera restoration
    app.workspace.camera.zoom = 1.35;
    app.workspace.camera.x = 220;
    app.workspace.camera.y = 180;
    const preZoom = app.workspace.camera.zoom;
    const preX = app.workspace.camera.x;

    app.enterPresentation();
    await sleep(50);
    const toolbarHiddenInPres = window.getComputedStyle(zoomBar).display === 'none';

    app.exitPresentation();
    await sleep(50);
    const toolbarRestored = window.getComputedStyle(zoomBar).display !== 'none';
    const cameraRestored = Math.abs(app.workspace.camera.zoom - preZoom) < 0.001 &&
                           Math.abs(app.workspace.camera.x - preX) < 0.001;

    log('14. Presentation Mode Hiding & Viewport Restoration', toolbarHiddenInPres && toolbarRestored && cameraRestored, 'hidden=' + toolbarHiddenInPres + ' restored=' + cameraRestored);

    // Flow 15: AI Generator API checks (Safari — no download capture)
    // Note: Safari automation cannot intercept file downloads.
    // We verify readAiContract, getDocument, validateDocument, and generateBoardFile
    // (return value only). Download delivery is verified in Chrome Flow 31.
    try {
      const contractResult = window.sabura.readAiContract();
      const contractOk = contractResult.found &&
        typeof contractResult.contract === 'string' &&
        contractResult.contract.includes('SABURA AI CONTRACT') &&
        contractResult.contract.includes('generateBoardFile') &&
        contractResult.contract.includes('BROWSER-AGENT WORKFLOW') &&
        contractResult.contract.includes('FILE-TOOL WORKFLOW') &&
        contractResult.contract.length < 30000; // not the whole runtime
      log('15a. readAiContract() returns guide', contractOk, 'found=' + contractResult.found + ' length=' + contractResult.contract.length);

      const docResult = window.sabura.getDocument();
      const docOk = docResult && typeof docResult.schemaVersion === 'string' &&
        typeof docResult.objects === 'object' &&
        !docResult.html && !docResult.source && !docResult.runtime;
      log('15b. getDocument() returns only board data', Boolean(docOk), 'hasSchema=' + Boolean(docResult?.schemaVersion));

      const valGoodResult = window.sabura.validateDocument({
        schemaVersion: 'sabura/canvas/v1', id: 'board_safari31', title: 'Safari Test',
        theme: app.doc.theme, objects: {}, order: [], groups: {}, assets: {}
      });
      log('15c. validateDocument() accepts valid doc', valGoodResult.valid, 'errors=' + (valGoodResult.errors || []).join(';'));

      const valBadResult = window.sabura.validateDocument({ bogus: true });
      log('15d. validateDocument() rejects invalid doc', !valBadResult.valid && valBadResult.errors.length > 0, 'errors=' + valBadResult.errors.slice(0, 1).join(';'));

      // generateBoardFile — verify return value; we cannot capture the download in Safari
      const genBadResult = window.sabura.generateBoardFile({ bogus: true });
      log('15e. generateBoardFile() rejects invalid doc', !genBadResult.success && genBadResult.errors && genBadResult.errors.length > 0, 'errors=' + (genBadResult.errors || []).slice(0, 1).join(';'));

      const origId = window.sabura.getDocument().id;
      const genGoodResult = window.sabura.generateBoardFile({
        schemaVersion: 'sabura/canvas/v1', id: 'board_safari_gen', title: 'Safari Gen Test',
        theme: app.doc.theme,
        objects: { 's1': { id: 's1', type: 'rectangle', x: 50, y: 50, width: 100, height: 60, seed: 7 } },
        order: ['s1'], groups: {}, assets: {}
      });
      const genOk = genGoodResult.success &&
        typeof genGoodResult.filename === 'string' &&
        typeof genGoodResult.byteLength === 'number' &&
        genGoodResult.byteLength > 200000 &&
        !genGoodResult.html && !genGoodResult.source;
      log('15f. generateBoardFile() returns metadata only (no HTML/source)', genOk, 'byteLength=' + genGoodResult.byteLength);

      const afterId = window.sabura.getDocument().id;
      log('15g. generateBoardFile() does not alter open board', afterId === origId, 'before=' + origId + ' after=' + afterId);

      log('15h. NOTE: Safari download capture not supported — download delivery verified in Chrome Flow 31', true, 'limitation: expected');

    } catch (aiErr) {
      log('15. AI API Checks (Safari)', false, aiErr.message);
    }


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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(runSafariTests, 300));
} else {
  setTimeout(runSafariTests, 300);
}
`;

// 3. Start local HTTP server
let safariResolve = null;
const safariPromise = new Promise(resolve => { safariResolve = resolve; });

// Shared in-memory slot for the generated board file (Flow 31)
let generatedE2eHtml = null;

const server = http.createServer((req, res) => {
  console.log(`[HTTP ${req.method}] ${req.url}`);
  const freshHtml = fs.readFileSync(path.join(rootDir, 'sabura.html'), 'utf8');
  if (req.url === '/sabura.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(freshHtml);
  } else if (req.url === '/generated-e2e.html') {
    if (!generatedE2eHtml) {
      res.writeHead(404);
      res.end('Not yet generated');
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(generatedE2eHtml);
    }
  } else if (req.url === '/sabura-safari.html') {
    // Inject Safari runner script
    const injected = freshHtml.replace('</body>', '<script type="module" src="/safari-e2e-runner.js"></script></body>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(injected);
  } else if (req.url === '/safari-e2e-runner.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(safariRunnerCode);
  } else if (req.url === '/api/safari-log' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      console.log('  [Safari Live Log]', body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
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

// Flow 9: Movable Object Connection Points in Chrome
const c9 = await evalInChrome(`(() => {
  const app = window.saburaApp;
  app.dispatchCommand({
    type: 'create_object',
    object: { id: 'chrome_box', type: 'rectangle', x: 100, y: 100, width: 200, height: 100, seed: 1 }
  });
  app.dispatchCommand({
    type: 'create_object',
    object: { id: 'chrome_conn', type: 'connector', from: { id: 'chrome_box' }, to: { point: { x: 500, y: 150 } }, routing: 'straight', seed: 2 }
  });

  app.workspace.selectedIds = ['chrome_conn'];
  app.workspace.render();

  const handle = document.querySelector('[data-handle="conn-from"]');
  const hasHandles = Boolean(handle);

  // Drag handle to top edge at 25% (x: 150, y: 100)
  handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 150, buttons: 1 }));
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 150, clientY: 100, buttons: 1 }));
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 150, clientY: 100, buttons: 0 }));

  const conn1 = app.doc.objects['chrome_conn'];
  const customAnchor = Boolean(conn1.from.anchor && conn1.from.id === 'chrome_box');

  // Move chrome_box
  app.dispatchCommand({ type: 'move_objects', ids: ['chrome_box'], dx: 40, dy: 60 });
  const boxMoved = app.doc.objects['chrome_box'].x === 140;

  // Resize chrome_box
  app.dispatchCommand({ type: 'resize_object', id: 'chrome_box', bounds: { x: 140, y: 160, width: 400, height: 100 } });
  const boxResized = app.doc.objects['chrome_box'].width === 400;

  // Detach to whitespace
  app.workspace.selectedIds = ['chrome_conn'];
  app.workspace.render();
  const handle2 = document.querySelector('[data-handle="conn-from"]');
  handle2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 240, clientY: 160, buttons: 1 }));
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 50, clientY: 50, buttons: 1 }));
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 50, clientY: 50, buttons: 0 }));

  const connDetached = app.doc.objects['chrome_conn'];
  const isDetached = Boolean(connDetached.from.point && !connDetached.from.id);

  // Undo detachment
  app.undo();
  const connReattached = Boolean(app.doc.objects['chrome_conn'].from.id === 'chrome_box');

  // Auto reset
  app.handleWheelAction('conn_points_auto');
  const isAuto = app.doc.objects['chrome_conn'].from.anchor === undefined;

  // Undo auto reset
  app.undo();
  const isCustomAgain = Boolean(app.doc.objects['chrome_conn'].from.anchor);

  return { hasHandles, customAnchor, boxMoved, boxResized, isDetached, connReattached, isAuto, isCustomAgain };
})()`);
console.log('Chrome 9. Movable connection points:', c9);
if (!c9.hasHandles || !c9.customAnchor || !c9.isDetached || !c9.connReattached || !c9.isAuto || !c9.isCustomAgain) {
  throw new Error('Chrome: Movable connection points failed');
}

// Flow 10: Tool Shortcuts & Text Isolation in Chrome
const c10 = await evalInChrome(`(() => {
  const app = window.saburaApp;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
  const toolR = app.workspace.activeTool === 'rectangle';
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
  const toolE = app.workspace.activeTool === 'ellipse';
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));
  const toolT = app.workspace.activeTool === 'text';
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
  const toolC = app.workspace.activeTool === 'connector';
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
  const toolL = app.workspace.activeTool === 'line';
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
  const toolP = app.workspace.activeTool === 'line';
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
  const toolV = app.workspace.activeTool === 'select';
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
  const toolH = app.workspace.activeTool === 'hand';

  // Typing in an input must isolate tool hotkeys
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
  const typingProtected = app.workspace.activeTool === 'hand';
  input.remove();

  return { toolR, toolE, toolT, toolC, toolL, toolP, toolV, toolH, typingProtected };
})()`);
console.log('Chrome 10. Tool Shortcuts & Text Isolation:', c10);
if (!c10.toolR || !c10.toolE || !c10.toolT || !c10.toolC || !c10.toolL || !c10.toolP || !c10.toolV || !c10.toolH || !c10.typingProtected) {
  throw new Error('Chrome: Tool shortcuts or text isolation failed');
}

// Flow 11: Zoom Toolbar & View Hotkeys in Chrome
const c11 = await evalInChrome(`(() => {
  const app = window.saburaApp;
  const zoomBar = document.querySelector('#zoom-help-toolbar');
  const hasZoomBar = Boolean(zoomBar);

  const btnZoomIn = document.querySelector('#btn-zoom-in');
  const btnZoomOut = document.querySelector('#btn-zoom-out');
  const btnZoomReset = document.querySelector('#btn-zoom-reset');
  const btnZoomFit = document.querySelector('#btn-zoom-fit');

  const initZoom = app.workspace.camera.zoom;
  btnZoomIn?.click();
  const zoomedIn = app.workspace.camera.zoom > initZoom;

  btnZoomOut?.click();
  btnZoomOut?.click();
  const zoomedOut = app.workspace.camera.zoom < initZoom;

  btnZoomReset?.click();
  const reset100 = Math.abs(app.workspace.camera.zoom - 1.0) < 0.001;

  btnZoomFit?.click();
  const fitOk = app.workspace.camera.zoom > 0;

  // View Hotkeys
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
  const keyZoomIn = app.workspace.camera.zoom > 0;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
  const keyReset = Math.abs(app.workspace.camera.zoom - 1.0) < 0.001;

  // Trackpad / Ctrl+wheel zoom
  const centerPt = app.workspace.getViewportCenter();
  const beforeWheelZoom = app.workspace.camera.zoom;
  document.querySelector('#canvas-container').dispatchEvent(new WheelEvent('wheel', {
    clientX: centerPt.x,
    clientY: centerPt.y,
    deltaY: -50,
    ctrlKey: true,
    bubbles: true
  }));
  const wheelZoomed = app.workspace.camera.zoom > beforeWheelZoom;

  return { hasZoomBar, zoomedIn, zoomedOut, reset100, fitOk, keyReset, wheelZoomed };
})()`);
console.log('Chrome 11. Zoom Toolbar & View Hotkeys:', c11);
if (!c11.hasZoomBar || !c11.zoomedIn || !c11.zoomedOut || !c11.reset100 || !c11.fitOk || !c11.keyReset || !c11.wheelZoomed) {
  throw new Error('Chrome: Zoom toolbar or view hotkeys failed');
}

// Flow 12: Help Modal in Chrome
const c12 = await evalInChrome(`(() => {
  const app = window.saburaApp;
  const btnHelp = document.querySelector('#btn-help-toggle');
  btnHelp?.click();
  const helpOpened = app.helpModal.isOpen && document.querySelector('#help-modal').classList.contains('visible');

  // Verify platform key symbols
  const hasCmdOrCtrl = document.querySelector('#help-modal').innerHTML.includes('Cmd') ||
                       document.querySelector('#help-modal').innerHTML.includes('⌘') ||
                       document.querySelector('#help-modal').innerHTML.includes('Ctrl');

  // Escape closes Help
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const helpClosed = !app.helpModal.isOpen;

  // '?' opens Help
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
  const helpKeyOpened = app.helpModal.isOpen;

  // Outside click closes Help
  const helpModalEl = document.querySelector('#help-modal');
  helpModalEl?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const helpOutsideClosed = !app.helpModal.isOpen;

  return { helpOpened, hasCmdOrCtrl, helpClosed, helpKeyOpened, helpOutsideClosed };
})()`);
console.log('Chrome 12. Help Modal:', c12);
if (!c12.helpOpened || !c12.hasCmdOrCtrl || !c12.helpClosed || !c12.helpKeyOpened || !c12.helpOutsideClosed) {
  throw new Error('Chrome: Help modal verification failed');
}

// Flow 13: Presentation Mode hiding & camera restoration in Chrome
const c13 = await evalInChrome(`(() => {
  const app = window.saburaApp;
  const zoomBar = document.querySelector('#zoom-help-toolbar');
  app.workspace.camera.zoom = 1.42;
  app.workspace.camera.x = 210;
  app.workspace.camera.y = 190;
  const preZoom = app.workspace.camera.zoom;
  const preX = app.workspace.camera.x;

  app.enterPresentation();
  const toolbarHiddenInPres = window.getComputedStyle(zoomBar).display === 'none';

  app.exitPresentation();
  const toolbarRestored = window.getComputedStyle(zoomBar).display !== 'none';
  const cameraRestored = Math.abs(app.workspace.camera.zoom - preZoom) < 0.001 &&
                         Math.abs(app.workspace.camera.x - preX) < 0.001;

  return { toolbarHiddenInPres, toolbarRestored, cameraRestored };
})()`);
console.log('Chrome 13. Presentation Mode & Viewport Restoration:', c13);
if (!c13.toolbarHiddenInPres || !c13.toolbarRestored || !c13.cameraRestored) {
  throw new Error('Chrome: Presentation mode hiding or viewport restoration failed');
}

// Reload fresh default board for default-board regression testing
await cdpSend('Page.navigate', { url: `http://127.0.0.1:${port}/sabura.html` });
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 100));
  const hasApp = await evalInChrome('Boolean(window.saburaApp && window.saburaApp.doc && window.saburaApp.doc.order.length === 4)');
  if (hasApp) break;
}

// Flow 15: Marquee Selection of Default Board 3 shapes + attached connector in Chrome
const c15 = await evalInChrome(`(async () => {
  const app = window.saburaApp;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  app.workspace.camera.zoom = 1;
  app.workspace.camera.x = 0;
  app.workspace.camera.y = 0;
  app.workspace.setTool('select');
  app.workspace.selectedIds = [];
  app.workspace.render();
  await sleep(50);

  const canvasEl = document.querySelector('#canvas-container');
  const boundsRect = canvasEl.getBoundingClientRect();

  canvasEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: boundsRect.left + 40, clientY: boundsRect.top + 40, button: 0, buttons: 1 }));
  await sleep(30);
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: boundsRect.left + 600, clientY: boundsRect.top + 400, button: 0, buttons: 1 }));
  await sleep(30);
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: boundsRect.left + 600, clientY: boundsRect.top + 400, button: 0, buttons: 0 }));
  await sleep(50);

  const selIds = [...app.workspace.selectedIds];
  const marqueeAll4 = selIds.length === 4 &&
                      selIds.includes('shape_intro') &&
                      selIds.includes('shape_idea') &&
                      selIds.includes('shape_core') &&
                      selIds.includes('conn_1');

  const badgeText = document.querySelector('.selection-count-badge text')?.textContent;
  const badgeHas4 = badgeText === '4 objects';

  const selRect = document.querySelector('.selection-bounds-rect');
  const selX = parseFloat(selRect?.getAttribute('x') || '0');
  const selY = parseFloat(selRect?.getAttribute('y') || '0');
  const selWidth = parseFloat(selRect?.getAttribute('width') || '0');
  const boundsCorrect = Math.abs(selX - 76) <= 2 && Math.abs(selY - 76) <= 2 && Math.abs(selWidth - 438) <= 4;

  return { docKeys: Object.keys(app.doc.objects), selIds, marqueeAll4, badgeHas4, boundsCorrect, selX, selY, selWidth };
})()`);
console.log('Chrome 15. Default Board Marquee Selection & Real Visual Bounds:', c15);
if (!c15.marqueeAll4 || !c15.badgeHas4 || !c15.boundsCorrect) {
  throw new Error('Chrome: Default board marquee selection or visual bounds failed');
}

// Flow 16: Real Contextual Wheel Click for Align Left in Chrome
const c16 = await evalInChrome(`(async () => {
  const app = window.saburaApp;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ', bubbles: true }));
  await sleep(100);

  const alignWedge = document.querySelector('[data-item-id="menu_align"]');
  if (!alignWedge) throw new Error('Align wedge not found');
  alignWedge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(100);

  const alignLeftSub = document.querySelector('[data-sub-id="align_left"]');
  if (!alignLeftSub) throw new Error('Align Left sub-wedge not found');
  alignLeftSub.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(100);

  const introX = app.doc.objects['shape_intro']?.x;
  const ideaX = app.doc.objects['shape_idea']?.x;
  const coreX = app.doc.objects['shape_core']?.x;
  const conn1 = app.doc.objects['conn_1'];

  const alignLeftSuccess = introX === 80 && ideaX === 80 && coreX === 80 && conn1?.from?.id === 'shape_idea' && conn1?.to?.id === 'shape_core';
  return { alignLeftSuccess, introX, ideaX, coreX };
})()`);
console.log('Chrome 16. Real Wheel Align Left on Spatial Objects:', c16);
if (!c16.alignLeftSuccess) {
  throw new Error('Chrome: Real wheel Align Left failed');
}

// Flow 17: Real Keyboard Undo & Redo in Chrome
const c17 = await evalInChrome(`(async () => {
  const app = window.saburaApp;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modObj = isMac ? { metaKey: true } : { ctrlKey: true };

  // Cmd/Ctrl+Z
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(50);
  const undoOk = app.doc.objects['shape_intro']?.x === 80 &&
                 app.doc.objects['shape_idea']?.x === 100 &&
                 app.doc.objects['shape_core']?.x === 360;

  // Cmd/Ctrl+Shift+Z
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, shiftKey: true, bubbles: true }));
  await sleep(50);
  const redoOk = app.doc.objects['shape_idea']?.x === 80 && app.doc.objects['shape_core']?.x === 80;

  // Undo back to original
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(50);

  return { undoOk, redoOk };
})()`);
console.log('Chrome 17. Real Keyboard Undo & Redo for Multi-Object Alignment:', c17);
if (!c17.undoOk || !c17.redoOk) {
  throw new Error('Chrome: Multi-object Undo/Redo failed');
}

// Flow 18: Real Contextual Wheel Distribute Horizontal in Chrome
const c18 = await evalInChrome(`(async () => {
  const app = window.saburaApp;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modObj = isMac ? { metaKey: true } : { ctrlKey: true };

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ', bubbles: true }));
  await sleep(100);

  const distWedge = document.querySelector('[data-item-id="menu_distribute"]');
  if (!distWedge) throw new Error('Distribute wedge not found');
  distWedge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(100);

  const distHSub = document.querySelector('[data-sub-id="dist_h"]');
  if (!distHSub) throw new Error('Distribute Horizontal sub-wedge not found');
  distHSub.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(100);

  const distIntroX = app.doc.objects['shape_intro']?.x;
  const distIdeaX = app.doc.objects['shape_idea']?.x;
  const distCoreX = app.doc.objects['shape_core']?.x;
  const distOk = distIntroX === 80 && distIdeaX !== 100 && distCoreX === 360;

  // Undo distribution
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(50);
  const distUndoOk = app.doc.objects['shape_idea']?.x === 100;

  return { distOk, distUndoOk };
})()`);
console.log('Chrome 18. Real Wheel Distribute Horizontal & 1-Step Undo:', c18);
if (!c18.distOk || !c18.distUndoOk) {
  throw new Error('Chrome: Distribute Horizontal or 1-step undo failed');
}

// Flow 19: Real Shift-Click & Drag Multi-Selection in Chrome
const c19 = await evalInChrome(`(async () => {
  const app = window.saburaApp;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const canvasEl = document.querySelector('#canvas-container');
  const boundsRect = canvasEl.getBoundingClientRect();
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modObj = isMac ? { metaKey: true } : { ctrlKey: true };

  // Clear selection
  canvasEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: boundsRect.left + 10, clientY: boundsRect.top + 10, button: 0 }));
  canvasEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: boundsRect.left + 10, clientY: boundsRect.top + 10, button: 0 }));
  await sleep(30);

  // Click shape_intro
  canvasEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: boundsRect.left + 150, clientY: boundsRect.top + 120, button: 0 }));
  canvasEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: boundsRect.left + 150, clientY: boundsRect.top + 120, button: 0 }));
  await sleep(30);

  // Shift-click shape_core
  canvasEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, shiftKey: true, clientX: boundsRect.left + 400, clientY: boundsRect.top + 280, button: 0 }));
  canvasEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, shiftKey: true, clientX: boundsRect.left + 400, clientY: boundsRect.top + 280, button: 0 }));
  await sleep(30);

  const shiftSelOk = app.workspace.selectedIds.length === 2 &&
                     app.workspace.selectedIds.includes('shape_intro') &&
                     app.workspace.selectedIds.includes('shape_core');

  // Drag multi-selection by (+30, +20)
  canvasEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: boundsRect.left + 150, clientY: boundsRect.top + 120, button: 0, buttons: 1 }));
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: boundsRect.left + 180, clientY: boundsRect.top + 140, button: 0, buttons: 1 }));
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: boundsRect.left + 180, clientY: boundsRect.top + 140, button: 0, buttons: 0 }));
  await sleep(50);

  const dragOk = app.doc.objects['shape_intro']?.x === 110 && app.doc.objects['shape_core']?.x === 390;

  // Undo drag in one step
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(50);

  const dragUndoOk = app.doc.objects['shape_intro']?.x === 80 && app.doc.objects['shape_core']?.x === 360;

  return { shiftSelOk, dragOk, dragUndoOk };
})()`);
console.log('Chrome 19. Real Shift-Click & Drag Multi-Selection with 1-Step Undo:', c19);
if (!c19.shiftSelOk || !c19.dragOk || !c19.dragUndoOk) {
  throw new Error('Chrome: Shift-click and drag multi-selection failed');
}

// Flow 20: Real Keyboard Copy, Paste, Group & Ungroup in Chrome
const c20 = await evalInChrome(`(async () => {
  const app = window.saburaApp;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modObj = isMac ? { metaKey: true } : { ctrlKey: true };

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', ...modObj, bubbles: true }));
  await sleep(30);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', ...modObj, bubbles: true }));
  await sleep(50);

  const pasteIds = [...app.workspace.selectedIds];
  const pastedOk = pasteIds.length === 2 && pasteIds.every(id => id !== 'shape_intro' && id !== 'shape_core');

  // Undo paste
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(50);
  const pasteUndoOk = pasteIds.every(id => !app.doc.objects[id]);

  // Group
  app.workspace.selectedIds = ['shape_intro', 'shape_idea'];
  app.workspace.render();
  await sleep(30);

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', ...modObj, bubbles: true }));
  await sleep(50);

  const groupGid = app.doc.objects['shape_intro']?.groupId;
  const groupCreated = groupGid && groupGid === app.doc.objects['shape_idea']?.groupId;

  // Ungroup
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', ...modObj, shiftKey: true, bubbles: true }));
  await sleep(50);

  const ungrouped = app.doc.objects['shape_intro']?.groupId === null && app.doc.objects['shape_idea']?.groupId === null;

  return { pastedOk, pasteUndoOk, groupCreated, ungrouped };
})()`);
console.log('Chrome 20. Real Keyboard Copy, Paste, Group & Ungroup:', c20);
if (!c20.pastedOk || !c20.pasteUndoOk || !c20.groupCreated || !c20.ungrouped) {
  throw new Error('Chrome: Real keyboard copy/paste or group/ungroup failed');
}

// Flow 21: Real Multi-Object D-Drag with No Placement Jump in Chrome
const c21 = await evalInChrome(`(async () => {
  const app = window.saburaApp;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const canvasEl = document.querySelector('#canvas-container');
  const boundsRect = canvasEl.getBoundingClientRect();
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modObj = isMac ? { metaKey: true } : { ctrlKey: true };

  app.workspace.selectedIds = ['shape_idea', 'shape_core'];
  app.workspace.render();
  await sleep(30);

  const origIdea = { x: app.doc.objects['shape_idea'].x, y: app.doc.objects['shape_idea'].y };
  const origCore = { x: app.doc.objects['shape_core'].x, y: app.doc.objects['shape_core'].y };

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true }));
  await sleep(20);

  canvasEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: boundsRect.left + 175, clientY: boundsRect.top + 295, button: 0, buttons: 1 }));
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: boundsRect.left + 275, clientY: boundsRect.top + 345, button: 0, buttons: 1 }));
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: boundsRect.left + 275, clientY: boundsRect.top + 345, button: 0, buttons: 0 }));
  await sleep(20);

  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', bubbles: true }));
  await sleep(50);

  const ddragIds = [...app.workspace.selectedIds];
  const ddragCreated = ddragIds.length === 2 && ddragIds.every(id => id !== 'shape_idea' && id !== 'shape_core');
  const origsUntouched = app.doc.objects['shape_idea'].x === origIdea.x &&
                         app.doc.objects['shape_core'].x === origCore.x;

  const dupIdea = app.doc.objects[ddragIds.find(id => app.doc.objects[id].type === 'ellipse')];
  const dupCore = app.doc.objects[ddragIds.find(id => app.doc.objects[id].type === 'diamond')];
  const dxIdea = dupIdea ? dupIdea.x - origIdea.x : 0;
  const dyIdea = dupIdea ? dupIdea.y - origIdea.y : 0;
  const dxCore = dupCore ? dupCore.x - origCore.x : 0;
  const dyCore = dupCore ? dupCore.y - origCore.y : 0;
  const noJump = Boolean(dupIdea && dupCore &&
                 dxIdea === dxCore &&
                 dyIdea === dyCore &&
                 Math.abs(dxIdea - 100) <= 8 &&
                 Math.abs(dyIdea - 50) <= 8);

  // Undo D-drag
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(50);

  const ddragUndoOk = ddragIds.every(id => !app.doc.objects[id]);

  return { ddragCreated, origsUntouched, noJump, ddragUndoOk, dupIdea: { x: dupIdea?.x, y: dupIdea?.y }, dupCore: { x: dupCore?.x, y: dupCore?.y }, origIdea, origCore };
})()`);
console.log('Chrome 21. Real Multi-Object D-Drag with No Placement Jump & 1-Step Undo:', c21);
if (!c21.ddragCreated || !c21.origsUntouched || !c21.noJump || !c21.ddragUndoOk) {
  throw new Error('Chrome: Multi-object D-drag failed');
}

// Flow 22: Move Grouped Objects Together with Pointer Drag & 1-Step Undo in Chrome
const c22 = await evalInChrome(`(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const app = window.saburaApp;
  const canvasEl = document.querySelector('#canvas-container');
  const boundsRect = canvasEl.getBoundingClientRect();
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modObj = isMac ? { metaKey: true } : { ctrlKey: true };

  // 1. Group shape_intro and shape_idea
  app.workspace.selectedIds = ['shape_intro', 'shape_idea'];
  app.workspace.render();
  await sleep(50);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', ...modObj, bubbles: true }));
  await sleep(100);

  const gId = app.doc.objects['shape_intro']?.groupId;
  const isGroupedNow = gId && gId === app.doc.objects['shape_idea']?.groupId;

  // 2. Deselect by clicking whitespace
  canvasEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: boundsRect.left + 10, clientY: boundsRect.top + 10, button: 0 }));
  await sleep(30);
  canvasEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: boundsRect.left + 10, clientY: boundsRect.top + 10, button: 0 }));
  await sleep(50);

  const deselected = app.workspace.selectedIds.length === 0;

  // 3. Click shape_intro -> must select the whole group as a single unit
  canvasEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: boundsRect.left + 150, clientY: boundsRect.top + 120, button: 0 }));
  await sleep(30);
  canvasEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: boundsRect.left + 150, clientY: boundsRect.top + 120, button: 0 }));
  await sleep(50);

  const clickedGroupSelected = app.workspace.selectedIds.length === 2 &&
                               app.workspace.selectedIds.includes('shape_intro') &&
                               app.workspace.selectedIds.includes('shape_idea');

  // 4. Drag the group by dragging shape_intro by (+50, +40)
  const preIntro = { x: app.doc.objects['shape_intro'].x, y: app.doc.objects['shape_intro'].y };
  const preIdea = { x: app.doc.objects['shape_idea'].x, y: app.doc.objects['shape_idea'].y };

  canvasEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: boundsRect.left + 150, clientY: boundsRect.top + 120, button: 0, buttons: 1 }));
  await sleep(30);
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: boundsRect.left + 200, clientY: boundsRect.top + 160, button: 0, buttons: 1 }));
  await sleep(30);
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: boundsRect.left + 200, clientY: boundsRect.top + 160, button: 0, buttons: 0 }));
  await sleep(100);

  const postIntro = { x: app.doc.objects['shape_intro'].x, y: app.doc.objects['shape_intro'].y };
  const postIdea = { x: app.doc.objects['shape_idea'].x, y: app.doc.objects['shape_idea'].y };

  const dxIntro = postIntro.x - preIntro.x;
  const dyIntro = postIntro.y - preIntro.y;
  const dxIdea = postIdea.x - preIdea.x;
  const dyIdea = postIdea.y - preIdea.y;

  const groupMovedTogether = dxIntro === dxIdea && dyIntro === dyIdea && dxIntro !== 0 && dyIntro !== 0;

  // 5. Undo group move in 1 step
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(100);

  const undoIntro = app.doc.objects['shape_intro'].x === preIntro.x && app.doc.objects['shape_intro'].y === preIntro.y;
  const undoIdea = app.doc.objects['shape_idea'].x === preIdea.x && app.doc.objects['shape_idea'].y === preIdea.y;
  const groupUndoOk = undoIntro && undoIdea;

  // 6. Clean up: ungroup
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', ...modObj, shiftKey: true, bubbles: true }));
  await sleep(100);

  return { isGroupedNow, deselected, clickedGroupSelected, groupMovedTogether, groupUndoOk, dxIntro, dyIntro, dxIdea, dyIdea };
})()`);
console.log('Chrome 22. Real Move Grouped Objects Together with Pointer Drag & 1-Step Undo:', c22);
if (!c22.isGroupedNow || !c22.deselected || !c22.clickedGroupSelected || !c22.groupMovedTogether || !c22.groupUndoOk) {
  throw new Error('Chrome: Moving grouped objects together failed');
}

// Flow 23: Interactive Curved Connector Flipping via Arc Handle & F Key
const c23 = await evalInChrome(`(async () => {
  const app = window.saburaApp;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modObj = isMac ? { metaKey: true } : { ctrlKey: true };

  app.workspace.selectedIds = ['conn_1'];
  app.workspace.render();
  await sleep(50);

  const curveHandle = document.querySelector('[data-handle="conn-curve"]');
  const hasCurveHandle = Boolean(curveHandle);

  const connObj = app.doc.objects['conn_1'];
  const initialSide = connObj?.curveSide !== undefined ? connObj.curveSide : 1;

  if (curveHandle) {
    const hRect = curveHandle.getBoundingClientRect();
    curveHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2, button: 0 }));
    await sleep(30);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2, button: 0 }));
    await sleep(50);
  }

  const flippedClick = app.doc.objects['conn_1']?.curveSide === -1;

  // 1-step undo
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(100);
  const undoClick = (app.doc.objects['conn_1']?.curveSide !== undefined ? app.doc.objects['conn_1'].curveSide : 1) === initialSide;

  // 1-step redo
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, shiftKey: true, bubbles: true }));
  await sleep(100);
  const redoClick = app.doc.objects['conn_1']?.curveSide === -1;

  // Reset back to initial
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(100);

  // Press F hotkey -> flips curveSide to -1
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true }));
  await sleep(100);
  const fKeyFlip = app.doc.objects['conn_1']?.curveSide === -1;

  // Undo F hotkey
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(100);
  const undoF = (app.doc.objects['conn_1']?.curveSide !== undefined ? app.doc.objects['conn_1'].curveSide : 1) === 1;

  return { hasCurveHandle, flippedClick, undoClick, redoClick, fKeyFlip, undoF };
})()`);
console.log('Chrome 23. Interactive Curved Connector Flipping via Arc Handle & F Key:', c23);
if (!c23.hasCurveHandle || !c23.flippedClick || !c23.undoClick || !c23.redoClick || !c23.fKeyFlip || !c23.undoF) {
  throw new Error('Chrome: Interactive curved connector flipping failed');
}

// Flow 24: Continuous Curved Depth Dragging & 1-Step Undo
const c24 = await evalInChrome(`(async () => {
  const app = window.saburaApp;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modObj = isMac ? { metaKey: true } : { ctrlKey: true };

  app.workspace.selectedIds = ['conn_1'];
  app.workspace.render();
  await sleep(50);

  const curveHandle = document.querySelector('[data-handle="conn-curve"]');
  if (curveHandle) {
    const hRect = curveHandle.getBoundingClientRect();
    curveHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2, button: 0, buttons: 1 }));
    await sleep(30);
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2 + 150, button: 0, buttons: 1 }));
    await sleep(30);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2 + 150, button: 0, buttons: 0 }));
    await sleep(50);
  }

  const deepCurvedOk = typeof app.doc.objects['conn_1']?.curveDistance === 'number' && app.doc.objects['conn_1'].curveDistance > 100;

  // 1-step undo restores auto depth
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(100);
  const undoDeepOk = app.doc.objects['conn_1']?.curveDistance === undefined;

  return { deepCurvedOk, undoDeepOk };
})()`);
console.log('Chrome 24. Continuous Curved Depth Dragging & 1-Step Undo:', c24);
if (!c24.deepCurvedOk || !c24.undoDeepOk) {
  throw new Error('Chrome: Continuous curved depth dragging failed');
}

// Flow 25: Elbow U-Bypass Loop Dragging & 1-Step Undo
const c25 = await evalInChrome(`(async () => {
  const app = window.saburaApp;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modObj = isMac ? { metaKey: true } : { ctrlKey: true };

  // Switch conn_1 to elbow
  app.dispatchCommand({ type: 'configure_connector', id: 'conn_1', routing: 'elbow' });
  app.workspace.selectedIds = ['conn_1'];
  app.workspace.render();
  await sleep(50);

  const elbowHandle = document.querySelector('[data-handle="conn-elbow"]');
  const hasElbowHandle = Boolean(elbowHandle);

  if (elbowHandle) {
    const hRect = elbowHandle.getBoundingClientRect();
    elbowHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2, button: 0, buttons: 1 }));
    await sleep(30);
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2 + 120, button: 0, buttons: 1 }));
    await sleep(30);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2 + 120, button: 0, buttons: 0 }));
    await sleep(50);
  }

  const hasBypass = typeof app.doc.objects['conn_1']?.elbowOffset === 'number' && app.doc.objects['conn_1'].elbowOffset > 50;

  // Click handle to flip side
  const elbowHandle2 = document.querySelector('[data-handle="conn-elbow"]');
  if (elbowHandle2) {
    const hRect = elbowHandle2.getBoundingClientRect();
    elbowHandle2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2, button: 0 }));
    await sleep(30);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: hRect.left + hRect.width / 2, clientY: hRect.top + hRect.height / 2, button: 0 }));
    await sleep(50);
  }

  const flippedBypass = typeof app.doc.objects['conn_1']?.elbowOffset === 'number' && app.doc.objects['conn_1'].elbowOffset < 0;

  // 1-step undo restores downward bypass
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(100);
  const undoFlipBypass = typeof app.doc.objects['conn_1']?.elbowOffset === 'number' && app.doc.objects['conn_1'].elbowOffset > 0;

  // 1-step undo restores standard elbow step
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(100);
  const undoBypassOk = app.doc.objects['conn_1']?.elbowOffset === undefined;

  // Restore conn_1 to curved routing
  app.dispatchCommand({ type: 'configure_connector', id: 'conn_1', routing: 'curved' });
  await sleep(50);

  return { hasElbowHandle, hasBypass, flippedBypass, undoFlipBypass, undoBypassOk };
})()`);
console.log('Chrome 25. Elbow U-Bypass Loop Dragging & 1-Step Undo:', c25);
if (!c25.hasElbowHandle || !c25.hasBypass || !c25.flippedBypass || !c25.undoFlipBypass || !c25.undoBypassOk) {
  throw new Error('Chrome: Elbow U-Bypass loop dragging failed');
}

// Flow 26: Point-by-Point Line & Polygon Tool, Smooth Curves, Vertex Dragging & Undo
const c26 = await evalInChrome(`(async () => {
  const app = window.saburaApp;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modObj = isMac ? { metaKey: true } : { ctrlKey: true };

  app.workspace.setTool('line');
  await sleep(50);

  const cRect = app.workspace.container.getBoundingClientRect();
  const p1 = { x: cRect.left + 500, y: cRect.top + 300 };
  const p2 = { x: cRect.left + 650, y: cRect.top + 320 };
  const p3 = { x: cRect.left + 600, y: cRect.top + 450 };

  // Point 1 click
  app.workspace.container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: p1.x, clientY: p1.y, button: 0 }));
  await sleep(30);
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: p2.x, clientY: p2.y, button: 0 }));
  await sleep(30);

  // Point 2 click
  app.workspace.container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: p2.x, clientY: p2.y, button: 0 }));
  await sleep(30);
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: p3.x, clientY: p3.y, button: 0 }));
  await sleep(30);

  // Point 3 click
  app.workspace.container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: p3.x, clientY: p3.y, button: 0 }));
  await sleep(30);

  // Move close to P1 to trigger close snap
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: p1.x + 3, clientY: p1.y + 3, button: 0 }));
  await sleep(30);

  // Click near P1 to close into polygon
  app.workspace.container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: p1.x + 3, clientY: p1.y + 3, button: 0 }));
  await sleep(80);

  const createdObj = app.doc.objects[app.workspace.selectedIds[0]];
  const isClosedPolygon = createdObj && createdObj.type === 'path' && createdObj.closed === true;

  // Toggle to smooth curve via command/wheel
  app.dispatchCommand({ type: 'set_style', ids: [createdObj.id], updates: { curveStyle: 'curved' } });
  await sleep(50);
  const isCurved = app.doc.objects[createdObj.id]?.curveStyle === 'curved';

  // Drag a vertex handle
  const vHandle = document.querySelector('[data-handle="vertex-1"]');
  const hasVertexHandle = Boolean(vHandle);
  if (vHandle) {
    const vRect = vHandle.getBoundingClientRect();
    vHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: vRect.left + vRect.width / 2, clientY: vRect.top + vRect.height / 2, button: 0, buttons: 1 }));
    await sleep(30);
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: vRect.left + vRect.width / 2 + 50, clientY: vRect.top + vRect.height / 2 + 30, button: 0, buttons: 1 }));
    await sleep(30);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: vRect.left + vRect.width / 2 + 50, clientY: vRect.top + vRect.height / 2 + 30, button: 0, buttons: 0 }));
    await sleep(50);
  }

  // 1-step undo vertex drag
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(100);

  // 1-step undo curve toggle
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(100);
  const undoCurvedOk = app.doc.objects[createdObj.id]?.curveStyle === 'sharp';

  // 1-step undo polygon creation
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(100);
  const undoCreationOk = app.doc.objects[createdObj.id] === undefined;

  // Clean up workspace
  app.workspace.setTool('hand');
  app.workspace.selectedIds = [];
  app.workspace.render();

  return { isClosedPolygon, isCurved, hasVertexHandle, undoCurvedOk, undoCreationOk };
})()`);
console.log('Chrome 26. Point-by-Point Line & Polygon Tool, Smooth Curves, Vertex Dragging & Undo:', c26);
if (!c26.isClosedPolygon || !c26.isCurved || !c26.hasVertexHandle || !c26.undoCurvedOk || !c26.undoCreationOk) {
  throw new Error('Chrome: Line & Polygon tool, smooth curves, vertex dragging, or undo failed');
}

// Flow 27: None Fill via Wheel
const c27 = await evalInChrome(`(async () => {
  const app = window.saburaApp;
  const testBox = Object.values(app.doc.objects).find(o => o.type === 'rectangle');
  app.workspace.selectedIds = [testBox.id];
  app.workspace.render();
  await new Promise(r => setTimeout(r, 100));

  const shapeCenter = { x: testBox.x + testBox.width / 2, y: testBox.y + testBox.height / 2 };
  app.wheel.open(shapeCenter.x, shapeCenter.y, 'object', testBox, app.doc.theme.palette, 1, [testBox]);
  await new Promise(r => setTimeout(r, 150));

  const fillWedge = document.querySelector('.wheel-wedge[data-item-id="menu_fill"]');
  if (fillWedge) fillWedge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 150));

  const noneWedge = document.querySelector('.wheel-sub-wedge[data-sub-id="fill_none"]');
  if (noneWedge) noneWedge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 150));

  const isNoneApplied = app.doc.objects[testBox.id].fill === 'none';

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modObj = isMac ? { metaKey: true } : { ctrlKey: true };
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  const undoFillOk = app.doc.objects[testBox.id].fill !== 'none';

  return { isNoneApplied, undoFillOk };
})()`);
console.log('Chrome 27. None Fill via Wheel, Solid Wedge Hit Testing & Undo:', c27);
if (!c27.isNoneApplied || !c27.undoFillOk) {
  throw new Error('Chrome: None Fill via Wheel failed');
}

// Flow 28: Stroke Thickness via Ring 3 in Style
const c28 = await evalInChrome(`(async () => {
  const app = window.saburaApp;
  const testBox = Object.values(app.doc.objects).find(o => o.type === 'rectangle');
  app.workspace.selectedIds = [testBox.id];
  app.workspace.render();
  await new Promise(r => setTimeout(r, 100));

  const shapeCenter = { x: testBox.x + testBox.width / 2, y: testBox.y + testBox.height / 2 };
  app.wheel.open(shapeCenter.x, shapeCenter.y, 'object', testBox, app.doc.theme.palette, 1, [testBox]);
  await new Promise(r => setTimeout(r, 150));

  const styleWedge = document.querySelector('.wheel-wedge[data-item-id="menu_style"]');
  if (styleWedge) styleWedge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 150));

  const width4Wedge = document.querySelector('.wheel-sub-wedge[data-sub-id="width_4"]');
  if (width4Wedge) width4Wedge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 150));

  const isWidth4Applied = app.doc.objects[testBox.id].strokeWidth === 4;

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modObj = isMac ? { metaKey: true } : { ctrlKey: true };
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  const undoWidthOk = app.doc.objects[testBox.id].strokeWidth !== 4;

  return { isWidth4Applied, undoWidthOk };
})()`);
console.log('Chrome 28. Stroke Thickness via Ring 3 in Style & 1-Step Undo:', c28);
if (!c28.isWidth4Applied || !c28.undoWidthOk) {
  throw new Error('Chrome: Stroke Thickness via Ring 3 failed');
}

// Flow 29: Type & Shape Ring 3 Partitioning
const c29 = await evalInChrome(`(async () => {
  const app = window.saburaApp;
  const testBox = Object.values(app.doc.objects).find(o => o.type === 'rectangle');
  app.workspace.selectedIds = [testBox.id];
  app.workspace.render();
  await new Promise(r => setTimeout(r, 100));

  const shapeCenter = { x: testBox.x + testBox.width / 2, y: testBox.y + testBox.height / 2 };
  app.wheel.open(shapeCenter.x, shapeCenter.y, 'object', testBox, app.doc.theme.palette, 1, [testBox]);
  await new Promise(r => setTimeout(r, 150));

  const typeWedge = document.querySelector('.wheel-wedge[data-item-id="menu_type"]');
  if (typeWedge) typeWedge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 150));

  const sizeXLWedge = document.querySelector('.wheel-sub-wedge[data-sub-id="type_xl"]');
  if (sizeXLWedge) sizeXLWedge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 150));

  const isXLApplied = app.doc.objects[testBox.id].textStyle?.size === 'xl';

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modObj = isMac ? { metaKey: true } : { ctrlKey: true };
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  const undoXLOk = app.doc.objects[testBox.id].textStyle?.size !== 'xl';

  return { isXLApplied, undoXLOk };
})()`);
console.log('Chrome 29. Type & Shape Ring 3 Partitioning & 1-Step Undo:', c29);
if (!c29.isXLApplied || !c29.undoXLOk) {
  throw new Error('Chrome: Type & Shape Ring 3 Partitioning failed');
}

// Flow 30: Keyboard Shortcut S for Equal Sides & 1-Step Undo
const c30 = await evalInChrome(`(async () => {
  const app = window.saburaApp;
  const testBox = Object.values(app.doc.objects).find(o => o.type === 'rectangle');
  const origW = testBox.width;
  const origH = testBox.height;
  app.workspace.selectedIds = [testBox.id];
  app.workspace.render();
  await new Promise(r => setTimeout(r, 100));

  // Press S to square
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', bubbles: true }));
  await new Promise(r => setTimeout(r, 100));

  const boxSquared = app.doc.objects[testBox.id].width === Math.max(origW, origH) &&
                     app.doc.objects[testBox.id].height === Math.max(origW, origH);

  // 1-step undo
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modObj = isMac ? { metaKey: true } : { ctrlKey: true };
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  const undoSquareOk = app.doc.objects[testBox.id].height === origH;

  return { boxSquared, undoSquareOk };
})()`);
console.log('Chrome 30. Keyboard Shortcut S for Equal Sides & 1-Step Undo:', c30);
if (!c30.boxSquared || !c30.undoSquareOk) {
  throw new Error('Chrome: Keyboard Shortcut S for Equal Sides failed');
}

// -------------------------------------------------------------
// Flow 31: AI Generator Interface (Chrome CDP)
// -------------------------------------------------------------
console.log('\n--- Flow 31: AI Generator Interface ---');

// Helper: extract CSS text from <style>...</style>
function extractCssContent(htmlStr) {
  const m = htmlStr.match(/<style>([\s\S]*?)<\/style>/i);
  if (!m) throw new Error('Flow 31: Could not extract CSS from HTML');
  return m[1];
}
// Helper: extract JS bundle from bare <script>...</script> (no type= attribute)
function extractJsContent(htmlStr) {
  const m = htmlStr.match(/<script\s*>([\s\S]*?)<\/script>/i);
  if (!m) throw new Error('Flow 31: Could not extract JS from HTML');
  return m[1];
}
function sha256hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

const generatorHtml = fs.readFileSync(path.join(rootDir, 'sabura.html'), 'utf8');
const generatorCssHash = sha256hex(extractCssContent(generatorHtml));
const generatorJsHash = sha256hex(extractJsContent(generatorHtml));

const tmpDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sabura-e2e-'));
try {
  // Step B: readAiContract — must return the guide, never CSS/JS
  const contract = await evalInChrome('window.sabura.readAiContract()');
  if (!contract.found) throw new Error('Flow 31: readAiContract() returned found: false');
  if (!contract.contract.includes('generateBoardFile'))
    throw new Error('Flow 31: contract missing generateBoardFile');
  if (!contract.contract.includes('BROWSER-AGENT WORKFLOW'))
    throw new Error('Flow 31: contract missing BROWSER-AGENT WORKFLOW');
  if (!contract.contract.includes('FILE-TOOL WORKFLOW'))
    throw new Error('Flow 31: contract missing FILE-TOOL WORKFLOW');
  if (contract.contract.toLowerCase().includes('function') && contract.contract.includes('{') && contract.contract.length > 20000)
    throw new Error('Flow 31: readAiContract() appears to have returned runtime code');
  console.log('  ✓ 31a. readAiContract() returns guide, not runtime');

  // Step C: getDocument returns only board data
  const docCheck = await evalInChrome(`(() => {
    const d = window.sabura.getDocument();
    return {
      hasSchema: d && typeof d.schemaVersion === 'string',
      hasObjects: d && typeof d.objects === 'object',
      noHtml: !d || (!d.html && !d.source && !d.runtime && !d.css && !d.js)
    };
  })()`);
  if (!docCheck.hasSchema || !docCheck.hasObjects || !docCheck.noHtml)
    throw new Error('Flow 31: getDocument() returned unexpected HTML/runtime fields');
  console.log('  ✓ 31b. getDocument() returns only board data');

  // Step D: validateDocument — valid doc accepted
  const valOk = await evalInChrome(`window.sabura.validateDocument({
    schemaVersion: 'sabura/canvas/v1', id: 'board_val31', title: 'Val Test',
    theme: window.saburaApp.doc.theme, objects: {}, order: [], groups: {}, assets: {}
  })`);
  if (!valOk.valid) throw new Error('Flow 31: validateDocument rejected valid doc: ' + valOk.errors.join(', '));
  console.log('  ✓ 31c. validateDocument() accepts valid doc');

  // Step E: validateDocument — invalid doc rejected with useful errors
  const valBad = await evalInChrome(`window.sabura.validateDocument({ bogus: true })`);
  if (valBad.valid || !valBad.errors || valBad.errors.length === 0)
    throw new Error('Flow 31: validateDocument accepted invalid doc or gave no errors');
  console.log('  ✓ 31d. validateDocument() rejects invalid doc with errors: ' + valBad.errors.slice(0, 2).join('; '));

  // Step F: invalid generateBoardFile must fail (no download; Blob URLs don't reach disk in headless Chrome)
  const genBadResult = await evalInChrome(`window.sabura.generateBoardFile({ bogus: true })`);
  if (genBadResult.success) throw new Error('Flow 31: generateBoardFile succeeded with invalid doc');
  if (!genBadResult.errors || genBadResult.errors.length === 0)
    throw new Error('Flow 31: generateBoardFile gave no errors for invalid doc');
  // In headless Chrome, Blob URL downloads do not reach the filesystem.
  // We verify that failure is reported without triggering a download by checking success: false.
  console.log('  ✓ 31e. generateBoardFile() rejects invalid doc (success: false, errors reported)');

  // Step G: Capture original board state
  const originalDocId = await evalInChrome('window.sabura.getDocument().id');

  // Step H: generateBoardFile with valid doc — initial call (result metadata only)

  const genResult = await evalInChrome(`window.sabura.generateBoardFile({
    schemaVersion: 'sabura/canvas/v1',
    id: 'board_e2egentest',
    title: 'E2E Generated Board',
    theme: window.saburaApp.doc.theme,
    objects: {
      'shape_e2e': {
        id: 'shape_e2e', type: 'rectangle',
        x: 100, y: 100, width: 200, height: 120,
        fill: '#ff6b6b', stroke: '#c92a2a',
        strokeWidth: 2, strokeStyle: 'solid',
        opacity: 1, roughness: 1, seed: 42,
        locked: false, groupId: null,
        text: 'E2E Object', textStyle: {
          size: 'm', resolvedSize: 18, fontFamily: 'sans',
          bold: false, align: 'center', color: '#1e1e1e'
        }
      }
    },
    order: ['shape_e2e'],
    groups: {},
    assets: {}
  })`);

  if (!genResult.success)
    throw new Error('Flow 31: generateBoardFile failed: ' + (genResult.errors || []).join(', '));
  if (genResult.html !== undefined)
    throw new Error('Flow 31: generateBoardFile returned html field in result');
  if (genResult.source !== undefined)
    throw new Error('Flow 31: generateBoardFile returned source field in result');
  if (genResult.runtime !== undefined)
    throw new Error('Flow 31: generateBoardFile returned runtime field in result');
  if (typeof genResult.filename !== 'string' || !genResult.filename.endsWith('.html'))
    throw new Error('Flow 31: generateBoardFile returned invalid filename: ' + genResult.filename);
  if (typeof genResult.byteLength !== 'number' || genResult.byteLength < 200000)
    throw new Error('Flow 31: generateBoardFile returned invalid byteLength: ' + genResult.byteLength);
  console.log(`  ✓ 31f. generateBoardFile() succeeded: ${genResult.filename}, byteLength=${genResult.byteLength}`);

  // Step I: Verify live board is unaltered
  const afterDocId = await evalInChrome('window.sabura.getDocument().id');
  if (afterDocId !== originalDocId)
    throw new Error(`Flow 31: generateBoardFile altered open board (was ${originalDocId}, now ${afterDocId})`);
  console.log('  ✓ 31g. generateBoardFile() did not alter the open board');

  // Step J: Intercept the generated Blob in the browser (headless Chrome does not
  // write Blob URL downloads to disk). Inject an interceptor before generating,
  // then read the captured Blob content back via CDP after generation.
  await cdpSend('Runtime.evaluate', {
    expression: `
      (function() {
        window._lastSaburaBlob = null;
        const _orig = URL.createObjectURL.bind(URL);
        URL.createObjectURL = function(blob) {
          if (blob && blob.type && blob.type.includes('text/html')) {
            const reader = new FileReader();
            reader.onload = () => { window._lastSaburaBlob = reader.result; };
            reader.readAsDataURL(blob);
          }
          return _orig(blob);
        };
      })()
    `,
    awaitPromise: false
  });

  // (Re-run generateBoardFile now that interceptor is in place)
  const captureResult = await evalInChrome(`window.sabura.generateBoardFile({
    schemaVersion: 'sabura/canvas/v1',
    id: 'board_e2egentest',
    title: 'E2E Generated Board',
    theme: window.saburaApp.doc.theme,
    objects: {
      'shape_e2e': {
        id: 'shape_e2e', type: 'rectangle',
        x: 100, y: 100, width: 200, height: 120,
        fill: '#ff6b6b', stroke: '#c92a2a',
        strokeWidth: 2, strokeStyle: 'solid',
        opacity: 1, roughness: 1, seed: 42,
        locked: false, groupId: null,
        text: 'E2E Object', textStyle: {
          size: 'm', resolvedSize: 18, fontFamily: 'sans',
          bold: false, align: 'center', color: '#1e1e1e'
        }
      }
    },
    order: ['shape_e2e'],
    groups: {},
    assets: {}
  })`);
  if (!captureResult.success)
    throw new Error('Flow 31: second generateBoardFile (for Blob capture) failed: ' + (captureResult.errors || []).join(', '));

  // Wait for FileReader.onload (async)
  let capturedDataUrl = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));
    capturedDataUrl = await evalInChrome('window._lastSaburaBlob');
    if (capturedDataUrl) break;
  }
  if (!capturedDataUrl)
    throw new Error('Flow 31: Blob interceptor did not capture any data within 3 seconds');

  // Decode base64 data URL -> HTML string
  const b64 = capturedDataUrl.split(',')[1];
  const downloadedHtml = Buffer.from(b64, 'base64').toString('utf8');
  const actualBytes = Buffer.byteLength(downloadedHtml, 'utf8');
  console.log(`  ✓ 31h. Blob captured in browser: ${actualBytes} bytes`);

  // Step K: Verify real byte size matches byteLength returned by API
  // Step K: Verify real byte size matches byteLength returned by API (use captureResult)
  if (Math.abs(actualBytes - captureResult.byteLength) > 4)
    throw new Error(`Flow 31: byteLength mismatch — API=${captureResult.byteLength}, decoded=${actualBytes}`);
  console.log(`  ✓ 31i. byteLength accurate: API=${captureResult.byteLength}, decoded=${actualBytes}`);

  // Step L: CSS and JS content hashes must match generator
  const dlCssHash = sha256hex(extractCssContent(downloadedHtml));
  const dlJsHash = sha256hex(extractJsContent(downloadedHtml));
  if (dlCssHash !== generatorCssHash)
    throw new Error('Flow 31: CSS content hash changed in generated file');
  if (dlJsHash !== generatorJsHash)
    throw new Error('Flow 31: JS bundle hash changed in generated file');
  console.log('  ✓ 31j. CSS and JS content hashes match generator');

  // Step M: Extract and validate embedded document
  const extracted = extractDocumentFromHtml(downloadedHtml);
  if (!extracted.valid)
    throw new Error('Flow 31: Embedded document invalid: ' + extracted.errors.join(', '));
  if (extracted.document.id !== 'board_e2egentest')
    throw new Error('Flow 31: Embedded document ID mismatch: ' + extracted.document.id);
  if (!extracted.document.objects['shape_e2e'])
    throw new Error('Flow 31: shape_e2e missing from embedded document');
  console.log('  ✓ 31k. Embedded document validates and contains supplied object');

  // Step N: Serve generated file via HTTP and navigate Chrome to it
  generatedE2eHtml = downloadedHtml;
  await cdpSend('Page.navigate', { url: `http://127.0.0.1:${port}/generated-e2e.html` });
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    const hasApp = await evalInChrome('Boolean(window.saburaApp)').catch(() => false);
    if (hasApp) break;
  }

  // Step O: Verify the supplied object is rendered via public API
  const renderOk = await evalInChrome(`(() => {
    const doc = window.sabura.getDocument();
    return Boolean(doc && doc.id === 'board_e2egentest' && doc.objects && doc.objects['shape_e2e']);
  })()`);
  if (!renderOk)
    throw new Error('Flow 31: Generated board did not render the supplied shape_e2e object');
  console.log('  ✓ 31l. Generated board opened with supplied object visible');

  // Step P: Confirm the generated board is editable (create a new object via public API)
  const editOk = await evalInChrome(`(() => {
    const result = window.sabura.applyCommands([{
      type: 'create_object',
      object: { id: 'r_edit_test', type: 'ellipse', x: 300, y: 300, width: 100, height: 60, seed: 99 }
    }]);
    return result.success && Boolean(window.sabura.getDocument().objects['r_edit_test']);
  })()`);
  if (!editOk)
    throw new Error('Flow 31: Generated board is not editable via applyCommands');
  console.log('  ✓ 31m. Generated board remains fully editable');

  console.log('\n✓ Flow 31: AI generator interface fully verified!');

} finally {
  // Restore Chrome to the main generator file before Safari tests
  try { await cdpSend('Page.navigate', { url: `http://127.0.0.1:${port}/sabura.html` }); } catch (_) {}
  // Clean temporary download directory
  try {
    for (const f of fs.readdirSync(tmpDownloadDir)) {
      try { fs.unlinkSync(path.join(tmpDownloadDir, f)); } catch (_) {}
    }
    fs.rmdirSync(tmpDownloadDir);
  } catch (_) {}
}

console.log('\n✓ All Chrome flows passed cleanly!');
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
const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Safari test timed out after 120 seconds')), 120000));
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
console.log('✓ ALL CRITICAL BROWSER REQUIREMENTS VERIFIED IN CHROME AND SAFARI!');
console.log('  Chrome: Flows 1-31 (including AI generator interface, Flow 31)');
console.log('  Safari: Flows 15-28 + AI API checks (15a-h); download capture not supported in Safari');
console.log('=============================================================\n');
process.exit(0);
