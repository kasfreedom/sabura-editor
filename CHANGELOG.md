# Changelog

All notable changes to Sabura will be recorded here.

This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Arrow labels. A connector's `text` is drawn at the middle of the arrow, over a patch of board
  colour so the line doesn't run through it. Agents can pass `text` to `connect_objects` or change
  it with `set_text`. Before, connector text was stored and reported but never drawn.

### Security

- Color fields in documents and commands are validated against a strict color allowlist, and the
  renderer and ToolWheel escape every document value they place in markup. This closes a script
  injection path through crafted colors, palette entries, and object IDs.
- IDs that name `Object.prototype` members (such as `__proto__` and `constructor`) are rejected in
  documents and commands, so they can no longer pollute the global prototype or pass reference checks.

### Changed

- The editor moved to the `sabura-app` GitHub organization. The hosted editor is now at
  https://sabura-app.github.io/sabura-editor/, and the Sabura icon in the top bar opens the
  Sabura website, https://sabura-app.github.io/. Boards saved before this change still
  link to the old address.
- The agent API (`window.sabura.agent` and the WebMCP tools) now checks each command
  against the JSON Schema it publishes. Unknown or misspelled fields, missing required
  fields and wrong value types are refused with `INVALID_COMMAND` and the path to the
  field. Previously they were ignored, so a command could report success and do nothing:
  in a claude.ai test, `group_objects` sent with `objectIds` instead of `ids` reported
  success and created no group. Missing and colliding IDs keep their existing codes.
- Agent `group_objects` with fewer than two existing, unlocked objects is refused instead
  of silently doing nothing. Grouping from the editor's own UI is unchanged.

### Fixed

- Text size, bold and other typography set through the agent API now apply to shapes that were
  created with plain `text`. Before, `set_typography` skipped them while reporting success, so
  "xl" text stayed at the default size.
- Agent commands that name an object that doesn't exist (`set_text`, `move_objects`,
  `set_style`, `delete_objects`, `lock_objects` and others) are refused instead of reporting
  success and changing nothing.
- A refused agent batch lists every invalid command (up to 10) instead of only the first.
- The editor starts where browser storage is blocked: sandboxed embeds (such as MCP Apps
  hosts), boards opened from a `data:` URL, and browsers with site data turned off.
  Previously it stopped before drawing the board. The interface theme is then simply
  not remembered.
- The inline text box stays over its shape when the canvas is panned or zoomed while
  typing, instead of staying fixed on screen.
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

### Performance

- The canvas now updates only what changed instead of rebuilding every SVG node on each
  pointer move. Panning and zooming change only the camera transform and grid; dragging
  replaces only the moved objects and the connectors that follow them. Pointer-move and
  wheel renders are coalesced to one per frame. Measured with `npm run perf:render` in
  headless Chrome on one Apple M5 machine, on the 574-object example board with 4x CPU
  throttling: frames longer than 20 ms while dragging fell from 122 of 129 to 0, and
  main-thread time while panning fell from 736 to 339 ms per second. Results vary by
  machine.
- `npm run perf:render` measures frame times and main-thread load on a board, and
  `npm run test:e2e:render` checks that incremental updates match a full render.

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

[1.0.0]: https://github.com/sabura-app/sabura-editor/releases/tag/v1.0.0
