const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const elements=new Map();
function element(id){
  if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',hidden:false,disabled:false,value:'',checked:true,setAttribute(){}});
  return elements.get(id);
}
const context=vm.createContext({$:element,esc:value=>String(value),SERVER:{token:'test'}});
vm.runInContext(fs.readFileSync(require.resolve('../web/batch-export.js'),'utf8'),context);
async function main(){
  let calls=[];
  context.fetch=async(url,options)=>{
    const data=JSON.parse(options.body);calls.push(data.id);
    if(data.id==='bad')return {ok:false,json:async()=>({error:'壊れたフローです'})};
    return {ok:true,json:async()=>({path:'saved/'+data.id+'.html'})};
  };
  vm.runInContext("batchState.destination={id:'output',path:'saved'};addBatchItems([{id:'a',name:'A.tfl'},{id:'bad',name:'Bad.tfl'},{id:'b',name:'B.tfl'}]);",context);
  await context.convertBatch();
  assert.deepEqual(calls,['a','bad','b'],'failure must not stop subsequent conversions');
  assert.equal(element('batch-progress').textContent,'完了：保存 2件・失敗 1件');
  assert.equal(context.batchIsBusy(),false);
  assert.equal(element('close-batch').disabled,false);
  assert.match(element('batch-list').innerHTML,/壊れたフローです/);
  calls=[];
  context.fetch=async(url,options)=>{
    calls.push(JSON.parse(options.body).id);
    vm.runInContext('batchState.stop=true',context);
    return {ok:true,json:async()=>({path:'saved/a.html'})};
  };
  await context.convertBatch();
  assert.deepEqual(calls,['a']);
  assert.equal(element('batch-progress').textContent,'停止：保存 1件・失敗 0件・未処理 2件');
  const before=vm.runInContext('batchState.items.length',context);
  context.fetch=async()=>({ok:false,json:async()=>({error:'connection failed'})});
  await context.removeBatchItems(['a']);
  assert.equal(vm.runInContext('batchState.items.length',context),before,'failed removal keeps the list');
  const handlers={};
  context.document={addEventListener:(event,callback,capture)=>{assert.equal(capture,true);handlers[event]=callback;}};
  element('batch-dialog').addEventListener=()=>{};
  element('batch-dialog').open=true;
  element('batch-drop').classList={remove(){},add(){}};
  context.dropDepth=2;
  context.addDroppedBatchFiles=files=>{context.droppedFiles=files;};
  context.setupDownloadMenu();
  let prevented=false,stopped=false;
  const files=[{name:'one.tfl'},{name:'two.tflx'}];
  handlers.drop({dataTransfer:{files},preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
  assert.equal(prevented,true);
  assert.equal(stopped,true,'batch drops must not reach the ordinary flow-opening handler');
  assert.equal(context.droppedFiles,files,'all dropped files go to the batch list');
  assert.equal(context.dropDepth,0);
  console.log('Batch UI: continues after failure, reports outcomes, stops between files and preserves failed removals.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
