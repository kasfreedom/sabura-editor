import { THEME_PRESETS } from './types.js';

const PRESET_COLOR_ROLES = Object.freeze({
  paper: Object.freeze({
    ink: Object.freeze(['#1e1e1e', '#1971c2', '#2f9e44', '#e03131', '#f08c00', '#9c36b5']),
    roles: Object.freeze({
      '#1e1e1e': 'foreground', '#1971c2': 'blue', '#2f9e44': 'green', '#e03131': 'red',
      '#f08c00': 'orange', '#9c36b5': 'purple', '#ffec99': 'yellow', '#b2f2bb': 'green',
      '#a5d8ff': 'blue', '#ffc9c9': 'red', '#eebefa': 'purple', '#ffffff': 'surface'
    }),
    stroke: Object.freeze({ foreground: '#1e1e1e', blue: '#1971c2', green: '#2f9e44', red: '#e03131', orange: '#f08c00', yellow: '#f08c00', purple: '#9c36b5', neutral: '#1e1e1e', surface: '#1e1e1e' }),
    fill: Object.freeze({ foreground: '#1e1e1e', blue: '#a5d8ff', green: '#b2f2bb', red: '#ffc9c9', orange: '#ffec99', yellow: '#ffec99', purple: '#eebefa', neutral: '#ffffff', surface: '#ffffff' })
  }),
  blueprint: Object.freeze({
    ink: Object.freeze(['#ffffff', '#38bdf8', '#facc15', '#4ade80', '#fb7185', '#c084fc', '#94a3b8']),
    roles: Object.freeze({ '#ffffff': 'foreground', '#38bdf8': 'blue', '#facc15': 'yellow', '#4ade80': 'green', '#fb7185': 'red', '#c084fc': 'purple', '#94a3b8': 'neutral', '#0c192e': 'surface' }),
    stroke: Object.freeze({ foreground: '#ffffff', blue: '#38bdf8', green: '#4ade80', red: '#fb7185', orange: '#facc15', yellow: '#facc15', purple: '#c084fc', neutral: '#94a3b8', surface: '#ffffff' }),
    fill: Object.freeze({ foreground: '#ffffff', blue: '#38bdf8', green: '#4ade80', red: '#fb7185', orange: '#facc15', yellow: '#facc15', purple: '#c084fc', neutral: '#94a3b8', surface: '#0c192e' })
  }),
  night: Object.freeze({
    ink: Object.freeze(['#f4f4f5', '#7aa2f7', '#9ece6a', '#f7768e', '#ff9e64', '#bb9af7', '#71717a']),
    roles: Object.freeze({ '#f4f4f5': 'foreground', '#7aa2f7': 'blue', '#9ece6a': 'green', '#f7768e': 'red', '#ff9e64': 'orange', '#bb9af7': 'purple', '#71717a': 'neutral', '#18181b': 'surface' }),
    stroke: Object.freeze({ foreground: '#f4f4f5', blue: '#7aa2f7', green: '#9ece6a', red: '#f7768e', orange: '#ff9e64', yellow: '#ff9e64', purple: '#bb9af7', neutral: '#71717a', surface: '#f4f4f5' }),
    fill: Object.freeze({ foreground: '#f4f4f5', blue: '#7aa2f7', green: '#9ece6a', red: '#f7768e', orange: '#ff9e64', yellow: '#ff9e64', purple: '#bb9af7', neutral: '#71717a', surface: '#18181b' })
  }),
  'high-contrast': Object.freeze({
    ink: Object.freeze(['#000000', '#0000ff', '#ff0000', '#008800', '#ff8800', '#880088', '#555555']),
    roles: Object.freeze({ '#000000': 'foreground', '#0000ff': 'blue', '#ff0000': 'red', '#008800': 'green', '#ff8800': 'orange', '#880088': 'purple', '#555555': 'neutral', '#ffffff': 'surface' }),
    stroke: Object.freeze({ foreground: '#000000', blue: '#0000ff', green: '#008800', red: '#ff0000', orange: '#ff8800', yellow: '#ff8800', purple: '#880088', neutral: '#555555', surface: '#000000' }),
    fill: Object.freeze({ foreground: '#000000', blue: '#0000ff', green: '#008800', red: '#ff0000', orange: '#ff8800', yellow: '#ff8800', purple: '#880088', neutral: '#555555', surface: '#ffffff' })
  })
});

function presetIdForPalette(palette) {
  if (!Array.isArray(palette)) return null;
  return Object.keys(PRESET_COLOR_ROLES).find(id => {
    const presetPalette = THEME_PRESETS[id]?.palette;
    return presetPalette?.length === palette.length && presetPalette.every((color, index) => color === palette[index]);
  }) || null;
}

/** Returns curated stroke/text choices for built-in themes; custom themes retain their full palette. */
export function inkPaletteFor(palette) {
  const presetId = presetIdForPalette(palette);
  return presetId ? [...PRESET_COLOR_ROLES[presetId].ink] : [...(palette || [])];
}

/** Maps only authored built-in palette colors. Arbitrary custom colors remain untouched. */
export function mapPresetThemeColor(color, sourceTheme, targetTheme, usage = 'stroke') {
  const source = PRESET_COLOR_ROLES[sourceTheme?.id];
  const target = PRESET_COLOR_ROLES[targetTheme?.id];
  if (!source || !target || typeof color !== 'string' || color === 'none') return color;
  const role = source.roles[color.toLowerCase()];
  return role ? (target[usage]?.[role] || color) : color;
}
