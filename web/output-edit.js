// Drafts stay in this dialog until the user confirms them.
let outputEditor = null;
const outputDropdowns = new Map();

// Native select menus may align the selected option over the field. Anchor our
// small option lists below it so Windows and browser views behave alike.
function closeOutputDropdowns() {
  for (const { button, list } of outputDropdowns.values()) {
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }
}

function syncOutputDropdowns() {
  for (const { select, button, list } of outputDropdowns.values()) {
    button.querySelector('span').textContent = select.selectedOptions[0]?.textContent || '';
    button.disabled = select.disabled;
    for (const option of list.children) {
      option.textContent =
        [...select.options].find((item) => item.value === option.dataset.value)?.textContent || '';
      option.setAttribute('aria-selected', String(option.dataset.value === select.value));
    }
  }
}

function setupOutputDropdown(id) {
  const select = $(id),
    wrapper = document.createElement('div');
  wrapper.className = 'output-dropdown';
  select.before(wrapper);
  wrapper.append(select);
  select.hidden = true;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = `${id}-trigger`;
  button.className = 'output-dropdown-trigger';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', `${id}-options`);
  button.innerHTML =
    '<span></span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';
  const label = document.querySelector(`label[for="${id}"]`);
  label.htmlFor = button.id;
  label.id = `${id}-label`;
  const list = document.createElement('div');
  list.id = `${id}-options`;
  list.className = 'output-dropdown-options';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-labelledby', label.id);
  list.hidden = true;
  for (const item of select.options) {
    const option = document.createElement('button');
    option.type = 'button';
    option.setAttribute('role', 'option');
    option.tabIndex = -1;
    option.dataset.value = item.value;
    option.textContent = item.textContent;
    option.onclick = () => {
      select.value = item.value;
      closeOutputDropdowns();
      select.dispatchEvent(new Event('change', { bubbles: true }));
      button.focus();
    };
    list.append(option);
  }
  const open = () => {
    closeOutputDropdowns();
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    [...list.children].find((option) => option.dataset.value === select.value)?.focus();
  };
  button.onclick = () => (list.hidden ? open() : closeOutputDropdowns());
  button.onkeydown = (event) => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      open();
    }
  };
  list.onkeydown = (event) => {
    const items = [...list.children],
      index = items.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeOutputDropdowns();
      button.focus();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      items[next].focus();
    }
  };
  wrapper.addEventListener('focusout', (event) => {
    if (!wrapper.contains(event.relatedTarget)) closeOutputDropdowns();
  });
  wrapper.append(button, list);
  outputDropdowns.set(id, { select, button, list });
}

