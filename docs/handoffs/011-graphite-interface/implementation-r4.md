# Handoff 011 — implementation R4

Status: READY_FOR_REVIEW

R4 closes the narrow-layout findings from independent QA. The implementation
remains visual/test-only; commands, shortcuts, schema, persistence,
accessibility, themes, and offline packaging are unchanged. The CLI and
sibling repositories were not touched. No files were staged or committed.

## R4 delivery

- At widths up to 640px, the Editing settings dock owns its 58px upper row.
  The existing secondary and primary actions are explicitly restored to one
  framed flex rail at top-right, so Undo, Redo, Fullscreen, Present, and Save
  Copy do not become a ghost third row at 360px.
- At the 641px edge, the settings dock moves to the same upper row only because
  the closed-wheel audit demonstrated a real overlap with the bottom zoom
  rail. Above 680px, the existing desktop grouping remains unchanged.
- The persistent closed-wheel layout audit covers 360×640, 400×640,
  480×640, 640×640, 641×640, and 360×605. It checks settings, launcher,
  zoom, status, left/right top actions, viewport bounds, and pairwise overlap.
  The open wheel is intentionally audited separately by Flow 32W.
- Flow 32W keeps the real 360×640 three-ring wheel audit: transformed bounds,
  label containment and effective legibility, solid rims, dotted separators,
  minimum pointer target ≥33.5px (measured 33.7px), disabled/selected/focus
  states, physical pointer activation, keyboard activation, and active
  third-ring label contrast of 7.43 (Dark UI/Paper) and 9.27 (Light
  UI/Paper). Selected/hover fills are opaque interface-owned gradients from
  `--ui-wheel-bg` to `--ui-wheel-active`, preserving the watercolor variation
  without allowing the Paper board to wash out label contrast.
- Captured one-time review evidence after the final CSS/build with Chrome
  152.0.7977.76:

  | Evidence | Dimensions | SHA-256 |
  | --- | --- | --- |
  | `evidence/light-desktop-1440x810.png` | 1440×810 | `16de7323a18449a35fd9290f65680d56edaf7dbc38c864a1cc75843593efd089` |
  | `evidence/dark-desktop-1440x810.png` | 1440×810 | `6c25af3ba0e6d77198078676f8c3bf26d48fee8a50deb8935f6269f7a1592035` |
  | `evidence/wheel-360x640-3ring.png` | 360×640 | `3a4df4628f2b0ecb8f1794ba51e6190a4973baee5bd665bc9b5aa387dd59c953` |

  These were generated explicitly by
  `node scripts/verify-full-e2e.js --chrome-only --capture-review-evidence`.

## Frozen changed bytes

Hashes below are the exact final source, artifact, and evidence bytes after
all mutation-capable verification commands completed:

| Path | SHA-256 |
| --- | --- |
| `README.md` | `f5a6d5c4ae110d6aee810df6af7e0847d2a65e42c7172c370ed60810927fc246` |
| `assets/sabura-app-icon.svg` | `8d961b8cfb047d9f504158ae0699843fef6943968f633d3aa551c6e8ffe8d9fa` |
| `sabura.html` | `3f77a2d27ac3657afeb71293480146a236119dada5147b650d24159b8a158bff` |
| `scripts/verify-full-e2e.js` | `208d276c92c8df46cdecb28c61aa136ed26e9c43edc8db2306069311c455b908` |
| `src/ui/topbar.js` | `1782c1600fd8ad8d4aff0be73a224daa0e43327c45b5e4c96aad0de5b5d35629` |
| `src/ui/wheel.js` | `de5e370abdec5fe5a860769aad239c81b3924067d3f077fb70ef1db33bc532ce` |
| `styles/sabura.css` | `efc648a49a853e887139f1d7668df8479de9b52f8d9e4f423698d6de5df82f1c` |
| `tests/visual_system_refresh.test.js` | `dddebd690f6222fd5d6996e553cb4d165755f684251ee5ef6cbcb05109b5f2f2` |
| `evidence/dark-desktop-1440x810.png` | `6c25af3ba0e6d77198078676f8c3bf26d48fee8a50deb8935f6269f7a1592035` |
| `evidence/light-desktop-1440x810.png` | `16de7323a18449a35fd9290f65680d56edaf7dbc38c864a1cc75843593efd089` |
| `evidence/wheel-360x640-3ring.png` | `3a4df4628f2b0ecb8f1794ba51e6190a4973baee5bd665bc9b5aa387dd59c953` |

The final generated artifact is 362,839 bytes. Its payload-free runtime is
359,422 bytes, fixed shell is 355,303 bytes, representative sample is
362,839 bytes, and runtime headroom is 164,866 bytes under the 524,288-byte
budget.

## Verification evidence

- `node --test tests/visual_system_refresh.test.js` — PASS, 13/13.
- `npm test` — PASS, 194/194.
- `npm run build` — PASS; byte report above.
- `node scripts/verify-full-e2e.js --chrome-only --capture-review-evidence` —
  PASS, Chrome flows 1–34, Light/Dark × Paper/Night/Blueprint/High Contrast,
  System live preference changes, compact viewport matrix, and 360px wheel
  scenario.
- `node scripts/verify-image-e2e.js` — PASS, including image import, real Save
  Copy, offline reopen, metadata/assets/connectors/revision, and no unexpected
  network requests.
- `xmllint --noout assets/sabura-app-icon.svg` — PASS.
- `shasum -a 256 -c SHA256SUMS` in the handoff references directory — PASS,
  all three reference files.
- `git diff --check` — PASS.

The worktree is frozen for independent review. Do not stage, commit, push,
publish, or deploy without user authorization.
