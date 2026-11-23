# Wheel reference from source

Read on 2026-09-09 from `src/ui/wheel.js`, especially `getItems()`, the
`get*Items()` builders, `handleItemClick()`, and `render()`. This describes code
behavior, not exhaustive UI verification. The open HTML's inline scripts were
checked for matching builder names and DOM attributes; byte-for-byte parity
between source and the running build was not established.

## Selection chooses the map

Canvas context uses the creation wheel. Otherwise, multiple selection dispatches
to images-only, connectors-only, or generic multi-selection, in that order.
Single selection dispatches by path, connector, text, image, then ordinary shape.

Slots below run clockwise from 12 o'clock, at 45-degree intervals.

| Context | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Canvas | Shapes | Text | Connect | Image | Hand/Pan | Undo | Redo | Select |
| Shape | Fill | Type | Shape | Duplicate | Arrange | Style | Ink | Delete |
| Text | Opacity | Type | Shape | Duplicate | Arrange | Style (disabled) | Color | Delete |
| Connector | Route | Arrows | Points | Duplicate | Arrange | Style | Ink | Delete |
| Open path | Sharp/Curved | Arrows | Close Shape | Duplicate | Arrange | Style | Ink | Delete |
| Closed path | Fill | Sharp/Curved | Open Line | Duplicate | Arrange | Style | Ink | Delete |
| Image | Fit | Opacity | Group | Duplicate | Arrange | Lock/Unlock | More (disabled) | Delete |
| Multiple, generic | Align | Distribute | Group/Ungroup | Duplicate | Arrange | Style | Ink | Delete |
| Multiple images | Fit | Opacity | Group/Ungroup | Duplicate | Arrange | Lock/Unlock | Align | Delete |
| Multiple connectors | Route | Arrows | Points | Duplicate | Arrange | Style | Ink | Delete |

## Submenus and outer rings

- Canvas Shapes: Rectangle, Ellipse, Diamond, Triangle, Line/Poly. Connect:
  Straight, Elbow, Curved.
- Fill: None and theme palette. Third ring: opacity 100/75/50/25%.
- Type: Hand, Sans, Serif, Mono, Bold, and cycling text alignment. Third ring:
  S/M/L/XL. These are distinct from multi-object spatial alignment.
- Shape: Rect/Ellipse/Diamond/Triangle conversions. Third ring: Equal and Connect;
  grouped objects add Select Group/Ungroup. Text has no Equal action.
- Arrange: Front, Forward, Backward, Back and, for most contexts, Lock/Unlock.
  Images have their own top-level lock slot.
- Style: Sketch/Clean and Solid/Dashed/Dotted. Third ring: stroke widths 1/2/4/6;
  No outline is conditional on object eligibility. Standalone text disables Style.
- Ink/Color: palette choices. Palette indices are theme-dependent, not fixed colors.
- Align: Left, Center H, Right, Top, Middle V, Bottom. Generic selection needs
  at least two unlocked non-connector objects.
- Distribute: Horizontal/Vertical. Generic selection needs at least three such
  objects. Image multi-selection puts distribution choices inside Align.
- Image Fit: Contain/Cover. Opacity: 100/75/50/25%.
- Path curve: Sharp Lines/Smooth Curve. Open paths also expose arrow modes;
  closed paths expose Fill.

## Connector details

Route always offers Straight/Elbow/Curved. A single curved connector adds Flip
Curve, and Auto Depth when an explicit curve distance exists. A single elbow
connector offers Bypass Loop without an explicit offset; with an offset it offers
Flip Side and Auto Step.

Arrows offers None/Start/End/Both. Points offers Auto All/Auto From/Auto To.
Multiple connectors retain only the three basic routing choices, and move
Group/Ungroup into Arrange. Common-value detection controls selected markers;
mixed routing, arrows, stroke style, width, or ink must not be read as one shared
setting. An all-locked connector selection disables the modifying top-level
branches except Arrange. Disabled behavior differs by context: inspect the actual
item, not a blanket assumed lock rule.

## Existing machine-readable UI hooks

Rendered main wedges have `data-item-id`, for example `menu_route`,
`menu_type`, `menu_align`, or `action_duplicate`. Submenu and third-ring wedges
have `data-sub-id`, for example `conn_route_elbow`, `type_l`, or `align_top`.
Enabled main wedges expose button role and keyboard focus; disabled main wedges
expose `aria-disabled`. Submenu wedges expose button role, label, and focus.
Active choices have CSS classes and visible checkmarks; do not assume a standard
ARIA selected/pressed state is exposed.

Use these discovered attributes through normal browser locators when the control
is currently present. They are implementation hooks, not a declared versioned API.
Never infer that a hidden submenu can be clicked or that invoking an internal
handler is equivalent to a UI test.

Clicking a menu toggles its submenu. Clicking a leaf dispatches `onAction(id,
payload)` and closes the wheel. Escape and outside pointer-down close it too.
Thus wheel closure establishes interaction completion, not successful document
mutation. Verify the result separately. Source command handling continues in
`src/main.js` → `handleWheelAction()` and the command layer.

## How to use this reference

Read selection and current wheel state, choose a branch from this map, target its
existing DOM control, and inspect the resulting selection/document geometry.
Use screenshots for appearance and hit-testing conflicts. Before proposing new
menus or a browser bridge, try the existing DOM hooks and inspect action handlers.
Source inspection explains available behavior; it does not replace runtime tests
or prove that geometry and export are correct.
