const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../web/viewer.js'),'utf8');
function definition(name){
  const start=source.indexOf(`function ${name}(`),end=source.indexOf('\nfunction ',start+1);
  assert.ok(start>=0);return source.slice(start,end<0?undefined:end);
}
const context=vm.createContext({esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))});
vm.runInContext(['connectionInfo','outputSettingsHtml'].map(definition).join('\n'),context);
const output=raw=>({nodeType:'.v1.PublishExtract',kind:'output',name:'Output',raw});
let html=context.outputSettingsHtml(output({serverUrl:'https://tableau.example.invalid',projectName:'Sales / Reports',siteName:'Default',datasourceName:'Sales mart'}));
for(const value of ['サーバー','https://tableau.example.invalid','サイト','Default','プロジェクト','Sales / Reports','Sales mart','テーブルの作成'])assert.ok(html.includes(value),value);
assert.ok(html.indexOf('サーバー')<html.indexOf('プロジェクト'));
assert.ok(html.indexOf('プロジェクト')<html.indexOf('<dt>名前'));
html=context.outputSettingsHtml(output({serverUrl:'https://tableau.example.invalid',projectName:'Sales'}));
assert.ok(!html.includes('<dt>サイト'),'do not invent a site when absent');
html=context.outputSettingsHtml(output({siteContentUrl:''}));
assert.ok(html.includes('Default'));
assert.equal((html.match(/フローに情報なし/g)||[]).length,2,'missing metadata is explicit');
html=context.outputSettingsHtml(output({serverUrl:'<script>bad()</script>',projectName:'<img onerror=bad()>',siteName:'<b>Site</b>'}));
assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;b&gt;Site'));
html=context.outputSettingsHtml({...output({}),connection:{connectionAttributes:{server:'https://linked.example.invalid',projectname:'Linked project',site:''}}});
assert.ok(html.includes('https://linked.example.invalid'));assert.ok(html.includes('Linked project'));assert.ok(html.includes('Default'));
for(const [type,key,extension] of [['WriteToHyper','hyperOutputFile','hyper'],['WriteToCsv','csvOutputFile','csv'],['WriteToExcel','excelOutputFile','xlsx']]){
  html=context.outputSettingsHtml({nodeType:`.v1.${type}`,name:'Output',raw:{[key]:`C:\\exports\\Sales.${extension}`}});
  assert.ok(html.includes('C:\\exports'));assert.ok(html.includes('<dd>Sales</dd>'));
  assert.ok(!html.includes('<dt>サーバー'));assert.ok(!html.includes('<dt>プロジェクト'));
}
console.log('Output settings: published destination, missing metadata, escaping and file outputs passed.');
