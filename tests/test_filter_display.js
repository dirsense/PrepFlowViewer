const assert = require('node:assert/strict');
const fs = require('node:fs'),
  vm = require('./ui-test-context.cjs');
const filterContext = vm.createContext({});
vm.runInContext(
  fs.readFileSync(require.resolve('../web/filter-display.js'), 'utf8'),
  filterContext,
);
const filterDisplayRows = (...args) =>
  JSON.parse(JSON.stringify(filterContext.filterDisplayRows(...args)));
const filterRangeText = filterContext.filterRangeText;
assert.deepEqual(
  filterDisplayRows(
    {
      exclude: false,
      ranges: { F2: [{ startValue: null, endValue: null, includeStart: true, includeEnd: true }] },
    },
    'RangeFilter',
  ),
  [{ field: 'F2', summary: 'Keep：null' }],
);
assert.deepEqual(filterDisplayRows({ exclude: true, values: { F3: [null] } }, 'ValueFilter'), [
  { field: 'F3', summary: 'Exclude：null' },
]);
assert.deepEqual(
  filterDisplayRows({ exclude: true, values: { Word: ['"null"', '""', '"abc"'] } }, 'ValueFilter'),
  [{ field: 'Word', summary: 'Exclude："null"、""、"abc"' }],
);
assert.equal(
  filterRangeText({ startValue: '17.0', endValue: '18.0', includeStart: true, includeEnd: false }),
  '≥ 17.0 and < 18.0',
);
assert.equal(
  filterRangeText({ startValue: 0, endValue: 0, includeStart: true, includeEnd: true }),
  '0',
);
assert.equal(filterRangeText({ startValue: null, endValue: 10, includeEnd: true }), '≤ 10');
assert.equal(filterRangeText({ startValue: 0, endValue: null, includeStart: false }), '> 0');
console.log('Filters: null, literal strings, multiple values and range boundaries passed.');

// Exercise the real category and card rendering used by both Viewer and exported HTML.
const { declaration: viewerDeclaration } = require('./viewer-source.cjs');
const definition = viewerDeclaration;
const annotation = viewerDeclaration('ANNOTATIONS');
assert.ok(annotation);
let origin;
const context = vm.createContext({
  selected: 'step',
  PREP_ICONS: { annotations: { filter: 'filter.svg' } },
  esc: (v) =>
    String(v ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;'),
  expressionHtml: (text, target) => {
    origin = target;
    return '<pre>' + text + '</pre>';
  },
});
vm.runInContext(
  annotation + '\n' + ['changeCategory', 'actionIcon', 'actionHtml'].map(definition).join('\n'),
  context,
);
const action = {
  id: 'filter',
  type: 'FilterOperation',
  label: 'Filter',
  raw: {},
  expressions: [{ field: 'Condition', expression: '[Year] > 2020', references: ['Year'] }],
};
assert.equal(context.changeCategory(action), 'filters');
const card = context.actionHtml(action, 0);
assert.match(card, /filter\.svg/);
assert.match(card, /<h3>Filter<\/h3>/);
assert.match(card, /<span class="chip">Year<\/span>/);
assert.match(card, /\[Year\] > 2020/);
assert.equal(origin.actionId, 'filter');
assert.equal(origin.field, 'Condition');
console.log('Formula filters: filter category, icon, fields, expression and editor target passed.');
