/* Save menu and sequential batch conversion. The open flow and edit history stay intact. */
const batchState={items:[],destination:null,busy:false,running:false,stop:false};
function batchIsBusy(){return batchState.busy;}
async function batchRequest(action,payload={}){
  const response=await fetch('/api/batch/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Viewer-Token':SERVER.token},body:JSON.stringify(payload)});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'一括保存の処理に失敗しました。');
  return result;
}
function batchError(message=''){
  $('batch-error').textContent=message;$('batch-error').hidden=!message;
}
function renderBatch(){
  const state=batchState;
  $('batch-count').textContent=`対象ファイル ${state.items.length}件`;
  $('batch-list').innerHTML=state.items.length?state.items.map(item=>`<li class="batch-item ${item.status||''}"><div><strong>${esc(item.name)}</strong><small>${esc(item.location)}</small>${item.message?`<p>${esc(item.message)}</p>`:''}</div><span class="batch-item-status">${({running:'変換中',success:'保存済み',error:'失敗'})[item.status]||'待機中'}</span><button class="icon-button" data-batch-remove="${esc(item.id)}" aria-label="${esc(item.name)}をリストから削除" ${state.busy?'disabled':''}>×</button></li>`).join(''):'<li class="batch-empty">ファイルを追加してください。</li>';
  for(const id of ['batch-files','batch-folder','batch-recursive','batch-destination','close-batch'])$(id).disabled=state.busy;
  $('batch-clear').disabled=state.busy||!state.items.length;
  $('batch-start').disabled=state.busy||!state.items.length||!state.destination;
  $('batch-stop').hidden=!state.running;$('batch-stop').disabled=state.stop;
  $('batch-drop').setAttribute('aria-disabled',String(state.busy));
  $('batch-output').value=state.destination?.path||'';
}
function addBatchItems(items){
  for(const item of items)if(!batchState.items.some(existing=>existing.id===item.id))batchState.items.push(item);
  renderBatch();
}
async function selectBatch(action){
  if(batchState.busy)return;
  batchState.busy=true;batchError();renderBatch();
  try{
    const result=await batchRequest(action,{recursive:$('batch-recursive').checked});
    if(action==='destination'){
      if(!result.cancelled)batchState.destination=result;
    }else{
      addBatchItems(result.items);
      $('batch-progress').textContent=result.items.length?`${result.items.length}件のフローを追加しました。`:'ファイルは追加されませんでした。';
    }
  }catch(error){batchError(error.message);}
  finally{batchState.busy=false;renderBatch();}
}
async function addDroppedBatchFiles(files){
  if(batchState.busy)return;
  const flows=Array.from(files).filter(file=>/\.(tflx|tfl)$/i.test(file.name));
  if(!flows.length){batchError('.tfl / .tflx ファイルをドロップしてください。フォルダーは「フォルダー指定」から選べます。');return;}
  batchState.busy=true;batchError();renderBatch();
  let failed=0,added=0;
  try{
    for(const file of flows){
      $('batch-progress').textContent=`追加中 ${added+failed+1} / ${flows.length}：${file.name}`;
      try{
        const response=await fetch('/api/batch/upload',{method:'POST',headers:{'X-Viewer-Token':SERVER.token,'X-File-Name':encodeURIComponent(file.name),'Content-Type':'application/octet-stream'},body:file});
        const result=await response.json();if(!response.ok)throw new Error(result.error||'追加できませんでした。');
        addBatchItems(result.items);added++;
      }catch(error){failed++;batchError(`${file.name}：${error.message}`);}
    }
  }finally{
    batchState.busy=false;renderBatch();
    $('batch-progress').textContent=`${added}件を追加${failed?`・${failed}件の追加に失敗`:''}${files.length>flows.length?'（対象外のファイルは除外）':''}。`;
  }
}
async function removeBatchItems(ids){
  if(batchState.busy)return;
  batchState.busy=true;batchError();renderBatch();
  try{
    await batchRequest('remove',{ids});
    batchState.items=batchState.items.filter(item=>!ids.includes(item.id));
    $('batch-progress').textContent='対象ファイルと保存先を確認して変換してください。';
  }catch(error){batchError(error.message);}
  finally{batchState.busy=false;renderBatch();}
}
async function convertBatch(){
  const state=batchState;
  if(state.busy||!state.items.length||!state.destination)return;
  state.busy=true;state.running=true;state.stop=false;batchError();
  state.items.forEach(item=>{delete item.status;delete item.message;});
  let success=0,failed=0;
  try{
    for(const item of state.items){
      if(state.stop)break;
      item.status='running';renderBatch();
      $('batch-progress').textContent=`変換中 ${success+failed+1} / ${state.items.length}：${item.name}`;
      try{
        const result=await batchRequest('convert',{id:item.id,destination:state.destination.id});
        item.status='success';item.message=result.path;success++;
      }catch(error){item.status='error';item.message=error.message;failed++;}
    }
  }finally{
    state.busy=false;state.running=false;renderBatch();
    const waiting=state.items.length-success-failed;
    $('batch-progress').textContent=`${waiting?'停止':'完了'}：保存 ${success}件・失敗 ${failed}件${waiting?`・未処理 ${waiting}件`:''}`;
  }
}
function setupDownloadMenu(){
  $('download-button').hidden=false;$('run-button').hidden=false;
  $('download-button').onclick=()=>{
    closeRecent();updateFlowEditButtons();$('export-button').disabled=!DATA.nodes.length||flowEditBusy||loadingFlow;
    $('download-dialog').showModal();
  };
  $('close-download').onclick=()=>$('download-dialog').close();
  $('batch-open').onclick=()=>{batchError();renderBatch();$('batch-dialog').showModal();};
  $('close-batch').onclick=()=>{if(!batchState.busy)$('batch-dialog').close();};
  $('batch-dialog').addEventListener('cancel',event=>{if(batchState.busy)event.preventDefault();});
  $('batch-files').onclick=()=>selectBatch('files');
  $('batch-folder').onclick=()=>selectBatch('folder');
  $('batch-destination').onclick=()=>selectBatch('destination');
  $('batch-drop').onclick=()=>selectBatch('files');
  $('batch-drop').onkeydown=event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();selectBatch('files');}};
  $('batch-clear').onclick=()=>removeBatchItems(batchState.items.map(item=>item.id));
  $('batch-list').onclick=event=>{const button=event.target.closest('[data-batch-remove]');if(button)removeBatchItems([button.dataset.batchRemove]);};
  $('batch-start').onclick=convertBatch;
  $('batch-stop').onclick=()=>{batchState.stop=true;renderBatch();};
  // Capture drops anywhere in this modal; they must never replace the open flow.
  document.addEventListener('dragenter',event=>{
    if(!$('batch-dialog').open)return;
    if([...event.dataTransfer.types].includes('Files')){event.preventDefault();event.stopImmediatePropagation();$('batch-drop').classList.add('drag-over');}
  },true);
  document.addEventListener('dragover',event=>{if($('batch-dialog').open){event.preventDefault();event.stopImmediatePropagation();}},true);
  document.addEventListener('dragleave',event=>{if($('batch-dialog').open&&!event.relatedTarget)$('batch-drop').classList.remove('drag-over');},true);
  document.addEventListener('drop',event=>{
    if(!$('batch-dialog').open)return;
    event.preventDefault();event.stopImmediatePropagation();$('batch-drop').classList.remove('drag-over');
    dropDepth=0;$('drop-overlay').hidden=true;addDroppedBatchFiles(event.dataTransfer.files);
  },true);
}
