/**
 * Maps Sabura ToolWheel item ids to symbols in sabura-menu-icons.svg.
 * Several commands intentionally share a visual concept.
 */
export const WHEEL_ICON_BY_ID = Object.freeze({
  shapes: 'shapes',
  shape_rectangle: 'rectangle',
  shape_ellipse: 'ellipse',
  shape_diamond: 'diamond',
  shape_triangle: 'triangle',
  tool_line: 'polygon-line',
  tool_text: 'text',
  connector: 'connector',
  conn_straight: 'connector-straight',
  conn_elbow: 'connector-elbow',
  conn_curved: 'connector-curved',
  image_import: 'image',
  tool_hand: 'pan',
  action_undo: 'undo',
  action_redo: 'redo',
  tool_select: 'select',

  menu_fill: 'fill',
  fill_none: 'fill-none',
  menu_opacity: 'opacity',
  menu_type: 'text',
  font_hand: 'text',
  font_sans: 'text',
  font_serif: 'text',
  font_mono: 'text',
  type_bold: 'bold',
  type_align: 'text-align',
  type_s: 'text-size',
  type_m: 'text-size',
  type_l: 'text-size',
  type_xl: 'text-size',

  menu_shape: 'shapes',
  to_rectangle: 'rectangle',
  to_ellipse: 'ellipse',
  to_diamond: 'diamond',
  to_triangle: 'triangle',
  to_equal_sides: 'equal-sides',
  action_connect: 'connector',
  action_group: 'group',
  action_select_group: 'group',
  action_ungroup: 'ungroup',
  action_duplicate: 'duplicate',

  menu_order: 'arrange',
  order_front: 'bring-front',
  order_forward: 'bring-forward',
  order_backward: 'send-backward',
  order_back: 'send-back',
  action_lock: 'lock',
  action_unlock: 'unlock',

  menu_style: 'style-sketch',
  style_sketch: 'style-sketch',
  style_clean: 'style-clean',
  stroke_solid: 'stroke-solid',
  stroke_dashed: 'stroke-dashed',
  stroke_dotted: 'stroke-dotted',
  width_0: 'fill-none',
  width_1: 'stroke-width',
  width_2: 'stroke-width',
  width_4: 'stroke-width',
  width_6: 'stroke-width',
  menu_ink: 'color',
  action_delete: 'delete',

  menu_route: 'connector',
  conn_route_straight: 'connector-straight',
  conn_route_elbow: 'connector-elbow',
  conn_route_curved: 'connector-curved',
  conn_curve_flip: 'flip',
  conn_curve_auto: 'auto',
  conn_elbow_flip: 'flip',
  conn_elbow_auto: 'auto',
  conn_elbow_bypass: 'bypass',
  menu_arrows: 'arrow-both',
  conn_arrows_none: 'stroke-solid',
  conn_arrows_start: 'arrow-start',
  conn_arrows_end: 'arrow-end',
  conn_arrows_both: 'arrow-both',
  menu_conn_points: 'connection-points',
  conn_points_auto: 'auto',
  conn_points_auto_from: 'arrow-start',
  conn_points_auto_to: 'arrow-end',

  menu_path_curve: 'path-sharp',
  path_curve_sharp: 'path-sharp',
  path_curve_curved: 'connector-curved',
  path_arrows_none: 'stroke-solid',
  path_arrows_start: 'arrow-start',
  path_arrows_end: 'arrow-end',
  path_arrows_both: 'arrow-both',
  path_toggle_open: 'path-open',
  path_toggle_close: 'path-close',

  menu_image_fit: 'image-cover',
  image_fit_contain: 'image-contain',
  image_fit_cover: 'image-cover',
  menu_image_group: 'group',
  image_context_placeholder: 'more',

  menu_align: 'align-center',
  align_left: 'align-left',
  align_center: 'align-center',
  align_right: 'align-right',
  align_top: 'align-top',
  align_middle: 'align-middle',
  align_bottom: 'align-bottom',
  menu_distribute: 'distribute-horizontal',
  dist_h: 'distribute-horizontal',
  dist_v: 'distribute-vertical'
});

export function iconForWheelItem(id) {
  if (WHEEL_ICON_BY_ID[id]) return WHEEL_ICON_BY_ID[id];
  if (/^(fill|ink)_\d+$/.test(id)) return 'color';
  if (/^opacity_/.test(id)) return 'opacity';
  if (/^width_/.test(id)) return 'stroke-width';
  return null;
}

/**
 * Render a local, decorative icon from the sprite embedded by the build.
 * The visible control remains the accessible element; the icon never owns focus.
 */
export function renderSaburaIcon(name, className = 'sabura-vs-icon') {
  if (!name) return '';
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#sabura-vs-icon-${name}"></use></svg>`;
}
