/**
 * Sabura Geometry Engine: Bounding boxes, Snapping, Alignment, Distribution, Intersections, and Routing.
 */

import { MIN_OBJECT_SIZE, FONT_FAMILIES } from './types.js';

/**
 * Gets axis-aligned bounding box of an object.
 * For connectors, calculates the true bounds from resolved/rendered geometry without phantom zero-origin.
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
  const box = getBoundingBox(shape);
  const center = { x: box.cx, y: box.cy };

  if (Math.abs(targetPoint.x - center.x) < 1e-4 && Math.abs(targetPoint.y - center.y) < 1e-4) {
    return center;
  }

  const dx = targetPoint.x - center.x;
  const dy = targetPoint.y - center.y;

  if (shape.type === 'ellipse') {
    // Ray from center: (dx, dy)
    // Ellipse equation: (x/a)^2 + (y/b)^2 = 1
    const a = box.width / 2;
    const b = box.height / 2;
    const angle = Math.atan2(dy, dx);
    return {
      x: center.x + a * Math.cos(angle),
      y: center.y + b * Math.sin(angle)
    };
  }

  if (shape.type === 'diamond') {
    const top = { x: box.cx, y: box.y };
    const right = { x: box.right, y: box.cy };
    const bottom = { x: box.cx, y: box.bottom };
    const left = { x: box.x, y: box.cy };

    const segments = [
      [top, right],
      [right, bottom],
      [bottom, left],
      [left, top]
    ];

    for (const [p1, p2] of segments) {
      const pt = lineIntersect(center, targetPoint, p1, p2);
      if (pt) return pt;
    }
  }

  if (shape.type === 'triangle') {
    const top = { x: box.cx, y: box.y };
    const br = { x: box.right, y: box.bottom };
    const bl = { x: box.x, y: box.bottom };

    const segments = [
      [top, br],
      [br, bl],
      [bl, top]
    ];

    for (const [p1, p2] of segments) {
      const pt = lineIntersect(center, targetPoint, p1, p2);
      if (pt) return pt;
    }
  }

  // Default: Rectangle & Text & other shapes
  const segments = [
    [{ x: box.x, y: box.y }, { x: box.right, y: box.y }], // top
    [{ x: box.right, y: box.y }, { x: box.right, y: box.bottom }], // right
    [{ x: box.right, y: box.bottom }, { x: box.x, y: box.bottom }], // bottom
    [{ x: box.x, y: box.bottom }, { x: box.x, y: box.y }] // left
  ];

  for (const [p1, p2] of segments) {
    const pt = lineIntersect(center, targetPoint, p1, p2);
    if (pt) return pt;
  }

  return center;
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
  const box = getBoundingBox(shape);
  const snapPoints = [];

  if (shape.type === 'diamond') {
    // 4 Vertices
    snapPoints.push({ name: 'top', point: { x: box.cx, y: box.y }, anchor: { x: 0.5, y: 0 } });
    snapPoints.push({ name: 'right', point: { x: box.right, y: box.cy }, anchor: { x: 1, y: 0.5 } });
    snapPoints.push({ name: 'bottom', point: { x: box.cx, y: box.bottom }, anchor: { x: 0.5, y: 1 } });
    snapPoints.push({ name: 'left', point: { x: box.x, y: box.cy }, anchor: { x: 0, y: 0.5 } });
    // 4 Edge midpoints
    snapPoints.push({ name: 'top-right', point: { x: (box.cx + box.right) / 2, y: (box.y + box.cy) / 2 }, anchor: { x: 0.75, y: 0.25 } });
    snapPoints.push({ name: 'bottom-right', point: { x: (box.right + box.cx) / 2, y: (box.cy + box.bottom) / 2 }, anchor: { x: 0.75, y: 0.75 } });
    snapPoints.push({ name: 'bottom-left', point: { x: (box.cx + box.x) / 2, y: (box.bottom + box.cy) / 2 }, anchor: { x: 0.25, y: 0.75 } });
    snapPoints.push({ name: 'top-left', point: { x: (box.x + box.cx) / 2, y: (box.cy + box.y) / 2 }, anchor: { x: 0.25, y: 0.25 } });
    return snapPoints;
  }

  if (shape.type === 'triangle') {
    // 3 Vertices
    snapPoints.push({ name: 'top', point: { x: box.cx, y: box.y }, anchor: { x: 0.5, y: 0 } });
    snapPoints.push({ name: 'bottom-right', point: { x: box.right, y: box.bottom }, anchor: { x: 1, y: 1 } });
    snapPoints.push({ name: 'bottom-left', point: { x: box.x, y: box.bottom }, anchor: { x: 0, y: 1 } });
    // 3 Edge midpoints
    snapPoints.push({ name: 'right', point: { x: (box.cx + box.right) / 2, y: (box.y + box.bottom) / 2 }, anchor: { x: 0.75, y: 0.5 } });
    snapPoints.push({ name: 'bottom', point: { x: box.cx, y: box.bottom }, anchor: { x: 0.5, y: 1 } });
    snapPoints.push({ name: 'left', point: { x: (box.cx + box.x) / 2, y: (box.y + box.bottom) / 2 }, anchor: { x: 0.25, y: 0.5 } });
    return snapPoints;
  }

  if (shape.type === 'ellipse') {
    const a = box.width / 2;
    const b = box.height / 2;
    // 4 Cardinal points
    snapPoints.push({ name: 'top', point: { x: box.cx, y: box.y }, anchor: { x: 0.5, y: 0 } });
    snapPoints.push({ name: 'right', point: { x: box.right, y: box.cy }, anchor: { x: 1, y: 0.5 } });
    snapPoints.push({ name: 'bottom', point: { x: box.cx, y: box.bottom }, anchor: { x: 0.5, y: 1 } });
    snapPoints.push({ name: 'left', point: { x: box.x, y: box.cy }, anchor: { x: 0, y: 0.5 } });
    // 4 Diagonals (45 deg)
    const cos45 = Math.SQRT1_2;
    const sin45 = Math.SQRT1_2;
    snapPoints.push({ name: 'top-right', point: { x: box.cx + a * cos45, y: box.cy - b * sin45 }, anchor: { x: 0.5 + 0.5 * cos45, y: 0.5 - 0.5 * sin45 } });
    snapPoints.push({ name: 'bottom-right', point: { x: box.cx + a * cos45, y: box.cy + b * sin45 }, anchor: { x: 0.5 + 0.5 * cos45, y: 0.5 + 0.5 * sin45 } });
    snapPoints.push({ name: 'bottom-left', point: { x: box.cx - a * cos45, y: box.cy + b * sin45 }, anchor: { x: 0.5 - 0.5 * cos45, y: 0.5 + 0.5 * sin45 } });
    snapPoints.push({ name: 'top-left', point: { x: box.cx - a * cos45, y: box.cy - b * sin45 }, anchor: { x: 0.5 - 0.5 * cos45, y: 0.5 - 0.5 * sin45 } });
    return snapPoints;
  }

  // Rectangle & Text & other shapes
  // 4 Side centers
  snapPoints.push({ name: 'top', point: { x: box.cx, y: box.y }, anchor: { x: 0.5, y: 0 } });
  snapPoints.push({ name: 'right', point: { x: box.right, y: box.cy }, anchor: { x: 1, y: 0.5 } });
  snapPoints.push({ name: 'bottom', point: { x: box.cx, y: box.bottom }, anchor: { x: 0.5, y: 1 } });
  snapPoints.push({ name: 'left', point: { x: box.x, y: box.cy }, anchor: { x: 0, y: 0.5 } });
  // 4 Corners
  snapPoints.push({ name: 'top-left', point: { x: box.x, y: box.y }, anchor: { x: 0, y: 0 } });
  snapPoints.push({ name: 'top-right', point: { x: box.right, y: box.y }, anchor: { x: 1, y: 0 } });
  snapPoints.push({ name: 'bottom-right', point: { x: box.right, y: box.bottom }, anchor: { x: 1, y: 1 } });
  snapPoints.push({ name: 'bottom-left', point: { x: box.x, y: box.bottom }, anchor: { x: 0, y: 1 } });

  return snapPoints;
}

/**
 * Calculates continuous position around shape perimeter with gentle snapping to side centers/corners.
 * @param {Object} shape 
 * @param {{ x: number, y: number }} worldPoint 
 * @param {number} snapDistance 
 * @returns {{ point: { x: number, y: number }, anchor: { x: number, y: number }, snapped: boolean, snapName?: string }}
 */
