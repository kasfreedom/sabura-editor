/**
 * Sabura Main Application Entrypoint.
 *
 * Coordinates the functional core, SVG renderer, contextual circular tool wheel,
 * top bar, keyboard shortcuts, presentation mode, and offline file persistence.
 */

import {
  createDefaultDocument,
  createDefaultObject,
  canonicalJson,
  validateDocument,
  normalizeDocument,
  cloneDocument,
  generateId,
  generateSeed,
  validateRasterDataUrl,
  REVISION_EXTENSION_KEY,
  computeContentDigest,
  getShortRevisionId,
  transitionRevision
} from './core/document.js';
import { applyCommand, applyCommandBatch, validateCommand } from './core/commands.js';
import { THEME_PRESETS, FONT_SIZES, RASTER_MIME_TYPES, MAX_IMAGE_SOURCE_BYTES, MAX_IMAGE_AXIS, MAX_IMAGE_PIXELS } from './core/types.js';
import { resolveConnectorGeometry } from './core/geometry.js';
import { packageHtmlWithDocument, triggerFileDownload, extractDocumentFromHtml, sanitizeFilenameTitle } from './storage/file-packer.js';
import { Workspace } from './ui/workspace.js';
import { ToolWheel } from './ui/wheel.js';
import { TopBar } from './ui/topbar.js';
import { TextEditor } from './ui/text-editor.js';
import { ShortcutsCoordinator } from './ui/shortcuts.js';
import { ZoomToolbar } from './ui/zoom-toolbar.js';
import { renderSaburaIcon } from './ui/wheel-icon-map.js';
import { HelpModal } from './ui/help-modal.js';
import { LaserPointer } from './renderer/laser.js';
import { AgentApi } from './agent-api.js';

export class SaburaApp {
  constructor() {
    this.doc = null;
    this.status = 'Clean'; // 'Clean' | 'Changed' | 'Preparing copy' | 'Copy requested' | 'Error'
    this.mode = 'reading'; // 'reading' | 'editing'
    this.exportBaseline = null;
    this.isSaving = false;
    this.prePresentationMode = 'reading';
    this.interfaceTheme = (typeof localStorage !== 'undefined' ? localStorage.getItem('sabura_ui_theme') : null) || 'system';
    this.undoStack = [];
    this.redoStack = [];
    this.subscribers = new Set();
    this.inPresentation = false;
    this.clipboard = null;
    this.clipboardAssets = {};
    this.pasteCount = 0;
    this.imageImportToken = 0;
    this.pendingImageReader = null;
    this.pendingImageDecode = null;
    this.originalHtml = '';
    this.isCorrupted = false;
    this.loadErrors = [];
    this.agentApi = new AgentApi(this);

    this.initDocument();
    if (this.isCorrupted) {
      this.renderCorruptedState();
      this.exposeApi();
      return;
    }
    this.initDOM();
    this.initServices();
    this.applyInterfaceTheme(this.interfaceTheme);
    this.exposeApi();
  }

  initDocument() {
    this.originalHtml = (typeof document !== 'undefined' && document.documentElement) ? document.documentElement.outerHTML : '';
    const seamScript = (typeof document !== 'undefined') ? document.getElementById('sabura-document') : null;
    if (!seamScript) {
      this.isCorrupted = true;
      this.loadErrors = ['Missing required <script id="sabura-document"> seam in HTML file'];
      console.error('Fatal document error: missing #sabura-document seam');
      return;
    }

    const seamContent = seamScript.textContent ? seamScript.textContent.trim() : '';
    if (!seamContent) {
      this.isCorrupted = true;
      this.loadErrors = ['Embedded <script id="sabura-document"> seam is empty'];
      console.error('Fatal document error: empty #sabura-document seam');
      return;
    }

    try {
      const parsed = JSON.parse(seamContent);
      const val = validateDocument(parsed, { verifyDigest: true });
      if (val.valid) {
        this.doc = normalizeDocument(parsed);
        if (this.doc[REVISION_EXTENSION_KEY]) {
          this.exportBaseline = { ...this.doc[REVISION_EXTENSION_KEY] };
        } else {
          this.exportBaseline = null;
        }
        const objCount = Object.keys(this.doc.objects || {}).length;
        this.mode = objCount === 0 ? 'editing' : 'reading';
        return;
      }
      this.isCorrupted = true;
      this.loadErrors = val.errors;
      console.warn('Embedded document validation failed:', val.errors);
      return;
    } catch (err) {
      this.isCorrupted = true;
      this.loadErrors = [`JSON parse error in document seam: ${err.message}`];
      console.error('Failed to parse embedded document seam:', err);
      return;
    }
  }

  renderCorruptedState() {
    if (typeof document === 'undefined') return;
    const app = document.getElementById('app');
    if (!app) return;
    const escape = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const errorsList = this.loadErrors.map(e => `<li style="margin-bottom: 4px;">${escape(e)}</li>`).join('');
    app.innerHTML = `
      <div class="sabura-corrupted-overlay" style="display: flex; align-items: center; justify-content: center; width: 100vw; height: 100vh; background: #18181b; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; box-sizing: border-box;">
        <div class="sabura-error-panel" style="max-width: 680px; width: 100%; background: #27272a; border: 1px solid #ef4444; border-radius: 8px; padding: 24px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 14px;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <h2 style="margin: 0; font-size: 18px; font-weight: 600; color: #fca5a5;">Document Validation Error</h2>
          </div>
          <p style="margin: 0 0 14px 0; font-size: 14px; line-height: 1.5; color: #d4d4d8;">
            The embedded document in this file is corrupted or contains invalid data. To protect the integrity of your board, the canvas visual editor was not initialized and <strong>Save Copy</strong> has been disabled.
          </p>
          <div style="max-height: 260px; overflow-y: auto; background: #18181b; border: 1px solid #3f3f46; border-radius: 6px; padding: 14px; margin-bottom: 14px;">
            <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #f87171; line-height: 1.6; font-family: 'SF Mono', Menlo, monospace;">
              ${errorsList}
            </ul>
          </div>
          <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
            The original file content has been preserved unmodified in memory.
          </p>
        </div>
      </div>
    `;
  }

