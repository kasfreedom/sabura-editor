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

    // Clamp wheel position within viewport
    const pad = 160; // Max radius with outer ring
    const clampedX = Math.max(pad, Math.min(window.innerWidth - pad, x));
    const clampedY = Math.max(pad, Math.min(window.innerHeight - pad, y));
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

  getItems() {
    if (this.context === 'canvas') {
      return [
        { id: 'tool_select', label: 'Select', icon: '↖' },
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
        },
        { id: 'tool_text', label: 'Text', icon: 'T' },
        {
          id: 'connector',
          label: 'Connect',
          icon: '➔',
          subItems: [
            { id: 'conn_straight', label: 'Straight', icon: '—' },
            { id: 'conn_elbow', label: 'Elbow', icon: '⌐' },
            { id: 'conn_curved', label: 'Curved', icon: '~' }
          ]
        },
        { id: 'tool_draw', label: 'Draw', icon: '✎' },
        { id: 'tool_hand', label: 'Hand/Pan', icon: '✋' },
        { id: 'action_undo', label: 'Undo', icon: '↶' },
        { id: 'action_redo', label: 'Redo', icon: '↷' }
      ];
    }

    // Selected object context
    const isLocked = this.selectedObject?.locked;
    const isGrouped = Boolean(this.selectedObject?.groupId) || this.selectedObjects.some(o => o.groupId);
    const isConnector = this.selectedObject?.type === 'connector';
    const isMulti = this.selectedCount > 1;

    const items = [];

    const spatialObjects = this.selectedObjects.filter(o => o && o.type !== 'connector' && !o.locked);
    const spatialCount = spatialObjects.length;

    // Context: Multiple objects
    if (isMulti) {
      // 1. Grouping
      if (isGrouped) {
        items.push({ id: 'action_ungroup', label: 'Ungroup', icon: '⧉' });
      }
      if (this.selectedCount >= 2) {
        items.push({ id: 'action_group', label: 'Group', icon: '⧉' });
      }

      // 2. Alignment (requires at least 2 eligible spatial objects)
      if (spatialCount >= 2) {
        items.push({
          id: 'menu_align',
          label: 'Align',
          icon: '⫿',
          subItems: [
            { id: 'align_left', label: 'Left', icon: '⇤' },
            { id: 'align_center', label: 'Center H', icon: '⫿' },
            { id: 'align_right', label: 'Right', icon: '⇥' },
            { id: 'align_top', label: 'Top', icon: '⤒' },
            { id: 'align_middle', label: 'Middle V', icon: '⁼' },
            { id: 'align_bottom', label: 'Bottom', icon: '⤓' }
          ]
        });
      }

      // 3. Distribution (requires at least 3 eligible spatial objects)
      if (spatialCount >= 3) {
        items.push({
          id: 'menu_distribute',
          label: 'Distribute',
          icon: '↔',
          subItems: [
            { id: 'dist_h', label: 'Horizontal', icon: '↔' },
            { id: 'dist_v', label: 'Vertical', icon: '↕' }
          ]
        });
      }

      // 3. Stacking / Ordering
      items.push({
        id: 'menu_order',
        label: 'Arrange',
        icon: '≡',
        subItems: [
          { id: 'order_front', label: 'Front', icon: '⇈' },
          { id: 'order_forward', label: 'Forward', icon: '↑' },
          { id: 'order_backward', label: 'Backward', icon: '↓' },
          { id: 'order_back', label: 'Back', icon: '⇊' }
        ]
      });

      // 4. Actions: Duplicate, Lock / Unlock, Delete
      items.push({ id: 'action_duplicate', label: 'Duplicate', icon: '❐' });
      const anyUnlocked = this.selectedObjects.length > 0 ? this.selectedObjects.some(o => !o.locked) : true;
      items.push({
        id: anyUnlocked ? 'action_lock' : 'action_unlock',
        label: anyUnlocked ? 'Lock' : 'Unlock',
        icon: anyUnlocked ? '🔒' : '🔓'
      });
      items.push({ id: 'action_delete', label: 'Delete', icon: '🗑' });

      // 5. Shared styling
      const fillSub = [
        { id: 'fill_none', label: 'None', color: 'none', icon: '⊘' },
        ...this.themePalette.map((col, idx) => ({ id: `fill_${idx}`, label: col, color: col }))
      ];
      items.push({ id: 'menu_fill', label: 'Fill', icon: '▨', subItems: fillSub });

      const inkSub = this.themePalette.map((col, idx) => ({ id: `ink_${idx}`, label: col, color: col }));
      items.push({ id: 'menu_ink', label: 'Ink', icon: '●', subItems: inkSub });

      items.push({
        id: 'menu_opacity',
        label: 'Opacity',
        icon: '◐',
        subItems: [
          { id: 'opacity_100', label: '100%', value: 1.0 },
          { id: 'opacity_75', label: '75%', value: 0.75 },
          { id: 'opacity_50', label: '50%', value: 0.5 },
          { id: 'opacity_25', label: '25%', value: 0.25 }
        ]
      });

      items.push({
        id: 'menu_style',
        label: 'Style',
        icon: '✎',
        subItems: [
          { id: 'style_sketch', label: 'Sketch', icon: '✎' },
          { id: 'style_clean', label: 'Clean', icon: '◻' },
          { id: 'stroke_solid', label: 'Solid', icon: '—' },
          { id: 'stroke_dashed', label: 'Dashed', icon: '╌' },
          { id: 'stroke_dotted', label: 'Dotted', icon: '···' }
        ]
      });

      return items;
    }

    // Context: Connector
    if (isConnector) {
      const conn = this.selectedObject;
      const curRouting = conn?.routing || 'straight';
      const curStart = Boolean(conn?.startArrow);
      const curEnd = Boolean(conn?.endArrow);
      const curArrows = (!curStart && !curEnd) ? 'none' : (curStart && !curEnd ? 'start' : (!curStart && curEnd ? 'end' : 'both'));
      const curRoughness = conn?.roughness === 0 ? 'clean' : 'sketch';
      const curStrokeStyle = conn?.strokeStyle || 'solid';

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

      // 1. Route
      items.push({
        id: 'menu_route',
        label: 'Route',
        icon: '↝',
        subItems: routeSub
      });

      // 2. Arrow ends
      items.push({
        id: 'menu_arrows',
        label: 'Arrows',
        icon: '↔',
        subItems: [
          { id: 'conn_arrows_none', label: 'None', icon: '—', startArrow: false, endArrow: false, isActive: curArrows === 'none' },
          { id: 'conn_arrows_start', label: 'Start', icon: '←', startArrow: true, endArrow: false, isActive: curArrows === 'start' },
          { id: 'conn_arrows_end', label: 'End', icon: '→', startArrow: false, endArrow: true, isActive: curArrows === 'end' },
          { id: 'conn_arrows_both', label: 'Both', icon: '↔', startArrow: true, endArrow: true, isActive: curArrows === 'both' }
        ]
      });

      // 3. Style
      items.push({
        id: 'menu_style',
        label: 'Style',
        icon: '✎',
        subItems: [
          { id: 'style_sketch', label: 'Sketch', icon: '✎', isActive: curRoughness === 'sketch' },
          { id: 'style_clean', label: 'Clean', icon: '◻', isActive: curRoughness === 'clean' },
          { id: 'stroke_solid', label: 'Solid', icon: '—', isActive: curStrokeStyle === 'solid' },
          { id: 'stroke_dashed', label: 'Dashed', icon: '╌', isActive: curStrokeStyle === 'dashed' },
          { id: 'stroke_dotted', label: 'Dotted', icon: '···', isActive: curStrokeStyle === 'dotted' }
        ]
      });

      // 4. Stacking / Order
      items.push({
        id: 'menu_order',
        label: 'Stacking',
        icon: '≡',
        subItems: [
          { id: 'order_front', label: 'Front', icon: '⇈' },
          { id: 'order_forward', label: 'Forward', icon: '↑' },
          { id: 'order_backward', label: 'Backward', icon: '↓' },
          { id: 'order_back', label: 'Back', icon: '⇊' }
        ]
      });

      // 5. Connection Points / Auto
      items.push({
        id: 'menu_conn_points',
        label: 'Points',
        icon: '⊕',
        subItems: [
          { id: 'conn_points_auto', label: 'Auto All', icon: '↺' },
          { id: 'conn_points_auto_from', label: 'Auto From', icon: '⇤' },
          { id: 'conn_points_auto_to', label: 'Auto To', icon: '⇥' }
        ]
      });

      // 6. Ink & Opacity
      const inkSub = this.themePalette.map((col, idx) => ({ id: `ink_${idx}`, label: col, color: col, isActive: conn?.stroke === col }));
      items.push({ id: 'menu_ink', label: 'Ink', icon: '●', subItems: inkSub });

      items.push({ id: 'action_duplicate', label: 'Duplicate', icon: '❐' });
      items.push({ id: 'action_delete', label: 'Delete', icon: '🗑' });
      return items;
    }

    // Context: Single Shape
    const shape = this.selectedObject;
    const curShapeType = shape?.type || 'rectangle';
    const curRoughness = shape?.roughness === 0 ? 'clean' : 'sketch';
    const curStrokeStyle = shape?.strokeStyle || 'solid';
    const curFontSize = shape?.textStyle?.size || 'm';
    const curFontFamily = shape?.textStyle?.fontFamily || 'hand';
    const curBold = Boolean(shape?.textStyle?.bold);
    const curOpacity = shape?.opacity !== undefined ? shape.opacity : 1.0;

    const fillSub = [
      { id: 'fill_none', label: 'None', color: 'none', icon: '⊘', isActive: !shape?.fill || shape?.fill === 'none' },
      ...this.themePalette.map((col, idx) => ({ id: `fill_${idx}`, label: col, color: col, isActive: shape?.fill === col }))
    ];
    items.push({ id: 'menu_fill', label: 'Fill', icon: '▨', subItems: fillSub });

    const inkSub = this.themePalette.map((col, idx) => ({ id: `ink_${idx}`, label: col, color: col, isActive: shape?.stroke === col }));
    items.push({ id: 'menu_ink', label: 'Ink', icon: '●', subItems: inkSub });

    items.push({
      id: 'menu_opacity',
      label: 'Opacity',
      icon: '◐',
      subItems: [
        { id: 'opacity_100', label: '100%', value: 1.0, isActive: curOpacity >= 0.9 },
        { id: 'opacity_75', label: '75%', value: 0.75, isActive: curOpacity >= 0.65 && curOpacity < 0.9 },
        { id: 'opacity_50', label: '50%', value: 0.5, isActive: curOpacity >= 0.4 && curOpacity < 0.65 },
        { id: 'opacity_25', label: '25%', value: 0.25, isActive: curOpacity < 0.4 }
      ]
    });

    items.push({
      id: 'menu_type',
      label: 'Type',
      icon: 'A',
      subItems: [
        { id: 'type_s', label: 'S', size: 's', isActive: curFontSize === 's' },
        { id: 'type_m', label: 'M', size: 'm', isActive: curFontSize === 'm' },
        { id: 'type_l', label: 'L', size: 'l', isActive: curFontSize === 'l' },
        { id: 'type_xl', label: 'XL', size: 'xl', isActive: curFontSize === 'xl' },
        { id: 'font_hand', label: 'Hand', fontFamily: 'hand', isActive: curFontFamily === 'hand' },
        { id: 'font_sans', label: 'Sans', fontFamily: 'sans', isActive: curFontFamily === 'sans' },
        { id: 'font_serif', label: 'Serif', fontFamily: 'serif', isActive: curFontFamily === 'serif' },
        { id: 'font_mono', label: 'Mono', fontFamily: 'mono', isActive: curFontFamily === 'mono' },
        { id: 'type_bold', label: curBold ? 'Bold ✓' : 'Bold', toggleBold: true, isActive: curBold },
        { id: 'type_align', label: 'Align', cycleAlign: true }
      ]
    });

    items.push({
      id: 'menu_shape',
      label: 'Shape',
      icon: '◇',
      subItems: [
        { id: 'to_rectangle', label: 'Rectangle', icon: '▭', isActive: curShapeType === 'rectangle' },
        { id: 'to_ellipse', label: 'Ellipse', icon: '◯', isActive: curShapeType === 'ellipse' },
        { id: 'to_diamond', label: 'Diamond', icon: '◇', isActive: curShapeType === 'diamond' },
        { id: 'to_triangle', label: 'Triangle', icon: '△', isActive: curShapeType === 'triangle' },
        { id: 'to_equal_sides', label: 'Equal sides', icon: '⊞' }
      ]
    });

    items.push({
      id: 'menu_style',
      label: 'Style',
      icon: '✎',
      subItems: [
        { id: 'style_sketch', label: 'Sketch', icon: '✎', isActive: curRoughness === 'sketch' },
        { id: 'style_clean', label: 'Clean', icon: '◻', isActive: curRoughness === 'clean' },
        { id: 'stroke_solid', label: 'Solid', icon: '—', isActive: curStrokeStyle === 'solid' },
        { id: 'stroke_dashed', label: 'Dashed', icon: '╌', isActive: curStrokeStyle === 'dashed' },
        { id: 'stroke_dotted', label: 'Dotted', icon: '···', isActive: curStrokeStyle === 'dotted' }
      ]
    });

    items.push({
      id: 'menu_order',
      label: 'Order',
      icon: '≡',
      subItems: [
        { id: 'order_front', label: 'Front', icon: '⇈' },
        { id: 'order_forward', label: 'Forward', icon: '↑' },
        { id: 'order_backward', label: 'Backward', icon: '↓' },
        { id: 'order_back', label: 'Back', icon: '⇊' }
      ]
    });

    items.push({ id: 'action_connect', label: 'Connect', icon: '➔' });
    items.push({ id: 'action_duplicate', label: 'Duplicate', icon: '❐' });
    items.push({
      id: isLocked ? 'action_unlock' : 'action_lock',
      label: isLocked ? 'Unlock' : 'Lock',
      icon: isLocked ? '🔓' : '🔒'
    });
    items.push({ id: 'action_delete', label: 'Delete', icon: '🗑' });

    if (shape?.groupId) {
      items.push({ id: 'action_select_group', label: 'Select Group', icon: '⧉' });
      items.push({ id: 'action_ungroup', label: 'Ungroup', icon: '⧉' });
    }

    return items;
  }

  handleItemClick(item) {
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
    const rInner = 36;
    const rOuter = 100;
    const rSubOuter = 160;

    let svgParts = [];
    const size = (rSubOuter + 10) * 2;
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
    let subMenuStartAngle = 0;
    let subMenuEndAngle = 0;

    for (let i = 0; i < count; i++) {
      const item = items[i];
      const startAngle = angleOffset + i * angleStep;
      const endAngle = startAngle + angleStep;
      const midAngle = (startAngle + endAngle) / 2;

      const pathD = createWedgePath(center, center, rInner, rOuter, startAngle, endAngle);
      const isSubActive = this.activeSubMenu === item.id;
      const wedgeClass = `wheel-wedge ${isSubActive ? 'active' : ''} ${item.id.includes('delete') ? 'danger' : ''}`;

      // Solid wedge fill layer with keyboard accessibility
      svgParts.push(`<path d="${pathD}" class="${wedgeClass}" data-item-id="${item.id}" tabindex="0" role="button" aria-label="${item.label}" />`);

      // Excalidraw hand-drawn sketchy wedge outline
      const sketchD = sketchWedge(center, center, rInner, rOuter, startAngle, endAngle, prng, 1);
      svgParts.push(`<path d="${sketchD}" class="wheel-wedge-sketch ${isSubActive ? 'active' : ''}" pointer-events="none" />`);

      // Label & Icon
      const textR = (rInner + rOuter) / 2;
      const iconX = center + textR * Math.cos(midAngle);
      const iconY = center + textR * Math.sin(midAngle);

      svgParts.push(`<g class="wheel-label-group" pointer-events="none">
        <text x="${iconX}" y="${iconY - 2}" text-anchor="middle" class="wheel-icon">${item.icon || ''}</text>
        <text x="${iconX}" y="${iconY + 11}" text-anchor="middle" class="wheel-text">${item.label}</text>
      </g>`);

      if (isSubActive && item.subItems) {
        subMenuToRender = item.subItems;
        subMenuStartAngle = startAngle - 0.2;
        subMenuEndAngle = endAngle + 0.2;
      }
    }

    // Render outer sub-menu ring if an item with subItems is active
    if (subMenuToRender && subMenuToRender.length > 0) {
      const subCount = subMenuToRender.length;
      const spanPerItem = 0.28;
      const totalSpan = Math.min(Math.PI * 1.15, Math.max(0.45, subCount * spanPerItem));
      const midParent = (subMenuStartAngle + subMenuEndAngle) / 2;
      const subStartBase = midParent - totalSpan / 2;
      const subStep = totalSpan / subCount;

      for (let j = 0; j < subCount; j++) {
        const sub = subMenuToRender[j];
        const sStart = subStartBase + j * subStep;
        const sEnd = sStart + subStep;
        const sMid = (sStart + sEnd) / 2;

        const subPath = createWedgePath(center, center, rOuter + 4, rSubOuter, sStart, sEnd);
        const colorStyle = sub.color ? `fill: ${sub.color}; stroke: #dee2e6;` : '';
        const isSubActive = Boolean(sub.isActive);

        svgParts.push(`<path d="${subPath}" class="wheel-sub-wedge ${isSubActive ? 'active-choice' : ''}" data-sub-id="${sub.id}" tabindex="0" role="button" aria-label="${sub.label}" style="${colorStyle}" />`);
        const subSketchD = sketchWedge(center, center, rOuter + 4, rSubOuter, sStart, sEnd, prng, 1);
        svgParts.push(`<path d="${subSketchD}" class="wheel-wedge-sketch ${isSubActive ? 'active' : ''}" pointer-events="none" />`);

        const sTextR = (rOuter + 4 + rSubOuter) / 2;
        const sX = center + sTextR * Math.cos(sMid);
        const sY = center + sTextR * Math.sin(sMid);

        svgParts.push(`<g class="wheel-label-group" pointer-events="none">
          <text x="${sX}" y="${sY - 2}" text-anchor="middle" class="wheel-icon">${sub.icon || ''}</text>
          <text x="${sX}" y="${sY + 10}" text-anchor="middle" class="wheel-sub-text">${sub.label}${isSubActive ? ' ✓' : ''}</text>
        </g>`);
      }
    }

    svgParts.push('</svg>');
    this.wheelEl.innerHTML = svgParts.join('\n');

    // Attach click and keyboard listeners to wedges
    const allWedges = this.wheelEl.querySelectorAll('.wheel-wedge');
    allWedges.forEach(w => {
      const id = w.getAttribute('data-item-id');
      const item = items.find(it => it.id === id);
      if (!item) return;

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
      const subItem = subMenuToRender?.find(s => s.id === subId);
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
