// Flow initialization, selection and step navigation.

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
      ? ui('Drag to pan · Scroll to zoom · Double-click to fit')
      : ui('Open a flow'),
  );
  uiBind($('stats-text'), 'textContent', () =>
    SERVER.token
      ? ui('No data connections · Edit formulas and output destinations')
      : ui('No data connections · HTML preview'),
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
    ui`<p>Select a ${direction === 'upstream' ? ui('previous') : ui('next')} step</p>${ids
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
    uiBind($('selected-name'), 'textContent', () => ui('Select a step'));
    $('selected-summary').textContent = '';
    uiBind($('tab-settings'), 'textContent', () => ui('Settings'));
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
        input: ui('Settings and connections'),
        join: ui('Join settings'),
        union: ui('Union settings'),
        aggregate: ui('Aggregate settings'),
        pivot: ui('Pivot settings'),
        output: ui('Output settings'),
      })[n.kind] || ui('Settings'),
  );
  highlightGraph();
  renderDetail();
}