export function getClosestBoundaryPoint(shape, worldPoint, snapDistance = 14) {
  const box = getBoundingBox(shape);
  const px = worldPoint.x;
  const py = worldPoint.y;
  let closestPt = null;

  if (shape.type === 'ellipse') {
    const a = Math.max(1, box.width / 2);
    const b = Math.max(1, box.height / 2);
    const dx = px - box.cx;
    const dy = py - box.cy;
    const angle = (dx === 0 && dy === 0) ? -Math.PI / 2 : Math.atan2(dy, dx);
    closestPt = {
      x: box.cx + a * Math.cos(angle),
      y: box.cy + b * Math.sin(angle)
    };
  } else if (shape.type === 'diamond') {
    const top = { x: box.cx, y: box.y };
    const right = { x: box.right, y: box.cy };
    const bottom = { x: box.cx, y: box.bottom };
    const left = { x: box.x, y: box.cy };
    const segments = [
      [top, right],
      [right, bottom],
      [bottom, left],
      [left, top]
    ];
    let minDist = Infinity;
    for (const [p1, p2] of segments) {
      const proj = projectPointToSegment(px, py, p1.x, p1.y, p2.x, p2.y);
      const d = Math.hypot(px - proj.x, py - proj.y);
      if (d < minDist) {
        minDist = d;
        closestPt = proj;
      }
    }
  } else if (shape.type === 'triangle') {
    const top = { x: box.cx, y: box.y };
    const br = { x: box.right, y: box.bottom };
    const bl = { x: box.x, y: box.bottom };
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
        closestPt = proj;
      }
    }
  } else {
    // Rectangle, Text, and general boxes
    const topProj = { x: Math.max(box.x, Math.min(box.right, px)), y: box.y };
    const bottomProj = { x: Math.max(box.x, Math.min(box.right, px)), y: box.bottom };
    const leftProj = { x: box.x, y: Math.max(box.y, Math.min(box.bottom, py)) };
    const rightProj = { x: box.right, y: Math.max(box.y, Math.min(box.bottom, py)) };

    const candidates = [
      { pt: topProj, dist: Math.hypot(px - topProj.x, py - topProj.y) },
      { pt: rightProj, dist: Math.hypot(px - rightProj.x, py - rightProj.y) },
      { pt: bottomProj, dist: Math.hypot(px - bottomProj.x, py - bottomProj.y) },
      { pt: leftProj, dist: Math.hypot(px - leftProj.x, py - leftProj.y) }
    ];
    candidates.sort((a, b) => a.dist - b.dist);
    closestPt = candidates[0].pt;
  }

  // Check gentle snapping against useful snap points
  const snapPoints = getShapeSnapPoints(shape);
  let bestSnap = null;
  let bestSnapDist = Infinity;

  for (const s of snapPoints) {
    const d = Math.hypot(closestPt.x - s.point.x, closestPt.y - s.point.y);
    if (d <= snapDistance && d < bestSnapDist) {
      bestSnapDist = d;
      bestSnap = s;
    }
  }

  if (bestSnap) {
    return {
      point: bestSnap.point,
      anchor: bestSnap.anchor,
      snapped: true,
      snapName: bestSnap.name
    };
  }

  const anchorX = box.width > 0 ? (closestPt.x - box.x) / box.width : 0.5;
  const anchorY = box.height > 0 ? (closestPt.y - box.y) / box.height : 0.5;

  return {
    point: closestPt,
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
      const fromBox = getBoundingBox(fromObj);
      const targetPt = {
        x: fromBox.x + connector.from.anchor.x * fromBox.width,
        y: fromBox.y + connector.from.anchor.y * fromBox.height
      };
      start = getShapeBoundaryPoint(fromObj, targetPt);
    } else {
      start = getShapeBoundaryPoint(fromObj, endCenter);
    }
  } else {
    start = { ...startCenter };
  }

  let end;
  if (toObj) {
    if (connector.to?.anchor && typeof connector.to.anchor.x === 'number' && typeof connector.to.anchor.y === 'number') {
      const toBox = getBoundingBox(toObj);
      const targetPt = {
        x: toBox.x + connector.to.anchor.x * toBox.width,
        y: toBox.y + connector.to.anchor.y * toBox.height
      };
      end = getShapeBoundaryPoint(toObj, targetPt);
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
    // Orthogonal routing: stepped 90 deg corner
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      const midX = start.x + dx / 2;
      points = [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
      pathStr = `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`;
    } else {
      const midY = start.y + dy / 2;
      points = [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
      pathStr = `M ${start.x} ${start.y} L ${start.x} ${midY} L ${end.x} ${midY} L ${end.x} ${end.y}`;
    }
  } else if (routing === 'curved') {
    // Smooth bezier curve with perpendicular offset
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.hypot(dx, dy);
    const normal = dist > 0 ? { x: -dy / dist, y: dx / dist } : { x: 0, y: 0 };
    const curveAmount = Math.min(60, dist * 0.2);
    const cpX = (start.x + end.x) / 2 + normal.x * curveAmount;
    const cpY = (start.y + end.y) / 2 + normal.y * curveAmount;
    points = [start, { x: cpX, y: cpY }, end];
    pathStr = `M ${start.x} ${start.y} Q ${cpX} ${cpY} ${end.x} ${end.y}`;
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

  const origAspectRatio = orig.width / orig.height;

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
      const scaleX = newWidth / orig.width;
      const scaleY = newHeight / orig.height;
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
    if (keepAspect) {
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
