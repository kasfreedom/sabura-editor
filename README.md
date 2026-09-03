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

Cross-product vision, strategy, and architecture live in the sibling
`../product` repository.
