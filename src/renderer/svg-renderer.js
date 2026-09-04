/**
 * Sabura SVG Renderer: Pure SVG rendering of canvas background, shapes, connectors, text,
 * and runtime interaction overlays (selection, handles, guides).
 */

import { generateSketchPath, sketchLine, generateClosedFillPath } from '../core/sketch.js';
import { resolveConnectorGeometry, getBoundingBox, getUnionBoundingBox } from '../core/geometry.js';
import { FONT_FAMILIES } from '../core/types.js';
import { resolveContrastColor } from '../core/color.js';

/**
 * Escapes XML/HTML text.
 */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function safeSvgId(value) {
  // Encode every code point, rather than replacing characters, so distinct
  // valid object IDs (for example "cover a" and "cover_a") cannot share a
  // clipPath ID in the global SVG namespace.
  const encoded = Array.from(String(value || ''))
    .map(char => char.codePointAt(0).toString(16))
    .join('_');
  return encoded || 'empty';
}

/**
 * Renders an SVG arrowhead marker with natural Excalidraw stroke character.
 */
function renderArrowhead(tipX, tipY, fromX, fromY, size = 14, stroke = '#1e1e1e', strokeWidth = 2, isSketch = true) {
  const angle = Math.atan2(tipY - fromY, tipX - fromX);
  const leftAngle = angle + Math.PI * 0.84;
  const rightAngle = angle - Math.PI * 0.84;

  const lx = tipX + Math.cos(leftAngle) * size;
  const ly = tipY + Math.sin(leftAngle) * size;
  const rx = tipX + Math.cos(rightAngle) * size;
  const ry = tipY + Math.sin(rightAngle) * size;

  if (!isSketch) {
    return `<path d="M ${lx.toFixed(1)} ${ly.toFixed(1)} L ${tipX.toFixed(1)} ${tipY.toFixed(1)} L ${rx.toFixed(1)} ${ry.toFixed(1)}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  }

  // Hand-drawn sketchy arrowhead wings with subtle curve
  const mxL = (lx + tipX) / 2 + Math.sin(angle) * 1.5;
  const myL = (ly + tipY) / 2 - Math.cos(angle) * 1.5;
  const mxR = (rx + tipX) / 2 - Math.sin(angle) * 1.5;
  const myR = (ry + tipY) / 2 + Math.cos(angle) * 1.5;

  return `<path d="M ${lx.toFixed(1)} ${ly.toFixed(1)} Q ${mxL.toFixed(1)} ${myL.toFixed(1)} ${tipX.toFixed(1)} ${tipY.toFixed(1)} Q ${mxR.toFixed(1)} ${myR.toFixed(1)} ${rx.toFixed(1)} ${ry.toFixed(1)}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
}

/**
 * Wraps text into lines based on approximate character width.
 */
function wrapText(text, maxWidth, fontSize) {
  if (!text) return [];
  const approxCharWidth = fontSize * 0.55;
  const maxChars = Math.max(1, Math.floor(maxWidth / approxCharWidth));
  const rawLines = text.split('\n');
  const wrapped = [];

  for (const raw of rawLines) {
    if (raw.length <= maxChars) {
      wrapped.push(raw);
    } else {
      const words = raw.split(' ');
      let current = '';
      for (const w of words) {
        if (!current) {
          current = w;
        } else if ((current + ' ' + w).length <= maxChars) {
          current += ' ' + w;
        } else {
          wrapped.push(current);
          current = w;
        }
      }
      if (current) wrapped.push(current);
    }
  }
  return wrapped;
}

/**
 * Renders the entire SVG scene string.
 *
 * @param {Object} doc - Sabura document
 * @param {Object} runtime - Ephemeral runtime state (camera, selection, marquee, snapLines, hoverHandle)
 * @returns {string} Inner SVG content
 */
export function renderSvgScene(doc, runtime) {
  const { camera, selectedIds = [], marquee = null, snapGuides = [], connectorDraft = null } = runtime;
  const theme = doc.theme;

  let out = [];
  out.push('<svg id="canvas-svg" width="100%" height="100%" style="display: block; width: 100%; height: 100%;">');

  // Defs for filters / patterns
  out.push('<defs>');
  if (theme.id === 'blueprint') {
    out.push(`
      <pattern id="canvas-grid" width="${20 * camera.zoom}" height="${20 * camera.zoom}" patternUnits="userSpaceOnUse"
        patternTransform="translate(${camera.x % (20 * camera.zoom)}, ${camera.y % (20 * camera.zoom)})">
        <path d="M ${20 * camera.zoom} 0 L 0 0 0 ${20 * camera.zoom}" fill="none" stroke="${theme.gridColor || 'rgba(56, 189, 248, 0.15)'}" stroke-width="0.8" />
      </pattern>
    `);
  } else {
    out.push(`
      <pattern id="canvas-grid" width="${20 * camera.zoom}" height="${20 * camera.zoom}" patternUnits="userSpaceOnUse"
        patternTransform="translate(${camera.x % (20 * camera.zoom)}, ${camera.y % (20 * camera.zoom)})">
        <circle cx="${1.2 * camera.zoom}" cy="${1.2 * camera.zoom}" r="${1.2 * Math.min(1.4, Math.max(0.7, camera.zoom))}" fill="${theme.gridColor || 'rgba(0,0,0,0.08)'}" />
      </pattern>
    `);
  }
  out.push('</defs>');

  // Background rect with grid pattern
  out.push(`<rect width="100%" height="100%" fill="${theme.background}" />`);
  if (runtime.showGrid !== false) {
    out.push('<rect width="100%" height="100%" fill="url(#canvas-grid)" pointer-events="none" />');
  }

  // World transform group
  out.push(`<g id="world-layer" transform="translate(${camera.x}, ${camera.y}) scale(${camera.zoom})">`);

  // Determine effective rendering order:
  // Non-connectors follow doc.order.
  // Connectors follow explicit stacking ('front' or 'back') or naturally follow the visual level of connected objects.
  const baseOrder = [...doc.order];
  const orderIndices = new Map(baseOrder.map((id, idx) => [id, idx]));

  const sortedOrder = [...baseOrder].sort((aId, bId) => {
    const aObj = doc.objects[aId];
    const bObj = doc.objects[bId];
    const aBase = orderIndices.get(aId) ?? 0;
    const bBase = orderIndices.get(bId) ?? 0;

    const getEffectiveKey = (obj, baseIdx) => {
      if (!obj || obj.type !== 'connector') return baseIdx * 10;
      if (obj.stacking === 'back') return -1000 + baseIdx;
      if (obj.stacking === 'front') return 1000000 + baseIdx;

      // Natural visual level: if connected to objects, sit at or above max connected object
      const fromIdx = obj.from?.id ? orderIndices.get(obj.from.id) : undefined;
      const toIdx = obj.to?.id ? orderIndices.get(obj.to.id) : undefined;
      if (fromIdx !== undefined || toIdx !== undefined) {
        const maxConnected = Math.max(fromIdx ?? -1, toIdx ?? -1);
        const naturalIdx = Math.max(baseIdx, maxConnected);
        return naturalIdx * 10 + 1;
      }
      return baseIdx * 10;
    };

    return getEffectiveKey(aObj, aBase) - getEffectiveKey(bObj, bBase);
  });

  // Render objects according to sorted order
  for (const objId of sortedOrder) {
    const obj = doc.objects[objId];
    if (!obj) continue;

    out.push(renderObject(doc, obj, selectedIds.includes(objId)));
  }

  // Render connector draft if in progress
  if (connectorDraft) {
    out.push(`<line x1="${connectorDraft.start.x}" y1="${connectorDraft.start.y}" x2="${connectorDraft.end.x}" y2="${connectorDraft.end.y}" stroke="${theme.defaultStroke}" stroke-width="2" stroke-dasharray="4,4" />`);
  }

  // Render runtime snap guides
  for (const guide of snapGuides) {
    if (guide.orientation === 'v') {
      out.push(`<line x1="${guide.pos}" y1="${guide.from}" x2="${guide.pos}" y2="${guide.to}" stroke="#e03131" stroke-width="1" stroke-dasharray="3,3" pointer-events="none" />`);
    } else {
      out.push(`<line x1="${guide.from}" y1="${guide.pos}" x2="${guide.to}" y2="${guide.pos}" stroke="#e03131" stroke-width="1" stroke-dasharray="3,3" pointer-events="none" />`);
    }
  }

  // Render transient reconnect snap guide / candidate indicator
  if (runtime.reconnectSnapIndicator && runtime.reconnectSnapIndicator.point) {
    const snap = runtime.reconnectSnapIndicator;
    const snapColor = doc.theme?.id === 'night' ? '#7aa2f7' : (doc.theme?.id === 'blueprint' ? '#38bdf8' : '#1971c2');
    out.push(`
      <g class="reconnect-snap-guide" pointer-events="none">
        <circle cx="${snap.point.x}" cy="${snap.point.y}" r="8" fill="none" stroke="${snapColor}" stroke-width="2.5" opacity="0.9" />
        <circle cx="${snap.point.x}" cy="${snap.point.y}" r="3.5" fill="${snapColor}" />
      </g>
    `);
  }

  // Render selection boxes and handles
  if (selectedIds.length > 0) {
    out.push(renderSelectionOverlay(doc, selectedIds));
  }

  // Render marquee selection box
  if (marquee) {
    const mx = Math.min(marquee.startX, marquee.currentX);
    const my = Math.min(marquee.startY, marquee.currentY);
    const mw = Math.abs(marquee.currentX - marquee.startX);
    const mh = Math.abs(marquee.currentY - marquee.startY);
    out.push(`<rect x="${mx}" y="${my}" width="${mw}" height="${mh}" fill="rgba(25, 113, 194, 0.1)" stroke="#1971c2" stroke-width="1" stroke-dasharray="4,4" pointer-events="none" />`);
  }

  out.push('</g>'); // end world-layer
  out.push('</svg>');
  return out.join('\n');
}

/**
 * Renders an individual object to SVG.
 */
export function renderObject(doc, obj, isSelected = false) {
  const isSketch = (obj.roughness !== undefined ? obj.roughness : 1) > 0;
  const strokeWidth = obj.strokeWidth !== undefined ? obj.strokeWidth : 2;
  const baseStroke = obj.stroke || '#1e1e1e';
  const stroke = resolveContrastColor(baseStroke, doc.theme?.background || '#ffffff', '#ffffff', '#1e1e1e');
  const fill = obj.fill || 'none';
  const opacity = obj.opacity !== undefined ? obj.opacity : 1.0;
  const strokeDash = obj.strokeStyle === 'dashed' ? '8,6' : (obj.strokeStyle === 'dotted' ? '3,4' : 'none');

  const rot = (obj.type !== 'connector' && typeof obj.rotation === 'number' && Number.isFinite(obj.rotation)) ? obj.rotation : 0;
  const cx = (typeof obj.x === 'number' && typeof obj.width === 'number') ? obj.x + obj.width / 2 : 0;
  const cy = (typeof obj.y === 'number' && typeof obj.height === 'number') ? obj.y + obj.height / 2 : 0;
  const rotAttr = rot !== 0 ? ` transform="rotate(${rot} ${cx} ${cy})"` : '';

  let markup = [];
  markup.push(`<g id="elem-${obj.id}" data-id="${obj.id}" opacity="${opacity}"${rotAttr}>`);

  if (obj.type === 'connector') {
    const geom = resolveConnectorGeometry(doc, obj);
    let pathD = geom.path;

    markup.push(`<path d="${pathD}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-dasharray="${strokeDash}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`);

    // Arrowheads
    if (obj.endArrow && geom.points.length >= 2) {
      const tip = geom.points[geom.points.length - 1];
      const prev = geom.points[geom.points.length - 2];
      markup.push(renderArrowhead(tip.x, tip.y, prev.x, prev.y, 14, stroke, strokeWidth, isSketch));
    }
    if (obj.startArrow && geom.points.length >= 2) {
      const tip = geom.points[0];
      const next = geom.points[1];
      markup.push(renderArrowhead(tip.x, tip.y, next.x, next.y, 14, stroke, strokeWidth, isSketch));
    }
  } else if (obj.type === 'image') {
    const asset = doc.assets?.[obj.assetId];
    const safeRaster = asset && asset.type === 'raster' &&
      (asset.mimeType === 'image/png' || asset.mimeType === 'image/jpeg' || asset.mimeType === 'image/webp') &&
      typeof asset.data === 'string' && asset.data.startsWith(`data:${asset.mimeType};base64,`) &&
      typeof asset.width === 'number' && Number.isFinite(asset.width) && asset.width > 0 &&
      typeof asset.height === 'number' && Number.isFinite(asset.height) && asset.height > 0;
    if (safeRaster) {
      const href = escapeXml(asset.data);
      if (obj.fit === 'cover') {
        const clipId = `clip-image-${safeSvgId(obj.id)}`;
        markup.push(`<defs><clipPath id="${clipId}"><rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" /></clipPath></defs>`);
        markup.push(`<image href="${href}" x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" />`);
      } else {
        markup.push(`<image href="${href}" x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" preserveAspectRatio="xMidYMid meet" />`);
      }
    }
  } else if (obj.type === 'text') {
    // Standalone text
    const textStyle = obj.textStyle || {};
    const fontSize = textStyle.resolvedSize || 20;
    const familyToken = textStyle.fontFamily || (isSketch ? 'hand' : (doc.theme?.defaultFontFamily || 'hand'));
    const fontFamily = FONT_FAMILIES[familyToken] || FONT_FAMILIES.hand;
    const fontWeight = textStyle.bold ? 'bold' : 'normal';
    const rawTextColor = textStyle.color || obj.stroke || '#1e1e1e';
    const fillCol = resolveContrastColor(rawTextColor, doc.theme?.background || '#ffffff', '#ffffff', '#1e1e1e');
    const lines = obj.text ? obj.text.split('\n') : [];
    if (lines.length > 0) {
      let textAnchor = 'start';
      let textX = obj.x + 6;
      if (textStyle.align === 'center') {
        textAnchor = 'middle';
        textX = obj.x + obj.width / 2;
      } else if (textStyle.align === 'right') {
        textAnchor = 'end';
        textX = obj.x + obj.width - 6;
      }

      const lineHeight = fontSize * 1.3;
      const totalHeight = (lines.length - 1) * lineHeight + fontSize;
      const startY = obj.y + Math.max(0, (obj.height - totalHeight) / 2) + fontSize * 0.85;

      markup.push(`<text x="${textX}" y="${startY}" font-size="${fontSize}" font-family="${escapeXml(fontFamily)}" font-weight="${fontWeight}" fill="${fillCol}" text-anchor="${textAnchor}" style="user-select: none;">`);
      for (let i = 0; i < lines.length; i++) {
        markup.push(`<tspan x="${textX}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(lines[i])}</tspan>`);
      }
      markup.push('</text>');
    }
  } else if (['rectangle', 'ellipse', 'diamond', 'triangle', 'path'].includes(obj.type)) {
    // Shape base background for fill (solid fill controlled by object opacity)
    if (fill !== 'none') {
      const fillPath = generateClosedFillPath(obj);
      if (fillPath) {
        markup.push(`<path d="${fillPath}" fill="${fill}" fill-opacity="1.0" stroke="none" />`);
      }
    }

    // Stroke path (sketchy or clean) - only render if strokeWidth > 0
    if (strokeWidth > 0) {
      const strokePath = generateSketchPath(obj);
      if (strokePath) {
        markup.push(`<path d="${strokePath}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-dasharray="${strokeDash}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`);
      }
    }

    // Arrowheads for open paths (lines)
    if (obj.type === 'path' && !obj.closed && obj.points && obj.points.length >= 2) {
      const n = obj.points.length;
      const pFirst = obj.points[0];
      const pSecond = obj.points[1];
      const pLast = obj.points[n - 1];
      const pPrev = obj.points[n - 2];

      const fX = obj.x + (Array.isArray(pFirst) ? pFirst[0] : pFirst.x);
      const fY = obj.y + (Array.isArray(pFirst) ? pFirst[1] : pFirst.y);
      const sX = obj.x + (Array.isArray(pSecond) ? pSecond[0] : pSecond.x);
      const sY = obj.y + (Array.isArray(pSecond) ? pSecond[1] : pSecond.y);

      const lX = obj.x + (Array.isArray(pLast) ? pLast[0] : pLast.x);
      const lY = obj.y + (Array.isArray(pLast) ? pLast[1] : pLast.y);
      const prX = obj.x + (Array.isArray(pPrev) ? pPrev[0] : pPrev.x);
      const prY = obj.y + (Array.isArray(pPrev) ? pPrev[1] : pPrev.y);

      if (obj.startArrow) {
        markup.push(renderArrowhead(fX, fY, sX, sY, 14, stroke, strokeWidth > 0 ? strokeWidth : 2, isSketch));
      }
      if (obj.endArrow) {
        markup.push(renderArrowhead(lX, lY, prX, prY, 14, stroke, strokeWidth > 0 ? strokeWidth : 2, isSketch));
      }
    }

    // Text inside shape
    if (obj.text && obj.text.trim()) {
      const textStyle = obj.textStyle || {};
      const fontSize = textStyle.resolvedSize || 20;
      const familyToken = textStyle.fontFamily || (isSketch ? 'hand' : (doc.theme?.defaultFontFamily || 'hand'));
      const fontFamily = FONT_FAMILIES[familyToken] || FONT_FAMILIES.hand;
      const fontWeight = textStyle.bold ? 'bold' : 'normal';
      const rawTextColor = textStyle.color || obj.stroke || '#1e1e1e';
      const shapeBg = (obj.fill && obj.fill !== 'none') ? obj.fill : (doc.theme?.background || '#ffffff');
      const textColor = resolveContrastColor(rawTextColor, shapeBg, '#ffffff', '#1e1e1e');

      const lines = wrapText(obj.text, obj.width - 16, fontSize);
      const lineHeight = fontSize * 1.25;
      const totalTextHeight = lines.length * lineHeight;
      const startY = obj.y + (obj.height - totalTextHeight) / 2 + fontSize * 0.85;

      let textAnchor = 'middle';
      let textX = obj.x + obj.width / 2;
      if (textStyle.align === 'left') {
        textAnchor = 'start';
        textX = obj.x + 12;
      } else if (textStyle.align === 'right') {
        textAnchor = 'end';
        textX = obj.x + obj.width - 12;
      }

      markup.push(`<text x="${textX}" y="${startY}" font-size="${fontSize}" font-family="${escapeXml(fontFamily)}" font-weight="${fontWeight}" fill="${textColor}" text-anchor="${textAnchor}" style="user-select: none;">`);
      for (let i = 0; i < lines.length; i++) {
        markup.push(`<tspan x="${textX}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(lines[i])}</tspan>`);
      }
      markup.push('</text>');
    }
  } else {
    // Custom namespaced unknown object placeholder
    markup.push(`<rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" fill="#f1f3f5" stroke="#868e96" stroke-width="1.5" stroke-dasharray="4,4" />`);
    markup.push(`<text x="${obj.x + 8}" y="${obj.y + 20}" font-size="12" fill="#495057" font-family="sans-serif">[Inert: ${escapeXml(obj.type)}]</text>`);
  }

  // Lock indicator icon if locked
  if (obj.locked) {
    markup.push(`<g transform="translate(${obj.x + obj.width - 18}, ${obj.y + 4})">
      <rect x="0" y="4" width="12" height="9" rx="2" fill="#868e96" />
      <path d="M 2 4 V 2 A 4 4 0 0 1 10 2 V 4" stroke="#868e96" stroke-width="1.5" fill="none" />
    </g>`);
  }

  markup.push('</g>');
  return markup.join('\n');
}

/**
 * Renders selection handles, bounding boxes, and precision alignment overlay for the selected objects.
 */
export function renderSelectionOverlay(doc, selectedIds) {
  const selectedObjects = selectedIds.map(id => doc.objects[id]).filter(Boolean);
  if (selectedObjects.length === 0) return '';

  const themeId = doc?.theme?.id || 'paper';
  let selStroke = '#1971c2';
  let selFill = 'rgba(25, 113, 194, 0.04)';
  let handleFill = '#ffffff';
  let handleStroke = '#1971c2';

  if (themeId === 'blueprint') {
    selStroke = '#38bdf8';
    selFill = 'rgba(56, 189, 248, 0.08)';
    handleFill = '#0c192e';
    handleStroke = '#38bdf8';
  } else if (themeId === 'night') {
    selStroke = '#7aa2f7';
    selFill = 'rgba(122, 162, 247, 0.08)';
    handleFill = '#18181b';
    handleStroke = '#7aa2f7';
  } else if (themeId === 'high-contrast') {
    selStroke = '#0000ff';
    selFill = 'rgba(0, 0, 255, 0.08)';
    handleFill = '#ffffff';
    handleStroke = '#000000';
  }

  const markup = [];

  // If single connector selected, render endpoint handles with comfortable hit targets
  if (selectedObjects.length === 1 && selectedObjects[0].type === 'connector') {
    const conn = selectedObjects[0];
    const geom = resolveConnectorGeometry(doc, conn);
    markup.push(`<g data-handle="conn-from" style="cursor: grab;">
      <circle cx="${geom.start.x}" cy="${geom.start.y}" r="14" fill="transparent" />
      <circle cx="${geom.start.x}" cy="${geom.start.y}" r="6.5" fill="${selStroke}" stroke="${handleFill}" stroke-width="2.5" pointer-events="none" />
    </g>`);
    markup.push(`<g data-handle="conn-to" style="cursor: grab;">
      <circle cx="${geom.end.x}" cy="${geom.end.y}" r="14" fill="transparent" />
      <circle cx="${geom.end.x}" cy="${geom.end.y}" r="6.5" fill="${selStroke}" stroke="${handleFill}" stroke-width="2.5" pointer-events="none" />
    </g>`);

    // If curved connector, render arc handle at curve midpoint for interactive flipping/curving
    if (conn.routing === 'curved' && geom.curveMidpoint) {
      const mx = geom.curveMidpoint.x;
      const my = geom.curveMidpoint.y;
      markup.push(`<g data-handle="conn-curve" style="cursor: pointer;" title="Flip or drag curve">
        <circle cx="${mx}" cy="${my}" r="14" fill="transparent" />
        <circle cx="${mx}" cy="${my}" r="5.5" fill="${handleFill}" stroke="${selStroke}" stroke-width="2.5" pointer-events="none" />
        <circle cx="${mx}" cy="${my}" r="2" fill="${selStroke}" pointer-events="none" />
      </g>`);
    }

    // If elbow connector, render bypass handle at middle segment
    if (conn.routing === 'elbow' && geom.elbowMidpoint) {
      const ex = geom.elbowMidpoint.x;
      const ey = geom.elbowMidpoint.y;
      markup.push(`<g data-handle="conn-elbow" style="cursor: pointer;" title="Adjust or flip elbow bypass">
        <circle cx="${ex}" cy="${ey}" r="14" fill="transparent" />
        <circle cx="${ex}" cy="${ey}" r="5.5" fill="${handleFill}" stroke="${selStroke}" stroke-width="2.5" pointer-events="none" />
        <rect x="${ex - 2}" y="${ey - 2}" width="4" height="4" fill="${selStroke}" pointer-events="none" />
      </g>`);
    }

    return markup.join('\n');
  }

  // Single spatial object: render oriented selection box aligned to local rotation
  if (selectedObjects.length === 1 && selectedObjects[0].type !== 'connector') {
    const obj = selectedObjects[0];
    const rot = (typeof obj.rotation === 'number' && Number.isFinite(obj.rotation)) ? obj.rotation : 0;
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;
    const pad = 4;
    const bx = obj.x - pad;
    const by = obj.y - pad;
    const bw = obj.width + pad * 2;
    const bh = obj.height + pad * 2;

    const rotAttr = rot !== 0 ? ` transform="rotate(${rot} ${cx} ${cy})"` : '';
    markup.push(`<g class="selection-single-overlay"${rotAttr}>`);

    // Oriented selection outline
    markup.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${selFill}" stroke="${selStroke}" stroke-width="1.2" stroke-dasharray="4,4" class="selection-bounds-rect" pointer-events="none" />`);

    if (!obj.locked) {
      const handles = [
        { id: 'nw', x: bx, y: by, cursor: 'nwse-resize' },
        { id: 'n', x: bx + bw / 2, y: by, cursor: 'ns-resize' },
        { id: 'ne', x: bx + bw, y: by, cursor: 'nesw-resize' },
        { id: 'e', x: bx + bw, y: by + bh / 2, cursor: 'ew-resize' },
        { id: 'se', x: bx + bw, y: by + bh, cursor: 'nwse-resize' },
        { id: 's', x: bx + bw / 2, y: by + bh, cursor: 'ns-resize' },
        { id: 'sw', x: bx, y: by + bh, cursor: 'nesw-resize' },
        { id: 'w', x: bx, y: by + bh / 2, cursor: 'ew-resize' }
      ];

      for (const h of handles) {
        markup.push(`<circle cx="${h.x}" cy="${h.y}" r="4.5" fill="${handleFill}" stroke="${handleStroke}" stroke-width="1.8" data-handle="${h.id}" style="cursor: ${h.cursor};" />`);
      }

      // Single object rotation handle + stem above handle 'n'
      const stemTop = by - 24;
      const midX = bx + bw / 2;
      markup.push(`<line x1="${midX}" y1="${by}" x2="${midX}" y2="${stemTop}" stroke="${selStroke}" stroke-width="1.2" pointer-events="none" />`);
      markup.push(`<g data-handle="rotate" style="cursor: grab;" title="Rotate (Hold Shift to snap to 15°)">
        <circle cx="${midX}" cy="${stemTop}" r="14" fill="transparent" />
        <circle cx="${midX}" cy="${stemTop}" r="4.5" fill="${handleFill}" stroke="${handleStroke}" stroke-width="1.8" pointer-events="none" />
      </g>`);

      // If single path object, also render interactive vertex handles at each point
      if (obj.type === 'path' && Array.isArray(obj.points)) {
        obj.points.forEach((pt, idx) => {
          const vx = obj.x + (Array.isArray(pt) ? pt[0] : pt.x);
          const vy = obj.y + (Array.isArray(pt) ? pt[1] : pt.y);
          markup.push(`<g data-handle="vertex-${idx}" style="cursor: move;" title="Drag vertex">
            <circle cx="${vx}" cy="${vy}" r="14" fill="transparent" />
            <circle cx="${vx}" cy="${vy}" r="5" fill="${handleFill}" stroke="${selStroke}" stroke-width="2" pointer-events="none" />
          </g>`);
        });
      }
    }

    markup.push('</g>');
    return markup.join('\n');
  }

  // Multi-selection: world-aligned bounding box and shared handles
  const unionBox = getUnionBoundingBox(selectedObjects, doc);
  if (!unionBox) return '';

  const pad = 4;
  const bx = unionBox.x - pad;
  const by = unionBox.y - pad;
  const bw = unionBox.width + pad * 2;
  const bh = unionBox.height + pad * 2;

  // Bounding rect: Concepts precision hairline dash with subtle accent wash
  markup.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${selFill}" stroke="${selStroke}" stroke-width="1.2" stroke-dasharray="4,4" class="selection-bounds-rect" pointer-events="none" />`);

  // Count badge
  const countText = `${selectedObjects.length} objects`;
  const badgeWidth = Math.max(60, countText.length * 7 + 16);
  const badgeHeight = 20;
  const badgeX = bx + bw - badgeWidth;
  const badgeY = by - badgeHeight - 4;
  markup.push(`
    <g class="selection-count-badge" pointer-events="none">
      <rect x="${badgeX}" y="${badgeY}" width="${badgeWidth}" height="${badgeHeight}" rx="4" ry="4" fill="${selStroke}" opacity="0.9" />
      <text x="${badgeX + badgeWidth / 2}" y="${badgeY + 14}" fill="#ffffff" font-size="11" font-weight="600" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" text-anchor="middle">${countText}</text>
    </g>
  `);

  // Render 8 resize handles and 1 rotation handle for unlocked spatial objects
  const resizableObjects = selectedObjects.filter(o => o && o.type !== 'connector' && !o.locked);
  if (resizableObjects.length > 0) {
    const transformBox = getUnionBoundingBox(resizableObjects, doc);

    if (transformBox) {
      const hbx = transformBox.x - pad;
      const hby = transformBox.y - pad;
      const hbw = transformBox.width + pad * 2;
      const hbh = transformBox.height + pad * 2;

      const handles = [
        { id: 'nw', x: hbx, y: hby, cursor: 'nwse-resize' },
        { id: 'n', x: hbx + hbw / 2, y: hby, cursor: 'ns-resize' },
        { id: 'ne', x: hbx + hbw, y: hby, cursor: 'nesw-resize' },
        { id: 'e', x: hbx + hbw, y: hby + hbh / 2, cursor: 'ew-resize' },
        { id: 'se', x: hbx + hbw, y: hby + hbh, cursor: 'nwse-resize' },
        { id: 's', x: hbx + hbw / 2, y: hby + hbh, cursor: 'ns-resize' },
        { id: 'sw', x: hbx, y: hby + hbh, cursor: 'nesw-resize' },
        { id: 'w', x: hbx, y: hby + hbh / 2, cursor: 'ew-resize' }
      ];

      for (const h of handles) {
        markup.push(`<circle cx="${h.x}" cy="${h.y}" r="4.5" fill="${handleFill}" stroke="${handleStroke}" stroke-width="1.8" data-handle="${h.id}" style="cursor: ${h.cursor};" />`);
      }

      // Shared rotation handle + stem above handle 'n' of transform box
      const stemTop = hby - 24;
      const midX = hbx + hbw / 2;
      markup.push(`<line x1="${midX}" y1="${hby}" x2="${midX}" y2="${stemTop}" stroke="${selStroke}" stroke-width="1.2" pointer-events="none" />`);
      markup.push(`<g data-handle="rotate" style="cursor: grab;" title="Rotate selection (Hold Shift to snap to 15°)">
        <circle cx="${midX}" cy="${stemTop}" r="14" fill="transparent" />
        <circle cx="${midX}" cy="${stemTop}" r="4.5" fill="${handleFill}" stroke="${handleStroke}" stroke-width="1.8" pointer-events="none" />
      </g>`);
    }
  }

  return markup.join('\n');
}
