/**
 * Sabura Geometry Engine: Bounding boxes, Snapping, Alignment, Distribution, Intersections, and Routing.
 */

import { MIN_OBJECT_SIZE, FONT_FAMILIES } from './types.js';

/**
 * Rotates a 2D point around a pivot by an angle in degrees.
 * @param {{ x: number, y: number }} point
 * @param {{ x: number, y: number }} pivot
 * @param {number} angleDegrees
 * @returns {{ x: number, y: number }}
 */
export function rotatePoint(point, pivot, angleDegrees) {
  if (!angleDegrees || angleDegrees === 0) return { x: point.x, y: point.y };
  const rad = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos
  };
}

/**
 * Unrotates a 2D point around a pivot by an angle in degrees (inverse rotation).
 * @param {{ x: number, y: number }} point
 * @param {{ x: number, y: number }} pivot
 * @param {number} angleDegrees
 * @returns {{ x: number, y: number }}
 */
export function unrotatePoint(point, pivot, angleDegrees) {
  return rotatePoint(point, pivot, -angleDegrees);
}

/**
 * Rotates a vector (dx, dy) by an angle in degrees.
 * @param {number} dx
 * @param {number} dy
 * @param {number} angleDegrees
 * @returns {{ dx: number, dy: number }}
 */
export function rotateVector(dx, dy, angleDegrees) {
  if (!angleDegrees || angleDegrees === 0) return { dx, dy };
  const rad = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    dx: dx * cos - dy * sin,
    dy: dx * sin + dy * cos
  };
}

/**
 * Unrotates a vector (dx, dy) by an angle in degrees.
 * @param {number} dx
 * @param {number} dy
 * @param {number} angleDegrees
 * @returns {{ dx: number, dy: number }}
 */
export function unrotateVector(dx, dy, angleDegrees) {
  return rotateVector(dx, dy, -angleDegrees);
}

/**
 * Normalizes an angle in degrees to [0, 360).
 * @param {number} angle
 * @returns {number}
 */
export function normalizeAngle(angle) {
  if (typeof angle !== 'number' || !Number.isFinite(angle)) return 0;
  let a = angle % 360;
  if (a < 0) a += 360;
  return Math.round(a * 100) / 100;
}

/**
 * Gets the 4 corners of an object in world space (rotated by obj.rotation around center).
 * @param {Object} obj
 * @returns {Array<{ x: number, y: number }>} [nw, ne, se, sw]
 */
export function getObjectCorners(obj) {
  if (!obj) return [];
  const x = typeof obj.x === 'number' && !isNaN(obj.x) ? obj.x : 0;
  const y = typeof obj.y === 'number' && !isNaN(obj.y) ? obj.y : 0;
  const width = typeof obj.width === 'number' && !isNaN(obj.width) ? obj.width : 0;
  const height = typeof obj.height === 'number' && !isNaN(obj.height) ? obj.height : 0;
  const rot = obj.rotation || 0;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const pivot = { x: cx, y: cy };

  const nw = { x, y };
  const ne = { x: x + width, y };
  const se = { x: x + width, y: y + height };
  const sw = { x, y: y + height };

  if (!rot) return [nw, ne, se, sw];
  return [
    rotatePoint(nw, pivot, rot),
    rotatePoint(ne, pivot, rot),
    rotatePoint(se, pivot, rot),
    rotatePoint(sw, pivot, rot)
  ];
}

/**
 * Gets axis-aligned bounding box of an object.
 * For connectors, calculates the true bounds from resolved/rendered geometry without phantom zero-origin.
 * For rotated objects, calculates enclosing world AABB containing all rotated visual corners.
 * @param {Object} obj
 * @param {Object|null} doc
 * @returns {{ x: number, y: number, width: number, height: number, cx: number, cy: number, right: number, bottom: number } | null}
 */
export function getBoundingBox(obj, doc = null) {
  if (!obj) return null;

  if (obj.type === 'connector') {
    let pts = [];
    if (doc) {
      const geom = resolveConnectorGeometry(doc, obj);
      if (geom && Array.isArray(geom.points) && geom.points.length > 0) {
        pts = geom.points;
      }
    }
    if (pts.length === 0) {
      if (obj.from?.point) pts.push(obj.from.point);
      if (obj.to?.point) pts.push(obj.to.point);
    }
    if (pts.length === 0) {
      return null;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (typeof p.x === 'number' && !isNaN(p.x)) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
      }
      if (typeof p.y === 'number' && !isNaN(p.y)) {
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }

    if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
      return null;
    }

    const width = Math.max(0, maxX - minX);
    const height = Math.max(0, maxY - minY);
    return {
      x: minX,
      y: minY,
      width,
      height,
      cx: minX + width / 2,
      cy: minY + height / 2,
      right: maxX,
      bottom: maxY
    };
  }

  const x = typeof obj.x === 'number' && !isNaN(obj.x) ? obj.x : 0;
  const y = typeof obj.y === 'number' && !isNaN(obj.y) ? obj.y : 0;
  const width = typeof obj.width === 'number' && !isNaN(obj.width) ? obj.width : 0;
  const height = typeof obj.height === 'number' && !isNaN(obj.height) ? obj.height : 0;

  if (obj.rotation && typeof obj.rotation === 'number' && Number.isFinite(obj.rotation) && obj.rotation !== 0) {
    let pts;
    if (obj.type === 'path' && Array.isArray(obj.points) && obj.points.length > 0) {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const pivot = { x: cx, y: cy };
      pts = obj.points.map(pt => {
        const px = x + (Array.isArray(pt) ? pt[0] : pt.x);
        const py = y + (Array.isArray(pt) ? pt[1] : pt.y);
        return rotatePoint({ x: px, y: py }, pivot, obj.rotation);
      });
    } else {
      pts = getObjectCorners(obj);
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const rWidth = Math.max(0, maxX - minX);
    const rHeight = Math.max(0, maxY - minY);
    return {
      x: minX,
      y: minY,
      width: rWidth,
      height: rHeight,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      right: maxX,
      bottom: maxY
    };
  }

  return {
    x,
    y,
    width,
    height,
    cx: x + width / 2,
    cy: y + height / 2,
    right: x + width,
    bottom: y + height
  };
}

/**
 * Gets union bounding box for multiple objects.
 * Accurately integrates resolved connector geometry and ignores invalid/phantom objects.
 * @param {Array<Object>} objects
 * @param {Object|null} doc
 * @returns {{ x: number, y: number, width: number, height: number, cx: number, cy: number, right: number, bottom: number } | null}
 */
