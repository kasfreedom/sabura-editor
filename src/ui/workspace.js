/**
 * Sabura Workspace: Viewport coordinate transforms, camera navigation, pointer gestures,
 * snapping coordinator, and tool state machine.
 */

import { renderSvgScene, renderObject } from '../renderer/svg-renderer.js';
import { createDefaultObject, cloneDocument } from '../core/document.js';
import {
  calculateResize,
  calculateRotatedResize,
  calculateSnapping,
  getBoundingBox,
  getUnionBoundingBox,
  distanceToConnector,
  distanceToPath,
  getClosestBoundaryPoint,
  getShapeSnapPoints,
  measureText,
  transformObjects,
  rotateObjects,
  rotatePoint,
  unrotatePoint,
  normalizeAngle,
  isPointInsideObject,
  resolveConnectorGeometry
} from '../core/geometry.js';

export class Workspace {
  constructor(svgContainer, callbacks) {
    this.container = svgContainer;
    this.callbacks = callbacks;
    // callbacks: { onCommand, onCommandBatch, onOpenWheel, onDoubleClickedObject }

    this.camera = { x: 0, y: 0, zoom: 1.0 };
    this.activeTool = 'hand'; // Default tool: Hand/Pan!
    this.previousTool = 'select';
    this.connectorRouting = 'straight';
    this.mode = 'reading'; // 'reading' | 'editing'
    this.selectedIds = [];
    this.activeGroupId = null;
    this.snapGrid = true;
    this.showGrid = true;
    this.gridSize = 20;

    // Interaction state
    this.isPanning = false;
    this.isDraggingSelection = false;
    this.isDHeld = false;
    this.isDDragging = false;
    this.isResizing = false;
    this.isRotating = false;
    this.rotateData = null;
    this.latestRotateResult = null;
    this.isCreating = false;
    this.isReconnecting = false;
    this.reconnectSnapIndicator = null;
    this.isCurvingConnector = false;
    this.curvingConnectorData = null;
    this.isMarquee = false;
    this.spaceHeld = false;

    this.dragStart = { x: 0, y: 0 };
    this.pointerStartScreen = { x: 0, y: 0 };
    this.activeHandle = null;
    this.resizeData = null;
    this.latestResizeResult = null;
    this.snapGuides = [];
    this.marquee = null;
    this.draftObject = null;
    this.reconnectingData = null;

    // Long press detection
    this.longPressTimer = null;

    this.bindEvents();
  }

  setMode(mode) {
    this.mode = mode === 'editing' ? 'editing' : 'reading';
    if (this.mode === 'reading') {
      this.cancelGesture();
      this.selectedIds = [];
      this.activeGroupId = null;
      this.activeTool = 'hand';
      this.updateCursor();
      this.render();
    } else {
      this.setTool('select');
    }
  }

  setTool(tool) {
    if (this.mode === 'reading') {
      this.activeTool = 'hand';
      this.updateCursor();
      this.render();
      return;
    }
    if (this.isDrawingLine && tool !== 'line') {
      this.cancelLine();
    }
    this.activeTool = tool;
    this.updateCursor();
    this.render();
  }

  setConnectorRouting(routing) {
    this.connectorRouting = routing || 'straight';
  }

  setSnapGrid(enabled) {
    this.snapGrid = enabled;
  }

