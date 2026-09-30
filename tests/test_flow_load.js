const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./ui-test-context.cjs');
const { declaration: viewerDeclaration } = require('./viewer-source.cjs');
const declaration = viewerDeclaration;
function checkOpeningSelection() {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', close() {} });
    return elements.get(id);
  };
  const context = vm.createContext({
    DATA: { nodes: [] },
    byId: new Map(),
    flowSessions: new Map(),
    SERVER: { token: 'test' },
    $: element,
    document: { title: '' },
    FlowEditHistory: class {},
    closeFormulaPopup() {},
    updateFlowEditButtons() {},
    configureFormulaEditor() {},
    closeStepChoices() {},
    syncRecentPicker() {},
    renderGraph() {},
    highlightGraph() {},
    renderDetail() {},
    requestAnimationFrame() {},
    fit() {},
  });
  vm.runInContext(['init', 'selectNode'].map(declaration).join('\n'), context);
  const flow = (name) => ({ name, nodes: [{ id: name, kind: 'input', actions: [{}] }] });
  const check = (model, options, tab) => {
    context.init(model, options);
    assert.equal(context.selected, null, 'Opening a flow must not automatically select its input');
    assert.equal(context.overviewTab, tab);
  };
  check({ name: 'empty', nodes: [] }, {}, 'help');
  check(flow('first'), {}, 'help');
  context.selected = 'first';
  check(flow('replacement'), {}, 'info');
  context.byId = new Map();
  check(flow('restored'), { restored: true }, 'info');
  context.byId = new Map();
  context.SERVER = {};
  check(flow('html'), {}, 'help');
  context.selectNode(null);
  assert.equal(
    context.overviewTab,
    'info',
    'Deselecting a loaded step still opens flow information',
  );
  context.byId = new Map();
  context.SERVER = { token: 'test' };
  check(flow('explicit-launch'), {}, 'help');
  console.log(
    'Opening selection: empty, first flow, replacement, restored flow and standalone HTML passed.',
  );
}
checkOpeningSelection();
async function check(route, outcome) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { disabled: false, hidden: true, value: '' });
    return elements.get(id);
  };
  let context;
  context = vm.createContext({
    CAN_EDIT: true,
    SERVER: { token: 'test' },
    loadingFlow: false,
    flowEditBusy: false,
    nativeDropReady: false,
    dropDepth: 0,
    DATA: { name: 'test.tflx', nodes: [] },
    flowSessions: new Map(),
    flowSession: { history: {} },
    $: element,
    closeRecent() {},
    syncRecentPicker() {},
    refreshRecent() {},
    toast() {},
    showFileError() {},
    encodeURIComponent,
    init(model) {
      context.DATA = model;
      context.updateFlowEditButtons();
      assert.equal(element('publish-button').disabled, true, 'disabled during init');
    },
    async fetch() {
      assert.equal(element('publish-button').disabled, true, 'disabled during request');
      if (outcome === 'error') throw new Error('test network failure');
      return {
        ok: true,
        json: async () =>
          outcome === 'cancel' ? { cancelled: true } : { name: 'test.tflx', nodes: [] },
      };
    },
  });
  vm.runInContext(
    [
      'updateFlowEditButtons',
      'beginFlowLoad',
      'endFlowLoad',
      'loadRecent',
      'loadFile',
      'openFlowFile',
      'beginNativeFlowDrop',
      'finishNativeFlowDrop',
      'handleFileDrop',
    ]
      .map(declaration)
      .join('\n'),
    context,
  );
  if (route === 'recent') await context.loadRecent('test-id');
  if (route === 'drop') await context.loadFile({ name: 'test.tflx', nodes: [] });
  if (route === 'open') await context.openFlowFile();
  if (route === 'native-drop') {
    context.nativeDropReady = true;
    let browserUpload = false;
    context.loadFile = () => {
      browserUpload = true;
    };
    context.handleFileDrop({
      preventDefault() {},
      dataTransfer: { files: [{ name: 'test.tflx', nodes: [] }] },
    });
    assert.equal(browserUpload, false, 'native drops must not also upload a temporary copy');
    assert.equal(context.beginNativeFlowDrop(), true);
    assert.equal(context.beginNativeFlowDrop(), false, 'reject concurrent loads');
    context.finishNativeFlowDrop(
      outcome === 'error' ? null : { name: 'test.tflx', nodes: [] },
      outcome === 'error' ? 'missing file' : null,
    );
    context.nativeDropReady = false;
    context.handleFileDrop({
      preventDefault() {},
      dataTransfer: { files: [{ name: 'test.tflx', nodes: [] }] },
    });
    assert.equal(browserUpload, true, 'ordinary browser drops retain the upload fallback');
  }
  assert.equal(context.loadingFlow, false);
  assert.equal(element('publish-button').disabled, false, `${route}/${outcome}: publish restored`);
  assert.equal(element('busy-overlay').hidden, true);
  context.flowEditBusy = true;
  context.endFlowLoad();
  assert.equal(element('publish-button').disabled, true, 'other work remains busy');
}
(async () => {
  for (const route of ['recent', 'drop', 'open', 'native-drop']) {
    for (const outcome of ['success', 'error']) await check(route, outcome);
  }
  await check('open', 'cancel');
  console.log('Flow loading: publish restored after open, recent, drop, failure and cancellation.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
