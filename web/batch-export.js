/* Save menu and sequential batch conversion. The open flow and edit history stay intact. */
const batchState = { items: [], destination: null, busy: false, running: false, stop: false };
const htmlExportState = {
  tab: 'single',
  source: null,
  languages: [],
  showSwitcher: false,
  busy: false,
};
const HTML_LANGUAGE_NAMES = {
  ja: '日本語',
  en: 'English',
  fr: 'Français',
  es: 'Español',
  de: 'Deutsch',
  'pt-BR': 'Português (Brasil)',
};
function batchIsBusy() {
  return batchState.busy || htmlExportState.busy;
}
function htmlExportOptions() {
  const languages = [...htmlExportState.languages];
  return {
    languages,
    showSwitcher: htmlExportState.showSwitcher,
    defaultLanguage: languages.includes(uiLanguage) ? uiLanguage : languages[0],
  };
}
function renderHtmlExport() {
  const state = htmlExportState,
    busy = batchIsBusy();
  $('html-source').value = state.source?.path || state.source?.name || '';
  $('html-single-save').disabled = busy || !state.source || !state.languages.length;
  $('batch-start').disabled =
    busy || !batchState.items.length || !batchState.destination || !state.languages.length;
  for (const id of [
    'html-source-select',
    'html-language-switcher',
    'html-single-tab',
    'html-batch-tab',
    'close-batch',
  ])
    $(id).disabled = busy;
  $('html-language-picker').setAttribute('aria-disabled', String(busy));
  const summary = $('html-language-picker').querySelector?.('summary');
  if (summary) summary.tabIndex = busy ? -1 : 0;
  if (busy) $('html-language-picker').open = false;
  $('html-language-switcher').checked = state.showSwitcher;
  const allSelected = state.languages.length === UI_LANGUAGES.length;
  $('html-language-summary').textContent = allSelected
    ? ui('全選択')
    : state.languages.map((locale) => HTML_LANGUAGE_NAMES[locale]).join(' / ') ||
      ui('対応言語を1つ以上選択してください。');
  for (const input of $('html-language-options').querySelectorAll?.('input') || []) {
    input.checked =
      input.name === 'html-export-all' ? allSelected : state.languages.includes(input.value);
    if (input.name === 'html-export-all')
      input.indeterminate = state.languages.length > 0 && !allSelected;
  }
  uiBind($('html-language-note'), 'textContent', () =>
    state.showSwitcher
      ? ui`複数選択できます。初期表示：${HTML_LANGUAGE_NAMES[htmlExportOptions().defaultLanguage] || '—'}`
      : ui('言語を1つ選択してください。選んだ言語だけをHTMLに含めます。'),
  );
  for (const tab of ['single', 'batch']) {
    const selected = state.tab === tab;
    $('html-' + tab + '-tab').setAttribute('aria-selected', String(selected));
    $('html-' + tab + '-tab').tabIndex = selected ? 0 : -1;
    $('html-' + tab + '-panel').hidden = !selected;
  }
}
function renderHtmlLanguageOptions() {
  const state = htmlExportState;
  $('html-language-options').innerHTML =
    (state.showSwitcher
      ? `<label class="html-language-all"><input type="checkbox" name="html-export-all">${ui('全選択')}</label>`
      : '') +
    UI_LANGUAGES.map(
      (locale) =>
        `<label><input type="${state.showSwitcher ? 'checkbox' : 'radio'}" name="html-export-language" value="${locale}" ${state.languages.includes(locale) ? 'checked' : ''}>${HTML_LANGUAGE_NAMES[locale]}</label>`,
    ).join('');
  renderHtmlExport();
}
function setHtmlExportTab(tab) {
  if (batchIsBusy()) return;
  htmlExportState.tab = tab;
  $('html-language-picker').open = false;
  renderHtmlExport();
}
function openHtmlExport() {
  if (flowEditBusy || loadingFlow || batchIsBusy()) return;
  Object.assign(htmlExportState, {
    tab: 'single',
    source: DATA.exportKey
      ? { exportKey: DATA.exportKey, name: DATA.name, path: DATA.sourcePath || DATA.name }
      : null,
    languages: [uiLanguage],
    showSwitcher: false,
  });
  $('html-single-error').hidden = true;
  $('html-single-status').textContent = '';
  batchError();
  renderBatch();
  renderHtmlLanguageOptions();
  $('download-dialog').close();
  $('batch-dialog').showModal();
}
async function selectHtmlSource() {
  if (batchIsBusy()) return;
  htmlExportState.busy = true;
  renderHtmlExport();
  $('html-single-error').hidden = true;
  try {
    const result = await batchRequest('file');
    if (!result.cancelled) {
      htmlExportState.source = { sourceId: result.id, name: result.name, path: result.path };
      $('html-single-status').textContent = '';
    }
  } catch (error) {
    uiBind($('html-single-error'), 'textContent', () => uiMessage(error.message));
    $('html-single-error').hidden = false;
  } finally {
    htmlExportState.busy = false;
    renderHtmlExport();
  }
}
async function batchRequest(action, payload = {}) {
  const response = await uiFetch('/api/batch/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Viewer-Token': SERVER.token },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || ui('一括出力の処理に失敗しました。'));
  return result;
}
function batchError(message = '') {
  uiBind($('batch-error'), 'textContent', () => uiMessage(message));
  $('batch-error').hidden = !message;
}
function renderBatch() {
  const state = batchState;
  uiBind($('batch-count'), 'textContent', () => ui`対象ファイル ${state.items.length}件`);
  $('batch-list').innerHTML = state.items.length
    ? state.items
        .map(
          (item) =>
            ui`<li class="batch-item ${item.status || ''}"><div><strong>${esc(item.name)}</strong><small>${esc(item.location === 'ドロップしたファイル' ? ui(item.location) : item.location)}</small>${item.message ? `<p>${esc(uiMessage(item.message))}</p>` : ''}</div><span class="batch-item-status">${{ running: ui('変換中'), success: ui('出力済み'), error: ui('失敗') }[item.status] || ui('待機中')}</span><button class="icon-button" data-batch-remove="${esc(item.id)}" aria-label="${esc(item.name)}をリストから削除" ${state.busy ? 'disabled' : ''}>×</button></li>`,
        )
        .join('')
    : ui('<li class="batch-empty">ファイルを追加してください。</li>');
  for (const id of [
    'batch-files',
    'batch-folder',
    'batch-recursive',
    'batch-destination',
    'close-batch',
  ])
    $(id).disabled = state.busy;
  $('batch-clear').disabled = state.busy || !state.items.length;
  $('batch-start').disabled =
    state.busy || !state.items.length || !state.destination || !htmlExportState.languages.length;
  $('batch-stop').hidden = !state.running;
  $('batch-stop').disabled = state.stop;
  $('batch-drop').setAttribute('aria-disabled', String(state.busy));
  $('batch-output').value = state.destination?.path || '';
  renderHtmlExport();
}
function addBatchItems(items) {
  for (const item of items)
    if (!batchState.items.some((existing) => existing.id === item.id)) batchState.items.push(item);
  renderBatch();
}
async function selectBatch(action) {
  if (batchState.busy) return;
  batchState.busy = true;
  batchError();
  renderBatch();
  try {
    const result = await batchRequest(action, { recursive: $('batch-recursive').checked });
    if (action === 'destination') {
      if (!result.cancelled) batchState.destination = result;
    } else {
      addBatchItems(result.items);
      uiBind($('batch-progress'), 'textContent', () =>
        result.items.length
          ? ui`${result.items.length}件のフローを追加しました。`
          : ui('ファイルは追加されませんでした。'),
      );
    }
  } catch (error) {
    batchError(error.message);
  } finally {
    batchState.busy = false;
    renderBatch();
  }
}
async function addDroppedBatchFiles(files) {
  if (batchState.busy) return;
  const flows = Array.from(files).filter((file) => /\.(tflx|tfl)$/i.test(file.name));
  if (!flows.length) {
    batchError(
      ui(
        '.tfl / .tflx ファイルをドロップしてください。フォルダーは「フォルダー指定」から選べます。',
      ),
    );
    return;
  }
  batchState.busy = true;
  batchError();
  renderBatch();
  let failed = 0,
    added = 0;
  try {
    for (const file of flows) {
      uiBind(
        $('batch-progress'),
        'textContent',
        () => ui`追加中 ${added + failed + 1} / ${flows.length}：${file.name}`,
      );
      try {
        const response = await uiFetch('/api/batch/upload', {
          method: 'POST',
          headers: {
            'X-Viewer-Token': SERVER.token,
            'X-File-Name': encodeURIComponent(file.name),
            'Content-Type': 'application/octet-stream',
          },
          body: file,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || ui('追加できませんでした。'));
        addBatchItems(result.items);
        added++;
      } catch (error) {
        failed++;
        batchError(`${file.name}：${error.message}`);
      }
    }
  } finally {
    batchState.busy = false;
    renderBatch();
    uiBind(
      $('batch-progress'),
      'textContent',
      () =>
        ui`${added}件を追加${failed ? ui`・${failed}件の追加に失敗` : ''}${files.length > flows.length ? ui('（対象外のファイルは除外）') : ''}。`,
    );
  }
}
async function removeBatchItems(ids) {
  if (batchState.busy) return;
  batchState.busy = true;
  batchError();
  renderBatch();
  try {
    await batchRequest('remove', { ids });
    batchState.items = batchState.items.filter((item) => !ids.includes(item.id));
    uiBind($('batch-progress'), 'textContent', () =>
      ui('対象ファイルと出力先を確認して変換してください。'),
    );
  } catch (error) {
    batchError(error.message);
  } finally {
    batchState.busy = false;
    renderBatch();
  }
}
async function convertBatch() {
  const state = batchState;
  if (
    batchIsBusy() ||
    !state.items.length ||
    !state.destination ||
    !htmlExportState.languages.length
  )
    return;
  const htmlOptions = htmlExportOptions();
  state.busy = true;
  state.running = true;
  state.stop = false;
  batchError();
  state.items.forEach((item) => {
    delete item.status;
    delete item.message;
  });
  let success = 0,
    failed = 0;
  try {
    for (const item of state.items) {
      if (state.stop) break;
      item.status = 'running';
      renderBatch();
      uiBind(
        $('batch-progress'),
        'textContent',
        () => ui`変換中 ${success + failed + 1} / ${state.items.length}：${item.name}`,
      );
      try {
        const result = await batchRequest('convert', {
          id: item.id,
          destination: state.destination.id,
          htmlOptions,
        });
        item.status = 'success';
        item.message = result.path;
        success++;
      } catch (error) {
        item.status = 'error';
        item.message = error.message;
        failed++;
      }
    }
  } finally {
    state.busy = false;
    state.running = false;
    renderBatch();
    const waiting = state.items.length - success - failed;
    uiBind(
      $('batch-progress'),
      'textContent',
      () =>
        ui`${waiting ? ui('停止') : ui('完了')}：出力 ${success}件・失敗 ${failed}件${waiting ? ui`・未処理 ${waiting}件` : ''}`,
    );
  }
}
function setupDownloadMenu() {
  $('download-button').hidden = false;
  $('run-button').hidden = false;
  $('download-button').onclick = () => {
    closeRecent();
    updateFlowEditButtons();
    $('export-button').disabled = flowEditBusy || loadingFlow;
    $('download-dialog').showModal();
  };
  $('close-download').onclick = () => $('download-dialog').close();
  $('export-button').onclick = openHtmlExport;
  $('html-source-select').onclick = selectHtmlSource;
  $('html-single-save').onclick = exportHtml;
  $('html-single-tab').onclick = () => setHtmlExportTab('single');
  $('html-batch-tab').onclick = () => setHtmlExportTab('batch');
  for (const tab of ['single', 'batch'])
    $('html-' + tab + '-tab').onkeydown = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || batchIsBusy()) return;
      event.preventDefault();
      setHtmlExportTab(
        event.key === 'Home'
          ? 'single'
          : event.key === 'End'
            ? 'batch'
            : htmlExportState.tab === 'single'
              ? 'batch'
              : 'single',
      );
      $('html-' + htmlExportState.tab + '-tab').focus();
    };
  $('html-language-switcher').onchange = () => {
    htmlExportState.showSwitcher = $('html-language-switcher').checked;
    if (!htmlExportState.showSwitcher)
      htmlExportState.languages = [
        htmlExportState.languages.includes(uiLanguage)
          ? uiLanguage
          : htmlExportState.languages[0] || uiLanguage,
      ];
    renderHtmlLanguageOptions();
  };
  $('html-language-options').onchange = (event) => {
    const input = event.target;
    if (batchIsBusy()) return;
    if (input.name === 'html-export-all' && htmlExportState.showSwitcher) {
      htmlExportState.languages = input.checked ? [...UI_LANGUAGES] : [];
      renderHtmlExport();
      return;
    }
    if (input.name !== 'html-export-language') return;
    if (htmlExportState.showSwitcher) {
      htmlExportState.languages = UI_LANGUAGES.filter((locale) =>
        locale === input.value ? input.checked : htmlExportState.languages.includes(locale),
      );
    } else {
      htmlExportState.languages = [input.value];
      $('html-language-picker').open = false;
    }
    renderHtmlExport();
  };
  $('html-language-picker').onkeydown = (event) => {
    if (event.key === 'Escape' && $('html-language-picker').open) {
      event.preventDefault();
      event.stopPropagation();
      $('html-language-picker').open = false;
      $('html-language-picker').querySelector('summary').focus();
    }
  };
  $('batch-dialog').addEventListener('click', (event) => {
    if (!event.target.closest('#html-language-picker')) $('html-language-picker').open = false;
  });
  $('close-batch').onclick = () => {
    if (!batchIsBusy()) $('batch-dialog').close();
  };
  $('batch-dialog').addEventListener('cancel', (event) => {
    if (batchIsBusy()) event.preventDefault();
  });
  $('batch-files').onclick = () => selectBatch('files');
  $('batch-folder').onclick = () => selectBatch('folder');
  $('batch-destination').onclick = () => selectBatch('destination');
  $('batch-drop').onclick = () => selectBatch('files');
  $('batch-drop').onkeydown = (event) => {
    if (['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      selectBatch('files');
    }
  };
  $('batch-clear').onclick = () => removeBatchItems(batchState.items.map((item) => item.id));
  $('batch-list').onclick = (event) => {
    const button = event.target.closest('[data-batch-remove]');
    if (button) removeBatchItems([button.dataset.batchRemove]);
  };
  $('batch-start').onclick = convertBatch;
  $('batch-stop').onclick = () => {
    batchState.stop = true;
    renderBatch();
  };
  // Capture drops anywhere in this modal; they must never replace the open flow.
  document.addEventListener(
    'dragenter',
    (event) => {
      if (!$('batch-dialog').open) return;
      if ([...event.dataTransfer.types].includes('Files')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (htmlExportState.tab === 'batch') $('batch-drop').classList.add('drag-over');
      }
    },
    true,
  );
  document.addEventListener(
    'dragover',
    (event) => {
      if ($('batch-dialog').open) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  document.addEventListener(
    'dragleave',
    (event) => {
      if ($('batch-dialog').open && !event.relatedTarget)
        $('batch-drop').classList.remove('drag-over');
    },
    true,
  );
  document.addEventListener(
    'drop',
    (event) => {
      if (!$('batch-dialog').open) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      $('batch-drop').classList.remove('drag-over');
      dropDepth = 0;
      $('drop-overlay').hidden = true;
      if (htmlExportState.tab === 'batch') addDroppedBatchFiles(event.dataTransfer.files);
    },
    true,
  );
}
