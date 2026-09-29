const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('./ui-test-context.cjs');
const source=fs.readFileSync(require.resolve('../web/viewer.js'),'utf8').replace(/\r\n/g,'\n');
const start=source.indexOf('async function exportHtml(){');
const end=source.indexOf('\n}\n',start)+2;
const elements=new Map();
const element=id=>{
  if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',hidden:false,disabled:false,value:'',checked:false,
    setAttribute(){},addEventListener(){},focus(){},close(){this.open=false;},showModal(){this.open=true;}});
  return elements.get(id);
};
const messages=[];
const context=vm.createContext({CAN_EDIT:true,flowEditBusy:false,loadingFlow:false,
  DATA:{exportKey:'snapshot',name:'current.tfl',sourcePath:'C:\\current.tfl'},SERVER:{token:'token'},
  $:element,esc:String,toast:m=>messages.push(m),closeRecent(){},updateFlowEditButtons(){}});
context.setFlowEditBusy=value=>{context.flowEditBusy=value;};
vm.runInContext(source.slice(start,end),context);
vm.runInContext(fs.readFileSync(require.resolve('../web/batch-export.js'),'utf8'),context);
context.document.addEventListener=()=>{};
context.setupDownloadMenu();
const run=code=>vm.runInContext(code,context);
(async()=>{
  context.openHtmlExport();
  assert.equal(run('htmlExportState.tab'),'single');
  assert.equal(element('html-source').value,'C:\\current.tfl');
  assert.equal(run('htmlExportState.showSwitcher'),false);
  assert.match(element('html-language-options').innerHTML,/type="radio"/);
  assert.doesNotMatch(element('html-language-options').innerHTML,/html-export-all/);
  assert.deepEqual(JSON.parse(JSON.stringify(context.htmlExportOptions())),{languages:['ja'],showSwitcher:false,defaultLanguage:'ja'});
  element('html-language-switcher').checked=true;element('html-language-switcher').onchange();
  assert.match(element('html-language-options').innerHTML,/type="checkbox"/);
  assert.match(element('html-language-options').innerHTML,/html-export-all/);
  element('html-language-options').onchange({target:{name:'html-export-all',checked:true}});
  assert.equal(run('htmlExportState.languages.length'),6);
  assert.equal(element('html-language-summary').textContent,'全選択');
  element('html-language-options').onchange({target:{name:'html-export-language',value:'fr',checked:false}});
  assert.equal(run('htmlExportState.languages.length'),5);
  element('html-language-options').onchange({target:{name:'html-export-all',checked:false}});
  assert.equal(run('htmlExportState.languages.length'),0);
  assert.equal(element('html-single-save').disabled,true);
  element('html-language-options').onchange({target:{name:'html-export-language',value:'ja',checked:true}});
  element('html-language-options').onchange({target:{name:'html-export-language',value:'en',checked:true}});
  context.setHtmlExportTab('batch');
  assert.equal(run('htmlExportState.languages.length'),2,'tab changes preserve language selection');
  element('html-language-switcher').checked=false;element('html-language-switcher').onchange();
  assert.equal(run('htmlExportState.languages.length'),1,'turning switcher off collapses to one language');
  context.setHtmlExportTab('single');
  for(const [ok,result,expected] of [[true,{name:'flow.html'},'flow.html を保存しました'],[true,{cancelled:true},null],[false,{error:'保存できません'},null]]){
    messages.length=0;
    context.fetch=async(url,request)=>{
      assert.equal(url,'/api/save-html');
      assert.equal(request.headers.get('X-Viewer-Token'),'token');
      assert.deepEqual(JSON.parse(request.body),{exportKey:'snapshot',htmlOptions:{languages:['ja'],showSwitcher:false,defaultLanguage:'ja'}});
      assert.equal(context.flowEditBusy,true);
      assert.equal(element('html-single-tab').disabled,true);
      return {ok,json:async()=>result};
    };
    await context.exportHtml();
    assert.deepEqual(messages,expected?[expected]:[]);
    assert.equal(context.flowEditBusy,false);
    assert.equal(context.batchIsBusy(),false);
    assert.equal(element('html-single-error').hidden,ok);
  }
  context.fetch=async()=>({ok:true,json:async()=>({cancelled:true})});
  await context.selectHtmlSource();
  assert.equal(run('htmlExportState.source.exportKey'),'snapshot','picker cancellation preserves source');
  context.fetch=async()=>({ok:true,json:async()=>({id:'other',name:'other.tfl',path:'C:\\other.tfl'})});
  await context.selectHtmlSource();
  assert.equal(context.DATA.exportKey,'snapshot','selecting export source must not replace the open flow');
  context.fetch=async(url,request)=>{
    assert.equal(JSON.parse(request.body).sourceId,'other');
    assert.equal(JSON.parse(request.body).exportKey,undefined);
    return {ok:true,json:async()=>({name:'other.html'})};
  };
  await context.exportHtml();
  context.flowEditBusy=true;
  context.fetch=()=>{throw Error('must not submit twice');};
  await context.exportHtml();
  context.flowEditBusy=false;
  run('htmlExportState.languages=[]');
  await context.exportHtml();
  console.log('HTML export: tabs, single/multiple languages, source selection, native save, cancel, errors and busy guards passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
