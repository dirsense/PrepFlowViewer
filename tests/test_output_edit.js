const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./ui-test-context.cjs');

const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, {
    value: '', textContent: '', hidden: false, disabled: false, open: true,
    close() { this.open = false; }, querySelectorAll() { return []; }
  });
  return elements.get(id);
};
let pending, applied = 0;
const history = {changes: [], push(change) { this.changes.push(change); }};
const context = vm.createContext({
  $: element, DATA: {exportKey: 'flow', editRevision: 'revision'}, SERVER: {token: 'local'},
  fetch: () => new Promise(resolve => { pending = resolve; }),
  setFlowEditBusy() {}, flowSession: {history},
  applyEditedModel() { applied++; }, renderDetail() {},
  requestFlowEdits: async () => { throw Error('preview rejected'); },
  CAN_EDIT: true, console
});
vm.runInContext(fs.readFileSync(require.resolve('../web/output-edit.js'), 'utf8'), context);
function init() {
  vm.runInContext("outputEditor = {stepId:'output', busy:false, verified:null}", context);
  element('output-target').value = 'server';
  element('output-server').value = 'https://tableau.example.com';
  element('output-project').value = 'Parent/Child';
  element('output-name').value = 'Sales';
}
function response(value) { pending({ok: true, json: async () => value}); }

(async () => {
  init();
  context.renderOutputEditor();
  assert.equal(element('output-confirm').disabled, true, 'unverified server cannot be confirmed');
  let check = context.verifyOutputProject();
  assert.equal(element('output-server').disabled, false, 'lookup does not freeze input');
  element('output-project').value = 'Different';
  context.invalidateOutputProject();
  response({projectId: 'old-id', proof: 'old-proof'});
  await check;
  assert.equal(element('output-confirm').disabled, true, 'late response cannot verify changed project');
  check = context.verifyOutputProject();
  response({projectId: 'new-id', proof: 'new-proof'});
  await check;
  assert.equal(element('output-confirm').disabled, false);
  context.closeOutputEditor();
  assert.equal(applied, 0, 'closing only discards draft');
  assert.equal(history.changes.length, 0);
  init();
  check = context.verifyOutputProject();
  context.closeOutputEditor();
  response({projectId: 'late-id'});
  await check;
  assert.equal(vm.runInContext('outputEditor', context), null, 'late lookup does not resurrect closed draft');
  init();
  element('output-target').value = 'file';
  element('output-format').value = 'hyper';
  element('output-confirm').disabled = false;
  const confirm = context.confirmOutputEdit({preventDefault() {}});
  response({change: {kind: 'output'}});
  await confirm;
  assert.equal(history.changes.length, 0, 'failed confirmation does not add undo entry');
  assert.equal(applied, 0, 'failed preview leaves current flow unchanged');
  assert.equal(element('output-error').textContent, 'preview rejected');
  console.log('Output editor: discard, verification invalidation, stale lookup and failed confirmation passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
