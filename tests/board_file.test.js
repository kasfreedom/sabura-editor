// Board files without a browser: src/board-file.js and bin/sabura-board.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BoardFileError, createBoardFile, editBoardFile, readBoardFile, summarizeBoard,
} from '../src/board-file.js';
import { RUNTIME_SCRIPT_ID } from '../src/storage/file-packer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const editorHtml = readFileSync(path.join(root, 'sabura.html'), 'utf8');
const runtimeOf = (html) => html.match(new RegExp(`<script id="${RUNTIME_SCRIPT_ID}">([\\s\\S]*?)</script>`))[1];

const rect = (id, x, text) => ({ type: 'create_object', object: { id, type: 'rectangle', x, y: 0, width: 160, height: 80, text } });
const R1 = 'aaaaaaaaaaaa1111';
const R2 = 'bbbbbbbbbbbb2222';
const DIAGRAM = [
  rect('api', 0, 'API'),
  rect('db', 300, 'DB'),
  { type: 'connect_objects', connectorId: 'k', fromId: 'api', toId: 'db', text: 'reads' },
  { type: 'group_objects', groupId: 'g', ids: ['api', 'db'], name: 'Backend', frame: true },
];

function refused(fn) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof BoardFileError, `expected BoardFileError, got ${err}`);
    return err;
  }
  assert.fail('expected a refusal');
}

test('createBoardFile builds a valid board that keeps the editor runtime byte for byte', () => {
  const { html, document } = createBoardFile(editorHtml, { title: 'Stack', commands: DIAGRAM, revisionId: R1 });
  assert.equal(runtimeOf(html), runtimeOf(editorHtml));
  const reread = readBoardFile(html);
  assert.deepEqual(summarizeBoard(reread), {
    title: 'Stack', objects: 3, connectors: 1, groups: 1, revisionId: R1, parentRevisionId: null,
  });
  assert.equal(reread.groups.g.frame, true);
  assert.equal(reread.objects.k.text, 'reads');
  assert.equal(document.objects.api.text, 'API');
});

test('a new board starts empty, not from the template sample content', () => {
  const { document } = createBoardFile(editorHtml, { title: 'Empty' });
  assert.deepEqual(document.objects, {});
  assert.equal(document.title, 'Empty');
});

test('text that looks like markup or replacement patterns survives packing', () => {
  const tricky = 'end </script><script>alert(1)</script> $& $\' $` $$';
  const { html } = createBoardFile(editorHtml, { title: 'T', commands: [rect('x', 0, tricky)] });
  assert.equal(readBoardFile(html).objects.x.text, tricky);
  assert.equal(html.split('<script>alert(1)').length, 1, 'no raw script tag from board text');
});

test('every refused command is reported, and nothing is built', () => {
  const err = refused(() => createBoardFile(editorHtml, {
    title: 'T',
    commands: [
      { type: 'group_objects', groupId: 'g', objectIds: ['a', 'b'] },
      { type: 'connect_objects', connectorId: 'k', from: 'a', to: 'b' },
    ],
  }));
  assert.equal(err.errors.length, 2);
  assert.match(err.errors[0], /ids is required \(unknown field: objectIds\)/);
  assert.match(err.errors[1], /fromId is required/);
});

test('create refuses a missing title, a non-array batch and a template that is not a board', () => {
  assert.match(refused(() => createBoardFile(editorHtml, { commands: [] })).message, /title/);
  assert.match(refused(() => createBoardFile(editorHtml, { title: 'T', commands: {} })).message, /array/);
  assert.match(refused(() => createBoardFile('<html></html>', { title: 'T' })).message, /Not a valid Sabura board/);
});

