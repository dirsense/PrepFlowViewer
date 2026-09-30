const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const web = path.resolve(__dirname, '../web');
const assets = JSON.parse(fs.readFileSync(path.join(web, 'assets.json'), 'utf8'));

// A new file must be registered or it will disappear from both the live page
// and standalone exports. Syntax-check the combined scope to catch collisions.
for (const [kind, extension] of [
  ['scripts', '.js'],
  ['styles', '.css'],
]) {
  const files = assets[kind];
  assert.equal(new Set(files).size, files.length, `Duplicate ${kind} entry`);
  assert.deepEqual(
    [...files].sort(),
    fs
      .readdirSync(web)
      .filter((name) => name.endsWith(extension))
      .sort(),
  );
}
assert.equal(
  assets.scripts.at(-1),
  'viewer.js',
  'Register events only after all feature definitions',
);
const source = assets.scripts
  .map((name) => fs.readFileSync(path.join(web, name), 'utf8'))
  .join('\n');
new vm.Script(source, { filename: 'assembled-viewer.js' });
console.log('Web assets: complete manifest, unique files and valid combined script scope passed.');
