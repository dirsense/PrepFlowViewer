/* The server owns execution, so reconnecting never starts a second process. */
const runState={outputs:[],busy:false,running:false,ready:false,timer:null,clock:null,job:null,cli:'',pendingId:null,pendingPayload:null,cancelBusy:false,elapsedAnchor:0,startingAt:0,targets:[]};
async function runRequest(action,payload={}){
  const response=await fetch('/api/run/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Viewer-Token':SERVER.token},body:JSON.stringify(payload)});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'実行処理に失敗しました。');
  return data;
}
function runError(message=''){
  const id=$('run-progress-dialog').open?'run-progress-error':'run-error';
  $(id).textContent=message;$(id).hidden=!message;
}
function runDuration(milliseconds){
  const seconds=Math.max(0,Math.floor((Number(milliseconds)||0)/1000));
  return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
}
function updateRunClock(){
  clearTimeout(runState.clock);
  const job=runState.job,active=runState.busy||runState.running||!!runState.pendingId;
  const elapsed=job?(Number(job.elapsedMs)||0)+(job.running?Math.max(0,Date.now()-runState.elapsedAnchor):0):runState.startingAt?Date.now()-runState.startingAt:0;
  $('run-time-label').textContent=active?'経過時間':'所要時間';
  $('run-time').textContent=runDuration(elapsed);
  if(active&&$('run-progress-dialog').open)runState.clock=setTimeout(updateRunClock,250);
}
function renderRunProgress(){
  const active=runState.busy||runState.running||!!runState.pendingId;
  const cancelling=runState.cancelBusy||runState.job?.state==='cancelling';
  $('run-status').textContent=runState.pendingId?'実行状態を確認中…':cancelling?'キャンセル中…':runState.running?'実行中…':runState.busy?'実行を準備中…':({success:'実行完了',error:'実行失敗',cancelled:'キャンセルしました'})[runState.job?.state]||'待機中';
  $('run-progress-dialog').dataset.state=active?'running':runState.job?.state||'idle';
  $('run-spinner').hidden=!active;
  $('close-run-progress').disabled=active;
  $('run-progress-done').hidden=active;
  $('run-cancel').hidden=!active;
  $('run-cancel').disabled=!runState.job?.running||cancelling||!!runState.pendingId;
  $('run-cancel').textContent=cancelling?'停止中…':'キャンセル';
  $('run-cancel-note').hidden=!active&&runState.job?.state!=='cancelled';
  $('run-progress-name').textContent=runState.job?.name||DATA.name;
  $('run-progress-targets').textContent='実行対象：'+(runState.job?.outputs||runState.targets).map(item=>item.name).join('、');
  updateRunClock();
}
function showRunProgress(){
  if(!$('run-progress-dialog').open)$('run-progress-dialog').showModal();
  renderRunProgress();
}
function renderRun(){
  const blocked=runState.busy||runState.running||!runState.ready||!!runState.pendingId;
  const formats={WriteToCsv:'CSV',WriteToHyper:'Hyper',WriteToExcel:'Excel',WriteToJson:'JSON',WriteToDatabase:'データベース',PublishExtract:'データソース'};
  const selected=new Set((runState.job?.outputs||[]).map(item=>item.id));
  $('run-outputs').innerHTML=runState.outputs.length?runState.outputs.map(item=>{
    // Older running servers / completed jobs may still include the internal tdsOutput setting.
    const details=item.details.filter(([label])=>label!=='データソース定義');
    const fields=item.path?[['保存先',item.folder],['ファイル名',item.filename],...details]:details;
    const status=selected.has(item.id)?({running:'実行中',cancelling:'停止中',cancelled:'キャンセル',success:'完了',error:'失敗'})[runState.job?.state]||'':'';
    return `<li class="run-output"><div><strong>${esc(item.name)}</strong><span class="run-format">${esc(formats[item.type]||item.type)}</span><dl>${fields.length?fields.map(([name,value])=>`<div><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`).join(''):'<div><dd>保存先の詳細はステップの出力設定を確認してください。</dd></div>'}</dl></div><div class="run-output-action"><span>${esc(status)}</span><button class="button" data-run-output="${esc(item.id)}" ${blocked||!runState.cli?'disabled':''}>実行</button></div></li>`;
  }).join(''):'<li class="batch-empty">出力ステップがありません。</li>';
  $('run-all').disabled=blocked||!runState.cli||!runState.outputs.length;
  $('run-output-count').textContent=`出力ステップ（${runState.outputs.length}件）`;
  $('run-last-result').hidden=!runState.job||runState.running;
  for(const id of ['run-pick-cli','run-pick-credentials','run-clear-credentials'])$(id).disabled=blocked;
  $('close-run').disabled=runState.busy||runState.running||!!runState.pendingId;
  renderRunProgress();
}
function applyRunJob(job){
  runState.job=job;runState.running=!!job?.running;runState.elapsedAnchor=Date.now();
  if(job){
    const log=$('run-log'),atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<30;
    log.replaceChildren(...job.logs.map(item=>{const line=document.createElement('div');line.className=item.level;line.textContent=`${item.time}  ${item.message}`;return line;}));
    if(atBottom)log.scrollTop=log.scrollHeight;
  }
  setFlowEditBusy(runState.busy||runState.running||!!runState.pendingId);renderRun();
}
function scheduleRunPoll(){clearTimeout(runState.timer);runState.timer=setTimeout(pollRun,1000);}
async function pollRun(){
  try{
    const data=await runRequest('status');
    if(runState.pendingId){
      if(data.job?.requestId===runState.pendingId){runState.pendingId=null;runError();}
      else{
        // Retry the same idempotent request if its acknowledgement was lost.
        const response=await fetch('/api/run/start',{method:'POST',headers:{'Content-Type':'application/json','X-Viewer-Token':SERVER.token},body:JSON.stringify(runState.pendingPayload)});
        const retry=await response.json();
        runState.pendingId=null;runState.pendingPayload=null;
        if(!response.ok){applyRunJob({state:'error',running:false,name:DATA.name,outputs:runState.targets,logs:[],elapsedMs:Date.now()-runState.startingAt});runError(retry.error||'実行を開始できませんでした。');return;}
        data.job=retry.job;
      }
    }
    applyRunJob(data.job);runError();
    if(runState.running)scheduleRunPoll();
  }catch(error){runError('実行状況を確認できません。接続の回復を待っています。');scheduleRunPoll();}
}
async function openRun(){
  if(!CAN_EDIT||flowEditBusy||loadingFlow)return;
  if([...formulaDrafts.values()].some(d=>d.dirty)){toast('編集中の計算式を「変更を確定」してから開いてください。');return;}
  runState.busy=true;runState.ready=false;runState.job=null;runState.outputs=[];runError();
  $('run-log').replaceChildren();$('run-flow-name').textContent=DATA.name;$('run-dialog').showModal();
  setFlowEditBusy(true);renderRun();
  try{
    const data=await runRequest('options',{exportKey:DATA.exportKey});
    runState.outputs=data.outputs;runState.cli=data.cli;runState.ready=true;
    $('run-cli').value=data.cli;$('run-credentials').value=data.credentials;
    if(data.job?.running||data.job&&(data.job.exportKey===DATA.exportKey||data.job.sourcePath===DATA.sourcePath)){
      if(data.job.running){runState.outputs=data.job.outputs;$('run-flow-name').textContent=data.job.name;}
      applyRunJob(data.job);if(data.job.running){showRunProgress();scheduleRunPoll();}
    }
  }catch(error){runError(error.message);}
  finally{runState.busy=false;setFlowEditBusy(runState.running);renderRun();}
}
async function selectRunSetting(action){
  if(runState.busy||runState.running)return;
  runState.busy=true;setFlowEditBusy(true);runError();renderRun();
  try{
    const data=await runRequest(action);runState.cli=data.cli;
    $('run-cli').value=data.cli;$('run-credentials').value=data.credentials;
  }catch(error){runError(error.message);}
  finally{runState.busy=false;setFlowEditBusy(false);renderRun();}
}
async function startRun(ids){
  if(runState.busy||runState.running||runState.pendingId||!runState.ready||!runState.cli||!ids.length)return;
  const requestId=crypto.randomUUID();
  const payload={exportKey:DATA.exportKey,revision:DATA.editRevision,changes:flowSession?.history.changes||[],outputs:ids,requestId};
  runState.targets=runState.outputs.filter(item=>ids.includes(item.id));runState.startingAt=Date.now();
  runState.busy=true;runError();runState.job=null;$('run-log').replaceChildren();setFlowEditBusy(true);showRunProgress();runError();renderRun();
  try{
    const response=await fetch('/api/run/start',{method:'POST',headers:{'Content-Type':'application/json','X-Viewer-Token':SERVER.token},body:JSON.stringify(payload)});
    const data=await response.json();
    if(!response.ok){applyRunJob({state:'error',running:false,name:DATA.name,outputs:runState.targets,logs:[],elapsedMs:Date.now()-runState.startingAt});runError(data.error||'実行を開始できませんでした。');return;}
    applyRunJob(data.job);if(runState.running)scheduleRunPoll();
  }catch(error){
    // An interrupted response is not proof the process failed to start.
    runState.pendingId=requestId;runState.pendingPayload=payload;runError('通信が途切れたため、実行状態を確認しています。');scheduleRunPoll();
  }finally{runState.busy=false;setFlowEditBusy(runState.running||!!runState.pendingId);renderRun();}
}
async function cancelRun(){
  if(!runState.running||runState.cancelBusy||!runState.job||runState.job.cancelRequested)return;
  runState.cancelBusy=true;runError();renderRunProgress();
  try{const data=await runRequest('cancel',{requestId:runState.job.requestId});applyRunJob(data.job);if(runState.running)scheduleRunPoll();}
  catch(error){runError(error.message);}
  finally{runState.cancelBusy=false;renderRunProgress();}
}
function setupFlowRun(){
  $('run-button').onclick=openRun;
  $('close-run').onclick=()=>{if(!runState.busy&&!runState.running&&!runState.pendingId)$('run-dialog').close();};
  $('run-dialog').addEventListener('cancel',e=>{if(runState.busy||runState.running||runState.pendingId)e.preventDefault();});
  const closeProgress=()=>{if(!runState.busy&&!runState.running&&!runState.pendingId){$('run-progress-dialog').close();clearTimeout(runState.clock);}};
  $('close-run-progress').onclick=closeProgress;$('run-progress-done').onclick=closeProgress;
  $('run-progress-dialog').addEventListener('cancel',e=>{if(runState.busy||runState.running||runState.pendingId)e.preventDefault();else clearTimeout(runState.clock);});
  $('run-last-result').onclick=showRunProgress;$('run-cancel').onclick=cancelRun;
  $('run-pick-cli').onclick=()=>selectRunSetting('cli');
  $('run-pick-credentials').onclick=()=>selectRunSetting('credentials');
  $('run-clear-credentials').onclick=()=>selectRunSetting('clear-credentials');
  $('run-all').onclick=()=>startRun(runState.outputs.map(item=>item.id));
  $('run-outputs').onclick=e=>{const button=e.target.closest('[data-run-output]');if(button)startRun([button.dataset.runOutput]);};
  // Recover an active run after a browser reload, without issuing another start.
  runRequest('status').then(data=>{if(data.job?.running){
    runState.outputs=data.job.outputs;runState.ready=true;
    applyRunJob(data.job);showRunProgress();scheduleRunPoll();
  }}).catch(()=>{});
}
