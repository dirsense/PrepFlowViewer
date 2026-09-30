// フローの初期化、選択状態、前後のステップへの移動。

function init(model, { restored = false } = {}) {
  const openingOverview = model.nodes.length && (byId.size > 0 || restored) ? 'info' : 'help';
  closeFormulaPopup();
  DATA = model;
  byId = new Map(DATA.nodes.map((n) => [n.id, n]));
  const sessionKey = DATA.exportKey || DATA.name;
  if (!flowSessions.has(sessionKey))
    flowSessions.set(sessionKey, { history: new FlowEditHistory(), model: DATA });
  flowSession = flowSessions.get(sessionKey);
  flowSession.model = DATA;
  updateFlowEditButtons();
  configureFormulaEditor();
  commentFont = 12.6;
  expandedComments = new Set(
    DATA.nodes
      .filter((n) => n.description?.trim() && (!n.display?.size || n.display.size.height > 1))
      .map((n) => n.id),
  );
  closeStepChoices();
  selected = null;
  activeTab = 'fields';
  fieldMode = 'all';
  changesMode = 'all';
  $('detail-search').value = '';
  document.title = `${DATA.name || 'PrepFlow'} — PrepFlow Viewer`;
  $('file-name').textContent = DATA.name || 'PrepFlow Viewer';
  $('file-name').title = DATA.name || '';
  syncRecentPicker();
  uiBind($('status-text'), 'textContent', () =>
    DATA.nodes.length
      ? ui('ドラッグで移動 · ホイールで拡大／縮小 · ダブルクリックで全体表示')
      : ui('フローを開いてください'),
  );
  uiBind($('stats-text'), 'textContent', () =>
    SERVER.token
      ? ui('データ接続なし · 計算式・出力先を編集できます')
      : ui('データ接続なし · HTMLプレビュー'),
  );
  $('empty-state').hidden = !!DATA.nodes.length;
  $('export-button').disabled = false;
  $('open-button').hidden = !SERVER.token;
  renderGraph();
  selectNode(null, openingOverview);
  requestAnimationFrame(fit);
}

function adjacentSteps(direction) {
  return [...new Set(byId.get(selected)?.[direction] || [])].filter((id) => byId.has(id));
}

function closeStepChoices(restoreFocus = false) {
  const trigger = document.querySelector('.step-arrow[aria-expanded="true"]');
  $('step-choices').hidden = true;
  $('step-choices').replaceChildren();
  document.querySelectorAll('.step-arrow').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  if (restoreFocus) trigger?.focus();
}

function navigateStep(direction) {
  const ids = adjacentSteps(direction),
    button = $(direction === 'upstream' ? 'previous-step' : 'next-step');
  const wasOpen = button.getAttribute('aria-expanded') === 'true';
  closeStepChoices();
  if (wasOpen || !ids.length) return;
  if (ids.length === 1) {
    selectNode(ids[0]);
    return;
  }
  $('step-choices').innerHTML =
    ui`<p>${direction === 'upstream' ? ui('前') : ui('次')}のステップを選択</p>${ids
      .map((id) => {
        const n = byId.get(id);
        return `<button data-select="${esc(id)}"><span class="step-choice-color" style="background:${esc(n.color)}"></span><span>${esc(n.name)}</span></button>`;
      })
      .join('')}`;
  $('step-choices').hidden = false;
  button.setAttribute('aria-expanded', 'true');
  $('step-choices').querySelector('button')?.focus();
}

function selectNode(id, defaultOverview = DATA.nodes.length ? 'info' : 'help') {
  closeStepChoices();
  $('previous-step').disabled = true;
  $('next-step').disabled = true;
  if (!id || !byId.has(id)) {
    selected = null;
    activeTab = 'fields';
    overviewTab = defaultOverview;
    fieldMode = 'all';
    changesMode = 'all';
    $('detail-search').value = '';
    $('selected-icon').innerHTML = '';
    uiBind($('selected-name'), 'textContent', () => ui('ステップを選択してください'));
    $('selected-summary').textContent = '';
    uiBind($('tab-settings'), 'textContent', () => ui('設定'));
    highlightGraph();
    renderDetail();
    return;
  }
  selected = id;
  fieldMode = 'all';
  changesMode = 'all';
  $('detail-search').value = '';
  const n = byId.get(id);
  activeTab =
    n.kind === 'input'
      ? 'fields'
      : ['output', 'join', 'pivot'].includes(n.kind)
        ? 'settings'
        : 'actions';
  $('previous-step').disabled = !adjacentSteps('upstream').length;
  $('next-step').disabled = !adjacentSteps('downstream').length;
  $('selected-icon').innerHTML = icon(n.kind, n.color, '', pivotDirection(n), nodeJoinType(n));
  uiBind($('selected-name'), 'textContent', () => n.name);
  uiBind(
    $('selected-summary'),
    'textContent',
    () => ui(n.kindLabel) + (n.description ? ' · ' + n.description : ''),
  );
  uiBind(
    $('tab-settings'),
    'textContent',
    () =>
      ({
        input: ui('設定・接続'),
        join: ui('結合設定'),
        union: ui('ユニオン設定'),
        aggregate: ui('集計設定'),
        pivot: ui('ピボット設定'),
        output: ui('出力設定'),
      })[n.kind] || ui('設定'),
  );
  highlightGraph();
  renderDetail();
}
