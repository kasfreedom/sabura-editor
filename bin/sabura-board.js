#!/usr/bin/env node
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
 * this script unless --editor names another board file.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { AGENT_COMMAND_INPUT_SCHEMA } from '../src/agent-api.js';
import { canonicalJson } from '../src/core/document.js';
import { BoardFileError, createBoardFile, editBoardFile, layoutReport, readBoardFile, summarizeBoard } from '../src/board-file.js';

const USAGE = `Usage:
  sabura-board new  --title <title> --commands <file|-> --out <board.html>
  sabura-board edit <board.html> --commands <file|-> --out <board.html>
  sabura-board read <board.html>
  sabura-board schema
Options: --editor <sabura.html>  editor runtime to package (default: bundled)`;

class UsageError extends Error {}

const MIN_NODE_MAJOR = 18;

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
  const editorPath = values.editor || fileURLToPath(new URL('../sabura.html', import.meta.url));

  switch (action) {
    case 'new': {
      if (file) throw new UsageError(`Unexpected argument: ${file}`);
      const out = requireOut(values);
      const commands = readCommands(values.commands);
      const result = createBoardFile(readFileSync(editorPath, 'utf8'), { title: values.title, commands });
      writeFileSync(out, result.html);
      return { ok: true, file: out, bytes: Buffer.byteLength(result.html), ...summarizeBoard(result.document), ...layoutReport(result.document) };
    }
    case 'edit': {
      if (!file) throw new UsageError('edit needs a board file');
      const out = requireOut(values);
      const commands = readCommands(values.commands);
      const result = editBoardFile(readFileSync(file, 'utf8'), readFileSync(editorPath, 'utf8'), { commands });
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
