# Sabura

Sabura lets Claude draw diagrams you can keep and edit. Ask for a flowchart,
architecture map, org chart or visual explainer, and Claude gives you one
`.html` file: the board and the full Sabura editor together. It opens offline in
any modern browser, with no account or install, and whoever opens it can move
shapes, change labels, draw, present, and save their own copy.

## Try it

- "Make a Sabura board of our checkout flow: cart, payment check, order
  confirmed, with a branch when payment fails."
- "Draw our system architecture on a Sabura board: web app, API, worker queue
  and Postgres. Frame the backend services as one group."
- Attach a Sabura board and ask: "Rename Payment to Billing and add a Refunds
  step after it."

In the Claude app, open the file Claude shares to see and edit the board in the
chat, or download it. In Claude Code, Claude can also open the board in a
browser and change it while you watch.

## Install

- **Claude Code:** `/plugin marketplace add sabura-app/sabura-editor`, then
  `/plugin install sabura@sabura`.
- **Claude app and claude.ai:** download `sabura-plugin.zip` from the
  [latest release](https://github.com/sabura-app/sabura-editor/releases/latest),
  then open Plugins, choose Add, then Upload plugin.

Sabura needs Claude to be able to run code.

## What it runs and what it sends

The plugin contains instructions for Claude (`skills/sabura/SKILL.md`), the
Sabura editor (`skills/sabura/editor/`, one HTML file split into parts that the
script joins), and a Node.js script (`skills/sabura/scripts/sabura-board.mjs`,
with the editor's own modules in `scripts/src/`). Claude runs the script to build and
edit board files. It reads and writes only the files it is given, checks every
drawing command with the editor's own rules, and makes no network requests.
For live editing in Claude Code, Claude may start a local web server on
`127.0.0.1` to open the board in a browser, and stops it when done.

Sabura collects no data and sends nothing anywhere. Board files contain no
tracking and make no network requests when opened. The script is built from the
readable sources in this repository (`src/`, `bin/`) by `npm run plugin:build`.

- Privacy policy: https://sabura.enkitech.de/privacy/
- Docs and troubleshooting: https://sabura.enkitech.de/docs/
- Support: https://github.com/sabura-app/sabura-editor/issues

## License

MIT
