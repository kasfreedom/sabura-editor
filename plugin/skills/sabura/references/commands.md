# Command cheat-sheet (`sabura/commands/v1`)

Updated 2026-11-23 for editor 7b179de. Print the full schema with `node scripts/sabura-board.mjs schema` or, in a browser, `describe().editRequestSchema`. `?` = optional.
The live schema wins; additional properties are rejected. Every command is
`{ type: '<name>', ...fields }` inside `commands: []`.

Common visual fields: `fill, stroke` (colour strings), `strokeWidth` (number),
`strokeStyle` solid|dashed|dotted, `opacity`, `roughness`, `rotation`, `locked`,
`groupId`. Text: `text`, `textStyle { size: s|m|l|xl, fontFamily: hand|sans|serif|mono,
bold, align: left|center|right, color }`.

| Command | Fields |
| --- | --- |
| `create_object` | `object`, `atIndex?`. Object `type` is one of: **shape** `rectangle|ellipse|diamond|triangle` (`id,x,y,width,height`, style/text); **text** (`+ autoWidth?, autoHeight?`); **path** (`points:[{x,y}], closed?, curveStyle? sharp|curved, startArrow?, endArrow?`, plus `x,y,width,height`); **connector** (`from:{id,anchor?}\|{point}`, `to:…`, `routing? straight|elbow|curved, curveSide? -1\|1, curveDistance?, elbowOffset?, startArrow?, endArrow?, stacking? front\|back`) |
| `create_image` | `object` (`type:'image', assetId, fit? contain\|cover, x,y,width,height`), `asset` (`id, type:'raster', data, mimeType, width, height`), `atIndex?` |
| `connect_objects` | `connectorId, fromId, toId, text?, textStyle?, fromAnchor?, toAnchor?, routing?, curveSide?, curveDistance?, elbowOffset?, startArrow?, endArrow?, stacking?, stroke?, strokeWidth?, strokeStyle?, opacity?, roughness?` |
| `reconnect_connector` | `id, endpoint: from\|to, target: {id, anchor?}\|{point}` |
| `configure_connector` | `id, routing?, curveSide?, curveDistance?, elbowOffset?, startArrow?, endArrow?, stacking?` |
| `delete_objects` | `ids` |
| `move_objects` | `ids, dx, dy` (relative) |
| `resize_object` | `id, bounds:{x,y,width,height}, points?, scaleText?, textStyle?` |
| `rotate_objects` | `objects` (object map), `freeEndpoints?`. Inspect schema before use |
| `set_style` | `ids, updates:{fill?, stroke?, strokeWidth?, strokeStyle?, opacity?, roughness?, curveStyle?, closed?, startArrow?, endArrow?}` |
| `set_typography` | `ids, updates:{size?, fontFamily?, bold?, align?, color?}` |
| `set_text` | `id, text` |
| `change_shape` | `id, newType: rectangle\|ellipse\|diamond\|triangle\|text` |
| `set_image_fit` / `set_image_opacity` | `id, fit` / `id, opacity` |
| `group_objects` | `ids` (2+ existing, unlocked), `groupId, name?, frame?` (`frame: true` draws a labelled frame; plain groups are invisible) |
| `ungroup_objects` | `groupIds` |
| `lock_objects` | `ids, locked` |
| `reorder_objects` | `ids, action: front\|back\|forward\|backward` |
| `align_objects` | `ids, alignment: left\|center\|right\|top\|middle\|bottom` (≥2 objects) |
| `distribute_objects` | `ids, direction: horizontal\|vertical` (≥3 objects) |
| `update_path_points` | `id, points, bounds?` |
| `set_board_theme` | `themeId? paper\|blueprint\|night\|high-contrast`, or `theme?:{background, gridColor, palette[], defaultFill, defaultStroke, defaultFontFamily, defaultFontSize, …}` |
| `set_title` | `title` |

There is no public duplicate command: build new objects with fresh IDs.
Connector endpoints attach by object ID, so connect after both objects exist and
re-check attachments after moving/resizing.