export function getUnionBoundingBox(objects, doc = null) {
  if (!objects || objects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let validCount = 0;

  for (const obj of objects) {
    const box = getBoundingBox(obj, doc);
    if (!box || isNaN(box.x) || isNaN(box.y) || isNaN(box.right) || isNaN(box.bottom)) continue;
    validCount++;
    if (box.x < minX) minX = box.x;
    if (box.y < minY) minY = box.y;
    if (box.right > maxX) maxX = box.right;
    if (box.bottom > maxY) maxY = box.bottom;
  }

  if (validCount === 0 || minX === Infinity || minY === Infinity) return null;

  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);
  return {
    x: minX,
    y: minY,
    width,
    height,
    cx: minX + width / 2,
    cy: minY + height / 2,
    right: maxX,
    bottom: maxY
  };
}

/**
 * Line segment intersection. Returns intersection point if segments (p1-p2) and (p3-p4) intersect.
 */
function lineIntersect(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return null;

  const u = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const v = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;

  if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
    return {
      x: p1.x + u * (p2.x - p1.x),
      y: p1.y + u * (p2.y - p1.y)
    };
  }
  return null;
}

/**
 * Computes boundary intersection of a shape when connected from center towards a target point.
 * @param {Object} shape - Sabura object
 * @param {{ x: number, y: number }} targetPoint - Point towards which connection travels
 * @returns {{ x: number, y: number }}
 */
export function getShapeBoundaryPoint(shape, targetPoint) {
  const rot = shape.rotation || 0;
  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;
  const center = { x: cx, y: cy };

  if (Math.abs(targetPoint.x - center.x) < 1e-4 && Math.abs(targetPoint.y - center.y) < 1e-4) {
    return center;
  }

  // If shape is rotated, transform targetPoint into unrotated local coordinates
  const localTarget = rot ? unrotatePoint(targetPoint, center, rot) : targetPoint;

  const dx = localTarget.x - center.x;
  const dy = localTarget.y - center.y;

  const x = shape.x;
  const y = shape.y;
  const right = shape.x + shape.width;
  const bottom = shape.y + shape.height;
  const width = shape.width;
  const height = shape.height;

  let localBoundary = center;

  if (shape.type === 'ellipse') {
    const a = width / 2;
    const b = height / 2;
    const angle = Math.atan2(dy, dx);
    localBoundary = {
      x: center.x + a * Math.cos(angle),
      y: center.y + b * Math.sin(angle)
    };
  } else if (shape.type === 'diamond') {
    const top = { x: cx, y };
    const r = { x: right, y: cy };
    const bot = { x: cx, y: bottom };
    const l = { x, y: cy };

    const segments = [
      [top, r],
      [r, bot],
      [bot, l],
      [l, top]
    ];

    for (const [p1, p2] of segments) {
      const pt = lineIntersect(center, localTarget, p1, p2);
      if (pt) { localBoundary = pt; break; }
    }
  } else if (shape.type === 'triangle') {
    const top = { x: cx, y };
    const br = { x: right, y: bottom };
    const bl = { x, y: bottom };

    const segments = [
      [top, br],
      [br, bl],
      [bl, top]
    ];

    for (const [p1, p2] of segments) {
      const pt = lineIntersect(center, localTarget, p1, p2);
      if (pt) { localBoundary = pt; break; }
    }
  } else if (shape.type === 'path') {
    const vertices = (shape.points || []).map(pt => Array.isArray(pt)
      ? { x: shape.x + pt[0], y: shape.y + pt[1] }
      : { x: shape.x + pt.x, y: shape.y + pt.y });
    const count = shape.closed ? vertices.length : Math.max(0, vertices.length - 1);
    for (let i = 0; i < count; i++) {
      const p1 = vertices[i];
      const p2 = vertices[(i + 1) % vertices.length];
      const pt = lineIntersect(center, localTarget, p1, p2);
      if (pt) { localBoundary = pt; break; }
    }
  } else {
    // Default: Rectangle & Text & other shapes
    const segments = [
      [{ x, y }, { x: right, y }], // top
      [{ x: right, y }, { x: right, y: bottom }], // right
      [{ x: right, y: bottom }, { x, y: bottom }], // bottom
      [{ x, y: bottom }, { x, y }] // left
    ];

    for (const [p1, p2] of segments) {
      const pt = lineIntersect(center, localTarget, p1, p2);
      if (pt) { localBoundary = pt; break; }
    }
  }

  return rot ? rotatePoint(localBoundary, center, rot) : localBoundary;
}

/**
 * Projects a point (px, py) onto line segment (x1, y1)-(x2, y2).
 */
export function projectPointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: x1, y: y1 };
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return {
    x: x1 + t * dx,
    y: y1 + t * dy
  };
}

/**
 * Computes useful connection snap points (side centers and vertices/corners) for a shape.
 * @param {Object} shape
 * @returns {Array<{ name: string, point: { x: number, y: number }, anchor: { x: number, y: number } }>}
 */
