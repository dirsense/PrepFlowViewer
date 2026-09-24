const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../web/viewer.js'), 'utf8');
function declaration(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/^(?:async )?function /m);
  return source.slice(start, next < 0 ? undefined : start + 1 + next);
}
async function check(route, outcome) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {disabled:false, hidden:true, value:''});
    return elements.get(id);
  };
  let context;
  context = vm.createContext({
    CAN_EDIT:true, SERVER:{token:'test'}, loadingFlow:false, flowEditBusy:false, nativeDropReady:false, dropDepth:0,
    DATA:{name:'test.tflx'}, flowSessions:new Map(), flowSession:{history:{}},
    $:element, closeRecent(){}, syncRecentPicker(){}, refreshRecent(){},
    toast(){}, showFileError(){}, encodeURIComponent,
    init(model) {
      context.DATA = model;
      context.updateFlowEditButtons();
      assert.equal(element('publish-button').disabled, true, 'disabled during init');
    },
    async fetch() {
      assert.equal(element('publish-button').disabled, true, 'disabled during request');
      if (outcome === 'error') throw new Error('test network failure');
      return {ok:true, json:async()=>outcome === 'cancel' ? {cancelled:true} : {name:'test.tflx'}};
    }
  });
  vm.runInContext(['updateFlowEditButtons','beginFlowLoad','endFlowLoad','loadRecent','loadFile','openFlowFile','beginNativeFlowDrop','finishNativeFlowDrop','handleFileDrop'].map(declaration).join('\n'), context);
  if (route === 'recent') await context.loadRecent('test-id');
  if (route === 'drop') await context.loadFile({name:'test.tflx'});
  if (route === 'open') await context.openFlowFile();
  if (route === 'native-drop') {
    context.nativeDropReady=true;
    let browserUpload=false;
    context.loadFile=()=>{browserUpload=true;};
    context.handleFileDrop({preventDefault(){},dataTransfer:{files:[{name:'test.tflx'}]}});
    assert.equal(browserUpload,false,'native drops must not also upload a temporary copy');
    assert.equal(context.beginNativeFlowDrop(),true);
    assert.equal(context.beginNativeFlowDrop(),false,'reject concurrent loads');
    context.finishNativeFlowDrop(outcome==='error'?null:{name:'test.tflx'},outcome==='error'?'missing file':null);
    context.nativeDropReady=false;
    context.handleFileDrop({preventDefault(){},dataTransfer:{files:[{name:'test.tflx'}]}});
    assert.equal(browserUpload,true,'ordinary browser drops retain the upload fallback');
  }
  assert.equal(context.loadingFlow, false);
  assert.equal(element('publish-button').disabled, false, `${route}/${outcome}: publish restored`);
  assert.equal(element('busy-overlay').hidden, true);
  context.flowEditBusy = true;
  context.endFlowLoad();
  assert.equal(element('publish-button').disabled, true, 'other work remains busy');
}
(async()=>{
  for (const route of ['recent','drop','open','native-drop']) {
    for (const outcome of ['success','error']) await check(route,outcome);
  }
  await check('open','cancel');
  console.log('Flow loading: publish restored after open, recent, drop, failure and cancellation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
