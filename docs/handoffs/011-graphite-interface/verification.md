# Verification — Handoff 011

Record actual results; this is a checklist, not a passing test report.

## Automated checks

From the editor root, after implementation authorization:

```sh
git status --short
git rev-parse HEAD
npm test
npm run build
node scripts/verify-full-e2e.js --chrome-only
node scripts/verify-image-e2e.js
git diff --check
```

The build and full browser runner rewrite the generated artifact: they are not
read-only checks. Inspect runner prerequisites before use. If current tool policy
disallows a runner's direct browser transport, use the authorized browser interface
to reproduce its relevant scenarios, report that substitution and do not claim the
runner passed. Do not invent flags. Record pre-existing failures with baseline
evidence; do not silently waive a newly introduced failure.

Add focused regression tests to existing relevant suites for toolbar layout/state,
visual tokens, wheel layers/slots, icon coverage, recipient experience and responsive
identity. Validate changed SVGs with an available XML/SVG validator; the icon mapping
coverage assertions in the visual-system tests must pass.

## Acceptance checklist

- [ ] Graphite layout and flat mark match reference intent. Differences in palette,
  type, spacing, borders or state emphasis are explained and reviewed.
- [ ] No preview script, demo content, simulated Save Copy, inspection controls or
  hardcoded theme overrides enter generated production output.
- [ ] Existing board themes retained; all 8 Light/Dark × Paper/Night/Blueprint/High
  Contrast combinations checked. System checked with OS light/dark and live changes.
- [ ] Interface-only change leaves canonical JSON, history, revision lineage and
  document status unchanged. Existing theme and color commands still visibly work.
- [ ] Existing documents retain their fonts, styles, colors, titles and dimensions.
  New-object defaults retain existing semantics. Test actual fill, ink, text color,
  opacity, no-outline and image controls; distinguish disabled vs enabled actions.
- [ ] Ordinary UI text meets at least 4.5:1 contrast; meaningful controls, focus and
  selection indicators at least 3:1 against adjacent surfaces. Do not recolor user
  content to meet an interface rule. Inline text/caret/selection are readable on all
  board themes; inspect light UI over Night and dark UI over Paper specifically.
- [ ] Reading/Edit/Presentation boundaries and fullscreen remain intact. Edit stays
  discoverable; Clean status hidden only visually in Reading; errors remain announced.
- [ ] Title: desktop actual/ellipsized; ≤1050 no visible title or reserved width;
  actual full title retained in metadata and app-mark name/tooltip.
- [ ] Responsive width matrix from brief checked in Reading and Editing with long
  title, all status states, and the busy sample. Controls do not collide at 1337 px.
- [ ] Canvas, shape, text, path, image, connector, multi-image, multi-connector,
  mixed-selection and locked wheel contexts preserve eight main slots and hierarchy.
  Check one/two/three-ring states, solid circles, dotted spokes and layered fills.
- [ ] Real pointer clicks and keyboard activation/focus work after wheel positioning
  or scaling; outer ring stays in bounds at 360 px. Explicitly review touch usability
  and label legibility—fit alone is insufficient. No silent command removal.
- [ ] Busy board includes text, fills, paths, raster images, attached connectors,
  single/multi selections, locks and group transforms at nondefault zoom/pan.
- [ ] Existing image file-input, lowercase i, drop, locks, clipboard/shared assets,
  asynchronous import cancellation and save/reopen protections still pass.
- [ ] Open built HTML directly in Chrome through file://. Capture a real Save Copy
  and reopen offline; verify pixels, title, assets, fit, connectors, authored styles
  and revision lineage. No external asset requests, uncaught app exceptions or
  unhandled rejections. Compare against the frozen build, not the localhost prototype.
- [ ] Complete unit suite and build pass. Runtime remains strictly below 524,288
  bytes; embedded document payload/assets excluded using the existing build metric.
- [ ] Diff is limited to approved source/assets/tests/build/docs and generated
  artifact; no dependencies/schema change; prior unrelated work preserved.

## Evidence and report

Include exact base/HEAD, initial and submitted Git status, affected paths/hashes,
test commands/exit results, browser/platform, viewport/theme matrix, representative
screenshots, real offline save/reopen evidence, measured runtime bytes and remaining
risks. Explicitly identify any unrun tests. Compare screenshots against reference
layout, colors, typography, icons, wheel geometry and responsive behavior.

Prototype spot checks are not implementation acceptance. A source-less browser
MutationObserver error appeared during prototype inspection; its origin remains
unconfirmed. Investigate errors observed during actual verification and distinguish
tool-injected issues from app errors with evidence, not assumptions.

Prior clean-shell Step 10 issues are out of scope unless this change causes or
worsens them. Safari is non-blocking, not certified or deliberately broken.
