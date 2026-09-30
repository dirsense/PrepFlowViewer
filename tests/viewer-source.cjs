const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('acorn');

const web = path.resolve(__dirname, '../web');
const assets = JSON.parse(fs.readFileSync(path.join(web, 'assets.json'), 'utf8'));
const declarations = new Map();

// Parse declarations instead of relying on filenames, line breaks or brace style.
// The narrow DOM fixtures can then execute just the real functions they exercise.
for (const name of assets.scripts) {
  const source = fs.readFileSync(path.join(web, name), 'utf8');
  const program = parse(source, { ecmaVersion: 'latest' });
  for (const node of program.body) {
    const names =
      node.type === 'FunctionDeclaration'
        ? [node.id.name]
        : node.type === 'VariableDeclaration'
          ? node.declarations.map((item) => item.id.name)
          : [];
    for (const name of names) {
      if (declarations.has(name)) throw new Error(`Duplicate declaration: ${name}`);
      declarations.set(name, source.slice(node.start, node.end));
    }
  }
}

exports.declaration = (name) => {
  if (!declarations.has(name)) throw new Error(`Missing declaration: ${name}`);
  return declarations.get(name);
};