async function outputRequest(action, data = {}) {
  const response = await uiFetch(`/api/output/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Viewer-Token': SERVER.token },
    body: JSON.stringify({
      exportKey: DATA.exportKey,
      revision: DATA.editRevision,
      stepId: outputEditor.stepId,
      ...data,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || ui('Could not load output settings.'));
  return result;
}

function outputDestination() {
  const server = $('output-target').value === 'server';
  return {
    format: server ? 'server' : $('output-format').value,
    name: $('output-name').value,
    folder: $('output-folder').value,
    sheet: $('output-sheet').value,
    server: $('output-server').value.trim().replace(/\/+$/, ''),
    project: $('output-project')
      .value.trim()
      .replace(/^\/+|\/+$/g, ''),
    projectId: outputEditor?.verified?.projectId || '',
  };
}

function outputError(message = '') {
  uiBind($('output-error'), 'textContent', () => uiMessage(message));
  $('output-error').hidden = !message;
}

function renderOutputEditor() {
  if (!outputEditor) return;
  syncOutputDropdowns();
  const value = outputDestination(),
    server = value.format === 'server';
  $('output-file-fields').hidden = server;
  $('output-server-fields').hidden = !server;
  $('output-sheet-row').hidden = value.format !== 'excel';
  uiBind($('output-name-label'), 'textContent', () =>
    server ? ui('Data source name') : ui('File name (without extension)'),
  );
  $('output-extension').textContent = server
    ? ''
    : { hyper: '.hyper', csv: '.csv', excel: '.xlsx' }[value.format];
  $('output-confirm').disabled =
    outputEditor.busy ||
    !value.name.trim() ||
    (server && !outputEditor.verified) ||
    (!server && outputEditor.baseline === JSON.stringify(value));
  $('output-verify').disabled = outputEditor.busy || outputEditor.checking;
  uiBind($('output-project-status'), 'textContent', () =>
    outputEditor.checking
      ? ui('Verifying project…')
      : outputEditor.verified
        ? ui`Verified · Project ID: ${outputEditor.verified.projectId}`
        : ui('Project not yet verified.'),
  );
}

function outputBusy(busy) {
  outputEditor.busy = busy;
  $('output-dialog')
    .querySelectorAll('input,select,button')
    .forEach((control) => (control.disabled = busy));
  setFlowEditBusy(busy);
  renderOutputEditor();
}

function invalidateOutputProject() {
  if (!outputEditor) return;
  outputEditor.verified = null;
  outputEditor.checking = false;
  outputEditor.lookupSequence = (outputEditor.lookupSequence || 0) + 1;
  outputError();
  renderOutputEditor();
}

async function verifyOutputProject() {
  if (
    !outputEditor ||
    outputEditor.busy ||
    outputEditor.checking ||
    $('output-target').value !== 'server'
  )
    return;
  const value = outputDestination();
  if (!value.server || !value.project) return;
  if (
    outputEditor.verified?.server === value.server &&
    outputEditor.verified?.project === value.project
  )
    return;
  const editor = outputEditor;
  const sequence = (editor.lookupSequence = (editor.lookupSequence || 0) + 1);
  editor.checking = true;
  const current = () => outputEditor === editor && editor.lookupSequence === sequence;
  renderOutputEditor();
  outputError();
  try {
    const verified = await outputRequest('project', {
      server: value.server,
      project: value.project,
    });
    if (current()) editor.verified = verified;
  } catch (error) {
    if (current()) {
      editor.verified = null;
      outputError(error.message);
    }
  } finally {
    if (current()) {
      editor.checking = false;
      renderOutputEditor();
    }
  }
}

async function openOutputEditor(stepId) {
  if (!CAN_EDIT || flowEditBusy || loadingFlow) return;
  outputEditor = { stepId, busy: false, verified: null };
  $('output-form').reset();
  $('output-step-name').textContent = byId.get(stepId)?.name || '';
  outputError();
  $('output-dialog').showModal();
  outputBusy(true);
  try {
    const result = await outputRequest('defaults');
    const config = result.configuration;
    $('output-target').value = config.format === 'server' ? 'server' : 'file';
    $('output-format').value = config.format === 'server' ? 'hyper' : config.format;
    for (const key of ['name', 'folder', 'sheet', 'project'])
      $(`output-${key}`).value = config[key] || '';
    $('output-sheet').value = $('output-sheet').value.replace(/^\[(.*)\$\]$/, '$1');
    $('output-server').value = config.server || result.server || '';
    // Show the existing options, but never provide controls to change them.
    const node = byId.get(stepId);
    const options =
      Object.values(node.properties || {}).find(
        (p) => p?.nodePropertyType === '.v2020_2_1.OutputRefreshOptions',
      ) || {};
    const labels = uiLabels({
      outputOperationTypeCreate: 'Create table',
      outputOperationTypeAppend: 'Append to table',
      outputOperationTypeTruncate: 'Replace data',
      outputOperationTypeUpsert: 'Update and insert data',
    });
    const mode =
      options.outputOperationType ||
      (config.format === 'excel' ? 'outputOperationTypeAppend' : 'outputOperationTypeCreate');
    uiBind(
      $('output-writing'),
      'textContent',
      () =>
        ui`Full refresh: ${labels[mode] || mode}` +
        (options.incrementalOutputOperationType
          ? ui` / Incremental refresh: ${labels[options.incrementalOutputOperationType] || options.incrementalOutputOperationType}`
          : '') +
        (options.isIncrementalDefault ? ui(' / Default: incremental refresh') : ''),
    );
  } catch (error) {
    outputError(error.message);
  } finally {
    outputBusy(false);
    outputEditor.baseline = JSON.stringify(outputDestination());
    renderOutputEditor();
  }
}

function closeOutputEditor() {
  if (outputEditor?.busy) return;
  closeOutputDropdowns();
  $('output-dialog').close();
  outputEditor = null;
}

async function confirmOutputEdit(event) {
  event.preventDefault();
  if (!outputEditor || outputEditor.busy || $('output-confirm').disabled) return;
  outputBusy(true);
  outputError();
  try {
    const { change } = await outputRequest('prepare', {
      destination: outputDestination(),
      proof: outputEditor.verified?.proof,
    });
    const result = await requestFlowEdits('/api/preview-edits', [
      ...flowSession.history.changes,
      change,
    ]);
    flowSession.history.push(change);
    applyEditedModel(result);
    activeTab = 'settings';
    renderDetail();
    uiBind($('status-text'), 'textContent', () =>
      ui('Output changes confirmed · Not yet saved to file'),
    );
    outputBusy(false);
    closeOutputEditor();
  } catch (error) {
    outputError(error.message);
    outputBusy(false);
  }
}

function outputDraftDirty() {
  return !!outputEditor?.baseline && outputEditor.baseline !== JSON.stringify(outputDestination());
}

function setupOutputEditor() {
  setupOutputDropdown('output-target');
  setupOutputDropdown('output-format');
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.output-dropdown')) closeOutputDropdowns();
    const button = event.target.closest('[data-edit-output]');
    if (button) openOutputEditor(button.dataset.editOutput);
  });
  $('output-form').onsubmit = confirmOutputEdit;
  $('close-output').onclick = closeOutputEditor;
  $('output-cancel').onclick = closeOutputEditor;
  $('output-dialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    if ([...outputDropdowns.values()].some(({ list }) => !list.hidden)) closeOutputDropdowns();
    else closeOutputEditor();
  });
  $('output-form').addEventListener('input', renderOutputEditor);
  $('output-target').onchange = renderOutputEditor;
  $('output-format').onchange = renderOutputEditor;
  for (const id of ['output-server', 'output-project']) {
    $(id).oninput = invalidateOutputProject;
    $(id).onblur = (event) => {
      // Let explicit actions (including cancel and credential setup) receive their click.
      if (event.relatedTarget?.tagName !== 'BUTTON') verifyOutputProject();
    };
  }
  $('output-verify').onclick = verifyOutputProject;
  $('output-auth').onclick = async () => {
    const url = $('output-server').value.trim().replace(/\/+$/, '');
    await openPublish();
    if (url && $('publish-server').value.replace(/\/+$/, '').toLowerCase() !== url.toLowerCase()) {
      $('publish-token-name').value = '';
      $('publish-token-value').value = '';
    }
    if (url) $('publish-server').value = url;
    publishLog(
      ui(
        'Select Test authentication, then close this dialog to verify the destination. You do not need to publish the flow.',
      ),
    );
  };
  $('output-pick-folder').onclick = async () => {
    outputBusy(true);
    try {
      const result = await outputRequest('folder');
      if (result.folder) $('output-folder').value = result.folder;
    } catch (error) {
      outputError(error.message);
    } finally {
      outputBusy(false);
    }
  };
}
