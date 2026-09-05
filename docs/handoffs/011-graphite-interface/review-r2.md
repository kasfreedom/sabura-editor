# Handoff 011 — independent review R2

Outcome: **CHANGES_REQUESTED**

Reviewed against the frozen R2 worktree at `HEAD`
`e01ebb133538548909a7a75dd81e95358655f463`. No production or test source was
edited by this review. No staging, commit, push, release, or deployment was
performed.

## What passed

- The submitted changed-file hashes match `implementation-r2.md` exactly,
  including generated `sabura.html` (`b39cda1f581d8919b622bd7c555c3a0791e4bcdd5905d0e502c47f3a727bfadb`).
- The submitted boundary is limited to the approved README, icon, generated
  artifact, topbar/wheel/CSS, verification runner, focused visual tests, and
  handoff docs. No CLI, schema, command, storage, workspace, dependency, or
  release files are changed.
- `npm test` passed independently: 193/193. The focused visual suite passed
  independently: 12/12. `git diff --check` passed, and the reference SHA256
  checks passed.
- `node scripts/verify-full-e2e.js --chrome-only` passed independently in
  Chrome: flows 1–34, including the corrected Reading status invariant and
  responsive widths through 360px. `node scripts/verify-image-e2e.js` also
  passed independently, including offline reopen and no unexpected network
  requests.
- The generated artifact did not change during these checks; its reviewed
  hash remains `b39cda1f581d8919b622bd7c555c3a0791e4bcdd5905d0e502c47f3a727bfadb`.
  No preview/sample leakage was found in the artifact. The R1 stale-hash and
  Clean-status runner blockers are resolved.
- The CSS now has one final Graphite geometry block, and the source/test review
  shows the interface preference and persisted board theme remain separate.

## Blocking findings

### 1. Required interface-theme matrix is not actually exercised

The brief and verification checklist require all eight explicit
Light/Dark × Paper/Night/Blueprint/High Contrast combinations, plus System
under OS light/dark and a live preference change. The updated Chrome runner
only cycles the four board themes (Flow 7); the responsive seam sets the UI
selector to Light once. There is no Dark selection, System resolution test,
`prefers-color-scheme` light/dark emulation, live System change, or matrix
assertion preserving canonical JSON/history/revision/status.

The focused unit test and source inspection support the intended separation,
but they do not satisfy this browser acceptance requirement. Add a specific
Chrome matrix check (including System with an emulated OS preference change),
or provide equivalent recorded browser evidence, before accepting the handoff.

### 2. 360px wheel usability is not evidenced

The 360px checks establish toolbar fit and the unit test establishes a scale
value/clamp, while the only browser wheel label-overlap check runs at 760px.
No browser check opens the wheel at the required 360 × 640 case and verifies
real pointer activation, keyboard focus/activation, disabled/selection states,
outer-ring bounds, and label legibility/touch usability together. This matters
because the final CSS applies a `0.72` scale at 360px, reducing the nominal
11px/10px wheel text further. The brief explicitly says fit alone is
insufficient; add this evidence, and stop for a product decision if readable
touch operation requires changing the wheel hierarchy or navigation.

## Evidence/documentation gap

`implementation-r2.md` does not include the verification checklist's requested
representative screenshots, browser/platform details, or explicit theme matrix
results. These should accompany the added checks so the visual acceptance can
be independently audited rather than inferred from runner output.

## Exact reviewed hashes

```text
README.md                         f5a6d5c4ae110d6aee810df6af7e0847d2a65e42c7172c370ed60810927fc246
assets/sabura-app-icon.svg       8d961b8cfb047d9f504158ae0699843fef6943968f633d3aa551c6e8ffe8d9fa
sabura.html                      b39cda1f581d8919b622bd7c555c3a0791e4bcdd5905d0e502c47f3a727bfadb
scripts/verify-full-e2e.js       a5b1749bfeff79bad182116f1e002a7fb48a429122e5df9279b2901574cd36fc
src/ui/topbar.js                 1782c1600fd8ad8d4aff0be73a224daa0e43327c45b5e4c96aad0de5b5d35629
src/ui/wheel.js                  84dd3e38b362c038904aee774d12f38fe207054212c63669aaea802324a05473
styles/sabura.css                416061feac64e9fef4e64057f61888d39accdcbe9e386246922f334b1b2ca7d8
tests/visual_system_refresh.test.js 30aa4bc0fb4efd59a98b420a89ca479e01c88461cd4ae4e1fd992e7c05315e46
```

Safari remains non-blocking per the brief. The implementation report's build
pass was not rerun here because the build rewrites the generated artifact; the
submitted artifact and hash were independently checked after the reported
mutation-capable verification.
