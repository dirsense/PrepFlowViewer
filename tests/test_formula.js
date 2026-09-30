const assert = require('node:assert/strict');
const { tokenizeFormula } = require('../web/formula.js');
const expression =
  '// [ignored] IF 100\nIF [売上] > 100 THEN "https://example.test" // inline\nELSE 0 /* multi\nline [ignored] */ END';
const tokens = tokenizeFormula(expression);
assert.equal(tokens.map((t) => t.text).join(''), expression);
assert.deepEqual(
  tokens.filter((t) => t.kind === 'comment').map((t) => t.text),
  ['// [ignored] IF 100', '// inline', '/* multi\nline [ignored] */'],
);
assert.deepEqual(
  tokens.filter((t) => t.kind === 'ref').map((t) => t.text),
  ['[売上]'],
);
assert.deepEqual(
  tokens.filter((t) => t.kind === 'str').map((t) => t.text),
  ['"https://example.test"'],
);
assert.deepEqual(
  tokens.filter((t) => t.kind === 'kw').map((t) => t.text),
  ['IF', 'THEN', 'ELSE', 'END'],
);
assert.equal(tokenizeFormula('DATETRUNC ("month", [Date])')[0].kind, 'fn');
for (const source of [
  "'it''s // a string'",
  '"escaped \\" // quote"',
  '/* incomplete',
  '// last line',
  '[日本語]]Name]',
  '#2026-09-17#',
  '<script>alert(1)</script>',
]) {
  assert.equal(
    tokenizeFormula(source)
      .map((t) => t.text)
      .join(''),
    source,
  );
}
assert.equal(tokenizeFormula("'it''s // a string'").length, 1);
assert.equal(tokenizeFormula('/* incomplete')[0].kind, 'comment');
assert.equal(tokenizeFormula('#2026-09-17#')[0].kind, 'date');
console.log('Formula tokenizer: comments, strings, references, functions, and exact text passed.');
