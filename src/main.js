/**
 * Sabura Main Application Entrypoint.
 * 
 * Coordinates the functional core, SVG renderer, contextual circular tool wheel,
 * top bar, keyboard shortcuts, presentation mode, and offline file persistence.
 */

import { createDefaultDocument, createDefaultObject, canonicalJson, validateDocument, cloneDocument } from './core/document.js';
import { applyCommand, applyCommandBatch, validateCommand } from './core/commands.js';
import { THEME_PRESETS, FONT_SIZES } from './core/types.js';
import { packageHtmlWithDocument, triggerFileDownload, extractDocumentFromHtml } from './storage/file-packer.js';
import { Workspace } from './ui/workspace.js';
import { ToolWheel } from './ui/wheel.js';
import { TopBar } from './ui/topbar.js';
import { TextEditor } from './ui/text-editor.js';
import { ShortcutsCoordinator } from './ui/shortcuts.js';
import { ZoomToolbar } from './ui/zoom-toolbar.js';
import { HelpModal } from './ui/help-modal.js';
import { LaserPointer } from './renderer/laser.js';

export class SaburaApp {
  constructor() {
    this.doc = null;
    this.status = 'Clean'; // 'Clean' | 'Changed' | 'Preparing copy' | 'Copy requested' | 'Error'
    this.interfaceTheme = localStorage.getItem('sabura_ui_theme') || 'system';
    this.undoStack = [];
    this.redoStack = [];
    this.subscribers = new Set();
    this.inPresentation = false;

    this.initDocument();
    this.initDOM();
    this.initServices();
    this.applyInterfaceTheme(this.interfaceTheme);
    this.exposeApi();
  }

  initDocument() {
    const seamScript = document.getElementById('sabura-document');
    if (seamScript && seamScript.textContent.trim()) {
      try {
        const parsed = JSON.parse(seamScript.textContent);
        const val = validateDocument(parsed);
        if (val.valid) {
          this.doc = parsed;
          return;
        }
        console.warn('Embedded document validation failed:', val.errors);
      } catch (err) {
        console.error('Failed to parse embedded document seam:', err);
      }
    }
    // Fallback to initial default board
    this.doc = createDefaultDocument({ title: 'Sabura Board' });
  }

