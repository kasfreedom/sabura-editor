/**
 * Copies the Sabura skill's runtime files into plugin/skills/sabura/:
 *   scripts/sabura-board.mjs   bin/sabura-board.js
 *   scripts/src/**.mjs         the editor modules it uses, unchanged except that
 *                              relative imports point at the .mjs copies
 *   editor/sabura.partN.html   the editor (sabura.html) in pieces of about
 *                              200 KB, split at line ends; the script joins them
 *
 * Installed plugins are copied away from this repo, so the skill folder must
 * hold everything it runs. Files are plain source (no bundling) and each stays
 * under 256 KiB, the largest file the Claude Directory's scanner reads. The
 * copies use .mjs so Node runs them as ES modules without a package.json, which
 * the Directory doesn't accept in a plugin.
 *
 * Generated: edit src/ or bin/, then run `npm run plugin:build`. `--check`
 * fails if the committed files are stale or an old generated file is left.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillDir = path.join(rootDir, 'plugin', 'skills', 'sabura');
const scriptsDir = path.join(skillDir, 'scripts');
const editorDir = path.join(skillDir, 'editor');

export const MAX_PLUGIN_FILE_BYTES = 256 * 1024;
const PART_TARGET_BYTES = 200 * 1024;

// bin/sabura-board.js and every module it reaches.
const MODULES = [
  'src/core/types.js',
  'src/core/markup.js',
  'src/core/color.js',
  'src/core/theme-colors.js',
  'src/core/geometry.js',
  'src/core/revision.js',
  'src/core/document.js',
  'src/core/commands.js',
  'src/core/json-schema.js',
  'src/core/layout-check.js',
  'src/storage/file-packer.js',
  'src/agent-api.js',
  'src/board-file.js',
];
const ENTRY = 'bin/sabura-board.js';

const IMPORT_SPEC = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+?)\.js\2/g;

/** Where a source file goes in the skill folder. */
function destination(rel) {
  if (rel === ENTRY) return path.join(scriptsDir, 'sabura-board.mjs');
  return path.join(scriptsDir, rel.replace(/\.js$/, '.mjs'));
}

/** The source with relative imports re-pointed at the copies; fails on imports that leave the set. */
function copySource(rel) {
  const from = path.posix.dirname(rel);
  const to = path.posix.dirname(path.relative(scriptsDir, destination(rel)).split(path.sep).join('/'));
  let code = fs.readFileSync(path.join(rootDir, rel), 'utf8').replace(/^#!.*\n/, '');
  code = code.replace(IMPORT_SPEC, (whole, lead, quote, spec) => {
    const target = path.posix.normalize(path.posix.join(from, `${spec}.js`));
    if (target !== ENTRY && !MODULES.includes(target)) throw new Error(`${rel} imports ${spec}.js, which is not copied into the plugin`);
    let next = path.posix.relative(to, path.posix.relative('.', destination(target).slice(scriptsDir.length + 1)));
    if (!next.startsWith('.')) next = `./${next}`;
    return `${lead}${quote}${next}${quote}`;
  });
  if (/\bfrom\s*['"]\.{1,2}\/[^'"]*\.js['"]/.test(code)) throw new Error(`${rel}: an import was not rewritten`);
  return `// Copied from ${rel} by scripts/build-plugin.js (sabura-app/sabura-editor, MIT). Do not edit.\n${code}`;
}

/** Splits text at line ends into consecutive pieces of at most about `target` bytes. */
export function splitAtLines(text, target = PART_TARGET_BYTES) {
  const parts = [];
  let current = '';
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) || []) {
    if (current && Buffer.byteLength(current + line) > target) {
      parts.push(current);
      current = '';
    }
    current += line;
  }
  if (current) parts.push(current);
  return parts;
}

/** Every generated file in the skill folder, by absolute path. */
export function pluginFiles() {
  const files = {};
  for (const rel of [...MODULES, ENTRY]) files[destination(rel)] = copySource(rel);
  splitAtLines(fs.readFileSync(path.join(rootDir, 'sabura.html'), 'utf8')).forEach((part, i) => {
    files[path.join(editorDir, `sabura.part${i + 1}.html`)] = part;
  });
  for (const [file, content] of Object.entries(files)) {
    const bytes = Buffer.byteLength(content);
    if (bytes >= MAX_PLUGIN_FILE_BYTES) {
      throw new Error(`${path.relative(rootDir, file)} is ${bytes} bytes; plugin files must stay under ${MAX_PLUGIN_FILE_BYTES}`);
    }
  }
  return files;
}

/** Files under the generated folders (and the old single-file editor) that are not generated now. */
function leftovers(wanted) {
  const found = [path.join(skillDir, 'sabura.html')];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push(full);
    }
  };
  walk(scriptsDir);
  walk(editorDir);
  return found.filter((file) => fs.existsSync(file) && !(file in wanted));
}

function main() {
  const check = process.argv.includes('--check');
  const wanted = pluginFiles();
  const stale = [];
  for (const file of leftovers(wanted)) {
    const rel = path.relative(rootDir, file);
    if (check) stale.push(`${rel} (should not exist)`);
    else {
      fs.rmSync(file);
      console.log(`removed ${rel}`);
    }
  }
  for (const [file, content] of Object.entries(wanted)) {
    const rel = path.relative(rootDir, file);
    if (check) {
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (current !== content) stale.push(rel);
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      console.log(`wrote ${rel} (${Buffer.byteLength(content).toLocaleString()} bytes)`);
    }
  }
  if (stale.length) {
    console.error(`Plugin files are stale: ${stale.join(', ')}. Run npm run plugin:build.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
