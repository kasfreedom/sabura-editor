/**
 * Runs the plugin eval suite (evals/) against the plugin (plugin/).
 *
 * The suite lives outside the plugin folder because the Claude Directory only
 * accepts documents and images outside a plugin's skills, and a case's setup
 * script is neither. `claude plugin eval` reads cases from inside the plugin,
 * so this copies both into a temporary folder and runs them there. Results go
 * to evals/results/ (git-ignored).
 *
 *   npm run evals                       all cases, with a no-plugin baseline
 *   npm run evals -- --case edit-board  extra arguments go to claude plugin eval
 *
 * Needs the `claude` command line tool, signed in. Grants Bash, Write and Edit
 * to the runs, and runs each case's own setup script (--scaffold): the cases
 * are this repository's own.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sabura-evals-'));
const pluginCopy = path.join(work, 'sabura');
const resultsDir = path.join(rootDir, 'evals', 'results', new Date().toISOString().replace(/[:.]/g, '-'));

try {
  fs.cpSync(path.join(rootDir, 'plugin'), pluginCopy, { recursive: true });
  fs.cpSync(path.join(rootDir, 'evals'), path.join(pluginCopy, 'evals'), {
    recursive: true,
    filter: (src) => !src.startsWith(path.join(rootDir, 'evals', 'results')),
  });
  fs.mkdirSync(resultsDir, { recursive: true });
  const args = ['plugin', 'eval', pluginCopy,
    '--allow-tools', 'Bash', 'Write', 'Edit',
    '--scaffold', '--trust-plugin', '--no-publish',
    '--output-dir', resultsDir,
    '--report', path.join(resultsDir, 'report.html'),
    ...process.argv.slice(2)];
  const run = spawnSync('claude', args, { stdio: 'inherit' });
  if (run.error) throw run.error;
  console.log(`Results: ${path.relative(rootDir, resultsDir)}`);
  process.exitCode = run.status ?? 1;
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
