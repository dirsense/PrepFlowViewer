const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./ui-test-context.cjs');
const storage = new Map([['prepflow.language', 'en']]);
function create(languages, showSwitcher, defaultLanguage = languages[0]) {
  return vm.createContext({
    UI_EXPORT_OPTIONS: { languages, showSwitcher, defaultLanguage },
    UI_CATALOGS: Object.fromEntries(
      languages.map((l) => [
        l,
        JSON.parse(fs.readFileSync(require.resolve(`../web/${l}.json`), 'utf8')),
      ]),
    ),
    document: {
      documentElement: { dataset: {}, lang: 'ja' },
      querySelectorAll: () => [],
      dispatchEvent() {},
    },
    CustomEvent: class {},
    navigator: { languages: ['en-US'] },
    localStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
  });
}
for (const [languages, expected] of [
  [['ja'], JSON.parse(fs.readFileSync(require.resolve('../web/ja.json'), 'utf8'))['Remove fields']],
  [['fr'], 'Supprimer les champs'],
  [['es'], 'Eliminar campos'],
]) {
  const context = create(languages, false);
  assert.equal(vm.runInContext('uiLanguage', context), languages[0]);
  assert.equal(context.ui('Remove fields'), expected);
  context.setUiLanguage('en');
  assert.equal(
    vm.runInContext('uiLanguage', context),
    languages[0],
    'unbundled languages cannot be selected',
  );
}
const multiple = create(['ja', 'fr'], true, 'fr');
assert.equal(
  vm.runInContext('uiLanguage', multiple),
  'fr',
  'first open follows export default, not desktop/browser locale',
);
multiple.setUiLanguage('ja');
assert.equal(
  vm.runInContext('uiLanguage', create(['ja', 'fr'], true, 'fr')),
  'ja',
  'HTML remembers an allowed choice',
);
assert.equal(
  storage.get('prepflow.language'),
  'en',
  'HTML preference must not change desktop preference',
);
assert.equal(create(['fr', 'es'], true).uiMessage('Added 1 flows.'), '1 flux ajoutés.');
console.log(
  'Exported HTML languages: Japanese-only, non-English catalogs, fixed/default locale and switch persistence passed.',
);
