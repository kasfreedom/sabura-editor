# Sabura Canvas v1 Document Format Specification

The `sabura/canvas/v1` document format defines the persistent data model for Sabura whiteboards. It is embedded directly within a standalone, 100% offline HTML file inside a `<script type="application/json" id="sabura-document">` element.

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
