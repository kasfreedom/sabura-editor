# Sabura Canvas v1 Document Format Specification

The `sabura/canvas/v1` document format defines the persistent data model for Sabura whiteboards. It is embedded directly within a standalone, 100% offline HTML file inside a `<script type="application/json" id="sabura-document">` element.

---

## 0. Single-File Layout

A Sabura HTML file is structured so that an AI can read the board document and the operating guide without encountering the application runtime:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Sabura - AI-First Offline Whiteboard</title>

  <!-- SABURA AI CONTRACT
       Human- and machine-readable operating guide.
       Describes the schema, both agent workflows, and the public API.
       Stop reading at <style>. The runtime below is opaque.
  -->

  <script type="application/json" id="sabura-document">
    { ... board document ... }
  </script>

  <!-- Opaque application runtime begins here. Do not read or modify. -->
  <style>/* CSS — opaque */</style>
</head>
<body>
  <div id="app"></div>
  <script>/* minified JS bundle — opaque */</script>
</body>
</html>
```

Both the AI contract and the document seam appear **before** `<style>`. An agent with partial file-reading tools can stop reading at `<style>` and never encounter CSS or JavaScript.

The seam element is accessed by the runtime via `document.getElementById('sabura-document')`, which works regardless of whether the element is in `<head>` or `<body>`.

---

## 0a. Generator API

When opened in a browser, `window.sabura` exposes a public generator API:

| Method | Signature | Description |
| :--- | :--- | :--- |
| `readAiContract()` | `-> { found: bool, contract: string }` | Returns the embedded AI guide from `<head>`. Never returns CSS or JS. |
| `getDocument()` | `-> document` | Returns a deep copy of the current board document. |
| `validateDocument(doc)` | `-> { valid: bool, errors: string[] }` | Validates a document without mutating the open board. |
| `generateBoardFile(doc)` | `-> { success, filename, byteLength } \| { success: false, errors[] }` | Validates, packages, and downloads a complete HTML board file. Never returns the HTML source. |
| `applyCommands(cmds[])` | `-> { success, document?, errors? }` | Applies editing commands to the open board. |
| `exportCanonicalJson()` | `-> string` | Returns canonical JSON of the current document. |
| `undo()` / `redo()` | | Undo/redo the last command. |
| `subscribe(listener)` | `-> unsubscribe fn` | Subscribes to document changes. |

### `generateBoardFile(doc)` behavior

1. Validates the supplied document with the strict `sabura/canvas/v1` validator.
2. If invalid: returns `{ success: false, errors: [...] }` — no file is generated.
3. Builds a clean canonical HTML using the DOM-clone shell (excludes canvas SVG, selection, wheel, and presentation state).
4. Replaces only the `sabura-document` seam via regex.
5. Triggers a browser file download.
6. Returns `{ success: true, filename, byteLength }` — `byteLength` is the real UTF-8 byte count from `Blob.size`.
7. Does **not** alter the open board, selection, undo history, or redo history.
8. The HTML string is never returned through this API.

### Preservation guarantee

After `generateBoardFile`:
- CSS `<style>` content hash is unchanged.
- JavaScript bundle `<script>` content hash is unchanged.
- Only the board document JSON changes.
- Minor whitespace differences in wrapper HTML are acceptable (DOM-clone serialization).

---

## 0b. Agent Workflows

### Preferred (browser automation)

```
1. Open sabura.html in a browser.
2. window.sabura.readAiContract()   -> { found, contract }
3. window.sabura.getDocument()      -> current board (optional)
4. Build your document object.
5. window.sabura.validateDocument(doc)   -> { valid, errors[] }
6. window.sabura.generateBoardFile(doc)  -> { success, filename, byteLength }
7. Return the downloaded file without opening or reading it.
```

### Fallback (file tools, no browser)

```
1. Read only the contract and the document seam. Stop before <style>.
2. Locate the seam:
     <script type="application/json" id="sabura-document">
     </script>
