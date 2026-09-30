// フローを開く、履歴、ドロップ、HTML 出力。

function syncRecentPicker() {
  $('recent-picker').hidden = !CAN_EDIT;
  $('file-name').hidden = CAN_EDIT;
  if (!CAN_EDIT) return;
  uiBind($('recent-name'), 'textContent', () =>
    DATA.nodes.length ? DATA.name : ui('フローを開いてください'),
  );
  $('recent-path').textContent = DATA.sourcePath || '';
  $('recent-toggle').title = DATA.sourcePath || DATA.name;
  $('recent-menu').innerHTML = recentFiles.length
    ? recentFiles
        .map(
          (f) =>
            `<button role="menuitem" data-recent-id="${esc(f.id)}" title="${esc(f.path)}"${f.id === DATA.recentId ? ' aria-current="true"' : ''}><span class="recent-item-name">${esc(f.name)}</span><span class="recent-path">${esc(f.path)}</span></button>`,
        )
        .join('')
    : ui('<p class="recent-empty">最近開いたフローはありません</p>');
}

function closeRecent(restore = false) {
  $('recent-menu').hidden = true;
  $('recent-toggle').setAttribute('aria-expanded', 'false');
  if (restore) $('recent-toggle').focus();
}

async function openRecent() {
  if (loadingFlow || flowEditBusy) return;
  if (!$('recent-menu').hidden) {
    closeRecent();
    return;
  }
  await refreshRecent();
  $('recent-menu').hidden = false;
  $('recent-toggle').setAttribute('aria-expanded', 'true');
  $('recent-menu').querySelector('button')?.focus();
}

function showFileError(message) {
  uiBind($('file-error-message'), 'textContent', () => uiMessage(message));
  if (!$('file-error-dialog').open) $('file-error-dialog').showModal();
}

async function refreshRecent() {
  if (!SERVER.token) return;
  try {
    const response = await uiFetch('/api/recent', { headers: { 'X-Viewer-Token': SERVER.token } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    recentFiles = result.recent;
    syncRecentPicker();
  } catch {
    toast(ui('最近のフローを取得できませんでした。サーバーの起動状態を確認してください。'));
  }
}

function beginFlowLoad() {
  if (loadingFlow || flowEditBusy) return false;
  closeRecent();
  loadingFlow = true;
  $('busy-overlay').hidden = false;
  updateFlowEditButtons();
  return true;
}

function endFlowLoad() {
  loadingFlow = false;
  $('busy-overlay').hidden = true;
  updateFlowEditButtons();
  syncRecentPicker();
  refreshRecent();
}

async function loadRecent(id) {
  if (!id || !SERVER.token || !beginFlowLoad()) return;
  try {
    const cached = [...flowSessions.values()].find(
      (s) => s.model.recentId === id && s.history.started,
    );
    const response = await uiFetch('/api/recent/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Viewer-Token': SERVER.token },
      body: JSON.stringify({ id }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || ui('フローを読み込めませんでした。'));
    init(cached?.model || result);
    toast(ui`${DATA.name} に切り替えました`);
  } catch (error) {
    showFileError(error.message || ui('切り替えに失敗しました。'));
  } finally {
    endFlowLoad();
  }
}

async function loadFile(file) {
  if (!file) return;
  if (!SERVER.token) {
    toast(ui('別のフローは「start_viewer.cmd」から開いてください。'));
    return;
  }
  if (!/\.(tflx|tfl)$/i.test(file.name)) {
    toast(ui('.tflx または .tfl ファイルを選択してください。'));
    return;
  }
  if (!beginFlowLoad()) return;
  try {
    const res = await uiFetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Viewer-Token': SERVER.token,
        'X-File-Name': encodeURIComponent(file.name),
      },
      body: file,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || ui('ファイルを読み込めませんでした。'));
    init(data);
    toast(ui`${file.name} を読み込みました`);
  } catch (e) {
    toast(e.message || ui('読み込みに失敗しました。'));
  } finally {
    endFlowLoad();
    $('file-input').value = '';
  }
}

function beginNativeFlowDrop() {
  dropDepth = 0;
  $('drop-overlay').hidden = true;
  if ($('batch-dialog')?.open) return false;
  return CAN_EDIT && beginFlowLoad();
}

function finishNativeFlowDrop(model, error) {
  try {
    if (error) {
      showFileError(error);
      return;
    }
    init(model);
    toast(ui`${model.name} を読み込みました`);
  } finally {
    endFlowLoad();
  }
}

function handleFileDrop(e) {
  e.preventDefault();
  dropDepth = 0;
  $('drop-overlay').hidden = true;
  // The desktop event supplies the original path on the Python side.
  if (!nativeDropReady) loadFile(e.dataTransfer.files[0]);
}

async function openFlowFile() {
  if (!SERVER.token || !beginFlowLoad()) return;
  try {
    const response = await uiFetch('/api/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Viewer-Token': SERVER.token },
      body: '{}',
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || ui('フローを開けませんでした。'));
    if (!result.cancelled) init(result);
  } catch (error) {
    toast(error.message);
  } finally {
    endFlowLoad();
  }
}

async function exportHtml() {
  if (
    !CAN_EDIT ||
    flowEditBusy ||
    loadingFlow ||
    batchIsBusy() ||
    !htmlExportState.source ||
    !htmlExportState.languages.length
  )
    return;
  const source = htmlExportState.source;
  const payload = {
    htmlOptions: htmlExportOptions(),
    ...(source.sourceId ? { sourceId: source.sourceId } : { exportKey: source.exportKey }),
  };
  htmlExportState.busy = true;
  renderHtmlExport();
  setFlowEditBusy(true);
  $('html-single-error').hidden = true;
  uiBind($('html-single-status'), 'textContent', () => ui('出力先を選択中…'));
  try {
    const response = await uiFetch('/api/save-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Viewer-Token': SERVER.token },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || ui('HTMLを出力できませんでした。'));
    uiBind($('html-single-status'), 'textContent', () =>
      result.cancelled ? '' : ui`${result.name} を出力しました`,
    );
    if (!result.cancelled) toast(ui`${result.name} を出力しました`);
  } catch (error) {
    $('html-single-status').textContent = '';
    uiBind($('html-single-error'), 'textContent', () => uiMessage(error.message));
    $('html-single-error').hidden = false;
  } finally {
    htmlExportState.busy = false;
    setFlowEditBusy(false);
    renderHtmlExport();
  }
}
