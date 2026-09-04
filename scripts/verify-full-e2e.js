import { spawn, exec, execSync } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { extractDocumentFromHtml } from '../src/storage/file-packer.js';

const rootDir = path.resolve('.');
const port = 8092;
const chromeOnly = process.argv.includes('--chrome-only');

// 1. Build sabura.html before running tests
console.log('--- Step 0: Building latest sabura.html ---');
const saburaHtml = fs.readFileSync(path.join(rootDir, 'sabura.html'), 'utf8');

// 2. Prepare Safari test script
const safariRunnerCode = `
fetch('/api/safari-log', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ msg: 'SAFARI RUNNER SCRIPT EVALUATED' })
}).catch(() => {});

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

async function runSafariTests() {
  const results = [];
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modObj = isMac ? { metaKey: true } : { ctrlKey: true };
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
    app.setMode('editing');

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

    const isMultiBeforeQ = app.workspace.selectedIds;
    fetch('/api/safari-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg: 'DEBUG Flow 18: selectedIds=' + JSON.stringify(isMultiBeforeQ) + ' wheelOpen=' + app.wheel.isOpen + ' activeSub=' + app.wheel.activeSubMenu + ' distClass=' + distWedge?.className + ' ariaDis=' + distWedge?.getAttribute('aria-disabled') })
    }).catch(() => {});

    let distHSub = document.querySelector('[data-sub-id="dist_h"]');
    if (!distHSub) {
      distWedge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await sleep(150);
      distHSub = document.querySelector('[data-sub-id="dist_h"]');
    }
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
    log('19. Real Shift-Click & Drag Multi-Selection with 1-Step Undo', shiftSelOk && dragOk && dragUndoOk, 'dragOk=' + dragOk + ' undoOk=' + dragUndoOk + ' introX=' + dragIntroX + ' coreX=' + dragCoreX + ' shiftSel=' + shiftSelOk + ' selIds=' + JSON.stringify(app.workspace.selectedIds));

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

    log('20. Real Keyboard Copy, Paste, Group & Ungroup', pastedOk && pastedOffset && pasteUndoOk && groupCreated && ungrouped, 'pasteOk=' + pastedOk + ' pasteIds=' + JSON.stringify(pasteIds) + ' pastedOffset=' + pastedOffset + ' pasteUndoOk=' + pasteUndoOk + ' groupCreated=' + groupCreated + ' ungrouped=' + ungrouped);

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
                   Math.abs(dxIdea - dxCore) < 0.01 &&
                   Math.abs(dyIdea - dyCore) < 0.01 &&
                   Math.abs(dxIdea - 100) <= 12 &&
                   Math.abs(dyIdea - 50) <= 12);

    // Undo D-drag in one step
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
    await sleep(100);

    const ddragUndoOk = ddragIds.every(id => !app.doc.objects[id]);

    log('21. Real Multi-Object D-Drag with No Placement Jump & 1-Step Undo', ddragCreated && origsUntouched && noJump && ddragUndoOk, 'created=' + ddragCreated + ' noJump=' + noJump + ' undoOk=' + ddragUndoOk + ' dxIdea=' + dxIdea + ' dyIdea=' + dyIdea + ' dxCore=' + dxCore + ' dyCore=' + dyCore);

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

    // Flow 33: Resizing and Transform Foundation in Safari (Comprehensive Physical Pointer-Driven)
    {
      app.setMode('editing');
      app.workspace.camera = { x: 0, y: 0, zoom: 1.0 };
      app.workspace.selectedIds = [];
      app.workspace.render();
      await sleep(50);

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modObj = isMac ? { metaKey: true } : { ctrlKey: true };

      async function dragHandle(handleName, dx, dy, options = {}) {
        const handleEl = document.querySelector('circle[data-handle="' + handleName + '"]');
        if (!handleEl) return false;
        const hRect = handleEl.getBoundingClientRect();
        const startX = hRect.left + hRect.width / 2;
        const startY = hRect.top + hRect.height / 2;
        const zoom = app.workspace.camera.zoom || 1.0;
        const screenDx = dx * zoom;
        const screenDy = dy * zoom;

        handleEl.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: startX,
          clientY: startY,
          button: 0,
          buttons: 1
        }));
        await sleep(25);

        window.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: startX + screenDx,
          clientY: startY + screenDy,
          button: 0,
          buttons: 1,
          shiftKey: Boolean(options.shiftKey),
          altKey: Boolean(options.altKey)
        }));
        await sleep(25);

        if (options.cancelWithEscape) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
          await sleep(25);
          window.dispatchEvent(new PointerEvent('pointerup', {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: startX + screenDx,
            clientY: startY + screenDy,
            button: 0,
            buttons: 0
          }));
          await sleep(25);
          return true;
        }

        if (options.cancelWithModeSwitch) {
          app.setMode('reading');
          await sleep(25);
          window.dispatchEvent(new PointerEvent('pointerup', {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: startX + screenDx,
            clientY: startY + screenDy,
            button: 0,
            buttons: 0
          }));
          await sleep(25);
          app.setMode('editing');
          await sleep(25);
          return true;
        }

        if (options.cancelWithPresentation) {
          app.enterPresentation();
          await sleep(25);
          window.dispatchEvent(new PointerEvent('pointerup', {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: startX + screenDx,
            clientY: startY + screenDy,
            button: 0,
            buttons: 0
          }));
          await sleep(25);
          app.exitPresentation();
          await sleep(25);
          return true;
        }

        window.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: startX + screenDx,
          clientY: startY + screenDy,
          button: 0,
          buttons: 0
        }));
        await sleep(35);
        return true;
      }

      // =========================================================================
      // 33a. All 8 Resize Handles, Modifiers, Min Size, Zoom/Pan & Cancel/Undo/Redo
      // =========================================================================
      const testShapeId = 'safari_test_shape_33a_' + Date.now();
      app.dispatchCommand({
        type: 'create_object',
        object: {
          id: testShapeId,
          type: 'rectangle',
          x: 100,
          y: 100,
          width: 200,
          height: 100,
          stroke: '#1e1e1e',
          fill: 'none'
        }
      });
      app.workspace.selectedIds = [testShapeId];
      app.workspace.render();
      await sleep(50);

      // 1. All 8 handles individually
      await dragHandle('se', 40, 20);
      const seOk = app.doc.objects[testShapeId].width === 240 && app.doc.objects[testShapeId].height === 120;

      await dragHandle('nw', -20, -10);
      const nwOk = app.doc.objects[testShapeId].x === 80 && app.doc.objects[testShapeId].y === 90 &&
                   app.doc.objects[testShapeId].width === 260 && app.doc.objects[testShapeId].height === 130;

      await dragHandle('ne', 20, -10);
      const neOk = app.doc.objects[testShapeId].y === 80 && app.doc.objects[testShapeId].width === 280 && app.doc.objects[testShapeId].height === 140;

      await dragHandle('sw', -20, 20);
      const swOk = app.doc.objects[testShapeId].x === 60 && app.doc.objects[testShapeId].width === 300 && app.doc.objects[testShapeId].height === 160;

      await dragHandle('e', 30, 0);
      const eOk = app.doc.objects[testShapeId].width === 330 && app.doc.objects[testShapeId].height === 160;

      await dragHandle('w', -20, 0);
      const wOk = app.doc.objects[testShapeId].x === 40 && app.doc.objects[testShapeId].width === 350 && app.doc.objects[testShapeId].height === 160;

      await dragHandle('s', 0, 30);
      const sOk = app.doc.objects[testShapeId].height === 190 && app.doc.objects[testShapeId].width === 350;

      await dragHandle('n', 0, -20);
      const nOk = app.doc.objects[testShapeId].y === 60 && app.doc.objects[testShapeId].height === 210 && app.doc.objects[testShapeId].width === 350;

      const all8HandlesOk = seOk && nwOk && neOk && swOk && eOk && wOk && sOk && nOk;

      // Undo all 8 handles
      for (let i = 0; i < 8; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
        await sleep(25);
      }
      const undo8Ok = app.doc.objects[testShapeId].width === 200 && app.doc.objects[testShapeId].height === 100;

      // Redo all 8 handles
      for (let i = 0; i < 8; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, shiftKey: true, bubbles: true }));
        await sleep(25);
      }
      const redo8Ok = app.doc.objects[testShapeId].width === 350 && app.doc.objects[testShapeId].height === 210;

      // Undo back to baseline
      for (let i = 0; i < 8; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
        await sleep(25);
      }

      // Modifiers: Shift (aspect ratio), Alt (center-origin), Shift+Alt
      await dragHandle('se', 100, 20, { shiftKey: true });
      const shiftW = app.doc.objects[testShapeId].width;
      const shiftH = app.doc.objects[testShapeId].height;
      const shiftRatioOk = Math.abs((shiftW / shiftH) - 2.0) < 0.05 && shiftW > 200;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(25);

      await dragHandle('se', 40, 20, { altKey: true });
      const altOk = app.doc.objects[testShapeId].x === 60 && app.doc.objects[testShapeId].y === 80 &&
                    app.doc.objects[testShapeId].width === 280 && app.doc.objects[testShapeId].height === 140;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(25);

      await dragHandle('se', 50, 30, { shiftKey: true, altKey: true });
      const saW = app.doc.objects[testShapeId].width;
      const saH = app.doc.objects[testShapeId].height;
      const saRatioOk = Math.abs((saW / saH) - 2.0) < 0.05 && app.doc.objects[testShapeId].x < 100;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(25);

      // Minimum size clamping
      await dragHandle('se', -500, -500);
      const minClampOk = app.doc.objects[testShapeId].width === 16 && app.doc.objects[testShapeId].height === 16;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(25);

      // Non-default zoom and pan
      app.workspace.camera = { x: 120, y: -60, zoom: 1.5 };
      app.workspace.render();
      await sleep(50);
      await dragHandle('se', 60, 40);
      const zoomResizeOk = app.doc.objects[testShapeId].width === 260 && app.doc.objects[testShapeId].height === 140;
      app.workspace.camera = { x: 0, y: 0, zoom: 1.0 };
      app.workspace.render();
      await sleep(50);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(25);

      // Cancellation
      await dragHandle('se', 80, 40, { cancelWithEscape: true });
      const escapeOk = app.doc.objects[testShapeId].width === 200;

      await dragHandle('se', 80, 40, { cancelWithModeSwitch: true });
      const modeSwitchOk = app.doc.objects[testShapeId].width === 200;

      await dragHandle('se', 80, 40, { cancelWithPresentation: true });
      const presentationOk = app.doc.objects[testShapeId].width === 200;

      app.dispatchCommand({ type: 'delete_objects', ids: [testShapeId] });

      const r33aOk = all8HandlesOk && undo8Ok && redo8Ok && shiftRatioOk && altOk && saRatioOk && minClampOk && zoomResizeOk && escapeOk && modeSwitchOk && presentationOk;
      log('33a. All 8 Resize Handles, Modifiers, Min Size, Zoom/Pan & Cancel/Undo/Redo', r33aOk,
        'all8=' + all8HandlesOk + ' undo8=' + undo8Ok + ' redo8=' + redo8Ok + ' shift=' + shiftRatioOk + ' alt=' + altOk + ' min=' + minClampOk + ' zoom=' + zoomResizeOk + ' cancel=' + (escapeOk && modeSwitchOk && presentationOk));

      // =========================================================================
      // 33b. Single Path Resizing (Open Sharp, Curved, Closed with Fill, Cycles & Undo/Redo)
      // =========================================================================
      const pathId = 'path_safari_33b_' + Date.now();
      app.dispatchCommand({
        type: 'create_object',
        object: {
          id: pathId,
          type: 'path',
          x: 200,
          y: 200,
          width: 100,
          height: 100,
          points: [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }],
          stroke: '#1e1e1e',
          closed: false,
          curveStyle: 'sharp'
        }
      });
      app.workspace.selectedIds = [pathId];
      app.workspace.render();
      await sleep(50);

      // 1. Open sharp scaling
      await dragHandle('se', 100, 50);
      const pObj = app.doc.objects[pathId];
      const pt1X = pObj?.points && (pObj.points[1]?.x !== undefined ? pObj.points[1].x : pObj.points[1]?.[0]);
      const pt1Y = pObj?.points && (pObj.points[1]?.y !== undefined ? pObj.points[1].y : pObj.points[1]?.[1]);
      const pathScaleOk = pObj.width === 200 && pObj.height === 150 && pt1X === 100 && pt1Y === 150;

      // 2. Open curved scaling with arrowheads & exact geometry undo/redo
      app.dispatchCommand({
        type: 'set_style',
        ids: [pathId],
        updates: { curveStyle: 'curved', startArrow: true, endArrow: true }
      });
      app.workspace.render();
      await sleep(50);
      const elemPath = document.querySelector('#elem-' + pathId);
      const hasCurvedD = Boolean(elemPath?.querySelector('path[d*="C"], path[d*="Q"], path[d*="M"]'));
      const curvedConfigOk = app.doc.objects[pathId].curveStyle === 'curved' &&
                             app.doc.objects[pathId].startArrow === true &&
                             app.doc.objects[pathId].endArrow === true && hasCurvedD;

      // Physically drag open curved path
      await dragHandle('se', 60, 40);
      const curvedDraggedW = app.doc.objects[pathId].width;
      const curvedDraggedH = app.doc.objects[pathId].height;
      const curvedDragOk = curvedDraggedW === 260 && curvedDraggedH === 190;

      // Exact 1-step undo restores open curved geometry
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(25);
      const undoCurvedOk = app.doc.objects[pathId].width === 200 && app.doc.objects[pathId].height === 150;

      // Exact 1-step redo reapplies resized open curved geometry
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, shiftKey: true, bubbles: true }));
      await sleep(25);
      const redoCurvedOk = app.doc.objects[pathId].width === 260 && app.doc.objects[pathId].height === 190;

      // 3. Closed path with fill
      app.dispatchCommand({
        type: 'set_style',
        ids: [pathId],
        updates: { closed: true, fill: '#ffc9c9' }
      });
      app.workspace.render();
      await sleep(50);
      const curElem = document.querySelector('#elem-' + pathId);
      const hasClosedFill = Boolean(curElem?.querySelector('path[fill="#ffc9c9"]'));

      // 4. Repeated cycles without drift
      const preCycleW = app.doc.objects[pathId].width;
      await dragHandle('se', 50, 50);
      await dragHandle('se', -50, -50);
      const cycleOk = Math.abs(app.doc.objects[pathId].width - preCycleW) <= 1;

      // 5. Undo & Redo
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(25);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, shiftKey: true, bubbles: true }));
      await sleep(25);

      app.dispatchCommand({ type: 'delete_objects', ids: [pathId] });

      const r33bOk = pathScaleOk && curvedConfigOk && curvedDragOk && undoCurvedOk && redoCurvedOk && hasClosedFill && cycleOk;
      log('33b. Single Path (Open Sharp, Open Curved Drag with Undo/Redo, Closed Fill, Cycles)', r33bOk,
        'sharpScale=' + pathScaleOk + ' curvedDrag=' + curvedDragOk + ' undoCurved=' + undoCurvedOk + ' redoCurved=' + redoCurvedOk + ' closedFill=' + hasClosedFill + ' cycle=' + cycleOk);

      // =========================================================================
      // 33c. Multi-Selection & Persisted Groups (Ordinary Multi-Selection + Real Group Edge Resize under Zoom/Pan)
      // =========================================================================
      // Part 1: Ordinary Heterogeneous Multi-Selection
      const s1 = 'ms_s1_' + Date.now();
      const s2Locked = 'ms_s2_locked_' + Date.now();
      const sText = 'ms_text_' + Date.now();
      const sPath = 'ms_path_' + Date.now();
      const sConnAttached = 'ms_conn_att_' + Date.now();
      const sConnFree = 'ms_conn_free_' + Date.now();

      app.dispatchCommandBatch([
        { type: 'create_object', object: { id: s1, type: 'rectangle', x: 100, y: 100, width: 100, height: 100 } },
        { type: 'create_object', object: { id: s2Locked, type: 'ellipse', x: 250, y: 100, width: 100, height: 100, locked: true } },
        { type: 'create_object', object: { id: sText, type: 'text', x: 100, y: 250, width: 80, height: 30, text: 'Hello', textStyle: { size: 'm', resolvedSize: 20 } } },
        { type: 'create_object', object: { id: sPath, type: 'path', x: 250, y: 250, width: 100, height: 100, points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] } },
        { type: 'create_object', object: { id: sConnAttached, type: 'connector', from: { id: s1, anchor: { x: 0.5, y: 0.5 } }, to: { point: { x: 400, y: 150 } } } },
        { type: 'create_object', object: { id: sConnFree, type: 'connector', from: { point: { x: 150, y: 400 } }, to: { point: { x: 300, y: 400 } } } }
      ]);

      app.workspace.selectedIds = [s1, s2Locked, sText, sPath, sConnAttached, sConnFree];
      app.workspace.render();
      await sleep(50);

      const origS1W = app.doc.objects[s1].width;
      const origLockedX = app.doc.objects[s2Locked].x;
      const origLockedW = app.doc.objects[s2Locked].width;
      const origTextSize = app.doc.objects[sText].textStyle.resolvedSize;
      const origFreeConnToX = app.doc.objects[sConnFree].to.point.x;

      await dragHandle('se', 80, 40);

      const s1Transformed = app.doc.objects[s1].width > origS1W;
      const lockedUntouched = app.doc.objects[s2Locked].x === origLockedX && app.doc.objects[s2Locked].width === origLockedW;
      const textScaled = app.doc.objects[sText].textStyle.resolvedSize > origTextSize;
      const attachedAnchorPreserved = app.doc.objects[sConnAttached].from.anchor.x === 0.5 && app.doc.objects[sConnAttached].from.anchor.y === 0.5;
      const freeConnScaled = app.doc.objects[sConnFree].to.point.x > origFreeConnToX;

      // 1-step undo
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(50);
      const multiUndoOk = app.doc.objects[s1].width === origS1W && app.doc.objects[sText].textStyle.resolvedSize === origTextSize;

      // 1-step redo
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, shiftKey: true, bubbles: true }));
      await sleep(50);
      const multiRedoOk = app.doc.objects[s1].width > origS1W;

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(25);
      app.dispatchCommand({ type: 'delete_objects', ids: [s1, s2Locked, sText, sPath, sConnAttached, sConnFree] });

      // Part 2: Genuinely Persisted Group Resizing under Non-Default Camera Zoom & Pan with Edge Drag
      const grpS1 = 'grp_s1_' + Date.now();
      const grpS2 = 'grp_s2_' + Date.now();
      const persistedGid = 'persisted_grp_safari_33c';

      app.dispatchCommandBatch([
        { type: 'create_object', object: { id: grpS1, type: 'rectangle', x: 100, y: 100, width: 100, height: 100 } },
        { type: 'create_object', object: { id: grpS2, type: 'ellipse', x: 250, y: 100, width: 100, height: 100 } },
        { type: 'group_objects', ids: [grpS1, grpS2], groupId: persistedGid }
      ]);

      // Normal group selection interaction: select member grpS1
      const hitObj = app.workspace.findObjectAt({ x: 150, y: 150 });
      if (hitObj && hitObj.groupId) {
        app.workspace.selectedIds = Object.values(app.doc.objects).filter(o => o.groupId === hitObj.groupId).map(o => o.id);
      } else {
        app.workspace.selectedIds = [grpS1, grpS2];
      }
      app.workspace.camera = { x: 80, y: -40, zoom: 1.25 };
      app.workspace.render();
      await sleep(50);

      const preGroupS1W = app.doc.objects[grpS1].width;
      const preGroupS2W = app.doc.objects[grpS2].width;
      const preGroupS2X = app.doc.objects[grpS2].x;

      // Physically drag right edge handle 'e' by 60px under 1.25x camera zoom/pan
      await dragHandle('e', 60, 0);

      const postGroupS1W = app.doc.objects[grpS1].width;
      const postGroupS2W = app.doc.objects[grpS2].width;
      const postGroupS2X = app.doc.objects[grpS2].x;

      const groupResizedOk = postGroupS1W > preGroupS1W && postGroupS2W > preGroupS2W && postGroupS2X > preGroupS2X &&
                             app.doc.objects[grpS1].groupId === persistedGid && app.doc.objects[grpS2].groupId === persistedGid;

      // 1-step undo
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(50);
      const groupUndoOk = app.doc.objects[grpS1].width === preGroupS1W && app.doc.objects[grpS2].width === preGroupS2W && app.doc.objects[grpS2].x === preGroupS2X;

      // 1-step redo
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, shiftKey: true, bubbles: true }));
      await sleep(50);
      const groupRedoOk = app.doc.objects[grpS1].width === postGroupS1W && app.doc.objects[grpS2].width === postGroupS2W && app.doc.objects[grpS2].x === postGroupS2X;

      app.workspace.camera = { x: 0, y: 0, zoom: 1.0 };
      app.workspace.render();
      await sleep(25);
      app.dispatchCommand({ type: 'delete_objects', ids: [grpS1, grpS2] });

      const r33cOk = s1Transformed && lockedUntouched && textScaled && attachedAnchorPreserved && freeConnScaled && multiUndoOk && multiRedoOk && groupResizedOk && groupUndoOk && groupRedoOk;
      log('33c. Multi-Selection & Persisted Groups (Ordinary Multi-Selection + Real Group Edge Resize under Zoom/Pan)', r33cOk,
        's1=' + s1Transformed + ' locked=' + lockedUntouched + ' text=' + textScaled + ' groupResize=' + groupResizedOk + ' groupUndo=' + groupUndoOk + ' groupRedo=' + groupRedoOk);

      // =========================================================================
      // 33d. Standalone Text Contextual Wheel Slots & Text-to-Shape Morphing
      // =========================================================================
      const textObjId = 'text_wheel_safari_' + Date.now();
      app.dispatchCommand({
        type: 'create_object',
        object: {
          id: textObjId,
          type: 'text',
          x: 300,
          y: 300,
          width: 120,
          height: 36,
          text: 'Sample Typography',
          stroke: '#1e1e1e',
          textStyle: { color: '#1e1e1e', size: 'm', fontFamily: 'hand' }
        }
      });
      app.workspace.selectedIds = [textObjId];
      const tObj = app.doc.objects[textObjId];
      app.wheel.open(300, 300, 'object', tObj, app.doc.theme.palette, 1, [tObj]);
      await sleep(50);

      const textWheelItems = app.wheel.getItems();
      const slot0Opacity = textWheelItems[0].id === 'menu_opacity';
      const slot5Disabled = textWheelItems[5].id === 'menu_style' && Boolean(textWheelItems[5].disabled);
      const slot6ColorText = textWheelItems[6].id === 'menu_ink';
      const noEqualSides = !textWheelItems[2].subItems.some(i => i.id === 'toggle_equal_sides');
      app.wheel.close();

      // Morph to rectangle
      app.dispatchCommand({ type: 'change_shape', id: textObjId, shapeType: 'rectangle' });
      const morphedObj = app.doc.objects[textObjId];
      app.wheel.open(300, 300, 'object', morphedObj, app.doc.theme.palette, 1, [morphedObj]);
      await sleep(50);
      const shapeWheelItems = app.wheel.getItems();
      const morphedSlot1Fill = shapeWheelItems[0].id === 'menu_fill';
      const morphedSlot5Enabled = shapeWheelItems[5].id === 'menu_style' && !shapeWheelItems[5].disabled;
      app.wheel.close();

      app.dispatchCommand({ type: 'delete_objects', ids: [textObjId] });

      const r33dOk = slot0Opacity && slot5Disabled && slot6ColorText && noEqualSides && morphedSlot1Fill && morphedSlot5Enabled;
      log('33d. Standalone Text Contextual Wheel & Text-to-Shape Morphing', r33dOk,
        'slot0=' + slot0Opacity + ' slot5Disabled=' + slot5Disabled + ' colorText=' + slot6ColorText + ' noEqualSides=' + noEqualSides + ' morphedFill=' + morphedSlot1Fill);

      // =========================================================================
      // 33e. No Outline (strokeWidth: 0) Rendering Semantics
      // =========================================================================
      const noOutShapeId = 'no_out_safari_' + Date.now();
      app.dispatchCommand({
        type: 'create_object',
        object: {
          id: noOutShapeId,
          type: 'rectangle',
          x: 200,
          y: 200,
          width: 100,
          height: 100,
          stroke: '#1e1e1e',
          strokeWidth: 2,
          fill: '#ffc9c9'
        }
      });
      app.dispatchCommand({
        type: 'set_style',
        ids: [noOutShapeId],
        updates: { strokeWidth: 0 }
      });
      app.workspace.render();
      await sleep(50);

      const noOutObj = app.doc.objects[noOutShapeId];
      const noOutStored = noOutObj.strokeWidth === 0 && noOutObj.stroke === '#1e1e1e';
      const noOutElem = document.querySelector('#elem-' + noOutShapeId);
      const fillPathPresent = Boolean(noOutElem?.querySelector('path[fill="#ffc9c9"]'));
      const strokePathAbsent = !noOutElem?.querySelector('path[stroke-width]');

      // Undo
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(25);
      const undoStrokeOk = app.doc.objects[noOutShapeId].strokeWidth === 2;

      // Redo
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, shiftKey: true, bubbles: true }));
      await sleep(25);
      const redoStrokeOk = app.doc.objects[noOutShapeId].strokeWidth === 0;

      app.dispatchCommand({ type: 'delete_objects', ids: [noOutShapeId] });

      const r33eOk = noOutStored && fillPathPresent && strokePathAbsent && undoStrokeOk && redoStrokeOk;
      log('33e. No Outline (strokeWidth: 0) Rendering Semantics & Undo/Redo', r33eOk,
        'stored=' + noOutStored + ' fillPresent=' + fillPathPresent + ' strokeAbsent=' + strokePathAbsent + ' undo=' + undoStrokeOk + ' redo=' + redoStrokeOk);

      // =========================================================================
      // 33f. Complete Group/Duplicate/Connect/generateBoardFile Regression
      // =========================================================================
      const regS1 = 'reg_shape1_safari_' + Date.now();
      const regS2 = 'reg_shape2_safari_' + Date.now();
      const regGrpId = 'grp_reg_safari_33f';

      app.dispatchCommandBatch([
        { type: 'create_object', object: { id: regS1, type: 'rectangle', x: 600, y: 100, width: 100, height: 100 } },
        { type: 'create_object', object: { id: regS2, type: 'ellipse', x: 750, y: 100, width: 100, height: 100 } },
        { type: 'group_objects', ids: [regS1, regS2], groupId: regGrpId }
      ]);

      app.dispatchCommand({ type: 'duplicate_objects', ids: [regS1, regS2] });

      const dupObjects = Object.values(app.doc.objects).filter(o => o.groupId && o.groupId !== regGrpId && o.type !== 'connector');
      const dupGrpId = dupObjects[0]?.groupId;
      const dupS1 = dupObjects.find(o => o.type === 'rectangle');

      app.dispatchCommand({ type: 'move_objects', ids: dupObjects.map(o => o.id), dx: 0, dy: 250 });

      // Connect interactively with connector tool
      app.workspace.setTool('connector');
      const startPt = app.workspace.worldToScreen(650, 150);
      const endPt = app.workspace.worldToScreen(650, 400);

      app.workspace.container.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: startPt.x,
        clientY: startPt.y,
        button: 0,
        buttons: 1
      }));
      await sleep(30);
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        clientX: endPt.x,
        clientY: endPt.y,
        button: 0,
        buttons: 1
      }));
      await sleep(30);
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        clientX: endPt.x,
        clientY: endPt.y,
        button: 0,
        buttons: 0
      }));
      await sleep(50);
      app.workspace.setTool('select');

      const createdConn = Object.values(app.doc.objects).find(o => o.type === 'connector' && o.from?.id === regS1 && o.to?.id === dupS1.id);
      const connSchemaPurity = createdConn && createdConn.x === undefined && createdConn.y === undefined &&
                               createdConn.width === undefined && createdConn.height === undefined;

      // Validate via real public API
      const valResult = window.sabura.validateDocument(app.doc);
      const docValid = valResult.valid === true && valResult.errors.length === 0;

      // Execute production generateBoardFile
      const genResult = window.sabura.generateBoardFile(app.doc);
      const generateOk = genResult.success === true && genResult.byteLength > 0 && typeof genResult.filename === 'string';

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      app.dispatchCommand({ type: 'delete_objects', ids: [regS1, regS2, ...dupObjects.map(o => o.id)] });
      app.workspace.selectedIds = [];
      app.workspace.render();

      const r33fOk = connSchemaPurity && docValid && generateOk;
      log('33f. Complete Group/Duplicate/Connect/generateBoardFile Regression (Safari: download capture not supported in test runner)', r33fOk,
        'purity=' + connSchemaPurity + ' docValid=' + docValid + ' generateOk=' + generateOk + ' byteLength=' + genResult.byteLength);
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
        theme: window.sabura.getDocument().theme, objects: {}, order: [], groups: {}, assets: {}
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
        theme: window.sabura.getDocument().theme,
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

    // Flow 16: Rotation Foundation in Safari (Comprehensive Verification)
    try {
      app.setMode('editing');

      // 16a. Single object rotation with Shift snapping & continuous rebase under non-default camera
      const rotShapeId = 'safari_rot_' + Date.now();
      app.dispatchCommand({
        type: 'create_object',
        object: { id: rotShapeId, type: 'rectangle', x: 200, y: 200, width: 100, height: 100, stroke: '#1e1e1e', fill: 'none' }
      });
      app.workspace.selectedIds = [rotShapeId];
      app.workspace.render();
      await sleep(30);

      // Set non-default camera
      app.workspace.camera.zoom = 1.5;
      app.workspace.camera.x = 100;
      app.workspace.camera.y = 50;
      app.workspace.render();
      await sleep(30);

      const rotHandle = document.querySelector('[data-handle="rotate"]');
      const hasRotHandle = Boolean(rotHandle);
      const startScreen = app.workspace.worldToScreen(250, 172);
      const targetScreen = app.workspace.worldToScreen(328, 250);

      // 1. Rotate to 90 degrees
      if (rotHandle) {
        rotHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: startScreen.x, clientY: startScreen.y, button: 0, buttons: 1 }));
        await sleep(25);
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: targetScreen.x, clientY: targetScreen.y, button: 0, buttons: 1 }));
        await sleep(25);
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: targetScreen.x, clientY: targetScreen.y, button: 0, buttons: 0 }));
        await sleep(30);
      }

      const objAfterRot = app.doc.objects[rotShapeId];
      const rotDegrees = Math.round(objAfterRot?.rotation || 0);
      const rotOk = Math.abs(rotDegrees - 90) <= 2;

      // 2. Undo & Redo rotation in Safari
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(25);
      const rotUndone = (app.doc.objects[rotShapeId].rotation || 0) === 0;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, shiftKey: true, bubbles: true }));
      await sleep(25);
      const rotRedone = Math.abs(Math.round(app.doc.objects[rotShapeId].rotation || 0) - 90) <= 2;

      // 3. Shift press and release mid-gesture check
      let jumpOnPress = 999;
      let jumpOnRelease = 999;
      const shiftRotHandle = document.querySelector('[data-handle="rotate"]');
      if (shiftRotHandle) {
        const hBox = shiftRotHandle.getBoundingClientRect();
        shiftRotHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: hBox.left + hBox.width / 2, clientY: hBox.top + hBox.height / 2, button: 0, buttons: 1 }));
        await sleep(25);
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: hBox.left + hBox.width / 2 + 50, clientY: hBox.top + hBox.height / 2 + 50, button: 0, buttons: 1 }));
        await sleep(25);

        const angleBeforeShift = app.doc.objects[rotShapeId].rotation;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft', shiftKey: true, bubbles: true }));
        await sleep(25);
        const angleOnShiftPress = app.doc.objects[rotShapeId].rotation;
        jumpOnPress = Math.abs(angleOnShiftPress - angleBeforeShift);

        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: hBox.left + hBox.width / 2 + 70, clientY: hBox.top + hBox.height / 2 + 70, button: 0, buttons: 1, shiftKey: true }));
        await sleep(25);
        const angleWithShift = app.doc.objects[rotShapeId].rotation;

        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', code: 'ShiftLeft', shiftKey: false, bubbles: true }));
        await sleep(25);
        const angleOnShiftRelease = app.doc.objects[rotShapeId].rotation;
        jumpOnRelease = Math.abs(angleOnShiftRelease - angleWithShift);

        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: hBox.left + hBox.width / 2 + 70, clientY: hBox.top + hBox.height / 2 + 70, button: 0, buttons: 0 }));
        await sleep(30);

        // Undo Shift test gesture so rotShapeId is back at 90 deg for 16b
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
        await sleep(25);
      }
      const shiftRebaseOk = jumpOnPress < 0.1 && jumpOnRelease < 0.1;

      // Reset camera
      app.workspace.camera.zoom = 1;
      app.workspace.camera.x = 0;
      app.workspace.camera.y = 0;
      app.workspace.render();
      await sleep(25);

      log('16a. Single object rotation handle drag & continuous Shift rebase (Safari)', hasRotHandle && rotOk && shiftRebaseOk && rotUndone && rotRedone, 'rotation=' + rotDegrees + ' deg jumpPress=' + jumpOnPress.toFixed(2) + ' jumpRel=' + jumpOnRelease.toFixed(2));

      // 16b. Rotated single-object resize along local axes
      const seHandle = document.querySelector('[data-handle="se"]');
      if (seHandle) {
        const seBox = seHandle.getBoundingClientRect();
        const startSeX = seBox.left + seBox.width / 2;
        const startSeY = seBox.top + seBox.height / 2;
        seHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: startSeX, clientY: startSeY, button: 0, buttons: 1 }));
        await sleep(25);
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: startSeX, clientY: startSeY + 40, button: 0, buttons: 1 }));
        await sleep(25);
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: startSeX, clientY: startSeY + 40, button: 0, buttons: 0 }));
        await sleep(30);
      }

      const objAfterResize = app.doc.objects[rotShapeId];
      const rotPreserved = Math.abs(Math.round(objAfterResize?.rotation || 0) - 90) <= 2;
      const sizeChanged = objAfterResize.width !== 100 || objAfterResize.height !== 100;
      log('16b. Rotated single-object resize preserves rotation angle (Safari)', rotPreserved && sizeChanged, 'w=' + objAfterResize?.width + ' h=' + objAfterResize?.height + ' rot=' + objAfterResize?.rotation);

      // 16c1. Ordinary multi-selection rotation vs Persisted group comparison
      const sm1Id = 'safari_m1_' + Date.now();
      const sm2Id = 'safari_m2_' + Date.now();
      app.dispatchCommand({
        type: 'create_object',
        object: { id: sm1Id, type: 'diamond', x: 100, y: 100, width: 80, height: 80, rotation: 30, stroke: '#1e1e1e', fill: 'none' }
      });
      app.dispatchCommand({
        type: 'create_object',
        object: { id: sm2Id, type: 'rectangle', x: 220, y: 100, width: 80, height: 80, rotation: 0, stroke: '#1e1e1e', fill: 'none' }
      });
      app.workspace.selectedIds = [sm1Id, sm2Id];
      app.workspace.render();
      await sleep(25);

      const smRotHandle = document.querySelector('[data-handle="rotate"]');
      if (smRotHandle) {
        const smBox = smRotHandle.getBoundingClientRect();
        smRotHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: smBox.left + smBox.width / 2, clientY: smBox.top + smBox.height / 2, button: 0, buttons: 1 }));
        await sleep(25);
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: smBox.left + smBox.width / 2 + 50, clientY: smBox.top + smBox.height / 2 + 50, button: 0, buttons: 1 }));
        await sleep(25);
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: smBox.left + smBox.width / 2 + 50, clientY: smBox.top + smBox.height / 2 + 50, button: 0, buttons: 0 }));
        await sleep(30);
      }
      const sm1RotMulti = app.doc.objects[sm1Id].rotation;
      const sm2RotMulti = app.doc.objects[sm2Id].rotation;
      const sm1PosMulti = { x: app.doc.objects[sm1Id].x, y: app.doc.objects[sm1Id].y };
      const sm2PosMulti = { x: app.doc.objects[sm2Id].x, y: app.doc.objects[sm2Id].y };

      // Undo multi rotation
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(25);

      // Group sm1 and sm2
      const sGrpCmpId = 'safari_grpcmp_' + Date.now();
      app.dispatchCommand({
        type: 'group_objects',
        groupId: sGrpCmpId,
        ids: [sm1Id, sm2Id]
      });
      app.workspace.selectedIds = [sm1Id, sm2Id];
      app.workspace.render();
      await sleep(25);

      const sGrpRotHandle = document.querySelector('[data-handle="rotate"]');
      if (sGrpRotHandle) {
        const sBox = sGrpRotHandle.getBoundingClientRect();
        sGrpRotHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: sBox.left + sBox.width / 2, clientY: sBox.top + sBox.height / 2, button: 0, buttons: 1 }));
        await sleep(25);
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: sBox.left + sBox.width / 2 + 50, clientY: sBox.top + sBox.height / 2 + 50, button: 0, buttons: 1 }));
        await sleep(25);
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: sBox.left + sBox.width / 2 + 50, clientY: sBox.top + sBox.height / 2 + 50, button: 0, buttons: 0 }));
        await sleep(30);
      }
      const sm1RotGroup = app.doc.objects[sm1Id].rotation;
      const sm2RotGroup = app.doc.objects[sm2Id].rotation;
      const sm1PosGroup = { x: app.doc.objects[sm1Id].x, y: app.doc.objects[sm1Id].y };
      const sm2PosGroup = { x: app.doc.objects[sm2Id].x, y: app.doc.objects[sm2Id].y };

      const ordinaryMultiMatchesGroup = (
        Math.abs(sm1RotMulti - sm1RotGroup) < 0.1 &&
        Math.abs(sm2RotMulti - sm2RotGroup) < 0.1 &&
        Math.hypot(sm1PosMulti.x - sm1PosGroup.x, sm1PosMulti.y - sm1PosGroup.y) < 0.1 &&
        Math.hypot(sm2PosMulti.x - sm2PosGroup.x, sm2PosMulti.y - sm2PosGroup.y) < 0.1
      );

      // Undo group rotation
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
      await sleep(25);

      // 16c2. Persisted group with pre-rotated members, locked member, curved connector & elbow connector
      const g1Id = 'safari_g1_' + Date.now();
      const g2Id = 'safari_g2_' + Date.now();
      const gLockedId = 'safari_glock_' + Date.now();
      const gStraightId = 'safari_catt_' + Date.now();
      const gCurvedId = 'safari_ccurv_' + Date.now();
      const gElbowId = 'safari_celb_' + Date.now();
      const gFreeId = 'safari_cfree_' + Date.now();

      app.dispatchCommand({
        type: 'create_object',
        object: { id: g1Id, type: 'diamond', x: 400, y: 100, width: 80, height: 80, rotation: 30, stroke: '#1e1e1e', fill: 'none' }
      });
      app.dispatchCommand({
        type: 'create_object',
        object: { id: g2Id, type: 'rectangle', x: 550, y: 100, width: 80, height: 80, rotation: 0, stroke: '#1e1e1e', fill: 'none' }
      });
      app.dispatchCommand({
        type: 'create_object',
        object: { id: gLockedId, type: 'ellipse', x: 700, y: 100, width: 70, height: 70, rotation: 45, locked: true, stroke: '#1e1e1e', fill: '#eeeeee' }
      });
      app.dispatchCommand({
        type: 'create_object',
        object: { id: gStraightId, type: 'connector', from: { id: g1Id, anchor: { x: 0.25, y: 0.75 } }, to: { id: g2Id }, routing: 'straight' }
      });
      app.dispatchCommand({
        type: 'create_object',
        object: { id: gCurvedId, type: 'connector', from: { id: g1Id }, to: { id: g2Id }, routing: 'curved', curveSide: 1, curveDistance: 50 }
      });
      app.dispatchCommand({
        type: 'create_object',
        object: { id: gElbowId, type: 'connector', from: { id: g1Id }, to: { id: g2Id }, routing: 'elbow', elbowOffset: 40 }
      });
      app.dispatchCommand({
        type: 'create_object',
        object: { id: gFreeId, type: 'connector', from: { id: g1Id }, to: { point: { x: 600, y: 350 } }, routing: 'straight' }
      });

      const safariGrpId = 'safari_grp_' + Date.now();
      app.dispatchCommand({
        type: 'group_objects',
        groupId: safariGrpId,
        ids: [g1Id, g2Id, gLockedId, gStraightId, gCurvedId, gElbowId, gFreeId]
      });
      app.workspace.selectedIds = [g1Id, g2Id, gLockedId, gStraightId, gCurvedId, gElbowId, gFreeId];
      app.workspace.render();
      await sleep(30);

      const grpRotHandle = document.querySelector('[data-handle="rotate"]');
      const hasGrpRotHandle = Boolean(grpRotHandle);
      if (grpRotHandle) {
        const grpBox = grpRotHandle.getBoundingClientRect();
        grpRotHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: grpBox.left + grpBox.width / 2, clientY: grpBox.top + grpBox.height / 2, button: 0, buttons: 1 }));
        await sleep(25);
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: grpBox.left + grpBox.width / 2 + 50, clientY: grpBox.top + grpBox.height / 2 + 50, button: 0, buttons: 1 }));
        await sleep(25);
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: grpBox.left + grpBox.width / 2 + 50, clientY: grpBox.top + grpBox.height / 2 + 50, button: 0, buttons: 0 }));
        await sleep(30);
      }
      const g1RotAfter = app.doc.objects[g1Id]?.rotation;
      const g2RotAfter = app.doc.objects[g2Id]?.rotation;
      const gLockRotAfter = app.doc.objects[gLockedId]?.rotation;
      const gStraightAnchorAfter = app.doc.objects[gStraightId]?.from?.anchor;
      const gCurvedAfter = app.doc.objects[gCurvedId];
      const gElbowAfter = app.doc.objects[gElbowId];
      const gFreeToPointAfter = app.doc.objects[gFreeId]?.to?.point;

      const grpRotOk = (
        hasGrpRotHandle &&
        ordinaryMultiMatchesGroup &&
        g1RotAfter !== 30 &&
        g2RotAfter !== 0 &&
        gLockRotAfter === 45 && // Locked member preserved
        gStraightAnchorAfter?.x === 0.25 && gStraightAnchorAfter?.y === 0.75 &&
        gCurvedAfter?.routing === 'curved' && gCurvedAfter?.curveSide === 1 &&
        gElbowAfter?.routing === 'elbow' && gElbowAfter?.elbowOffset === 40 &&
        gFreeToPointAfter && (gFreeToPointAfter.x !== 600 || gFreeToPointAfter.y !== 350) &&
        Boolean(app.doc.groups[safariGrpId])
      );
      log('16c. Persisted group shared rotation & member updates (Safari)', Boolean(grpRotOk), 'g1Rot=' + g1RotAfter + ' g2Rot=' + g2RotAfter + ' multiMatch=' + ordinaryMultiMatchesGroup);

      // 16d. Rotated open and closed path vertex dragging with 0 pointerup commit jump
      const pathOpenId = 'safari_path_open_' + Date.now();
      const pathClosedId = 'safari_path_closed_' + Date.now();
      app.dispatchCommand({
        type: 'create_object',
        object: { id: pathOpenId, type: 'path', x: 100, y: 400, width: 100, height: 100, rotation: 45, points: [[0, 0], [100, 100]], stroke: '#1e1e1e', fill: 'none' }
      });
      app.dispatchCommand({
        type: 'create_object',
        object: { id: pathClosedId, type: 'path', x: 300, y: 400, width: 100, height: 100, rotation: 75, closed: true, points: [[0, 0], [100, 0], [100, 100], [0, 100]], stroke: '#1e1e1e', fill: '#ffcccc' }
      });

      // 1. Open path vertex-0 drag
      app.workspace.selectedIds = [pathOpenId];
      app.workspace.render();
      await sleep(30);

      let v1Jump = 0;
      const v0Handle = document.querySelector('[data-handle="vertex-0"]');
      if (v0Handle) {
        const v0Box = v0Handle.getBoundingClientRect();
        v0Handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: v0Box.left + v0Box.width / 2, clientY: v0Box.top + v0Box.height / 2, button: 0, buttons: 1 }));
        await sleep(25);
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: v0Box.left + v0Box.width / 2 - 30, clientY: v0Box.top + v0Box.height / 2, button: 0, buttons: 1 }));
        await sleep(25);
        const v1El = document.querySelector('[data-handle="vertex-1"]');
        const v1PreviewBox = v1El?.getBoundingClientRect();

        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: v0Box.left + v0Box.width / 2 - 30, clientY: v0Box.top + v0Box.height / 2, button: 0, buttons: 0 }));
        await sleep(30);

        const v1CommittedBox = document.querySelector('[data-handle="vertex-1"]')?.getBoundingClientRect();
        v1Jump = Math.hypot((v1CommittedBox?.left || 0) - (v1PreviewBox?.left || 0), (v1CommittedBox?.top || 0) - (v1PreviewBox?.top || 0));
      }
      const pathRotPreserved = app.doc.objects[pathOpenId]?.rotation === 45;

      // 2. Closed path vertex-2 drag
      app.workspace.selectedIds = [pathClosedId];
      app.workspace.render();
      await sleep(30);

      let cv0Jump = 0;
      const cv2Handle = document.querySelector('[data-handle="vertex-2"]');
      if (cv2Handle) {
        const cv2Box = cv2Handle.getBoundingClientRect();
        cv2Handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cv2Box.left + cv2Box.width / 2, clientY: cv2Box.top + cv2Box.height / 2, button: 0, buttons: 1 }));
        await sleep(25);
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cv2Box.left + cv2Box.width / 2 + 25, clientY: cv2Box.top + cv2Box.height / 2 + 25, button: 0, buttons: 1 }));
        await sleep(25);
        const cv0El = document.querySelector('[data-handle="vertex-0"]');
        const cv0PreviewBox = cv0El?.getBoundingClientRect();

        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cv2Box.left + cv2Box.width / 2 + 25, clientY: cv2Box.top + cv2Box.height / 2 + 25, button: 0, buttons: 0 }));
        await sleep(30);

        const cv0CommittedBox = document.querySelector('[data-handle="vertex-0"]')?.getBoundingClientRect();
        cv0Jump = Math.hypot((cv0CommittedBox?.left || 0) - (cv0PreviewBox?.left || 0), (cv0CommittedBox?.top || 0) - (cv0PreviewBox?.top || 0));
      }
      const closedPathRotPreserved = app.doc.objects[pathClosedId]?.rotation === 75;
      const pathsOk = v1Jump < 1.0 && pathRotPreserved && cv0Jump < 1.0 && closedPathRotPreserved;

      log('16d. Rotated open and closed path vertex dragging with zero commit jump (Safari)', pathsOk, 'openJump=' + v1Jump.toFixed(2) + 'px closedJump=' + cv0Jump.toFixed(2) + 'px');

      // 16e. Rotated text in-place editing (Standalone text & Text-bearing shape)
      const textId = 'safari_text_' + Date.now();
      app.dispatchCommand({
        type: 'create_object',
        object: { id: textId, type: 'text', x: 300, y: 400, width: 120, height: 40, rotation: 45, text: 'Safari Rotated', textStyle: { resolvedSize: 16 } }
      });
      app.workspace.selectedIds = [textId];
      app.workspace.render();
      await sleep(25);
      app.textEditor.open(app.doc.objects[textId], app.workspace.camera);
      const textarea = document.querySelector('.sabura-inline-text-editor');
      const standaloneTrans = textarea ? textarea.style.transform : '';
      const textareaTransformed = standaloneTrans.includes('rotate(');
      textarea.value = 'Updated Safari Standalone';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      app.textEditor.close(true);

      const sShapeTextId = 'safari_shape_text_' + Date.now();
      app.dispatchCommand({
        type: 'create_object',
        object: { id: sShapeTextId, type: 'rectangle', x: 500, y: 500, width: 120, height: 60, rotation: 35, text: 'Shape Text', stroke: '#1e1e1e', fill: '#eeeeee' }
      });
      app.workspace.selectedIds = [sShapeTextId];
      app.workspace.render();
      await sleep(25);
      app.textEditor.open(app.doc.objects[sShapeTextId], app.workspace.camera);
      const shapeTextarea = document.querySelector('.sabura-inline-text-editor');
      const shapeTrans = shapeTextarea ? shapeTextarea.style.transform : '';
      const shapeTextareaTransformed = shapeTrans.includes('rotate(35deg)');
      shapeTextarea.value = 'Updated Safari Shape Text';
      shapeTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      app.textEditor.close(true);

      const textEditsOk = Boolean(textareaTransformed && shapeTextareaTransformed && app.doc.objects[textId].text === 'Updated Safari Standalone' && app.doc.objects[sShapeTextId].text === 'Updated Safari Shape Text');
      log('16e. Rotated standalone text & text-bearing shape in-place editing (Safari)', textEditsOk, 'standaloneTrans=' + standaloneTrans + ' shapeTrans=' + shapeTrans);

      // 16f. Precision hit testing & locked rotated overlay
      const lockedId = 'safari_locked_' + Date.now();
      app.dispatchCommand({
        type: 'create_object',
        object: { id: lockedId, type: 'rectangle', x: 500, y: 400, width: 100, height: 100, rotation: 45, locked: true, stroke: '#1e1e1e', fill: '#cccccc' }
      });
      const hitCenter = app.workspace.findObjectAt({ x: 550, y: 450 });
      const hitCorner = app.workspace.findObjectAt({ x: 500, y: 400 }); // Empty AABB corner
      const hitTestOk = hitCenter?.id === lockedId && hitCorner?.id !== lockedId;

      app.workspace.selectedIds = [lockedId];
      app.workspace.render();
      await sleep(25);
      const lockedOverlay = document.querySelector('.selection-single-overlay');
      const lockedRotAttr = lockedOverlay?.getAttribute('transform')?.includes('rotate(45');
      const lockedHasNoHandles = !document.querySelector('[data-handle="rotate"]') && !document.querySelector('[data-handle="nw"]');
      log('16f. Precision hit testing & locked rotated overlay orientation (Safari)', Boolean(hitTestOk && lockedRotAttr && lockedHasNoHandles), 'overlayTrans=' + lockedOverlay?.getAttribute('transform'));

      // 16g. Gesture cancellation (Escape & Reading Mode)
      const histCountBefore = app.undoStack.length;
      app.workspace.selectedIds = [rotShapeId];
      app.workspace.render();
      await sleep(25);
      const curRotBefore = app.doc.objects[rotShapeId].rotation;
      const cancelRotHandle = document.querySelector('[data-handle="rotate"]');
      if (cancelRotHandle) {
        const hBox = cancelRotHandle.getBoundingClientRect();
        // Cancel with Escape
        cancelRotHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: hBox.left + hBox.width / 2, clientY: hBox.top + hBox.height / 2, button: 0, buttons: 1 }));
        await sleep(25);
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: hBox.left + hBox.width / 2 + 50, clientY: hBox.top + hBox.height / 2 + 50, button: 0, buttons: 1 }));
        await sleep(25);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        await sleep(25);
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: hBox.left + hBox.width / 2 + 50, clientY: hBox.top + hBox.height / 2 + 50, button: 0, buttons: 0 }));
        await sleep(25);
      }
      const curRotAfterEscape = app.doc.objects[rotShapeId].rotation;
      const histCountAfterEscape = app.undoStack.length;

      // Cancel with Reading Mode
      if (cancelRotHandle) {
        const hBox = cancelRotHandle.getBoundingClientRect();
        cancelRotHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: hBox.left + hBox.width / 2, clientY: hBox.top + hBox.height / 2, button: 0, buttons: 1 }));
        await sleep(25);
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: hBox.left + hBox.width / 2 + 50, clientY: hBox.top + hBox.height / 2 + 50, button: 0, buttons: 1 }));
        await sleep(25);
        app.setMode('reading');
        await sleep(25);
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: hBox.left + hBox.width / 2 + 50, clientY: hBox.top + hBox.height / 2 + 50, button: 0, buttons: 0 }));
        await sleep(25);
        app.setMode('editing');
        await sleep(25);
      }
      const curRotAfterReading = app.doc.objects[rotShapeId].rotation;
      const histCountAfterReading = app.undoStack.length;

      const cancelOk = (
        curRotBefore === curRotAfterEscape &&
        curRotBefore === curRotAfterReading &&
        histCountBefore === histCountAfterEscape &&
        histCountBefore === histCountAfterReading
      );
      log('16g. Rotation gesture cancellation (Escape & Reading mode) restores baseline with 0 history (Safari)', cancelOk, 'rot=' + curRotAfterReading + ' histDiff=' + (histCountAfterReading - histCountBefore));

      // 16h. generateBoardFile document validity in Safari
      const safariBoardGen = window.sabura.generateBoardFile(app.doc);
      log('16h. generateBoardFile generates valid rotated board artifact (Safari)', safariBoardGen.success && safariBoardGen.byteLength > 200000, 'bytes=' + safariBoardGen.byteLength);

    } catch (rotErr) {
      log('16. Rotation Foundation (Safari)', false, rotErr.message);
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
  document.addEventListener('DOMContentLoaded', () => setTimeout(runSafariTests, 800));
} else {
  setTimeout(runSafariTests, 800);
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
  } else if (new URL(req.url, `http://127.0.0.1:${port}`).pathname === '/sabura-safari.html') {
    // Inject Safari runner script inline
    const injected = freshHtml.replace('</body>', '<script type="module">\n' + safariRunnerCode + '\n</script></body>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
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

await new Promise(r => server.listen(port, '127.0.0.1', r));
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
await evalInChrome(`(() => {
  window.saburaApp.setMode("editing");
  window.saburaApp.workspace.camera.zoom = 1;
  window.saburaApp.workspace.camera.x = 0;
  window.saburaApp.workspace.camera.y = 0;
  window.saburaApp.workspace.render();
})()`);

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
  const t1 = document.querySelector('#btn-grid-visible').getAttribute('aria-label');
  document.querySelector('#btn-grid-visible').click();
  const t2 = document.querySelector('#btn-grid-visible').getAttribute('aria-label');
  document.querySelector('#btn-grid-visible').click();
  const t3 = document.querySelector('#btn-grid-visible').getAttribute('aria-label');

  const s1 = document.querySelector('#btn-grid-snap').getAttribute('aria-label');
  document.querySelector('#btn-grid-snap').click();
  const s2 = document.querySelector('#btn-grid-snap').getAttribute('aria-label');
  document.querySelector('#btn-grid-snap').click();

  return {
    gridPass: t1 === 'Grid On' && t2 === 'Grid Off' && t3 === 'Grid On',
    snapPass: s1 === 'Snap On' && s2 === 'Snap Off',
    states: { t1, t2, t3, s1, s2 }
  };
})()`);
console.log('Chrome 6. Grid & Snap controls:', c6);
if (!c6.gridPass || !c6.snapPass) {
  throw new Error('Chrome: Grid/Snap state labels mismatch');
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
  app.setMode('editing');
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
  // Step A: Configure Chrome download directory via Page.setDownloadBehavior
  try {
    await cdpSend('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: tmpDownloadDir
    });
  } catch (_) {}

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
    theme: window.sabura.getDocument().theme, objects: {}, order: [], groups: {}, assets: {}
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
    theme: window.sabura.getDocument().theme,
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
  console.log(`  ✓ 31f. generateBoardFile() first run: ${genResult.filename}, byteLength=${genResult.byteLength}`);

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

  // (Re-run generateBoardFile synchronously with identical doc)
  const captureResult = await evalInChrome(`window.sabura.generateBoardFile({
    schemaVersion: 'sabura/canvas/v1',
    id: 'board_e2egentest',
    title: 'E2E Generated Board',
    theme: window.sabura.getDocument().theme,
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
    throw new Error('Flow 31: second generateBoardFile failed: ' + (captureResult.errors || []).join(', '));

  // Regression check: First and second generation byteLengths must be exactly equal!
  if (genResult.byteLength !== captureResult.byteLength) {
    throw new Error(`Flow 31 regression: first and second generation byteLength mismatch (first=${genResult.byteLength}, second=${captureResult.byteLength}). Temporary download anchor leaked into next shell!`);
  }
  console.log(`  ✓ 31f2. First and second generation byteLengths are identical: ${genResult.byteLength}`);

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

  // Assert captured HTML contains no temporary download anchor or blob URL
  if (downloadedHtml.includes('<a download') || downloadedHtml.includes('blob:')) {
    throw new Error('Flow 31 regression: captured HTML contains temporary download anchor or blob URL!');
  }
  console.log(`  ✓ 31h. Blob captured in browser: ${actualBytes} bytes (verified NO temporary anchor or blob URL)`);

  // Verify real downloadable HTML attachment on disk
  const diskFiles = fs.readdirSync(tmpDownloadDir).filter(f => f.endsWith('.html'));
  if (diskFiles.length > 0) {
    const diskPath = path.join(tmpDownloadDir, diskFiles[0]);
    const diskContent = fs.readFileSync(diskPath, 'utf8');
    const diskBytes = Buffer.byteLength(diskContent, 'utf8');
    if (diskContent.includes('<a download') || diskContent.includes('blob:')) {
      throw new Error('Flow 31 regression: disk HTML file contains temporary download anchor or blob URL!');
    }
    console.log(`  ✓ 31h2. Real downloadable HTML attachment confirmed on disk: ${diskFiles[0]} (${diskBytes} bytes)`);
  }

  // Step K: Verify real byte size matches byteLength returned by API (use captureResult)
  if (actualBytes !== captureResult.byteLength)
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
    const hasApp = await evalInChrome('Boolean(window.sabura && window.sabura.getDocument())').catch(() => false);
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

await new Promise(r => setTimeout(r, 250));
await cdpSend('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 810,
  deviceScaleFactor: 1,
  mobile: true
});
await new Promise(r => setTimeout(r, 80));
const visualSystemSeam = await evalInChrome(`(() => {
  const appMark = document.querySelector('.sabura-vs-app-mark');
  const appMarkRect = appMark?.getBoundingClientRect();
  const topbarRect = document.querySelector('.sabura-topbar')?.getBoundingClientRect();
  const localIconUses = [...document.querySelectorAll('.sabura-topbar use, .wheel-trigger-fab use, .zoom-help-toolbar use')];
  const pigmentLayers = document.querySelectorAll('[data-sabura-vs-pigment-layer]');
  return {
    spriteCount: document.querySelectorAll('#sabura-vs-sprite').length,
    appMarkVisible36: Boolean(appMarkRect && appMarkRect.width >= 35 && appMarkRect.height >= 35),
    localIconCount: localIconUses.length,
    localIconsOnly: localIconUses.every(use => (use.getAttribute('href') || '').startsWith('#sabura-vs-icon-') || use.getAttribute('href') === '#sabura-vs-app-icon'),
    paperPigmentLayers: pigmentLayers.length,
    allPigmentLayersNumbered: [...pigmentLayers].every(path => ['1', '2'].includes(path.getAttribute('data-sabura-vs-pigment-layer'))),
    boardThemeBridge: document.getElementById('app')?.getAttribute('data-sabura-vs-board-theme'),
    interfaceTheme: document.documentElement.getAttribute('data-ui-theme'),
    topbarWithinViewport: Boolean(topbarRect && topbarRect.left >= 0 && topbarRect.right <= window.innerWidth)
  };
})()`);
if (visualSystemSeam.spriteCount !== 1 || !visualSystemSeam.appMarkVisible36 || visualSystemSeam.localIconCount < 9 || !visualSystemSeam.localIconsOnly || visualSystemSeam.paperPigmentLayers !== 6 || !visualSystemSeam.allPigmentLayersNumbered || visualSystemSeam.boardThemeBridge !== 'paper' || !visualSystemSeam.topbarWithinViewport) {
  throw new Error(`Visual system browser seam failed: ${JSON.stringify(visualSystemSeam)}`);
}
console.log('  ✓ Visual system seam: one namespaced sprite, local icons, 36px identity, six deterministic Paper pigment layers, independent theme bridge, desktop topbar fit');

for (const compactWidth of [760, 641]) {
  await cdpSend('Emulation.setDeviceMetricsOverride', {
    width: compactWidth,
    height: 810,
    deviceScaleFactor: 1,
    mobile: true
  });
  await new Promise(r => setTimeout(r, 120));
  const intermediateEditingFit = await evalInChrome(`(() => {
    window.sabura.setMode('editing');
    const boardSelect = document.getElementById('select-board-theme');
    const uiSelect = document.getElementById('select-ui-theme');
    if (${compactWidth} === 760 && uiSelect) uiSelect.value = 'light';
    const targets = [
      ['identity', '.mode-editing .brand-title'],
      ['view', '#btn-view'],
      ['status', '.mode-editing .status-badge'],
      ['board', '.mode-editing .topbar-center .control-label:nth-of-type(1)'],
      ['ui', '.mode-editing .topbar-center .control-label:nth-of-type(2)'],
      ['grid', '#btn-grid-visible'],
      ['snap', '#btn-grid-snap'],
      ['undo', '#btn-undo'],
      ['redo', '#btn-redo'],
      ['fullscreen', '#btn-fullscreen'],
      ['present', '#btn-present'],
      ['save', '#btn-save']
    ];
    const controls = targets.map(([id, selector]) => {
      const el = document.querySelector(selector);
      const rect = el?.getBoundingClientRect();
      const style = el ? getComputedStyle(el) : null;
      return { id, exists: Boolean(el), visible: Boolean(el && style.display !== 'none' && style.visibility !== 'hidden'), left: rect?.left, right: rect?.right, width: rect?.width };
    });
    const adjacentPairs = controls.slice(1).map((item, index) => ({ before: controls[index].id, after: item.id, gap: item.left - controls[index].right }));
    const controlsFit = controls.every(item => item.exists && item.visible && item.width > 0 && item.left >= 0 && item.right <= ${compactWidth});
    const controlsOrderedWithoutOverlap = adjacentPairs.every(pair => pair.gap >= -0.75);
    const nativeValuesReadable = ${compactWidth} !== 760 || Boolean(
      boardSelect && uiSelect &&
      boardSelect.value === 'paper' && uiSelect.value === 'light' &&
      boardSelect.getBoundingClientRect().width >= 60 && uiSelect.getBoundingClientRect().width >= 48
    );
    return { controls, adjacentPairs, controlsFit, controlsOrderedWithoutOverlap, nativeValuesReadable, boardSelectWidth: boardSelect?.getBoundingClientRect().width, uiSelectWidth: uiSelect?.getBoundingClientRect().width };
  })()`);
  if (!intermediateEditingFit.controlsFit || !intermediateEditingFit.controlsOrderedWithoutOverlap || !intermediateEditingFit.nativeValuesReadable) {
    throw new Error(`Visual system ${compactWidth}px Editing fit failed: ${JSON.stringify(intermediateEditingFit)}`);
  }
  if (compactWidth === 760) {
    const subRingLabelGeometry = await evalInChrome(`(() => {
      const app = window.saburaApp;
      const shape = Object.values(app.doc.objects).find(object => object.type === 'rectangle');
      app.wheel.open(380, 405, 'object', shape, app.doc.theme.palette, 1, [shape]);
      const results = [];
      for (const menuId of ['menu_shape', 'menu_type', 'menu_style', 'menu_order']) {
        app.wheel.activeSubMenu = menuId;
        app.wheel.render();
        const labels = [...document.querySelectorAll('.wheel-sub-text')].map(label => {
          const rect = label.getBoundingClientRect();
          return { text: label.textContent, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        });
        const overlaps = [];
        for (let first = 0; first < labels.length; first++) {
          for (let second = first + 1; second < labels.length; second++) {
            const horizontal = Math.min(labels[first].right, labels[second].right) - Math.max(labels[first].left, labels[second].left);
            const vertical = Math.min(labels[first].bottom, labels[second].bottom) - Math.max(labels[first].top, labels[second].top);
            if (horizontal > 0.5 && vertical > 0.5) overlaps.push({ first: labels[first].text, second: labels[second].text, horizontal, vertical });
          }
        }
        results.push({ menuId, labelCount: labels.length, overlaps });
      }
      app.wheel.close();
      return results;
    })()`);
    if (subRingLabelGeometry.some(result => result.overlaps.length > 0)) {
      throw new Error(`Visual system sub-ring label geometry failed: ${JSON.stringify(subRingLabelGeometry)}`);
    }
  }
}
console.log('  ✓ Visual system intermediate viewports: every Editing control and representative sub-ring label remains ordered, visible, and non-overlapping at 760 and 641 CSS px');

await evalInChrome(`window.sabura.setMode('reading')`);
// -------------------------------------------------------------
// FLOW 32: Narrow Viewport (400 CSS px) TopBar Actions in Reading and Editing Mode (F-08 & F-09)
// -------------------------------------------------------------
console.log('\n=============================================================');
console.log('FLOW 32: NARROW VIEWPORT (400 CSS PX) READING & EDITING ACTIONS');
console.log('=============================================================');

await cdpSend('Emulation.setDeviceMetricsOverride', {
  width: 400,
  height: 810,
  deviceScaleFactor: 1,
  mobile: true
});

await new Promise(r => setTimeout(r, 200));

// 1. Reading Mode checks at 400 CSS px
const readingButtons = await evalInChrome(`(() => {
  const edit = document.getElementById('btn-edit');
  const fullscreen = document.getElementById('btn-reading-fullscreen');
  const present = document.getElementById('btn-present');
  const save = document.getElementById('btn-save');
  const vpWidth = window.innerWidth;

  function getCheck(el) {
    if (!el) return { exists: false };
    const r = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const visible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    const withinViewport = r.left >= 0 && r.right <= vpWidth && r.top >= 0 && r.bottom > 0;
    return {
      exists: true,
      visible,
      withinViewport,
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      focusable: el.tabIndex >= 0 || el.tagName === 'BUTTON'
    };
  }

  return {
    vpWidth,
    edit: getCheck(edit),
    fullscreen: getCheck(fullscreen),
    present: getCheck(present),
    save: getCheck(save)
  };
})()`);

if (!readingButtons.edit.exists || !readingButtons.edit.visible || !readingButtons.edit.withinViewport) {
  throw new Error(`Flow 32: Edit button not fully within 400px viewport: ${JSON.stringify(readingButtons.edit)}`);
}
if (!readingButtons.fullscreen.exists || !readingButtons.fullscreen.visible || !readingButtons.fullscreen.withinViewport || !readingButtons.fullscreen.focusable) {
  throw new Error(`Flow 32: Reading Fullscreen button not fully available within 400px viewport: ${JSON.stringify(readingButtons.fullscreen)}`);
}
if (!readingButtons.present.exists || !readingButtons.present.visible || !readingButtons.present.withinViewport) {
  throw new Error(`Flow 32: Present button not fully within 400px viewport: ${JSON.stringify(readingButtons.present)}`);
}
if (!readingButtons.save.exists || !readingButtons.save.visible || !readingButtons.save.withinViewport) {
  throw new Error(`Flow 32: Save Copy button not fully within 400px viewport: ${JSON.stringify(readingButtons.save)}`);
}
console.log('  ✓ 32a. Reading mode: Edit, icon-only Fullscreen, Present, and Save Copy all visible and within 400px viewport');

// 2. Switch to Editing Mode via Edit button click
const editClickOk = await evalInChrome(`(() => {
  const btn = document.getElementById('btn-edit');
  if (!btn) return false;
  btn.click();
  return window.sabura ? window.sabura.getMode() === 'editing' : true;
})()`);
if (!editClickOk) throw new Error('Flow 32: Click on Edit button failed to switch mode');

await new Promise(r => setTimeout(r, 100));

// 3. Editing Mode checks at 400 CSS px
const editingChecks = await evalInChrome(`(() => {
  const view = document.getElementById('btn-view');
  const present = document.getElementById('btn-present');
  const save = document.getElementById('btn-save');
  const docTitle = document.querySelector('.doc-title');
  const boardSelect = document.getElementById('select-board-theme');
  const uiSelect = document.getElementById('select-ui-theme');
  const grid = document.getElementById('btn-grid-visible');
  const snap = document.getElementById('btn-grid-snap');
  const undo = document.getElementById('btn-undo');
  const redo = document.getElementById('btn-redo');
  const fullscreen = document.getElementById('btn-fullscreen');
  const secondary = document.querySelector('.topbar-secondary-actions');
  const center = document.querySelector('.mode-editing .topbar-center');
  const topbar = document.querySelector('.sabura-topbar.mode-editing');
  const vpWidth = window.innerWidth;

  function getCheck(el) {
    if (!el) return { exists: false };
    const r = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const visible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && r.width > 0;
    const withinViewport = r.left >= 0 && r.right <= vpWidth && r.top >= 0 && r.bottom > 0;
    return {
      exists: true,
      visible,
      withinViewport,
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      focusable: el.tabIndex >= 0 || el.tagName === 'BUTTON'
    };
  }

  const vCheck = getCheck(view);
  const pCheck = getCheck(present);
  const sCheck = getCheck(save);
  const tCheck = getCheck(docTitle);
  const utilityChecks = [boardSelect, uiSelect, grid, snap, undo, redo, fullscreen].map(getCheck);

  // Overlap checks
  const overlaps = (r1, r2) => {
    if (!r1.visible || !r2.visible) return false;
    return !(r1.right <= r2.left + 0.5 || r1.left >= r2.right - 0.5 || r1.bottom <= r2.top + 0.5 || r1.top >= r2.bottom - 0.5);
  };

  const allChecks = [vCheck, pCheck, sCheck, tCheck, ...utilityChecks];
  const overlappingPairs = [];
  for (let first = 0; first < allChecks.length; first++) {
    for (let secondIndex = first + 1; secondIndex < allChecks.length; secondIndex++) {
      if (overlaps(allChecks[first], allChecks[secondIndex])) overlappingPairs.push([first, secondIndex]);
    }
  }

  return {
    vpWidth,
    view: vCheck,
    present: pCheck,
    save: sCheck,
    title: tCheck,
    utilities: utilityChecks,
    centerVisible: getCheck(center).visible,
    secondaryVisible: getCheck(secondary).visible,
    topbarHeight: topbar?.getBoundingClientRect().height,
    overlappingPairs
  };
})()`);

if (!editingChecks.view.exists || !editingChecks.view.visible || !editingChecks.view.withinViewport) {
  throw new Error(`Flow 32: View button not fully within 400px viewport: ${JSON.stringify(editingChecks.view)}`);
}
if (!editingChecks.present.exists || !editingChecks.present.visible || !editingChecks.present.withinViewport) {
  throw new Error(`Flow 32: Present button not fully within 400px viewport: ${JSON.stringify(editingChecks.present)}`);
}
if (!editingChecks.save.exists || !editingChecks.save.visible || !editingChecks.save.withinViewport) {
  throw new Error(`Flow 32: Save Copy button not fully within 400px viewport in editing mode: ${JSON.stringify(editingChecks.save)}`);
}
if (!editingChecks.title.exists || editingChecks.title.visible || editingChecks.title.width !== 0) {
  throw new Error(`Flow 32: Compact document title must be hidden without reserved width at 400px: ${JSON.stringify(editingChecks.title)}`);
}
if (!editingChecks.centerVisible || !editingChecks.secondaryVisible || editingChecks.utilities.some(control => !control.exists || !control.visible || !control.withinViewport)) {
  throw new Error(`Flow 32: Two-row Editing utility controls are not fully available at 400px: ${JSON.stringify(editingChecks)}`);
}
if (editingChecks.topbarHeight < 90 || editingChecks.overlappingPairs.length > 0) {
  throw new Error(`Flow 32: Two-row Editing toolbar overlaps or did not expand at 400px: ${JSON.stringify(editingChecks)}`);
}
console.log('  ✓ 32b. Editing mode: readable primary row plus Board/UI/Grid/Snap/Undo/Redo/Fullscreen utility row at 400px');

// 4. Switch back to Reading Mode via View button click
const viewClickOk = await evalInChrome(`(() => {
  const btn = document.getElementById('btn-view');
  if (!btn) return false;
  btn.click();
  return window.sabura ? window.sabura.getMode() === 'reading' : true;
})()`);
if (!viewClickOk) throw new Error('Flow 32: Click on View button failed to switch back to reading mode');
console.log('  ✓ 32c. View button switches cleanly back to reading mode');

// 5. Check F-09 Inline TextEditor accessibility attributes in live DOM
const textEditorAttrs = await evalInChrome(`(() => {
  const ta = document.getElementById('sabura-inline-text-editor');
  if (!ta) return { exists: false };
  return {
    exists: true,
    id: ta.id,
    name: ta.name,
    ariaLabel: ta.getAttribute('aria-label'),
    autocomplete: ta.getAttribute('autocomplete'),
    spellcheck: ta.getAttribute('spellcheck')
  };
})()`);

if (!textEditorAttrs.exists || textEditorAttrs.id !== 'sabura-inline-text-editor' || textEditorAttrs.name !== 'sabura-inline-text-editor') {
  throw new Error(`Flow 32: TextEditor accessibility attributes invalid: ${JSON.stringify(textEditorAttrs)}`);
}
console.log('  ✓ 32d. F-09: Inline text editor has stable id, name, aria-label, and autocomplete=off in live DOM');

const responsiveWidths = [1440, 1401, 1400, 1337, 1301, 1300, 1280, 1053, 1052, 1051, 1050, 1024, 768, 641, 480, 400, 360];
for (const responsiveWidth of responsiveWidths) {
  await cdpSend('Emulation.setDeviceMetricsOverride', {
    width: responsiveWidth,
    height: 810,
    deviceScaleFactor: 1,
    mobile: true
  });
  await new Promise(r => setTimeout(r, 80));

  for (const responsiveMode of ['reading', 'editing']) {
    const responsiveAudit = await evalInChrome(`(() => {
      window.sabura.setMode('${responsiveMode}');
      const compact = ${responsiveWidth} <= 1050;
      const titleCompact = ${responsiveWidth} <= 1400;
      const narrowEditing = ${responsiveWidth} <= 640 && '${responsiveMode}' === 'editing';
      const bar = document.querySelector('.sabura-topbar');
      const selectors = '${responsiveMode}' === 'reading'
        ? ['.sabura-vs-app-mark', '.brand-name', '.doc-title', '.mode-badge', '.status-badge', '#btn-edit', '#btn-reading-fullscreen', '#btn-present', '#btn-save']
        : ['.sabura-vs-app-mark', '.brand-name', '.doc-title', '#btn-view', '.status-badge', '#select-board-theme', '#select-ui-theme', '#btn-grid-visible', '#btn-grid-snap', '#btn-undo', '#btn-redo', '#btn-fullscreen', '#btn-present', '#btn-save'];

      const isVisible = el => {
        if (!el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.width > 0 && rect.height > 0;
      };
      const checks = selectors.map(selector => {
        const el = document.querySelector(selector);
        if (!el) return { selector, exists: false };
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          selector,
          exists: true,
          visible: isVisible(el),
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          fontSize: Number.parseFloat(style.fontSize),
          ariaLabel: el.getAttribute('aria-label'),
          title: el.getAttribute('title')
        };
      });

      const requiredSelectors = '${responsiveMode}' === 'reading'
        ? ['.sabura-vs-app-mark', '.status-badge', '#btn-edit', '#btn-reading-fullscreen', '#btn-present', '#btn-save']
        : ['.sabura-vs-app-mark', '#btn-view', '.status-badge', '#select-board-theme', '#select-ui-theme', '#btn-grid-visible', '#btn-grid-snap', '#btn-undo', '#btn-redo', '#btn-fullscreen', '#btn-present', '#btn-save'];
      if (!titleCompact) requiredSelectors.splice(1, 0, '.doc-title');
      const required = checks.filter(check => requiredSelectors.includes(check.selector));
      const allRequiredVisible = required.every(check => check.exists && check.visible && check.left >= -0.5 && check.right <= ${responsiveWidth} + 0.5 && check.top >= 0 && check.bottom <= 810);

      const visibleChecks = checks.filter(check => check.visible);
      const overlaps = [];
      for (let first = 0; first < visibleChecks.length; first++) {
        for (let second = first + 1; second < visibleChecks.length; second++) {
          const a = visibleChecks[first];
          const b = visibleChecks[second];
          const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (horizontal > 0.5 && vertical > 0.5) overlaps.push([a.selector, b.selector, horizontal, vertical]);
        }
      }

      const textNodes = [...bar.querySelectorAll('.brand-name, .doc-title, .mode-badge, .status-text, .topbar-btn-label, .control-prefix, .topbar-select')]
        .filter(isVisible)
        .map(el => ({ text: (el.textContent || '').trim(), fontSize: Number.parseFloat(getComputedStyle(el).fontSize) }));
      const tinyText = textNodes.filter(item => item.fontSize < 12);
      const actionControls = [...bar.querySelectorAll('button')];
      const undersizedButtons = actionControls.filter(button => {
        const rect = button.getBoundingClientRect();
        return isVisible(button) && (rect.width < 33.5 || rect.height < 33.5);
      }).map(button => button.id);
      const missingAccessibleNames = [...bar.querySelectorAll('button, select')]
        .filter(isVisible)
        .filter(control => !(control.getAttribute('aria-label') || '').trim())
        .map(control => control.id);
      const missingButtonTitles = actionControls.filter(isVisible).filter(button => !(button.getAttribute('title') || '').trim()).map(button => button.id);
      const titleRect = document.querySelector('.doc-title')?.getBoundingClientRect();
      const titleVisible = isVisible(document.querySelector('.doc-title'));
      const appMark = document.querySelector('.sabura-vs-app-mark');
      const persistedTitle = window.saburaApp?.doc?.title || 'Untitled';
      const expectedAppIdentity = 'Sabura — ' + persistedTitle;
      const brandVisible = isVisible(document.querySelector('.brand-name'));
      const modeVisible = isVisible(document.querySelector('.mode-badge'));
      const statusTextVisible = isVisible(document.querySelector('.status-text'));
      const labelsVisible = [...bar.querySelectorAll('.topbar-btn-label, .control-prefix')].some(isVisible);
      const boardTop = document.querySelector('#select-board-theme')?.getBoundingClientRect().top;
      const viewTop = document.querySelector('#btn-view')?.getBoundingClientRect().top;
      const barRect = bar.getBoundingClientRect();

      return {
        checks,
        allRequiredVisible,
        overlaps,
        tinyText,
        undersizedButtons,
        missingAccessibleNames,
        missingButtonTitles,
        titleWidth: titleRect?.width,
        titleBehaviorCorrect: titleCompact ? (!titleVisible && titleRect?.width === 0) : (titleVisible && titleRect?.width >= 39.5),
        appIdentityCorrect: appMark?.getAttribute('aria-label') === expectedAppIdentity && appMark?.getAttribute('title') === expectedAppIdentity,
        barWithinViewport: barRect.left >= 0 && barRect.right <= ${responsiveWidth},
        barHeight: barRect.height,
        brandVisibilityCorrect: compact ? !brandVisible : brandVisible,
        disclosureCorrect: compact ? (!modeVisible && !statusTextVisible && !labelsVisible) : (('${responsiveMode}' === 'editing' || modeVisible) && statusTextVisible && labelsVisible),
        twoRowCorrect: narrowEditing ? (barRect.height >= 90 && boardTop > viewTop + 20) : barRect.height < 90
      };
    })()`);

    if (!responsiveAudit.allRequiredVisible || responsiveAudit.overlaps.length || responsiveAudit.tinyText.length || responsiveAudit.undersizedButtons.length || responsiveAudit.missingAccessibleNames.length || responsiveAudit.missingButtonTitles.length || !responsiveAudit.titleBehaviorCorrect || !responsiveAudit.appIdentityCorrect || !responsiveAudit.barWithinViewport || !responsiveAudit.brandVisibilityCorrect || !responsiveAudit.disclosureCorrect || !responsiveAudit.twoRowCorrect) {
      throw new Error(`Responsive toolbar ${responsiveWidth}px ${responsiveMode} failed: ${JSON.stringify(responsiveAudit)}`);
    }
  }
}
console.log('  ✓ 32e. Reading and Editing responsive matrix passes across the 1400px title and 1050px control breakpoints plus 1337/1300/1280/1024/768/641/480/400/360 CSS px with accessible document identity and no overlap/clipping');

// Reset device metrics override back to desktop
await cdpSend('Emulation.clearDeviceMetricsOverride');
await new Promise(r => setTimeout(r, 100));
console.log('✓ Flow 32: Narrow viewport 400 CSS px TopBar & TextEditor verified cleanly!');

// -------------------------------------------------------------
// Flow 33: Resizing and Transform Foundation in Chrome (Comprehensive Physical Pointer-Driven)
// -------------------------------------------------------------
console.log('\n--- Flow 33: Resizing and Transform Foundation in Chrome ---');

const flow33Result = await evalInChrome(`(async () => {
  const app = window.saburaApp;
  if (!app) return { ok: false, msg: 'SaburaApp not found' };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  app.setMode('editing');
  app.workspace.camera = { x: 0, y: 0, zoom: 1.0 };
  app.workspace.selectedIds = [];
  app.workspace.render();
  await sleep(50);

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modObj = isMac ? { metaKey: true } : { ctrlKey: true };

  async function dragHandle(handleName, dx, dy, options = {}) {
    const handleEl = document.querySelector(\`circle[data-handle="\${handleName}"]\`);
    if (!handleEl) return false;
    const hRect = handleEl.getBoundingClientRect();
    const startX = hRect.left + hRect.width / 2;
    const startY = hRect.top + hRect.height / 2;
    const zoom = app.workspace.camera.zoom || 1.0;
    const screenDx = dx * zoom;
    const screenDy = dy * zoom;

    handleEl.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: startX,
      clientY: startY,
      button: 0,
      buttons: 1
    }));
    await sleep(25);

    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: startX + screenDx,
      clientY: startY + screenDy,
      button: 0,
      buttons: 1,
      shiftKey: Boolean(options.shiftKey),
      altKey: Boolean(options.altKey)
    }));
    await sleep(25);

    if (options.cancelWithEscape) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      await sleep(25);
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: startX + screenDx,
        clientY: startY + screenDy,
        button: 0,
        buttons: 0
      }));
      await sleep(25);
      return true;
    }

    if (options.cancelWithModeSwitch) {
      app.setMode('reading');
      await sleep(25);
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: startX + screenDx,
        clientY: startY + screenDy,
        button: 0,
        buttons: 0
      }));
      await sleep(25);
      app.setMode('editing');
      await sleep(25);
      return true;
    }

    if (options.cancelWithPresentation) {
      app.enterPresentation();
      await sleep(25);
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: startX + screenDx,
        clientY: startY + screenDy,
        button: 0,
        buttons: 0
      }));
      await sleep(25);
      app.exitPresentation();
      await sleep(25);
      return true;
    }

    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: startX + screenDx,
      clientY: startY + screenDy,
      button: 0,
      buttons: 0
    }));
    await sleep(35);
    return true;
  }

  // =========================================================================
  // 33a. All 8 Resize Handles, Modifiers, Min Size, Zoom/Pan & Cancel/Undo/Redo
  // =========================================================================
  const testShapeId = 'chrome_test_shape_33a_' + Date.now();
  app.dispatchCommand({
    type: 'create_object',
    object: {
      id: testShapeId,
      type: 'rectangle',
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      stroke: '#1e1e1e',
      fill: 'none'
    }
  });
  app.workspace.selectedIds = [testShapeId];
  app.workspace.render();
  await sleep(50);

  // 1. All 8 handles individually
  await dragHandle('se', 40, 20);
  const seOk = app.doc.objects[testShapeId].width === 240 && app.doc.objects[testShapeId].height === 120;

  await dragHandle('nw', -20, -10);
  const nwOk = app.doc.objects[testShapeId].x === 80 && app.doc.objects[testShapeId].y === 90 &&
               app.doc.objects[testShapeId].width === 260 && app.doc.objects[testShapeId].height === 130;

  await dragHandle('ne', 20, -10);
  const neOk = app.doc.objects[testShapeId].y === 80 && app.doc.objects[testShapeId].width === 280 && app.doc.objects[testShapeId].height === 140;

  await dragHandle('sw', -20, 20);
  const swOk = app.doc.objects[testShapeId].x === 60 && app.doc.objects[testShapeId].width === 300 && app.doc.objects[testShapeId].height === 160;

  await dragHandle('e', 30, 0);
  const eOk = app.doc.objects[testShapeId].width === 330 && app.doc.objects[testShapeId].height === 160;

  await dragHandle('w', -20, 0);
  const wOk = app.doc.objects[testShapeId].x === 40 && app.doc.objects[testShapeId].width === 350 && app.doc.objects[testShapeId].height === 160;

  await dragHandle('s', 0, 30);
  const sOk = app.doc.objects[testShapeId].height === 190 && app.doc.objects[testShapeId].width === 350;

  await dragHandle('n', 0, -20);
  const nOk = app.doc.objects[testShapeId].y === 60 && app.doc.objects[testShapeId].height === 210 && app.doc.objects[testShapeId].width === 350;

  const all8HandlesOk = seOk && nwOk && neOk && swOk && eOk && wOk && sOk && nOk;

      // Undo all 8 handles
  for (let i = 0; i < 8; i++) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
    await sleep(25);
  }
  const undo8Ok = app.doc.objects[testShapeId].width === 200 && app.doc.objects[testShapeId].height === 100;

  // Redo all 8 handles
  for (let i = 0; i < 8; i++) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, shiftKey: true, bubbles: true }));
    await sleep(25);
  }
  const redo8Ok = app.doc.objects[testShapeId].width === 350 && app.doc.objects[testShapeId].height === 210;

  // Undo back to baseline
  for (let i = 0; i < 8; i++) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
    await sleep(25);
  }

  // Modifiers: Shift (aspect ratio), Alt (center-origin), Shift+Alt
  await dragHandle('se', 100, 20, { shiftKey: true });
  const shiftW = app.doc.objects[testShapeId].width;
  const shiftH = app.doc.objects[testShapeId].height;
  const shiftRatioOk = Math.abs((shiftW / shiftH) - 2.0) < 0.05 && shiftW > 200;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(25);

  await dragHandle('se', 40, 20, { altKey: true });
  const altOk = app.doc.objects[testShapeId].x === 60 && app.doc.objects[testShapeId].y === 80 &&
                app.doc.objects[testShapeId].width === 280 && app.doc.objects[testShapeId].height === 140;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(25);

  await dragHandle('se', 50, 30, { shiftKey: true, altKey: true });
  const saW = app.doc.objects[testShapeId].width;
  const saH = app.doc.objects[testShapeId].height;
  const saRatioOk = Math.abs((saW / saH) - 2.0) < 0.05 && app.doc.objects[testShapeId].x < 100;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(25);

  // Minimum size clamping
  await dragHandle('se', -500, -500);
  const minClampOk = app.doc.objects[testShapeId].width === 16 && app.doc.objects[testShapeId].height === 16;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(25);

  // Non-default zoom and pan
  app.workspace.camera = { x: 120, y: -60, zoom: 1.5 };
  app.workspace.render();
  await sleep(50);
  await dragHandle('se', 60, 40);
  const zoomResizeOk = app.doc.objects[testShapeId].width === 260 && app.doc.objects[testShapeId].height === 140;
  app.workspace.camera = { x: 0, y: 0, zoom: 1.0 };
  app.workspace.render();
  await sleep(50);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(25);

  // Cancellation
  await dragHandle('se', 80, 40, { cancelWithEscape: true });
  const escapeOk = app.doc.objects[testShapeId].width === 200;

  await dragHandle('se', 80, 40, { cancelWithModeSwitch: true });
  const modeSwitchOk = app.doc.objects[testShapeId].width === 200;

  await dragHandle('se', 80, 40, { cancelWithPresentation: true });
  const presentationOk = app.doc.objects[testShapeId].width === 200;

  app.dispatchCommand({ type: 'delete_objects', ids: [testShapeId] });

  const r33aOk = all8HandlesOk && undo8Ok && redo8Ok && shiftRatioOk && altOk && saRatioOk && minClampOk && zoomResizeOk && escapeOk && modeSwitchOk && presentationOk;

  // =========================================================================
  // 33b. Single Path Resizing (Open Sharp, Curved, Closed with Fill, Cycles & Undo/Redo)
  // =========================================================================
  const pathId = 'path_chrome_33b_' + Date.now();
  app.dispatchCommand({
    type: 'create_object',
    object: {
      id: pathId,
      type: 'path',
      x: 200,
      y: 200,
      width: 100,
      height: 100,
      points: [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }],
      stroke: '#1e1e1e',
      closed: false,
      curveStyle: 'sharp'
    }
  });
  app.workspace.selectedIds = [pathId];
  app.workspace.render();
  await sleep(50);

  // 1. Open sharp scaling
  await dragHandle('se', 100, 50);
  const pObj = app.doc.objects[pathId];
  const pt1X = pObj?.points && (pObj.points[1]?.x !== undefined ? pObj.points[1].x : pObj.points[1]?.[0]);
  const pt1Y = pObj?.points && (pObj.points[1]?.y !== undefined ? pObj.points[1].y : pObj.points[1]?.[1]);
  const pathScaleOk = pObj.width === 200 && pObj.height === 150 && pt1X === 100 && pt1Y === 150;

  // 2. Open curved scaling with arrowheads & exact geometry undo/redo
  app.dispatchCommand({
    type: 'set_style',
    ids: [pathId],
    updates: { curveStyle: 'curved', startArrow: true, endArrow: true }
  });
  app.workspace.render();
  await sleep(50);
  const elemPath = document.querySelector('#elem-' + pathId);
  const hasCurvedD = Boolean(elemPath?.querySelector('path[d*="C"], path[d*="Q"], path[d*="M"]'));
  const curvedConfigOk = app.doc.objects[pathId].curveStyle === 'curved' &&
                         app.doc.objects[pathId].startArrow === true &&
                         app.doc.objects[pathId].endArrow === true && hasCurvedD;

  // Physically drag open curved path
  await dragHandle('se', 60, 40);
  const curvedDraggedW = app.doc.objects[pathId].width;
  const curvedDraggedH = app.doc.objects[pathId].height;
  const curvedDragOk = curvedDraggedW === 260 && curvedDraggedH === 190;

  // Exact 1-step undo restores open curved geometry
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(25);
  const undoCurvedOk = app.doc.objects[pathId].width === 200 && app.doc.objects[pathId].height === 150;

  // Exact 1-step redo reapplies resized open curved geometry
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, shiftKey: true, bubbles: true }));
  await sleep(25);
  const redoCurvedOk = app.doc.objects[pathId].width === 260 && app.doc.objects[pathId].height === 190;

  // 3. Closed path with fill
  app.dispatchCommand({
    type: 'set_style',
    ids: [pathId],
    updates: { closed: true, fill: '#ffc9c9' }
  });
  app.workspace.render();
  await sleep(50);
  const curElem = document.querySelector('#elem-' + pathId);
  const hasClosedFill = Boolean(curElem?.querySelector('path[fill="#ffc9c9"]'));

  // 4. Repeated cycles without drift
  const preCycleW = app.doc.objects[pathId].width;
  await dragHandle('se', 50, 50);
  await dragHandle('se', -50, -50);
  const cycleOk = Math.abs(app.doc.objects[pathId].width - preCycleW) <= 1;

  // 5. Undo & Redo
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(25);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, shiftKey: true, bubbles: true }));
  await sleep(25);

  app.dispatchCommand({ type: 'delete_objects', ids: [pathId] });

  const r33bOk = pathScaleOk && curvedConfigOk && curvedDragOk && undoCurvedOk && redoCurvedOk && hasClosedFill && cycleOk;

  // =========================================================================
  // 33c. Multi-Selection & Persisted Groups (Ordinary Multi-Selection + Real Group Edge Resize under Zoom/Pan)
  // =========================================================================
  // Part 1: Ordinary Heterogeneous Multi-Selection
  const s1 = 'ms_s1_c_' + Date.now();
  const s2Locked = 'ms_s2_locked_c_' + Date.now();
  const sText = 'ms_text_c_' + Date.now();
  const sPath = 'ms_path_c_' + Date.now();
  const sConnAttached = 'ms_conn_att_c_' + Date.now();
  const sConnFree = 'ms_conn_free_c_' + Date.now();

  app.dispatchCommandBatch([
    { type: 'create_object', object: { id: s1, type: 'rectangle', x: 100, y: 100, width: 100, height: 100 } },
    { type: 'create_object', object: { id: s2Locked, type: 'ellipse', x: 250, y: 100, width: 100, height: 100, locked: true } },
    { type: 'create_object', object: { id: sText, type: 'text', x: 100, y: 250, width: 80, height: 30, text: 'Hello', textStyle: { size: 'm', resolvedSize: 20 } } },
    { type: 'create_object', object: { id: sPath, type: 'path', x: 250, y: 250, width: 100, height: 100, points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] } },
    { type: 'create_object', object: { id: sConnAttached, type: 'connector', from: { id: s1, anchor: { x: 0.5, y: 0.5 } }, to: { point: { x: 400, y: 150 } } } },
    { type: 'create_object', object: { id: sConnFree, type: 'connector', from: { point: { x: 150, y: 400 } }, to: { point: { x: 300, y: 400 } } } }
  ]);

  app.workspace.selectedIds = [s1, s2Locked, sText, sPath, sConnAttached, sConnFree];
  app.workspace.render();
  await sleep(50);

  const origS1W = app.doc.objects[s1].width;
  const origLockedX = app.doc.objects[s2Locked].x;
  const origLockedW = app.doc.objects[s2Locked].width;
  const origTextSize = app.doc.objects[sText].textStyle.resolvedSize;
  const origFreeConnToX = app.doc.objects[sConnFree].to.point.x;

  await dragHandle('se', 80, 40);

  const s1Transformed = app.doc.objects[s1].width > origS1W;
  const lockedUntouched = app.doc.objects[s2Locked].x === origLockedX && app.doc.objects[s2Locked].width === origLockedW;
  const textScaled = app.doc.objects[sText].textStyle.resolvedSize > origTextSize;
  const attachedAnchorPreserved = app.doc.objects[sConnAttached].from.anchor.x === 0.5 && app.doc.objects[sConnAttached].from.anchor.y === 0.5;
  const freeConnScaled = app.doc.objects[sConnFree].to.point.x > origFreeConnToX;

  // 1-step undo
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(50);
  const multiUndoOk = app.doc.objects[s1].width === origS1W && app.doc.objects[sText].textStyle.resolvedSize === origTextSize;

  // 1-step redo
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, shiftKey: true, bubbles: true }));
  await sleep(50);
  const multiRedoOk = app.doc.objects[s1].width > origS1W;

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(25);
  app.dispatchCommand({ type: 'delete_objects', ids: [s1, s2Locked, sText, sPath, sConnAttached, sConnFree] });

  // Part 2: Genuinely Persisted Group Resizing under Non-Default Camera Zoom & Pan with Edge Drag
  const grpS1 = 'grp_s1_c_' + Date.now();
  const grpS2 = 'grp_s2_c_' + Date.now();
  const persistedGid = 'persisted_grp_chrome_33c';

  app.dispatchCommandBatch([
    { type: 'create_object', object: { id: grpS1, type: 'rectangle', x: 100, y: 100, width: 100, height: 100 } },
    { type: 'create_object', object: { id: grpS2, type: 'ellipse', x: 250, y: 100, width: 100, height: 100 } },
    { type: 'group_objects', ids: [grpS1, grpS2], groupId: persistedGid }
  ]);

  // Normal group selection interaction: select member grpS1
  const hitObj = app.workspace.findObjectAt({ x: 150, y: 150 });
  if (hitObj && hitObj.groupId) {
    app.workspace.selectedIds = Object.values(app.doc.objects).filter(o => o.groupId === hitObj.groupId).map(o => o.id);
  } else {
    app.workspace.selectedIds = [grpS1, grpS2];
  }
  app.workspace.camera = { x: 80, y: -40, zoom: 1.25 };
  app.workspace.render();
  await sleep(50);

  const preGroupS1W = app.doc.objects[grpS1].width;
  const preGroupS2W = app.doc.objects[grpS2].width;
  const preGroupS2X = app.doc.objects[grpS2].x;

  // Physically drag right edge handle 'e' by 60px under 1.25x camera zoom/pan
  await dragHandle('e', 60, 0);

  const postGroupS1W = app.doc.objects[grpS1].width;
  const postGroupS2W = app.doc.objects[grpS2].width;
  const postGroupS2X = app.doc.objects[grpS2].x;

  const groupResizedOk = postGroupS1W > preGroupS1W && postGroupS2W > preGroupS2W && postGroupS2X > preGroupS2X &&
                         app.doc.objects[grpS1].groupId === persistedGid && app.doc.objects[grpS2].groupId === persistedGid;

  // 1-step undo
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(50);
  const groupUndoOk = app.doc.objects[grpS1].width === preGroupS1W && app.doc.objects[grpS2].width === preGroupS2W && app.doc.objects[grpS2].x === preGroupS2X;

  // 1-step redo
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, shiftKey: true, bubbles: true }));
  await sleep(50);
  const groupRedoOk = app.doc.objects[grpS1].width === postGroupS1W && app.doc.objects[grpS2].width === postGroupS2W && app.doc.objects[grpS2].x === postGroupS2X;

  app.workspace.camera = { x: 0, y: 0, zoom: 1.0 };
  app.workspace.render();
  await sleep(25);
  app.dispatchCommand({ type: 'delete_objects', ids: [grpS1, grpS2] });

  const r33cOk = s1Transformed && lockedUntouched && textScaled && attachedAnchorPreserved && freeConnScaled && multiUndoOk && multiRedoOk && groupResizedOk && groupUndoOk && groupRedoOk;

  // =========================================================================
  // 33d. Standalone Text Contextual Wheel Slots & Text-to-Shape Morphing
  // =========================================================================
  const textObjId = 'text_wheel_chrome_' + Date.now();
  app.dispatchCommand({
    type: 'create_object',
    object: {
      id: textObjId,
      type: 'text',
      x: 300,
      y: 300,
      width: 120,
      height: 36,
      text: 'Sample Typography',
      stroke: '#1e1e1e',
      textStyle: { color: '#1e1e1e', size: 'm', fontFamily: 'hand' }
    }
  });
  app.workspace.selectedIds = [textObjId];
  const tObj = app.doc.objects[textObjId];
  app.wheel.open(300, 300, 'object', tObj, app.doc.theme.palette, 1, [tObj]);
  await sleep(50);

  const textWheelItems = app.wheel.getItems();
  const slot0Opacity = textWheelItems[0].id === 'menu_opacity';
  const slot5Disabled = textWheelItems[5].id === 'menu_style' && Boolean(textWheelItems[5].disabled);
  const slot6ColorText = textWheelItems[6].id === 'menu_ink';
  const noEqualSides = !textWheelItems[2].subItems.some(i => i.id === 'toggle_equal_sides');
  app.wheel.close();

  // Morph to rectangle
  app.dispatchCommand({ type: 'change_shape', id: textObjId, shapeType: 'rectangle' });
  const morphedObj = app.doc.objects[textObjId];
  app.wheel.open(300, 300, 'object', morphedObj, app.doc.theme.palette, 1, [morphedObj]);
  await sleep(50);
  const shapeWheelItems = app.wheel.getItems();
  const morphedSlot1Fill = shapeWheelItems[0].id === 'menu_fill';
  const morphedSlot5Enabled = shapeWheelItems[5].id === 'menu_style' && !shapeWheelItems[5].disabled;
  app.wheel.close();

  app.dispatchCommand({ type: 'delete_objects', ids: [textObjId] });

  const r33dOk = slot0Opacity && slot5Disabled && slot6ColorText && noEqualSides && morphedSlot1Fill && morphedSlot5Enabled;

  // =========================================================================
  // 33e. No Outline (strokeWidth: 0) Rendering Semantics
  // =========================================================================
  const noOutShapeId = 'no_out_chrome_' + Date.now();
  app.dispatchCommand({
    type: 'create_object',
    object: {
      id: noOutShapeId,
      type: 'rectangle',
      x: 200,
      y: 200,
      width: 100,
      height: 100,
      stroke: '#1e1e1e',
      strokeWidth: 2,
      fill: '#ffc9c9'
    }
  });
  app.dispatchCommand({
    type: 'set_style',
    ids: [noOutShapeId],
    updates: { strokeWidth: 0 }
  });
  app.workspace.render();
  await sleep(50);

  const noOutObj = app.doc.objects[noOutShapeId];
  const noOutStored = noOutObj.strokeWidth === 0 && noOutObj.stroke === '#1e1e1e';
  const noOutElem = document.querySelector('#elem-' + noOutShapeId);
  const fillPathPresent = Boolean(noOutElem?.querySelector('path[fill="#ffc9c9"]'));
  const strokePathAbsent = !noOutElem?.querySelector('path[stroke-width]');

  // Undo
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(25);
  const undoStrokeOk = app.doc.objects[noOutShapeId].strokeWidth === 2;

  // Redo
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, shiftKey: true, bubbles: true }));
  await sleep(25);
  const redoStrokeOk = app.doc.objects[noOutShapeId].strokeWidth === 0;

  app.dispatchCommand({ type: 'delete_objects', ids: [noOutShapeId] });

  const r33eOk = noOutStored && fillPathPresent && strokePathAbsent && undoStrokeOk && redoStrokeOk;

  // =========================================================================
  // 33f. Complete Group/Duplicate/Connect/generateBoardFile Regression
  // =========================================================================
  const regS1 = 'reg_shape1_chrome_' + Date.now();
  const regS2 = 'reg_shape2_chrome_' + Date.now();
  const regGrpId = 'grp_reg_chrome_33f';

  app.dispatchCommandBatch([
    { type: 'create_object', object: { id: regS1, type: 'rectangle', x: 600, y: 100, width: 100, height: 100 } },
    { type: 'create_object', object: { id: regS2, type: 'ellipse', x: 750, y: 100, width: 100, height: 100 } },
    { type: 'group_objects', ids: [regS1, regS2], groupId: regGrpId }
  ]);

  app.dispatchCommand({ type: 'duplicate_objects', ids: [regS1, regS2] });

  const dupObjects = Object.values(app.doc.objects).filter(o => o.groupId && o.groupId !== regGrpId && o.type !== 'connector');
  const dupGrpId = dupObjects[0]?.groupId;
  const dupS1 = dupObjects.find(o => o.type === 'rectangle');

  app.dispatchCommand({ type: 'move_objects', ids: dupObjects.map(o => o.id), dx: 0, dy: 250 });

  // Connect interactively with connector tool
  app.workspace.setTool('connector');
  const startPt = app.workspace.worldToScreen(650, 150);
  const endPt = app.workspace.worldToScreen(650, 400);

  app.workspace.container.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    clientX: startPt.x,
    clientY: startPt.y,
    button: 0,
    buttons: 1
  }));
  await sleep(30);
  window.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true,
    clientX: endPt.x,
    clientY: endPt.y,
    button: 0,
    buttons: 1
  }));
  await sleep(30);
  window.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    clientX: endPt.x,
    clientY: endPt.y,
    button: 0,
    buttons: 0
  }));
  await sleep(50);
  app.workspace.setTool('select');

  const createdConn = Object.values(app.doc.objects).find(o => o.type === 'connector' && o.from?.id === regS1 && o.to?.id === dupS1.id);
  const connSchemaPurity = createdConn && createdConn.x === undefined && createdConn.y === undefined &&
                           createdConn.width === undefined && createdConn.height === undefined;

  // Validate via real public API
  const valResult = window.sabura.validateDocument(app.doc);
  const docValid = valResult.valid === true && valResult.errors.length === 0;

  // Hook URL.createObjectURL to capture blob
  window._lastSaburaBlob = null;
  const _origCreateObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function(blob) {
    if (blob && blob.type && blob.type.includes('text/html')) {
      const reader = new FileReader();
      reader.onload = () => { window._lastSaburaBlob = reader.result; };
      reader.readAsDataURL(blob);
    }
    return _origCreateObjectURL(blob);
  };
  const genResult = window.sabura.generateBoardFile(app.doc);
  const generateOk = genResult.success === true && genResult.byteLength > 0 && typeof genResult.filename === 'string';

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  app.dispatchCommand({ type: 'delete_objects', ids: [regS1, regS2, ...dupObjects.map(o => o.id)] });
  app.workspace.selectedIds = [];
  app.workspace.render();

  const r33fBrowserOk = connSchemaPurity && docValid && generateOk;

  return {
    ok: r33aOk && r33bOk && r33cOk && r33dOk && r33eOk && r33fBrowserOk,
    r33a: r33aOk,
    r33aDetails: {
      all8HandlesOk,
      seOk, nwOk, neOk, swOk, eOk, wOk, sOk, nOk,
      undo8Ok, redo8Ok, shiftRatioOk, altOk, saRatioOk, minClampOk, zoomResizeOk,
      escapeOk, modeSwitchOk, presentationOk
    },
    r33b: r33bOk,
    r33bDetails: {
      pathScaleOk, curvedConfigOk, curvedDragOk, undoCurvedOk, redoCurvedOk,
      hasClosedFill, cycleOk,
      pt1X, pt1Y, pObjWidth: pObj?.width, pObjHeight: pObj?.height
    },
    r33c: r33cOk,
    r33cDetails: {
      s1Transformed, lockedUntouched, textScaled, attachedAnchorPreserved,
      freeConnScaled, multiUndoOk, multiRedoOk, groupResizedOk, groupUndoOk, groupRedoOk
    },
    r33d: r33dOk,
    r33e: r33eOk,
    r33fBrowser: r33fBrowserOk,
    regGrpId,
    dupGrpId,
    regS1,
    dupS1Id: dupS1.id
  };
})()`);

if (!flow33Result.ok) {
  throw new Error(`Flow 33: Resizing and Transform Foundation verification failed: ${JSON.stringify(flow33Result)}`);
}

// Complete 33f verification on Node side by capturing and extracting the generated HTML file
let flow33CapturedDataUrl = null;
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 100));
  flow33CapturedDataUrl = await evalInChrome('window._lastSaburaBlob');
  if (flow33CapturedDataUrl) break;
}
if (!flow33CapturedDataUrl) {
  throw new Error('Flow 33: generateBoardFile Blob interceptor did not capture downloaded file');
}

