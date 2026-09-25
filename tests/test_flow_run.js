const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const elements=new Map();
function element(id){
  if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,open:false,dataset:{},showModal(){this.open=true;},close(){this.open=false;},scrollHeight:0,scrollTop:0,clientHeight:0,replaceChildren(...items){this.children=items;}});
  return elements.get(id);
}
let now=100000;
const ctx=vm.createContext({Date:{now:()=>now},$:element,SERVER:{token:'token'},DATA:{name:'test.tfl',exportKey:'flow',editRevision:'revision'},flowSession:{history:{changes:[{expression:'edited'}]}},crypto:{randomUUID:()=> 'request-id-12345678'},esc:v=>String(v),setFlowEditBusy:v=>{ctx.busy=v;},document:{createElement:()=>({})},setTimeout:()=>1,clearTimeout:()=>{}});
vm.runInContext(fs.readFileSync(require.resolve('../web/flow-run.js'),'utf8'),ctx);
function state(code){return vm.runInContext(code,ctx);}
const outputs=[{id:'a',name:'CSV output',type:'WriteToCsv',path:'C:/out/a.csv',folder:'C:/out',filename:'a.csv',details:[]},{id:'b',name:'Hyper output',type:'WriteToHyper',path:'C:/out/b.hyper',folder:'C:/out',filename:'b.hyper',details:[]}];
ctx.outputs=outputs;
state("runState.outputs=outputs;runState.ready=true;runState.cli='cli';");
async function main(){
  let calls=[];
  ctx.fetch=async(url,request)=>{
    calls.push({url,payload:JSON.parse(request.body)});
    assert.equal(request.headers['X-Viewer-Token'],'token');
    return {ok:true,json:async()=>({job:{requestId:'request-id-12345678',name:'test.tfl',running:true,state:'running',elapsedMs:5000,outputs:[outputs[0]],logs:[{time:'12:00',message:'started',level:'info'}]}})};
  };
  await ctx.startRun(['a']);
  assert.deepEqual(calls[0].payload.outputs,['a']);
  assert.deepEqual(calls[0].payload.changes,[{expression:'edited'}]);
  assert.equal(ctx.busy,true);
  assert.equal(element('run-all').disabled,true);
  assert.equal(element('close-run').disabled,true);
  assert.equal(element('run-progress-dialog').open,true);
  assert.equal(element('run-spinner').hidden,false);
  now+=5000;ctx.updateRunClock();
  assert.equal(element('run-time').textContent,'00:00:10');
  assert.equal(element('run-time-label').textContent,'経過時間');
  await ctx.startRun(['b']);
  assert.equal(calls.length,1,'must prevent simultaneous starts');
  ctx.fetch=async()=>({ok:true,json:async()=>({job:{running:false,state:'error',elapsedMs:65000,outputs:[outputs[0]],logs:[{time:'12:01',message:'failed',level:'error'}]}})});
  await ctx.pollRun();
  assert.equal(ctx.busy,false);
  assert.equal(element('run-status').textContent,'実行失敗');
  assert.equal(element('run-time').textContent,'00:01:05');
  now+=120000;ctx.updateRunClock();
  assert.equal(element('run-time').textContent,'00:01:05','finished duration must stay frozen');
  assert.equal(element('run-time-label').textContent,'所要時間');
  assert.equal(element('run-spinner').hidden,true);
  assert.equal(element('run-log').children[0].textContent,'12:01  failed');
  ctx.fetch=async()=>({ok:false,json:async()=>({error:'元ファイルが変更されています'})});
  await ctx.startRun(['a','b']);
  assert.match(element('run-progress-error').textContent,/元ファイル/);
  assert.equal(ctx.busy,false);
  ctx.fetch=async()=>{throw Error('response lost');};
  await ctx.startRun(['a','b']);
  assert.equal(ctx.busy,true);
  assert.equal(state('runState.pendingId'),'request-id-12345678');
  calls=[];
  ctx.fetch=async(url,request)=>{
    calls.push(JSON.parse(request.body));
    return {ok:true,json:async()=>url.endsWith('/status')?{job:null}:{job:{requestId:'request-id-12345678',running:false,state:'success',outputs,logs:[]}}};
  };
  await ctx.pollRun();
  assert.equal(calls[1].requestId,'request-id-12345678','uncertain request retries with the same id');
  assert.deepEqual(calls[1].outputs,['a','b']);
  assert.equal(ctx.busy,false);
  assert.equal(element('run-status').textContent,'実行完了');
  assert.match(element('run-outputs').innerHTML,/a.csv/);
  state("runState.job={requestId:'cancel-request',running:true,state:'running',outputs,logs:[],elapsedMs:10000};runState.running=true");
  ctx.fetch=async(url,options)=>{assert.equal(url,'/api/run/cancel');assert.equal(JSON.parse(options.body).requestId,'cancel-request');return {ok:true,json:async()=>({job:{requestId:'cancel-request',running:false,state:'cancelled',elapsedMs:12000,outputs,logs:[]}})};};
  await ctx.cancelRun();
  assert.equal(element('run-status').textContent,'キャンセルしました');
  assert.equal(element('run-time').textContent,'00:00:12');
  assert.equal(element('run-cancel').hidden,true);
  assert.equal(element('run-progress-done').hidden,false);
  assert.equal(element('run-cancel-note').hidden,false);
  assert.equal(ctx.runDuration(3601000),'01:00:01');
  console.log('Flow execution UI: individual/all, confirmed edits, busy guard, errors, logs and idempotent recovery passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
