# Handoff 011 — independent review R4

Outcome: **ACCEPTED**

Reviewed against the frozen R4 worktree at base `HEAD`
`e01ebb133538548909a7a75dd81e95358655f463`. No production or test source was
edited by this review. No staging, commit, push, release, or deployment was
performed.

## Review result

The R2/R3 acceptance gaps are closed in the submitted bytes:

- The Chrome runner now exercises Light/Dark × Paper/Night/Blueprint/High
  Contrast, System light/dark emulation and a live preference change, while
  asserting canonical document JSON, undo/redo depth, status and revision
  stability. The board theme remains document-owned.
- The persistent closed-wheel audit covers 360×640, 400×640, 480×640,
  640×640, 641×640 and 360×605, checking settings, launcher, zoom, status,
  top actions, viewport bounds and pairwise overlap. The compact CSS restores
  one framed Editing action rail, eliminating the prior ghost row.
- The real 360×640 open-wheel audit covers three-ring bounds, label containment,
  effective font size, opaque selected/hover state, disabled state, focus
  outline, physical pointer activation and keyboard activation. It requires
  every interactive target to be at least 33.5px (reported minimum 33.7px).
  The selected third-ring label contrast audit reports 7.43 in Dark UI/Paper
  and 9.27 in Light UI/Paper, both above 4.5:1. The durable 360×640 evidence
  image visibly shows the complete three-ring wheel and separated controls.
- Source inspection confirms the implementation boundary remains visual/test
  work plus the generated artifact and handoff evidence. No CLI, schema,
  command API, persistence, history/revision, accessibility contract, image
  packaging, dependency, or unrelated source paths changed. The topbar keeps
  the existing callbacks and status semantics; wheel actions and eight-slot
  contexts remain intact.

## Independent checks

- `npm test` — PASS, 194/194.
- `git diff --check` — PASS.
- `xmllint --noout assets/sabura-app-icon.svg` — PASS.
- Reference `SHA256SUMS` — PASS for all three reference files.
- The generated artifact hash remained unchanged during these read-only
  checks. No preview/demo strings or local preview markers were found in
  `sabura.html`.
- Evidence files were independently hash-checked, dimension-checked, and
  visually inspected: both desktop captures are 1440×810 and the wheel
  capture is 360×640. The Light/Dark desktop captures and the narrow wheel
  capture are durable files in the handoff evidence directory.

The mutation-capable build/full Chrome/image commands were not rerun during
this review because they rewrite the frozen generated artifact; their R4
reported PASS results were checked against the submitted runner assertions,
evidence, and exact bytes below. Safari remains non-blocking per the brief.

## Exact reviewed boundary and SHA-256

```text
README.md                            f5a6d5c4ae110d6aee810df6af7e0847d2a65e42c7172c370ed60810927fc246
assets/sabura-app-icon.svg          8d961b8cfb047d9f504158ae0699843fef6943968f633d3aa551c6e8ffe8d9fa
sabura.html                         3f77a2d27ac3657afeb71293480146a236119dada5147b650d24159b8a158bff
scripts/verify-full-e2e.js          208d276c92c8df46cdecb28c61aa136ed26e9c43edc8db2306069311c455b908
src/ui/topbar.js                    1782c1600fd8ad8d4aff0be73a224daa0e43327c45b5e4c96aad0de5b5d35629
src/ui/wheel.js                     de5e370abdec5fe5a860769aad239c81b3924067d3f077fb70ef1db33bc532ce
styles/sabura.css                   efc648a49a853e887139f1d7668df8479de9b52f8d9e4f423698d6de5df82f1c
tests/visual_system_refresh.test.js dddebd690f6222fd5d6996e553cb4d165755f684251ee5ef6cbcb05109b5f2f2
evidence/dark-desktop-1440x810.png  6c25af3ba0e6d77198078676f8c3bf26d48fee8a50deb8935f6269f7a1592035
evidence/light-desktop-1440x810.png 16de7323a18449a35fd9290f65680d56edaf7dbc38c864a1cc75843593efd089
evidence/wheel-360x640-3ring.png   3a4df4628f2b0ecb8f1794ba51e6190a4973baee5bd665bc9b5aa387dd59c953
```

The R4 runtime report records 362,839 bytes total, 359,422 bytes payload-free,
and 164,866 bytes of headroom under the 524,288-byte budget. The submitted
boundary is accepted for handoff completion; no release action is authorized
by this review.
