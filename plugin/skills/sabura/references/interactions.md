# UI interaction recipes

For supported API authoring, use [agent API workflow](agent-api.md). These
recipes apply to UI-only requests, visual adjustments, and transport fallback.

## Basic authoring

Verified shortcuts: V select, H pan, R rectangle, E ellipse, T standalone text,
C connector, Q wheel, 0 reset zoom, 1 fit content. Confirm Help in the running
build before relying on unfamiliar shortcuts. A guessed D did not create a
Diamond; use Shapes → Diamond or convert a rectangle with Shape → Diamond.

For shapes, drag bounds, Enter, confirm the accessible text editor exists, type,
and Enter to commit. For standalone text, T then click, confirm editor readiness,
type, and Cmd+Enter on macOS to commit. Escape cancels text edits. Cmd+A means
replace text only when the editor is focused; on the canvas it selects the board.

Cmd+D duplicates. Inspect the new object before moving or renaming it: selection
and overlap can be deceptive. Cmd+G groups, Cmd+Shift+G ungroups. Toolbar Undo is
a useful explicitly targetable alternative to the keyboard shortcut. Use the
platform's actual shortcut conventions rather than mechanically substituting keys.

## Selection and geometry

- Marquee selection intersects objects; it does not require full containment.
  A broad box can include crossing connectors. A thin strip through shape
  interiors can isolate a row, provided connectors do not cross that strip.
- Confirm selection count and wheel context before a bulk action.
- Align works with two eligible objects; distribution generally needs three.
  Rendered sketch bounds can differ slightly despite canonical alignment.
- Drag inside a filled object to move it. Dragging a polygon vertex reshapes it.
  Clicking an exposed portion helps select overlapping objects; Arrange changes
  layer order. Do not use a bounding-box center blindly for a concave shape.
- Connector bounding-box centers can be empty space, especially for curves.
  Select a point visibly on the path using a screenshot and rendered geometry.
  There is no universal midpoint recipe for arbitrary curves.

Read-only SVG inspection can retrieve `g[data-id]`, labels, bounding rectangles,
and path `d` attributes. Use the browser tool's supported read-only evaluation
surface; don't assume every DOM method is implemented. In the tested surface,
`getTotalLength()` was unavailable. The embedded `script#sabura-document` held
initial content, not necessarily current unsaved edits. Prefer `agent.read().document` when a permitted transport exposes it, or an explicitly live
JSON view when available; don't mistake stale embedded JSON for current state.

Check numeric geometry attributes for NaN/Infinity. Do not scan all markup:
base64 image bytes can coincidentally contain those strings. Exact path equality
can verify Undo; tiny rounding differences need numeric/visual assessment rather
than automatically being labeled failures.

## Connectors

Create connections by dragging C from one object's interior to the other's;
center-to-center worked reliably in the exercises. Inspect the attachment after
creation. Separate text annotations are a tested way to label a connection; they
are not established to follow it automatically.

- Straight for direct relationships.
- Elbow for orthogonal routes. Collinear endpoints can look straight; offset an
  endpoint when demonstrating the route. Bypass Loop adds an offset route;
  Flip Side changes it; Auto Step resets it.
- Curved for feedback. Flip Curve changes the bow, not arrow direction. Drag the
  curve handle to alter depth; Auto Depth resets a manually changed depth.
- Arrows controls None/Start/End/Both separately from route.
- Drag endpoint handles to reposition attachments; Points → Auto From/To/All
  restores automatic attachment in the tested cases.

After moving, resizing, duplicating a connected group, or undoing, inspect whether
connections follow the intended objects. Creating a visible line alone does not
prove the intended attachment.

## Polygons and paths

Shapes → Line / Poly: click vertices, then click the first point again to close
(after at least three vertices). Selected polygons expose draggable vertices.
Use Fill for a closed polygon. Sharp/Curved → Smooth Curve changes the outline;
inspect possible expansion beyond the sharp outline. Open Line and Close Shape
convert between open and closed path behavior; the wheel changes accordingly.

## Images

Invoke Image and use the available picker or supported import UI. If the automation
surface cannot access the picker, ask the user to select an image; once imported,
continue with its editing controls. Do not repeatedly attempt blocked native-app
access or claim autonomous import from a user-assisted success.

Select the image, resize with its handles, and move by dragging its interior.
Fit → Contain preserves the whole image within the frame (`meet`); Cover fills
it with centered cropping (`slice`). Use a non-square frame to see the distinction
for a square image. This does not establish arbitrary manual crop positioning.
Opacity changes the image object. Duplicate and Arrange work for images; undo
trial changes and verify the final image count. Connections can attach to an image;
verify by moving it and observing the endpoint, then undo if the move was a test.

Tested image controls do not establish lock behavior, asset cleanup after deletion,
or save/reopen for every image format. Keep these distinctions out of routine
user flows unless they affect the requested outcome.
