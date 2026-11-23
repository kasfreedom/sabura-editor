// Copied from bin/sabura-board.js by scripts/build-plugin.js (sabura-app/sabura-editor, MIT). Do not edit.
/**
 * sabura-board: make and change Sabura board files from the command line,
 * with the editor's own command checks. No browser, server or network.
 *
 *   sabura-board new  --title <title> --commands <file|-> --out <board.html>
 *   sabura-board edit <board.html> --commands <file|-> --out <board.html>
 *   sabura-board read <board.html>
 *   sabura-board schema
 *
 * Commands are a JSON array of sabura/commands/v1 agent commands, the same
 * ones window.sabura.agent.apply accepts. Results go to stdout as one JSON
 * object, with layout warnings (labels that don't fit, overlapping shapes) that
 * don't stop the file being written; refusals go to stderr as {"ok":false,"errors":[...]} with exit 1.
 * Usage mistakes exit 2. The editor runtime comes from ../sabura.html next to
 * this script, or from the parts in ../editor/ (the plugin ships it split so
 * every file stays small enough to be scanned), unless --editor names another
 * board file.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { AGENT_COMMAND_INPUT_SCHEMA } from './src/agent-api.mjs';
import { canonicalJson } from './src/core/document.mjs';
import { BoardFileError, createBoardFile, editBoardFile, layoutReport, readBoardFile, summarizeBoard } from './src/board-file.mjs';

const USAGE = `Usage:
  sabura-board new  --title <title> --commands <file|-> --out <board.html>
  sabura-board edit <board.html> --commands <file|-> --out <board.html>
  sabura-board read <board.html>
  sabura-board schema
Options: --editor <sabura.html>  editor runtime to package (default: bundled)`;

class UsageError extends Error {}

const MIN_NODE_MAJOR = 18;
const EDITOR_PART = /^sabura\.part(\d+)\.html$/;

/** The bundled editor: ../sabura.html, or ../editor/sabura.partN.html joined in order. */
function bundledEditor() {
  const single = new URL('../sabura.html', import.meta.url);
  if (existsSync(single)) return readFileSync(single, 'utf8');
  const dir = new URL('../editor/', import.meta.url);
  const parts = existsSync(dir)
    ? readdirSync(dir).filter((name) => EDITOR_PART.test(name))
      .sort((a, b) => Number(a.match(EDITOR_PART)[1]) - Number(b.match(EDITOR_PART)[1]))
    : [];
  if (parts.length === 0) {
    const err = new Error(`No Sabura editor next to this script: expected ${fileURLToPath(single)} or ${fileURLToPath(dir)}sabura.part1.html`);
    err.code = 'ENOENT';
    throw err;
  }
  return parts.map((name) => readFileSync(new URL(name, dir), 'utf8')).join('');
}

function readCommands(source) {
  if (!source) throw new UsageError('--commands is required');
  const text = source === '-' ? readFileSync(0, 'utf8') : readFileSync(source, 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new BoardFileError('Commands are not valid JSON', [err.message]);
  }
}

function requireOut(values) {
  if (!values.out) throw new UsageError('--out is required');
  return values.out;
}

function run(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      title: { type: 'string' },
      commands: { type: 'string' },
      out: { type: 'string' },
      editor: { type: 'string' },
    },
  });
  const [action, file, ...extra] = positionals;
  if (extra.length) throw new UsageError(`Unexpected argument: ${extra[0]}`);
  const editorHtml = () => (values.editor ? readFileSync(values.editor, 'utf8') : bundledEditor());

  switch (action) {
    case 'new': {
      if (file) throw new UsageError(`Unexpected argument: ${file}`);
      const out = requireOut(values);
      const commands = readCommands(values.commands);
      const result = createBoardFile(editorHtml(), { title: values.title, commands });
      writeFileSync(out, result.html);
      return { ok: true, file: out, bytes: Buffer.byteLength(result.html), ...summarizeBoard(result.document), ...layoutReport(result.document) };
    }
    case 'edit': {
      if (!file) throw new UsageError('edit needs a board file');
      const out = requireOut(values);
      const commands = readCommands(values.commands);
      const result = editBoardFile(readFileSync(file, 'utf8'), editorHtml(), { commands });
      writeFileSync(out, result.html);
      return { ok: true, file: out, bytes: Buffer.byteLength(result.html), ...summarizeBoard(result.document), ...layoutReport(result.document) };
    }
    case 'read': {
      if (!file) throw new UsageError('read needs a board file');
      return { raw: canonicalJson(readBoardFile(readFileSync(file, 'utf8'))) };
    }
    case 'schema':
      return { raw: JSON.stringify(AGENT_COMMAND_INPUT_SCHEMA, null, 2) };
    default:
      throw new UsageError(action ? `Unknown action: ${action}` : 'No action given');
  }
}

function main() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) {
    process.stderr.write(JSON.stringify({ ok: false, errors: [`Node ${MIN_NODE_MAJOR} or newer is required (found ${process.versions.node})`] }) + '\n');
    return 1;
  }
  try {
    const result = run(process.argv.slice(2));
    process.stdout.write((result.raw ?? JSON.stringify(result)) + '\n');
    return 0;
  } catch (err) {
    if (err instanceof UsageError || err?.code?.startsWith?.('ERR_PARSE_ARGS')) {
      process.stderr.write(`${err.message}\n\n${USAGE}\n`);
      return 2;
    }
    if (err instanceof BoardFileError) {
      process.stderr.write(JSON.stringify({ ok: false, message: err.message, errors: err.errors }) + '\n');
      return 1;
    }
    if (err?.code === 'ENOENT' || err?.code === 'EACCES' || err?.code === 'EISDIR') {
      process.stderr.write(JSON.stringify({ ok: false, message: 'File error', errors: [err.message] }) + '\n');
      return 1;
    }
    throw err;
  }
}

process.exitCode = main();
