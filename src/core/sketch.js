/**
 * Sabura Deterministic Sketch Generator.
 * 
 * Uses a seedable Mulberry32 PRNG to generate reproducible hand-drawn SVG paths
 * for shapes and connectors. Never produces random jitter across renders.
 */

/**
 * Creates a fast, seedable 32-bit PRNG (Mulberry32).
 * @param {number} seed 
 * @returns {() => number} Returns float in [0, 1)
 */
export function createPRNG(seed) {
  let s = Math.floor(Math.abs(seed)) || 1;
  return function next() {
    s |= 0;
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates a random number in range [min, max] using provided PRNG.
 */
function randomRange(prng, min, max) {
  return min + prng() * (max - min);
}

/**
 * Produces a sketchy, hand-drawn straight or slightly bowed line between two points.
 * Generates two overlapping, slightly offset passes for sketch feel.
 * 
 * @param {number} x1 
 * @param {number} y1 
 * @param {number} x2 
 * @param {number} y2 
 * @param {() => number} prng 
 * @param {number} roughness 
 * @returns {string} SVG path segment string
 */
export function sketchLine(x1, y1, x2, y2, prng, roughness = 1) {
  if (roughness <= 0) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length < 1e-4) return `M ${x1} ${y1}`;

  const roughnessScale = Math.min(2.5, Math.max(0.4, length / 100)) * roughness;
  const overshoot = Math.min(6, length * 0.04) * roughness;

  // Unit vector and normal
  const dx = (x2 - x1) / length;
  const dy = (y2 - y1) / length;
  const nx = -dy;
  const ny = dx;

  function generatePass(passIndex) {
    const dir = passIndex === 0 ? 1 : -1;
    const startOffset = randomRange(prng, -overshoot * 0.8, overshoot);
    const endOffset = randomRange(prng, -overshoot * 0.8, overshoot);

    const sx = x1 - dx * startOffset + nx * randomRange(prng, -roughnessScale * 0.7, roughnessScale * 0.7);
    const sy = y1 - dy * startOffset + ny * randomRange(prng, -roughnessScale * 0.7, roughnessScale * 0.7);

    const ex = x2 + dx * endOffset + nx * randomRange(prng, -roughnessScale * 0.7, roughnessScale * 0.7);
    const ey = y2 + dy * endOffset + ny * randomRange(prng, -roughnessScale * 0.7, roughnessScale * 0.7);

    // Midpoint bow with organic curvature
    const midBow = (randomRange(prng, 0.2, 1.2) * dir) * roughnessScale;
    const mx = (sx + ex) / 2 + nx * midBow;
    const my = (sy + ey) / 2 + ny * midBow;

    return `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  }

  // Pass 1 and Pass 2 with complementary organic curvature
  const p1 = generatePass(0);
  const p2 = generatePass(1);
  return `${p1} ${p2}`;
}

/**
 * Generates sketchy SVG path for a polygon given its vertices.
 * 
 * @param {Array<[number, number]>} vertices 
 * @param {() => number} prng 
 * @param {number} roughness 
 * @param {boolean} closePath 
 * @returns {string}
 */
export function sketchPolygon(vertices, prng, roughness = 1, closePath = true) {
  if (!vertices || vertices.length < 2) return '';
  if (roughness <= 0) {
    let path = `M ${vertices[0][0]} ${vertices[0][1]}`;
    for (let i = 1; i < vertices.length; i++) {
      path += ` L ${vertices[i][0]} ${vertices[i][1]}`;
    }
    if (closePath) path += ' Z';
    return path;
  }

  let paths = [];
  const n = vertices.length;
  const count = closePath ? n : n - 1;

  for (let i = 0; i < count; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % n];
    paths.push(sketchLine(v1[0], v1[1], v2[0], v2[1], prng, roughness));
  }

  return paths.join(' ');
}

/**
 * Generates sketchy SVG path for an ellipse.
 * Uses two slightly offset 4-point cubic bezier loops.
 * 
 * @param {number} cx 
 * @param {number} cy 
 * @param {number} rx 
 * @param {number} ry 
 * @param {() => number} prng 
 * @param {number} roughness 
 * @returns {string}
 */
export function sketchEllipse(cx, cy, rx, ry, prng, roughness = 1) {
  if (roughness <= 0) {
    return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
  }

  const k = 0.5522847498; // Cubic bezier constant for circular arcs
  const paths = [];

  for (let pass = 0; pass < 2; pass++) {
    const wobble = Math.min(3, Math.max(0.5, (rx + ry) / 100)) * roughness;
    const wrx = rx + randomRange(prng, -wobble, wobble);
    const wry = ry + randomRange(prng, -wobble, wobble);
    const wcx = cx + randomRange(prng, -wobble * 0.5, wobble * 0.5);
    const wcy = cy + randomRange(prng, -wobble * 0.5, wobble * 0.5);

    const ox = wrx * k;
    const oy = wry * k;

    // 4 cardinal points with slight wobble
    const pTop = [wcx, wcy - wry];
    const pRight = [wcx + wrx, wcy];
    const pBottom = [wcx, wcy + wry];
    const pLeft = [wcx - wrx, wcy];

    const d = [
      `M ${pTop[0].toFixed(1)} ${pTop[1].toFixed(1)}`,
      `C ${(wcx + ox).toFixed(1)} ${pTop[1].toFixed(1)}, ${pRight[0].toFixed(1)} ${(wcy - oy).toFixed(1)}, ${pRight[0].toFixed(1)} ${pRight[1].toFixed(1)}`,
      `C ${pRight[0].toFixed(1)} ${(wcy + oy).toFixed(1)}, ${(wcx + ox).toFixed(1)} ${pBottom[1].toFixed(1)}, ${pBottom[0].toFixed(1)} ${pBottom[1].toFixed(1)}`,
      `C ${(wcx - ox).toFixed(1)} ${pBottom[1].toFixed(1)}, ${pLeft[0].toFixed(1)} ${(wcy + oy).toFixed(1)}, ${pLeft[0].toFixed(1)} ${pLeft[1].toFixed(1)}`,
      `C ${pLeft[0].toFixed(1)} ${(wcy - oy).toFixed(1)}, ${(wcx - ox).toFixed(1)} ${pTop[1].toFixed(1)}, ${pTop[0].toFixed(1)} ${pTop[1].toFixed(1)}`
    ].join(' ');

    paths.push(d);
  }

  return paths.join(' ');
}

/**
 * Master sketch path generator for any Sabura object.
 * Returns pure SVG path `d` string.
 * Strictly deterministic: identical inputs yield identical output.
 * 
 * @param {Object} obj - Sabura object
 * @returns {string} SVG path 'd' attribute
 */
export function generateSketchPath(obj) {
  const prng = createPRNG(obj.seed || 12345);
  const roughness = obj.roughness !== undefined ? obj.roughness : 1;

  switch (obj.type) {
    case 'rectangle': {
      const vertices = [
        [obj.x, obj.y],
        [obj.x + obj.width, obj.y],
        [obj.x + obj.width, obj.y + obj.height],
        [obj.x, obj.y + obj.height]
      ];
      return sketchPolygon(vertices, prng, roughness, true);
    }

    case 'diamond': {
      const cx = obj.x + obj.width / 2;
      const cy = obj.y + obj.height / 2;
      const vertices = [
        [cx, obj.y],
        [obj.x + obj.width, cy],
        [cx, obj.y + obj.height],
        [obj.x, cy]
      ];
      return sketchPolygon(vertices, prng, roughness, true);
    }

    case 'triangle': {
      const cx = obj.x + obj.width / 2;
      const vertices = [
        [cx, obj.y],
        [obj.x + obj.width, obj.y + obj.height],
        [obj.x, obj.y + obj.height]
      ];
      return sketchPolygon(vertices, prng, roughness, true);
    }

    case 'ellipse': {
      const rx = obj.width / 2;
      const ry = obj.height / 2;
      const cx = obj.x + rx;
      const cy = obj.y + ry;
      return sketchEllipse(cx, cy, rx, ry, prng, roughness);
    }

    case 'path': {
      if (!obj.points || obj.points.length === 0) return '';
      const vertices = obj.points.map(([px, py]) => [obj.x + px, obj.y + py]);
      return sketchPolygon(vertices, prng, roughness, false);
    }

    default:
      return '';
  }
}

/**
 * Generates a closed SVG path suitable for organic watercolor/marker fills.
 * When roughness > 0, connects vertices with subtle natural curves.
 * 
 * @param {Object} obj - Sabura object
 * @returns {string} SVG path 'd' attribute
 */
export function generateClosedFillPath(obj) {
  const prng = createPRNG((obj.seed || 12345) + 77);
  const roughness = obj.roughness !== undefined ? obj.roughness : 1;

  if (obj.type === 'ellipse') {
    const rx = obj.width / 2;
    const ry = obj.height / 2;
    const cx = obj.x + rx;
    const cy = obj.y + ry;
    if (roughness <= 0) {
      return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
    }
    const wobble = Math.min(2, Math.max(0.3, (rx + ry) / 120)) * roughness;
    const wrx = rx + randomRange(prng, -wobble, wobble);
    const wry = ry + randomRange(prng, -wobble, wobble);
    return `M ${cx - wrx} ${cy} A ${wrx} ${wry} 0 1 0 ${cx + wrx} ${cy} A ${wrx} ${wry} 0 1 0 ${cx - wrx} ${cy} Z`;
  }

  let vertices = [];
  if (obj.type === 'rectangle') {
    vertices = [
      [obj.x, obj.y],
      [obj.x + obj.width, obj.y],
      [obj.x + obj.width, obj.y + obj.height],
      [obj.x, obj.y + obj.height]
    ];
  } else if (obj.type === 'diamond') {
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;
    vertices = [
      [cx, obj.y],
      [obj.x + obj.width, cy],
      [cx, obj.y + obj.height],
      [obj.x, cy]
    ];
  } else if (obj.type === 'triangle') {
    const cx = obj.x + obj.width / 2;
    vertices = [
      [cx, obj.y],
      [obj.x + obj.width, obj.y + obj.height],
      [obj.x, obj.y + obj.height]
    ];
  } else if (obj.type === 'path') {
    if (!obj.points || obj.points.length < 3) return '';
    vertices = obj.points.map(([px, py]) => [obj.x + px, obj.y + py]);
  } else {
    return '';
  }

  if (roughness <= 0) {
    return `M ${vertices[0][0]} ${vertices[0][1]} ` + vertices.slice(1).map(v => `L ${v[0]} ${v[1]}`).join(' ') + ' Z';
  }

  // Organic closed path with gentle midpoint curves
  let d = `M ${vertices[0][0].toFixed(1)} ${vertices[0][1].toFixed(1)}`;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % n];
    const len = Math.hypot(v2[0] - v1[0], v2[1] - v1[1]);
    const nx = -(v2[1] - v1[1]) / (len || 1);
    const ny = (v2[0] - v1[0]) / (len || 1);
    const bow = randomRange(prng, -0.8, 0.8) * Math.min(2, len * 0.02) * roughness;
    const mx = (v1[0] + v2[0]) / 2 + nx * bow;
    const my = (v1[1] + v2[1]) / 2 + ny * bow;
    d += ` Q ${mx.toFixed(1)} ${my.toFixed(1)} ${v2[0].toFixed(1)} ${v2[1].toFixed(1)}`;
  }
  d += ' Z';
  return d;
}

/**
 * Sketches a hand-drawn circular arc from startAngle to endAngle at radius r.
 * 
 * @param {number} cx 
 * @param {number} cy 
 * @param {number} r 
 * @param {number} startAngle 
 * @param {number} endAngle 
 * @param {() => number} prng 
 * @param {number} roughness 
 * @returns {string} SVG path segment string
 */
export function sketchArc(cx, cy, r, startAngle, endAngle, prng, roughness = 1) {
  const span = Math.abs(endAngle - startAngle);
  if (span < 1e-4) return '';

  if (roughness <= 0) {
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArc = span > Math.PI ? 1 : 0;
    const sweep = endAngle > startAngle ? 1 : 0;
    return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${largeArc} ${sweep} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }

  const steps = Math.max(2, Math.ceil(span / 0.35));
  const stepAngle = (endAngle - startAngle) / steps;
  const paths = [];

  for (let pass = 0; pass < 2; pass++) {
    let d = '';
    const dir = pass === 0 ? 1 : -1;
    const rOffset = dir * (0.3 + prng() * 0.6) * roughness;
    for (let i = 0; i < steps; i++) {
      const sa1 = startAngle + i * stepAngle;
      const sa2 = sa1 + stepAngle;
      const p1x = cx + (r + rOffset) * Math.cos(sa1);
      const p1y = cy + (r + rOffset) * Math.sin(sa1);
      const p2x = cx + (r + rOffset) * Math.cos(sa2);
      const p2y = cy + (r + rOffset) * Math.sin(sa2);
      const midA = (sa1 + sa2) / 2;
      const bow = (prng() - 0.5) * 1.5 * roughness;
      const pmx = cx + (r + rOffset + bow) * Math.cos(midA);
      const pmy = cy + (r + rOffset + bow) * Math.sin(midA);

      if (i === 0) d += `M ${p1x.toFixed(1)} ${p1y.toFixed(1)}`;
      d += ` Q ${pmx.toFixed(1)} ${pmy.toFixed(1)} ${p2x.toFixed(1)} ${p2y.toFixed(1)}`;
    }
    paths.push(d);
  }
  return paths.join(' ');
}

/**
 * Sketches a hand-drawn outline for a wheel wedge with natural pen lines and arcs.
 * 
 * @param {number} cx 
 * @param {number} cy 
 * @param {number} rInner 
 * @param {number} rOuter 
 * @param {number} startAngle 
 * @param {number} endAngle 
 * @param {() => number} prng 
 * @param {number} roughness 
 * @param {number} gapAngle 
 * @returns {string} SVG path string
 */
export function sketchWedge(cx, cy, rInner, rOuter, startAngle, endAngle, prng, roughness = 1, gapAngle = 0.025) {
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

  if (roughness <= 0) {
    const largeArc = actualEnd - actualStart > Math.PI ? 1 : 0;
    return `M ${x4.toFixed(1)} ${y4.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} L ${x3.toFixed(1)} ${y3.toFixed(1)} A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4.toFixed(1)} ${y4.toFixed(1)} Z`;
  }

  // Double-pass hand-drawn outer arc, radial dividers, and inner arc
  const l1 = sketchLine(x4, y4, x1, y1, prng, roughness);
  const arcOuter = sketchArc(cx, cy, rOuter, actualStart, actualEnd, prng, roughness);
  const l2 = sketchLine(x2, y2, x3, y3, prng, roughness);
  const arcInner = sketchArc(cx, cy, rInner, actualEnd, actualStart, prng, roughness);

  return `${l1} ${arcOuter} ${l2} ${arcInner}`;
}