  initDOM() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div id="canvas-container"></div>
      <canvas id="laser-canvas"></canvas>
      <button class="wheel-trigger-fab" id="btn-wheel-fab" title="Open Tool Wheel (Shortcut: Q or Right-Click)">
        <span>Wheel</span>
        <span class="fab-key">Q</span>
      </button>
    `;

    this.canvasContainer = document.getElementById('canvas-container');
    this.laserCanvas = document.getElementById('laser-canvas');
    this.wheelFab = document.getElementById('btn-wheel-fab');
  }

  initServices() {
    // Laser pointer
    this.laser = new LaserPointer(this.laserCanvas);

    // Workspace
    this.workspace = new Workspace(this.canvasContainer, {
      getDocument: () => this.doc,
      onCommand: (cmd) => this.dispatchCommand(cmd),
      onCommandBatch: (cmds) => this.dispatchCommandBatch(cmds),
      onOpenWheel: (x, y, context, selectedObj) => {
        this.wheel.open(x, y, context, selectedObj, this.doc.theme.palette, this.workspace.selectedIds.length);
      },
      onDoubleClickedObject: (obj) => {
        if (!obj.locked && obj.type !== 'connector') {
          this.textEditor.open(obj, this.workspace.camera);
        }
      },
      onZoomChange: (zoom) => {
        this.zoomToolbar?.setZoom(zoom);
      }
    });

    // In-place text editor
    this.textEditor = new TextEditor(document.getElementById('app'), (objId, newText) => {
      const obj = this.doc.objects[objId];
      if (!newText || !newText.trim()) {
        if (obj && obj.type === 'text') {
          this.dispatchCommand({
            type: 'delete_objects',
            ids: [objId]
          });
          this.workspace.selectedIds = [];
          this.workspace.render();
          return;
        }
      }
      this.dispatchCommand({
        type: 'set_text',
        id: objId,
        text: newText
      });
    });

    // Contextual circular tool wheel
    this.wheel = new ToolWheel(document.getElementById('app'), (actionId, payload) => {
      this.handleWheelAction(actionId, payload);
    });

    // Top Bar
    this.topbar = new TopBar(document.getElementById('app'), {
      onSetBoardTheme: (themeId) => this.setBoardTheme(themeId),
      onSetInterfaceTheme: (uiTheme) => this.setInterfaceTheme(uiTheme),
      onToggleGridVisible: () => this.toggleGridVisible(),
      onToggleGridSnap: () => this.toggleGridSnap(),
      onToggleFullscreen: () => this.toggleFullscreen(),
      onPresent: () => this.enterPresentation(),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onSaveCopy: () => this.saveCopy()
    });

    // Help Modal
    this.helpModal = new HelpModal(document.getElementById('app'));

    // Zoom Toolbar
    this.zoomToolbar = new ZoomToolbar(document.getElementById('app'), {
      onZoomOut: () => this.workspace.zoomOut(),
      onZoomIn: () => this.workspace.zoomIn(),
      onResetZoom: () => this.workspace.resetZoom(),
      onFit: () => this.workspace.fitToContent(60),
      onOpenHelp: () => this.helpModal.toggle()
    });

    // Shortcuts coordinator
    this.shortcuts = new ShortcutsCoordinator({
      isTextEditing: () => Boolean(this.textEditor?.activeEditor),
      onTriggerWheel: (x, y) => {
        if (this.wheel.isOpen) {
          this.wheel.close();
          return;
        }
        let hit = null;
        let context = 'canvas';
        if (this.workspace.selectedIds.length === 1) {
          hit = this.doc.objects[this.workspace.selectedIds[0]];
          context = 'object';
        } else if (this.workspace.selectedIds.length > 1) {
          context = 'multi';
        } else {
          const worldPt = this.workspace.screenToWorld(x, y);
          hit = this.workspace.findObjectAt(worldPt);
          if (hit) {
            this.workspace.selectedIds = [hit.id];
            this.workspace.render();
            context = 'object';
          }
        }
        this.wheel.open(x, y, context, hit, this.doc.theme.palette, this.workspace.selectedIds.length);
      },
      onSelectTool: (tool) => this.workspace.setTool(tool),
      onSpaceHold: (held) => {
        this.workspace.spaceHeld = held;
        this.workspace.updateCursor();
      },
      onEditText: () => {
        if (this.workspace.selectedIds.length === 1) {
          const obj = this.doc.objects[this.workspace.selectedIds[0]];
          if (obj && !obj.locked && obj.type !== 'connector') {
            this.textEditor.open(obj, this.workspace.camera);
          }
        }
      },
      onDHold: (held) => {
        this.workspace.setDHold(held);
      },
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onDuplicate: () => {
        if (this.workspace.selectedIds.length > 0) {
          this.dispatchCommand({
            type: 'duplicate_objects',
            ids: this.workspace.selectedIds
          });
        }
      },
      onDelete: () => {
        if (this.workspace.selectedIds.length > 0) {
          this.dispatchCommand({
            type: 'delete_objects',
            ids: this.workspace.selectedIds
          });
          this.workspace.selectedIds = [];
        }
      },
      onSelectAll: () => {
        this.workspace.selectedIds = Object.keys(this.doc.objects);
        this.workspace.render();
      },
      onNudge: (dx, dy) => {
        if (this.workspace.selectedIds.length > 0) {
          this.dispatchCommand({
            type: 'move_objects',
            ids: this.workspace.selectedIds,
            dx,
            dy
          });
        }
      },
      onZoomIn: () => this.workspace.zoomIn(),
      onZoomOut: () => this.workspace.zoomOut(),
      onResetZoom: () => this.workspace.resetZoom(),
      onFitContent: () => this.workspace.fitToContent(60),
      onToggleHelp: () => this.helpModal.toggle(),
      onEscape: () => {
        if (this.helpModal?.isOpen) {
          this.helpModal.close();
        } else if (this.inPresentation) {
          this.exitPresentation();
        } else if (this.wheel.isOpen) {
          this.wheel.close();
        } else if (this.textEditor?.activeEditor) {
          this.textEditor.close(true);
        } else if (this.workspace.isDraggingSelection || this.workspace.isResizing || this.workspace.isReconnecting || this.workspace.isCreating) {
          this.workspace.cancelGesture();
        } else if (this.workspace.selectedIds.length > 0) {
          this.workspace.selectedIds = [];
          this.workspace.render();
        } else if (this.workspace.activeTool !== 'hand') {
          this.workspace.setTool('hand');
        }
      }
    });

    // FAB trigger
    this.wheelFab.addEventListener('click', (e) => {
      e.stopPropagation();
      this.wheel.open(window.innerWidth / 2, window.innerHeight / 2, 'canvas', null, this.doc.theme.palette, this.workspace.selectedIds.length);
    });

    // Track presentation laser pointer
    window.addEventListener('pointermove', (e) => {
      if (this.inPresentation) {
        this.laser.addPoint(e.clientX, e.clientY);
      }
    });

    // Fullscreen change listener to sync presentation exit and re-sync canvas size
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && this.inPresentation) {
        this.exitPresentation();
      } else if (this.inPresentation) {
        this.laser.resize();
        this.workspace.fitToContent(80);
      }
    });

    // Unsaved changes warning
    window.addEventListener('beforeunload', (e) => {
      if (this.status === 'Changed') {
        e.preventDefault();
        e.returnValue = 'You have unsaved whiteboard changes. Download a copy to save them.';
        return e.returnValue;
      }
    });

    // Initial render
    this.updateUI();
  }

  dispatchCommand(cmd) {
    const { doc: newDoc, inverseCmd } = applyCommand(this.doc, cmd);
    this.doc = newDoc;
    if (inverseCmd && inverseCmd.type !== 'noop') {
      this.undoStack.push(inverseCmd);
      this.redoStack = []; // Clear redo on new action
    }
    this.status = 'Changed';
    this.updateUI();
    this.notifySubscribers();
  }

  dispatchCommandBatch(cmds) {
    const { doc: newDoc, inverseCmd } = applyCommandBatch(this.doc, cmds);
    this.doc = newDoc;
    if (inverseCmd && inverseCmd.type !== 'noop') {
      this.undoStack.push(inverseCmd);
      this.redoStack = [];
    }
    this.status = 'Changed';
    this.updateUI();
    this.notifySubscribers();
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    const inv = this.undoStack.pop();
    const { doc: newDoc, inverseCmd: redoCmd } = applyCommand(this.doc, inv);
    this.doc = newDoc;
    if (redoCmd && redoCmd.type !== 'noop') {
      this.redoStack.push(redoCmd);
    }
    this.status = 'Changed';
    this.updateUI();
    this.notifySubscribers();
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    const redoCmd = this.redoStack.pop();
    const { doc: newDoc, inverseCmd: undoCmd } = applyCommand(this.doc, redoCmd);
    this.doc = newDoc;
    if (undoCmd && undoCmd.type !== 'noop') {
      this.undoStack.push(undoCmd);
    }
    this.status = 'Changed';
    this.updateUI();
    this.notifySubscribers();
    return true;
  }

  handleWheelAction(actionId, payload) {
    const selectedIds = this.workspace.selectedIds;

    // Creation & Mode Tools
    if (actionId === 'tool_select') this.workspace.setTool('select');
    else if (actionId === 'tool_hand') this.workspace.setTool('hand');
    else if (actionId === 'tool_draw') this.workspace.setTool('draw');
    else if (actionId === 'tool_text') this.workspace.setTool('text');
    else if (actionId.startsWith('shape_')) {
      const type = actionId.replace('shape_', '');
      this.workspace.setTool(type);
    } else if (actionId === 'conn_straight') {
      this.workspace.setConnectorRouting('straight');
      this.workspace.setTool('connector');
    } else if (actionId === 'conn_elbow') {
      this.workspace.setConnectorRouting('elbow');
      this.workspace.setTool('connector');
    } else if (actionId === 'conn_curved') {
      this.workspace.setConnectorRouting('curved');
      this.workspace.setTool('connector');
    } else if (actionId === 'action_undo') {
      this.undo();
    } else if (actionId === 'action_redo') {
      this.redo();
    } else if (actionId === 'action_delete') {
      if (selectedIds.length > 0) {
        this.dispatchCommand({ type: 'delete_objects', ids: selectedIds });
        this.workspace.selectedIds = [];
      }
    } else if (actionId === 'action_duplicate') {
      if (selectedIds.length > 0) {
        this.dispatchCommand({ type: 'duplicate_objects', ids: selectedIds });
      }
    } else if (actionId === 'action_lock' || actionId === 'action_unlock') {
      const lock = actionId === 'action_lock';
      this.dispatchCommand({ type: 'lock_objects', ids: selectedIds, locked: lock });
    } else if (actionId === 'action_group') {
      this.dispatchCommand({ type: 'group_objects', ids: selectedIds });
    } else if (actionId === 'action_ungroup') {
      const groupIds = Array.from(new Set(selectedIds.map(id => this.doc.objects[id]?.groupId).filter(Boolean)));
      this.dispatchCommand({ type: 'ungroup_objects', groupIds });
    } else if (actionId === 'action_connect') {
      this.workspace.setTool('connector');
    } else if (actionId.startsWith('order_')) {
      const action = actionId.replace('order_', ''); // 'forward'|'backward'|'front'|'back'
      this.dispatchCommand({ type: 'reorder_objects', ids: selectedIds, action });
    } else if (actionId.startsWith('fill_')) {
      const col = payload.color;
      this.dispatchCommand({ type: 'set_style', ids: selectedIds, updates: { fill: col } });
    } else if (actionId.startsWith('ink_')) {
      const col = payload.color;
      this.dispatchCommand({ type: 'set_style', ids: selectedIds, updates: { stroke: col } });
    } else if (actionId.startsWith('opacity_')) {
      const val = payload.value;
      this.dispatchCommand({ type: 'set_style', ids: selectedIds, updates: { opacity: val } });
    } else if (actionId.startsWith('type_')) {
      if (payload.size) {
        this.dispatchCommand({ type: 'set_typography', ids: selectedIds, updates: { size: payload.size } });
      } else if (payload.toggleBold) {
        const anyBold = selectedIds.some(id => this.doc.objects[id]?.textStyle?.bold);
        this.dispatchCommand({ type: 'set_typography', ids: selectedIds, updates: { bold: !anyBold } });
      } else if (payload.cycleAlign) {
        const firstAlign = this.doc.objects[selectedIds[0]]?.textStyle?.align || 'center';
        const nextAlign = firstAlign === 'left' ? 'center' : (firstAlign === 'center' ? 'right' : 'left');
        this.dispatchCommand({ type: 'set_typography', ids: selectedIds, updates: { align: nextAlign } });
      }
    } else if (actionId.startsWith('font_')) {
      const family = payload.fontFamily || actionId.replace('font_', '');
      this.dispatchCommand({ type: 'set_typography', ids: selectedIds, updates: { fontFamily: family } });
    } else if (actionId.startsWith('conn_route_')) {
      const routing = payload.routing || actionId.replace('conn_route_', '');
      for (const id of selectedIds) {
        this.dispatchCommand({ type: 'configure_connector', id, routing });
      }
    } else if (actionId.startsWith('conn_arrows_')) {
      for (const id of selectedIds) {
        this.dispatchCommand({
          type: 'configure_connector',
          id,
          startArrow: payload.startArrow,
          endArrow: payload.endArrow
        });
      }
    } else if (actionId === 'conn_points_auto') {
      const cmds = [];
      for (const id of selectedIds) {
        const conn = this.doc.objects[id];
        if (conn && conn.type === 'connector') {
          if (conn.from?.id && conn.from.anchor) {
            cmds.push({ type: 'reconnect_connector', id, endpoint: 'from', target: { id: conn.from.id } });
          }
          if (conn.to?.id && conn.to.anchor) {
            cmds.push({ type: 'reconnect_connector', id, endpoint: 'to', target: { id: conn.to.id } });
          }
        }
      }
      if (cmds.length > 0) {
        this.dispatchCommandBatch(cmds);
      }
    } else if (actionId === 'conn_points_auto_from') {
      const cmds = [];
      for (const id of selectedIds) {
        const conn = this.doc.objects[id];
        if (conn && conn.type === 'connector' && conn.from?.id && conn.from.anchor) {
          cmds.push({ type: 'reconnect_connector', id, endpoint: 'from', target: { id: conn.from.id } });
        }
      }
      if (cmds.length > 0) {
        this.dispatchCommandBatch(cmds);
      }
    } else if (actionId === 'conn_points_auto_to') {
      const cmds = [];
      for (const id of selectedIds) {
        const conn = this.doc.objects[id];
        if (conn && conn.type === 'connector' && conn.to?.id && conn.to.anchor) {
          cmds.push({ type: 'reconnect_connector', id, endpoint: 'to', target: { id: conn.to.id } });
        }
      }
      if (cmds.length > 0) {
        this.dispatchCommandBatch(cmds);
      }
    } else if (actionId === 'action_reconnect') {
      if (selectedIds.length === 1 && this.doc.objects[selectedIds[0]]?.type === 'connector') {
        this.workspace.render();
      }
    } else if (actionId.startsWith('to_')) {
      if (actionId === 'to_equal_sides') {
        for (const id of selectedIds) {
          const obj = this.doc.objects[id];
          if (!obj) continue;
          const maxDim = Math.max(obj.width, obj.height);
          this.dispatchCommand({
            type: 'resize_object',
            id,
            bounds: { x: obj.x, y: obj.y, width: maxDim, height: maxDim }
          });
        }
      } else {
        const newType = actionId.replace('to_', '');
        for (const id of selectedIds) {
          this.dispatchCommand({ type: 'change_shape', id, newType });
        }
      }
    } else if (actionId === 'style_sketch') {
      this.dispatchCommand({ type: 'set_style', ids: selectedIds, updates: { roughness: 1 } });
    } else if (actionId === 'style_clean') {
      this.dispatchCommand({ type: 'set_style', ids: selectedIds, updates: { roughness: 0 } });
    } else if (actionId === 'stroke_solid') {
      this.dispatchCommand({ type: 'set_style', ids: selectedIds, updates: { strokeStyle: 'solid' } });
    } else if (actionId === 'stroke_dashed') {
      this.dispatchCommand({ type: 'set_style', ids: selectedIds, updates: { strokeStyle: 'dashed' } });
    } else if (actionId === 'stroke_dotted') {
      this.dispatchCommand({ type: 'set_style', ids: selectedIds, updates: { strokeStyle: 'dotted' } });
    } else if (actionId.startsWith('align_')) {
      const alignment = actionId.replace('align_', '');
      this.dispatchCommand({ type: 'align_objects', ids: selectedIds, alignment });
    } else if (actionId === 'dist_h') {
      this.dispatchCommand({ type: 'distribute_objects', ids: selectedIds, direction: 'horizontal' });
    } else if (actionId === 'dist_v') {
      this.dispatchCommand({ type: 'distribute_objects', ids: selectedIds, direction: 'vertical' });
    }
  }

  setBoardTheme(themeId) {
    if (!THEME_PRESETS[themeId]) return;
    const preset = THEME_PRESETS[themeId];
    this.dispatchCommand({
      type: 'set_board_theme',
      theme: {
        id: preset.id,
        background: preset.background,
        gridColor: preset.gridColor,
        palette: [...preset.palette],
        defaultFill: preset.defaultFill,
        defaultStroke: preset.defaultStroke,
        defaultStrokeWidth: preset.defaultStrokeWidth,
        defaultOpacity: preset.defaultOpacity,
        defaultRoughness: preset.defaultRoughness,
        defaultFontFamily: preset.defaultFontFamily,
        defaultFontSize: preset.defaultFontSize
      }
    });
  }

  setInterfaceTheme(theme) {
    this.interfaceTheme = theme;
    localStorage.setItem('sabura_ui_theme', theme);
    this.applyInterfaceTheme(theme);
    this.updateUI();
  }

  applyInterfaceTheme(theme) {
    document.documentElement.setAttribute('data-ui-theme', theme);
  }

  toggleGridVisible() {
    this.workspace.setShowGrid(!this.workspace.showGrid);
    this.updateUI();
  }

  toggleGridSnap() {
    this.workspace.setSnapGrid(!this.workspace.snapGrid);
    this.updateUI();
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      try {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      } catch (_) {}
    } else {
      try {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      } catch (_) {}
    }
  }

  enterPresentation() {
    this.prePresentationCamera = { ...this.workspace.camera };
    this.textEditor.close(true);
    this.workspace.selectedIds = [];
    this.wheel.close();
    this.helpModal?.close();
    this.inPresentation = true;
    document.body.classList.add('in-presentation');

    this.workspace.fitToContent(80);
    this.laser.start();

    // Request fullscreen (gracefully degrades inside tab if disallowed)
    try {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().then(() => {
          if (this.inPresentation) {
            this.laser.resize();
            this.workspace.fitToContent(80);
          }
        }).catch(() => {});
      }
    } catch (_) {}

    setTimeout(() => {
      if (this.inPresentation) {
        this.laser.resize();
      }
    }, 120);
  }

  exitPresentation() {
    this.inPresentation = false;
    document.body.classList.remove('in-presentation');
    this.laser.stop();
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    // Restore previous zoom and viewport
    if (this.prePresentationCamera) {
      this.workspace.camera = { ...this.prePresentationCamera };
      this.prePresentationCamera = null;
    }
    // Return to Hand/Pan mode
    this.workspace.setTool('hand');
    this.workspace.render();
  }

  getCleanHtmlShell() {
    const clone = document.documentElement.cloneNode(true);
    clone.removeAttribute('class');
    const body = clone.querySelector('body');
    if (body) {
      body.removeAttribute('class');
      const appEl = body.querySelector('#app');
      if (appEl) appEl.innerHTML = '';
    }
    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  saveCopy() {
    this.status = 'Preparing copy';
    this.updateUI();

    try {
      // Reconstruct self-contained HTML from clean application shell
      const cleanShell = this.getCleanHtmlShell();
      const packResult = packageHtmlWithDocument(cleanShell, this.doc);

      if (!packResult.success) {
        alert('Failed to package document: ' + packResult.error);
        this.status = 'Error';
        this.updateUI();
        return;
      }

      this.status = 'Copy requested';
      this.updateUI();

      const safeTitle = (this.doc.title || 'whiteboard').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const filename = `sabura-${safeTitle}-${Date.now().toString(36)}.html`;

      triggerFileDownload(filename, packResult.html);

      setTimeout(() => {
        this.status = 'Clean';
        this.updateUI();
      }, 500);
    } catch (err) {
      console.error('Save Copy failed:', err);
      this.status = 'Error';
      this.updateUI();
    }
  }

  updateUI() {
    this.topbar.update(this.doc, this.status, this.interfaceTheme, this.workspace.snapGrid, this.workspace.showGrid);
    this.workspace.render();
  }

  notifySubscribers() {
    for (const sub of this.subscribers) {
      try {
        sub(this.doc, this.status);
      } catch (err) {
        console.error('Subscriber error:', err);
      }
    }
  }

  exposeApi() {
    window.sabura = {
      getDocument: () => cloneDocument(this.doc),
      applyCommands: (commands) => {
        if (!Array.isArray(commands)) {
          return { success: false, errors: ['Commands must be an array'] };
        }
        // 1. Validate commands upfront
        const validationErrors = [];
        for (let i = 0; i < commands.length; i++) {
          const val = validateCommand(commands[i]);
          if (!val.valid) {
            validationErrors.push(`Command [${i}] (${commands[i]?.type || 'unknown'}): ${val.errors.join(', ')}`);
          }
        }
        if (validationErrors.length > 0) {
          return { success: false, errors: validationErrors };
        }

        // 2. Apply batch atomically on a test copy first
        try {
          const testDoc = cloneDocument(this.doc);
          const { doc: finalDoc, inverseCmd } = applyCommandBatch(testDoc, commands);
          this.doc = finalDoc;
          if (inverseCmd && inverseCmd.type !== 'noop') {
            this.undoStack.push(inverseCmd);
            this.redoStack = [];
          }
          this.status = 'Changed';
          this.updateUI();
          this.notifySubscribers();
          return { success: true, document: cloneDocument(this.doc) };
        } catch (err) {
          return { success: false, errors: [err.message] };
        }
      },
      exportCanonicalJson: () => canonicalJson(this.doc),
      undo: () => this.undo(),
      redo: () => this.redo(),
      subscribe: (listener) => {
        this.subscribers.add(listener);
        return () => this.subscribers.delete(listener);
      }
    };
  }
}

// Auto-bootstrap when loaded in browser
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const startApp = () => {
    if (!window.saburaApp) {
      try {
        window.saburaApp = new SaburaApp();
      } catch (err) {
        console.error('Fatal startup error in SaburaApp:', err);
        document.body.innerHTML = '<div style="color: #c92a2a; font-family: monospace; font-size: 16px; padding: 24px; background: #fff5f5; border: 2px solid #ffc9c9; margin: 20px; border-radius: 8px;"><strong>Fatal Sabura Startup Error:</strong><pre style="white-space: pre-wrap; margin-top: 12px;">' + (err.stack || err.message || err) + '</pre></div>';
      }
    }
  };
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', startApp);
  } else {
    startApp();
  }
}