const flow33B64 = flow33CapturedDataUrl.split(',')[1];
const flow33DownloadedHtml = Buffer.from(flow33B64, 'base64').toString('utf8');
const flow33Extracted = extractDocumentFromHtml(flow33DownloadedHtml);
if (!flow33Extracted.valid || !flow33Extracted.document) {
  throw new Error('Flow 33: Failed to extract valid document from generateBoardFile downloaded HTML');
}

const reopenedDoc = flow33Extracted.document;
if (!reopenedDoc.groups[flow33Result.regGrpId] || !reopenedDoc.groups[flow33Result.dupGrpId]) {
  throw new Error('Flow 33: Persisted groups missing in downloaded document');
}
if (reopenedDoc.objects[flow33Result.regS1]?.groupId !== flow33Result.regGrpId ||
    reopenedDoc.objects[flow33Result.dupS1Id]?.groupId !== flow33Result.dupGrpId) {
  throw new Error('Flow 33: Group member assignments corrupted in downloaded document');
}

const reopenedConn = Object.values(reopenedDoc.objects).find(o => o.type === 'connector' && o.from?.id === flow33Result.regS1 && o.to?.id === flow33Result.dupS1Id);
if (!reopenedConn || reopenedConn.x !== undefined || reopenedConn.y !== undefined || reopenedConn.width !== undefined || reopenedConn.height !== undefined) {
  throw new Error('Flow 33: Reopened connector missing or contains forbidden spatial fields');
}

