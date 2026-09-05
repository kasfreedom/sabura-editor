# Handoff 011 — independent review R1

Outcome: **CHANGES_REQUESTED**

Reviewed against the frozen source at `e01ebb133538548909a7a75dd81e95358655f463`.
No production source or runner was edited by this review. The required build and
Chrome runner regenerate `sabura.html`; that generated-byte change is recorded
below. The review itself is the only new file created by the reviewer.

## Confirmed

- The changed production/test source hashes in `implementation-r1.md` match the
  worktree for `assets/sabura-app-icon.svg`, `src/ui/topbar.js`, `src/ui/wheel.js`,
  `styles/sabura.css`, and `tests/visual_system_refresh.test.js`.
- The three bundled reference hashes pass `shasum -a 256 -c`.
- No CLI paths changed. The generated artifact contains no reference-preview
  markers, inspection/demo controls, mocked Save Copy, or preview URLs.
- `npm test` passes: 193/193.
- `npm run build` passes. The payload-free runtime is 376,859 bytes, below the
  524,288-byte limit.
- `git diff --check` passes.
- `xmllint --noout assets/sabura-app-icon.svg` passes.
- The source keeps the existing wheel item IDs, contexts, slot count, delegated
  actions, keyboard handlers, and independent `data-ui-theme`/board-theme
  bridges. The status model remains unchanged and the Reading `Clean` element is
  visually hidden by CSS rather than removed from the render model.

## Blocking findings

### 1. Required Chrome runner still fails on the approved Reading behavior

Command:

```text
node scripts/verify-full-e2e.js --chrome-only
```

The run passes the functional flows through Flow 31, the 760/641 Editing seam,
and the 400px Reading/Editing checks, then fails at the first matrix case:
`Responsive toolbar 1440px reading failed`.

The returned audit shows the intended `Clean` status element has zero geometry
(`visible: false`), while the runner still requires `.status-badge` in
`requiredSelectors`, `statusTextVisible === true`, and all visible text to be at
least 12px. This conflicts with the approved brief requirement to hide routine
`Clean` feedback in Reading. Update the Chrome runner as part of this handoff:

- permit a hidden `Clean` status in Reading while still requiring changed,
  pending, copy, and error feedback to be present/announced;
- keep the status element/role available for non-Clean states; and
- change the Reading mode badge to the approved approximately-12px UI label
  size. The current `.mode-badge` is 11px and is reported by the failing audit.

The implementation report describes this as an intentional brief/runner
mismatch, but acceptance requires the required checks to pass; the stale check
must be corrected and rerun.

### 2. The submitted CSS contains multiple competing Graphite cascades

`styles/sabura.css` has a full Graphite layout/token block at approximately
lines 877–1122, another compressed Graphite token/layout block at approximately
1124–1313, the pre-existing visual-system block at 1315–1940, and a third
“Frozen Graphite cascade” at approximately 1942–2028. The same layout selectors
and tokens are therefore declared repeatedly; a quick count finds 15 declarations
of each of several `--ui-*`/`--sabura-vs-*` tokens and three copies of the
Reading Clean rule.

The final declarations currently make the browser render plausibly, but the
intermediate watercolor-gradient values and responsive rules are shadowed by
later copies. This is not a lean visual-only change and leaves future theme and
breakpoint changes order-dependent. Consolidate the Graphite additions into one
ordered source block, preserving the existing legacy rules only where they are
still needed, then rebuild and rerun the focused/full checks.

## Frozen artifact/report bookkeeping

The reference hashes are valid, but the generated artifact hash in
`implementation-r1.md` is no longer the current worktree hash. The report lists
`b6ad2f869ef6182b42b82d603b831a1bd8a8b1d22bf123a42f057c13eb681792`; after the
required build/Chrome run, `sabura.html` is
`dbac05b5d868e838a0e135f449e0913c7efffca3ded62c9778794a040f0b317f`.

The only observed generated difference is the representative sample document's
random board/object IDs and seeds; the build itself reports the same fixed shell
and runtime size. Nevertheless, the handoff explicitly requires exact hashes of
submitted bytes. After the source/runner corrections, rebuild once, refresh
`implementation-r1.md` with the final artifact hash and exact command results,
and freeze that state for the next review.

## Non-blocking notes

- `node scripts/verify-image-e2e.js` could not bind its 127.0.0.1:8093 server in
  this sandbox (`EPERM`); the implementation report's prior pass is not being
  re-claimed here. Chrome is the blocking browser and the image flow should be
  rerun in the authorized verification environment.
- The pre-existing README handoff paragraph still says production
  implementation “has not started”; this was reported as preserved prior work,
  so it is not counted as an implementation blocker, but should be reconciled
  when the handoff status is finalized.
