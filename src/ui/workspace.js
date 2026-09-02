/**
 * Sabura Workspace: Viewport coordinate transforms, camera navigation, pointer gestures,
 * snapping coordinator, and tool state machine.
 */

import { renderSvgScene, renderObject } from '../renderer/svg-renderer.js';
import { createDefaultObject } from '../core/document.js';
import { calculateResize, calculateSnapping, getBoundingBox, getUnionBoundingBox, distanceToConnector } from '../core/geometry.js';

export class Workspace {
  constructor(svgContainer, callbacks) {
    this.container = svgContainer;
    this.callbacks = callbacks;
    // callbacks: { onCommand, onCommandBatch, onOpenWheel, onDoubleClickedObject }

    this.camera = { x: 0, y: 0, zoom: 1.0 };
    this.activeTool = 'hand'; // Default tool: Hand/Pan!
    this.previousTool = 'select';
    this.selectedIds = [];
    this.snapGrid = true;
    this.showGrid = true;
    this.gridSize = 20;

    // Interaction state
    this.isPanning = false;
    this.isDraggingSelection = false;
    this.isDHeld = false;
    this.hasDuplicatedForDDrag = false;
    this.isResizing = false;
    this.isCreating = false;
    this.isReconnecting = false;
    this.isMarquee = false;
    this.spaceHeld = false;

    this.dragStart = { x: 0, y: 0 };
    this.pointerStartScreen = { x: 0, y: 0 };
    this.activeHandle = null;
    this.resizeOriginalBounds = null;
    this.snapGuides = [];
    this.marquee = null;
    this.draftObject = null;
    this.reconnectingData = null;

    // Long press detection
    this.longPressTimer = null;

    this.bindEvents();
  }

  setTool(tool) {
    this.activeTool = tool;
    this.updateCursor();
    this.render();
  }

  setSnapGrid(enabled) {
    this.snapGrid = enabled;
  }

  updateCursor() {
    if (this.spaceHeld || this.activeTool === 'hand') {
      this.container.style.cursor = this.isPanning ? 'grabbing' : 'grab';
    } else if (this.activeTool === 'select') {
      this.container.style.cursor = 'default';
    } else if (['rectangle', 'ellipse', 'diamond', 'triangle', 'text', 'connector', 'draw'].includes(this.activeTool)) {
      this.container.style.cursor = 'crosshair';
    } else {
      this.container.style.cursor = 'default';
    }
  }

  /**
   * Transforms screen (viewport) coordinates to world (canvas) coordinates.
   */
  screenToWorld(screenX, screenY) {
    return {
      x: (screenX - this.camera.x) / this.camera.zoom,
      y: (screenY - this.camera.y) / this.camera.zoom
    };
  }

  /**
   * Transforms world coordinates to screen coordinates.
   */
  worldToScreen(worldX, worldY) {
    return {
      x: worldX * this.camera.zoom + this.camera.x,
      y: worldY * this.camera.zoom + this.camera.y
    };
  }

  zoomAt(screenX, screenY, deltaFactor) {
    const minZoom = 0.1;
    const maxZoom = 5.0;
    const oldZoom = this.camera.zoom;
    const newZoom = Math.max(minZoom, Math.min(maxZoom, oldZoom * deltaFactor));

    // Keep point under cursor invariant
    this.camera.x = screenX - (screenX - this.camera.x) * (newZoom / oldZoom);
    this.camera.y = screenY - (screenY - this.camera.y) * (newZoom / oldZoom);
    this.camera.zoom = newZoom;

    this.render();
  }

  fitToContent(padding = 60) {
    const doc = this.callbacks.getDocument();
    const allObjects = Object.values(doc.objects || {});
    if (allObjects.length === 0) {
      this.camera = { x: 0, y: 0, zoom: 1.0 };
      this.render();
      return;
    }

    const union = getUnionBoundingBox(allObjects);
    if (!union) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const scaleX = (w - padding * 2) / union.width;
    const scaleY = (h - padding * 2) / union.height;
    const targetZoom = Math.max(0.2, Math.min(2.0, Math.min(scaleX, scaleY)));

    this.camera.zoom = targetZoom;
    this.camera.x = (w - union.width * targetZoom) / 2 - union.x * targetZoom;
    this.camera.y = (h - union.height * targetZoom) / 2 - union.y * targetZoom;
    this.render();
  }