export function getShapeSnapPoints(shape) {
  const rot = shape.rotation || 0;
  const x = shape.x;
  const y = shape.y;
  const width = shape.width;
  const height = shape.height;
  const right = x + width;
  const bottom = y + height;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const center = { x: cx, y: cy };

  const rawPoints = [];

  if (shape.type === 'diamond') {
    // 4 Vertices
    rawPoints.push({ name: 'top', point: { x: cx, y }, anchor: { x: 0.5, y: 0 } });
    rawPoints.push({ name: 'right', point: { x: right, y: cy }, anchor: { x: 1, y: 0.5 } });
    rawPoints.push({ name: 'bottom', point: { x: cx, y: bottom }, anchor: { x: 0.5, y: 1 } });
    rawPoints.push({ name: 'left', point: { x, y: cy }, anchor: { x: 0, y: 0.5 } });
    // 4 Edge midpoints
    rawPoints.push({ name: 'top-right', point: { x: (cx + right) / 2, y: (y + cy) / 2 }, anchor: { x: 0.75, y: 0.25 } });
    rawPoints.push({ name: 'bottom-right', point: { x: (right + cx) / 2, y: (cy + bottom) / 2 }, anchor: { x: 0.75, y: 0.75 } });
    rawPoints.push({ name: 'bottom-left', point: { x: (cx + x) / 2, y: (bottom + cy) / 2 }, anchor: { x: 0.25, y: 0.75 } });
    rawPoints.push({ name: 'top-left', point: { x: (x + cx) / 2, y: (cy + y) / 2 }, anchor: { x: 0.25, y: 0.25 } });
  } else if (shape.type === 'triangle') {
    // 3 Vertices
    rawPoints.push({ name: 'top', point: { x: cx, y }, anchor: { x: 0.5, y: 0 } });
    rawPoints.push({ name: 'bottom-right', point: { x: right, y: bottom }, anchor: { x: 1, y: 1 } });
    rawPoints.push({ name: 'bottom-left', point: { x: x, y: bottom }, anchor: { x: 0, y: 1 } });
    // 3 Edge midpoints
    rawPoints.push({ name: 'right', point: { x: (cx + right) / 2, y: (y + bottom) / 2 }, anchor: { x: 0.75, y: 0.5 } });
    rawPoints.push({ name: 'bottom', point: { x: cx, y: bottom }, anchor: { x: 0.5, y: 1 } });
    rawPoints.push({ name: 'left', point: { x: (cx + x) / 2, y: (y + bottom) / 2 }, anchor: { x: 0.25, y: 0.5 } });
  } else if (shape.type === 'ellipse') {
    const a = width / 2;
    const b = height / 2;
    // 4 Cardinal points
    rawPoints.push({ name: 'top', point: { x: cx, y }, anchor: { x: 0.5, y: 0 } });
    rawPoints.push({ name: 'right', point: { x: right, y: cy }, anchor: { x: 1, y: 0.5 } });
    rawPoints.push({ name: 'bottom', point: { x: cx, y: bottom }, anchor: { x: 0.5, y: 1 } });
    rawPoints.push({ name: 'left', point: { x, y: cy }, anchor: { x: 0, y: 0.5 } });
    // 4 Diagonals (45 deg)
    const cos45 = Math.SQRT1_2;
    const sin45 = Math.SQRT1_2;
    rawPoints.push({ name: 'top-right', point: { x: cx + a * cos45, y: cy - b * sin45 }, anchor: { x: 0.5 + 0.5 * cos45, y: 0.5 - 0.5 * sin45 } });
    rawPoints.push({ name: 'bottom-right', point: { x: cx + a * cos45, y: cy + b * sin45 }, anchor: { x: 0.5 + 0.5 * cos45, y: 0.5 + 0.5 * sin45 } });
    rawPoints.push({ name: 'bottom-left', point: { x: cx - a * cos45, y: cy + b * sin45 }, anchor: { x: 0.5 - 0.5 * cos45, y: 0.5 + 0.5 * sin45 } });
    rawPoints.push({ name: 'top-left', point: { x: cx - a * cos45, y: cy - b * sin45 }, anchor: { x: 0.5 - 0.5 * cos45, y: 0.5 - 0.5 * sin45 } });
  } else {
    // Rectangle & Text & other shapes
    rawPoints.push({ name: 'top', point: { x: cx, y }, anchor: { x: 0.5, y: 0 } });
    rawPoints.push({ name: 'right', point: { x: right, y: cy }, anchor: { x: 1, y: 0.5 } });
    rawPoints.push({ name: 'bottom', point: { x: cx, y: bottom }, anchor: { x: 0.5, y: 1 } });
    rawPoints.push({ name: 'left', point: { x, y: cy }, anchor: { x: 0, y: 0.5 } });
    rawPoints.push({ name: 'top-left', point: { x, y }, anchor: { x: 0, y: 0 } });
    rawPoints.push({ name: 'top-right', point: { x: right, y }, anchor: { x: 1, y: 0 } });
    rawPoints.push({ name: 'bottom-right', point: { x: right, y: bottom }, anchor: { x: 1, y: 1 } });
    rawPoints.push({ name: 'bottom-left', point: { x: x, y: bottom }, anchor: { x: 0, y: 1 } });
  }

  if (!rot) return rawPoints;

  return rawPoints.map(s => ({
    name: s.name,
    point: rotatePoint(s.point, center, rot),
    anchor: s.anchor
  }));
}

/**
 * Calculates continuous position around shape perimeter with gentle snapping to side centers/corners.
 * @param {Object} shape
 * @param {{ x: number, y: number }} worldPoint
 * @param {number} snapDistance
 * @returns {{ point: { x: number, y: number }, anchor: { x: number, y: number }, snapped: boolean, snapName?: string }}
 */
export function getClosestBoundaryPoint(shape, worldPoint, snapDistance = 14) {
  const rot = shape.rotation || 0;
  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;
  const center = { x: cx, y: cy };

  const localPt = rot ? unrotatePoint(worldPoint, center, rot) : worldPoint;
  const px = localPt.x;
  const py = localPt.y;
  const x = shape.x;
  const y = shape.y;
  const right = shape.x + shape.width;
  const bottom = shape.y + shape.height;
  const width = shape.width;
  const height = shape.height;

  let closestLocalPt = null;

  if (shape.type === 'ellipse') {
    const a = Math.max(1, width / 2);
    const b = Math.max(1, height / 2);
    const dx = px - cx;
    const dy = py - cy;
    const angle = (dx === 0 && dy === 0) ? -Math.PI / 2 : Math.atan2(dy, dx);
    closestLocalPt = {
      x: cx + a * Math.cos(angle),
      y: cy + b * Math.sin(angle)
    };
  } else if (shape.type === 'diamond') {
    const top = { x: cx, y };
    const r = { x: right, y: cy };
    const bot = { x: cx, y: bottom };
    const l = { x, y: cy };
    const segments = [
      [top, r],
      [r, bot],
      [bot, l],
      [l, top]
    ];
    let minDist = Infinity;
    for (const [p1, p2] of segments) {
      const proj = projectPointToSegment(px, py, p1.x, p1.y, p2.x, p2.y);
      const d = Math.hypot(px - proj.x, py - proj.y);
      if (d < minDist) {
        minDist = d;
        closestLocalPt = proj;
      }
    }
  } else if (shape.type === 'triangle') {
    const top = { x: cx, y };
    const br = { x: right, y: bottom };
    const bl = { x, y: bottom };
    const segments = [
      [top, br],
      [br, bl],
      [bl, top]
    ];
    let minDist = Infinity;
    for (const [p1, p2] of segments) {
      const proj = projectPointToSegment(px, py, p1.x, p1.y, p2.x, p2.y);
      const d = Math.hypot(px - proj.x, py - proj.y);
      if (d < minDist) {
        minDist = d;
        closestLocalPt = proj;
      }
    }
  } else {
    // Rectangle, Text, and general boxes
    const topProj = { x: Math.max(x, Math.min(right, px)), y };
    const bottomProj = { x: Math.max(x, Math.min(right, px)), y: bottom };
    const leftProj = { x, y: Math.max(y, Math.min(bottom, py)) };
    const rightProj = { x: right, y: Math.max(y, Math.min(bottom, py)) };

    const candidates = [
      { pt: topProj, dist: Math.hypot(px - topProj.x, py - topProj.y) },
      { pt: rightProj, dist: Math.hypot(px - rightProj.x, py - rightProj.y) },
      { pt: bottomProj, dist: Math.hypot(px - bottomProj.x, py - bottomProj.y) },
      { pt: leftProj, dist: Math.hypot(px - leftProj.x, py - leftProj.y) }
    ];
    candidates.sort((a, b) => a.dist - b.dist);
    closestLocalPt = candidates[0].pt;
  }

  // Snap against local unrotated snap points
  const unrotatedShape = rot ? { ...shape, rotation: 0 } : shape;
  const snapPoints = getShapeSnapPoints(unrotatedShape);
  let bestSnap = null;
  let bestSnapDist = Infinity;

  for (const s of snapPoints) {
    const d = Math.hypot(closestLocalPt.x - s.point.x, closestLocalPt.y - s.point.y);
    if (d <= snapDistance && d < bestSnapDist) {
      bestSnapDist = d;
      bestSnap = s;
    }
  }

  if (bestSnap) {
    const worldSnapPoint = rot ? rotatePoint(bestSnap.point, center, rot) : bestSnap.point;
    return {
      point: worldSnapPoint,
      anchor: bestSnap.anchor,
      snapped: true,
      snapName: bestSnap.name
    };
  }

  const anchorX = width > 0 ? (closestLocalPt.x - x) / width : 0.5;
  const anchorY = height > 0 ? (closestLocalPt.y - y) / height : 0.5;
  const worldPointOut = rot ? rotatePoint(closestLocalPt, center, rot) : closestLocalPt;

  return {
    point: worldPointOut,
    anchor: {
      x: Math.round(anchorX * 10000) / 10000,
      y: Math.round(anchorY * 10000) / 10000
    },
    snapped: false
  };
}

