// The plugin's skill folder must run on its own (installed plugins are copied
// away from this repo) and must match the current sources.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MAX_PLUGIN_FILE_BYTES, pluginFiles, splitAtLines } from '../scripts/build-plugin.js';
import { readBoardFile } from '../src/board-file.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(root, 'plugin');
const skillDir = path.join(pluginDir, 'skills', 'sabura');
const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const shipped = () => walk(pluginDir).map((file) => path.relative(pluginDir, file).split(path.sep).join('/'));

test('committed plugin files match the sources (run npm run plugin:build)', () => {
  for (const [file, content] of Object.entries(pluginFiles())) {
    assert.equal(readFileSync(file, 'utf8'), content, `${path.relative(root, file)} is stale`);
  }
});

test('the skill folder builds a valid board after being copied elsewhere', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sabura-skill-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(skillDir, path.join(dir, 'sabura'), { recursive: true });
  const out = path.join(dir, 'board.html');
  const commands = JSON.stringify([
    { type: 'create_object', object: { id: 'a', type: 'rectangle', x: 0, y: 0, width: 160, height: 80, text: 'A' } },
    { type: 'create_object', object: { id: 'b', type: 'rectangle', x: 300, y: 0, width: 160, height: 80, text: 'B' } },
    { type: 'connect_objects', connectorId: 'ab', fromId: 'a', toId: 'b', text: 'then' },
  ]);
  const result = spawnSync(process.execPath,
    [path.join(dir, 'sabura', 'scripts', 'sabura-board.mjs'), 'new', '--title', 'Copied', '--commands', '-', '--out', out],
    { input: commands, encoding: 'utf8', cwd: dir });
  assert.equal(result.status, 0, result.stderr);
  const doc = readBoardFile(readFileSync(out, 'utf8'));
  assert.equal(doc.objects.ab.text, 'then');
});

test('SKILL.md frontmatter uses only fields claude.ai uploads accept', () => {
  const md = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const front = md.match(/^---\n([\s\S]*?)\n---\n/)[1];
  const keys = front.split('\n').filter((l) => /^\w/.test(l)).map((l) => l.split(':')[0]);
  const allowed = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
  assert.deepEqual(keys.filter((k) => !allowed.has(k)), []);
  assert.match(front, /^name: sabura$/m, 'name must match the folder name');
  assert.ok(front.match(/^description: (.*)$/m)[1].length <= 1024);
});

test('the no-Node fallback in SKILL.md names the real escape for <', () => {
  // A lost backslash once turned this into "replace < with <", which would let
  // a label like </script> end the board's data block early.
  const skill = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const section = skill.slice(skill.indexOf("## If the script can't run"));
  assert.match(section, /with `\\u003C`/);
});

test('the editor parts join back into sabura.html exactly', () => {
  const parts = readdirSync(path.join(skillDir, 'editor')).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
  assert.ok(parts.length >= 2);
  const joined = parts.map((name) => readFileSync(path.join(skillDir, 'editor', name), 'utf8')).join('');
  assert.equal(joined, readFileSync(path.join(root, 'sabura.html'), 'utf8'));
  assert.deepEqual(splitAtLines('a\nb\nc', 2), ['a\n', 'b\n', 'c'], 'split keeps every byte, at line ends');
});

// The Claude Directory's checks for plugins from organizations that aren't
// Verified (as seen in its submission validator on 2026-11-23).
test('the plugin folder passes the Claude Directory file rules', () => {
  const files = shipped();
  for (const rel of files) {
    const full = path.join(pluginDir, rel);
    assert.ok(statSync(full).size < MAX_PLUGIN_FILE_BYTES, `${rel} is too large for the Directory's scanner`);
    assert.ok(!readFileSync(full, 'latin1').startsWith('#!'), `${rel} starts with #!`);
    assert.doesNotMatch(path.basename(rel), /^(package(-lock)?\.json|pnpm-workspace\.yaml|requirements\.txt|claude(\.local)?\.md|agents\.md)$/i, rel);
  }
  // Outside skills/, only documents and the icon.
  assert.deepEqual(files.filter((rel) => !rel.startsWith('skills/')).sort(),
    ['.claude-plugin/plugin.json', 'README.md', 'logo.png']);
  assert.deepEqual(files.filter((rel) => rel.endsWith('.svg')), [], 'an SVG other than the icon is refused');
});

test('shipped code names no code host, which the scanner reads as a possible credential leak', () => {
  // Documentation (README, plugin.json's repository field) may link to GitHub.
  for (const rel of shipped().filter((r) => /\.(mjs|html)$/.test(r))) {
    assert.doesNotMatch(readFileSync(path.join(pluginDir, rel), 'utf8'), /https?:\/\/(www\.)?github\.com/, rel);
  }
});