  updateCursor() {
    if (this.mode === 'reading') {
      this.container.style.cursor = this.isPanning ? 'grabbing' : 'grab';
      return;
    }
    if (this.spaceHeld || this.activeTool === 'hand') {
      this.container.style.cursor = this.isPanning ? 'grabbing' : 'grab';
    } else if (this.activeTool === 'select') {
      this.container.style.cursor = 'default';
    } else if (['rectangle', 'ellipse', 'diamond', 'triangle', 'text', 'connector', 'line'].includes(this.activeTool)) {
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

  zoomIn() {
    const center = this.getViewportCenter();
    this.zoomAt(center.x, center.y, 1.2);
  }

  zoomOut() {
    const center = this.getViewportCenter();
    this.zoomAt(center.x, center.y, 1 / 1.2);
  }

  resetZoom() {
    if (this.camera.zoom === 1.0) return;
    const center = this.getViewportCenter();
    this.zoomAt(center.x, center.y, 1.0 / this.camera.zoom);
  }

  getViewportCenter() {
    const rect = this.container.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }

  hasActiveInteraction() {
    return Boolean(
      this.isPanning ||
      this.isDraggingSelection ||
      this.isDDragging ||
      this.isResizing ||
      this.isRotating ||
      this.isCreating ||
      this.isReconnecting ||
      this.isCurvingConnector ||
      this.isDraggingVertex ||
      this.isMarquee ||
      this.isDrawingLine
    );
  }

  fitBounds(bounds, padding = 60) {
    if (!bounds) return false;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scaleX = bounds.width > 0 ? (w - padding * 2) / bounds.width : 2;
    const scaleY = bounds.height > 0 ? (h - padding * 2) / bounds.height : 2;
    const targetZoom = Math.max(0.2, Math.min(2.0, Math.min(scaleX, scaleY)));

    this.camera.zoom = targetZoom;
    this.camera.x = (w - bounds.width * targetZoom) / 2 - bounds.x * targetZoom;
    this.camera.y = (h - bounds.height * targetZoom) / 2 - bounds.y * targetZoom;
    this.render();
    return true;
  }

  fitToContent(padding = 60) {
    const doc = this.callbacks.getDocument();
    const allObjects = Object.values(doc.objects || {});
    if (allObjects.length === 0) {
      this.camera = { x: 0, y: 0, zoom: 1.0 };
      this.render();
      return;
    }

    const union = getUnionBoundingBox(allObjects, doc);
    if (!union) return;
    this.fitBounds(union, padding);
  }

  focusObjects(ids, padding = 60) {
    const doc = this.callbacks.getDocument();
    const objects = ids.map(id => doc.objects?.[id]).filter(Boolean);
    if (objects.length !== ids.length || objects.length === 0) return false;
    const union = getUnionBoundingBox(objects, doc);
    return this.fitBounds(union, padding);
  }

  bindEvents() {
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onContextMenu = this.onContextMenu.bind(this);
    this.onDblClick = this.onDblClick.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);

    this.onPointerCancel = this.onPointerCancel.bind(this);

    this.container.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.container.addEventListener('wheel', this.onWheel, { passive: false });
    this.container.addEventListener('contextmenu', this.onContextMenu);
    this.container.addEventListener('dblclick', this.onDblClick);
  }

  destroy() {
    this.container.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.container.removeEventListener('wheel', this.onWheel);
    this.container.removeEventListener('contextmenu', this.onContextMenu);
    this.container.removeEventListener('dblclick', this.onDblClick);
  }

  onKeyDown(e) {
    if (this.isRotating && this.rotateData && e.key === 'Shift') {
      this.updateRotationPreview(this.rotateData.lastWorldPt, true);
    }
  }

  onKeyUp(e) {
    if (this.isRotating && this.rotateData && e.key === 'Shift') {
      this.updateRotationPreview(this.rotateData.lastWorldPt, false);
    }
  }

  updateRotationPreview(worldPt, shiftKey) {
    if (!this.isRotating || !this.rotateData || !worldPt) return;
    this.rotateData.lastWorldPt = { ...worldPt };
    const { pivot, snapshotObjects, snapshotFreeEndpoints, isSingle } = this.rotateData;
    const currentAngle = Math.atan2(worldPt.y - pivot.y, worldPt.x - pivot.x) * (180 / Math.PI);

    const isShift = Boolean(shiftKey);
    if (this.rotateData.lastShiftKey !== isShift) {
      if (isShift) {
        // Shift pressed mid-gesture: anchor at current pointer angle and lock in current effective delta
        this.rotateData.shiftAnchorAngle = currentAngle;
        this.rotateData.shiftBaseDelta = this.rotateData.lastEffectiveDelta || 0;
      } else {
        // Shift released mid-gesture: anchor at current pointer angle and lock in current effective delta
        this.rotateData.unsnappedAnchorAngle = currentAngle;
        this.rotateData.unsnappedBaseDelta = this.rotateData.lastEffectiveDelta || 0;
      }
      this.rotateData.lastShiftKey = isShift;
    }

    let angleDelta;
    if (isShift) {
      // Step in 15-degree increments relative to the anchor when Shift was held/pressed
      const rawShiftDelta = currentAngle - (this.rotateData.shiftAnchorAngle !== undefined ? this.rotateData.shiftAnchorAngle : this.rotateData.startAngle);
      const snappedStep = Math.round(rawShiftDelta / 15) * 15;
      angleDelta = (this.rotateData.shiftBaseDelta || 0) + snappedStep;
    } else {
      // Smooth continuous delta from unsnapped anchor
      const rawUnsnappedDelta = currentAngle - (this.rotateData.unsnappedAnchorAngle !== undefined ? this.rotateData.unsnappedAnchorAngle : this.rotateData.startAngle);
      angleDelta = (this.rotateData.unsnappedBaseDelta || 0) + rawUnsnappedDelta;
    }

    this.rotateData.lastEffectiveDelta = angleDelta;

    const doc = this.callbacks.getDocument();

    if (isSingle) {
      const snap = snapshotObjects[0];
      const targetAngle = (snap.rotation || 0) + angleDelta;

      const liveObj = doc.objects[snap.id];
      if (liveObj) {
        liveObj.rotation = normalizeAngle(targetAngle);
      }
      this.latestRotateResult = {
        objects: {
          [snap.id]: {
            rotation: normalizeAngle(targetAngle)
          }
        }
      };
    } else {
      const transformedSpatial = rotateObjects(snapshotObjects, pivot, angleDelta);
      const objectsPayload = {};

      for (const tObj of transformedSpatial) {
        const liveObj = doc.objects[tObj.id];
        if (!liveObj) continue;
        liveObj.x = tObj.x;
        liveObj.y = tObj.y;
        liveObj.rotation = tObj.rotation;
        objectsPayload[tObj.id] = {
          rotation: tObj.rotation,
          x: tObj.x,
          y: tObj.y
        };
      }

      const freeEndpointsPayload = {};
      if (snapshotFreeEndpoints) {
        for (const [connId, ep] of Object.entries(snapshotFreeEndpoints)) {
          const liveConn = doc.objects[connId];
          if (!liveConn) continue;
          const epResult = {};
          if (ep.from) {
            const rotatedFrom = rotatePoint(ep.from, pivot, angleDelta);
            liveConn.from.point = { x: Math.round(rotatedFrom.x * 100) / 100, y: Math.round(rotatedFrom.y * 100) / 100 };
            epResult.from = { ...liveConn.from.point };
          }
          if (ep.to) {
            const rotatedTo = rotatePoint(ep.to, pivot, angleDelta);
            liveConn.to.point = { x: Math.round(rotatedTo.x * 100) / 100, y: Math.round(rotatedTo.y * 100) / 100 };
            epResult.to = { ...liveConn.to.point };
          }
          if (Object.keys(epResult).length > 0) {
            freeEndpointsPayload[connId] = epResult;
          }
        }
      }

      this.latestRotateResult = {
        objects: objectsPayload,
        freeEndpoints: Object.keys(freeEndpointsPayload).length > 0 ? freeEndpointsPayload : undefined
      };
    }

    this.render();
  }

  onPointerCancel(e) {
    this.cancelGesture();
  }

  cancelGesture() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }

    const doc = this.callbacks?.getDocument?.();

    if (this.isDraggingSelection && this.dragInitialPositions && doc?.objects) {
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

    if (this.isRotating && this.rotateData && doc?.objects) {
      for (const snap of this.rotateData.snapshotObjects) {
        const liveObj = doc.objects[snap.id];
        if (!liveObj) continue;
        liveObj.rotation = snap.rotation;
        if (snap.x !== undefined) liveObj.x = snap.x;
        if (snap.y !== undefined) liveObj.y = snap.y;
      }
      if (this.rotateData.snapshotFreeEndpoints) {
        for (const [connId, ep] of Object.entries(this.rotateData.snapshotFreeEndpoints)) {
          const liveConn = doc.objects[connId];
          if (!liveConn) continue;
          if (ep.from && liveConn.from && liveConn.from.point) liveConn.from.point = { ...ep.from };
          if (ep.to && liveConn.to && liveConn.to.point) liveConn.to.point = { ...ep.to };
        }
      }
      this.isRotating = false;
      this.rotateData = null;
      this.latestRotateResult = null;
    }

    if (this.isResizing && this.resizeData) {
      for (const snap of this.resizeData.snapshotObjects) {
        const liveObj = doc.objects[snap.id];
        if (!liveObj) continue;
        if (snap.type === 'connector') {
          if (snap.from) liveObj.from = cloneDocument(snap.from);
          if (snap.to) liveObj.to = cloneDocument(snap.to);
        } else {
          liveObj.x = snap.x;
          liveObj.y = snap.y;
          liveObj.width = snap.width;
          liveObj.height = snap.height;
          if (snap.type === 'path' && snap.points) {
            liveObj.points = cloneDocument(snap.points);
          }
          if (snap.textStyle) {
            liveObj.textStyle = cloneDocument(snap.textStyle);
          } else {
            delete liveObj.textStyle;
          }
        }
      }
    }

    if (this.isReconnecting && this.reconnectingData && this.reconnectOriginalTarget) {
      const conn = doc.objects[this.reconnectingData.connectorId];
      if (conn) {
        conn[this.reconnectingData.endpoint] = JSON.parse(JSON.stringify(this.reconnectOriginalTarget));
      }
    }

    if (this.isCurvingConnector && this.curvingConnectorData) {
      const conn = doc.objects[this.curvingConnectorData.connectorId];
      if (conn) {
        if (this.curvingConnectorData.type === 'curve') {
          conn.curveSide = this.curvingConnectorData.initialSide;
          if (this.curvingConnectorData.initialDistance === null) delete conn.curveDistance;
          else conn.curveDistance = this.curvingConnectorData.initialDistance;
        } else if (this.curvingConnectorData.type === 'elbow') {
          if (this.curvingConnectorData.initialOffset === null) delete conn.elbowOffset;
          else conn.elbowOffset = this.curvingConnectorData.initialOffset;
        }
      }
    }

    if (this.isDrawingLine) {
      this.cancelLine();
    }

    if (this.isDraggingVertex && this.draggingVertexData) {
      const doc = this.callbacks.getDocument();
      const obj = doc.objects[this.draggingVertexData.objId];
      if (obj) {
        obj.points = cloneDocument(this.draggingVertexData.initialPoints);
      }
      this.isDraggingVertex = false;
      this.draggingVertexData = null;
    }

    this.isPanning = false;
    this.isDraggingSelection = false;
    this.isResizing = false;
    this.isRotating = false;
    this.rotateData = null;
    this.latestRotateResult = null;
    this.isCreating = false;
    this.isReconnecting = false;
    this.isCurvingConnector = false;
    this.curvingConnectorData = null;
    this.isMarquee = false;
    this.activeHandle = null;
    this.resizeData = null;
    this.latestResizeResult = null;
    this.reconnectOriginalTarget = null;
    this.latestReconnectTarget = null;
    this.dragInitialPositions = null;
    this.dragAccumulatedDelta = null;
    this.snapGuides = [];
    this.marquee = null;
    this.draftObject = null;
    if (this.mode === 'reading') {
      this.activeTool = 'hand';
      this.updateCursor();
      this.render();
    } else {
      this.setTool('select');
    }
  }