  bindEvents() {
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onContextMenu = this.onContextMenu.bind(this);
    this.onDblClick = this.onDblClick.bind(this);

    this.onPointerCancel = this.onPointerCancel.bind(this);

    this.container.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
    this.container.addEventListener('wheel', this.onWheel, { passive: false });
    this.container.addEventListener('contextmenu', this.onContextMenu);
    this.container.addEventListener('dblclick', this.onDblClick);
  }

  destroy() {
    this.container.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    this.container.removeEventListener('wheel', this.onWheel);
    this.container.removeEventListener('contextmenu', this.onContextMenu);
    this.container.removeEventListener('dblclick', this.onDblClick);
  }

  onPointerCancel(e) {
    this.cancelGesture();
  }

  cancelGesture() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }

    const doc = this.callbacks.getDocument();

    if (this.isDraggingSelection && this.dragInitialPositions) {
      for (const [id, pos] of Object.entries(this.dragInitialPositions)) {
        const obj = doc.objects[id];
        if (obj) {
          obj.x = pos.x;
          obj.y = pos.y;
          if (obj.type === 'connector') {
            if (pos.fromPoint && obj.from) obj.from.point = { ...pos.fromPoint };
            if (pos.toPoint && obj.to) obj.to.point = { ...pos.toPoint };
          }
        }
      }
    }

    if (this.isResizing && this.resizeOriginalBounds && this.selectedIds.length > 0) {
      const obj = doc.objects[this.selectedIds[0]];
      if (obj) {
        obj.x = this.resizeOriginalBounds.x;
        obj.y = this.resizeOriginalBounds.y;
        obj.width = this.resizeOriginalBounds.width;
        obj.height = this.resizeOriginalBounds.height;
      }
    }

    if (this.isReconnecting && this.reconnectingData && this.reconnectOriginalTarget) {
      const conn = doc.objects[this.reconnectingData.connectorId];
      if (conn) {
        conn[this.reconnectingData.endpoint] = JSON.parse(JSON.stringify(this.reconnectOriginalTarget));
      }
    }

    this.isPanning = false;
    this.isDraggingSelection = false;
    this.isResizing = false;
    this.isCreating = false;
    this.isReconnecting = false;
    this.isMarquee = false;
    this.activeHandle = null;
    this.resizeOriginalBounds = null;
    this.latestResizeBounds = null;
    this.reconnectOriginalTarget = null;
    this.latestReconnectTarget = null;
    this.dragInitialPositions = null;
    this.dragAccumulatedDelta = null;
    this.snapGuides = [];
    this.marquee = null;
    this.draftObject = null;
    this.setTool('select');
    this.updateCursor();
    this.render();
  }

  findObjectAt(worldPoint) {
    const doc = this.callbacks.getDocument();
    // Search backwards from topmost (end of doc.order) to bottom
    for (let i = doc.order.length - 1; i >= 0; i--) {
      const objId = doc.order[i];
      const obj = doc.objects[objId];
      if (!obj) continue;

      if (obj.type === 'connector') {
        // Precision hit test: close to the actual line rather than broad bounding box
        const dist = distanceToConnector(worldPoint, obj, doc);
        if (dist <= 10) {
          return obj;
        }
      } else {
        const box = getBoundingBox(obj);
        if (worldPoint.x >= box.x && worldPoint.x <= box.right &&
            worldPoint.y >= box.y && worldPoint.y <= box.bottom) {
          return obj;
        }
      }
    }
    return null;
  }

  onContextMenu(e) {
    e.preventDefault();
    const worldPt = this.screenToWorld(e.clientX, e.clientY);
    const hitObj = this.findObjectAt(worldPt);

    if (hitObj) {
      if (!this.selectedIds.includes(hitObj.id)) {
        this.selectedIds = [hitObj.id];
      }
      this.callbacks.onOpenWheel(e.clientX, e.clientY, 'object', hitObj);
    } else {
      this.callbacks.onOpenWheel(e.clientX, e.clientY, 'canvas', null);
    }
  }

  onDblClick(e) {
    const worldPt = this.screenToWorld(e.clientX, e.clientY);
    const hitObj = this.findObjectAt(worldPt);
    if (hitObj) {
      this.callbacks.onDoubleClickedObject(hitObj);
    }
  }

  onPointerDown(e) {
    // If middle click or space held or activeTool === 'hand', start panning
    if (e.button === 1 || this.spaceHeld || this.activeTool === 'hand') {
      this.isPanning = true;
      this.dragStart = { x: e.clientX - this.camera.x, y: e.clientY - this.camera.y };
      this.updateCursor();
      return;
    }

    if (e.button !== 0) return; // Only primary left click beyond here

    const worldPt = this.screenToWorld(e.clientX, e.clientY);
    this.pointerStartScreen = { x: e.clientX, y: e.clientY };

    // Setup long-press timer (500ms) for opening circular wheel on touch / static click
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      const hit = this.findObjectAt(worldPt);
      this.callbacks.onOpenWheel(e.clientX, e.clientY, hit ? 'object' : 'canvas', hit);
    }, 500);

    // Check if clicked a resize or connector handle
    const handleEl = e.target?.closest?.('[data-handle]');
    if (handleEl) {
      clearTimeout(this.longPressTimer);
      const handleId = handleEl.getAttribute('data-handle');
      if (handleId.startsWith('conn-')) {
        this.isReconnecting = true;
        this.reconnectingData = {
          connectorId: this.selectedIds[0],
          endpoint: handleId === 'conn-from' ? 'from' : 'to'
        };
        const doc = this.callbacks.getDocument();
        const conn = doc.objects[this.selectedIds[0]];
        this.reconnectOriginalTarget = conn ? JSON.parse(JSON.stringify(conn[this.reconnectingData.endpoint])) : null;
        this.latestReconnectTarget = null;
      } else {
        this.isResizing = true;
        this.activeHandle = handleId;
        const doc = this.callbacks.getDocument();
        const obj = doc.objects[this.selectedIds[0]];
        this.resizeOriginalBounds = {
          x: obj.x,
          y: obj.y,
          width: obj.width,
          height: obj.height,
          resolvedSize: obj.textStyle?.resolvedSize || 20
        };
        this.latestResizeBounds = null;
        this.dragStart = { ...worldPt };
      }
      return;
    }

    // Check if clicked an object
    const hitObj = this.findObjectAt(worldPt);

    if (this.activeTool === 'select') {
      if (hitObj) {
        clearTimeout(this.longPressTimer);
        let targetId = hitObj.id;
        // Group selection logic: if part of group, select all group members
        const doc = this.callbacks.getDocument();
        if (hitObj.groupId) {
          const groupMembers = Object.values(doc.objects).filter(o => o.groupId === hitObj.groupId).map(o => o.id);
          if (e.shiftKey) {
            this.selectedIds = Array.from(new Set([...this.selectedIds, ...groupMembers]));
          } else if (!this.selectedIds.includes(targetId)) {
            this.selectedIds = groupMembers;
          }
        } else {
          if (e.shiftKey) {
            if (this.selectedIds.includes(targetId)) {
              this.selectedIds = this.selectedIds.filter(id => id !== targetId);
            } else {
              this.selectedIds.push(targetId);
            }
          } else if (!this.selectedIds.includes(targetId)) {
            this.selectedIds = [targetId];
          }
        }

        this.isDraggingSelection = true;
        this.dragStart = { ...worldPt };
        this.dragInitialPositions = {};
        this.dragAccumulatedDelta = { dx: 0, dy: 0 };
        for (const id of this.selectedIds) {
          const o = doc.objects[id];
          if (o) {
            this.dragInitialPositions[id] = {
              x: o.x,
              y: o.y,
              fromPoint: o.type === 'connector' && o.from?.point ? { ...o.from.point } : null,
              toPoint: o.type === 'connector' && o.to?.point ? { ...o.to.point } : null
            };
          }
        }
        this.render();
      } else {
        // Clicked empty space
        if (!e.shiftKey) {
          this.selectedIds = [];
        }
        this.isMarquee = true;
        this.marquee = { startX: worldPt.x, startY: worldPt.y, currentX: worldPt.x, currentY: worldPt.y };
        this.render();
      }
      return;
    }

    // Creation tools
    if (['rectangle', 'ellipse', 'diamond', 'triangle', 'text', 'connector', 'draw'].includes(this.activeTool)) {
      clearTimeout(this.longPressTimer);
      this.isCreating = true;
      this.dragStart = { ...worldPt };

      const doc = this.callbacks.getDocument();
      const type = this.activeTool === 'draw' ? 'path' : this.activeTool;

      this.draftObject = createDefaultObject(type, {
        x: worldPt.x,
        y: worldPt.y,
        width: 1,
        height: 1
      }, doc.theme);

      if (type === 'path') {
        this.draftObject.points = [[0, 0]];
      } else if (type === 'connector') {
        const startHit = this.findObjectAt(worldPt);
        this.draftObject.from = startHit ? { id: startHit.id } : { point: { ...worldPt } };
        this.draftObject.to = { point: { ...worldPt } };
      }
    }
  }

  onPointerMove(e) {
    // If pointer moved more than 5px, cancel long-press timer
    if (this.longPressTimer) {
      const dist = Math.hypot(e.clientX - this.pointerStartScreen.x, e.clientY - this.pointerStartScreen.y);
      if (dist > 6) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
    }

    if (this.isPanning) {
      this.camera.x = e.clientX - this.dragStart.x;
      this.camera.y = e.clientY - this.dragStart.y;
      this.render();
      return;
    }

    const worldPt = this.screenToWorld(e.clientX, e.clientY);

    if (this.isMarquee) {
      this.marquee.currentX = worldPt.x;
      this.marquee.currentY = worldPt.y;

      // Update selection based on marquee intersection
      const mx = Math.min(this.marquee.startX, this.marquee.currentX);
      const my = Math.min(this.marquee.startY, this.marquee.currentY);
      const mr = Math.max(this.marquee.startX, this.marquee.currentX);
      const mb = Math.max(this.marquee.startY, this.marquee.currentY);

      const doc = this.callbacks.getDocument();
      const hits = [];
      for (const obj of Object.values(doc.objects)) {
        const b = getBoundingBox(obj);
        if (b.x < mr && b.right > mx && b.y < mb && b.bottom > my) {
          hits.push(obj.id);
        }
      }
      this.selectedIds = hits;
      this.render();
      return;
    }

    if (this.isDraggingSelection && this.selectedIds.length > 0 && this.dragInitialPositions) {
      const doc = this.callbacks.getDocument();

      // Holding plain D while dragging: drag out a copy!
      if (this.isDHeld && !this.hasDuplicatedForDDrag) {
        this.hasDuplicatedForDDrag = true;
        // 1. Restore originals to pristine initial positions
        for (const [id, pos] of Object.entries(this.dragInitialPositions)) {
          const orig = doc.objects[id];
          if (orig) {
            orig.x = pos.x;
            orig.y = pos.y;
            if (orig.type === 'connector') {
              if (pos.fromPoint && orig.from) orig.from.point = { ...pos.fromPoint };
              if (pos.toPoint && orig.to) orig.to.point = { ...pos.toPoint };
            }
          }
        }
        // 2. Dispatch duplicate command
        this.callbacks.onCommand({
          type: 'duplicate_objects',
          ids: [...this.selectedIds]
        });
        // 3. The duplicates are now selected
        const count = this.selectedIds.length;
        const newIds = doc.order.slice(-count);
        this.selectedIds = newIds;
        this.dragInitialPositions = {};
        for (const id of newIds) {
          const o = doc.objects[id];
          if (o) {
            this.dragInitialPositions[id] = {
              x: o.x,
              y: o.y,
              fromPoint: o.from?.point ? { ...o.from.point } : null,
              toPoint: o.to?.point ? { ...o.to.point } : null
            };
          }
        }
      }

      const selectedObjects = this.selectedIds.map(id => doc.objects[id]).filter(Boolean);
      const union = getUnionBoundingBox(selectedObjects);
      if (!union) return;

      let dx = worldPt.x - this.dragStart.x;
      let dy = worldPt.y - this.dragStart.y;

      // Snapping against non-selected objects & grid (unless Alt/Option is held)
      if (!e.altKey && !e.metaKey) {
        const otherObjects = Object.values(doc.objects).filter(o => !this.selectedIds.includes(o.id));
        const testBox = {
          x: union.x + dx,
          y: union.y + dy,
          width: union.width,
          height: union.height
        };
        const snap = calculateSnapping(testBox, otherObjects, {
          tolerance: 8 / this.camera.zoom,
          snapGrid: this.snapGrid,
          gridSize: this.gridSize
        });

        dx += (snap.x - testBox.x);
        dy += (snap.y - testBox.y);
        this.snapGuides = snap.guides;
      } else {
        this.snapGuides = [];
      }

      this.dragAccumulatedDelta = { dx, dy };

      for (const id of this.selectedIds) {
        const obj = doc.objects[id];
        const initial = this.dragInitialPositions[id];
        if (obj && initial) {
          obj.x = initial.x + dx;
          obj.y = initial.y + dy;
          if (obj.type === 'connector') {
            if (initial.fromPoint && obj.from) obj.from.point = { x: initial.fromPoint.x + dx, y: initial.fromPoint.y + dy };
            if (initial.toPoint && obj.to) obj.to.point = { x: initial.toPoint.x + dx, y: initial.toPoint.y + dy };
          }
        }
      }
      this.render();
      return;
    }

    if (this.isResizing && this.selectedIds.length === 1 && this.resizeOriginalBounds) {
      const dx = worldPt.x - this.dragStart.x;
      const dy = worldPt.y - this.dragStart.y;
      const keepAspect = e.shiftKey;
      const fromCenter = e.altKey;

      const newBounds = calculateResize(this.activeHandle, this.resizeOriginalBounds, dx, dy, {
        keepAspect,
        fromCenter
      });

      const doc = this.callbacks.getDocument();
      const obj = doc.objects[this.selectedIds[0]];
      if (obj) {
        obj.x = newBounds.x;
        obj.y = newBounds.y;
        obj.width = newBounds.width;
        obj.height = newBounds.height;
        if (obj.textStyle && this.resizeOriginalBounds.width > 0 && this.resizeOriginalBounds.height > 0) {
          const scale = (newBounds.width / this.resizeOriginalBounds.width + newBounds.height / this.resizeOriginalBounds.height) / 2;
          obj.textStyle.resolvedSize = Math.max(10, Math.min(120, Math.round((this.resizeOriginalBounds.resolvedSize || 20) * scale)));
        }
        this.latestResizeBounds = newBounds;
        this.render();
      }
      return;
    }

    if (this.isReconnecting && this.reconnectingData) {
      const hit = this.findObjectAt(worldPt);
      const target = hit && hit.id !== this.reconnectingData.connectorId ? { id: hit.id } : { point: { ...worldPt } };
      const doc = this.callbacks.getDocument();
      const conn = doc.objects[this.reconnectingData.connectorId];
      if (conn) {
        conn[this.reconnectingData.endpoint] = target;
        this.latestReconnectTarget = target;
        this.render();
      }
      return;
    }

    if (this.isCreating && this.draftObject) {
      if (this.draftObject.type === 'path') {
        const relX = worldPt.x - this.draftObject.x;
        const relY = worldPt.y - this.draftObject.y;
        this.draftObject.points.push([relX, relY]);
        this.render();
      } else if (this.draftObject.type === 'connector') {
        const hit = this.findObjectAt(worldPt);
        this.draftObject.to = hit ? { id: hit.id } : { point: { ...worldPt } };
        this.render();
      } else {
        // Shapes: Rect, Ellipse, Diamond, Triangle
        let w = worldPt.x - this.dragStart.x;
        let h = worldPt.y - this.dragStart.y;

        if (e.shiftKey) {
          // Constrain to equal sides (square / circle)
          const side = Math.max(Math.abs(w), Math.abs(h));
          w = w < 0 ? -side : side;
          h = h < 0 ? -side : side;
        }

        this.draftObject.x = Math.min(this.dragStart.x, this.dragStart.x + w);
        this.draftObject.y = Math.min(this.dragStart.y, this.dragStart.y + h);
        this.draftObject.width = Math.abs(w);
        this.draftObject.height = Math.abs(h);
        this.render();
      }
    }
  }

  onPointerUp(e) {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }

    if (this.isPanning) {
      this.isPanning = false;
      this.updateCursor();
    }

    if (this.isMarquee) {
      this.isMarquee = false;
      this.marquee = null;
      this.render();
    }

    if (this.isDraggingSelection) {
      this.isDraggingSelection = false;
      this.hasDuplicatedForDDrag = false;
      this.snapGuides = [];
      const doc = this.callbacks.getDocument();

      // Restore initial positions first so dispatchCommand applies clean delta
      if (this.dragInitialPositions) {
        for (const [id, pos] of Object.entries(this.dragInitialPositions)) {
          const obj = doc.objects[id];
          if (obj) {
            obj.x = pos.x;
            obj.y = pos.y;
            if (obj.type === 'connector') {
              if (pos.fromPoint && obj.from) obj.from.point = { ...pos.fromPoint };
              if (pos.toPoint && obj.to) obj.to.point = { ...pos.toPoint };
            }
          }
        }
      }

      if (this.dragAccumulatedDelta && (this.dragAccumulatedDelta.dx !== 0 || this.dragAccumulatedDelta.dy !== 0)) {
        this.callbacks.onCommand({
          type: 'move_objects',
          ids: this.selectedIds,
          dx: this.dragAccumulatedDelta.dx,
          dy: this.dragAccumulatedDelta.dy
        });
      }

      this.dragInitialPositions = null;
      this.dragAccumulatedDelta = null;
      this.render();
    }

    if (this.isResizing) {
      this.isResizing = false;
      const doc = this.callbacks.getDocument();

      if (this.resizeOriginalBounds && this.selectedIds.length > 0) {
        const obj = doc.objects[this.selectedIds[0]];
        if (obj) {
          obj.x = this.resizeOriginalBounds.x;
          obj.y = this.resizeOriginalBounds.y;
          obj.width = this.resizeOriginalBounds.width;
          obj.height = this.resizeOriginalBounds.height;
        }
      }

      if (this.latestResizeBounds && this.selectedIds.length > 0) {
        this.callbacks.onCommand({
          type: 'resize_object',
          id: this.selectedIds[0],
          bounds: this.latestResizeBounds,
          scaleText: true
        });
      }

      this.activeHandle = null;
      this.resizeOriginalBounds = null;
      this.latestResizeBounds = null;
      this.render();
    }

    if (this.isReconnecting) {
      this.isReconnecting = false;
      const doc = this.callbacks.getDocument();

      if (this.reconnectOriginalTarget && this.reconnectingData) {
        const conn = doc.objects[this.reconnectingData.connectorId];
        if (conn) {
          conn[this.reconnectingData.endpoint] = JSON.parse(JSON.stringify(this.reconnectOriginalTarget));
        }
      }

      if (this.latestReconnectTarget && this.reconnectingData) {
        this.callbacks.onCommand({
          type: 'reconnect_connector',
          id: this.reconnectingData.connectorId,
          endpoint: this.reconnectingData.endpoint,
          target: this.latestReconnectTarget
        });
      }

      this.reconnectingData = null;
      this.reconnectOriginalTarget = null;
      this.latestReconnectTarget = null;
      this.render();
    }

    if (this.isCreating && this.draftObject) {
      this.isCreating = false;
      const obj = this.draftObject;
      this.draftObject = null;

      const worldPt = this.screenToWorld(e.clientX, e.clientY);

      if (obj.type === 'path') {
        if (obj.points && obj.points.length > 1) {
          this.callbacks.onCommand({
            type: 'create_object',
            object: obj
          });
          this.selectedIds = [obj.id];
        }
      } else if (obj.type === 'connector') {
        const hit = this.findObjectAt(worldPt);
        if (hit && (!obj.from.id || hit.id !== obj.from.id)) {
          obj.to = { id: hit.id };
        } else {
          const dist = Math.hypot((obj.to?.point?.x || worldPt.x) - obj.x, (obj.to?.point?.y || worldPt.y) - obj.y);
          if (dist < 15) {
            obj.to = { point: { x: obj.x + 140, y: obj.y + 70 } };
          }
        }
        this.callbacks.onCommand({
          type: 'create_object',
          object: obj
        });
        this.selectedIds = [obj.id];
      } else {
        // Shapes: Rectangle, Ellipse, Diamond, Triangle, Text
        // If clicked or barely dragged (<= 25px), spawn comfortable default size centered at click
        if (obj.width <= 25 && obj.height <= 25) {
          if (obj.type === 'text') {
            obj.width = 80;
            obj.height = 32;
            obj.x = Math.round(worldPt.x);
            obj.y = Math.round(worldPt.y - 16);
          } else {
            obj.width = 140;
            obj.height = 80;
            obj.x = Math.round(worldPt.x - 70);
            obj.y = Math.round(worldPt.y - 40);
          }
        }

        this.callbacks.onCommand({
          type: 'create_object',
          object: obj
        });
        this.selectedIds = [obj.id];

        // If text tool, immediately open inline editor
        if (obj.type === 'text') {
          setTimeout(() => {
            this.callbacks.onDoubleClickedObject(obj);
          }, 50);
        }
      }

      // Revert tool back to select
      this.setTool('select');
      this.render();
    }
  }

  onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Pinch to zoom or ctrl-wheel
      const zoomFactor = Math.pow(0.992, e.deltaY);
      this.zoomAt(e.clientX, e.clientY, zoomFactor);
    } else {
      // Two finger pan or standard wheel
      this.camera.x -= e.deltaX;
      this.camera.y -= e.deltaY;
      this.render();
    }
  }

  render() {
    const doc = this.callbacks.getDocument();
    const runtime = {
      camera: this.camera,
      selectedIds: this.selectedIds,
      marquee: this.marquee,
      snapGuides: this.snapGuides,
      showGrid: this.showGrid !== false,
      connectorDraft: this.draftObject?.type === 'connector' ? {
        start: this.draftObject.from?.point || { x: this.draftObject.x, y: this.draftObject.y },
        end: this.draftObject.to?.point || { x: this.draftObject.x + this.draftObject.width, y: this.draftObject.y + this.draftObject.height }
      } : null
    };

    let sceneSvg = renderSvgScene(doc, runtime);

    // If a non-connector creation draft is in progress, insert it before world-layer closing
    if (this.draftObject && this.draftObject.type !== 'connector') {
      const draftSvg = renderObject(doc, this.draftObject, false);
      const worldCloseIndex = sceneSvg.lastIndexOf('</g>');
      if (worldCloseIndex !== -1) {
        sceneSvg = sceneSvg.slice(0, worldCloseIndex) + '\n' + draftSvg + '\n' + sceneSvg.slice(worldCloseIndex);
      }
    }

    this.container.innerHTML = sceneSvg;
  }

  setSnapGrid(enabled) {
    this.snapGrid = Boolean(enabled);
  }

  setShowGrid(visible) {
    this.showGrid = Boolean(visible);
    this.render();
  }

  setDHold(held) {
    this.isDHeld = Boolean(held);
  }
}
