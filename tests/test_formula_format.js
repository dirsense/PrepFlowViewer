const assert=require('node:assert/strict');
const {tokenizeFormula}=require('../web/formula');
const {formatFormula,formulaBracketPairs}=require('../web/formula-format');
const significant=s=>tokenizeFormula(s).filter(t=>!(t.kind==='plain'&&/^\s+$/.test(t.text)));
const formulas=[
  'IF [x]>1 THEN SUM([a])+SUM([b]) ELSE 0 END',
  'IF [a] THEN IF [b] THEN 1 ELSE 2 END ELSEIF [c] THEN 3 ELSE 4 END',
  'CASE [x] WHEN 1 THEN "one" WHEN 2 THEN "two" ELSE "other" END',
  'TRIM(RIGHT([x],IF FIND([x],"(")>0 THEN LEN([x])-1 ELSE 0 END))',
  '{FIXED [Region]: SUM([Sales])}', '{{ORDERBY [F3] ASC: RANK()}}',
  'IF [x]>=10 AND [x]<>20 THEN -1.2e-3 ELSE +2 END',
  'SPLIT([str],",",1) // leave IF ( [x] exactly\n+ "https://example.test/(x)"',
  'SUM([a]) /* preserve\n    this (indent) */ + SUM([b])',
  "IF [a]]b] = 'it''s (x), y' THEN #2026-09-18# ELSE #2025-01-01# END",
  '"<script>alert(1)</script>"', 'IF [x] THEN "a\nb" ELSE "c" END',
  'IF [x] THEN 1', 'SUM([x]',
  'FUNC('+Array.from({length:20},(_,i)=>`[Long Field ${i}]`).join(',')+')',
];
for(const input of formulas){
  const result=formatFormula(input);
  assert.deepEqual(significant(result),significant(input),input);
  assert.equal(formatFormula(result),result,'Formatting must be stable: '+input);
}
assert.equal(formatFormula(formulas[0]),'IF [x] > 1 THEN\n  SUM([a]) + SUM([b])\nELSE\n  0\nEND');
assert.equal(formatFormula('SPLIT([x],",",1)'),'SPLIT([x], ",", 1)');
assert.match(formatFormula('{{ORDERBY [F3] ASC: RANK()}}'),/^\{\{[^]*\}\}$/);
assert.match(formatFormula(formulas.at(-1)),/FUNC\(\n  \[Long Field 0\],\n/);
assert.equal(formatFormula('IF [x] THEN 1'),'IF [x] THEN 1');

const input='SUM(([a]]b])) + "(not a pair)" // (ignored)\n+ {FIXED [x]: MAX([y])}';
const pairs=formulaBracketPairs(input);
assert.equal(pairs.get(3),12);
assert.equal(pairs.get(4),11);
assert.equal(pairs.get(5),10);
for(const [from,to] of pairs){
  assert.equal(pairs.get(to),from);
  assert.notEqual(from,to);
}
assert.ok(!pairs.has(input.indexOf('(not')));
assert.ok(!pairs.has(input.indexOf('(ignored')));
assert.equal(formulaBracketPairs('SUM([x]').has(3),false);
assert.equal(formulaBracketPairs('(}').size,0);
console.log('Formula display: stable formatting, exact literals/comments, LOD delimiters, nested blocks, and bracket matching passed.');