3. Replace only the JSON between those markers.
4. Encode every literal < as \u003C inside the JSON.
5. Copy the rest of the file through your tools without loading it into context.
6. Never inspect, reformat, or regenerate the runtime.
7. Return the resulting HTML file.
```

---


## 1. Top-Level Structure

A Sabura v1 document is a strict, deterministic, semantic JSON object containing eight top-level keys:

```json
{
  "schemaVersion": "sabura/canvas/v1",
  "id": "board_abc1234",
  "title": "My Whiteboard",
  "theme": { ... },
  "objects": { ... },
  "order": [ ... ],
  "groups": { ... },
  "assets": { ... }
}
```

### Top-Level Properties

| Property | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `schemaVersion` | `string` | **Yes** | Must be `"sabura/canvas/v1"`. |
| `id` | `string` | **Yes** | Non-empty alphanumeric board identifier. |
| `title` | `string` | **Yes** | Board title displayed in UI and export filename. |
| `theme` | `object` | **Yes** | Active theme definition (`background`, `palette`, etc.). |
| `objects` | `object` | **Yes** | Map of object records where `key === object.id`. |
| `order` | `string[]` | **Yes** | Array of object IDs defining bottom-to-top Z-index paint order. |
| `groups` | `object` | **Yes** | Map of group records `{ [groupId]: { id, name, ... } }`. |
| `assets` | `object` | **Yes** | Map of asset records `{ [assetId]: { id, type, ... } }`. |
| `ext:*` | `any` | No | Any namespaced custom extension data. |

Raster images use a canonical top-level asset and a small object reference. The
asset bytes are stored once and are never copied into image objects:

```json
{
  "id": "asset_photo",
  "type": "raster",
  "data": "data:image/png;base64,...",
  "mimeType": "image/png",
  "width": 1200,
  "height": 800
}
```

Only `image/png`, `image/jpeg`, and `image/webp` are accepted. The data URL MIME
must match `mimeType`, use valid base64, and stay within 10 MiB, 16,384 pixels on
either axis, and 40,000,000 decoded pixels. An image object references the asset
with `assetId` and uses `fit: "contain"` or `"cover"` (default `"contain"`),
alongside the normal spatial fields (`x`, `y`, `width`, `height`, `rotation`,
`opacity`, `locked`, and `groupId`). Deleting the final image reference removes
the asset; duplicate image objects reuse the same asset record.

Canonical validation performs deterministic structural checks for the required
PNG, JPEG, and WebP headers/chunks and verifies encoded dimensions against asset
metadata. Native import additionally requires successful browser image decoding
before the asset/object command is committed.

```json
{
  "id": "image_photo",
  "type": "image",
  "assetId": "asset_photo",
  "fit": "contain",
  "x": 100,
  "y": 120,
  "width": 480,
  "height": 320,
  "rotation": 0,
  "opacity": 1,
  "locked": false,
  "groupId": null
}
```

---

## 2. Supported Object Types and Examples

### A. Complete Canonical Shape (`rectangle`)

Shapes include `rectangle`, `ellipse`, `diamond`, and `triangle`. Shape text is stored directly within the object's `text` and `textStyle` fields.

```json
{
  "id": "shape_auth_service",
  "type": "rectangle",
  "x": 100,
  "y": 120,
  "width": 180,
  "height": 90,
  "fill": "#ffec99",
  "stroke": "#1e1e1e",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "opacity": 1.0,
  "roughness": 1,
  "seed": 4829103,
  "locked": false,
  "groupId": null,
  "rotation": 0,
  "text": "Authentication\nService",
  "textStyle": {
    "size": "m",
    "resolvedSize": 20,
    "fontFamily": "hand",
    "bold": true,
    "align": "center",
    "color": "#1e1e1e"
  }
}
```

### B. Standalone Text Object (`text`)

Standalone text objects render multi-line text with automatic or manual bounds.

```json
{
  "id": "txt_header",
  "type": "text",
  "x": 80,
  "y": 40,
  "width": 240,
  "height": 45,
  "fill": "none",
  "stroke": "#1e1e1e",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "opacity": 1.0,
  "roughness": 0,
  "seed": 102938,
  "locked": false,
  "groupId": null,
  "rotation": 0,
  "text": "System Architecture v1.0",
  "textStyle": {
    "size": "l",
    "resolvedSize": 28,
    "fontFamily": "sans",
    "bold": true,
    "align": "left",
    "color": "#1e1e1e"
  }
}
```

### C. Path Object (`path`)

Paths represent hand-drawn polyline strokes, smooth spline curves, or custom closed polygon shapes.

```json
{
  "id": "path_flow_arc",
  "type": "path",
  "x": 300,
  "y": 200,
  "width": 150,
  "height": 100,
  "fill": "none",
  "stroke": "#1971c2",
  "strokeWidth": 2,
  "strokeStyle": "dashed",
  "opacity": 0.85,
  "roughness": 1,
  "seed": 95821,
  "locked": false,
  "groupId": null,
  "rotation": 0,
  "points": [
    { "x": 0, "y": 0 },
    { "x": 75, "y": 90 },
    { "x": 150, "y": 20 }
  ],
  "closed": false,
  "curveStyle": "curved",
  "startArrow": false,
  "endArrow": true
}
```

### D. Connector Between Two Objects Using Movable Anchors

Connectors can dynamically attach to objects with normalized anchor points (`0.0` to `1.0` in object coordinate space).

```json
{
  "id": "conn_auth_to_db",
  "type": "connector",
  "from": {
    "id": "shape_auth_service",
    "anchor": { "x": 1.0, "y": 0.5 }
  },
  "to": {
    "id": "shape_database",
    "anchor": { "x": 0.0, "y": 0.5 }
  },
  "routing": "curved",
  "curveSide": 1,
  "curveDistance": 45,
  "stroke": "#1e1e1e",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "opacity": 1.0,
  "roughness": 1,
  "seed": 772183,
  "locked": false,
  "groupId": null,
  "rotation": 0,
  "startArrow": false,
  "endArrow": true,
  "stacking": "front"
}
```

### E. Free Endpoint Connector

Connectors can terminate at free-floating world coordinates using the `point` definition.

```json
{
  "id": "conn_callout",
  "type": "connector",
  "from": {
    "id": "shape_auth_service",
    "anchor": { "x": 0.5, "y": 0.0 }
  },
  "to": {
    "point": { "x": 190, "y": 30 }
  },
  "routing": "straight",
  "stroke": "#e03131",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "opacity": 1.0,
  "roughness": 1,
  "seed": 331902,
  "locked": false,
  "groupId": null,
  "rotation": 0,
  "startArrow": false,
  "endArrow": false
}
```

### F. Grouping Example

Objects associate with a group by matching `object.groupId` with an entry in the top-level `groups` record:

```json
{
  "groups": {
    "grp_backend": {
      "id": "grp_backend",
      "name": "Backend Services",
      "collapsed": false
    }
  },
  "objects": {
    "shape_auth_service": {
      "id": "shape_auth_service",
      "type": "rectangle",
      "groupId": "grp_backend"
    }
  }
}
```

---

## 3. Supported Enums

- **Object Types (`type`):**
  - `"rectangle"`, `"ellipse"`, `"diamond"`, `"triangle"`, `"text"`, `"connector"`, `"path"`
- **Connector Routing (`routing`):**
  - `"straight"`: Direct point-to-point line.
  - `"elbow"`: Orthogonal Manhattan routing with optional U-bypass loop (`elbowOffset`).
  - `"curved"`: Smooth quadratic curve with arc control (`curveSide`, `curveDistance`).
- **Stroke Styles (`strokeStyle`):**
  - `"solid"`, `"dashed"`, `"dotted"`
- **Font Sizes (`textStyle.size`):**
  - `"s"` (14px), `"m"` (20px), `"l"` (28px), `"xl"` (40px)
- **Font Families (`textStyle.fontFamily`):**
  - `"sans"`: Native system UI sans-serif.
  - `"serif"`: Editorial Georgia/Times serif.
  - `"mono"`: Monospace code font.
  - `"hand"`: Playful sketchy handwritten cursive.
- **Text Alignment (`textStyle.align`):**
  - `"left"`, `"center"`, `"right"`
- **Connector Stacking (`stacking`):**
  - `"front"`, `"back"`
- **Path Curve Style (`curveStyle`):**
  - `"sharp"`, `"curved"`

---

## 4. Required versus Optional Properties

| Property | Context | Required? | Default if Omitted |
| :--- | :--- | :--- | :--- |
| `id` | All objects | **Yes** | None (reject if missing) |
| `type` | All objects | **Yes** | None (reject if missing) |
| `x`, `y`, `width`, `height` | Shapes, Text, Paths | **Yes** | None (reject if missing or <= 0) |
| `from`, `to` | Connector | **Yes** | None (reject if missing) |
| `points` | Path | **Yes** | None (must be array of >= 2 points) |
| `stroke` | All objects | No | Theme `defaultStroke` (`#1e1e1e`) |
| `strokeWidth` | All objects | No | Theme `defaultStrokeWidth` (`2`) |
| `strokeStyle` | All objects | No | `"solid"` |
| `fill` | All objects | No | Theme `defaultFill` (`"none"`) |
| `opacity` | All objects | No | Theme `defaultOpacity` (`1.0`) |
| `roughness` | All objects | No | Theme `defaultRoughness` (`1`) |
| `seed` | All objects | No | Random 32-bit integer |
| `locked` | All objects | No | `false` |
| `groupId` | All objects | No | `null` |
| `rotation` | All objects | No | `0` |
| `text` | All objects | No | `""` |
| `textStyle` | All objects | No | Object with theme font defaults |
| `routing` | Connector | No | `"straight"` |
| `curveSide` | Connector | No | `1` |
| `startArrow` | Connector, Path | No | `false` |
| `endArrow` | Connector | No | `true` |
| `closed` | Path | No | `false` |
| `curveStyle` | Path | No | `"sharp"` |

