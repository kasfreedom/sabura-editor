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
