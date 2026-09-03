# Sabura Project Context & Handover

## 1. Repository Location & State
- **Root directory:** `/Users/kassem/Documents/Ideas/sabura`
- **Core premise:** Sabura is a standalone, 100% offline, single-file visual whiteboard editor packaged in `sabura.html` (~235 KiB, zero external dependencies, no server).
- **Git status:** `main` branch, clean working directory, 111 unit tests passing (`npm test`), full Chrome CDP and Safari E2E tests passing (`node scripts/verify-full-e2e.js`).
- **Current document format:** `sabura/canvas/v1` embedded inside `<script type="application/json" id="sabura-document">` in `<head>`.
- **Preceding conversation ID:** `664ea0e9-7b32-4270-b1fb-1640cb9e1dc4` (contains historical ADRs, format reviews, and E2E browser harnesses).

---

## 2. Strategic Direction: Total Separation of Concerns

We evaluated the embedded AI generator approach against practical usage and agreed to **fully separate the visual whiteboard artifact from the AI tooling**:

### Tier 1: The Human Artifact (`sabura.html`)
- **Focus:** 100% human-facing visual whiteboard.
- **Design goals:** Ultra-fast, tiny footprint (< 250 KiB), offline durability, zero installation, no login, zero tracking.
- **Role:** The "PDF of Whiteboards". Users can email it, present it, drag shapes, change colors, edit text, and save copies.
- **Refactoring goal:** Strip out embedded AI contracts, machine-readable prompt guides, and browser-eval generator wrappers from `<head>` and `window.sabura`. Let the HTML do one thing exceptionally well.

### Tier 2: The AI Compiler Tooling (`sabura` CLI / MCP Server)
- **Problem solved:** LLMs are strong at relational and semantic reasoning, but fundamentally weak at 2D spatial arithmetic (predicting pixel coordinates, box overlaps, font bounding boxes, and collision-free edge routing).
- **Architecture:** The CLI acts as the *compiler* between high-level agent intent and the low-level canvas document:
  - **Input:** High-level DSL, relational graph syntax (e.g. Mermaid/text-to-graph), or intent commands.
  - **Engine:** Deterministic graph auto-layout (Dagre / Sugiyama / tree layouts), typography measurement, and collision-free connector routing.
  - **Output:** A pristine, self-contained `sabura.html` file that opens immediately for humans.
  - **Decompiler/Inspector:** Ability to inspect existing `sabura.html` boards and emit a compact relational summary (~100 tokens instead of ~3,000 tokens of raw canvas coordinates) so agents can perform incremental modifications without context bloat.

---

## 3. Architecture & Code Map
- `src/core/document.js`: Schema validation, defaults, seed normalization, and canonical JSON serialization for `sabura/canvas/v1`.
- `src/core/commands.js`: Deterministic command dispatch and atomic undo/redo history.
- `src/core/geometry.js`: Hit-testing, snapping, bounds calculations, and connector route resolution (straight, curved, elbow).
- `src/storage/file-packer.js`: Packaging document JSON into the HTML shell and title sanitization.
- `src/ui/`: UI components (circular ToolWheel, workspace canvas, keyboard shortcuts, top bar, zoom bar, text editor).
- `scripts/build.js`: Bundler and minifier producing the standalone distribution artifact `sabura.html`.
- `tests/`: 14 test suites covering geometry, sketch generation, connectors, multi-selection, commands, and file packing.

---

## 4. Next Priorities
1. **Clean up `sabura.html`**: Remove the embedded AI comment contract and generator ceremonies from the browser runtime so `sabura.html` is purely focused on the human editor experience.
2. **Design `sabura-cli`**: Specify the CLI interface, high-level DSL / graph input format, and layout compiler pipeline.
