import { createPRNG, sketchWedge, sketchEllipse, sketchLine } from '../core/sketch.js';

/**
 * Creates SVG path for an annular sector (pie wedge).
 *
 * @param {number} cx - Center X
 * @param {number} cy - Center Y
 * @param {number} rInner - Inner radius
 * @param {number} rOuter - Outer radius
 * @param {number} startAngle - Start angle in radians
 * @param {number} endAngle - End angle in radians
 * @returns {string} SVG path 'd' attribute
 */
export function createWedgePath(cx, cy, rInner, rOuter, startAngle, endAngle, gapAngle = 0.025) {
  const span = endAngle - startAngle;
  const actualGap = Math.min(gapAngle, span * 0.25);
  const actualStart = startAngle + actualGap / 2;
  const actualEnd = endAngle - actualGap / 2;

  const x1 = cx + rOuter * Math.cos(actualStart);
  const y1 = cy + rOuter * Math.sin(actualStart);
  const x2 = cx + rOuter * Math.cos(actualEnd);
  const y2 = cy + rOuter * Math.sin(actualEnd);

  const x3 = cx + rInner * Math.cos(actualEnd);
  const y3 = cy + rInner * Math.sin(actualEnd);
  const x4 = cx + rInner * Math.cos(actualStart);
  const y4 = cy + rInner * Math.sin(actualStart);

  const largeArc = actualEnd - actualStart > Math.PI ? 1 : 0;

  if (rInner <= 0) {
    return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
  }

  return `M ${x4.toFixed(2)} ${y4.toFixed(2)} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
}

function isDarkColor(hex) {
  if (!hex || hex === 'none' || hex[0] !== '#') return false;
  const num = parseInt(hex.slice(1), 16);
  if (isNaN(num)) return false;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return luma < 140;
}

function getStrokeWidthItems(curWidth = 2, obj = null) {
  const w = curWidth !== undefined && curWidth !== null ? curWidth : 2;
  const items = [];

  // No outline (0px) is offered for closed shapes/paths only if another visible part remains (non-none fill or text)
  let canHaveNoOutline = false;
  if (obj) {
    const isClosedShape = ['rectangle', 'ellipse', 'diamond', 'triangle'].includes(obj.type) || (obj.type === 'path' && Boolean(obj.closed));
    if (isClosedShape) {
      const hasFill = Boolean(obj.fill && obj.fill !== 'none');
      const hasText = Boolean(obj.text && obj.text.trim().length > 0);
      if (hasFill || hasText) {
        canHaveNoOutline = true;
      }
    }
  }

  if (canHaveNoOutline) {
    items.push({ id: 'width_0', label: 'No outline', value: 0, isActive: w === 0 });
  }

  items.push(
    { id: 'width_1', label: '1px', value: 1, isActive: w === 1 },
    { id: 'width_2', label: '2px', value: 2, isActive: w === 2 },
    { id: 'width_4', label: '4px', value: 4, isActive: w === 4 },
    { id: 'width_6', label: '6px', value: 6, isActive: w >= 6 }
  );

  return items;
}

export class ToolWheel {
  constructor(containerElement, onAction) {
    this.container = containerElement;
    this.onAction = onAction; // Callback (actionName, payload)
    this.isOpen = false;
    this.pos = { x: 0, y: 0 };
    this.context = 'canvas'; // 'canvas' | 'object'
    this.selectedObject = null;
    this.hoveredItem = null;
    this.activeSubMenu = null;
    this.themePalette = [];

    this.wheelEl = document.createElement('div');
    this.wheelEl.className = 'sabura-wheel';
    this.wheelEl.style.display = 'none';
    this.container.appendChild(this.wheelEl);

    this.onPointerDownOutside = this.onPointerDownOutside.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  setThemePalette(palette) {
    this.themePalette = palette || [];
  }

  open(x, y, context = 'canvas', selectedObject = null, palette = [], selectedCount = 1, selectedObjects = []) {
    if (palette && palette.length) this.themePalette = palette;
    this.context = context;
    this.selectedObject = selectedObject;
    this.selectedCount = selectedCount;
    this.selectedObjects = Array.isArray(selectedObjects) ? selectedObjects : [];
    this.activeSubMenu = null;
    this.hoveredItem = null;

    // Clamp wheel position within viewport (including 3-tier outer ring and topbar clearance)
    const pad = 226; // Max radius with outer Ring 3
    const topBarPad = 72; // Header clearance
    const clampedX = Math.max(pad + 10, Math.min(window.innerWidth - pad - 10, x));
    const clampedY = Math.max(pad + topBarPad, Math.min(window.innerHeight - pad - 10, y));
    this.pos = { x: clampedX, y: clampedY };

    this.isOpen = true;
    this.wheelEl.style.display = 'block';
    this.wheelEl.style.left = `${this.pos.x}px`;
    this.wheelEl.style.top = `${this.pos.y}px`;

    this.render();

    window.addEventListener('pointerdown', this.onPointerDownOutside, true);
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.wheelEl.style.display = 'none';
    this.activeSubMenu = null;
    this.hoveredItem = null;
    window.removeEventListener('pointerdown', this.onPointerDownOutside, true);
    window.removeEventListener('keydown', this.onKeyDown, true);
  }

  onPointerDownOutside(e) {
    if (!this.wheelEl.contains(e.target)) {
      this.close();
    }
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.close();
    }
  }

  getCanvasItems() {
    return [
      {
        id: 'shapes',
        label: 'Shapes',
        icon: '▢',
        subItems: [
          { id: 'shape_rectangle', label: 'Rectangle', icon: '▭' },
          { id: 'shape_ellipse', label: 'Ellipse', icon: '◯' },
          { id: 'shape_diamond', label: 'Diamond', icon: '◇' },
          { id: 'shape_triangle', label: 'Triangle', icon: '△' }
        ]
      }, // Slot 0: 12:00
      { id: 'tool_text', label: 'Text', icon: 'T' }, // Slot 1: 1:30
      {
        id: 'connector',
        label: 'Connect',
        icon: '➔',
        subItems: [
          { id: 'conn_straight', label: 'Straight', icon: '—' },
          { id: 'conn_elbow', label: 'Elbow', icon: '⌐' },
          { id: 'conn_curved', label: 'Curved', icon: '~' }
        ]
      }, // Slot 2: 3:00
      { id: 'tool_line', label: 'Line / Poly', icon: '⏢' }, // Slot 3: 4:30
      { id: 'tool_hand', label: 'Hand/Pan', icon: '✋' }, // Slot 4: 6:00
      { id: 'action_undo', label: 'Undo', icon: '↶' }, // Slot 5: 7:30
      { id: 'action_redo', label: 'Redo', icon: '↷' }, // Slot 6: 9:00
      { id: 'tool_select', label: 'Select', icon: '↖' } // Slot 7: 10:30
    ];
  }

  getShapeItems(shape, isLocked) {
    const curShapeType = shape?.type || 'rectangle';
    const curRoughness = shape?.roughness === 0 ? 'clean' : 'sketch';
    const curStrokeStyle = shape?.strokeStyle || 'solid';
    const curFontSize = shape?.textStyle?.size || 'm';
    const curFontFamily = shape?.textStyle?.fontFamily || 'hand';
    const curBold = Boolean(shape?.textStyle?.bold);
    const curOpacity = shape?.opacity !== undefined ? shape.opacity : 1.0;

    // Slot 0 (12:00): Fill (Ring 2: Colors, Ring 3: Opacity)
    const fillColors = [
      { id: 'fill_none', label: 'None', color: 'none', icon: '⊘', isActive: !shape?.fill || shape?.fill === 'none' },
      ...this.themePalette.map((col, idx) => ({ id: `fill_${idx}`, label: col, color: col, isActive: shape?.fill === col }))
    ];
    const opacityItems = [
      { id: 'opacity_100', label: '100%', value: 1.0, isActive: curOpacity >= 0.9 },
      { id: 'opacity_75', label: '75%', value: 0.75, isActive: curOpacity >= 0.65 && curOpacity < 0.9 },
      { id: 'opacity_50', label: '50%', value: 0.5, isActive: curOpacity >= 0.4 && curOpacity < 0.65 },
      { id: 'opacity_25', label: '25%', value: 0.25, isActive: curOpacity < 0.4 }
    ];

    // Slot 1 (1:30): Text / Type (Ring 2: Fonts & Formatting, Ring 3: Sizes)
    const fontSub = [
      { id: 'font_hand', label: 'Hand', fontFamily: 'hand', isActive: curFontFamily === 'hand' },
      { id: 'font_sans', label: 'Sans', fontFamily: 'sans', isActive: curFontFamily === 'sans' },
      { id: 'font_serif', label: 'Serif', fontFamily: 'serif', isActive: curFontFamily === 'serif' },
      { id: 'font_mono', label: 'Mono', fontFamily: 'mono', isActive: curFontFamily === 'mono' },
      { id: 'type_bold', label: curBold ? 'Bold ✓' : 'Bold', toggleBold: true, isActive: curBold },
      { id: 'type_align', label: 'Align', cycleAlign: true }
    ];
    const sizeItems = [
      { id: 'type_s', label: 'S', size: 's', isActive: curFontSize === 's' },
      { id: 'type_m', label: 'M', size: 'm', isActive: curFontSize === 'm' },
      { id: 'type_l', label: 'L', size: 'l', isActive: curFontSize === 'l' },
      { id: 'type_xl', label: 'XL', size: 'xl', isActive: curFontSize === 'xl' }
    ];

    // Slot 2 (3:00): Shape Morph & Quick Connect (Ring 2: Shapes, Ring 3: Modifiers/Actions)
    const shapeSub = [
      { id: 'to_rectangle', label: 'Rect', icon: '▭', isActive: curShapeType === 'rectangle' },
      { id: 'to_ellipse', label: 'Ellipse', icon: '◯', isActive: curShapeType === 'ellipse' },
      { id: 'to_diamond', label: 'Diamond', icon: '◇', isActive: curShapeType === 'diamond' },
      { id: 'to_triangle', label: 'Triangle', icon: '△', isActive: curShapeType === 'triangle' }
    ];
    const shapeActions = [
      { id: 'to_equal_sides', label: 'Equal', icon: '⊞' },
      { id: 'action_connect', label: 'Connect', icon: '➔' }
    ];
    if (shape?.groupId) {
      shapeActions.push({ id: 'action_select_group', label: 'Select Group', icon: '⧉' });
      shapeActions.push({ id: 'action_ungroup', label: 'Ungroup', icon: '⧉' });
    }

    // Slot 3 (4:30): Duplicate
    const dupItem = { id: 'action_duplicate', label: 'Duplicate', icon: '❐' };

    // Slot 4 (6:00): Arrange (Order & Lock)
    const orderSub = [
      { id: 'order_front', label: 'Front', icon: '⇈' },
      { id: 'order_forward', label: 'Forward', icon: '↑' },
      { id: 'order_backward', label: 'Backward', icon: '↓' },
      { id: 'order_back', label: 'Back', icon: '⇊' },
      { id: isLocked ? 'action_unlock' : 'action_lock', label: isLocked ? 'Unlock' : 'Lock', icon: isLocked ? '🔓' : '🔒' }
    ];

    // Slot 5 (7:30): Style & Thickness
    const curStrokeWidth = shape?.strokeWidth !== undefined ? shape.strokeWidth : 2;
    const styleSub = [
      { id: 'style_sketch', label: 'Sketch', icon: '✎', isActive: curRoughness === 'sketch' },
      { id: 'style_clean', label: 'Clean', icon: '◻', isActive: curRoughness === 'clean' },
      { id: 'stroke_solid', label: 'Solid', icon: '—', isActive: curStrokeStyle === 'solid' },
      { id: 'stroke_dashed', label: 'Dashed', icon: '╌', isActive: curStrokeStyle === 'dashed' },
      { id: 'stroke_dotted', label: 'Dotted', icon: '···', isActive: curStrokeStyle === 'dotted' }
    ];

    // Slot 6 (9:00): Ink
    const inkSub = this.themePalette.map((col, idx) => ({ id: `ink_${idx}`, label: col, color: col, isActive: shape?.stroke === col }));

    // Slot 7 (10:30): Delete
    const delItem = { id: 'action_delete', label: 'Delete', icon: '🗑' };

    return [
      { id: 'menu_fill', label: 'Fill', icon: '▨', subItems: fillColors, thirdItems: opacityItems },
      { id: 'menu_type', label: 'Type', icon: 'A', subItems: fontSub, thirdItems: sizeItems },
      { id: 'menu_shape', label: 'Shape', icon: '◇', subItems: shapeSub, thirdItems: shapeActions },
      dupItem,
      { id: 'menu_order', label: 'Arrange', icon: '≡', subItems: orderSub },
      { id: 'menu_style', label: 'Style', icon: '✎', subItems: styleSub, thirdItems: getStrokeWidthItems(curStrokeWidth, shape) },
      { id: 'menu_ink', label: 'Ink', icon: '●', subItems: inkSub },
      delItem
    ];
  }

  getConnectorItems(conn, isLocked) {
    const curRouting = conn?.routing || 'straight';
    const curStart = Boolean(conn?.startArrow);
    const curEnd = Boolean(conn?.endArrow);
    const curArrows = (!curStart && !curEnd) ? 'none' : (curStart && !curEnd ? 'start' : (!curStart && curEnd ? 'end' : 'both'));
    const curRoughness = conn?.roughness === 0 ? 'clean' : 'sketch';
    const curStrokeStyle = conn?.strokeStyle || 'solid';

    // Slot 0 (12:00): Route
    const routeSub = [
      { id: 'conn_route_straight', label: 'Straight', icon: '—', routing: 'straight', isActive: curRouting === 'straight' },
      { id: 'conn_route_elbow', label: 'Elbow', icon: '⌐', routing: 'elbow', isActive: curRouting === 'elbow' },
      { id: 'conn_route_curved', label: 'Curved', icon: '~', routing: 'curved', isActive: curRouting === 'curved' }
    ];
    if (curRouting === 'curved') {
      routeSub.push({ id: 'conn_curve_flip', label: 'Flip Curve', icon: '⇄' });
      if (conn?.curveDistance !== undefined && conn?.curveDistance !== null) {
        routeSub.push({ id: 'conn_curve_auto', label: 'Auto Depth', icon: '↺' });
      }
    } else if (curRouting === 'elbow') {
      if (conn?.elbowOffset !== undefined && conn?.elbowOffset !== null) {
        routeSub.push({ id: 'conn_elbow_flip', label: 'Flip Side', icon: '⇄' });
        routeSub.push({ id: 'conn_elbow_auto', label: 'Auto Step', icon: '↺' });
      } else {
        routeSub.push({ id: 'conn_elbow_bypass', label: 'Bypass Loop', icon: '⊔' });
      }
    }

    // Slot 1 (1:30): Arrows
    const arrowsSub = [
      { id: 'conn_arrows_none', label: 'None', icon: '—', startArrow: false, endArrow: false, isActive: curArrows === 'none' },
      { id: 'conn_arrows_start', label: 'Start', icon: '←', startArrow: true, endArrow: false, isActive: curArrows === 'start' },
      { id: 'conn_arrows_end', label: 'End', icon: '→', startArrow: false, endArrow: true, isActive: curArrows === 'end' },
      { id: 'conn_arrows_both', label: 'Both', icon: '↔', startArrow: true, endArrow: true, isActive: curArrows === 'both' }
    ];

    // Slot 2 (3:00): Connection Points
    const pointsSub = [
      { id: 'conn_points_auto', label: 'Auto All', icon: '↺' },
      { id: 'conn_points_auto_from', label: 'Auto From', icon: '⇤' },
      { id: 'conn_points_auto_to', label: 'Auto To', icon: '⇥' }
    ];

    // Slot 3 (4:30): Duplicate
    const dupItem = { id: 'action_duplicate', label: 'Duplicate', icon: '❐' };

    // Slot 4 (6:00): Arrange
    const orderSub = [
      { id: 'order_front', label: 'Front', icon: '⇈' },
      { id: 'order_forward', label: 'Forward', icon: '↑' },
      { id: 'order_backward', label: 'Backward', icon: '↓' },
      { id: 'order_back', label: 'Back', icon: '⇊' },
      { id: isLocked ? 'action_unlock' : 'action_lock', label: isLocked ? 'Unlock' : 'Lock', icon: isLocked ? '🔓' : '🔒' }
    ];

    // Slot 5 (7:30): Style & Thickness
    const curStrokeWidth = conn?.strokeWidth !== undefined ? conn.strokeWidth : 2;
    const styleSub = [
      { id: 'style_sketch', label: 'Sketch', icon: '✎', isActive: curRoughness === 'sketch' },
      { id: 'style_clean', label: 'Clean', icon: '◻', isActive: curRoughness === 'clean' },
      { id: 'stroke_solid', label: 'Solid', icon: '—', isActive: curStrokeStyle === 'solid' },
      { id: 'stroke_dashed', label: 'Dashed', icon: '╌', isActive: curStrokeStyle === 'dashed' },
      { id: 'stroke_dotted', label: 'Dotted', icon: '···', isActive: curStrokeStyle === 'dotted' }
    ];

    // Slot 6 (9:00): Ink
    const inkSub = this.themePalette.map((col, idx) => ({ id: `ink_${idx}`, label: col, color: col, isActive: conn?.stroke === col }));

    // Slot 7 (10:30): Delete
    const delItem = { id: 'action_delete', label: 'Delete', icon: '🗑' };

    return [
      { id: 'menu_route', label: 'Route', icon: '↝', subItems: routeSub },
      { id: 'menu_arrows', label: 'Arrows', icon: '↔', subItems: arrowsSub },
      { id: 'menu_conn_points', label: 'Points', icon: '⊕', subItems: pointsSub },
      dupItem,
      { id: 'menu_order', label: 'Arrange', icon: '≡', subItems: orderSub },
      { id: 'menu_style', label: 'Style', icon: '✎', subItems: styleSub, thirdItems: getStrokeWidthItems(curStrokeWidth) },
      { id: 'menu_ink', label: 'Ink', icon: '●', subItems: inkSub },
      delItem
    ];
  }

  getPathItems(pObj, isLocked) {
    const isClosed = Boolean(pObj.closed);
    const curCurve = pObj.curveStyle || 'sharp';
    const curRoughness = pObj.roughness === 0 ? 'clean' : 'sketch';
    const curStrokeStyle = pObj.strokeStyle || 'solid';
    const curOpacity = pObj.opacity !== undefined ? pObj.opacity : 1.0;

    const curveSub = [
      { id: 'path_curve_sharp', label: 'Sharp Lines', icon: '∧', isActive: curCurve === 'sharp' },
      { id: 'path_curve_curved', label: 'Smooth Curve', icon: '~', isActive: curCurve === 'curved' }
    ];
    const curveItem = {
      id: 'menu_path_curve',
      label: curCurve === 'curved' ? 'Curved' : 'Sharp',
      icon: curCurve === 'curved' ? '~' : '∧',
      subItems: curveSub
    };

    let slot0, slot1;
    if (isClosed) {
      // Closed polygon: Slot 0 is Fill, Slot 1 is Curve
      const fillColors = [
        { id: 'fill_none', label: 'None', color: 'none', icon: '⊘', isActive: !pObj.fill || pObj.fill === 'none' },
        ...this.themePalette.map((col, idx) => ({ id: `fill_${idx}`, label: col, color: col, isActive: pObj.fill === col }))
      ];
      const opacityItems = [
        { id: 'opacity_100', label: '100%', value: 1.0, isActive: curOpacity >= 0.9 },
        { id: 'opacity_75', label: '75%', value: 0.75, isActive: curOpacity >= 0.65 && curOpacity < 0.9 },
        { id: 'opacity_50', label: '50%', value: 0.5, isActive: curOpacity >= 0.4 && curOpacity < 0.65 },
        { id: 'opacity_25', label: '25%', value: 0.25, isActive: curOpacity < 0.4 }
      ];
      slot0 = { id: 'menu_fill', label: 'Fill', icon: '▨', subItems: fillColors, thirdItems: opacityItems };
      slot1 = curveItem;
    } else {
      // Open line: Slot 0 is Curve, Slot 1 is Arrows
      const curStart = Boolean(pObj.startArrow);
      const curEnd = Boolean(pObj.endArrow);
      const curArrows = (!curStart && !curEnd) ? 'none' : (curStart && !curEnd ? 'start' : (!curStart && curEnd ? 'end' : 'both'));
      const arrowsSub = [
        { id: 'path_arrows_none', label: 'None', icon: '—', startArrow: false, endArrow: false, isActive: curArrows === 'none' },
        { id: 'path_arrows_start', label: 'Start', icon: '←', startArrow: true, endArrow: false, isActive: curArrows === 'start' },
        { id: 'path_arrows_end', label: 'End', icon: '→', startArrow: false, endArrow: true, isActive: curArrows === 'end' },
        { id: 'path_arrows_both', label: 'Both', icon: '↔', startArrow: true, endArrow: true, isActive: curArrows === 'both' }
      ];
      slot0 = curveItem;
      slot1 = { id: 'menu_arrows', label: 'Arrows', icon: '↔', subItems: arrowsSub };
    }

    // Slot 2 (3:00): Open / Close toggle
    const toggleItem = {
      id: isClosed ? 'path_toggle_open' : 'path_toggle_close',
      label: isClosed ? 'Open Line' : 'Close Shape',
      icon: isClosed ? '—' : '⏢'
    };

    // Slot 3 (4:30): Duplicate
    const dupItem = { id: 'action_duplicate', label: 'Duplicate', icon: '❐' };

    // Slot 4 (6:00): Arrange
    const orderSub = [
      { id: 'order_front', label: 'Front', icon: '⇈' },
      { id: 'order_forward', label: 'Forward', icon: '↑' },
      { id: 'order_backward', label: 'Backward', icon: '↓' },
      { id: 'order_back', label: 'Back', icon: '⇊' },
      { id: isLocked ? 'action_unlock' : 'action_lock', label: isLocked ? 'Unlock' : 'Lock', icon: isLocked ? '🔓' : '🔒' }
    ];

    // Slot 5 (7:30): Style & Thickness
    const curStrokeWidth = pObj?.strokeWidth !== undefined ? pObj.strokeWidth : 2;
    const styleSub = [
      { id: 'style_sketch', label: 'Sketch', icon: '✎', isActive: curRoughness === 'sketch' },
      { id: 'style_clean', label: 'Clean', icon: '◻', isActive: curRoughness === 'clean' },
      { id: 'stroke_solid', label: 'Solid', icon: '—', isActive: curStrokeStyle === 'solid' },
      { id: 'stroke_dashed', label: 'Dashed', icon: '╌', isActive: curStrokeStyle === 'dashed' },
      { id: 'stroke_dotted', label: 'Dotted', icon: '···', isActive: curStrokeStyle === 'dotted' }
    ];

    // Slot 6 (9:00): Ink
    const inkSub = this.themePalette.map((col, idx) => ({ id: `ink_${idx}`, label: col, color: col, isActive: pObj.stroke === col }));

    // Slot 7 (10:30): Delete
    const delItem = { id: 'action_delete', label: 'Delete', icon: '🗑' };

    return [
      slot0,
      slot1,
      toggleItem,
      dupItem,
      { id: 'menu_order', label: 'Arrange', icon: '≡', subItems: orderSub },
      { id: 'menu_style', label: 'Style', icon: '✎', subItems: styleSub, thirdItems: getStrokeWidthItems(curStrokeWidth, pObj) },
      { id: 'menu_ink', label: 'Ink', icon: '●', subItems: inkSub },
      delItem
    ];
  }

  getTextItems(textObj, isLocked) {
    const curFontSize = textObj?.textStyle?.size || 'm';
    const curFontFamily = textObj?.textStyle?.fontFamily || 'hand';
    const curBold = Boolean(textObj?.textStyle?.bold);
    const curOpacity = textObj?.opacity !== undefined ? textObj.opacity : 1.0;
    const curTextColor = textObj?.textStyle?.color || textObj?.stroke || '#1e1e1e';

    // Slot 0 (12:00): Opacity (directly reachable for text, no Fill menu)
    const opacityItems = [
      { id: 'opacity_100', label: '100%', value: 1.0, isActive: curOpacity >= 0.9 },
      { id: 'opacity_75', label: '75%', value: 0.75, isActive: curOpacity >= 0.65 && curOpacity < 0.9 },
      { id: 'opacity_50', label: '50%', value: 0.5, isActive: curOpacity >= 0.4 && curOpacity < 0.65 },
      { id: 'opacity_25', label: '25%', value: 0.25, isActive: curOpacity < 0.4 }
    ];

    // Slot 1 (1:30): Text / Type (Ring 2: Fonts & Formatting, Ring 3: Sizes)
    const fontSub = [
      { id: 'font_hand', label: 'Hand', fontFamily: 'hand', isActive: curFontFamily === 'hand' },
      { id: 'font_sans', label: 'Sans', fontFamily: 'sans', isActive: curFontFamily === 'sans' },
      { id: 'font_serif', label: 'Serif', fontFamily: 'serif', isActive: curFontFamily === 'serif' },
      { id: 'font_mono', label: 'Mono', fontFamily: 'mono', isActive: curFontFamily === 'mono' },
      { id: 'type_bold', label: curBold ? 'Bold ✓' : 'Bold', toggleBold: true, isActive: curBold },
      { id: 'type_align', label: 'Align', cycleAlign: true }
    ];
    const sizeItems = [
      { id: 'type_s', label: 'S', size: 's', isActive: curFontSize === 's' },
      { id: 'type_m', label: 'M', size: 'm', isActive: curFontSize === 'm' },
      { id: 'type_l', label: 'L', size: 'l', isActive: curFontSize === 'l' },
      { id: 'type_xl', label: 'XL', size: 'xl', isActive: curFontSize === 'xl' }
    ];

    // Slot 2 (3:00): Shape Conversion & Quick Connect (NO Equal Sides for text)
    const shapeSub = [
      { id: 'to_rectangle', label: 'Rect', icon: '▭' },
      { id: 'to_ellipse', label: 'Ellipse', icon: '◯' },
      { id: 'to_diamond', label: 'Diamond', icon: '◇' },
      { id: 'to_triangle', label: 'Triangle', icon: '△' }
    ];
    const shapeActions = [
      { id: 'action_connect', label: 'Connect', icon: '➔' }
    ];
    if (textObj?.groupId) {
      shapeActions.push({ id: 'action_select_group', label: 'Select Group', icon: '⧉' });
      shapeActions.push({ id: 'action_ungroup', label: 'Ungroup', icon: '⧉' });
    }

    // Slot 3 (4:30): Duplicate
    const dupItem = { id: 'action_duplicate', label: 'Duplicate', icon: '❐' };

    // Slot 4 (6:00): Arrange (Order & Lock)
    const orderSub = [
      { id: 'order_front', label: 'Front', icon: '⇈' },
      { id: 'order_forward', label: 'Forward', icon: '↑' },
      { id: 'order_backward', label: 'Backward', icon: '↓' },
      { id: 'order_back', label: 'Back', icon: '⇊' },
      { id: isLocked ? 'action_unlock' : 'action_lock', label: isLocked ? 'Unlock' : 'Lock', icon: isLocked ? '🔓' : '🔒' }
    ];

    // Slot 5 (7:30): Style - explicitly disabled for standalone text
    const styleItem = { id: 'menu_style', label: 'Style', icon: '✎', disabled: true };

    // Slot 6 (9:00): Color / Ink
    const inkSub = this.themePalette.map((col, idx) => ({ id: `ink_${idx}`, label: col, color: col, isActive: curTextColor === col }));

    // Slot 7 (10:30): Delete
    const delItem = { id: 'action_delete', label: 'Delete', icon: '🗑' };

    return [
      { id: 'menu_opacity', label: 'Opacity', icon: '◐', subItems: opacityItems },
      { id: 'menu_type', label: 'Type', icon: 'A', subItems: fontSub, thirdItems: sizeItems },
      { id: 'menu_shape', label: 'Shape', icon: '◇', subItems: shapeSub, thirdItems: shapeActions },
      dupItem,
      { id: 'menu_order', label: 'Arrange', icon: '≡', subItems: orderSub },
      styleItem,
      { id: 'menu_ink', label: 'Color', icon: '●', subItems: inkSub },
      delItem
    ];
  }

  getMultiItems(spatialCount, isGrouped, anyUnlocked) {
    // Slot 0 (12:00): Align
    const alignItem = {
      id: 'menu_align',
      label: 'Align',
      icon: '⫿',
      disabled: spatialCount < 2,
      subItems: [
        { id: 'align_left', label: 'Left', icon: '⇤' },
        { id: 'align_center', label: 'Center H', icon: '⫿' },
        { id: 'align_right', label: 'Right', icon: '⇥' },
        { id: 'align_top', label: 'Top', icon: '⤒' },
        { id: 'align_middle', label: 'Middle V', icon: '⁼' },
        { id: 'align_bottom', label: 'Bottom', icon: '⤓' }
      ]
    };

    // Slot 1 (1:30): Distribute
    const distItem = {
      id: 'menu_distribute',
      label: 'Distribute',
      icon: '↔',
      disabled: spatialCount < 3,
      subItems: [
        { id: 'dist_h', label: 'Horizontal', icon: '↔' },
        { id: 'dist_v', label: 'Vertical', icon: '↕' }
      ]
    };

    // Slot 2 (3:00): Group / Ungroup
    const groupItem = isGrouped
      ? { id: 'action_ungroup', label: 'Ungroup', icon: '⧉' }
      : { id: 'action_group', label: 'Group', icon: '⧉' };

    // Slot 3 (4:30): Duplicate
    const dupItem = { id: 'action_duplicate', label: 'Duplicate', icon: '❐' };

    // Slot 4 (6:00): Arrange
    const orderSub = [
      { id: 'order_front', label: 'Front', icon: '⇈' },
      { id: 'order_forward', label: 'Forward', icon: '↑' },
      { id: 'order_backward', label: 'Backward', icon: '↓' },
      { id: 'order_back', label: 'Back', icon: '⇊' },
      { id: anyUnlocked ? 'action_lock' : 'action_unlock', label: anyUnlocked ? 'Lock' : 'Unlock', icon: anyUnlocked ? '🔒' : '🔓' }
    ];

    // Slot 5 (7:30): Style & Thickness
    const firstObj = this.selectedObjects?.[0];
    const curStrokeWidth = firstObj?.strokeWidth !== undefined ? firstObj.strokeWidth : 2;
    const styleSub = [
      { id: 'style_sketch', label: 'Sketch', icon: '✎' },
      { id: 'style_clean', label: 'Clean', icon: '◻' },
      { id: 'stroke_solid', label: 'Solid', icon: '—' },
      { id: 'stroke_dashed', label: 'Dashed', icon: '╌' },
      { id: 'stroke_dotted', label: 'Dotted', icon: '···' }
    ];

    // Slot 6 (9:00): Ink
    const inkSub = this.themePalette.map((col, idx) => ({ id: `ink_${idx}`, label: col, color: col }));

    // Slot 7 (10:30): Delete
    const delItem = { id: 'action_delete', label: 'Delete', icon: '🗑' };

    return [
      alignItem,
      distItem,
      groupItem,
      dupItem,
      { id: 'menu_order', label: 'Arrange', icon: '≡', subItems: orderSub },
      { id: 'menu_style', label: 'Style', icon: '✎', subItems: styleSub, thirdItems: getStrokeWidthItems(curStrokeWidth) },
      { id: 'menu_ink', label: 'Ink', icon: '●', subItems: inkSub },
      delItem
    ];
  }

  getItems() {
    if (this.context === 'canvas') {
      return this.getCanvasItems();
    }

    const isLocked = Boolean(this.selectedObject?.locked);
    const isMulti = this.selectedCount > 1;

    if (isMulti) {
      const spatialObjects = this.selectedObjects.filter(o => o && o.type !== 'connector' && !o.locked);
      const isGrouped = Boolean(this.selectedObject?.groupId) || this.selectedObjects.some(o => o?.groupId);
      const anyUnlocked = this.selectedObjects.length > 0 ? this.selectedObjects.some(o => !o.locked) : true;
      return this.getMultiItems(spatialObjects.length, isGrouped, anyUnlocked);
    }

    if (this.selectedObject?.type === 'path') {
      return this.getPathItems(this.selectedObject, isLocked);
    }

    if (this.selectedObject?.type === 'connector') {
      return this.getConnectorItems(this.selectedObject, isLocked);
    }

    if (this.selectedObject?.type === 'text') {
      return this.getTextItems(this.selectedObject, isLocked);
    }

    return this.getShapeItems(this.selectedObject, isLocked);
  }

  handleItemClick(item) {
    if (item.disabled) return;
    if (item.subItems && item.subItems.length > 0) {
      this.activeSubMenu = this.activeSubMenu === item.id ? null : item.id;
      this.render();
      return;
    }
    this.onAction(item.id, item);
    this.close();
  }

  render() {
    const items = this.getItems();
    const count = items.length;
    const rInner = 38;
    const rOuter = 112;
    const rSubOuter = 172;
    const rThirdOuter = 216;

    let svgParts = [];
    const size = (rThirdOuter + 20) * 2;
    const center = size / 2;

    svgParts.push(`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="sabura-wheel-svg">`);

    const prng = createPRNG(4242);

    // Bezel guide outer rims: hand-drawn sketchy compass circles
    const rimSketch = sketchEllipse(center, center, rOuter + 2, rOuter + 2, prng, 1);
    svgParts.push(`<path d="${rimSketch}" class="wheel-bezel-rim" pointer-events="none" />`);

    if (this.activeSubMenu) {
      const subRimSketch = sketchEllipse(center, center, rSubOuter + 2, rSubOuter + 2, prng, 1);
      svgParts.push(`<path d="${subRimSketch}" class="wheel-bezel-rim sub" pointer-events="none" />`);
    }

    // Center hub: underlying clickable disc
    svgParts.push(`<circle cx="${center}" cy="${center}" r="${rInner - 3}" class="wheel-hub" tabindex="0" role="button" aria-label="Close Wheel" />`);
    // Sketchy hand-drawn circle for center hub
    const hubSketch = sketchEllipse(center, center, rInner - 3, rInner - 3, prng, 1);
    svgParts.push(`<path d="${hubSketch}" class="wheel-hub-sketch" pointer-events="none" />`);
    // Close icon: sketchy X strokes
    const x1 = sketchLine(center - 5, center - 5, center + 5, center + 5, prng, 1);
    const x2 = sketchLine(center + 5, center - 5, center - 5, center + 5, prng, 1);
    svgParts.push(`<path d="${x1} ${x2}" class="wheel-hub-x" pointer-events="none" />`);

    const angleStep = (Math.PI * 2) / count;
    // Offset slightly so top slice is centered vertically
    const angleOffset = -Math.PI / 2 - angleStep / 2;

    let subMenuToRender = null;
    let thirdMenuToRender = null;
    let subMenuStartAngle = 0;
    let subMenuEndAngle = 0;

    for (let i = 0; i < count; i++) {
      const item = items[i];
      const startAngle = angleOffset + i * angleStep;
      const endAngle = startAngle + angleStep;
      const midAngle = (startAngle + endAngle) / 2;

      const isDisabled = Boolean(item.disabled);
      const pathD = createWedgePath(center, center, rInner, rOuter, startAngle, endAngle);
      const isSubActive = this.activeSubMenu === item.id;
      const wedgeClass = `wheel-wedge ${isSubActive ? 'active' : ''} ${item.id.includes('delete') ? 'danger' : ''} ${isDisabled ? 'disabled' : ''}`;

      // Solid wedge fill layer with keyboard accessibility
      svgParts.push(`<path d="${pathD}" class="${wedgeClass}" data-item-id="${item.id}" ${isDisabled ? 'aria-disabled="true"' : 'tabindex="0" role="button"'} aria-label="${item.label}" />`);

      // Excalidraw hand-drawn sketchy wedge outline
      const sketchD = sketchWedge(center, center, rInner, rOuter, startAngle, endAngle, prng, 1);
      svgParts.push(`<path d="${sketchD}" class="wheel-wedge-sketch ${isSubActive ? 'active' : ''} ${isDisabled ? 'disabled' : ''}" pointer-events="none" />`);

      // Label & Icon with 19px vertical baseline separation
      const textR = (rInner + rOuter) / 2;
      const iconX = center + textR * Math.cos(midAngle);
      const iconY = center + textR * Math.sin(midAngle) - 7;
      const labelX = center + textR * Math.cos(midAngle);
      const labelY = center + textR * Math.sin(midAngle) + 12;

      svgParts.push(`<g class="wheel-label-group ${isDisabled ? 'disabled' : ''}" pointer-events="none">
        <text x="${iconX}" y="${iconY}" text-anchor="middle" class="wheel-icon">${item.icon || ''}</text>
        <text x="${labelX}" y="${labelY}" text-anchor="middle" class="wheel-text">${item.label}</text>
      </g>`);

      if (isSubActive && item.subItems && !isDisabled) {
        subMenuToRender = item.subItems;
        thirdMenuToRender = item.thirdItems || null;
        subMenuStartAngle = startAngle - 0.2;
        subMenuEndAngle = endAngle + 0.2;
      }
    }

    // Render outer sub-menu ring if an item with subItems is active
    if (subMenuToRender && subMenuToRender.length > 0) {
      const subCount = subMenuToRender.length;
      const spanPerItem = 0.28;
      const totalSpan = Math.min(Math.PI * 1.15, Math.max(0.5, subCount * spanPerItem));
      const midParent = (subMenuStartAngle + subMenuEndAngle) / 2;
      const subStartBase = midParent - totalSpan / 2;
      const subStep = totalSpan / subCount;

      for (let j = 0; j < subCount; j++) {
        const sub = subMenuToRender[j];
        const sStart = subStartBase + j * subStep;
        const sEnd = sStart + subStep;
        const sMid = (sStart + sEnd) / 2;

        const subPath = createWedgePath(center, center, rOuter + 4, rSubOuter, sStart, sEnd);
        const colorStyle = (sub.color && sub.color !== 'none') ? `fill: ${sub.color}; stroke: #dee2e6;` : '';
        const isSubActive = Boolean(sub.isActive);

        svgParts.push(`<path d="${subPath}" class="wheel-sub-wedge ${isSubActive ? 'active-choice' : ''}" data-sub-id="${sub.id}" tabindex="0" role="button" aria-label="${sub.label}" style="${colorStyle}" />`);
        const subSketchD = sketchWedge(center, center, rOuter + 4, rSubOuter, sStart, sEnd, prng, 1);
        svgParts.push(`<path d="${subSketchD}" class="wheel-wedge-sketch ${isSubActive ? 'active' : ''}" pointer-events="none" />`);

        const sTextR = (rOuter + 4 + rSubOuter) / 2;
        const sX = center + sTextR * Math.cos(sMid);
        const sY = center + sTextR * Math.sin(sMid);

        if (sub.color && sub.color !== 'none') {
          // Pure color chip: no #hex text. If active, render contrast checkmark
          if (isSubActive) {
            const checkFill = isDarkColor(sub.color) ? '#ffffff' : '#1e1e1e';
            svgParts.push(`<g class="wheel-label-group" pointer-events="none">
              <text x="${sX}" y="${sY + 5}" text-anchor="middle" class="wheel-color-check" style="fill: ${checkFill}; font-size: 15px; font-weight: bold;">✓</text>
            </g>`);
          }
        } else {
          // Standard tool / text wedge
          svgParts.push(`<g class="wheel-label-group" pointer-events="none">
            <text x="${sX}" y="${sY - 6}" text-anchor="middle" class="wheel-icon">${sub.icon || ''}</text>
            <text x="${sX}" y="${sY + 11}" text-anchor="middle" class="wheel-sub-text">${sub.label}${isSubActive ? ' ✓' : ''}</text>
          </g>`);
        }
      }

      // Render Ring 3 (outer 3rd circle / crescent) if thirdItems exist (e.g. Opacity in Fill)
      if (thirdMenuToRender && thirdMenuToRender.length > 0) {
        const thirdRimSketch = sketchEllipse(center, center, rThirdOuter + 2, rThirdOuter + 2, prng, 1);
        svgParts.push(`<path d="${thirdRimSketch}" class="wheel-bezel-rim sub" pointer-events="none" />`);

        const thirdCount = thirdMenuToRender.length;
        const spanPerThird = thirdCount <= 3 ? 0.42 : 0.28;
        const totalThirdSpan = Math.max(0.7, thirdCount * spanPerThird);
        const thirdStartBase = midParent - totalThirdSpan / 2;
        const thirdStep = totalThirdSpan / thirdCount;

        for (let k = 0; k < thirdCount; k++) {
          const third = thirdMenuToRender[k];
          const tStart = thirdStartBase + k * thirdStep;
          const tEnd = tStart + thirdStep;
          const tMid = (tStart + tEnd) / 2;

          const tPath = createWedgePath(center, center, rSubOuter + 4, rThirdOuter, tStart, tEnd);
          const isThirdActive = Boolean(third.isActive);

          svgParts.push(`<path d="${tPath}" class="wheel-sub-wedge wheel-third-wedge ${isThirdActive ? 'active-choice' : ''}" data-sub-id="${third.id}" tabindex="0" role="button" aria-label="${third.label}" />`);
          const tSketchD = sketchWedge(center, center, rSubOuter + 4, rThirdOuter, tStart, tEnd, prng, 1);
          svgParts.push(`<path d="${tSketchD}" class="wheel-wedge-sketch ${isThirdActive ? 'active' : ''}" pointer-events="none" />`);

          const tTextR = (rSubOuter + 4 + rThirdOuter) / 2;
          const tX = center + tTextR * Math.cos(tMid);
          const tY = center + tTextR * Math.sin(tMid);

          if (third.icon) {
            svgParts.push(`<g class="wheel-label-group" pointer-events="none">
              <text x="${tX}" y="${tY - 2}" text-anchor="middle" class="wheel-sub-icon">${third.icon}</text>
              <text x="${tX}" y="${tY + 12}" text-anchor="middle" class="wheel-sub-text" style="font-weight: 700;">${third.label}${isThirdActive ? ' ✓' : ''}</text>
            </g>`);
          } else {
            svgParts.push(`<g class="wheel-label-group" pointer-events="none">
              <text x="${tX}" y="${tY + 4}" text-anchor="middle" class="wheel-sub-text" style="font-weight: 700;">${third.label}${isThirdActive ? ' ✓' : ''}</text>
            </g>`);
          }
        }
      }
    }

    svgParts.push('</svg>');
    this.wheelEl.innerHTML = svgParts.join('\n');

    // Attach click and keyboard listeners to wedges
    const allWedges = this.wheelEl.querySelectorAll('.wheel-wedge');
    allWedges.forEach(w => {
      const id = w.getAttribute('data-item-id');
      const item = items.find(it => it.id === id);
      if (!item || item.disabled) return;

      // Mouseenter triggers sub-ring naturally
      w.addEventListener('mouseenter', () => {
        if (item.subItems && item.subItems.length > 0 && this.activeSubMenu !== item.id) {
          this.activeSubMenu = item.id;
          this.render();
        }
      });

      const activate = (e) => {
        e.stopPropagation();
        this.handleItemClick(item);
      };

      w.addEventListener('click', activate);
      w.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate(e);
        }
      });
    });

    const subWedges = this.wheelEl.querySelectorAll('.wheel-sub-wedge');
    subWedges.forEach(sw => {
      const subId = sw.getAttribute('data-sub-id');
      const subItem = (subMenuToRender || []).find(s => s.id === subId) || (thirdMenuToRender || []).find(s => s.id === subId);
      if (!subItem) return;

      const activateSub = (e) => {
        e.stopPropagation();
        this.onAction(subItem.id, subItem);
        this.close();
      };

      sw.addEventListener('click', activateSub);
      sw.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activateSub(e);
        }
      });
    });

    const hub = this.wheelEl.querySelector('.wheel-hub');
    if (hub) {
      const closeHub = (e) => {
        e.stopPropagation();
        this.close();
      };
      hub.addEventListener('click', closeHub);
      hub.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          closeHub(e);
        }
      });
    }
  }
}
