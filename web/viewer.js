// 画面イベントの登録と起動。assets.json の最後に読み込む。

document.addEventListener('click', (e) => {
  const overview = e.target.closest('[data-overview-tab]');
  if (overview) {
    overviewTab = overview.dataset.overviewTab;
    renderDetail();
    return;
  }
  const connectionStep = e.target.closest('[data-connection-step]');
  if (connectionStep) {
    selectNode(connectionStep.dataset.connectionStep);
    activeTab = 'settings';
    renderDetail();
    return;
  }
  const unfold = e.target.closest('.formula-unfold');
  if (unfold) {
    const wrap = unfold.closest('.formula-wrap'),
      expanded = wrap.classList.toggle('full-formula');
    unfold.setAttribute('aria-expanded', String(expanded));
    unfold.title = expanded ? ui('計算式を折りたたむ') : ui('計算式を展開');
    unfold.setAttribute('aria-label', unfold.title);
    updateFormulaPreviews();
    return;
  }
  const formula = e.target.closest('[data-formula]');
  if (formula) {
    openFormulaPopup(
      decodeURIComponent(formula.dataset.formula),
      JSON.parse(decodeURIComponent(formula.dataset.formulaOrigin || 'null')),
    );
    return;
  }
  const formulaTab = e.target.closest('[data-formula-mode]');
  if (formulaTab) {
    formulaPopup.mode = formulaTab.dataset.formulaMode;
    renderFormulaPopup();
    return;
  }
  const bracket = e.target.closest('[data-bracket]');
  if (bracket) {
    highlightFormulaBrackets(bracket);
    return;
  }
  highlightFormulaBrackets(null);
  const select = e.target.closest('[data-select]');
  if (select) {
    const trigger = document.querySelector('.step-arrow[aria-expanded="true"]');
    selectNode(select.dataset.select);
    if (trigger && !trigger.disabled) trigger.focus();
    return;
  }
  if (!e.target.closest('.step-navigation')) closeStepChoices();
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    activeTab = tab.dataset.tab;
    $('detail-search').value = '';
    renderDetail();
    return;
  }
  const mode = e.target.closest('[data-field-mode]');
  if (mode) {
    fieldMode = mode.dataset.fieldMode;
    renderDetail();
    return;
  }
  const changes = e.target.closest('[data-changes-mode]');
  if (changes) {
    changesMode = changes.dataset.changesMode;
    renderDetail();
    return;
  }
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    copyText(decodeURIComponent(copy.dataset.copy));
    return;
  }
  const action = e.target.closest('[data-action-id]');
  if (action) {
    activeTab = 'actions';
    changesMode = 'all';
    $('detail-search').value = '';
    renderDetail();
    const target = [...document.querySelectorAll('[data-action]')].find(
      (a) => a.dataset.action === action.dataset.actionId,
    );
    target?.scrollIntoView({ block: 'center' });
    target?.classList.add('flash');
    return;
  }
  const field = e.target.closest('[data-field]');
  if (field) {
    const row = field.closest('tr'),
      expanded = field.getAttribute('aria-expanded') === 'true';
    field.setAttribute('aria-expanded', String(!expanded));
    if (expanded) {
      row.nextElementSibling?.remove();
      return;
    }
    const n = byId.get(selected),
      f = (n.fieldInventory || n.fields)[Number(field.dataset.field)],
      detail = document.createElement('tr');
    detail.className = 'field-detail-row';
    detail.innerHTML = `<td colspan="3">${fieldDetailHtml(f)}</td>`;
    row.after(detail);
  }
});

$('flow-svg').addEventListener('click', handleGraphClick);

$('flow-svg').addEventListener('keydown', (e) => {
  if (!['Enter', ' '].includes(e.key)) return;
  const comment = e.target.closest('[data-comment-toggle]');
  if (comment) {
    e.preventDefault();
    toggleStepComment(comment.dataset.commentToggle);
    return;
  }
  const n = e.target.closest('[data-id]');
  if (n) {
    e.preventDefault();
    selectNode(n.dataset.id === selected ? null : n.dataset.id);
  }
});

document.querySelector('.detail-tabs:not(.overview-tabs)').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const tabs = [...document.querySelectorAll('[data-tab]')],
    i = tabs.indexOf(document.activeElement),
    next = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (i + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
  activeTab = tabs[next].dataset.tab;
  tabs[next].focus();
  renderDetail();
});

$('detail-search').addEventListener('input', renderDetail);

