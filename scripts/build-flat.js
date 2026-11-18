'use strict';

/*
 * Builds a folder-free copy of the game for hosting: 4 files that can be
 * uploaded to GitHub from any device without losing folders.
 *
 *   npm run build:flat   ->   upload/ { server.js, index.html, package.json, render.yaml }
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const out = path.join(root, 'upload');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);

// 1. Server: our code bundled into one file; express/socket.io stay npm dependencies.
const boards = fs.readdirSync(path.join(root, 'maps', 'boards')).filter((f) => f.endsWith('.js')).sort();
const entry = `
global.__MONOPOLY_BOARDS__ = [${boards.map((f) => `require('./maps/boards/${f}')`).join(', ')}];
const path = require('path');
const { createServer } = require('./server/index.js');
const PORT = Number(process.env.PORT) || 3000;
createServer({ indexFile: path.join(__dirname, 'index.html') }).server.listen(PORT, '0.0.0.0', () => {
  console.log('Monopoly Online running on port ' + PORT);
});
`;
esbuild.buildSync({
  stdin: { contents: entry, resolveDir: root, sourcefile: 'flat-entry.js', loader: 'js' },
  bundle: true,
  platform: 'node',
  target: 'node18',
  packages: 'external',
  outfile: path.join(out, 'server.js'),
  banner: { js: '// Monopoly Online — bundled server. Source: engine/, maps/, server/ in the full project.' },
  logLevel: 'error',
});

// 2. Client: CSS and JS inlined into one HTML page.
const js = esbuild.buildSync({
  entryPoints: [path.join(root, 'public', 'js', 'main.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  logLevel: 'error',
}).outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = ['themes.css', 'style.css'].map((f) => fs.readFileSync(path.join(root, 'public', 'css', f), 'utf8')).join('\n');
let html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
html = html
  .replace(/\s*<link rel="stylesheet" href="\/css\/themes.css" \/>/, '')
  .replace(/<link rel="stylesheet" href="\/css\/style.css" \/>/, () => `<style>\n${css}\n</style>`)
  .replace(/<script type="module" src="\/js\/main.js"><\/script>/, () => `<script>\n${js}\n</script>`);
if (html.includes('href="/css/') || html.includes('src="/js/')) throw new Error('Inlining failed');
fs.writeFileSync(path.join(out, 'index.html'), html);

// 3. package.json and render.yaml for the flat layout.
const pkg = require(path.join(root, 'package.json'));
const flatPkg = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  description: pkg.description,
  main: 'server.js',
  scripts: { start: 'node server.js' },
  engines: pkg.engines,
  dependencies: pkg.dependencies,
};
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify(flatPkg, null, 2) + '\n');
fs.copyFileSync(path.join(root, 'render.yaml'), path.join(out, 'render.yaml'));

console.log('Built upload/: ' + fs.readdirSync(out).join(', '));
