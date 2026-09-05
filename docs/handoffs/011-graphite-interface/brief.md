# 011 — Graphite interface layout

- Owner: Codex, reviewer/coordinator
- Revision: 1 · 2026-09-05
- Status: APPROVED FOR IMPLEMENTATION
- Target: Sabura editor repository
- Observed base: `e01ebb133538548909a7a75dd81e95358655f463`
- Initial worktree: clean
- Implementation authorization: user instruction on 2026-09-05 — “create a concise plan and acceptance criteria, then implement through fast agents with independent review and QA.”
- Release boundary: implementation and verification authorized; no staging, commit, push, publish or deploy.

## Start here

Implement a restrained Graphite interface using the existing editor components.
The user selected the Graphite layout first, colors second, then approved keeping
all board themes independent of interface appearance. The user explicitly requested
this handoff **inside the editor repository**. This is a location exception to the
older sibling product mailbox; do not create a competing brief there.

Approval evidence from the conversation: “first the layout, second is the colors,”
“Okay, i like that,” and “I like your direction. Please make the handoff in the
editor repository.” The subsequent explicit delivery instruction authorizes
implementation of this brief. It does not authorize staging, committing, pushing,
publishing or deployment.

Read [verification.md](verification.md), [implementation-prompt.md](implementation-prompt.md),
and [references/index.html](references/index.html). Reference hashes are recorded in
[references/SHA256SUMS](references/SHA256SUMS). Use this brief for behavior and theme
rules; use the HTML snapshots for layout, palette intent and visual comparison.
Where the snapshots conflict with this brief, the brief wins.

## Outcome

Preserve Sabura's offline document editor and circular ToolWheel while making its
interface less visually dominant. Keep identity, document actions, board settings,
navigation and feedback in distinct compact groups, leaving the board open.

This is a visual/layout implementation, not a product redesign. Do not add themes,
features, object types, dependencies or a new UI framework.

## Approved visual system

### Editing layout

- Top left: compact application mark, Sabura identity, View action.
- Top right: Undo/Redo, browser Fullscreen, Present, Save Copy. Preserve actual
  command availability and disabled semantics; Present is not selected unless active.
- Desktop bottom center: Board theme, interface appearance, Grid and Snap settings.
- Bottom left: existing zoom/Fit/help controls, with the wheel launcher above them.
- Separate status region, normally bottom right; long messages must wrap safely
  without competing with the toolbar, settings dock, zoom or wheel launcher.
- Compact flat surfaces, small corner radius, restrained borders and selected
  washes. No full-width heavy frame, rounded capsules or routine decorative clay.

### Reading and Presentation

- Reading retains identity and the existing Edit, Fullscreen, Present and Save Copy
  actions. Make Edit the primary visual action; Save Copy is secondary, but functional.
- Hide routine Clean feedback in Reading. Keep pending, changed, success and failure
  feedback discoverable and accessible. Do not change the underlying status model.
- Hide editing-only wheel/settings/undo controls using the existing mode boundaries.
  Retain zoom, Fit and help. Preserve ordinary fullscreen without entering Presentation.
- Desktop title may be shown, ellipsized within available width. At ≤1050 px hide
  visible title with no reserved width; above that hide earlier if needed to prevent
  collisions. App-mark tooltip/accessibility name must include the actual full title.
- Presentation remains the existing distraction-free, non-editing mode. No new
  presentation behavior, demo bars or status decorations.

### Wheel

- Keep the circular geometry, eight main slots, command IDs, order, contextual
  branches, all ring counts, actual color chips, and mouse/keyboard interactions.
- Solid, clean circular outlines; lighter dotted radial separators. Draw decorative
  separators above opaque fills so adjacent segments cannot obscure them.
- Selected/hover states highlight the segment itself; icons, labels and outlines
  stay sharp. Distinguish keyboard focus from selection and disabled states.
- Close symbol must be legible in both interface palettes. Avoid making unrelated
  wedges appear active. Preserve image-only and multi-connector contextual controls.
- Keep all visible rings inside narrow viewport bounds. The prototype's centered,
  scaled wheel demonstrates a fit strategy, not proof of touch usability. Preserve
  hit testing and keyboard focus. Do not remove rings or commands to make it fit.
  If readable/touch-usable 360 px operation requires changing wheel navigation or
  hierarchy, stop for a product decision rather than silently redesigning it.

### Identity and typography

- Use the proposed [flat app mark](references/sabura-focus-mark.svg), adapted to
  interface tokens. Reuse the existing command icon sprite and mapping.
- UI labels: compact system sans-serif, approximately 12 px / medium-to-semibold;
  wordmark approximately 19 px. Wheel labels approximately 11 px, submenu 10–11 px
  subject to real legibility and overlap checks. Small labels are not license to
  shrink the entire toolbar until it becomes unreadable.
- Preserve authored document fonts, colors, sizes, alignment, emphasis and defaults.
  The sample's sans-serif board text is authored sample content, not a migration.
  Do not infer title/heading/annotation roles from document text.

## Interface appearance and board themes are independent

| Setting | Options to retain | Ownership |
| --- | --- | --- |
| Interface appearance | Light, Dark, System | Local preference; controls, wheel and UI feedback |
| Board theme | Paper, Night, Blueprint, High Contrast | Existing persisted document/theme behavior |

