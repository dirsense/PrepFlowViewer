const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./ui-test-context.cjs');
const storage = new Map();
const context = vm.createContext({
  document: {documentElement:{dataset:{},lang:'ja'}, querySelectorAll:()=>[], dispatchEvent(){}},
  localStorage: {getItem:key=>storage.get(key), setItem:(key,value)=>storage.set(key,value)},
  CustomEvent: class {constructor(type){this.type=type;}},
});
const run = code => vm.runInContext(code, context);
for (const [languages, saved, expected] of [
  [['ja-JP','en-US'], null, 'ja'], [['en-US','ja'], null, 'en'],
  [['fr-FR'], null, 'fr'], [['fr-CA'], null, 'fr'],
  [['es-MX'], null, 'es'], [['de-AT'], null, 'de'],
  [['pt-BR'], null, 'pt-BR'], [['pt-PT'], null, 'pt-BR'],
  [['ko-KR','es-ES'], null, 'es'], [['zh-CN'], null, 'en'], [[], null, 'en'],
  [['en-US'], 'fr', 'fr'], [['ja-JP'], 'pt-BR', 'pt-BR'],
  [['ja-JP'], 'en', 'en'], [['en-US'], 'ja', 'ja'],
  [['ja-JP'], 'invalid', 'ja']
]) {
  const fresh=vm.createContext({navigator:{languages,language:languages[0]},
    localStorage:{getItem:()=>saved}});
  assert.equal(vm.runInContext('uiLanguage',fresh),expected,JSON.stringify({languages,saved}));
}
const desktop=vm.createContext({navigator:{languages:['ja-JP']},
  localStorage:{getItem:()=> 'ja'},
  document:{getElementById:()=>({textContent:'{"token":"local","language":"en"}'})}});
assert.equal(vm.runInContext('uiLanguage',desktop),'en','desktop preference wins over browser storage and locale');
const freshDesktop=vm.createContext({navigator:{languages:['ja-JP']},
  localStorage:{getItem:()=> 'en'},
  document:{getElementById:()=>({textContent:'{"token":"local","language":null}'})}});
assert.equal(vm.runInContext('uiLanguage',freshDesktop),'ja','first desktop visit uses environment, not another browser preference');
run("const labels=uiLabels({field:'計算フィールド'});");
assert.equal(context.ui('計算フィールド'),'計算フィールド');
context.setUiLanguage('en');
assert.equal(context.document.documentElement.lang,'en');
assert.equal(storage.get('prepflow.language'),'en');
assert.equal(run('labels.field'),'Calculated field');
assert.equal(context.ui('constructor'),'constructor','unknown keys cannot resolve prototype properties');
assert.equal(run('ui`<h3>計算フィールド</h3><p>${"日本語の売上"}</p>`'),'<h3>Calculated field</h3><p>日本語の売上</p>');
assert.equal(run('ui`<button title="変更を確定">${"変更を確定"}</button>`'),'<button title="Confirm changes">変更を確定</button>','interpolated user values stay verbatim even when identical to UI labels');
assert.equal(run('ui`${"売上.tflx"} を保存しました`'),'Saved 売上.tflx');
assert.equal(context.uiMessage('売上.tflx を保存しました'),'Saved 売上.tflx');
const element={isConnected:true,closest:()=>null};
context.uiBind(element,'textContent',()=>context.ui('計算フィールド'));
assert.equal(element.textContent,'Calculated field');
context.setUiLanguage('ja');
assert.equal(element.textContent,'計算フィールド');
assert.equal(run('labels.field'),'計算フィールド');
assert.equal(context.uiMessage('Saved 売上.tflx'),'売上.tflx を保存しました','an existing message switches back too');
context.setUiLanguage('xx');
assert.equal(context.document.documentElement.lang,'ja');
element.isConnected=false;
context.setUiLanguage('en');
assert.equal(run('uiBindings.size'),0,'detached bindings are released');

// Static text and attributes are captured once, before flow data is inserted.
const initial={nodeValue:'変更を確定',isConnected:true,parentElement:{closest:()=>null}};
const dynamic={nodeValue:'計算フィールド',isConnected:true,parentElement:{closest:()=>null}};
const attribute={isConnected:true,value:'変更を確定',getAttribute:n=>n==='title'?attribute.value:null,setAttribute:(n,v)=>{attribute.value=v;}};
let nodes=[initial];
context.document.body={}; context.NodeFilter={SHOW_TEXT:4};
context.document.createTreeWalker=()=>({nextNode:()=>nodes.shift()});
context.document.querySelectorAll=selector=>selector==='[title],[aria-label],[placeholder]'?[attribute]:[];
context.uiCaptureStatic(); nodes.push(dynamic); context.uiRefresh();
assert.equal(initial.nodeValue,'Confirm changes');
assert.equal(attribute.value,'Confirm changes');
assert.equal(dynamic.nodeValue,'計算フィールド');
context.setUiLanguage('ja');
assert.equal(initial.nodeValue,'変更を確定');

// Placeholders cannot disappear or get renumbered in translations.
const slots=text=>[...new Set(text.match(/\{\{\d+\}\}/g)||[])].sort();
const expectedNames={en:'Calculated field',fr:'Champ calculé',es:'Campo calculado',de:'Berechnetes Feld','pt-BR':'Campo calculado'};
const english=JSON.parse(fs.readFileSync(require.resolve('../web/en.json'),'utf8'));
for (const [locale, label] of Object.entries(expectedNames)) {
  const catalog=JSON.parse(fs.readFileSync(require.resolve(`../web/${locale}.json`),'utf8'));
  assert.deepEqual(Object.keys(catalog),Object.keys(english),locale);
  for (const [key,value] of Object.entries(catalog)) assert.deepEqual(slots(value),slots(key),`${locale}: ${key}`);
  context.setUiLanguage(locale);
  assert.equal(context.ui('計算フィールド'),label);
  assert.equal(context.document.documentElement.lang,locale);
  assert.equal(storage.get('prepflow.language'),locale);
  assert.equal(run('ui`<h3>計算フィールド</h3><p>${"日本語の売上"}</p>`'),`<h3>${label}</h3><p>日本語の売上</p>`);
  assert.equal(context.uiMessage('売上.tflx を保存しました'),catalog['{{0}} を保存しました'].replace('{{0}}','売上.tflx'));
  assert.equal(context.uiMessage('パブリッシュ中: C:/売上.tflx'),catalog['パブリッシュ中: ']+'C:/売上.tflx');
  const translated=run('ui`${"売上.tflx"} を保存しました`');
  context.setUiLanguage('ja');
  assert.equal(context.uiMessage(translated),'売上.tflx を保存しました');
}
(async()=>{
  context.fetch=async(url,options)=>{
    assert.equal(options.headers.get('X-Viewer-Language'),'ja');
    assert.equal(options.headers.get('X-Viewer-Token'),'secret');
    assert.equal(options.body,'unchanged');
  };
  await context.uiFetch('/api/save-html',{headers:{'X-Viewer-Token':'secret'},body:'unchanged'});
  console.log('Language: switching, persistence, authored text, user content, bindings, messages, placeholders and API headers passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
