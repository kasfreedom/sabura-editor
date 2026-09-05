# Handoff 011 — implementation R3

Status: READY_FOR_REVIEW

R3 adds evidence-driven browser acceptance for interface appearance, System
preference changes, and the narrow three-ring wheel. The implementation stays
visual/test-only. The CLI and sibling repositories were not touched. No files
were staged or committed.

## R3 delivery

- Added a real Chrome matrix for Light and Dark interface appearance across
  Paper, Night, Blueprint, and High Contrast. Each interface-only change is
  checked against canonical document JSON, undo and redo depth, status,
  revision lineage, and content digest while the board theme remains
  document-owned.
- Added Chrome OS color-scheme emulation for System light and dark, including a
  live light-to-dark preference change while the document is open. Resolved UI
  tokens change without persistence or history mutation, and emulation/state
  are restored.
- Added a real 360×640 three-ring wheel audit. It verifies transformed bounds,
  label containment and effective legibility, solid rims, dotted separators,
  33.7px minimum practical pointer target, disabled/selected/focus states,
  physical pointer activation, and keyboard activation. The smallest visual
  compensation raises the scaled wheel labels to approximately 9.36–10.8px;
  hierarchy and slot geometry are unchanged.
- Added focused regression coverage for the 360px compensation and browser
  audit boundaries.
- Captured one-time review screenshots with Chrome 152.0.7977.76:

  | Evidence | Dimensions | SHA-256 |
  | --- | --- | --- |
  | `evidence/light-desktop-1440x810.png` | 1440×810 | `1867cc5bb26345aeec92bc3ff1155b86c2e57aa30f01fd89492c536293e69ef1` |
  | `evidence/dark-desktop-1440x810.png` | 1440×810 | `d8a2d7b17dc5d9a13ff331ea2a70809430cd200578c18325f5645256a68d141f` |
  | `evidence/wheel-360x640-3ring.png` | 360×640 | `985a730f1ac94f42fbc9dc46320094db68bfd35358c04f66a81f33c5a4fdc461` |

  These were generated explicitly by the one-time command
  `node scripts/verify-full-e2e.js --chrome-only --capture-review-evidence`.

## Frozen changed bytes

Hashes below are the exact final source and artifact bytes after all
mutation-capable verification commands completed:

| Path | SHA-256 |
| --- | --- |
| `README.md` | `f5a6d5c4ae110d6aee810df6af7e0847d2a65e42c7172c370ed60810927fc246` |
| `assets/sabura-app-icon.svg` | `8d961b8cfb047d9f504158ae0699843fef6943968f633d3aa551c6e8ffe8d9fa` |
| `sabura.html` | `00ca2d0bf0f59de30d69d64d96e97350275a5c8cca0404b745ec67575fbc1403` |
| `scripts/verify-full-e2e.js` | `96387afeacd222aafdb3830abbe46dd5031d216cdae607d551ab0e725d395bf1` |
| `src/ui/topbar.js` | `1782c1600fd8ad8d4aff0be73a224daa0e43327c45b5e4c96aad0de5b5d35629` |
| `src/ui/wheel.js` | `84dd3e38b362c038904aee774d12f38fe207054212c63669aaea802324a05473` |
| `styles/sabura.css` | `bd5030f058103ea3cdaa6304ab64704565e0ec63b6faa7e43974cf7f0df79378` |
| `tests/visual_system_refresh.test.js` | `693dbd3be1a6752964b08baed71c06f776e32ad6671e3507dbcab96faba9dc83` |
| `evidence/dark-desktop-1440x810.png` | `d8a2d7b17dc5d9a13ff331ea2a70809430cd200578c18325f5645256a68d141f` |
| `evidence/light-desktop-1440x810.png` | `1867cc5bb26345aeec92bc3ff1155b86c2e57aa30f01fd89492c536293e69ef1` |
| `evidence/wheel-360x640-3ring.png` | `985a730f1ac94f42fbc9dc46320094db68bfd35358c04f66a81f33c5a4fdc461` |

The generated artifact is 362,101 bytes. Its payload-free runtime is 358,683
bytes, fixed shell is 354,564 bytes, representative sample is 362,101 bytes,
and runtime headroom is 165,605 bytes under the 524,288-byte budget.

## Verification evidence

- `npm test` — PASS, 194/194.
- `node --test tests/visual_system_refresh.test.js` — PASS, 13/13.
- `npm run build` — PASS; byte report above.
- `node scripts/verify-full-e2e.js --chrome-only` — PASS, all Chrome flows
  1–34, plus the Light/Dark matrix, System live preference audit, and 360px
  wheel scenario.
- `node scripts/verify-image-e2e.js` — PASS, including image import, real Save
  Copy, offline reopen, metadata/assets/connectors/revision, and no unexpected
  network requests.
- `xmllint --noout assets/sabura-app-icon.svg` — PASS.
- `shasum -a 256 -c SHA256SUMS` in the handoff references directory — PASS,
  all three reference files.
- `git diff --check` — PASS.

The worktree is frozen for independent review. Do not stage, commit, push,
publish, or deploy without user authorization.