“Graphite Dark” and “Graphite Paper” are names of preview combinations, **not new
board themes**. Do not add them to the theme menu or couple the two selectors.
All eight explicit Light/Dark × four-board-theme combinations must work. System
must resolve through OS preference, including changes while the editor is open.

Starting UI palette targets from the approved prototypes:

| Token | Light interface | Dark interface |
| --- | --- | --- |
| Control surface | `#fffdf7` | `#2b2f33` |
| Main UI text | `#303a3e` | `#edf0f0` |
| Secondary text | `#6b7474` | `#b6bec5` |
| Border/divider | `#b9c0ba` | `#687078` |
| Accent | `#366b93` | `#c1c8ff` |
| Selected surface | `#dce7ed` | `#414b70` |

These are implementation starting values, not exceptions to contrast requirements.
Adjust minimally where contrast fails; record the change. The preview's warm canvas
`#f6f3eb` and charcoal canvas `#202326` are sample document colors—not replacements
for existing theme definitions or existing documents. Retain board defaults initially.
Existing theme-aware editing overlays may use board context for contrast without
coupling persisted board state to the local interface preference.

High Contrast prioritizes legibility: ensure overlays, handles and focus outlines
are distinct; omit decorative pigment/transparency where it reduces clarity. Do not
erase or recolor authored document content in the name of contrast. Inspect inline
text editing on Night and Blueprint, including author-selected text/fill colors.

Changing local interface appearance must not mutate canonical document state,
history, revision digest, saved title or filename behavior. Board theme and color
commands must retain their current document semantics and correct history behavior.

## Responsive layout

- Desktop: separated top groups and bottom settings dock, as in the references.
- Medium widths: collapse optional labels; lift the settings dock above bottom
  navigation/status when necessary. Do not allow title/View/status collisions.
- Narrow widths: identity mark only, retained Edit/Save discoverability, icon-first
  secondary actions; settings may move into a separate upper row; zoom and wheel
  launcher stay independently usable below. Wrap messages above bottom controls.
- Prototype thresholds (1050/640 px) are starting points, not inviolable geometry.
  Preserve the ≤1050 title rule; use content-driven adjustments for other thresholds.
- Test 1440, 1337, 1280, 1050, 1024, 768, 641, 640, 480, 400 and 360 px in Reading
  and Editing. Include 605 px height and a 360 × 640 case. No horizontal page scroll,
  overlapping hit targets, clipped controls or newly inaccessible commands.

## Architecture and implementation sequence

1. Record HEAD, dirty state and baseline tests. Inspect current component ownership;
   do not assume the prototype is the latest runtime. Preserve unrelated changes.
2. Define shared Light/Dark interface tokens in `styles/sabura.css` through existing
   appearance resolution. Keep document/theme data separate.
3. Adapt `src/ui/topbar.js`, `src/ui/zoom-toolbar.js`, wheel launcher and shared CSS.
   Preserve callbacks and semantics. Make feedback a deliberate layout responsibility,
   not a coincidental fixed-position child of a transformed/backdrop-filtered parent.
4. Integrate app icon through the existing asset/build boundary; preserve accessible
   identity and command-icon mapping. Inspect `src/ui/wheel-icon-map.js` and
   `scripts/build.js` before changing symbol assembly.
5. Refine decorative wheel rendering in `src/ui/wheel.js`, preserving interactive
   geometry/listeners. Handle responsive placement at the wheel boundary, not by
   patching app methods after startup.
6. Verify themes, modes, text editing, selection and feedback. Touch renderer or
   workspace code only where a demonstrated contrast/layout boundary requires it.
7. Add focused tests, run full verification, rebuild the real `sabura.html`, submit
   the frozen diff and report for independent review.

No schema version, command API, serialization, revision, history or asset-ownership
changes. Preserve resizing/rotation, locks, grouping, connectors, clipboard, import,
undo/redo, keyboard shortcuts and asynchronous import protections. No AI feature work.

## References are not production code

The snapshots are copies of the old runtime with CSS overrides and sample-only
JavaScript. In particular they hardcode palette tokens, wrap runtime methods,
substitute SVG markup, seed selection/camera and simulate Save Copy. The inspection
menus and “Try a message” bar exist solely for comparison.

**Do not copy these wrappers or overrides wholesale into source or build output.**
Do not ship preview flags, URLs, document IDs, sample controls, mocked save, injected
content, disabled color/theme behavior, or local filesystem paths. The reported
non-applying colors are a known prototype limitation, not approved product behavior.

## Review and completion

Use [verification.md](verification.md) as the acceptance checklist. Submit
`implementation-r1.md` beside this brief with exact commands, results, screenshots,
runtime bytes and SHA-256 hashes of every submitted changed/untracked file; identify
deletions and excluded prior work. Freeze submitted code during review. Reviewer
writes `review-r1.md` against those exact bytes; corrections increment round numbers.

Do not claim acceptance from the implementer's report or historical prototype checks.
Chrome is blocking; Safari/other browsers are non-blocking and must not delay this
task. Do not repair unrelated legacy test failures without evidence of regression.
No staging, commit, push, merge, publish or deployment without separate authorization.

Changes to settled product behavior, new dependencies, or an unsatisfied narrow-screen
wheel requirement needing a new interaction design require a user decision.