  initDOM() {
    const app = document.getElementById('app');
    this.appElement = app;
    app.setAttribute('data-sabura-vs-board-theme', this.doc?.theme?.id || 'custom');
    app.innerHTML = `
      <div id="canvas-container"></div>
      <canvas id="laser-canvas"></canvas>
      <button class="wheel-trigger-fab" id="btn-wheel-fab" title="Open Tool Wheel (Shortcut: Q or Right-Click)">
        ${renderSaburaIcon('wheel')}<span>Wheel</span>
        <span class="fab-key">Q</span>
      </button>
      <input id="image-file-input" type="file" accept="image/png,image/jpeg,image/webp" hidden>
    `;

    this.canvasContainer = document.getElementById('canvas-container');
    this.laserCanvas = document.getElementById('laser-canvas');
    this.wheelFab = document.getElementById('btn-wheel-fab');
    this.imageFileInput = document.getElementById('image-file-input');
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
        if (this.mode === 'reading') return;
        this.imageImportPoint = this.workspace.screenToWorld(x, y);
        const selectedObjects = this.workspace.selectedIds.map(id => this.doc.objects[id]).filter(Boolean);
        this.wheel.open(x, y, context, selectedObj, this.doc.theme.palette, this.workspace.selectedIds.length, selectedObjects);
      },
      onDoubleClickedObject: (obj) => {
        if (this.mode === 'reading') return;
        if (!obj.locked && obj.type !== 'connector' && obj.type !== 'image') {
          this.textEditor.open(obj, this.workspace.camera, this.doc.theme);
        }
      },
      onZoomChange: (zoom) => {
        this.zoomToolbar?.setZoom(zoom);
      }
    });
    this.workspace.setMode(this.mode);

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

    this.imageFileInput?.addEventListener('change', () => {
      const file = this.imageFileInput.files?.[0] || null;
      this.imageFileInput.value = '';
      if (file) this.importImageFile(file, this.imageImportPoint);
    });
    this.appElement.addEventListener('dragover', (event) => this.handleImageDragOver(event));
    this.appElement.addEventListener('dragleave', (event) => this.handleImageDragLeave(event));
    this.appElement.addEventListener('drop', (event) => this.handleImageDrop(event));

    // Top Bar
    this.topbar = new TopBar(document.getElementById('app'), {
      onSetMode: (mode) => this.setMode(mode),
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
      isReadingMode: () => this.mode === 'reading' || Boolean(this.inPresentation),
      isTextEditing: () => Boolean(this.textEditor?.targetObject !== null || this.textEditor?.textarea?.style.display === 'block'),
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
        const selectedObjects = this.workspace.selectedIds.map(id => this.doc.objects[id]).filter(Boolean);
        this.imageImportPoint = this.workspace.screenToWorld(x, y);
        this.wheel.open(x, y, context, hit, this.doc.theme.palette, this.workspace.selectedIds.length, selectedObjects);
      },
      onSelectTool: (tool) => this.workspace.setTool(tool),
      onImportImage: (x, y) => {
        this.imageImportPoint = this.workspace.screenToWorld(x, y);
        this.imageFileInput?.click();
      },
      onSpaceHold: (held) => {
        this.workspace.spaceHeld = held;
        this.workspace.updateCursor();
      },
      onEditText: () => {
        if (this.workspace.selectedIds.length === 1) {
          const obj = this.doc.objects[this.workspace.selectedIds[0]];
          if (obj && !obj.locked && obj.type !== 'connector' && obj.type !== 'image') {
            this.textEditor.open(obj, this.workspace.camera, this.doc.theme);
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
      onCopy: () => this.copy(),
      onCut: () => this.cut(),
      onPaste: () => this.paste(),
      onFlipCurve: () => {
        for (const id of this.workspace.selectedIds) {
          const conn = this.doc.objects[id];
          if (conn && conn.type === 'connector') {
            if (conn.routing === 'curved') {
              const curSide = conn.curveSide !== undefined ? conn.curveSide : 1;
              this.dispatchCommand({ type: 'configure_connector', id, curveSide: curSide === -1 ? 1 : -1 });
            } else if (conn.routing === 'elbow') {
              if (conn.elbowOffset !== undefined && conn.elbowOffset !== null) {
                this.dispatchCommand({ type: 'configure_connector', id, elbowOffset: -conn.elbowOffset });
              } else {
                this.dispatchCommand({ type: 'configure_connector', id, elbowOffset: 80 });
              }
            }
          }
        }
      },
      onEqualSides: () => {
        const shapeTypes = ['rectangle', 'ellipse', 'diamond', 'triangle'];
        const targetIds = this.workspace.selectedIds.filter(id => {
          const obj = this.doc.objects[id];
          return obj && shapeTypes.includes(obj.type) && !obj.locked;
        });
        if (targetIds.length === 0) return false;

        const commands = targetIds.map(id => {
          const obj = this.doc.objects[id];
          const maxDim = Math.max(obj.width, obj.height);
          return {
            type: 'resize_object',
            id,
            bounds: { x: obj.x, y: obj.y, width: maxDim, height: maxDim }
          };
        });

        if (commands.length === 1) {
          this.dispatchCommand(commands[0]);
        } else if (commands.length > 1) {
          this.dispatchCommandBatch(commands);
        }
        return true;
      },
      onGroup: () => {
        if (this.workspace.selectedIds.length > 1) {
          this.dispatchCommand({ type: 'group_objects', ids: this.workspace.selectedIds });
        }
      },
      onUngroup: () => {
        const groupIds = Array.from(new Set(this.workspace.selectedIds.map(id => this.doc.objects[id]?.groupId).filter(Boolean)));
        if (groupIds.length > 0) {
          this.dispatchCommand({ type: 'ungroup_objects', groupIds });
        }
      },
      onBringForward: () => {
        if (this.workspace.selectedIds.length > 0) {
          this.dispatchCommand({ type: 'reorder_objects', ids: this.workspace.selectedIds, action: 'forward' });
        }
      },
      onBringToFront: () => {
        if (this.workspace.selectedIds.length > 0) {
          this.dispatchCommand({ type: 'reorder_objects', ids: this.workspace.selectedIds, action: 'front' });
        }
      },
      onSendBackward: () => {
        if (this.workspace.selectedIds.length > 0) {
          this.dispatchCommand({ type: 'reorder_objects', ids: this.workspace.selectedIds, action: 'backward' });
        }
      },
      onSendToBack: () => {
        if (this.workspace.selectedIds.length > 0) {
          this.dispatchCommand({ type: 'reorder_objects', ids: this.workspace.selectedIds, action: 'back' });
        }
      },
      onSelectAll: () => {
        this.workspace.activeGroupId = null;
        this.workspace.selectedIds = Object.values(this.doc.objects)
          .filter(o => !o.locked)
          .map(o => o.id);
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
      onEnter: () => {
        if (this.workspace.isDrawingLine) {
          this.workspace.finishLine(false);
        }
      },
      onEscape: () => {
        if (this.workspace.isDrawingLine) {
          this.workspace.cancelLine();
        } else if (this.helpModal?.isOpen) {
          this.helpModal.close();
        } else if (this.inPresentation) {
          this.exitPresentation();
        } else if (this.wheel.isOpen) {
          this.wheel.close();
        } else if (this.textEditor?.activeEditor) {
          this.textEditor.close(true);
        } else if (this.workspace.isDraggingSelection || this.workspace.isResizing || this.workspace.isRotating || this.workspace.isReconnecting || this.workspace.isCreating || this.workspace.isDraggingVertex) {
          this.workspace.cancelGesture();
        } else if (this.workspace.activeGroupId) {
          const gId = this.workspace.activeGroupId;
          const groupMembers = Object.values(this.doc.objects)
            .filter(o => o.groupId === gId && !o.locked)
            .map(o => o.id);
          this.workspace.activeGroupId = null;
          this.workspace.selectedIds = groupMembers;
          this.workspace.render();
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
      const selectedObjects = this.workspace.selectedIds.map(id => this.doc.objects[id]).filter(Boolean);
      const context = this.workspace.selectedIds.length > 0 ? 'object' : 'canvas';
      const firstObj = selectedObjects[0] || null;
      this.imageImportPoint = this.workspace.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
      this.wheel.open(window.innerWidth / 2, window.innerHeight / 2, context, firstObj, this.doc.theme.palette, this.workspace.selectedIds.length, selectedObjects);
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

    if (this.mode === 'reading' && this.wheelFab) {
      this.wheelFab.style.display = 'none';
    }

    const objCount = Object.keys(this.doc?.objects || {}).length;
    if (objCount > 0) {
      this.workspace.fitToContent(60);
    }
  }

  setMode(mode) {
    const targetMode = mode === 'editing' ? 'editing' : 'reading';
    if (this.mode === targetMode) return;

    this.cancelPendingImageImport();

    if (targetMode === 'reading') {
      if (this.textEditor) {
        this.textEditor.close(true);
      }
      this.workspace.cancelGesture();
      this.workspace.selectedIds = [];
      this.wheel.close();
      this.helpModal?.close();
      if (this.wheelFab) {
        this.wheelFab.style.display = 'none';
      }
      this.mode = 'reading';
      this.workspace.setMode('reading');
    } else {
      this.mode = 'editing';
      this.workspace.setMode('editing');
      if (this.wheelFab) {
        this.wheelFab.style.display = '';
      }
    }

    this.updateUI();
  }

  updateDocumentStatus() {
    const currentDigest = computeContentDigest(this.doc, canonicalJson);
    if (this.exportBaseline && this.exportBaseline.contentDigest === currentDigest) {
      this.status = 'Copy requested';
    } else if (!this.exportBaseline && this.undoStack.length === 0) {
      this.status = 'Clean';
    } else {
      this.status = 'Changed';
    }
  }

  documentStateChanged(previousDoc, nextDoc) {
    return canonicalJson(previousDoc) !== canonicalJson(nextDoc);
  }

  commitCommandResult(previousDoc, result) {
    if (!this.documentStateChanged(previousDoc, result.doc)) return false;

    this.doc = result.doc;
    if (result.inverseCmd && result.inverseCmd.type !== 'noop') {
      this.undoStack.push(result.inverseCmd);
    }
    this.redoStack = [];
    this.agentApi?.recordDocumentChange();
    this.status = 'Changed';
    this.updateUI();
    this.notifySubscribers();
    return true;
  }

  dispatchCommand(cmd) {
    const previousDoc = this.doc;
    const result = applyCommand(previousDoc, cmd);
    return this.commitCommandResult(previousDoc, result);
  }

  dispatchCommandBatch(cmds) {
    const previousDoc = this.doc;
    const result = applyCommandBatch(previousDoc, cmds);
    return this.commitCommandResult(previousDoc, result);
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    const inv = this.undoStack.pop();
    const previousDoc = this.doc;
    const { doc: newDoc, inverseCmd: redoCmd } = applyCommand(previousDoc, inv);
    if (!this.documentStateChanged(previousDoc, newDoc)) {
      this.updateDocumentStatus();
      return false;
    }
    this.doc = newDoc;
    if (redoCmd && redoCmd.type !== 'noop') this.redoStack.push(redoCmd);
    this.agentApi?.recordDocumentChange();
    this.updateDocumentStatus();
    this.updateUI();
    this.notifySubscribers();
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    const redoCmd = this.redoStack.pop();
    const previousDoc = this.doc;
    const { doc: newDoc, inverseCmd: undoCmd } = applyCommand(previousDoc, redoCmd);
    if (!this.documentStateChanged(previousDoc, newDoc)) {
      this.updateDocumentStatus();
      return false;
    }
    this.doc = newDoc;
    if (undoCmd && undoCmd.type !== 'noop') this.undoStack.push(undoCmd);
    this.agentApi?.recordDocumentChange();
    this.updateDocumentStatus();
    this.updateUI();
    this.notifySubscribers();
    return true;
  }

  reportImageImportError(message) {
    const safe = String(message || 'Unable to import image').replace(/[\r\n]+/g, ' ').slice(0, 180);
    if (typeof alert === 'function') {
      try { alert(`Image import failed: ${safe}`); } catch (_) {}
    }
  }

  isFileDrag(dataTransfer) {
    return Array.from(dataTransfer?.items || []).some(item => item.kind === 'file') ||
      Boolean(dataTransfer?.files?.length);
  }

  setImageDropActive(active) {
    this.canvasContainer?.classList?.toggle?.('image-drop-active', Boolean(active));
  }

  handleImageDragOver(event) {
    if (!this.isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    const fileItems = Array.from(event.dataTransfer?.items || []).filter(item => item.kind === 'file');
    const compatible = this.mode === 'editing' && !this.inPresentation && fileItems.length === 1 &&
      RASTER_MIME_TYPES.includes(fileItems[0].type);
    if (event.dataTransfer) event.dataTransfer.dropEffect = compatible ? 'copy' : 'none';
    this.setImageDropActive(compatible);
  }

  handleImageDragLeave(event) {
    if (!event.relatedTarget || !this.appElement?.contains(event.relatedTarget)) {
      this.setImageDropActive(false);
    }
  }

  handleImageDrop(event) {
    if (!this.isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    this.setImageDropActive(false);
    if (this.mode !== 'editing' || this.inPresentation) return;
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length !== 1) {
      if (files.length > 1) this.reportImageImportError('Drop one image at a time.');
      return;
    }
    this.importImageFile(files[0], this.workspace.screenToWorld(event.clientX, event.clientY));
  }

  cancelPendingImageImport() {
    this.setImageDropActive(false);
    this.imageImportToken++;
    try { this.pendingImageReader?.abort(); } catch (_) {}
    this.pendingImageReader = null;
    this.pendingImageDecode = null;
  }

  isImageImportActive(token) {
    return token === this.imageImportToken && this.mode === 'editing' && !this.isSaving;
  }

  importImageFile(file, invocationPoint = null) {
    if (this.mode !== 'editing' || !file) return;
    const token = ++this.imageImportToken;
    if (!RASTER_MIME_TYPES.includes(file.type)) {
      this.reportImageImportError('Choose a PNG, JPEG, or WebP image.');
      return;
    }
    if (typeof file.size === 'number' && file.size > MAX_IMAGE_SOURCE_BYTES) {
      this.reportImageImportError('The image is larger than 10 MiB.');
      return;
    }

    const reader = new FileReader();
    this.pendingImageReader = reader;
    reader.onerror = () => {
      if (this.pendingImageReader === reader) this.pendingImageReader = null;
      if (this.isImageImportActive(token)) this.reportImageImportError('The image could not be read.');
    };
    reader.onload = () => {
      if (this.pendingImageReader === reader) this.pendingImageReader = null;
      if (!this.isImageImportActive(token)) return;
      const data = typeof reader.result === 'string' ? reader.result : '';
      const parsed = validateRasterDataUrl(data, file.type);
      if (!parsed.valid) {
        this.reportImageImportError(parsed.errors[0] || 'The image data is invalid.');
        return;
      }
      const image = new Image();
      this.pendingImageDecode = image;
      image.onerror = () => {
        if (this.pendingImageDecode === image) this.pendingImageDecode = null;
        if (this.isImageImportActive(token)) this.reportImageImportError('The image data could not be decoded.');
      };
      image.onload = () => {
        if (this.pendingImageDecode === image) this.pendingImageDecode = null;
        if (!this.isImageImportActive(token)) return;
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (parsed.encodedWidth !== undefined && (parsed.encodedWidth !== width || parsed.encodedHeight !== height)) {
          this.reportImageImportError('The encoded image dimensions do not match the decoded image.');
          return;
        }
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > MAX_IMAGE_AXIS || height > MAX_IMAGE_AXIS || width * height > MAX_IMAGE_PIXELS) {
          this.reportImageImportError(`Image dimensions exceed the ${MAX_IMAGE_AXIS}px axis or ${MAX_IMAGE_PIXELS} pixel limit.`);
          return;
        }
        const scale = Math.min(1, 480 / width, 360 / height);
        const displayWidth = width * scale;
        const displayHeight = height * scale;
        const point = invocationPoint || this.workspace.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
        const assetId = generateId('asset');
        const objectId = generateId('image');
        const asset = { id: assetId, type: 'raster', data, mimeType: file.type, width, height };
        const object = createDefaultObject('image', {
          id: objectId,
          assetId,
          x: point.x - displayWidth / 2,
          y: point.y - displayHeight / 2,
          width: displayWidth,
          height: displayHeight,
          fit: 'contain'
        }, this.doc.theme);
        try {
          if (!this.isImageImportActive(token)) return;
          this.dispatchCommand({ type: 'create_image', asset, object });
          this.workspace.selectedIds = [objectId];
          this.workspace.setTool('select');
          this.workspace.render();
        } catch (err) {
          this.reportImageImportError('The image could not be added to this document.');
        }
      };
      image.src = data;
    };
    reader.readAsDataURL(file);
  }

  handleWheelAction(actionId, payload) {
    const selectedIds = this.workspace.selectedIds;

    // Creation & Mode Tools
    if (actionId === 'tool_select') this.workspace.setTool('select');
    else if (actionId === 'tool_hand') this.workspace.setTool('hand');
    else if (actionId === 'tool_line') this.workspace.setTool('line');
    else if (actionId === 'tool_text') this.workspace.setTool('text');
    else if (actionId === 'image_import') {
      if (this.mode === 'editing') this.imageFileInput?.click();
    }
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
    } else if (actionId === 'image_fit_contain' || actionId === 'image_fit_cover') {
      const fit = actionId.endsWith('cover') ? 'cover' : 'contain';
      const imageIds = selectedIds.filter(id => this.doc.objects[id]?.type === 'image' && !this.doc.objects[id]?.locked);
      if (imageIds.length === 1) this.dispatchCommand({ type: 'set_image_fit', id: imageIds[0], fit });
      else if (imageIds.length > 1) this.dispatchCommandBatch(imageIds.map(id => ({ type: 'set_image_fit', id, fit })));
    } else if (actionId === 'action_lock' || actionId === 'action_unlock') {
      const lock = actionId === 'action_lock';
      this.dispatchCommand({ type: 'lock_objects', ids: selectedIds, locked: lock });
    } else if (actionId === 'action_group') {
      if (selectedIds.length > 1) {
        this.dispatchCommand({ type: 'group_objects', ids: selectedIds });
      }
    } else if (actionId === 'action_ungroup') {
      const groupIds = Array.from(new Set(selectedIds.map(id => this.doc.objects[id]?.groupId).filter(Boolean)));
      if (groupIds.length > 0) {
        this.dispatchCommand({ type: 'ungroup_objects', groupIds });
        this.workspace.activeGroupId = null;
      }
    } else if (actionId === 'action_enter_group') {
      if (selectedIds.length > 0) {
        const first = this.doc.objects[selectedIds[0]];
        if (first?.groupId) {
          this.workspace.activeGroupId = first.groupId;
          this.workspace.selectedIds = [first.id];
          this.workspace.render();
        }
      }
    } else if (actionId === 'action_select_group') {
      if (selectedIds.length > 0) {
        const first = this.doc.objects[selectedIds[0]];
        if (first?.groupId) {
          this.workspace.activeGroupId = null;
          this.workspace.selectedIds = Object.values(this.doc.objects)
            .filter(o => o.groupId === first.groupId && !o.locked)
            .map(o => o.id);
          this.workspace.render();
        }
      }
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
      const imageIds = selectedIds.filter(id => this.doc.objects[id]?.type === 'image' && !this.doc.objects[id]?.locked);
      if (imageIds.length > 0 && imageIds.length === selectedIds.length) {
        this.dispatchCommandBatch(imageIds.map(id => ({ type: 'set_image_opacity', id, opacity: val })));
      } else {
        this.dispatchCommand({ type: 'set_style', ids: selectedIds, updates: { opacity: val } });
      }
    } else if (actionId.startsWith('width_')) {
      const val = payload.value;
      this.dispatchCommand({ type: 'set_style', ids: selectedIds, updates: { strokeWidth: val } });
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
      const commands = selectedIds
        .filter(id => this.doc.objects[id]?.type === 'connector' && !this.doc.objects[id]?.locked)
        .map(id => ({ type: 'configure_connector', id, routing }));
      if (commands.length === 1) this.dispatchCommand(commands[0]);
      else if (commands.length > 1) this.dispatchCommandBatch(commands);
    } else if (actionId === 'conn_curve_flip') {
      for (const id of selectedIds) {
        const conn = this.doc.objects[id];
        if (conn && conn.type === 'connector') {
          const curSide = conn.curveSide !== undefined ? conn.curveSide : 1;
          this.dispatchCommand({ type: 'configure_connector', id, curveSide: curSide === -1 ? 1 : -1 });
        }
      }
    } else if (actionId === 'conn_curve_auto') {
      for (const id of selectedIds) {
        this.dispatchCommand({ type: 'configure_connector', id, curveDistance: null });
      }
    } else if (actionId === 'conn_elbow_bypass') {
      for (const id of selectedIds) {
        this.dispatchCommand({ type: 'configure_connector', id, elbowOffset: 80 });
      }
    } else if (actionId === 'conn_elbow_flip') {
      for (const id of selectedIds) {
        const conn = this.doc.objects[id];
        if (conn && conn.type === 'connector' && conn.elbowOffset !== undefined) {
          this.dispatchCommand({ type: 'configure_connector', id, elbowOffset: -conn.elbowOffset });
        }
      }
    } else if (actionId === 'conn_elbow_auto') {
      for (const id of selectedIds) {
        this.dispatchCommand({ type: 'configure_connector', id, elbowOffset: null });
      }
    } else if (actionId.startsWith('conn_arrows_')) {
      const commands = selectedIds
        .filter(id => this.doc.objects[id]?.type === 'connector' && !this.doc.objects[id]?.locked)
        .map(id => ({
          type: 'configure_connector',
          id,
          startArrow: payload.startArrow,
          endArrow: payload.endArrow
        }));
      if (commands.length === 1) this.dispatchCommand(commands[0]);
      else if (commands.length > 1) this.dispatchCommandBatch(commands);
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
    } else if (actionId === 'path_curve_sharp') {
      this.dispatchCommand({ type: 'set_style', ids: selectedIds, updates: { curveStyle: 'sharp' } });
    } else if (actionId === 'path_curve_curved') {
      this.dispatchCommand({ type: 'set_style', ids: selectedIds, updates: { curveStyle: 'curved' } });
    } else if (actionId === 'path_toggle_close') {
      this.dispatchCommand({ type: 'set_style', ids: selectedIds, updates: { closed: true } });
    } else if (actionId === 'path_toggle_open') {
      this.dispatchCommand({ type: 'set_style', ids: selectedIds, updates: { closed: false } });
    } else if (actionId.startsWith('path_arrows_')) {
      this.dispatchCommand({
        type: 'set_style',
        ids: selectedIds,
        updates: {
          startArrow: payload.startArrow,
          endArrow: payload.endArrow
        }
      });
    } else if (actionId.startsWith('to_')) {
      if (actionId === 'to_equal_sides') {
        const shapeTypes = ['rectangle', 'ellipse', 'diamond', 'triangle'];
        const targetIds = selectedIds.filter(id => {
          const obj = this.doc.objects[id];
          return obj && shapeTypes.includes(obj.type) && !obj.locked;
        });
        if (targetIds.length > 0) {
          const commands = targetIds.map(id => {
            const obj = this.doc.objects[id];
            const maxDim = Math.max(obj.width, obj.height);
            return {
              type: 'resize_object',
              id,
              bounds: { x: obj.x, y: obj.y, width: maxDim, height: maxDim }
            };
          });
          if (commands.length === 1) {
            this.dispatchCommand(commands[0]);
          } else {
            this.dispatchCommandBatch(commands);
          }
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

  copy() {
    const selected = this.workspace.selectedIds
      .map(id => this.doc.objects[id])
      .filter(o => o && !o.locked);
    if (selected.length === 0) return;
    this.clipboard = cloneDocument(selected);
    this.clipboardAssets = {};
    for (const object of selected) {
      if (object.type === 'image' && object.assetId && this.doc.assets?.[object.assetId]) {
        this.clipboardAssets[object.assetId] = cloneDocument(this.doc.assets[object.assetId]);
      }
    }
    this.pasteCount = 0;
  }

  cut() {
    this.copy();
    const ids = this.workspace.selectedIds.filter(id => this.doc.objects[id] && !this.doc.objects[id].locked);
    if (ids.length > 0) {
      this.dispatchCommand({ type: 'delete_objects', ids });
      this.workspace.selectedIds = [];
      this.workspace.activeGroupId = null;
      this.workspace.render();
    }
  }

  paste() {
    if (!this.clipboard || this.clipboard.length === 0) return;
    this.pasteCount++;
    const offset = { x: 24 * this.pasteCount, y: 24 * this.pasteCount };

    const idMap = {};
    const groupMap = {};
    const newObjects = [];
    const cmds = [];

    // Restore copied sole-reference assets before creating their image objects.
    // Existing shared assets are reused without copying or re-encoding bytes.
    for (const [assetId, asset] of Object.entries(this.clipboardAssets || {})) {
      if (!this.doc.assets?.[assetId]) cmds.push({ type: 'create_asset', asset });
    }

    // 1. Pass 1: Clone objects, generate new IDs, map groups
    for (const source of this.clipboard) {
      const newId = generateId(source.type || 'obj');
      idMap[source.id] = newId;

      const dup = cloneDocument(source);
      dup.id = newId;
      dup.x += offset.x;
      dup.y += offset.y;
      dup.seed = generateSeed();
      dup.locked = false;

      if (dup.groupId) {
        if (!groupMap[dup.groupId]) {
          const newGid = generateId('grp');
          groupMap[dup.groupId] = newGid;
          const origGroup = this.doc.groups[dup.groupId];
          this.doc.groups[newGid] = { id: newGid, name: origGroup?.name || 'Group' };
        }
        dup.groupId = groupMap[dup.groupId];
      }

      newObjects.push(dup);
    }

    // 2. Pass 2: Rebind connectors
    for (const dup of newObjects) {
      if (dup.type === 'connector') {
        if (dup.from) {
          if (dup.from.id && idMap[dup.from.id]) {
            dup.from.id = idMap[dup.from.id];
          } else if (dup.from.id) {
            const extObj = this.doc.objects[dup.from.id];
            const origConn = this.clipboard.find(c => idMap[c.id] === dup.id) || dup;
            const resolved = extObj ? resolveConnectorGeometry(this.doc, origConn) : null;
            const pt = resolved ? resolved.start : (dup.from.point || { x: dup.x, y: dup.y });
            dup.from = { point: { x: pt.x + offset.x, y: pt.y + offset.y } };
          } else if (dup.from.point) {
            dup.from.point.x += offset.x;
            dup.from.point.y += offset.y;
          }
        }

        if (dup.to) {
          if (dup.to.id && idMap[dup.to.id]) {
            dup.to.id = idMap[dup.to.id];
          } else if (dup.to.id) {
            const extObj = this.doc.objects[dup.to.id];
            const origConn = this.clipboard.find(c => idMap[c.id] === dup.id) || dup;
            const resolved = extObj ? resolveConnectorGeometry(this.doc, origConn) : null;
            const pt = resolved ? resolved.end : (dup.to.point || { x: dup.x + dup.width, y: dup.y + dup.height });
            dup.to = { point: { x: pt.x + offset.x, y: pt.y + offset.y } };
          } else if (dup.to.point) {
            dup.to.point.x += offset.x;
            dup.to.point.y += offset.y;
          }
        }
      }
      cmds.push({ type: 'create_object', object: dup });
    }

    if (cmds.length > 0) {
      this.dispatchCommandBatch(cmds);
      this.workspace.selectedIds = newObjects.map(o => o.id);
      this.workspace.activeGroupId = null;
      this.workspace.render();
    }
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
    this.cancelPendingImageImport();
    this.prePresentationCamera = { ...this.workspace.camera };
    this.prePresentationMode = this.mode;
    if (this.textEditor) {
      this.textEditor.close(true);
    }
    this.workspace.cancelGesture();
    this.workspace.selectedIds = [];
    this.wheel?.close();
    this.helpModal?.close();
    if (this.wheelFab) {
      this.wheelFab.style.display = 'none';
    }
    this.inPresentation = true;
    this.workspace.setMode('reading');
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
    // Restore previous mode and UI state
    const prevMode = this.prePresentationMode || 'reading';
    this.prePresentationMode = null;
    this.mode = null; // Clear so setMode does not short-circuit
    this.setMode(prevMode);
    this.workspace.render();
    this.updateUI();
  }

  getCleanHtmlShell() {
    const clone = document.documentElement.cloneNode(true);
    clone.removeAttribute('class');
    const body = clone.querySelector('body');
    if (body) {
      body.removeAttribute('class');
      const appEl = body.querySelector('#app');
      if (appEl) appEl.innerHTML = '';
      const strayAnchors = body.querySelectorAll('a[download]');
      for (const anchor of strayAnchors) {
        anchor.remove();
      }
    }
    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  saveCopy() {
    if (this.isCorrupted) {
      console.error('Cannot save copy: document is corrupted or invalid.');
      return { success: false, error: 'Document is corrupted or in safe failure mode' };
    }

    if (this.isSaving) {
      return { success: false, error: 'Save in progress' };
    }
    this.cancelPendingImageImport();
    this.isSaving = true;

    try {
      if (this.textEditor) {
        this.textEditor.close(true);
      }
      this.workspace.cancelGesture();

      this.status = 'Preparing copy';
      this.updateUI();

      const transition = transitionRevision(this.doc, this.exportBaseline, canonicalJson);
      const exportDoc = cloneDocument(this.doc);
      exportDoc[REVISION_EXTENSION_KEY] = { ...transition.revisionRecord };

      const cleanShell = this.getCleanHtmlShell();
      const packResult = packageHtmlWithDocument(cleanShell, exportDoc);

      if (!packResult.success) {
        if (typeof alert === 'function') {
          try { alert('Failed to package document: ' + packResult.error); } catch (_) {}
        }
        this.status = 'Error';
        this.updateUI();
        return { success: false, error: packResult.error };
      }

      const shortRev = getShortRevisionId(transition.revisionRecord.revisionId);
      const safeTitle = sanitizeFilenameTitle(exportDoc.title, 'document');
      const filename = `sabura-${safeTitle}-r${shortRev}.html`;

      const byteLength = triggerFileDownload(filename, packResult.html);

      this.exportBaseline = { ...transition.revisionRecord };
      this.doc[REVISION_EXTENSION_KEY] = { ...transition.revisionRecord };

      this.status = 'Copy requested';
      this.updateUI();

      return {
        success: true,
        changed: transition.changed,
        filename,
        byteLength,
        revisionId: transition.revisionRecord.revisionId,
        parentId: transition.revisionRecord.parentId
      };
    } catch (err) {
      console.error('Save Copy failed:', err);
      this.status = 'Error';
      this.updateUI();
      return { success: false, error: err?.message || 'Save copy failed' };
    } finally {
      this.isSaving = false;
    }
  }

  updateUI() {
    this.appElement?.setAttribute('data-sabura-vs-board-theme', this.doc?.theme?.id || 'custom');
    this.topbar.update(this.doc, this.status, this.interfaceTheme, this.workspace.snapGrid, this.workspace.showGrid, this.mode);
    this.workspace.render();
  }

  notifySubscribers() {
    for (const sub of this.subscribers) {
      try {
        sub(cloneDocument(this.doc), this.status);
      } catch (err) {
        console.error('Subscriber error:', err);
      }
    }
  }

  exposeApi() {
    if (!this.agentApi) this.agentApi = new AgentApi(this);
    window.sabura = {
      isCorrupted: () => this.isCorrupted,
      getLoadErrors: () => [...this.loadErrors],
      getOriginalHtml: () => this.originalHtml,
      getDocument: () => this.doc ? cloneDocument(this.doc) : null,
      getMode: () => this.mode,
      setMode: (mode) => this.setMode(mode),
      getExportBaseline: () => this.exportBaseline ? { ...this.exportBaseline } : null,
      saveCopy: () => this.saveCopy(),

      /**
       * Returns the embedded AI contract comment from <head>.
       * Never returns CSS, JavaScript, or the full HTML source.
       * @returns {{ found: boolean, contract: string }}
       */
      readAiContract: () => {
        // Walk <head> child nodes for the AI contract comment
        if (typeof document !== 'undefined' && document.head) {
          for (const node of document.head.childNodes) {
            if (node.nodeType === 8 && node.textContent.includes('SABURA AI CONTRACT')) {
              return { found: true, contract: node.textContent.trim() };
            }
          }
        }
        // Fallback: scan outerHTML for the comment marker
        const html = typeof document !== 'undefined' ? document.documentElement.outerHTML : '';
        const m = html.match(/<!--([\s\S]*?SABURA AI CONTRACT[\s\S]*?)-->/);
        if (m) return { found: true, contract: m[1].trim() };
        return { found: false, contract: '' };
      },

      /**
       * Validates a supplied document against the sabura/canvas/v1 schema.
       * Does not mutate the open board.
       * @returns {{ valid: boolean, errors: string[] }}
       */
      validateDocument: (doc) => {
        const result = validateDocument(doc);
        return { valid: result.valid, errors: [...result.errors] };
      },

      /**
       * Validates the supplied document, builds a canonical HTML board file, and
       * triggers a browser download. Does not alter the open board, selection,
       * undo history, or redo history. Never returns the HTML source.
       * @returns {{ success: true, filename: string, byteLength: number }
       *           |{ success: false, errors: string[] }}
       */
      generateBoardFile: (doc) => {
        try {
          // 1. Validate supplied document
          const validation = validateDocument(doc, { verifyDigest: true });
          if (!validation.valid) {
            return { success: false, errors: [...validation.errors] };
          }

          // 2. Build clean shell — DOM clone excludes canvas SVG, selection, wheel, modal state
          const shell = this.getCleanHtmlShell();

          // 3. Ensure valid revision snapshot for the board file
          const exportDoc = cloneDocument(doc);
          if (!exportDoc[REVISION_EXTENSION_KEY]) {
            const transition = transitionRevision(exportDoc, null, canonicalJson);
            exportDoc[REVISION_EXTENSION_KEY] = transition.revisionRecord;
          }

          // 4. Replace only the sabura-document seam
          const packResult = packageHtmlWithDocument(shell, exportDoc);
          if (!packResult.success) {
            return { success: false, errors: [packResult.error || 'Failed to package document'] };
          }

          // 5. Filename from supplied title (sanitized first, then fallback to 'board')
          const shortRev = getShortRevisionId(exportDoc[REVISION_EXTENSION_KEY].revisionId);
          const safeTitle = sanitizeFilenameTitle(exportDoc?.title, 'board');
          const filename = `sabura-${safeTitle}-r${shortRev}.html`;

          // 6. Download. triggerFileDownload returns the actual UTF-8 Blob.size.
          //    The HTML string is never returned through this API.
          const byteLength = triggerFileDownload(filename, packResult.html);

          return { success: true, filename, byteLength, revisionId: exportDoc[REVISION_EXTENSION_KEY].revisionId };
        } catch (err) {
          const rawMsg = err && err.message ? String(err.message) : 'Operational failure during board generation';
          // Sanitize error message to ensure no HTML or runtime source is exposed
          const noTags = rawMsg.replace(/<[^>]*>[\s\S]*?<\/[^>]*>/gi, '').replace(/<[^>]*>/g, '').trim();
          const cleanMsg = noTags || 'Operational failure during board generation';
          const safeMsg = cleanMsg.length > 200 ? cleanMsg.slice(0, 200) + '...' : cleanMsg;
          return { success: false, errors: [safeMsg] };
        }
      },

      applyCommands: (commands) => {
        if (this.isCorrupted) {
          return { success: false, errors: ['Document is corrupted and in safe failure mode'] };
        }
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
          const result = applyCommandBatch(testDoc, commands);
          this.commitCommandResult(this.doc, result);
          return { success: true, document: cloneDocument(this.doc) };
        } catch (err) {
          return { success: false, errors: [err.message] };
        }
      },
      exportCanonicalJson: () => this.doc ? canonicalJson(this.doc) : '',
      undo: () => this.undo(),
      redo: () => this.redo(),
      subscribe: (listener) => {
        this.subscribers.add(listener);
        return () => this.subscribers.delete(listener);
      },
      agent: this.agentApi.publicApi()
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