  finishLine(closed = false) {
    if (!this.isDrawingLine || !this.linePoints || this.linePoints.length < 2) {
      this.cancelLine();
      return;
    }

    const rawPts = [...this.linePoints];
    if (closed && rawPts.length > 2) {
      const p0 = rawPts[0];
      const pLast = rawPts[rawPts.length - 1];
      if (Math.hypot(pLast.x - p0.x, pLast.y - p0.y) < 16) {
        rawPts.pop();
      }
    }

    if (rawPts.length < 2) {
      this.cancelLine();
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of rawPts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const width = Math.max(16, maxX - minX);
    const height = Math.max(16, maxY - minY);
    const points = rawPts.map(p => [Math.round(p.x - minX), Math.round(p.y - minY)]);

    const doc = this.callbacks.getDocument();
    const newObj = createDefaultObject('path', {
      x: minX,
      y: minY,
      width,
      height,
      points,
      closed,
      curveStyle: 'sharp'
    }, doc.theme);

    this.isDrawingLine = false;
    this.linePoints = null;
    this.lineRubberband = null;
    this.lineCloseSnapped = false;

    this.callbacks.onCommand({
      type: 'create_object',
      object: newObj
    });

    this.selectedIds = [newObj.id];
    this.setTool('select');
    this.render();
  }

  cancelLine() {
    this.isDrawingLine = false;
    this.linePoints = null;
    this.lineRubberband = null;
    this.lineCloseSnapped = false;
    this.render();
  }

  findObjectAt(worldPoint) {
    const doc = this.callbacks.getDocument();
    const hitThreshold = Math.max(12, 14 / this.camera.zoom);
    for (let i = doc.order.length - 1; i >= 0; i--) {
      const objId = doc.order[i];
      const obj = doc.objects[objId];
      if (!obj) continue;
      if (isPointInsideObject(worldPoint, obj, doc, hitThreshold)) {
        return obj;
      }
    }
    return null;
  }

  onContextMenu(e) {
    e.preventDefault();
    if (this.mode === 'reading') return;
    const worldPt = this.screenToWorld(e.clientX, e.clientY);
    const hitObj = this.findObjectAt(worldPt);

    if (hitObj) {
      if (!this.selectedIds.includes(hitObj.id)) {
        if (hitObj.groupId && this.activeGroupId !== hitObj.groupId) {
          const doc = this.callbacks.getDocument();
          this.selectedIds = Object.values(doc.objects)
            .filter(o => o.groupId === hitObj.groupId && !o.locked)
            .map(o => o.id);
        } else {
          this.selectedIds = [hitObj.id];
        }
      }
      this.callbacks.onOpenWheel(e.clientX, e.clientY, 'object', hitObj);
    } else {
      this.callbacks.onOpenWheel(e.clientX, e.clientY, 'canvas', null);
    }
  }

  onDblClick(e) {
    if (this.mode === 'reading') return;
    if (this.isDrawingLine && this.linePoints && this.linePoints.length >= 2) {
      this.finishLine(false);
      return;
    }
    const worldPt = this.screenToWorld(e.clientX, e.clientY);
    const hitObj = this.findObjectAt(worldPt);
    if (hitObj) {
      if (hitObj.groupId) {
        this.activeGroupId = hitObj.groupId;
        this.selectedIds = [hitObj.id];
        this.render();
      }
      this.callbacks.onDoubleClickedObject(hitObj);
    }
  }

  onPointerDown(e) {
    if (e.button !== 0 && e.button !== 1) return;

    if (this.mode === 'reading') {
      if (e.button === 0 || e.button === 1) {
        this.isPanning = true;
        this.panMoved = false;
        this.dragStart = { x: e.clientX - this.camera.x, y: e.clientY - this.camera.y };
        this.updateCursor();
      }
      return;
    }

    const worldPt = this.screenToWorld(e.clientX, e.clientY);
    this.pointerStartScreen = { x: e.clientX, y: e.clientY };

    // 1. Check if clicked a resize or connector handle (always takes priority on left click)
    const handleEl = e.button === 0 ? e.target?.closest?.('[data-handle]') : null;
    if (handleEl) {
      clearTimeout(this.longPressTimer);
      const handleId = handleEl.getAttribute('data-handle');
      if (handleId === 'conn-curve') {
        this.isCurvingConnector = true;
        const doc = this.callbacks.getDocument();
        const conn = doc.objects[this.selectedIds[0]];
        this.curvingConnectorData = {
          type: 'curve',
          connectorId: this.selectedIds[0],
          initialSide: conn?.curveSide !== undefined ? conn.curveSide : 1,
          currentSide: conn?.curveSide !== undefined ? conn.curveSide : 1,
          initialDistance: conn?.curveDistance !== undefined ? conn.curveDistance : null,
          currentDistance: conn?.curveDistance !== undefined ? conn.curveDistance : null,
          startPt: { ...worldPt }
        };
        return;
      } else if (handleId === 'conn-elbow') {
        this.isCurvingConnector = true;
        const doc = this.callbacks.getDocument();
        const conn = doc.objects[this.selectedIds[0]];
        this.curvingConnectorData = {
          type: 'elbow',
          connectorId: this.selectedIds[0],
          initialOffset: conn?.elbowOffset !== undefined ? conn.elbowOffset : null,
          currentOffset: conn?.elbowOffset !== undefined ? conn.elbowOffset : null,
          startPt: { ...worldPt }
        };
        return;
      } else if (handleId.startsWith('conn-')) {
        this.isReconnecting = true;
        this.reconnectingData = {
          connectorId: this.selectedIds[0],
          endpoint: handleId === 'conn-from' ? 'from' : 'to'
        };
        const doc = this.callbacks.getDocument();
        const conn = doc.objects[this.selectedIds[0]];
        this.reconnectOriginalTarget = conn ? JSON.parse(JSON.stringify(conn[this.reconnectingData.endpoint])) : null;
        this.latestReconnectTarget = null;
        this.reconnectSnapIndicator = null;
      } else if (handleId.startsWith('vertex-')) {
        const vertexIndex = parseInt(handleId.replace('vertex-', ''), 10);
        const doc = this.callbacks.getDocument();
        const obj = doc.objects[this.selectedIds[0]];
        if (obj && obj.type === 'path' && Array.isArray(obj.points) && !obj.locked) {
          this.isDraggingVertex = true;
          this.draggingVertexData = {
            objId: obj.id,
            vertexIndex,
            initialPoints: cloneDocument(obj.points),
            initialBounds: { x: obj.x, y: obj.y, width: obj.width, height: obj.height },
            initialRotation: obj.rotation || 0,
            startPt: { ...worldPt }
          };
          return;
        }
      } else if (handleId === 'rotate') {
        const doc = this.callbacks.getDocument();
        const spatialObjects = this.selectedIds.map(id => doc.objects[id]).filter(o => o && o.type !== 'connector' && !o.locked);
        if (spatialObjects.length === 0) return;

        let pivot;
        if (this.selectedIds.length === 1 && !doc.objects[this.selectedIds[0]].locked) {
          const singleObj = doc.objects[this.selectedIds[0]];
          pivot = { x: singleObj.x + singleObj.width / 2, y: singleObj.y + singleObj.height / 2 };
        } else {
          const unionBox = getUnionBoundingBox(spatialObjects, doc);
          if (!unionBox) return;
          pivot = { x: unionBox.cx, y: unionBox.cy };
        }

        const selectedConnectors = this.selectedIds.map(id => doc.objects[id]).filter(o => o && o.type === 'connector' && !o.locked);
        const snapshotObjects = spatialObjects.map(o => cloneDocument(o));
        const snapshotFreeEndpoints = {};
        for (const conn of selectedConnectors) {
          const ep = {};
          if (conn.from?.point && !conn.from.id) ep.from = { ...conn.from.point };
          if (conn.to?.point && !conn.to.id) ep.to = { ...conn.to.point };
          if (Object.keys(ep).length > 0) snapshotFreeEndpoints[conn.id] = ep;
        }

        const startAngle = Math.atan2(worldPt.y - pivot.y, worldPt.x - pivot.x) * (180 / Math.PI);

        this.isRotating = true;
        const initialShift = Boolean(e.shiftKey);
        this.rotateData = {
          pivot,
          startAngle,
          snapshotObjects,
          snapshotFreeEndpoints,
          isSingle: spatialObjects.length === 1 && this.selectedIds.length === 1,
          lastShiftKey: initialShift,
          lastEffectiveDelta: 0,
          shiftAnchorAngle: startAngle,
          shiftBaseDelta: 0,
          unsnappedAnchorAngle: startAngle,
          unsnappedBaseDelta: 0,
          lastWorldPt: { ...worldPt }
        };
        this.latestRotateResult = null;
        return;
      } else {
        this.isResizing = true;
        this.activeHandle = handleId;
        const doc = this.callbacks.getDocument();
        const spatialObjects = this.selectedIds.map(id => doc.objects[id]).filter(o => o && o.type !== 'connector' && !o.locked);
        if (spatialObjects.length === 0) {
          this.isResizing = false;
          this.activeHandle = null;
          return;
        }

        const isSingleRotated = (this.selectedIds.length === 1 && !doc.objects[this.selectedIds[0]].locked && Boolean(doc.objects[this.selectedIds[0]].rotation));
        const singleObj = this.selectedIds.length === 1 ? doc.objects[this.selectedIds[0]] : null;
        const origBox = isSingleRotated
          ? { x: singleObj.x, y: singleObj.y, width: singleObj.width, height: singleObj.height }
          : ((this.selectedIds.length === 1 && !doc.objects[this.selectedIds[0]].locked)
              ? getBoundingBox(doc.objects[this.selectedIds[0]])
              : getUnionBoundingBox(spatialObjects, doc));

        if (!origBox || origBox.width < 0 || origBox.height < 0) {
          this.isResizing = false;
          this.activeHandle = null;
          return;
        }

        const selectedConnectors = this.selectedIds.map(id => doc.objects[id]).filter(o => o && o.type === 'connector' && !o.locked);
        const snapshotObjects = [...spatialObjects, ...selectedConnectors].map(o => cloneDocument(o));

        this.resizeData = {
          handle: handleId,
          origBox: { ...origBox },
          snapshotObjects,
          isSingleRotated,
          rotation: isSingleRotated ? (singleObj.rotation || 0) : 0
        };
        this.latestResizeResult = null;
        this.dragStart = { ...worldPt };
      }
      return;
    }

    // 2. If middle click or space held or activeTool === 'hand', start panning
    if (e.button === 1 || this.spaceHeld || this.activeTool === 'hand') {
      this.isPanning = true;
      this.panMoved = false;
      this.dragStart = { x: e.clientX - this.camera.x, y: e.clientY - this.camera.y };
      this.updateCursor();
      return;
    }

    // Setup long-press timer (500ms) for opening circular wheel on touch / static click
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      const hit = this.findObjectAt(worldPt);
      this.callbacks.onOpenWheel(e.clientX, e.clientY, hit ? 'object' : 'canvas', hit);
    }, 500);