$('overview-tabs').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const tabs = [...document.querySelectorAll('[data-overview-tab]')],
    i = tabs.indexOf(document.activeElement),
    next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? tabs.length - 1
          : (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
  overviewTab = tabs[next].dataset.overviewTab;
  renderDetail();
  tabs[next].focus();
});

$('fit-button').onclick = fit;

$('close-formula').onclick = closeFormulaPopup;

$('formula-backdrop').onclick = closeFormulaPopup;

$('copy-formula').onclick = () => copyText($('formula-full').innerText);

$('formula-full').onpointerover = (e) => hoverFormulaBrackets(e.target.closest?.('[data-bracket]'));

$('formula-full').onpointerout = (e) =>
  hoverFormulaBrackets(e.relatedTarget?.closest?.('[data-bracket]'));

if (CAN_EDIT) {
  setupDownloadMenu();
  setupFlowRun();
  setupOutputEditor();
  $('publish-button').hidden = false;
  $('publish-button').onclick = openPublish;
  $('close-publish').onclick = () => {
    if (!publishBusy) {
      $('publish-dialog').close();
      $('publish-token-value').value = '';
    }
  };
  $('publish-dialog').addEventListener('cancel', (e) => {
    if (publishBusy) e.preventDefault();
    else $('publish-token-value').value = '';
  });
  $('test-publish-auth').onclick = () => executePublish(false);
  $('publish-form').onsubmit = (e) => {
    e.preventDefault();
    executePublish(true);
  };
  $('undo-flow').onclick = () => moveFlowHistory('undo');
  $('redo-flow').onclick = () => moveFlowHistory('redo');
  $('save-formula').onclick = confirmFormula;
  $('save-flow').onclick = saveFlow;
} else {
  $('publish-button')?.remove();
  $('publish-dialog')?.remove();
  $('run-dialog')?.remove();
  $('run-progress-dialog')?.remove();
  $('output-dialog')?.remove();
  $('flow-edit-tools')?.remove();
  $('save-formula')?.remove();
}

$('formula-dialog').addEventListener('cancel', (e) => {
  e.preventDefault();
  closeFormulaPopup();
});

$('formula-dialog').addEventListener('click', (e) => {
  if (e.target !== e.currentTarget || formulaPopup.saving) return;
  const r = e.currentTarget.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
    closeFormulaPopup();
});

if (CAN_EDIT) {
  $('formula-full').addEventListener('compositionstart', () => (formulaComposing = true));
  $('formula-full').addEventListener('compositionend', () => {
    formulaComposing = false;
    recordFormulaInput();
  });
  $('formula-full').addEventListener('input', recordFormulaInput);
  $('formula-full').addEventListener('paste', (e) => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });
  $('formula-full').addEventListener('beforeinput', (e) => {
    if (['historyUndo', 'historyRedo'].includes(e.inputType)) {
      e.preventDefault();
      moveFormulaHistory(e.inputType === 'historyUndo' ? 'undo' : 'redo');
    }
  });
  $('formula-full').addEventListener('keydown', (e) => {
    if (formulaComposing) return;
    if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      moveFormulaHistory(e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      document.execCommand('insertText', false, '\n');
    }
  });
}

document.querySelector('.formula-tabs').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  formulaPopup.mode =
    e.key === 'Home'
      ? 'original'
      : e.key === 'End'
        ? 'formatted'
        : formulaPopup.mode === 'original'
          ? 'formatted'
          : 'original';
  renderFormulaPopup();
  $(`formula-${formulaPopup.mode}-tab`).focus();
});

$('previous-step').onclick = () => navigateStep('upstream');

$('next-step').onclick = () => navigateStep('downstream');

$('step-choices').addEventListener('keydown', (e) => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const items = [...$('step-choices').querySelectorAll('button')],
    i = items.indexOf(document.activeElement);
  items[
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? items.length - 1
        : (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length
  ]?.focus();
});

document.querySelector('.step-navigation').addEventListener('focusout', (e) => {
  if (!e.currentTarget.contains(e.relatedTarget)) closeStepChoices();
});

$('open-button').onclick = openFlowFile;

$('empty-open').onclick = openFlowFile;

$('file-input').onchange = (e) => loadFile(e.target.files[0]);

$('recent-toggle').onclick = openRecent;

$('recent-menu').onclick = (e) => {
  const item = e.target.closest('[data-recent-id]');
  if (item) loadRecent(item.dataset.recentId);
};

$('recent-picker').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeRecent(true);
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  if ($('recent-menu').hidden) {
    openRecent();
    return;
  }
  const items = [...$('recent-menu').querySelectorAll('button')],
    i = items.indexOf(document.activeElement);
  items[
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? items.length - 1
        : (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length
  ]?.focus();
});

