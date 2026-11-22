/**
 * Incremental canvas updates.
 *
 * The workspace re-renders the scene as parts on every interaction (cheap: about
 * 2 ms for 574 objects). Replacing the whole canvas DOM on each pointer move is
 * what costs most, so `planScenePatch` compares the previous and next parts and
 * plans the smallest DOM change that produces the same result as a full render.
 * It compares output markup, not inputs: anything that changes an object's
 * markup (a moved shape, a connector following it, selection, a theme restyle)
 * shows up as a string difference without tracking why it changed.
 */

/**
 * Plans the DOM update from `prev` to `next` scene parts (see `renderSceneParts`).
 * Pure: no DOM access, so it is tested directly.
 *
 * @param {object|null} prev parts currently on screen, or null before the first render
 * @param {object} next parts to show; `overlay` already includes any workspace drafts
 * @returns {{full: true} | {full: false, defs: boolean, transform: boolean, overlay: boolean,
 *   objects: {rebuild: true} | {rebuild: false, replace: number[]}}}
 *   `replace` lists indexes into `next.objects` whose element must be replaced.
 */
export function planScenePatch(prev, next) {
  if (!prev || prev.shellKey !== next.shellKey || prev.backdrop !== next.backdrop) return { full: true };

  const plan = {
    full: false,
    defs: prev.defs !== next.defs,
    transform: prev.worldTransform !== next.worldTransform,
    overlay: prev.overlay !== next.overlay,
    objects: { rebuild: false, replace: [] }
  };

  const before = prev.objects;
  const after = next.objects;
  if (before.length !== after.length) {
    plan.objects = { rebuild: true };
    return plan;
  }
  for (let i = 0; i < after.length; i++) {
    if (before[i].id !== after[i].id) {
      // Paint order or membership changed: rebuild the object layer in one go.
      plan.objects = { rebuild: true };
      return plan;
    }
    if (before[i].markup !== after[i].markup) plan.objects.replace.push(i);
  }
  // Replacing most nodes one by one costs more than one rebuild.
  if (plan.objects.replace.length > Math.max(32, after.length / 2)) plan.objects = { rebuild: true };
  return plan;
}

/**
 * Parses SVG markup into elements in the SVG namespace. Setting innerHTML on a
 * detached SVG element parses exactly as the full-canvas innerHTML path does.
 * The namespace is read from the live <svg> element, so the offline bundle
 * carries no URL-shaped constants.
 */
function parseSvg(svgRoot, markup) {
  const holder = svgRoot.ownerDocument.createElementNS(svgRoot.namespaceURI, 'g');
  holder.innerHTML = markup;
  return holder;
}

/**
 * Applies a plan from `planScenePatch` to the canvas container.
 * Falls back to a full render whenever the DOM is not in the expected shape.
 *
 * @param {Element} container the canvas container element
 * @param {object} plan result of planScenePatch(prev, next)
 * @param {object} next parts to show
 * @param {(parts: object) => string} renderFull returns the complete SVG markup for `next`
 */
export function applyScenePatch(container, plan, next, renderFull) {
  const full = () => { container.innerHTML = renderFull(next); };
  if (plan.full) return full();

  const svg = container.firstElementChild;
  const defs = svg?.querySelector(':scope > #canvas-defs');
  const world = svg?.querySelector(':scope > #world-layer');
  const objectsLayer = world?.querySelector(':scope > #objects-layer');
  const overlayLayer = world?.querySelector(':scope > #overlay-layer');
  if (!defs || !world || !objectsLayer || !overlayLayer) return full();

  if (plan.defs) defs.innerHTML = next.defs;
  if (plan.transform) world.setAttribute('transform', next.worldTransform);

  if (plan.objects.rebuild) {
    objectsLayer.innerHTML = next.objects.map((o) => o.markup).join('\n');
  } else if (plan.objects.replace.length > 0) {
    const children = objectsLayer.children;
    if (children.length !== next.objects.length) return full();
    for (const index of plan.objects.replace) {
      const current = children[index];
      const { id, markup } = next.objects[index];
      if (current?.getAttribute('data-id') !== id) return full();
      const parsed = parseSvg(svg, markup);
      // Each object renders as exactly one element; anything else means the
      // markup shape changed and only a full render is known to be correct.
      if (parsed.children.length !== 1) return full();
      current.replaceWith(parsed.firstElementChild);
    }
  }

  if (plan.overlay) overlayLayer.innerHTML = next.overlay;
}
