# Changelog

All notable changes to Sabura will be recorded here.

This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security

- Color fields in documents and commands are validated against a strict color allowlist, and the
  renderer and ToolWheel escape every document value they place in markup. This closes a script
  injection path through crafted colors, palette entries, and object IDs.
- IDs that name `Object.prototype` members (such as `__proto__` and `constructor`) are rejected in
  documents and commands, so they can no longer pollute the global prototype or pass reference checks.

### Fixed

- Save Copy no longer corrupts boards whose text contains `$'`, `` $` ``, `$&`, or `$$`.
- Undo and redo are now exact for grouping, ungrouping, board theme changes, duplicating
  grouped objects, and connector settings. Previously, redo silently did nothing after
  undoing a group, restored a theme without restyling objects, or failed after undoing a
  duplicate.
- A failing undo or redo keeps its history entry and tells the user, instead of
  dropping the entry silently.
- Pasting connectors works. Paste is a single undoable step that also removes the
  groups it created, and copied group names and free endpoints survive cut and delete.
- Keyboard shortcuts no longer act on the board behind the help dialog, the ToolWheel,
  or an in-progress drag. Enter and Space activate focused buttons again, menus keep
  their keys, IME composition (Chinese, Japanese, Korean input) no longer commits text
  early, and held Space or D is released when the window loses focus.

## [1.0.0] - 2026-09-10

### Added

- Portable reading, editing, fullscreen, and presentation modes.
- Shapes, text, paths, connectors, groups, raster images, resizing, and rotation.
- Paper, blueprint, night, and high-contrast visual themes.
- Self-contained Save Copy exports with document revision lineage.
- Versioned live-agent API with atomic batches, stale-edit protection, and safe retries.

### Fixed

- Connector endpoint deletion now preserves valid geometry and undo/redo behavior.
- Theme palette changes retain equivalent object colors where mappings exist.
- Responsive editor controls preserve access to primary actions at compact widths.

[1.0.0]: https://github.com/kasfreedom/sabura-editor/releases/tag/v1.0.0
