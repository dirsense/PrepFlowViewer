// 確定済みの変更、フロー全体の Undo / Redo、保存、終了時の未保存判定。

function updateFlowEditButtons() {
  if (!CAN_EDIT) return;
  const history = flowSession?.history;
  $('flow-edit-tools').hidden = false;
  $('undo-flow').disabled = flowEditBusy || !history?.canUndo;
  $('redo-flow').disabled = flowEditBusy || !history?.canRedo;
  $('save-flow').disabled = flowEditBusy || !history?.dirty;
  $('export-button').disabled = flowEditBusy || loadingFlow;
  $('recent-toggle').disabled = flowEditBusy || loadingFlow;
  $('open-button').disabled = flowEditBusy;
  if ($('publish-button')) $('publish-button').disabled = flowEditBusy || loadingFlow;
  if ($('run-button'))
    $('run-button').disabled =
      flowEditBusy || loadingFlow || !DATA.nodes.some((n) => n.kind === 'output');
}

function setFlowEditBusy(busy) {
  flowEditBusy = busy;
  configureFormulaEditor();
  updateFlowEditButtons();
  updateFormulaEditButtons();
}

async function requestFlowEdits(path, changes) {
  let response;
  try {
    response = await uiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Viewer-Token': SERVER.token },
      body: JSON.stringify({ exportKey: DATA.exportKey, revision: DATA.editRevision, changes }),
    });
  } catch {
    throw new Error(
      ui(
        'ローカルサーバーと通信できませんでした。編集内容は保持しています。画面を再読み込みせず、サーバーの起動状態を確認してください。',
      ),
    );
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || ui('変更を反映できませんでした。'));
  return result;
}

function applyEditedModel(result) {
  const step = selected,
    tab = activeTab,
    mode = changesMode,
    scroll = $('detail-content').scrollTop;
  DATA = result;
  flowSession.model = DATA;
  byId = new Map(DATA.nodes.map((n) => [n.id, n]));
  selectNode(step);
  activeTab = tab;
  changesMode = mode;
  renderDetail();
  $('detail-content').scrollTop = scroll;
  renderGraph();
  highlightGraph();
  applyTransform();
  document.title = `${DATA.name} — PrepFlow Viewer`;
  $('file-name').textContent = DATA.name;
  $('file-name').title = DATA.name;
  syncRecentPicker();
}

async function confirmFormula() {
  if (!CAN_EDIT || flowEditBusy || !formulaPopup.history.dirty || !formulaPopup.origin) return;
  const source = $('formula-full').innerText,
    change = { ...formulaPopup.origin, before: formulaPopup.history.baseline, expression: source };
  formulaPopup.saving = true;
  setFlowEditBusy(true);
  $('formula-save-error').hidden = true;
  try {
    const result = await requestFlowEdits('/api/preview-edits', [
      ...flowSession.history.changes,
      change,
    ]);
    flowSession.history.push(change);
    applyEditedModel(result);
    formulaPopup.history.reset(source);
    renderFormulaPopup();
    uiBind($('status-text'), 'textContent', () => ui('変更を確定しました · ファイルには未保存'));
  } catch (error) {
    uiBind($('formula-save-error'), 'textContent', () => uiMessage(error.message));
    $('formula-save-error').hidden = false;
    sizeFormulaPopup();
  } finally {
    formulaPopup.saving = false;
    setFlowEditBusy(false);
    sizeFormulaPopup();
  }
}

async function moveFlowHistory(direction) {
  if (!CAN_EDIT) return;
  const history = flowSession.history,
    undo = direction === 'undo';
  if (flowEditBusy || !(undo ? history.canUndo : history.canRedo)) return;
  const index = history.index + (undo ? -1 : 1),
    change = history.entries[undo ? index : history.index];
  setFlowEditBusy(true);
  try {
    const result = await requestFlowEdits('/api/preview-edits', history.entries.slice(0, index));
    history.index = index;
    applyEditedModel(result);
    selectNode(change.stepId);
    activeTab = 'actions';
    renderDetail();
    if (change.kind === 'output') {
      closeFormulaPopup();
      activeTab = 'settings';
      renderDetail();
      uiBind($('status-text'), 'textContent', () =>
        undo ? ui('出力先の変更を元に戻しました') : ui('出力先の変更をやり直しました'),
      );
      return;
    }
    const origin = { stepId: change.stepId, actionId: change.actionId, field: change.field };
    const key = JSON.stringify([DATA.exportKey || DATA.name, origin]);
    // Confirmed history is authoritative when returning to this formula.
    formulaDrafts.delete(key);
    openFormulaPopup(undo ? change.before : change.expression, origin);
    uiBind($('status-text'), 'textContent', () =>
      undo ? ui('変更を元に戻しました') : ui('変更をやり直しました'),
    );
  } catch (error) {
    toast(error.message);
  } finally {
    setFlowEditBusy(false);
  }
}

async function saveFlow() {
  if (!CAN_EDIT || flowEditBusy || !flowSession.history.dirty) return;
  setFlowEditBusy(true);
  uiBind($('save-flow'), 'textContent', () => ui('保存先を選択中…'));
  try {
    const result = await requestFlowEdits('/api/save-flow', flowSession.history.changes);
    if (result.cancelled) return;
    flowSession.history.reset();
    applyEditedModel(result);
    refreshRecent();
    uiBind($('status-text'), 'textContent', () => ui`${DATA.name} を保存しました`);
    toast(ui`${DATA.name} を保存しました`);
  } catch (error) {
    toast(error.message);
  } finally {
    uiBind($('save-flow'), 'textContent', () => ui('フローを保存'));
    setFlowEditBusy(false);
  }
}

function viewerCloseState() {
  return {
    language: uiLanguage,
    dirty:
      CAN_EDIT &&
      ([...formulaDrafts.values()].some((d) => d.dirty) ||
        [...flowSessions.values()].some((s) => s.history.dirty) ||
        (typeof outputDraftDirty === 'function' && outputDraftDirty())),
    busy: flowEditBusy || loadingFlow || (typeof batchIsBusy === 'function' && batchIsBusy()),
  };
}
