/**
 * Sabura Core Types, Schemas, Constants, and Theme Presets.
 */

export const CANVAS_SCHEMA_VERSION = 'sabura/canvas/v1';
export const COMMANDS_SCHEMA_VERSION = 'sabura/commands/v1';

export const THEME_PRESETS = {
  paper: {
    id: 'paper',
    name: 'Paper',
    background: '#fcfaf6',
    gridColor: 'rgba(70, 50, 20, 0.08)',
    palette: [
      '#1e1e1e', // Dark charcoal / pen ink
      '#1971c2', // Blueprint blue
      '#2f9e44', // Forest green
      '#e03131', // Vermilion red
      '#f08c00', // Amber orange
      '#9c36b5', // Plum violet
      '#ffec99', // Post-it yellow wash
      '#b2f2bb', // Mint wash
      '#a5d8ff', // Sky blue wash
      '#ffc9c9', // Rose wash
      '#eebefa', // Lavender wash
      '#ffffff'  // Pure white
    ],
    defaultFill: 'none',
    defaultStroke: '#1e1e1e',
    defaultStrokeWidth: 2,
    defaultOpacity: 1.0,
    defaultRoughness: 1,
    defaultFontFamily: 'hand',
    defaultFontSize: 'm'
  },
  blueprint: {
    id: 'blueprint',
    name: 'Blueprint',
    background: '#0c192e',
    gridColor: 'rgba(56, 189, 248, 0.15)',
    palette: [
      '#ffffff', // White chalk
      '#38bdf8', // Cyan drafting ink
      '#facc15', // Drafting yellow
      '#4ade80', // Mint green
      '#fb7185', // Coral pink
      '#c084fc', // Lilac
      '#94a3b8', // Slate graphite
      '#0c192e'  // Deep navy
    ],
    defaultFill: 'none',
    defaultStroke: '#ffffff',
    defaultStrokeWidth: 2,
    defaultOpacity: 1.0,
    defaultRoughness: 1,
    defaultFontFamily: 'hand',
    defaultFontSize: 'm'
  },
  night: {
    id: 'night',
    name: 'Night',
    background: '#18181b',
    gridColor: 'rgba(255, 255, 255, 0.07)',
    palette: [
      '#f4f4f5', // Crisp chalk white
      '#7aa2f7', // Pastel sky
      '#9ece6a', // Pastel sage
      '#f7768e', // Pastel coral
      '#ff9e64', // Pastel amber
      '#bb9af7', // Pastel lavender
      '#71717a', // Muted slate
      '#18181b'  // Dark obsidian
    ],
    defaultFill: 'none',
    defaultStroke: '#f4f4f5',
    defaultStrokeWidth: 2,
    defaultOpacity: 1.0,
    defaultRoughness: 1,
    defaultFontFamily: 'hand',
    defaultFontSize: 'm'
  },
  'high-contrast': {
    id: 'high-contrast',
    name: 'High Contrast',
    background: '#ffffff',
    gridColor: 'rgba(0, 0, 0, 0.15)',
    palette: [
      '#000000',
      '#0000ff',
      '#ff0000',
      '#008800',
      '#ff8800',
      '#880088',
      '#555555',
      '#ffffff'
    ],
    defaultFill: 'none',
    defaultStroke: '#000000',
    defaultStrokeWidth: 2,
    defaultOpacity: 1.0,
    defaultRoughness: 0,
    defaultFontFamily: 'sans',
    defaultFontSize: 'm'
  }
};

export const FONT_SIZES = {
  s: 14,
  m: 20,
  l: 28,
  xl: 40
};

export const FONT_FAMILIES = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
  mono: '"SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  hand: '"Caveat", "Comic Sans MS", "Chalkboard SE", "Segoe Print", cursive, sans-serif'
};

export const OPACITY_PRESETS = [1.0, 0.75, 0.5, 0.25];
export const STROKE_WIDTHS = [1, 2, 4, 6];
export const STROKE_STYLES = ['solid', 'dashed', 'dotted'];
export const SHAPE_TYPES = ['rectangle', 'ellipse', 'diamond', 'triangle'];
export const OBJECT_TYPES = ['rectangle', 'ellipse', 'diamond', 'triangle', 'text', 'connector', 'path'];
export const CONNECTOR_ROUTINGS = ['straight', 'elbow', 'curved'];
export const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const MIN_OBJECT_SIZE = 16;