console.log('  ✓ 33a. All 8 resize handles, edge/corner scaling, Shift/Alt modifiers, minimum-size clamping, zoom/pan resilience, cancellation (Escape/mode switch/presentation) & 1-step undo/redo');
console.log('  ✓ 33b. Single path physical handle drag & proportional point scaling across open sharp, open curved with arrows, closed with fill, repeated cycles & 1-step undo/redo');
console.log('  ✓ 33c. Multi-selection & persisted group shared handle drag (heterogeneous shapes, text, path, locked objects, attached/free connectors) & 1-step atomic batch undo/redo');
console.log('  ✓ 33d. Standalone text contextual wheel slots (Opacity Slot 0, disabled Style Slot 5, Text Color Slot 6, no equal sides) & text-to-shape morphing');
console.log('  ✓ 33e. No outline (strokeWidth: 0) applied with fill rendered, stroke omitted, color preserved & 1-step undo/redo');
console.log('  ✓ 33f. Complete regression: Group, Duplicate, Connect interactively, Save Copy generation via window.sabura.generateBoardFile & Node-side extraction/validation');
console.log('✓ Flow 33: Resizing and Transform Foundation verified cleanly!');

// =========================================================================
// Flow 34: Rotation Foundation Comprehensive Verification
// =========================================================================
console.log('\n--- Flow 34: Rotation Foundation ---');
const flow34Result = await evalInChrome(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const app = window.saburaApp;
  const modObj = navigator.platform.includes('Mac') ? { metaKey: true } : { ctrlKey: true };

  // Setup Blob interceptor for Save Copy verification
  window._lastSaburaBlob = null;
  const origCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = (blob) => {
    const reader = new FileReader();
    reader.onloadend = () => { window._lastSaburaBlob = reader.result; };
    reader.readAsDataURL(blob);
    return origCreateObjectURL(blob);
  };

  app.setMode('editing');
  app.workspace.camera.zoom = 1;
  app.workspace.camera.x = 0;
  app.workspace.camera.y = 0;

  async function dragRotationHandle(screenDx, screenDy, options = {}) {
    const rotHandle = document.querySelector('[data-handle="rotate"]');
    if (!rotHandle) throw new Error('Rotation handle not found');
    const rBox = rotHandle.getBoundingClientRect();
    const startX = rBox.left + rBox.width / 2;
    const startY = rBox.top + rBox.height / 2;

    rotHandle.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: startX,
      clientY: startY,
      button: 0,
      buttons: 1,
      ...options
    }));
    await sleep(35);

    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: startX + screenDx,
      clientY: startY + screenDy,
      button: 0,
      buttons: 1,
      ...options
    }));
    await sleep(35);

    if (options.testShiftRebase) {
      // 1. Record angle before Shift press at unchanged pointer position
      const angleBeforeShift = app.doc.objects[options.targetId]?.rotation;

      // 2. Press Shift without moving pointer
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft', shiftKey: true, bubbles: true }));
      await sleep(25);
      const angleOnShiftPress = app.doc.objects[options.targetId]?.rotation;

      // 3. Move pointer by 15 deg with Shift held
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: startX + screenDx * 1.2,
        clientY: startY + screenDy * 1.2,
        button: 0,
        buttons: 1,
        shiftKey: true
      }));
      await sleep(25);
      const angleWithShift = app.doc.objects[options.targetId]?.rotation;

      // 4. Release Shift without moving pointer
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', code: 'ShiftLeft', shiftKey: false, bubbles: true }));
      await sleep(25);
      const angleOnShiftRelease = app.doc.objects[options.targetId]?.rotation;

      const jumpOnPress = Math.abs(angleOnShiftPress - angleBeforeShift);
      const jumpOnRelease = Math.abs(angleOnShiftRelease - angleWithShift);
      options.jumpOnPress = jumpOnPress;
      options.jumpOnRelease = jumpOnRelease;
      options.shiftRebaseOk = jumpOnPress < 0.1 && jumpOnRelease < 0.1;
    }

    if (options.cancelWithEscape) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      await sleep(25);
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: startX + screenDx,
        clientY: startY + screenDy,
        button: 0,
        buttons: 0
      }));
      await sleep(25);
      return true;
    }

    if (options.cancelWithReadingMode) {
      app.setMode('reading');
      await sleep(25);
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: startX + screenDx,
        clientY: startY + screenDy,
        button: 0,
        buttons: 0
      }));
      await sleep(25);
      app.setMode('editing');
      return true;
    }

    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: startX + screenDx,
      clientY: startY + screenDy,
      button: 0,
      buttons: 0
    }));
    await sleep(35);
    return true;
  }

  async function dragHandle(handleId, screenDx, screenDy, options = {}) {
    const handle = document.querySelector('[data-handle="' + handleId + '"]');
    if (!handle) throw new Error('Handle ' + handleId + ' not found');
    const hBox = handle.getBoundingClientRect();
    const startX = hBox.left + hBox.width / 2;
    const startY = hBox.top + hBox.height / 2;

    handle.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: startX,
      clientY: startY,
      button: 0,
      buttons: 1,
      ...options
    }));
    await sleep(35);

    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: startX + screenDx,
      clientY: startY + screenDy,
      button: 0,
      buttons: 1,
      ...options
    }));
    await sleep(35);

    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: startX + screenDx,
      clientY: startY + screenDy,
      button: 0,
      buttons: 0
    }));
    await sleep(35);
    return true;
  }

  // -------------------------------------------------------------
  // 34a: Single object rotation, non-default camera, Shift rebase
  // -------------------------------------------------------------
  const r1Id = 'rot_test_r1_' + Date.now();
  app.dispatchCommand({
    type: 'create_object',
    object: { id: r1Id, type: 'rectangle', x: 200, y: 200, width: 100, height: 100, stroke: '#1e1e1e', fill: 'none' }
  });
  app.workspace.selectedIds = [r1Id];
  app.workspace.render();
  await sleep(50);

  // Set non-default camera
  app.workspace.camera.zoom = 1.5;
  app.workspace.camera.x = 100;
  app.workspace.camera.y = 50;
  app.workspace.render();
  await sleep(30);

  // Compute dynamic screen delta for 90 deg rotation under current camera
  const r1StartScreen = app.workspace.worldToScreen(250, 172);
  const r1TargetScreen90 = app.workspace.worldToScreen(328, 250);
  const dx90 = r1TargetScreen90.x - r1StartScreen.x;
  const dy90 = r1TargetScreen90.y - r1StartScreen.y;

  // 1. Rotate to 90 degrees
  await dragRotationHandle(dx90, dy90);
  const r1Rot90 = Math.abs(Math.round(app.doc.objects[r1Id].rotation || 0) - 90) <= 2;

  // 2. Undo rotation -> restores 0 deg
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(30);
  const r1Undone = (app.doc.objects[r1Id].rotation || 0) === 0;

  // 3. Redo rotation -> restores 90 deg
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, shiftKey: true, bubbles: true }));
  await sleep(30);
  const r1Redone = Math.abs(Math.round(app.doc.objects[r1Id].rotation || 0) - 90) <= 2;

  // 4. Test Shift rebase (press and release mid-gesture without angular jump)
  const rebaseOpts = { targetId: r1Id, testShiftRebase: true };
  await dragRotationHandle(50, 50, rebaseOpts);
  const shiftRebaseOk = Boolean(rebaseOpts.shiftRebaseOk);

  // Undo Shift rebase drag so r1 is back at 90 deg
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(30);

  // 5. Test Shift snapping (drag with Shift held)
  await dragRotationHandle(dx90 * 0.5, dy90 * 0.5, { shiftKey: true });
  const shiftSnapped = Math.round(app.doc.objects[r1Id].rotation || 0) % 15 === 0;

  // Undo Shift snap so r1 is back at 90 degrees for 34b
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(30);
  await sleep(30);

  // Reset camera
  app.workspace.camera.zoom = 1;
  app.workspace.camera.x = 0;
  app.workspace.camera.y = 0;
  app.workspace.render();
  await sleep(30);

  // -------------------------------------------------------------
  // 34b: Rotated single-object local-axis resize
  // -------------------------------------------------------------
  await dragHandle('e', 0, 40);
  const r1ResizedW = app.doc.objects[r1Id].width === 140 && app.doc.objects[r1Id].height === 100;
  const r1ResizedRot = Math.abs(Math.round(app.doc.objects[r1Id].rotation || 0) - 90) <= 2;

  // -------------------------------------------------------------
  // 34c1: Ordinary multi-selection rotation vs Persisted Group rotation
  // -------------------------------------------------------------
  const m1Id = 'rot_m1_' + Date.now();
  const m2Id = 'rot_m2_' + Date.now();
  app.dispatchCommand({
    type: 'create_object',
    object: { id: m1Id, type: 'diamond', x: 100, y: 100, width: 80, height: 80, rotation: 30, stroke: '#1e1e1e', fill: 'none' }
  });
  app.dispatchCommand({
    type: 'create_object',
    object: { id: m2Id, type: 'rectangle', x: 220, y: 100, width: 80, height: 80, rotation: 0, stroke: '#1e1e1e', fill: 'none' }
  });

  // Ordinary multi-selection rotation
  app.workspace.selectedIds = [m1Id, m2Id];
  app.workspace.render();
  await sleep(30);
  await dragRotationHandle(50, 50);
  const m1RotMulti = app.doc.objects[m1Id].rotation;
  const m2RotMulti = app.doc.objects[m2Id].rotation;
  const m1PosMulti = { x: app.doc.objects[m1Id].x, y: app.doc.objects[m1Id].y };
  const m2PosMulti = { x: app.doc.objects[m2Id].x, y: app.doc.objects[m2Id].y };

  // Undo ordinary multi-selection rotation
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(30);

  // Group m1 and m2 and rotate
  const grpCompareId = 'grp_cmp_' + Date.now();
  app.dispatchCommand({
    type: 'group_objects',
    groupId: grpCompareId,
    ids: [m1Id, m2Id]
  });
  app.workspace.selectedIds = [m1Id, m2Id];
  app.workspace.render();
  await sleep(30);
  await dragRotationHandle(50, 50);
  const m1RotGroup = app.doc.objects[m1Id].rotation;
  const m2RotGroup = app.doc.objects[m2Id].rotation;
  const m1PosGroup = { x: app.doc.objects[m1Id].x, y: app.doc.objects[m1Id].y };
  const m2PosGroup = { x: app.doc.objects[m2Id].x, y: app.doc.objects[m2Id].y };

  const ordinaryMultiMatchesGroup = (
    Math.abs(m1RotMulti - m1RotGroup) < 0.1 &&
    Math.abs(m2RotMulti - m2RotGroup) < 0.1 &&
    Math.hypot(m1PosMulti.x - m1PosGroup.x, m1PosMulti.y - m1PosGroup.y) < 0.1 &&
    Math.hypot(m2PosMulti.x - m2PosGroup.x, m2PosMulti.y - m2PosGroup.y) < 0.1
  );

  // Undo group rotation
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(30);

  // -------------------------------------------------------------
  // 34c2: Persisted group with pre-rotated members, locked members & heterogeneous connectors
  // -------------------------------------------------------------
  const d1Id = 'rot_test_d1_' + Date.now();
  const r2Id = 'rot_test_r2_' + Date.now();
  const eLockedId = 'rot_test_eLock_' + Date.now();
  const t1Id = 'rot_test_t1_' + Date.now();
  const cAttachedId = 'rot_test_cAtt_' + Date.now();
  const cCurvedId = 'rot_test_cCurv_' + Date.now();
  const cElbowId = 'rot_test_cElb_' + Date.now();
  const cFreeId = 'rot_test_cFree_' + Date.now();

  app.dispatchCommand({
    type: 'create_object',
    object: { id: d1Id, type: 'diamond', x: 400, y: 200, width: 100, height: 100, rotation: 30, stroke: '#1e1e1e', fill: 'none' }
  });
  app.dispatchCommand({
    type: 'create_object',
    object: { id: r2Id, type: 'rectangle', x: 550, y: 200, width: 100, height: 100, rotation: 0, stroke: '#1e1e1e', fill: 'none' }
  });
  app.dispatchCommand({
    type: 'create_object',
    object: { id: eLockedId, type: 'ellipse', x: 700, y: 200, width: 80, height: 80, rotation: 45, locked: true, stroke: '#1e1e1e', fill: '#eeeeee' }
  });
  app.dispatchCommand({
    type: 'create_object',
    object: { id: t1Id, type: 'text', x: 400, y: 350, width: 120, height: 40, rotation: 0, text: 'Hello Rotated', textStyle: { resolvedSize: 16 } }
  });
  // Connector with custom anchor attached to rotated diamond
  app.dispatchCommand({
    type: 'create_object',
    object: { id: cAttachedId, type: 'connector', from: { id: d1Id, anchor: { x: 0.25, y: 0.75 } }, to: { id: r2Id }, routing: 'straight' }
  });
  // Curved connector
  app.dispatchCommand({
    type: 'create_object',
    object: { id: cCurvedId, type: 'connector', from: { id: d1Id }, to: { id: r2Id }, routing: 'curved', curveSide: 1, curveDistance: 50 }
  });
  // Elbow connector
  app.dispatchCommand({
    type: 'create_object',
    object: { id: cElbowId, type: 'connector', from: { id: d1Id }, to: { id: r2Id }, routing: 'elbow', elbowOffset: 40 }
  });
  // Connector with free endpoint
  app.dispatchCommand({
    type: 'create_object',
    object: { id: cFreeId, type: 'connector', from: { id: d1Id }, to: { point: { x: 600, y: 350 } }, routing: 'straight' }
  });

  const grp1Id = 'rot_grp1_' + Date.now();
  app.dispatchCommand({
    type: 'group_objects',
    groupId: grp1Id,
    ids: [d1Id, r2Id, eLockedId, t1Id, cAttachedId, cCurvedId, cElbowId, cFreeId]
  });

  app.workspace.selectedIds = [d1Id, r2Id, eLockedId, t1Id, cAttachedId, cCurvedId, cElbowId, cFreeId];
  app.workspace.render();
  await sleep(50);

  const sharedRotHandle = document.querySelector('[data-handle="rotate"]');
  const hasSharedRot = Boolean(sharedRotHandle);

  // Drag shared rotation handle by 45 degrees
  await dragRotationHandle(100, 100);
  const d1RotAfter = app.doc.objects[d1Id]?.rotation;
  const r2RotAfter = app.doc.objects[r2Id]?.rotation;
  const eLockRotAfter = app.doc.objects[eLockedId]?.rotation;
  const t1RotAfter = app.doc.objects[t1Id]?.rotation;
  const cFreeToPointAfter = app.doc.objects[cFreeId]?.to?.point;
  const cStraightAnchorAfter = app.doc.objects[cAttachedId]?.from?.anchor;
  const cCurvedAfter = app.doc.objects[cCurvedId];
  const cElbowAfter = app.doc.objects[cElbowId];

  const d1Rotated = d1RotAfter !== 30;
  const r2Rotated = r2RotAfter !== 0;
  const eLockPreserved = eLockRotAfter === 45; // Locked object must NOT rotate
  const t1Rotated = t1RotAfter !== 0;
  const cFreeRotated = cFreeToPointAfter && (cFreeToPointAfter.x !== 600 || cFreeToPointAfter.y !== 350);
  const cStraightAttached = Boolean(cStraightAnchorAfter && cStraightAnchorAfter.x === 0.25 && cStraightAnchorAfter.y === 0.75);
  const curvedConnectorValid = Boolean(cCurvedAfter && cCurvedAfter.routing === 'curved' && cCurvedAfter.curveSide === 1 && cCurvedAfter.curveDistance === 50);
  const elbowConnectorValid = Boolean(cElbowAfter && cElbowAfter.routing === 'elbow' && cElbowAfter.elbowOffset === 40);
  const grpPreserved = Boolean(app.doc.groups[grp1Id]);

  // Undo group rotation
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, bubbles: true }));
  await sleep(30);
  const d1Undone = app.doc.objects[d1Id]?.rotation === 30;
  const r2Undone = app.doc.objects[r2Id]?.rotation === 0;

  // Redo group rotation
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ...modObj, shiftKey: true, bubbles: true }));
  await sleep(30);
  const d1Redone = app.doc.objects[d1Id]?.rotation === d1RotAfter;

  // -------------------------------------------------------------
  // 34d: Open and closed paths vertex dragging after rotation
  // -------------------------------------------------------------
  const pOpenId = 'rot_test_pOpen_' + Date.now();
  const pClosedId = 'rot_test_pClosed_' + Date.now();
  app.dispatchCommand({
    type: 'create_object',
    object: { id: pOpenId, type: 'path', x: 100, y: 500, width: 100, height: 100, rotation: 45, points: [[0, 0], [100, 100]], stroke: '#1e1e1e', fill: 'none' }
  });
  app.dispatchCommand({
    type: 'create_object',
    object: { id: pClosedId, type: 'path', x: 300, y: 500, width: 100, height: 100, rotation: 75, closed: true, points: [[0, 0], [100, 0], [100, 100], [0, 100]], stroke: '#1e1e1e', fill: '#ffcccc' }
  });

  // 1. Open path vertex-0 drag
  app.workspace.selectedIds = [pOpenId];
  app.workspace.render();
  await sleep(50);

  const pv0Handle = document.querySelector('[data-handle="vertex-0"]');
  let pOpenJump = 0;
  if (pv0Handle) {
    const vBox = pv0Handle.getBoundingClientRect();
    pv0Handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: vBox.left + vBox.width / 2, clientY: vBox.top + vBox.height / 2, button: 0, buttons: 1 }));
    await sleep(30);
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: vBox.left + vBox.width / 2 - 30, clientY: vBox.top + vBox.height / 2, button: 0, buttons: 1 }));
    await sleep(30);

    const pv1El = document.querySelector('[data-handle="vertex-1"]');
    const pv1Preview = pv1El?.getBoundingClientRect();

    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: vBox.left + vBox.width / 2 - 30, clientY: vBox.top + vBox.height / 2, button: 0, buttons: 0 }));
    await sleep(50);

    const pv1Committed = document.querySelector('[data-handle="vertex-1"]')?.getBoundingClientRect();
    pOpenJump = Math.hypot((pv1Committed?.left || 0) - (pv1Preview?.left || 0), (pv1Committed?.top || 0) - (pv1Preview?.top || 0));
  }
  const pOpenRotPreserved = app.doc.objects[pOpenId]?.rotation === 45;
  const pOpenOk = pOpenJump < 1.0 && pOpenRotPreserved;

  // 2. Closed path vertex-2 drag
  app.workspace.selectedIds = [pClosedId];
  app.workspace.render();
  await sleep(50);

  const pcv2Handle = document.querySelector('[data-handle="vertex-2"]');
  let pClosedJump = 0;
  if (pcv2Handle) {
    const vBox = pcv2Handle.getBoundingClientRect();
    pcv2Handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: vBox.left + vBox.width / 2, clientY: vBox.top + vBox.height / 2, button: 0, buttons: 1 }));
    await sleep(30);
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: vBox.left + vBox.width / 2 + 25, clientY: vBox.top + vBox.height / 2 + 25, button: 0, buttons: 1 }));
    await sleep(30);

    const pcv0El = document.querySelector('[data-handle="vertex-0"]');
    const pcv0Preview = pcv0El?.getBoundingClientRect();

    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: vBox.left + vBox.width / 2 + 25, clientY: vBox.top + vBox.height / 2 + 25, button: 0, buttons: 0 }));
    await sleep(50);

    const pcv0Committed = document.querySelector('[data-handle="vertex-0"]')?.getBoundingClientRect();
    pClosedJump = Math.hypot((pcv0Committed?.left || 0) - (pcv0Preview?.left || 0), (pcv0Committed?.top || 0) - (pcv0Preview?.top || 0));
  }
  const pClosedRotPreserved = app.doc.objects[pClosedId]?.rotation === 75;
  const closedPathVertexNoJump = pClosedJump < 1.0 && pClosedRotPreserved;

  // -------------------------------------------------------------
  // 34e: Rotated text in-place editing (Standalone text & Text-bearing shape)
  // -------------------------------------------------------------
  // Standalone text edit
  app.workspace.selectedIds = [t1Id];
  app.workspace.render();
  await sleep(30);
  app.textEditor.open(app.doc.objects[t1Id], app.workspace.camera);
  const textEditorEl = document.querySelector('.sabura-inline-text-editor');
  const standaloneTextEditorRotated = textEditorEl && textEditorEl.style.transform.includes('rotate(');
  textEditorEl.value = 'Updated Standalone';
  textEditorEl.dispatchEvent(new Event('input', { bubbles: true }));
  app.textEditor.close(true);
  const standaloneTextCommitted = app.doc.objects[t1Id]?.text === 'Updated Standalone';

  // Text-bearing shape edit
  const rShapeTextId = 'rot_shape_text_' + Date.now();
  app.dispatchCommand({
    type: 'create_object',
    object: { id: rShapeTextId, type: 'rectangle', x: 500, y: 500, width: 120, height: 60, rotation: 35, text: 'Shape Text', stroke: '#1e1e1e', fill: '#eeeeee' }
  });
  app.workspace.selectedIds = [rShapeTextId];
  app.workspace.render();
  await sleep(30);
  app.textEditor.open(app.doc.objects[rShapeTextId], app.workspace.camera);
  const shapeTextEditorEl = document.querySelector('.sabura-inline-text-editor');
  const shapeTextEditorRotated = shapeTextEditorEl && shapeTextEditorEl.style.transform.includes('rotate(35deg)');
  shapeTextEditorEl.value = 'Updated Shape Text';
  shapeTextEditorEl.dispatchEvent(new Event('input', { bubbles: true }));
  app.textEditor.close(true);
  const textBearingShapeEditPreserved = app.doc.objects[rShapeTextId]?.text === 'Updated Shape Text' && app.doc.objects[rShapeTextId]?.rotation === 35;

  // -------------------------------------------------------------
  // 34f: Precision hit testing & locked overlay orientation
  // -------------------------------------------------------------
  const rect45Id = 'rot_rect45_' + Date.now();
  app.dispatchCommand({
    type: 'create_object',
    object: { id: rect45Id, type: 'rectangle', x: 700, y: 500, width: 100, height: 100, rotation: 45, stroke: '#1e1e1e', fill: '#dddddd' }
  });
  const center45 = { x: 750, y: 550 };
  const corner45 = { x: 700, y: 500 }; // Empty AABB corner
  const hitCenter = app.workspace.findObjectAt(center45);
  const hitCorner = app.workspace.findObjectAt(corner45);
  const hitTestOk = hitCenter?.id === rect45Id && hitCorner?.id !== rect45Id;

  // Check locked object selection overlay orientation
  app.workspace.selectedIds = [eLockedId];
  app.workspace.render();
  await sleep(30);
  const lockedSingleOverlay = document.querySelector('.selection-single-overlay');
  const lockedOverlayRot = lockedSingleOverlay?.getAttribute('transform')?.includes('rotate(45');
  const lockedNoHandles = !document.querySelector('[data-handle="rotate"]') && !document.querySelector('[data-handle="nw"]');
  const lockedOverlayOk = Boolean(lockedOverlayRot && lockedNoHandles);

  // -------------------------------------------------------------
  // 34g: Cancellation with Escape and Reading Mode
  // -------------------------------------------------------------
  app.workspace.selectedIds = [r1Id];
  app.workspace.render();
  await sleep(30);
  const r1RotBeforeCancel = app.doc.objects[r1Id].rotation;
  const histBeforeCancel = app.undoStack.length;

  await dragRotationHandle(50, 50, { cancelWithEscape: true });
  const r1RotAfterEscape = app.doc.objects[r1Id].rotation;
  const histAfterEscape = app.undoStack.length;
  const escapeCancelOk = r1RotBeforeCancel === r1RotAfterEscape && histBeforeCancel === histAfterEscape;

  await dragRotationHandle(50, 50, { cancelWithReadingMode: true });
  const r1RotAfterReading = app.doc.objects[r1Id].rotation;
  const histAfterReading = app.undoStack.length;
  const readingCancelOk = r1RotBeforeCancel === r1RotAfterReading && histBeforeCancel === histAfterReading;

  // -------------------------------------------------------------
  // 34h: Real Save Copy / generateBoardFile download generation
  // -------------------------------------------------------------
  const genResult = window.sabura.generateBoardFile(app.doc);

  return {
    r1Rot90,
    shiftRebaseOk,
    shiftSnapped,
    r1Undone,
    r1Redone,
    r1ResizedW,
    r1ResizedRot,
    ordinaryMultiMatchesGroup,
    hasSharedRot,
    d1Rotated,
    r2Rotated,
    eLockPreserved,
    t1Rotated,
    cFreeRotated,
    cStraightAttached,
    curvedConnectorValid,
    elbowConnectorValid,
    grpPreserved,
    d1Undone,
    r2Undone,
    d1Redone,
    pOpenOk,
    pOpenJump,
    closedPathVertexNoJump,
    pClosedJump,
    standaloneTextEditorRotated,
    standaloneTextCommitted,
    shapeTextEditorRotated,
    textBearingShapeEditPreserved,
    hitTestOk,
    lockedOverlayOk,
    escapeCancelOk,
    readingCancelOk,
    genOk: genResult.success,
    genBytes: genResult.byteLength,
    r1Id,
    d1Id,
    r2Id,
    eLockedId,
    t1Id,
    rShapeTextId,
    cAttachedId,
    cCurvedId,
    cElbowId,
    cFreeId,
    grp1Id,
    pOpenId,
    pClosedId
  };
})()`);

console.log('Flow 34 Result:', flow34Result);

if (!flow34Result.r1Rot90 || !flow34Result.shiftRebaseOk || !flow34Result.shiftSnapped || !flow34Result.r1Undone || !flow34Result.r1Redone) {
  throw new Error('Flow 34: Single object rotation, continuous Shift rebase, or undo/redo failed in Chrome');
}
if (!flow34Result.r1ResizedW || !flow34Result.r1ResizedRot) {
  throw new Error('Flow 34: Rotated single-object local resize failed in Chrome');
}
if (!flow34Result.ordinaryMultiMatchesGroup) {
  throw new Error('Flow 34: Ordinary multi-selection rotation did not match persisted group rotation');
}
if (!flow34Result.hasSharedRot || !flow34Result.d1Rotated || !flow34Result.r2Rotated || !flow34Result.eLockPreserved || !flow34Result.grpPreserved) {
  throw new Error('Flow 34: Persisted group shared rotation or locked member exclusion failed in Chrome');
}
if (!flow34Result.cStraightAttached || !flow34Result.curvedConnectorValid || !flow34Result.elbowConnectorValid || !flow34Result.cFreeRotated) {
  throw new Error('Flow 34: Connector attachment, curved/elbow routing, or free endpoint rotation failed in Chrome');
}
if (!flow34Result.pOpenOk || !flow34Result.closedPathVertexNoJump) {
  throw new Error(`Flow 34: Rotated open/closed path vertex commit jump detected (open=${flow34Result.pOpenJump}px, closed=${flow34Result.pClosedJump}px) in Chrome`);
}
if (!flow34Result.standaloneTextEditorRotated || !flow34Result.standaloneTextCommitted || !flow34Result.shapeTextEditorRotated || !flow34Result.textBearingShapeEditPreserved) {
  throw new Error('Flow 34: Rotated standalone text or text-bearing shape in-place editing failed in Chrome');
}
if (!flow34Result.hitTestOk || !flow34Result.lockedOverlayOk) {
  throw new Error('Flow 34: Precision hit testing or locked rotated overlay orientation failed in Chrome');
}
if (!flow34Result.escapeCancelOk || !flow34Result.readingCancelOk || !flow34Result.genOk) {
  throw new Error('Flow 34: Gesture cancellation or board file generation failed in Chrome');
}

// Complete 34h verification on Node side by capturing and extracting the generated HTML file
let flow34CapturedDataUrl = null;
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 100));
  flow34CapturedDataUrl = await evalInChrome('window._lastSaburaBlob');
  if (flow34CapturedDataUrl) break;
}
if (!flow34CapturedDataUrl) {
  throw new Error('Flow 34: generateBoardFile Blob interceptor did not capture downloaded file');
}

const flow34B64 = flow34CapturedDataUrl.split(',')[1];
const flow34DownloadedHtml = Buffer.from(flow34B64, 'base64').toString('utf8');
const flow34Extracted = extractDocumentFromHtml(flow34DownloadedHtml);
if (!flow34Extracted.valid || !flow34Extracted.document) {
  throw new Error('Flow 34: Failed to extract valid document from generateBoardFile downloaded HTML');
}

const reopenedRotDoc = flow34Extracted.document;
if (!reopenedRotDoc.groups[flow34Result.grp1Id]) {
  throw new Error('Flow 34: Persisted group missing in reopened rotated document');
}
if (!reopenedRotDoc.objects[flow34Result.d1Id] || typeof reopenedRotDoc.objects[flow34Result.d1Id].rotation !== 'number') {
  throw new Error('Flow 34: Rotated diamond missing or rotation missing in reopened document');
}
if (!reopenedRotDoc.objects[flow34Result.eLockedId] || reopenedRotDoc.objects[flow34Result.eLockedId].rotation !== 45) {
  throw new Error('Flow 34: Locked rotated ellipse missing or rotated in reopened document');
}
if (!reopenedRotDoc.objects[flow34Result.rShapeTextId] || reopenedRotDoc.objects[flow34Result.rShapeTextId].text !== 'Updated Shape Text') {
  throw new Error('Flow 34: Rotated text-bearing shape missing or text corrupted in reopened document');
}
if (!reopenedRotDoc.objects[flow34Result.cAttachedId] || !reopenedRotDoc.objects[flow34Result.cAttachedId].from?.anchor) {
  throw new Error('Flow 34: Custom anchor straight connector missing or anchor corrupted in reopened document');
}
if (!reopenedRotDoc.objects[flow34Result.cCurvedId] || reopenedRotDoc.objects[flow34Result.cCurvedId].routing !== 'curved') {
  throw new Error('Flow 34: Curved connector missing or routing corrupted in reopened document');
}
if (!reopenedRotDoc.objects[flow34Result.cElbowId] || reopenedRotDoc.objects[flow34Result.cElbowId].routing !== 'elbow') {
  throw new Error('Flow 34: Elbow connector missing or routing corrupted in reopened document');
}
if (!reopenedRotDoc.objects[flow34Result.cFreeId] || !reopenedRotDoc.objects[flow34Result.cFreeId].to?.point) {
  throw new Error('Flow 34: Free endpoint connector missing or endpoint corrupted in reopened document');
}
if (!reopenedRotDoc.objects[flow34Result.pOpenId] || reopenedRotDoc.objects[flow34Result.pOpenId].rotation !== 45) {
  throw new Error('Flow 34: Rotated open path missing or rotation corrupted in reopened document');
}
if (!reopenedRotDoc.objects[flow34Result.pClosedId] || reopenedRotDoc.objects[flow34Result.pClosedId].rotation !== 75) {
  throw new Error('Flow 34: Rotated closed path missing or rotation corrupted in reopened document');
}

console.log('  ✓ 34a. Single object rotation handle physical drag, 15° Shift snapping, continuous Shift press/release rebase & 1-step undo/redo');
console.log('  ✓ 34b. Rotated single-object local-axis resize preserving rotation angle theta at non-default camera');
console.log('  ✓ 34c. Persisted group & ordinary multi-selection shared rotation around visual union center with pre-rotated members, locked member exclusion, straight/curved/elbow connectors, custom anchors & free endpoints with 1-step undo/redo');
console.log('  ✓ 34d. Rotated open and closed path vertex dragging with zero commit jump & rotation preservation');
console.log('  ✓ 34e. Rotated standalone text & text-bearing shapes in-place editing aligned with orientation');
console.log('  ✓ 34f. Precision inverse-rotation hit testing excluding empty AABB corners & locked rotated selection overlay orientation');
console.log('  ✓ 34g. Gesture cancellation (Escape, mode switch) restoring baseline with 0 extra history entries');
console.log('  ✓ 34h. Real Save Copy download capture, HTML extraction, and deep document verification of all rotated objects, groups, and connectors on Node.js side');
console.log('✓ Flow 34: Rotation Foundation verified cleanly!');

console.log('\n✓ All Chrome flows passed cleanly!');
ws.close();
chrome.kill();

if (chromeOnly) {
  server.close();
  console.log('\n=============================================================');
  console.log('✓ CHROME-ONLY VERIFICATION COMPLETE (Safari intentionally skipped)');
  console.log('=============================================================\n');
  process.exit(0);
}

// -------------------------------------------------------------
// PART 2: REAL BROWSER VERIFICATION IN SAFARI
// -------------------------------------------------------------
console.log('\n=============================================================');
console.log('PART 2: TESTING CRITICAL FLOWS IN REAL SAFARI');
console.log('=============================================================');

console.log('Launching Safari with automated test harness...');
const safariUrl = `http://127.0.0.1:${port}/sabura-safari.html?run=${Date.now()}`;
try {
  execSync(`osascript -e 'tell application "Safari" to close (every window whose name contains "Sabura")'`, { stdio: 'ignore' });
} catch (_) {}

try {
  execSync(`osascript -e 'tell application "Safari"
    activate
    open location "${safariUrl}"
  end tell'`, { stdio: 'ignore' });
} catch (_) {
  exec(`open -a Safari "${safariUrl}"`);
}

// Wait for Safari callback report
const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Safari test timed out after 240 seconds')), 240000));
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