test('editBoardFile applies commands and records the previous revision as parent', () => {
  const first = createBoardFile(editorHtml, { title: 'T', commands: DIAGRAM, revisionId: R1 });
  const second = editBoardFile(first.html, editorHtml, {
    commands: [{ type: 'set_text', id: 'db', text: 'Postgres' }], revisionId: R2,
  });
  const doc = readBoardFile(second.html);
  assert.equal(doc.objects.db.text, 'Postgres');
  assert.equal(doc.objects.api.text, 'API');
  assert.deepEqual([summarizeBoard(doc).revisionId, summarizeBoard(doc).parentRevisionId], [R2, R1]);
});

test('editing with no change keeps the revision', () => {
  const first = createBoardFile(editorHtml, { title: 'T', commands: DIAGRAM, revisionId: R1 });
  const same = editBoardFile(first.html, editorHtml, { commands: [] });
  assert.equal(summarizeBoard(readBoardFile(same.html)).revisionId, R1);
});

test('an edit is packed into the given editor, so document and runtime always match', () => {
  const first = createBoardFile(editorHtml, { title: 'T', commands: DIAGRAM });
  const olderRuntime = first.html.replace(runtimeOf(first.html), () => '/* older editor */');
  const edited = editBoardFile(olderRuntime, editorHtml, { commands: [{ type: 'set_text', id: 'db', text: 'X' }] });
  assert.equal(runtimeOf(edited.html), runtimeOf(editorHtml));
});

test('a refused edit names the missing object and leaves nothing half-applied', () => {
  const first = createBoardFile(editorHtml, { title: 'T', commands: DIAGRAM });
  const err = refused(() => editBoardFile(first.html, editorHtml, {
    commands: [{ type: 'set_text', id: 'db', text: 'ok' }, { type: 'set_text', id: 'nope', text: 'x' }],
  }));
  assert.match(err.errors.join('\n'), /nope/);
});

// --- CLI ---------------------------------------------------------------

const cli = path.join(root, 'bin', 'sabura-board.js');
const runCli = (args, input) => spawnSync(process.execPath, [cli, ...args], { input, encoding: 'utf8' });

test('CLI: new, edit and read round-trip through files and stdin', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sabura-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cmds = path.join(dir, 'c.json');
  writeFileSync(cmds, JSON.stringify(DIAGRAM));
  const a = path.join(dir, 'a.html');
  const b = path.join(dir, 'b.html');

  const made = runCli(['new', '--title', 'Stack', '--commands', cmds, '--out', a]);
  assert.equal(made.status, 0, made.stderr);
  assert.equal(JSON.parse(made.stdout).objects, 3);

  const edited = runCli(['edit', a, '--commands', '-', '--out', b], JSON.stringify([{ type: 'set_text', id: 'db', text: 'PG' }]));
  assert.equal(edited.status, 0, edited.stderr);
  assert.equal(JSON.parse(edited.stdout).parentRevisionId, JSON.parse(made.stdout).revisionId);

  const read = runCli(['read', b]);
  assert.equal(read.status, 0, read.stderr);
  assert.equal(JSON.parse(read.stdout).objects.db.text, 'PG');
});

test('CLI: refusals exit 1 with JSON errors; usage mistakes exit 2', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sabura-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'x.html');

  const bad = runCli(['new', '--title', 'T', '--commands', '-', '--out', out], '[{"type":"nope"}]');
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stderr).ok, false);
  assert.throws(() => readFileSync(out), /ENOENT/, 'no file written on refusal');

  assert.equal(runCli(['new', '--title', 'T', '--commands', '-', '--out', out], 'not json').status, 1);
  assert.equal(runCli(['edit', path.join(dir, 'missing.html'), '--commands', '-', '--out', out], '[]').status, 1);
  assert.equal(runCli(['new', '--title', 'T', '--commands', '-'], '[]').status, 2);
  assert.equal(runCli(['frobnicate']).status, 2);
  assert.equal(runCli(['new', '--bogus']).status, 2);
});

test('CLI: schema prints the published command schema', () => {
  const result = runCli(['schema']);
  assert.equal(result.status, 0);
  assert.ok(JSON.parse(result.stdout).oneOf.length > 10);
});