---

## 5. Extension Rules (`ext:*`)

To allow future tools and AI models to annotate diagrams without breaking compatibility, Sabura permits custom properties **only** under the `ext:*` namespace:

- Any property starting with `ext:` (e.g., `ext:reasoning`, `ext:author_agent`, `ext:tags`) is preserved through validation, editing, and canonical serialization.
- Any unnamespaced property not explicitly defined in the allowed-field set (e.g. `backgroundColor`, `myCustomTag`) is strictly **rejected** with a validation error to catch AI hallucinations and spelling errors early.

---

## 6. Safe HTML Serialization and Escaping

To prevent premature closing of the hosting `<script>` element or cross-site scripting:
- Every literal `<` character inside JSON strings must be canonically encoded as `\u003C`.
- When parsed back by browser `JSON.parse()`, `\u003C` safely decodes to `<` with zero loss of fidelity.

---

## 7. Revision Extension (`ext:sabura:revision`)

To support distinguishable saved copies and lineage tracking across offline handoffs without altering the core `sabura/canvas/v1` schema version, Sabura introduces official revision metadata under the `ext:sabura:revision` extension namespace.

### Schema Structure

```json
{
  "ext:sabura:revision": {
    "version": 1,
    "revisionId": "4a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d",
    "parentId": "3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c",
    "contentDigest": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }
}
```

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `version` | integer | Yes | Revision schema version (`1`). |
| `revisionId` | string | Yes | Unique revision identifier: lowercase hex string of at least 12 characters (`/^[0-9a-f]{12,}$/`; 32-character hex generated by default). |
| `parentId` | string \| null | Yes | `revisionId` of the immediate parent snapshot (`/^[0-9a-f]{12,}$/`), or `null` for root revisions. Must not equal `revisionId` (self-parenting is invalid). |
| `contentDigest` | string | Yes | Deterministic digest in `"sha256:<64-hex>"` format computed over canonical JSON of the normalized document excluding `ext:sabura:revision`. |

### Canonical Content Digest Invariants

- Computed over the canonical JSON serialization of the normalized document with `ext:sabura:revision` excluded.
- Includes all document root fields (`schemaVersion`, `id`, `title`, `theme`, `objects`, `order`, `groups`, `assets`), all object properties, and all other `ext:*` properties.
- Strictly excludes non-persisted application state: camera zoom/pan, UI interface theme, current selection, active tool, presentation mode, or filesystem filenames.
- **Backward compatibility:** Documents without `ext:sabura:revision` (undefined) remain fully valid. On the first "Save Copy", a root revision is bootstrapped (`parentId: null`) while preserving the document ID. An explicitly present `null` or malformed value is invalid.
- **Stale detection:** If a document includes `ext:sabura:revision`, but `contentDigest` does not match the actual canonical document contents (e.g. edited by an older tool or tampered), validation fails and the editor enters safe failure mode.