$('recent-picker').addEventListener('focusout', (e) => {
  if (!e.currentTarget.contains(e.relatedTarget)) closeRecent();
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#recent-picker')) closeRecent();
});

$('close-file-error').onclick = $('file-error-ok').onclick = () => $('file-error-dialog').close();

window.addEventListener('focus', () => {
  if (!loadingFlow && $('recent-menu').hidden) refreshRecent();
});

$('flow-svg').addEventListener('dblclick', (e) => {
  if (!e.target.closest('[data-id],[data-comment-toggle]')) fit();
});

$('flow-svg').addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const r = $('graph').getBoundingClientRect();
    zoom(Math.exp(-e.deltaY * 0.00075), e.clientX - r.left, e.clientY - r.top);
  },
  { passive: false },
);

$('flow-svg').addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('[data-comment-toggle]')) return;
  dragState = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y, moved: false };
  if (!e.target.closest('[data-id]')) $('flow-svg').setPointerCapture(e.pointerId);
});

$('flow-svg').addEventListener('pointermove', (e) => {
  if (!dragState || !(e.buttons & 1)) return;
  const dx = e.clientX - dragState.x,
    dy = e.clientY - dragState.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) dragState.moved = true;
  if (dragState.moved) {
    autoFit = false;
    offset = { x: dragState.ox + dx, y: dragState.oy + dy };
    $('flow-svg').classList.add('dragging');
    applyTransform();
  }
});

window.addEventListener('pointerup', () => {
  $('flow-svg').classList.remove('dragging');
  setTimeout(() => (dragState = null), 0);
});

$('splitter').addEventListener('pointerdown', (e) => {
  splitDragging = true;
  $('splitter').setPointerCapture(e.pointerId);
});

$('splitter').addEventListener('pointermove', (e) => {
  if (splitDragging)
    resizePanel(document.querySelector('.workspace').getBoundingClientRect().right - e.clientX);
});

$('splitter').addEventListener('pointerup', () => (splitDragging = false));

$('splitter').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault();
  resizePanel(
    document.querySelector('.detail-section').clientWidth + (e.key === 'ArrowLeft' ? 25 : -25),
  );
});

document.addEventListener('keydown', (e) => {
  if (
    e.key === '/' &&
    selected &&
    !document.querySelector('dialog[open]') &&
    !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) &&
    activeTab !== 'settings'
  ) {
    e.preventDefault();
    $('detail-search').focus();
  }
  if (e.key === 'Escape') {
    closeStepChoices(true);
    $('drop-overlay').hidden = true;
    dropDepth = 0;
  }
});

document.addEventListener('dragenter', (e) => {
  if ([...e.dataTransfer.types].includes('Files')) {
    e.preventDefault();
    dropDepth++;
    $('drop-overlay').hidden = false;
  }
});

document.addEventListener('dragover', (e) => {
  if ([...e.dataTransfer.types].includes('Files')) e.preventDefault();
});

document.addEventListener('dragleave', (e) => {
  if ([...e.dataTransfer.types].includes('Files')) {
    dropDepth--;
    if (dropDepth <= 0) $('drop-overlay').hidden = true;
  }
});

document.addEventListener('drop', handleFileDrop);

window.addEventListener('resize', () => {
  if (autoFit) fit();
});

window.addEventListener('resize', sizeFormulaPopup);

new ResizeObserver(() => requestAnimationFrame(updateFormulaPreviews)).observe(
  document.querySelector('.detail-section'),
);

window.addEventListener('beforeunload', (e) => {
  if (viewerCloseState().dirty || viewerCloseState().busy) {
    e.preventDefault();
    e.returnValue = '';
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('formula-dialog').open) {
    e.preventDefault();
    closeFormulaPopup();
  }
});

init(DATA, { restored: !!SERVER.restoredFlow });

if (DATA.openingError) showFileError(DATA.openingError);

refreshRecent();

setupLanguageMenu();

document.addEventListener('viewer-language-change', () => {
  // Rerender views only; session history, graph position and all form drafts survive.
  const scroll = $('detail-content').scrollTop;
  renderGraph();
  applyTransform();
  renderDetail();
  syncRecentPicker();
  $('detail-content').scrollTop = scroll;
  if (CAN_EDIT) {
    renderRun();
    renderBatch();
    if (outputEditor) {
      renderOutputEditor();
      syncOutputDropdowns();
    }
  }
});
