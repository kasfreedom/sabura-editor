// Copies the current editor runtime (script and style) from sabura.html into
// each example board, keeping each board's own document. Run after `npm run build`
// so the examples test sees the current runtime.
//
// Usage: node scripts/refresh-examples.js [example.html ...]   (default: examples/*.html)
import fs from 'node:fs';
import path from 'node:path';

const editor = fs.readFileSync('sabura.html', 'utf8');
const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync('examples').filter((f) => f.endsWith('.html')).map((f) => path.join('examples', f));

function span(html, tag, id, file) {
  const open = `<${tag} id="${id}">`;
  const start = html.indexOf(open);
  const end = start < 0 ? -1 : html.indexOf(`</${tag}>`, start);
  if (start < 0 || end < 0) throw new Error(`${file}: missing <${tag} id="${id}">`);
  return [start + open.length, end];
}

for (const file of targets) {
  let html = fs.readFileSync(file, 'utf8');
  for (const [tag, id] of [['script', 'sabura-runtime-script'], ['style', 'sabura-runtime-style']]) {
    const [from, to] = span(editor, tag, id, 'sabura.html');
    const [start, end] = span(html, tag, id, file);
    html = html.slice(0, start) + editor.slice(from, to) + html.slice(end);
  }
  fs.writeFileSync(file, html);
  console.log(`refreshed ${file}`);
}