/**
 * Calculates start and end coordinates and routing points for a connector object.
 * @param {Object} doc
 * @param {Object} connector
 * @returns {{ start: {x: number, y: number}, end: {x: number, y: number}, path: string, points: Array<{x: number, y: number}> }}
 */
export function resolveConnectorGeometry(doc, connector) {
  let fromObj = connector.from?.id ? doc.objects[connector.from.id] : null;
  let toObj = connector.to?.id ? doc.objects[connector.to.id] : null;

  let startCenter = fromObj ? { x: fromObj.x + fromObj.width / 2, y: fromObj.y + fromObj.height / 2 } : (connector.from?.point || { x: connector.x, y: connector.y });
  let endCenter = toObj ? { x: toObj.x + toObj.width / 2, y: toObj.y + toObj.height / 2 } : (connector.to?.point || { x: connector.x + connector.width, y: connector.y + connector.height });

  // Resolve boundary points, respecting explicit custom anchors if present
  let start;
  if (fromObj) {
    if (connector.from?.anchor && typeof connector.from.anchor.x === 'number' && typeof connector.from.anchor.y === 'number') {
      const localPt = {
        x: fromObj.x + connector.from.anchor.x * fromObj.width,
        y: fromObj.y + connector.from.anchor.y * fromObj.height
      };
      const center = { x: fromObj.x + fromObj.width / 2, y: fromObj.y + fromObj.height / 2 };
      start = fromObj.rotation ? rotatePoint(localPt, center, fromObj.rotation) : localPt;
    } else {
      start = getShapeBoundaryPoint(fromObj, endCenter);
    }
  } else {
    start = { ...startCenter };
  }

  let end;
  if (toObj) {
    if (connector.to?.anchor && typeof connector.to.anchor.x === 'number' && typeof connector.to.anchor.y === 'number') {
      const localPt = {
        x: toObj.x + connector.to.anchor.x * toObj.width,
        y: toObj.y + connector.to.anchor.y * toObj.height
      };
      const center = { x: toObj.x + toObj.width / 2, y: toObj.y + toObj.height / 2 };
      end = toObj.rotation ? rotatePoint(localPt, center, toObj.rotation) : localPt;
    } else {
      end = getShapeBoundaryPoint(toObj, startCenter);
    }
  } else {
    end = { ...endCenter };
  }

  const routing = connector.routing || 'straight';
  let points = [];
  let pathStr = '';

  if (routing === 'elbow') {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    let elbowMidpoint = null;

    if (typeof connector.elbowOffset === 'number' && !isNaN(connector.elbowOffset)) {
      // Orthogonal U-bypass loop routing
      const offset = connector.elbowOffset;
      if (Math.abs(dx) >= Math.abs(dy)) {
        // Horizontal-dominant: route vertically out, across, and back in
        const baseY = offset >= 0 ? Math.max(start.y, end.y) : Math.min(start.y, end.y);
        const bypassY = baseY + offset;
        points = [
          start,
          { x: start.x, y: bypassY },
          { x: end.x, y: bypassY },
          end
        ];
        pathStr = `M ${start.x} ${start.y} L ${start.x} ${bypassY} L ${end.x} ${bypassY} L ${end.x} ${end.y}`;
        elbowMidpoint = { x: (start.x + end.x) / 2, y: bypassY };
      } else {
        // Vertical-dominant: route horizontally out, across, and back in
        const baseX = offset >= 0 ? Math.max(start.x, end.x) : Math.min(start.x, end.x);
        const bypassX = baseX + offset;
        points = [
          start,
          { x: bypassX, y: start.y },
          { x: bypassX, y: end.y },
          end
        ];
        pathStr = `M ${start.x} ${start.y} L ${bypassX} ${start.y} L ${bypassX} ${end.y} L ${end.x} ${end.y}`;
        elbowMidpoint = { x: bypassX, y: (start.y + end.y) / 2 };
      }
      return { start, end, points, path: pathStr, elbowMidpoint, isBypass: true, elbowOffset: offset };
    } else {
      // Standard 2-corner Z-step
      if (Math.abs(dx) > Math.abs(dy)) {
        const midX = start.x + dx / 2;
        points = [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
        pathStr = `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`;
        elbowMidpoint = { x: midX, y: (start.y + end.y) / 2 };
      } else {
        const midY = start.y + dy / 2;
        points = [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
        pathStr = `M ${start.x} ${start.y} L ${start.x} ${midY} L ${end.x} ${midY} L ${end.x} ${end.y}`;
        elbowMidpoint = { x: (start.x + end.x) / 2, y: midY };
      }
      return { start, end, points, path: pathStr, elbowMidpoint, isBypass: false };
    }
  } else if (routing === 'curved') {
    // Smooth bezier curve with perpendicular offset
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.hypot(dx, dy);
    const normal = dist > 0 ? { x: -dy / dist, y: dx / dist } : { x: 0, y: 0 };
    const autoAmount = Math.min(60, dist * 0.2);
    const curveAmount = (typeof connector.curveDistance === 'number' && !isNaN(connector.curveDistance))
      ? Math.max(5, connector.curveDistance)
      : autoAmount;
    const side = connector.curveSide === -1 ? -1 : 1;
    const cpX = (start.x + end.x) / 2 + normal.x * curveAmount * side;
    const cpY = (start.y + end.y) / 2 + normal.y * curveAmount * side;
    const curveMidpoint = {
      x: 0.25 * start.x + 0.5 * cpX + 0.25 * end.x,
      y: 0.25 * start.y + 0.5 * cpY + 0.25 * end.y
    };
    points = [start, { x: cpX, y: cpY }, end];
    pathStr = `M ${start.x} ${start.y} Q ${cpX} ${cpY} ${end.x} ${end.y}`;
    return {
      start,
      end,
      points,
      path: pathStr,
      cp: { x: cpX, y: cpY },
      curveMidpoint,
      side,
      curveAmount,
      isAutoCurve: connector.curveDistance === undefined || connector.curveDistance === null
    };
  } else {
    // Straight
    points = [start, end];
    pathStr = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }

  return { start, end, points, path: pathStr };
}

/**
 * Computes shortest distance from point (px, py) to line segment (x1, y1)-(x2, y2).
 */
export function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * Computes shortest distance from a world point to a connector's actual path.
 * Evaluates straight segments and samples curved beziers.
 *
 * @param {{ x: number, y: number }} point
 * @param {Object} connector
 * @param {Object} doc
 * @returns {number} Distance in world units
 */
export function distanceToConnector(point, connector, doc) {
  const geom = resolveConnectorGeometry(doc, connector);
  const routing = connector.routing || 'straight';

  if (routing === 'curved' && geom.points.length === 3) {
    // Sample quadratic bezier curve across 16 segments
    const p0 = geom.points[0];
    const p1 = geom.points[1];
    const p2 = geom.points[2];
    let minDist = Infinity;
    let prevX = p0.x;
    let prevY = p0.y;
    const steps = 16;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const invT = 1 - t;
      const curX = invT * invT * p0.x + 2 * invT * t * p1.x + t * t * p2.x;
      const curY = invT * invT * p0.y + 2 * invT * t * p1.y + t * t * p2.y;
      const d = distanceToSegment(point.x, point.y, prevX, prevY, curX, curY);
      if (d < minDist) minDist = d;
      prevX = curX;
      prevY = curY;
    }
    return minDist;
  }

  // Straight or elbow polylines
  let minDist = Infinity;
  for (let i = 0; i < geom.points.length - 1; i++) {
    const ptA = geom.points[i];
    const ptB = geom.points[i + 1];
    const d = distanceToSegment(point.x, point.y, ptA.x, ptA.y, ptB.x, ptB.y);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Computes shortest distance from a world point to a path object.
 * Evaluates line segments or closed polygon perimeter.
 *
 * @param {{ x: number, y: number }} point
 * @param {Object} pathObj
 * @returns {number}
 */
export function distanceToPath(point, pathObj) {
  if (!pathObj.points || pathObj.points.length === 0) return Infinity;
  const vertices = pathObj.points.map(pt => Array.isArray(pt)
    ? { x: pathObj.x + pt[0], y: pathObj.y + pt[1] }
    : { x: pathObj.x + pt.x, y: pathObj.y + pt.y });

  if (vertices.length === 1) {
    return Math.hypot(point.x - vertices[0].x, point.y - vertices[0].y);
  }

  let minDist = Infinity;
  const count = pathObj.closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < count; i++) {
    const p1 = vertices[i];
    const p2 = vertices[(i + 1) % vertices.length];
    const d = distanceToSegment(point.x, point.y, p1.x, p1.y, p2.x, p2.y);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Calculates resize transformations for 8 handles.
 * Supports:
 * - keepAspect (preserves aspect ratio)
 * - fromCenter (symmetrical resize from center)
 * - minSize enforcement
 *
 * @param {string} handle - One of 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'
 * @param {{ x: number, y: number, width: number, height: number }} orig - Original bounds
 * @param {number} dx - Pointer delta X
 * @param {number} dy - Pointer delta Y
 * @param {{ keepAspect?: boolean, fromCenter?: boolean, minSize?: number }} options
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function calculateResize(handle, orig, dx, dy, options = {}) {
  const minSize = Math.max(MIN_OBJECT_SIZE, options.minSize || MIN_OBJECT_SIZE);
  const keepAspect = Boolean(options.keepAspect);
  const fromCenter = Boolean(options.fromCenter);

  const origAspectRatio = orig.height > 0 ? orig.width / orig.height : 1;

  // Effective deltas if fromCenter: double the movement
  const effDx = fromCenter ? dx * 2 : dx;
  const effDy = fromCenter ? dy * 2 : dy;

  let newX = orig.x;
  let newY = orig.y;
  let newWidth = orig.width;
  let newHeight = orig.height;

  // Horizontal handle component
  if (handle.includes('e')) {
    newWidth = orig.width + effDx;
  } else if (handle.includes('w')) {
    newWidth = orig.width - effDx;
    if (!fromCenter) newX = orig.x + effDx;
  }

  // Vertical handle component
  if (handle.includes('s')) {
    newHeight = orig.height + effDy;
  } else if (handle.includes('n')) {
    newHeight = orig.height - effDy;
    if (!fromCenter) newY = orig.y + effDy;
  }

  // Aspect ratio preservation
  if (keepAspect) {
    if (handle === 'n' || handle === 's') {
      newWidth = newHeight * origAspectRatio;
      if (!fromCenter) newX = orig.x + (orig.width - newWidth) / 2;
    } else if (handle === 'e' || handle === 'w') {
      newHeight = newWidth / origAspectRatio;
      if (!fromCenter) newY = orig.y + (orig.height - newHeight) / 2;
    } else {
      // Corner handle: scale according to dominant displacement
      const scaleX = orig.width > 0 ? newWidth / orig.width : 1;
      const scaleY = orig.height > 0 ? newHeight / orig.height : 1;
      const scale = Math.max(scaleX, scaleY);

      newWidth = orig.width * scale;
      newHeight = orig.height * scale;

      if (handle.includes('w') && !fromCenter) {
        newX = orig.x + orig.width - newWidth;
      }
      if (handle.includes('n') && !fromCenter) {
        newY = orig.y + orig.height - newHeight;
      }
    }
  }

  // Enforce minSize and prevent flipping
  if (newWidth < minSize) {
    if (handle.includes('w') && !fromCenter) {
      newX = orig.x + orig.width - minSize;
    }
    newWidth = minSize;
    if (keepAspect && origAspectRatio > 0) {
      newHeight = minSize / origAspectRatio;
    }
  }

  if (newHeight < minSize) {
    if (handle.includes('n') && !fromCenter) {
      newY = orig.y + orig.height - minSize;
    }
    newHeight = minSize;
    if (keepAspect) {
      newWidth = minSize * origAspectRatio;
    }
  }

  // Adjust center position if fromCenter
  if (fromCenter) {
    const origCenterX = orig.x + orig.width / 2;
    const origCenterY = orig.y + orig.height / 2;
    newX = origCenterX - newWidth / 2;
    newY = origCenterY - newHeight / 2;
  }

  return {
    x: Math.round(newX),
    y: Math.round(newY),
    width: Math.round(newWidth),
    height: Math.round(newHeight)
  };
}

/**
 * Calculates transformed coordinates for a set of objects given an original and new bounding box.
 * Transforms positions, dimensions, path vertices, and free connector endpoints consistently.
 *
 * @param {Array<Object>} objects - Objects or snapshots to transform
 * @param {{ x: number, y: number, width: number, height: number }} origBox - Initial union box of spatial objects
 * @param {{ x: number, y: number, width: number, height: number }} newBox - New union box
 * @returns {Array<Object>} Updated object definitions with transformed geometry
 */
export function transformObjects(objects, origBox, newBox) {
  if (!Array.isArray(objects) || objects.length === 0 || !origBox || !newBox) return [];

  const scaleX = origBox.width > 0 ? newBox.width / origBox.width : 1;
  const scaleY = origBox.height > 0 ? newBox.height / origBox.height : 1;
  const textScale = (scaleX + scaleY) / 2;

  return objects.map(obj => {
    if (!obj || obj.locked) return obj;

    if (obj.type === 'connector') {
      const transformedConn = { ...obj };
      if (obj.from?.point && !obj.from.id) {
        transformedConn.from = {
          ...obj.from,
          point: {
            x: Math.round(newBox.x + (obj.from.point.x - origBox.x) * scaleX),
            y: Math.round(newBox.y + (obj.from.point.y - origBox.y) * scaleY)
          }
        };
      }
      if (obj.to?.point && !obj.to.id) {
        transformedConn.to = {
          ...obj.to,
          point: {
            x: Math.round(newBox.x + (obj.to.point.x - origBox.x) * scaleX),
            y: Math.round(newBox.y + (obj.to.point.y - origBox.y) * scaleY)
          }
        };
      }
      return transformedConn;
    }

    const newX = Math.round(newBox.x + (obj.x - origBox.x) * scaleX);
    const newY = Math.round(newBox.y + (obj.y - origBox.y) * scaleY);
    let newWidth = Math.max(MIN_OBJECT_SIZE, Math.round(obj.width * scaleX));
    let newHeight = Math.max(MIN_OBJECT_SIZE, Math.round(obj.height * scaleY));

    let newTextStyle = obj.textStyle;
    if (obj.textStyle) {
      const baseSize = obj.textStyle.resolvedSize || 20;
      const newResolvedSize = Math.max(10, Math.min(120, Math.round(baseSize * textScale)));
      newTextStyle = {
        ...obj.textStyle,
        resolvedSize: newResolvedSize
      };

      if (obj.type === 'text') {
        const familyToken = obj.textStyle?.fontFamily || 'hand';
        const m = measureText(obj.text, newResolvedSize, familyToken);
        newWidth = m.width;
        newHeight = m.height;
      }
    }

    const transformed = {
      ...obj,
      x: newX,
      y: newY,
      width: newWidth,
      height: newHeight
    };

    if (newTextStyle) {
      transformed.textStyle = newTextStyle;
    }

    if (obj.type === 'path' && Array.isArray(obj.points)) {
      transformed.points = obj.points.map(pt => {
        const px = Array.isArray(pt) ? pt[0] : pt.x;
        const py = Array.isArray(pt) ? pt[1] : pt.y;
        return {
          x: Math.round(px * scaleX),
          y: Math.round(py * scaleY)
        };
      });
    }

    return transformed;
  });
}

/**
 * Snapping engine: Computes snapping against grid and other objects.
 *
 * @param {{ x: number, y: number, width: number, height: number }} currentBox
 * @param {Array<Object>} otherObjects
 * @param {{ tolerance?: number, snapGrid?: boolean, gridSize?: number }} options
 * @returns {{ x: number, y: number, guides: Array<{ orientation: 'v'|'h', pos: number, from: number, to: number }> }}
 */
export function calculateSnapping(currentBox, otherObjects, options = {}) {
  const tolerance = options.tolerance !== undefined ? options.tolerance : 8;
  const guides = [];
  let snappedX = currentBox.x;
  let snappedY = currentBox.y;

  const currentCx = currentBox.x + currentBox.width / 2;
  const currentRight = currentBox.x + currentBox.width;
  const currentCy = currentBox.y + currentBox.height / 2;
  const currentBottom = currentBox.y + currentBox.height;

  let minDeltaX = tolerance + 1;
  let snapXLine = null;

  let minDeltaY = tolerance + 1;
  let snapYLine = null;

  // Object-to-object snapping
  for (const other of otherObjects) {
    const box = getBoundingBox(other, options.doc);
    if (!box) continue;

    // Vertical alignment (X axis)
    const xPairs = [
      { current: currentBox.x, target: box.x, adjust: 0 },
      { current: currentBox.x, target: box.cx, adjust: 0 },
      { current: currentBox.x, target: box.right, adjust: 0 },
      { current: currentCx, target: box.cx, adjust: -currentBox.width / 2 },
      { current: currentRight, target: box.x, adjust: -currentBox.width },
      { current: currentRight, target: box.right, adjust: -currentBox.width }
    ];

    for (const pair of xPairs) {
      const delta = Math.abs(pair.current - pair.target);
      if (delta < minDeltaX) {
        minDeltaX = delta;
        snappedX = pair.target + pair.adjust;
        snapXLine = {
          orientation: 'v',
          pos: pair.target,
          from: Math.min(currentBox.y, box.y) - 20,
          to: Math.max(currentBottom, box.bottom) + 20
        };
      }
    }

    // Horizontal alignment (Y axis)
    const yPairs = [
      { current: currentBox.y, target: box.y, adjust: 0 },
      { current: currentBox.y, target: box.cy, adjust: 0 },
      { current: currentBox.y, target: box.bottom, adjust: 0 },
      { current: currentCy, target: box.cy, adjust: -currentBox.height / 2 },
      { current: currentBottom, target: box.y, adjust: -currentBox.height },
      { current: currentBottom, target: box.bottom, adjust: -currentBox.height }
    ];

    for (const pair of yPairs) {
      const delta = Math.abs(pair.current - pair.target);
      if (delta < minDeltaY) {
        minDeltaY = delta;
        snappedY = pair.target + pair.adjust;
        snapYLine = {
          orientation: 'h',
          pos: pair.target,
          from: Math.min(currentBox.x, box.x) - 20,
          to: Math.max(currentRight, box.right) + 20
        };
      }
    }
  }

  // Grid snapping fallback if object snapping didn't trigger
  if (options.snapGrid && options.gridSize) {
    const gs = options.gridSize;
    if (minDeltaX > tolerance) {
      const gridX = Math.round(currentBox.x / gs) * gs;
      if (Math.abs(gridX - currentBox.x) <= tolerance) {
        snappedX = gridX;
      }
    }
    if (minDeltaY > tolerance) {
      const gridY = Math.round(currentBox.y / gs) * gs;
      if (Math.abs(gridY - currentBox.y) <= tolerance) {
        snappedY = gridY;
      }
    }
  }

  if (snapXLine) guides.push(snapXLine);
  if (snapYLine) guides.push(snapYLine);

  return { x: snappedX, y: snappedY, guides };
}

/**
 * Calculates alignment mutations for multiple objects.
 * Attached and free connectors do not participate as independent objects;
 * only eligible spatial objects (type !== 'connector') are aligned.
 *
 * @param {Array<Object>} objects
 * @param {'left'|'center'|'right'|'top'|'middle'|'bottom'} alignment
 * @returns {Record<string, { dx: number, dy: number }>}
 */
export function alignObjects(objects, alignment) {
  if (!objects) return {};
  const spatialObjects = objects.filter(o => o && o.type !== 'connector');
  if (spatialObjects.length < 2) return {};
  const union = getUnionBoundingBox(spatialObjects);
  if (!union) return {};
  const deltas = {};

  for (const obj of spatialObjects) {
    let dx = 0;
    let dy = 0;
    switch (alignment) {
      case 'left':
        dx = union.x - obj.x;
        break;
      case 'center':
        dx = union.cx - (obj.x + obj.width / 2);
        break;
      case 'right':
        dx = union.right - (obj.x + obj.width);
        break;
      case 'top':
        dy = union.y - obj.y;
        break;
      case 'middle':
        dy = union.cy - (obj.y + obj.height / 2);
        break;
      case 'bottom':
        dy = union.bottom - (obj.y + obj.height);
        break;
    }
    deltas[obj.id] = { dx, dy };
  }
  return deltas;
}

/**
 * Calculates even distribution for multiple objects.
 * Attached and free connectors do not participate;
 * only eligible spatial objects (type !== 'connector') are distributed.
 *
 * @param {Array<Object>} objects
 * @param {'horizontal'|'vertical'} direction
 * @returns {Record<string, { dx: number, dy: number }>}
 */
export function distributeObjects(objects, direction) {
  if (!objects) return {};
  const spatialObjects = objects.filter(o => o && o.type !== 'connector');
  if (spatialObjects.length < 3) return {};
  const deltas = {};

  if (direction === 'horizontal') {
    const sorted = [...spatialObjects].sort((a, b) => a.x - b.x);
    const totalObjectWidth = sorted.reduce((sum, o) => sum + o.width, 0);
    const span = (sorted[sorted.length - 1].x + sorted[sorted.length - 1].width) - sorted[0].x;
    const gap = (span - totalObjectWidth) / (sorted.length - 1);

    let currentX = sorted[0].x;
    for (const obj of sorted) {
      deltas[obj.id] = { dx: currentX - obj.x, dy: 0 };
      currentX += obj.width + gap;
    }
  } else {
    const sorted = [...spatialObjects].sort((a, b) => a.y - b.y);
    const totalObjectHeight = sorted.reduce((sum, o) => sum + o.height, 0);
    const span = (sorted[sorted.length - 1].y + sorted[sorted.length - 1].height) - sorted[0].y;
    const gap = (span - totalObjectHeight) / (sorted.length - 1);

    let currentY = sorted[0].y;
    for (const obj of sorted) {
      deltas[obj.id] = { dx: 0, dy: currentY - obj.y };
      currentY += obj.height + gap;
    }
  }

  return deltas;
}

let _measureCanvas = null;
let _measureCtx = null;

/**
 * Accurately measures multi-line text dimensions.
 * Uses Canvas 2D in DOM environments with accurate font metrics,
 * and a robust proportional fallback in headless/Node.js environments.
 *
 * @param {string} text
 * @param {number} fontSize
 * @param {string} fontFamilyToken
 * @returns {{ width: number, height: number }}
 */
export function measureText(text, fontSize = 20, fontFamilyToken = 'hand') {
  const content = String(text || '');
  if (!content) {
    return {
      width: Math.max(24, Math.ceil(fontSize * 1.5)),
      height: Math.max(24, Math.ceil(fontSize * 1.3))
    };
  }

  const lines = content.split('\n');
  const lineHeight = fontSize * 1.3;

  // DOM measurement via Canvas 2D
  if (typeof document !== 'undefined') {
    try {
      if (!_measureCanvas) {
        _measureCanvas = document.createElement('canvas');
        _measureCtx = _measureCanvas.getContext('2d');
      }
      if (_measureCtx) {
        const family = FONT_FAMILIES[fontFamilyToken] || fontFamilyToken || 'sans-serif';
        _measureCtx.font = `${fontSize}px ${family}`;
        let maxWidth = 0;
        for (const line of lines) {
          const w = _measureCtx.measureText(line).width;
          if (w > maxWidth) maxWidth = w;
        }
        return {
          width: Math.max(24, Math.ceil(maxWidth + 14)),
          height: Math.max(24, Math.ceil(lines.length * lineHeight + 4))
        };
      }
    } catch (_) {}
  }

  // Headless / Node.js proportional fallback
  let maxChars = 0;
  for (const line of lines) {
    if (line.length > maxChars) maxChars = line.length;
  }
  const charWidth = fontSize * 0.62;
  return {
    width: Math.max(24, Math.ceil(maxChars * charWidth + 14)),
    height: Math.max(24, Math.ceil(lines.length * lineHeight + 4))
  };
}

/**
 * Calculates resize transformations for a single rotated object along its local axes.
 *
 * @param {string} handle - One of 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'
 * @param {{ x: number, y: number, width: number, height: number }} orig - Original unrotated local bounds
 * @param {number} worldDx - Pointer delta X in world coordinates
 * @param {number} worldDy - Pointer delta Y in world coordinates
 * @param {number} rotation - Object rotation in degrees
 * @param {{ keepAspect?: boolean, fromCenter?: boolean, minSize?: number }} options
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function calculateRotatedResize(handle, orig, worldDx, worldDy, rotation, options = {}) {
  const rot = rotation || 0;
  if (!rot) {
    return calculateResize(handle, orig, worldDx, worldDy, options);
  }

  // Transform world delta into local coordinates
  const localDelta = unrotateVector(worldDx, worldDy, rot);
  const newLocal = calculateResize(handle, orig, localDelta.dx, localDelta.dy, options);

  // Initial center in world space
  const oldCenter = {
    x: orig.x + orig.width / 2,
    y: orig.y + orig.height / 2
  };

  // New center in local coordinates
  const newLocalCenter = {
    x: newLocal.x + newLocal.width / 2,
    y: newLocal.y + newLocal.height / 2
  };

  // Rotate local center shift by +rot to get new world center
  const newWorldCenter = rotatePoint(newLocalCenter, oldCenter, rot);

  return {
    x: Math.round((newWorldCenter.x - newLocal.width / 2) * 100) / 100,
    y: Math.round((newWorldCenter.y - newLocal.height / 2) * 100) / 100,
    width: newLocal.width,
    height: newLocal.height
  };
}

/**
 * Computes rotated geometry for a set of objects and free connector endpoints
 * around a shared pivot by an angle delta.
 *
 * @param {Array<Object>} objects - Original object snapshots
 * @param {{ x: number, y: number }} pivot - Shared rotation pivot
 * @param {number} angleDelta - Rotation delta in degrees
 * @returns {Array<Object>} Transformed objects
 */
export function rotateObjects(objects, pivot, angleDelta) {
  if (!Array.isArray(objects) || objects.length === 0 || !pivot || !angleDelta) return objects;

  return objects.map(obj => {
    if (!obj || obj.locked) return obj;

    if (obj.type === 'connector') {
      const transformedConn = { ...obj };
      if (obj.from?.point && !obj.from.id) {
        transformedConn.from = {
          ...obj.from,
          point: rotatePoint(obj.from.point, pivot, angleDelta)
        };
      }
      if (obj.to?.point && !obj.to.id) {
        transformedConn.to = {
          ...obj.to,
          point: rotatePoint(obj.to.point, pivot, angleDelta)
        };
      }
      return transformedConn;
    }

    // Spatial object
    const objCenter = {
      x: obj.x + obj.width / 2,
      y: obj.y + obj.height / 2
    };
    const newCenter = rotatePoint(objCenter, pivot, angleDelta);
    const newX = newCenter.x - obj.width / 2;
    const newY = newCenter.y - obj.height / 2;
    const currentRot = typeof obj.rotation === 'number' && Number.isFinite(obj.rotation) ? obj.rotation : 0;
    const newRot = normalizeAngle(currentRot + angleDelta);

    return {
      ...obj,
      x: Math.round(newX * 100) / 100,
      y: Math.round(newY * 100) / 100,
      rotation: newRot
    };
  });
}

/**
 * Precision hit test for an object taking rotation into account.
 *
 * @param {{ x: number, y: number }} point - World coordinate
 * @param {Object} obj - Sabura object
 * @param {Object|null} doc - Document context
 * @param {number} hitThreshold - Tolerance
 * @returns {boolean}
 */
export function isPointInsideObject(point, obj, doc = null, hitThreshold = 10) {
  if (!obj) return false;

  if (obj.type === 'connector') {
    return distanceToConnector(point, obj, doc) <= hitThreshold;
  }

  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  const center = { x: cx, y: cy };
  const rot = obj.rotation || 0;
  const localPt = unrotatePoint(point, center, rot);

  if (obj.type === 'path') {
    if (!obj.closed) {
      // Open path: distance from localPt to unrotated path points
      const unrotatedObj = { ...obj, rotation: 0 };
      return distanceToPath(localPt, unrotatedObj) <= hitThreshold;
    }
    // Closed path: point-in-polygon on local points or near perimeter
    const vertices = (obj.points || []).map(pt => Array.isArray(pt)
      ? { x: obj.x + pt[0], y: obj.y + pt[1] }
      : { x: obj.x + pt.x, y: obj.y + pt.y });
    if (vertices.length < 3) return false;

    // Ray casting point in polygon
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const xi = vertices[i].x, yi = vertices[i].y;
      const xj = vertices[j].x, yj = vertices[j].y;
      const intersect = ((yi > localPt.y) !== (yj > localPt.y)) &&
        (localPt.x < (xj - xi) * (localPt.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    if (inside) return true;
    const unrotatedObj = { ...obj, rotation: 0 };
    return distanceToPath(localPt, unrotatedObj) <= hitThreshold;
  }

  if (obj.type === 'ellipse') {
    const a = Math.max(1, obj.width / 2);
    const b = Math.max(1, obj.height / 2);
    const dx = localPt.x - cx;
    const dy = localPt.y - cy;
    return (dx * dx) / (a * a) + (dy * dy) / (b * b) <= 1.0;
  }

  if (obj.type === 'diamond') {
    const hw = Math.max(1, obj.width / 2);
    const hh = Math.max(1, obj.height / 2);
    return Math.abs(localPt.x - cx) / hw + Math.abs(localPt.y - cy) / hh <= 1.0;
  }

  if (obj.type === 'triangle') {
    const p1 = { x: cx, y: obj.y };
    const p2 = { x: obj.x + obj.width, y: obj.y + obj.height };
    const p3 = { x: obj.x, y: obj.y + obj.height };
    const area = 0.5 * (-p2.y * p3.x + p1.y * (-p2.x + p3.x) + p1.x * (p2.y - p3.y) + p2.x * p3.y);
    if (area === 0) return false;
    const s = 1 / (2 * area) * (p1.y * p3.x - p1.x * p3.y + (p3.y - p1.y) * localPt.x + (p1.x - p3.x) * localPt.y);
    const t = 1 / (2 * area) * (p1.x * p2.y - p1.y * p2.x + (p1.y - p2.y) * localPt.x + (p2.x - p1.x) * localPt.y);
    return s >= 0 && t >= 0 && (s + t) <= 1;
  }

  // Rectangle, text, and other boxes
  return (
    localPt.x >= obj.x &&
    localPt.x <= obj.x + obj.width &&
    localPt.y >= obj.y &&
    localPt.y <= obj.y + obj.height
  );
}
