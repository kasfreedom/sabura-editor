# Sabura live agent API (`window.sabura.agent`)

API version `sabura/agent/v1`, commands `sabura/commands/v1` (checked on the hosted
editor 2026-10-12). Call it from `mcp__Claude_Browser__javascript_tool`; the last
expression is returned, top-level `await` works, results must be JSON-serialisable.
Re-run `describe()` on each new board: `apiVersion` or the command list may change.

Surface: `agent.describe() read() apply(req) undo(req) redo(req) fitBoard()
focusObjects(ids,{padding}) saveCopy() subscribe(fn)`. Also `window.sabura.setMode('editing'|'reading')`,
`getMode()`, `getDocument()`. Do not use other `window.sabura.*` functions
(`applyCommands`, `generateBoardFile`, …) to author; they bypass the agent contract.

## Orient

```js
const a = window.sabura.agent, r = a.read();
({ mode: r.mode, busy: r.busy, token: r.editToken, hist: r.history,
   objects: Object.keys(r.document.objects), title: r.document.title })
```

`document.objects` and `document.groups` are **objects keyed by ID**, not arrays.
`read()` returns a copy; mutating it edits nothing. Keep raster `asset.data` out of
logs.

## Enter editing

```js
window.sabura.setMode('editing'); await new Promise(r => setTimeout(r, 300));
const r = window.sabura.agent.read(); ({ mode: r.mode, busy: r.busy })
```

Edits are rejected unless `mode === 'editing'` and `busy.busy === false`. Also
blocked: presenting, saving, image import, an active text edit or pointer gesture,
a corrupted document. Don't force-close the user's active gesture.

## One atomic batch

```js
const a = window.sabura.agent, snap = a.read();
const res = a.apply({
  requestId: 'story-01-create',
  expectedEditToken: snap.editToken,
  commands: [
    { type: 'create_object', object: { id: 'in',  type: 'rectangle', x: 120, y: 180, width: 180, height: 90, text: 'Input' } },
    { type: 'create_object', object: { id: 'out', type: 'ellipse',   x: 420, y: 180, width: 180, height: 90, text: 'Outcome' } },
    { type: 'connect_objects', connectorId: 'in_out', fromId: 'in', toId: 'out', routing: 'straight', endArrow: true }
  ]
});
({ success: res.success, errors: res.errors, created: res.affected?.created, token: res.editTokenAfter })
```

- Result keys: `success, requestId, changed, editTokenBefore, editTokenAfter, affected`
  (`created/updated/deleted/renderAffected`), plus `errors` on failure with
  `commandIndex`/`path`.
- A batch commits as one Undo step or changes nothing. Later commands may refer to
  objects created earlier in the same batch.
- New objects, connectors, groups and images need **explicit, unique IDs**. Reusing
  an ID, or delete-then-recreate with the same ID in one batch, is rejected.
- Keep batches to one idea (a chapter, a row), so a failure is easy to localise.
- Command fields: [commands.md](commands.md). When unsure, print the live schema:

```js
const v = window.sabura.agent.describe().editRequestSchema.properties.commands.items;
JSON.stringify((v.oneOf || v.anyOf).find(c => c.properties.type.const === 'group_objects'))
```

## Tokens, retries, history

`editToken` is live session state. Read a fresh one for each new logical edit; human
edits and Undo/Redo make it stale. Focus/fit do not.

- `STALE_EDIT`: re-read, reconcile with current content, send a **new** request ID.
  Never just swap in a fresh token on an outdated plan.
- Uncertain delivery: resend the **exact** request (same ID, token, payload). The
  64-entry session cache deduplicates. After a page reload, re-read before retrying.
- `REQUEST_ID_REUSE`: same ID, different content. Fix the operation.
- `NOT_EDITABLE` / `EDITOR_BUSY`: resolve the real state, don't loop.
- `undo` / `redo` take `{requestId, expectedEditToken}` and act on the shared
  history, including the user's edits. Re-read before using them. Group Redo is
  broken (see SKILL.md); verify state after history operations.

## View and save

```js
a.focusObjects(['in','out','in_out'], { padding: 80 });   // frame a chapter
a.fitBoard();                                              // overview
a.saveCopy()  // { exportPrepared, downloadRequested, deliveryConfirmed:false, filename, byteLength }
```

Focus/fit can return `EDITOR_BUSY`, notably in Presentation mode (use UI zoom/pan
there). Then take a screenshot (`mcp__Claude_Browser__computer` → `screenshot`).
Save Copy has no request-ID dedupe; don't repeat an uncertain download.

## Images

`create_image` needs `object` (`type:'image'`, `assetId`, optional `fit`) and `asset`
(`id`, `type:'raster'`, `data` as base64/data URL, `mimeType` png|jpeg|webp,
`width`, `height`). IDs must agree. It does not fetch URLs or read file paths, so
authorized bytes must be supplied. Never use placeholder assets. If bytes cannot be
supplied, use the UI picker and ask the user to choose the file. The API image path
is **unverified** end to end (no picker-free import was exercised in this port).

## Layout recipe that worked (25 objects, 3 batches)

Clear sample objects → one batch for title, captions and 8 shapes (200×90, 70 gap,
two rows in a snake) → one batch for connectors plus a dashed curved feedback loop →
`fitBoard()` → screenshot → one fix batch (`set_typography`, `configure_connector`,
`move_objects`). `saveCopy()` returned `exportPrepared`/`downloadRequested` true,
`deliveryConfirmed` false, ~420 KB file named `sabura-<title>-r<revision>.html`.

## Verified in this port (2026-10-12, hosted build)

Hosted editor opened in the built-in browser; `window.sabura.agent` present;
`setMode('editing')` worked; atomic create + connect succeeded and rendered;
`focusObjects` worked; `group_objects` + Undo + Redo reproduced the missing-group
defect. Save and reopen also verified: the downloaded file matched `byteLength`
(419,687 bytes), reopened over localhost with 25/25 objects, 8/8 attached
connectors, no load errors, Reading mode, and a working `window.sabura.agent`.
Not exercised here: images, presentation mode, WebMCP (not exposed in this pane).
