const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('./ui-test-context.cjs');
const {FormulaEditHistory,FlowEditHistory}=require('../web/formula-edit');
const source=fs.readFileSync(require.resolve('../web/viewer.js'),'utf8');
function declaration(name){
  const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));
  const next=source.slice(start+1).search(/^(?:async )?function /m);
  assert.ok(start>=0,name);
  if(name==='viewerCloseState')return source.slice(start).split('\n')[0];
  return source.slice(start,next<0?undefined:start+1+next);
}
const elements=new Map();
function element(id){
  if(!elements.has(id))elements.set(id,{open:false,hidden:true,innerText:'',textContent:'',
    close(){this.open=false;},show(){this.open=true;},focus(){}});
  return elements.get(id);
}
const origin={stepId:'step',actionId:'calc',field:'Result'};
let committed='1',requests=0,fail=false;
const context=vm.createContext({
  CAN_EDIT:true,SERVER:{token:'test'},DATA:{name:'test.tfl',exportKey:'flow',nodes:[]},
  formulaPopup:{original:'',formatted:'',mode:'original'},formulaComposing:false,formulaDrafts:new Map(),
  flowEditBusy:false,loadingFlow:false,flowSessions:new Map(),flowSession:{history:new FlowEditHistory()},
  FormulaEditHistory,$:element,formatFormula:s=>s,configureFormulaEditor(){},sizeFormulaPopup(){},
  renderFormulaPopup(){element('formula-full').innerText=context.formulaPopup.history.source;},
  setFlowEditBusy(busy){context.flowEditBusy=busy;},
  async requestFlowEdits(path,changes){requests++;if(fail)throw Error('test failure');return {expression:changes.at(-1).expression};},
  applyEditedModel(model){committed=model.expression;}
});
context.flowSessions.set('flow',context.flowSession);
vm.runInContext(['openFormulaPopup','closeFormulaPopup','recordFormulaInput','confirmFormula','viewerCloseState'].map(declaration).join('\n'),context);
function open(){context.openFormulaPopup(committed,origin);}
function edit(value){context.formulaPopup.history.push(value);element('formula-full').innerText=value;}
(async()=>{
  open();edit('2');assert.equal(context.viewerCloseState().dirty,true);
  context.closeFormulaPopup();
  assert.equal(context.formulaDrafts.size,0);
  assert.equal(context.viewerCloseState().dirty,false,'Cancelled edits must not leave unsaved-state warnings');
  assert.equal(requests,0);assert.equal(committed,'1');assert.equal(context.flowSession.history.canUndo,false);
  open();assert.equal(context.formulaPopup.history.source,'1','Reopening must show the committed formula');
  edit('2');await context.confirmFormula();assert.equal(committed,'2');assert.equal(context.flowSession.history.canUndo,true);
  edit('3');context.closeFormulaPopup();open();
  assert.equal(context.formulaPopup.history.source,'2','Discard only edits since the last confirmation');
  assert.equal(context.flowSession.history.changes.length,1,'Keep the confirmed Undo entry');
  assert.equal(context.flowSession.history.changes[0].before,'1');
  fail=true;edit('4');await context.confirmFormula();
  assert.equal(context.formulaPopup.history.dirty,true,'Failed confirmation retains text while the editor stays open');
  context.closeFormulaPopup();open();assert.equal(context.formulaPopup.history.source,'2');
  assert.equal(context.flowSession.history.changes.length,1);
  edit('5');context.flowEditBusy=true;context.closeFormulaPopup();
  assert.equal(element('formula-dialog').open,true,'Cannot close during a pending edit request');
  assert.equal(context.formulaPopup.history.source,'5');
  context.flowEditBusy=false;context.closeFormulaPopup();
  context.recordFormulaInput(); // Late IME/input events after closing must be harmless.
  open();edit('6');context.openFormulaPopup('other', {...origin,field:'Other'});
  assert.equal(context.formulaDrafts.size,1,'Switching formulas must not leave abandoned drafts');
  context.closeFormulaPopup();
  console.log('Formula cancellation: discard, reopen, confirmed Undo, failed confirmation, busy guard and late input passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
