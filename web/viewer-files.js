// Open flows, recent files, drag and drop, and HTML export.

function syncRecentPicker() {
  $('recent-picker').hidden = !CAN_EDIT;
  $('file-name').hidden = CAN_EDIT;
  if (!CAN_EDIT) return;
  uiBind($('recent-name'), 'textContent', () =>
    DATA.nodes.length ? DATA.name : ui('Open a flow'),
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
    : ui('<p class="recent-empty">No recent flows</p>');
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
    toast(ui('Could not retrieve recent flows. Check that the server is running.'));
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
    if (!response.ok) throw new Error(result.error || ui('Could not load flow.'));
    init(cached?.model || result);
    toast(ui`Switched to ${DATA.name}`);
  } catch (error) {
    showFileError(error.message || ui('Could not switch flows.'));
  } finally {
    endFlowLoad();
  }
}

async function loadFile(file) {
  if (!file) return;
  if (!SERVER.token) {
    toast(ui('Use start_viewer.cmd to open another flow.'));
    return;
  }
  if (!/\.(tflx|tfl)$/i.test(file.name)) {
    toast(ui('Select a .tflx or .tfl file.'));
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
    if (!res.ok) throw new Error(data.error || ui('Could not load file.'));
    init(data);
    toast(ui`Loaded ${file.name}`);
  } catch (e) {
    toast(e.message || ui('Loading failed.'));
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
    toast(ui`Loaded ${model.name}`);
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
    if (!response.ok) throw new Error(result.error || ui('Could not open flow.'));
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
  uiBind($('html-single-status'), 'textContent', () => ui('Choosing destination…'));
  try {
    const response = await uiFetch('/api/save-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Viewer-Token': SERVER.token },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || ui('Could not export HTML.'));
    uiBind($('html-single-status'), 'textContent', () =>
      result.cancelled ? '' : ui`Exported ${result.name}`,
    );
    if (!result.cancelled) toast(ui`Exported ${result.name}`);
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
