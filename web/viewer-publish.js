// Tableau Server authentication and publishing.

function publishLog(message, level = 'info') {
  const line = document.createElement('div');
  line.className = level;
  const time = new Date().toLocaleTimeString();
  uiBind(line, 'textContent', () => `${time}  ${uiMessage(message)}`);
  $('publish-log').append(line);
  $('publish-log').scrollTop = $('publish-log').scrollHeight;
}

async function openPublish() {
  if (!CAN_EDIT || flowEditBusy || loadingFlow) return;
  if ([...formulaDrafts.values()].some((d) => d.dirty)) {
    toast(ui('Confirm your formula edits before opening this dialog.'));
    return;
  }
  $('publish-log').replaceChildren();
  $('publish-form').reset();
  $('publish-name').value = (DATA.name || '').replace(/\.(tflx|tfl)$/i, '');
  $('publish-dialog').showModal();
  setPublishBusy(true);
  try {
    const response = await uiFetch('/api/publish/defaults', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Viewer-Token': SERVER.token },
      body: JSON.stringify({ exportKey: DATA.exportKey }),
    });
    const defaults = await response.json();
    if (!response.ok) throw new Error(defaults.error);
    for (const [id, key] of [
      ['publish-server', 'server_url'],
      ['publish-token-name', 'token_name'],
      ['publish-token-value', 'token_value'],
      ['publish-name', 'name'],
      ['publish-project', 'project'],
    ])
      $(id).value = defaults[key] || '';
  } catch (error) {
    publishLog(error.message, 'error');
  } finally {
    setPublishBusy(false);
  }
}

function setPublishBusy(busy) {
  publishBusy = busy;
  setFlowEditBusy(busy);
  $('publish-form')
    .querySelectorAll('input,button')
    .forEach((control) => (control.disabled = busy));
  $('start-publish').disabled = busy || !DATA.exportKey;
  $('close-publish').disabled = busy;
}

async function executePublish(publish) {
  if (publishBusy || !CAN_EDIT) return;
  if (!$('publish-form').reportValidity()) return;
  if (publish && (!$('publish-name').value.trim() || !$('publish-project').value.trim())) {
    publishLog(ui('Enter a publish name and destination.'), 'error');
    return;
  }
  const payload = {
    server_url: $('publish-server').value,
    token_name: $('publish-token-name').value,
    token_value: $('publish-token-value').value,
    name: $('publish-name').value,
    project: $('publish-project').value,
    exportKey: DATA.exportKey,
    revision: DATA.editRevision,
    changes: flowSession?.history.changes || [],
  };
  setPublishBusy(true);
  publishLog(publish ? ui('Starting publication.') : ui('Starting authentication test.'));
  let finished = false;
  try {
    const response = await uiFetch(publish ? '/api/publish/start' : '/api/publish/test-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Viewer-Token': SERVER.token },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || ui('Could not start the operation.'));
    }
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let pending = '';
    const receive = (line) => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.message) publishLog(event.message, event.level);
      if (event.done) finished = true;
    };
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        receive(pending.slice(0, end));
        pending = pending.slice(end + 1);
      }
      if (done) break;
    }
    if (pending) receive(pending);
    if (!finished)
      throw new Error(ui('Connection interrupted. Check the publication result on the server.'));
  } catch (error) {
    publishLog(error.message, 'error');
  } finally {
    setPublishBusy(false);
  }
}
