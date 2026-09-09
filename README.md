# Sabura editor

This repository contains the offline Sabura visual-document editor and the
self-contained `sabura.html` artifact.

A Sabura HTML file is both the editable document and the runtime required to
open it. Viewing, editing, presenting, and saving a local document must not
depend on the CLI or collaboration service.

## Development

```sh
npm install
npm test
npm run build
```

The build writes `sabura.html` in the repository root. The implemented document
format is described in `docs/canvas-v1-format.md`.

Agents that can execute JavaScript in the loaded page can use the versioned
[`window.sabura.agent` live-authoring API](docs/agent-api.md). It is an offline
façade over the same command, validation, history, rendering, and Save Copy
machinery used by the editor.

Cross-product vision, strategy, and architecture live in the sibling
`../product` repository.

## Design implementation handoff

[011 — Graphite interface layout](docs/handoffs/011-graphite-interface/brief.md)
records the approved visual direction, bundled reference previews, implementation
boundaries, implementation status and verification checklist. The approved
visual implementation is ready for independent review; read the brief and its
latest implementation report before acting.
