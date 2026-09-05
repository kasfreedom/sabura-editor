# Copy-paste implementation prompt

Use this prompt only when the user chooses to start implementation. It does not
itself create an active job, branch, agent or commit authorization.

```text
Implement Handoff 011 — Graphite interface layout in the Sabura editor.

Start by reading docs/handoffs/011-graphite-interface/brief.md and verification.md,
then inspect the bundled references, repository instructions and current worktree.
I authorize implementation of that brief. Record this approval in its status before
starting, without broadening scope. Preserve all unrelated work.

Use the existing components and shared appearance tokens. Keep Light/Dark/System
interface appearance independent from Paper/Night/Blueprint/High Contrast board
themes. Preserve document colors, typography/defaults, commands, shortcuts, wheel
slots and hierarchy, accessibility, history, revision lineage and offline packaging.

The HTML references are visual prototypes, not production code. Do not ship their
fixed palette overrides, runtime monkey patches, simulated Save Copy or demo bars.

Implement incrementally: shared tokens and icon; floating toolbar/settings/status
layout; Reading emphasis and responsive identity; crisp wheel layers and positioning;
theme/contrast and behavioral regression verification. No new dependencies or schema.

Run the required checks, verify real Chrome file:// save/reopen, and report exact
runtime bytes (strictly under 524,288 bytes excluding document payload/assets).
Safari is non-blocking. Do not stage, commit, push, merge, publish or deploy.

Submit implementation-r1.md alongside the brief with exact changed file hashes and
verification evidence. Freeze the submitted code for independent review. If a safe
solution requires new product behavior or authorization, report the precise decision.
```
