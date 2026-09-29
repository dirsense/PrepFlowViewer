const fs = require('node:fs');
const vm = require('node:vm');
const catalogs = Object.fromEntries(['en','fr','es','de','pt-BR'].map(locale =>
  [locale, JSON.parse(fs.readFileSync(require.resolve(`../web/${locale}.json`), 'utf8'))]));
const source = fs.readFileSync(require.resolve('../web/i18n.js'), 'utf8').replace(/uiCaptureStatic\(\);\s*uiRefresh\(\);\s*$/, '');
// Existing unit tests mock only the DOM they exercise. Load the real translator
// without its initial DOM scan so those tests retain their narrow fixtures.
exports.createContext = (globals = {}) => {
  const context = vm.createContext(globals);
  context.document ||= {};
  context.document.documentElement ||= {dataset: {}, lang: 'ja'};
  context.document.getElementById ||= () => null;
  context.Headers ||= Headers;
  context.navigator ||= {languages:['ja-JP'],language:'ja-JP'};
  context.UI_CATALOGS ||= catalogs;
  vm.runInContext(source, context);
  return context;
};
exports.runInContext = vm.runInContext;
