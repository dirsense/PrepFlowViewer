const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../web/viewer.js'),'utf8').replace(/\r\n/g,'\n');
const start=source.indexOf('async function exportHtml(){');
const end=source.indexOf('\n}\n',start)+2;
const button={textContent:'HTMLを保存'};
const messages=[];
const context=vm.createContext({CAN_EDIT:true,flowEditBusy:false,loadingFlow:false,DATA:{exportKey:'snapshot'},SERVER:{token:'token'},$:()=>button,toast:m=>messages.push(m)});
context.setFlowEditBusy=value=>{context.flowEditBusy=value;};
vm.runInContext(source.slice(start,end),context);
(async()=>{
  for(const [ok,result,expected] of [[true,{name:'flow.html'},'flow.html を保存しました'],[true,{cancelled:true},null],[false,{error:'保存できません'},'保存できません']]){
    messages.length=0;
    context.fetch=async(url,request)=>{
      assert.equal(url,'/api/save-html');
      assert.equal(request.headers['X-Viewer-Token'],'token');
      assert.deepEqual(JSON.parse(request.body),{exportKey:'snapshot'});
      assert.equal(context.flowEditBusy,true);
      return {ok,json:async()=>result};
    };
    await context.exportHtml();
    assert.deepEqual(messages,expected?[expected]:[]);
    assert.equal(context.flowEditBusy,false);
    assert.equal(button.textContent,'HTMLを保存');
  }
  context.flowEditBusy=true;
  context.fetch=()=>{throw Error('must not submit twice');};
  await context.exportHtml();
  console.log('HTML save: native request, cancel, failure, busy guard and button restoration passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