    // Check if clicked an object
    const hitObj = this.findObjectAt(worldPt);

    if (this.activeTool === 'select') {
      if (hitObj) {
        clearTimeout(this.longPressTimer);
        let targetId = hitObj.id;
        const doc = this.callbacks.getDocument();

        // Locked objects are immune to multi-selection, movement, and drag
        if (hitObj.locked) {
          if (!e.shiftKey) {
            this.selectedIds = [targetId];
            this.activeGroupId = null;
          }
          this.render();
          return;
        }

        // Group selection logic: if part of group, select all group members unless drilled in
        if (hitObj.groupId) {
          const groupMembers = Object.values(doc.objects)
            .filter(o => o.groupId === hitObj.groupId && !o.locked)
            .map(o => o.id);

          if (e.shiftKey) {
            const allIn = groupMembers.every(id => this.selectedIds.includes(id));
            if (allIn) {
              this.selectedIds = this.selectedIds.filter(id => !groupMembers.includes(id));
            } else {
              this.selectedIds = Array.from(new Set([...this.selectedIds, ...groupMembers]));
            }
          } else if (this.activeGroupId === hitObj.groupId) {
            // Already drilled into this group: work with this child
            this.selectedIds = [targetId];
          } else if (this.selectedIds.includes(targetId)) {
            // Target is already part of current selection: keep selection intact so dragging moves all members together!
            this.activeGroupId = null;
            const allIn = groupMembers.every(id => this.selectedIds.includes(id));
            if (!allIn) {
              this.selectedIds = Array.from(new Set([...this.selectedIds, ...groupMembers]));
            }
          } else {
            // Not drilled in and target was not selected: select the entire group as a unit
            this.activeGroupId = null;
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
            this.activeGroupId = null;
            this.selectedIds = [targetId];
          }
        }

        this.isDraggingSelection = true;
        this.isDDragging = Boolean(this.isDHeld);
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
          this.activeGroupId = null;
        }
        this.isMarquee = true;
        this.marquee = { startX: worldPt.x, startY: worldPt.y, currentX: worldPt.x, currentY: worldPt.y };
        this.render();
      }
      return;
    }

    // Line / Polygon tool
    if (this.activeTool === 'line') {
      clearTimeout(this.longPressTimer);
      if (!this.isDrawingLine) {
        this.isDrawingLine = true;
        this.linePoints = [{ x: worldPt.x, y: worldPt.y }];
        this.lineRubberband = { x: worldPt.x, y: worldPt.y };
        this.lineCloseSnapped = false;
        this.render();
      } else {
        const p0 = this.linePoints[0];
        const distToStart = Math.hypot(worldPt.x - p0.x, worldPt.y - p0.y);
        const snapDist = Math.max(14, 16 / this.camera.zoom);
        if (this.linePoints.length >= 3 && (this.lineCloseSnapped || distToStart <= snapDist)) {
          this.finishLine(true);
        } else {
          const lastPt = this.linePoints[this.linePoints.length - 1];
          if (Math.hypot(worldPt.x - lastPt.x, worldPt.y - lastPt.y) > 3) {
            this.linePoints.push({ x: worldPt.x, y: worldPt.y });
            this.lineRubberband = { x: worldPt.x, y: worldPt.y };
            this.render();
          }
        }
      }
      return;
    }

    // Standard shape & connector creation tools
    if (['rectangle', 'ellipse', 'diamond', 'triangle', 'text', 'connector'].includes(this.activeTool)) {
      clearTimeout(this.longPressTimer);
      this.isCreating = true;
      this.dragStart = { ...worldPt };

      const doc = this.callbacks.getDocument();
      const type = this.activeTool;

      if (type === 'connector') {
        const startHit = this.findObjectAt(worldPt);
        this.draftObject = createDefaultObject('connector', {
          routing: this.connectorRouting || 'straight',
          from: startHit ? { id: startHit.id } : { point: { x: worldPt.x, y: worldPt.y } },
          to: { point: { x: worldPt.x, y: worldPt.y } }
        }, doc.theme);
      } else {
        this.draftObject = createDefaultObject(type, {
          x: worldPt.x,
          y: worldPt.y,
          width: 1,
          height: 1
        }, doc.theme);
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
      if (this.pointerStartScreen && Math.hypot(e.clientX - this.pointerStartScreen.x, e.clientY - this.pointerStartScreen.y) > 3) {
        this.panMoved = true;
      }
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
      const includedGroups = new Set();

      for (const obj of Object.values(doc.objects)) {
        if (obj.locked) continue; // Locked objects are never selected by marquee!
        const b = getBoundingBox(obj, doc);
        if (!b) continue;
        if (b.x < mr && b.right > mx && b.y < mb && b.bottom > my) {
          hits.push(obj.id);
          if (obj.groupId) includedGroups.add(obj.groupId);
        }
      }

      // If any member of a group was intersected, expand to all unlocked members of that group
      if (includedGroups.size > 0) {
        for (const obj of Object.values(doc.objects)) {
          if (!obj.locked && obj.groupId && includedGroups.has(obj.groupId)) {
            if (!hits.includes(obj.id)) {
              hits.push(obj.id);
            }
          }
        }
      }

      this.selectedIds = hits;
      this.render();
      return;
    }

    if (this.isDraggingSelection && this.selectedIds.length > 0 && this.dragInitialPositions) {
      const doc = this.callbacks.getDocument();

      // Holding plain D while dragging: drag out a copy!
      if (this.isDHeld && !this.isDDragging) {
        this.isDDragging = true;
        // Restore originals to pristine initial positions
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
      }

      const selectedObjects = this.selectedIds.map(id => doc.objects[id]).filter(Boolean);
      const union = getUnionBoundingBox(selectedObjects, doc);
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
          gridSize: this.gridSize,
          doc
        });

        dx += (snap.x - testBox.x);
        dy += (snap.y - testBox.y);
        this.snapGuides = snap.guides;
      } else {
        this.snapGuides = [];
      }

      this.dragAccumulatedDelta = { dx, dy };

      if (this.isDDragging) {
        // In D-drag mode, originals are never touched! We simply re-render with preview clones.
        this.render();
        return;
      }

      for (const id of this.selectedIds) {
        const obj = doc.objects[id];
        const initial = this.dragInitialPositions[id];
        if (obj && initial) {
          if (obj.x !== undefined && initial.x !== undefined) {
            obj.x = initial.x + dx;
            obj.y = initial.y + dy;
          }
          if (obj.type === 'connector') {
            if (initial.fromPoint && obj.from) obj.from.point = { x: initial.fromPoint.x + dx, y: initial.fromPoint.y + dy };
            if (initial.toPoint && obj.to) obj.to.point = { x: initial.toPoint.x + dx, y: initial.toPoint.y + dy };
          }
        }
      }
      this.render();
      return;
    }

    if (this.isRotating && this.rotateData) {
      this.rotateData.lastWorldPt = { ...worldPt };
      this.updateRotationPreview(worldPt, e.shiftKey);
      return;
    }

    if (this.isResizing && this.resizeData) {
      const dx = worldPt.x - this.dragStart.x;
      const dy = worldPt.y - this.dragStart.y;
      const keepAspect = e.shiftKey;
      const fromCenter = e.altKey;

      if (this.resizeData.isSingleRotated) {
        const snap = this.resizeData.snapshotObjects[0];
        const newBox = calculateRotatedResize(
          this.activeHandle,
          this.resizeData.origBox,
          dx,
          dy,
          this.resizeData.rotation,
          { keepAspect, fromCenter }
        );

        const doc = this.callbacks.getDocument();
        const liveObj = doc.objects[snap.id];
        if (liveObj) {
          liveObj.x = newBox.x;
          liveObj.y = newBox.y;
          liveObj.width = newBox.width;
          liveObj.height = newBox.height;

          const scaleX = this.resizeData.origBox.width > 0 ? newBox.width / this.resizeData.origBox.width : 1;
          const scaleY = this.resizeData.origBox.height > 0 ? newBox.height / this.resizeData.origBox.height : 1;
          const textScale = (scaleX + scaleY) / 2;

          if (snap.type === 'path' && Array.isArray(snap.points)) {
            liveObj.points = snap.points.map(pt => {
              const px = Array.isArray(pt) ? pt[0] : pt.x;
              const py = Array.isArray(pt) ? pt[1] : pt.y;
              return {
                x: Math.round(px * scaleX),
                y: Math.round(py * scaleY)
              };
            });
          }

          if (snap.textStyle) {
            const baseSize = snap.textStyle.resolvedSize || 20;
            const newResolvedSize = Math.max(10, Math.min(120, Math.round(baseSize * textScale)));
            liveObj.textStyle = {
              ...snap.textStyle,
              resolvedSize: newResolvedSize
            };
            if (snap.type === 'text') {
              const familyToken = snap.textStyle?.fontFamily || 'hand';
              const m = measureText(snap.text, newResolvedSize, familyToken);
              liveObj.width = m.width;
              liveObj.height = m.height;
            }
          }
        }

        this.latestResizeResult = {
          newBox,
          transformed: [cloneDocument(liveObj)]
        };
        this.render();
        return;
      }

      const newBox = calculateResize(this.activeHandle, this.resizeData.origBox, dx, dy, {
        keepAspect,
        fromCenter
      });

      const transformed = transformObjects(this.resizeData.snapshotObjects, this.resizeData.origBox, newBox);
      const doc = this.callbacks.getDocument();

      for (const tObj of transformed) {
        const liveObj = doc.objects[tObj.id];
        if (!liveObj) continue;
        if (tObj.type === 'connector') {
          if (tObj.from) liveObj.from = cloneDocument(tObj.from);
          if (tObj.to) liveObj.to = cloneDocument(tObj.to);
        } else {
          liveObj.x = tObj.x;
          liveObj.y = tObj.y;
          liveObj.width = tObj.width;
          liveObj.height = tObj.height;
          if (tObj.type === 'path' && tObj.points) {
            liveObj.points = cloneDocument(tObj.points);
          }
          if (tObj.textStyle) {
            liveObj.textStyle = cloneDocument(tObj.textStyle);
          }
        }
      }

      this.latestResizeResult = { newBox, transformed };
      this.render();
      return;
    }

    if (this.isCurvingConnector && this.curvingConnectorData) {
      const doc = this.callbacks.getDocument();
      const conn = doc.objects[this.curvingConnectorData.connectorId];
      if (conn && conn.routing === 'curved') {
        const geom = resolveConnectorGeometry(doc, conn);
        const dx = geom.end.x - geom.start.x;
        const dy = geom.end.y - geom.start.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0) {
          const normal = { x: -dy / dist, y: dx / dist };
          const midX = (geom.start.x + geom.end.x) / 2;
          const midY = (geom.start.y + geom.end.y) / 2;
          const dot = (worldPt.x - midX) * normal.x + (worldPt.y - midY) * normal.y;
          const newSide = dot >= 0 ? 1 : -1;
          const chordDist = Math.abs(dot);
          const newDistance = Math.round(Math.max(10, chordDist * 2));
          conn.curveSide = newSide;
          conn.curveDistance = newDistance;
          this.curvingConnectorData.currentSide = newSide;
          this.curvingConnectorData.currentDistance = newDistance;
          this.render();
        }
      } else if (conn && conn.routing === 'elbow') {
        const geom = resolveConnectorGeometry(doc, conn);
        const dx = geom.end.x - geom.start.x;
        const dy = geom.end.y - geom.start.y;
        let newOffset;
        if (Math.abs(dx) >= Math.abs(dy)) {
          const midY = (geom.start.y + geom.end.y) / 2;
          const baseY = worldPt.y >= midY ? Math.max(geom.start.y, geom.end.y) : Math.min(geom.start.y, geom.end.y);
          newOffset = Math.round(worldPt.y - baseY);
          if (Math.abs(newOffset) < 15) newOffset = newOffset >= 0 ? 20 : -20;
        } else {
          const midX = (geom.start.x + geom.end.x) / 2;
          const baseX = worldPt.x >= midX ? Math.max(geom.start.x, geom.end.x) : Math.min(geom.start.x, geom.end.x);
          newOffset = Math.round(worldPt.x - baseX);
          if (Math.abs(newOffset) < 15) newOffset = newOffset >= 0 ? 20 : -20;
        }
        conn.elbowOffset = newOffset;
        this.curvingConnectorData.currentOffset = newOffset;
        this.render();
      }
      return;
    }

    if (this.isReconnecting && this.reconnectingData) {
      const doc = this.callbacks.getDocument();
      const connId = this.reconnectingData.connectorId;
      const conn = doc.objects[connId];
      const attachedId = this.reconnectOriginalTarget?.id;
      const attachedObj = attachedId ? doc.objects[attachedId] : null;

      let targetObj = null;
      const hit = this.findObjectAt(worldPt);

      // Direct hit on an object (excluding the connector itself)
      if (hit && hit.id !== connId && hit.type !== 'connector') {
        targetObj = hit;
      } else if (attachedObj) {
        // Generous buffer (24px screen-space) around currently attached object to prevent accidental detachment
        const b = getBoundingBox(attachedObj);
        const buf = 24 / this.camera.zoom;
        if (worldPt.x >= b.x - buf && worldPt.x <= b.right + buf &&
            worldPt.y >= b.y - buf && worldPt.y <= b.bottom + buf) {
          targetObj = attachedObj;
        }
      }

      // If still no target, check if within gentle buffer of any other non-connector shape
      if (!targetObj) {
        const buf = 14 / this.camera.zoom;
        for (const o of Object.values(doc.objects)) {
          if (o.id !== connId && o.type !== 'connector') {
            const b = getBoundingBox(o);
            if (worldPt.x >= b.x - buf && worldPt.x <= b.right + buf &&
                worldPt.y >= b.y - buf && worldPt.y <= b.bottom + buf) {
              targetObj = o;
              break;
            }
          }
        }
      }

      let target;
      if (targetObj) {
        const closest = getClosestBoundaryPoint(targetObj, worldPt, 14 / this.camera.zoom);
        target = {
          id: targetObj.id,
          anchor: closest.anchor
        };
        this.reconnectSnapIndicator = closest.snapped ? {
          point: closest.point,
          snapName: closest.snapName,
          objectId: targetObj.id
        } : null;
      } else {
        target = { point: { x: worldPt.x, y: worldPt.y } };
        this.reconnectSnapIndicator = null;
      }

      if (conn) {
        conn[this.reconnectingData.endpoint] = target;
        this.latestReconnectTarget = target;
        this.render();
      }
      return;
    }

    if (this.isDraggingVertex && this.draggingVertexData) {
      const doc = this.callbacks.getDocument();
      const obj = doc.objects[this.draggingVertexData.objId];
      if (obj && obj.type === 'path' && Array.isArray(obj.points)) {
        const idx = this.draggingVertexData.vertexIndex;
        const rot = this.draggingVertexData.initialRotation || 0;
        const origBounds = this.draggingVertexData.initialBounds;
        const cx = origBounds.x + origBounds.width / 2;
        const cy = origBounds.y + origBounds.height / 2;
        const localPt = rot ? unrotatePoint(worldPt, { x: cx, y: cy }, rot) : worldPt;
        const relX = localPt.x - origBounds.x;
        const relY = localPt.y - origBounds.y;
        obj.points[idx] = [Math.round(relX), Math.round(relY)];
        this.render();
      }
      return;
    }

    if (this.isDrawingLine && this.linePoints && this.linePoints.length > 0) {
      const p0 = this.linePoints[0];
      const distToStart = Math.hypot(worldPt.x - p0.x, worldPt.y - p0.y);
      const snapDist = Math.max(14, 16 / this.camera.zoom);
      if (this.linePoints.length >= 3 && distToStart <= snapDist) {
        this.lineCloseSnapped = true;
        this.lineRubberband = { ...p0 };
      } else {
        this.lineCloseSnapped = false;
        this.lineRubberband = { ...worldPt };
      }
      this.render();
      return;
    }

    if (this.isCreating && this.draftObject) {
      if (this.draftObject.type === 'connector') {
        const hit = this.findObjectAt(worldPt);
        this.draftObject.to = hit && hit.id !== this.draftObject.from?.id ? { id: hit.id } : { point: { ...worldPt } };
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
      if (this.mode !== 'reading' && !this.panMoved && e.button === 0 && !this.spaceHeld) {
        // Static click while in Hand mode: if clicked an object, select it and switch to select tool!
        const pt = this.screenToWorld(e.clientX, e.clientY);
        const hit = this.findObjectAt(pt);
        if (hit) {
          this.selectedIds = [hit.id];
          this.setTool('select');
          this.render();
          return;
        } else if (this.selectedIds.length > 0) {
          this.selectedIds = [];
          this.render();
        }
      }
    }

    if (this.isMarquee) {
      this.isMarquee = false;
      this.marquee = null;
      this.render();
    }

    if (this.isDraggingSelection) {
      this.isDraggingSelection = false;
      this.snapGuides = [];
      const doc = this.callbacks.getDocument();

      if (this.isDDragging) {
        this.isDDragging = false;
        if (this.dragAccumulatedDelta && (this.dragAccumulatedDelta.dx !== 0 || this.dragAccumulatedDelta.dy !== 0)) {
          const origIds = [...this.selectedIds];
          this.callbacks.onCommand({
            type: 'duplicate_objects',
            ids: origIds,
            offset: { x: this.dragAccumulatedDelta.dx, y: this.dragAccumulatedDelta.dy }
          });
          const updatedDoc = this.callbacks.getDocument();
          this.selectedIds = updatedDoc.order.slice(-origIds.length);
        }
        this.dragInitialPositions = null;
        this.dragAccumulatedDelta = null;
        this.render();
        return;
      }

      // Restore initial positions first so dispatchCommand applies clean delta
      if (this.dragInitialPositions) {
        for (const [id, pos] of Object.entries(this.dragInitialPositions)) {
          const obj = doc.objects[id];
          if (obj) {
            if (obj.x !== undefined && pos.x !== undefined) {
              obj.x = pos.x;
              obj.y = pos.y;
            }
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

    if (this.isCurvingConnector) {
      this.isCurvingConnector = false;
      const data = this.curvingConnectorData;
      this.curvingConnectorData = null;

      if (data) {
        const doc = this.callbacks.getDocument();
        const conn = doc.objects[data.connectorId];
        const worldPt = this.screenToWorld(e.clientX, e.clientY);
        const dragDist = Math.hypot(worldPt.x - data.startPt.x, worldPt.y - data.startPt.y);

        if (data.type === 'curve') {
          let finalSide = data.currentSide;
          let finalDistance = data.currentDistance;

          if (dragDist < 5) {
            // Static click: toggle side
            finalSide = data.initialSide === -1 ? 1 : -1;
            finalDistance = data.initialDistance;
          }

          // Restore initial side and distance before applying command so undo history records clean change
          if (conn) {
            conn.curveSide = data.initialSide;
            if (data.initialDistance === null) delete conn.curveDistance;
            else conn.curveDistance = data.initialDistance;
          }

          if (finalSide !== data.initialSide || finalDistance !== data.initialDistance) {
            this.callbacks.onCommand({
              type: 'configure_connector',
              id: data.connectorId,
              curveSide: finalSide,
              curveDistance: finalDistance
            });
          }
        } else if (data.type === 'elbow') {
          let finalOffset = data.currentOffset;

          if (dragDist < 5) {
            // Static click: toggle bypass side or set default bypass
            if (data.initialOffset === null || data.initialOffset === 0) {
              finalOffset = 80;
            } else {
              finalOffset = -data.initialOffset;
            }
          }

          // Restore initial offset before applying command so undo history records clean change
          if (conn) {
            if (data.initialOffset === null) delete conn.elbowOffset;
            else conn.elbowOffset = data.initialOffset;
          }

          if (finalOffset !== data.initialOffset) {
            this.callbacks.onCommand({
              type: 'configure_connector',
              id: data.connectorId,
              elbowOffset: finalOffset
            });
          }
        }
      }
      this.render();
      return;
    }

    if (this.isDraggingVertex && this.draggingVertexData) {
      this.isDraggingVertex = false;
      const data = this.draggingVertexData;
      this.draggingVertexData = null;

      const doc = this.callbacks.getDocument();
      const obj = doc.objects[data.objId];
      if (obj && obj.type === 'path') {
        const finalPoints = cloneDocument(obj.points);
        obj.points = cloneDocument(data.initialPoints);

        const origBounds = data.initialBounds;
        const rot = data.initialRotation || 0;
        const origCenter = {
          x: origBounds.x + origBounds.width / 2,
          y: origBounds.y + origBounds.height / 2
        };

        const unrotatedPts = finalPoints.map(p => ({
          x: origBounds.x + (Array.isArray(p) ? p[0] : p.x),
          y: origBounds.y + (Array.isArray(p) ? p[1] : p.y)
        }));

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of unrotatedPts) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        const width = Math.max(16, maxX - minX);
        const height = Math.max(16, maxY - minY);
        const normalizedPoints = unrotatedPts.map(p => [Math.round(p.x - minX), Math.round(p.y - minY)]);

        let finalX = minX;
        let finalY = minY;
        if (rot !== 0) {
          const newLocalCenter = { x: minX + width / 2, y: minY + height / 2 };
          const newWorldCenter = rotatePoint(newLocalCenter, origCenter, rot);
          finalX = Math.round((newWorldCenter.x - width / 2) * 100) / 100;
          finalY = Math.round((newWorldCenter.y - height / 2) * 100) / 100;
        }

        this.callbacks.onCommand({
          type: 'update_path_points',
          id: data.objId,
          points: normalizedPoints,
          bounds: { x: finalX, y: finalY, width, height }
        });
      }
      this.render();
      return;
    }

    if (this.isRotating) {
      this.isRotating = false;
      const doc = this.callbacks.getDocument();

      // Restore document objects to initial snapshot baseline before dispatching command
      if (this.rotateData) {
        for (const snap of this.rotateData.snapshotObjects) {
          const liveObj = doc.objects[snap.id];
          if (!liveObj) continue;
          liveObj.rotation = snap.rotation;
          if (snap.x !== undefined) liveObj.x = snap.x;
          if (snap.y !== undefined) liveObj.y = snap.y;
        }
        if (this.rotateData.snapshotFreeEndpoints) {
          for (const [connId, ep] of Object.entries(this.rotateData.snapshotFreeEndpoints)) {
            const liveConn = doc.objects[connId];
            if (!liveConn) continue;
            if (ep.from && liveConn.from && liveConn.from.point) liveConn.from.point = { ...ep.from };
            if (ep.to && liveConn.to && liveConn.to.point) liveConn.to.point = { ...ep.to };
          }
        }
      }

      if (this.latestRotateResult && this.rotateData) {
        let hasChange = false;
        if (this.latestRotateResult.objects) {
          for (const [id, entry] of Object.entries(this.latestRotateResult.objects)) {
            const origSnap = this.rotateData.snapshotObjects.find(s => s.id === id);
            const origRot = origSnap ? (origSnap.rotation || 0) : 0;
            const newRot = entry.rotation || 0;
            if (Math.abs(normalizeAngle(newRot) - normalizeAngle(origRot)) > 0.01) {
              hasChange = true;
              break;
            }
            if (entry.x !== undefined && origSnap && (entry.x !== origSnap.x || entry.y !== origSnap.y)) {
              hasChange = true;
              break;
            }
          }
        }

        if (hasChange) {
          this.callbacks.onCommand({
            type: 'rotate_objects',
            objects: this.latestRotateResult.objects,
            freeEndpoints: this.latestRotateResult.freeEndpoints
          });
        }
      }

      this.rotateData = null;
      this.latestRotateResult = null;
      this.render();
      return;
    }

    if (this.isResizing) {
      this.isResizing = false;
      const doc = this.callbacks.getDocument();

      // Restore document objects to initial snapshot baseline before dispatching command
      if (this.resizeData) {
        for (const snap of this.resizeData.snapshotObjects) {
          const liveObj = doc.objects[snap.id];
          if (!liveObj) continue;
          if (snap.type === 'connector') {
            if (snap.from) liveObj.from = cloneDocument(snap.from);
            if (snap.to) liveObj.to = cloneDocument(snap.to);
          } else {
            liveObj.x = snap.x;
            liveObj.y = snap.y;
            liveObj.width = snap.width;
            liveObj.height = snap.height;
            if (snap.type === 'path' && snap.points) {
              liveObj.points = cloneDocument(snap.points);
            }
            if (snap.textStyle) {
              liveObj.textStyle = cloneDocument(snap.textStyle);
            } else {
              delete liveObj.textStyle;
            }
          }
        }
      }

      if (this.latestResizeResult && this.resizeData) {
        const { transformed } = this.latestResizeResult;
        const cmds = [];

        for (const tObj of transformed) {
          if (tObj.type === 'connector') {
            const origSnap = this.resizeData.snapshotObjects.find(s => s.id === tObj.id);
            const fromChanged = JSON.stringify(tObj.from) !== JSON.stringify(origSnap?.from);
            const toChanged = JSON.stringify(tObj.to) !== JSON.stringify(origSnap?.to);
            if (fromChanged || toChanged) {
              cmds.push({
                type: 'configure_connector_endpoints',
                id: tObj.id,
                from: cloneDocument(tObj.from),
                to: cloneDocument(tObj.to)
              });
            }
          } else {
            const cmdObj = {
              type: 'resize_object',
              id: tObj.id,
              bounds: { x: tObj.x, y: tObj.y, width: tObj.width, height: tObj.height },
              textStyle: tObj.textStyle ? cloneDocument(tObj.textStyle) : undefined,
              scaleText: false
            };
            if (tObj.type === 'path' && tObj.points) {
              cmdObj.points = cloneDocument(tObj.points);
            }
            cmds.push(cmdObj);
          }
        }

        if (cmds.length === 1) {
          this.callbacks.onCommand(cmds[0]);
        } else if (cmds.length > 1) {
          this.callbacks.onCommandBatch(cmds);
        }
      }

      this.activeHandle = null;
      this.resizeData = null;
      this.latestResizeResult = null;
      this.render();
    }

    if (this.isReconnecting) {
      this.isReconnecting = false;
      this.reconnectSnapIndicator = null;
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

      if (obj.type === 'connector') {
        const hit = this.findObjectAt(worldPt);
        if (hit && (!obj.from?.id || hit.id !== obj.from.id)) {
          obj.to = { id: hit.id };
        } else {
          const startPt = obj.from?.point || this.dragStart;
          const endPt = obj.to?.point || worldPt;
          const dist = Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y);
          if (dist < 15) {
            obj.to = { point: { x: startPt.x + 140, y: startPt.y + 70 } };
          }
        }
        delete obj.x;
        delete obj.y;
        delete obj.width;
        delete obj.height;

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
    const isReading = this.mode === 'reading';
    const draftGeometry = this.draftObject?.type === 'connector'
      ? resolveConnectorGeometry(doc, this.draftObject)
      : null;
    const runtime = {
      camera: this.camera,
      selectedIds: isReading ? [] : this.selectedIds,
      marquee: isReading ? null : this.marquee,
      snapGuides: isReading ? [] : this.snapGuides,
      showGrid: this.showGrid !== false,
      reconnectSnapIndicator: (this.isReconnecting && !isReading) ? this.reconnectSnapIndicator : null,
      connectorDraft: (this.draftObject?.type === 'connector' && !isReading) ? {
        start: draftGeometry?.start || this.draftObject.from?.point || this.dragStart,
        end: draftGeometry?.end || this.draftObject.to?.point || this.dragStart
      } : null
    };

    let sceneSvg = renderSvgScene(doc, runtime);

    // If D-drag is in progress, insert duplicate preview clones before world-layer closing
    if (!isReading && this.isDDragging && this.dragAccumulatedDelta && this.selectedIds.length > 0) {
      const dx = this.dragAccumulatedDelta.dx;
      const dy = this.dragAccumulatedDelta.dy;
      const previews = this.selectedIds.map(id => {
        const orig = doc.objects[id];
        if (!orig) return null;
        const p = cloneDocument(orig);
        p.id = 'preview-' + p.id;
        p.x += dx;
        p.y += dy;
        if (p.type === 'connector') {
          if (p.from?.point) { p.from.point.x += dx; p.from.point.y += dy; }
          if (p.to?.point) { p.to.point.x += dx; p.to.point.y += dy; }
        }
        return p;
      }).filter(Boolean);

      const previewMarkup = previews.map(p => renderObject(doc, p, false)).join('\n');
      const worldCloseIndex = sceneSvg.lastIndexOf('</g>');
      if (worldCloseIndex !== -1) {
        sceneSvg = sceneSvg.slice(0, worldCloseIndex) + '\n' + previewMarkup + '\n' + sceneSvg.slice(worldCloseIndex);
      }
    }

    // If a creation draft is in progress, insert it before world-layer closing
    if (!isReading && this.draftObject) {
      const draftSvg = renderObject(doc, this.draftObject, false);
      const worldCloseIndex = sceneSvg.lastIndexOf('</g>');
      if (worldCloseIndex !== -1) {
        sceneSvg = sceneSvg.slice(0, worldCloseIndex) + '\n' + draftSvg + '\n' + sceneSvg.slice(worldCloseIndex);
      }
    }

    // If line drafting is in progress, insert interactive preview before world-layer closing
    if (!isReading && this.isDrawingLine && this.linePoints && this.linePoints.length > 0) {
      const stroke = doc.theme?.defaultStroke || '#1e1e1e';
      const p0 = this.linePoints[0];
      let d = `M ${p0.x} ${p0.y}`;
      for (let i = 1; i < this.linePoints.length; i++) {
        d += ` L ${this.linePoints[i].x} ${this.linePoints[i].y}`;
      }
      if (this.lineRubberband) {
        d += ` L ${this.lineRubberband.x} ${this.lineRubberband.y}`;
      }
      const circles = this.linePoints.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${stroke}" pointer-events="none" />`).join('\n');
      let snapMarker = '';
      if (this.lineCloseSnapped && this.linePoints.length >= 3) {
        snapMarker = `
          <circle cx="${p0.x}" cy="${p0.y}" r="9" fill="none" stroke="#2f9e44" stroke-width="2.5" pointer-events="none" />
          <text x="${p0.x}" y="${p0.y - 12}" font-size="11" font-weight="bold" font-family="-apple-system, sans-serif" fill="#2f9e44" text-anchor="middle" pointer-events="none">Click to close</text>
        `;
      }
      const lineMarkup = `
        <g class="draft-line-preview" pointer-events="none">
          <path d="${d}" stroke="${stroke}" stroke-width="2" stroke-dasharray="4,4" fill="none" />
          ${circles}
          ${snapMarker}
        </g>
      `;
      const worldCloseIndex = sceneSvg.lastIndexOf('</g>');
      if (worldCloseIndex !== -1) {
        sceneSvg = sceneSvg.slice(0, worldCloseIndex) + '\n' + lineMarkup + '\n' + sceneSvg.slice(worldCloseIndex);
      }
    }

    this.container.innerHTML = sceneSvg;
    this.callbacks.onZoomChange?.(this.camera.zoom);
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
