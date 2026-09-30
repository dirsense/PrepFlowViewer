// Flow overview, connection summary and help.

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return ui`${Math.floor(bytes)} bytes`;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 1,
    value = bytes / 1024;
  // Match Windows size formatting: three displayed digits, truncating the rest.
  while (value >= 1000 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  const digits = value < 10 ? 2 : value < 100 ? 1 : 0,
    factor = 10 ** digits;
  return `${(Math.floor(value * factor) / factor).toLocaleString(uiLanguage, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[index]}`;
}

function connectionInfo(connection = {}, node) {
  // Connection-level server details and step-level data source details are stored separately.
  // Normalize before merging so projectName on a step overrides projectname on a connection.
  const attrs = {};
  for (const source of [
    connection.connectionAttributes,
    node?.connection?.connectionAttributes,
    node?.raw?.connectionAttributes,
  ]) {
    for (const [key, value] of Object.entries(source || {})) attrs[key.toLowerCase()] = value;
  }
  const value = (...keys) => {
    for (const key of keys) {
      const v = attrs[key];
      if (v !== undefined && v !== null && String(v).trim()) return String(v);
    }
    return '';
  };
  const type = value('class') || connection.connectionType || ui('Unknown');
  const server = value('server', 'serverurl', 'serveraddress', 'hostname', 'host'),
    file = value('filename');
  const datasource = value('datasourcename'),
    project = value('projectname');
  const tableau = /tableau|sqlproxy/i.test(type) || (!!datasource && !!project);
  const siteKeys = ['sitename', 'site', 'sitecontenturl', 'siteid'];
  const site = value(...siteKeys) || (siteKeys.some((key) => attrs[key] === '') ? 'Default' : '');
  const ownerValue =
    attrs.datasourceownername ?? attrs.ownername ?? attrs.datasourceowner ?? attrs.owner;
  const owner =
    typeof ownerValue === 'object' && ownerValue
      ? String(ownerValue.displayName || ownerValue.name || '')
      : String(ownerValue ?? '');
  return {
    type,
    label: tableau ? 'Tableau Server' : type,
    tableau,
    server,
    file,
    datasource,
    project,
    site,
    owner,
    port: value('port'),
    database: value('dbname', 'database'),
    name: connection.name || '',
  };
}

function connectionGroups(model) {
  const connections = (model.connections || []).map((connection, index) => ({
    connection,
    key: connection.id || `connection-${index}`,
    nodes: [],
  }));
  for (const node of model.nodes || []) {
    if (node.kind !== 'input') continue;
    const id = node.raw?.connectionId || node.connection?.id;
    let entry = connections.find((item) => id && item.key === id);
    if (!entry) {
      entry = { connection: node.connection || {}, key: id || `step-${node.id}`, nodes: [] };
      connections.push(entry);
    }
    entry.nodes.push(node);
  }
  const groups = new Map();
  for (const entry of connections) {
    const info = connectionInfo(entry.connection, entry.nodes[0]);
    let address = info.server.trim().replace(/\/+$/, '');
    if (address) {
      try {
        const url = new URL(address.includes('://') ? address : `https://${address}`);
        address = url.host.toLowerCase();
      } catch {
        address = address.toLowerCase();
      }
    }
    const file = info.file.replace(/\\/g, '/');
    const key = address
      ? JSON.stringify(['server', info.tableau ? 'tableau' : info.type, address, info.port])
      : file
        ? JSON.stringify(['file', /^(?:[a-z]:|\/\/)/i.test(file) ? file.toLowerCase() : file])
        : JSON.stringify(['connection', entry.key]);
    if (!groups.has(key))
      groups.set(key, {
        info,
        title: info.server || info.file || info.name || ui('No connection source information'),
        entries: [],
        steps: 0,
      });
    const group = groups.get(key);
    group.entries.push({ ...entry, info });
    group.steps += entry.nodes.length;
  }
  return [...groups.values()];
}

function connectionFields(info, node) {
  if (info.tableau)
    return {
      Server: info.server || ui('Not recorded in flow'),
      'Project name': info.project || ui('Not recorded in flow'),
      'Data source name': info.datasource || ui('Not recorded in flow'),
    };
  return {
    'Data source name': info.datasource || null,
    'Project name': info.project || null,
    Database: info.database || null,
    Table: node?.raw?.relation?.table || node?.raw?.attributes?.tablename || null,
  };
}

function tableauConnectionHtml(info) {
  return `<div class="tableau-connection">${keyValues(connectionFields(info))}</div>`;
}

function connectionsHtml() {
  const groups = connectionGroups(DATA);
  if (!groups.length) return ui('<p class="overview-note">No connections.</p>');
  return ui`<p class="overview-note">Expand a connection source to see its input steps.</p>${groups.map((group) => ui`<details class="connection-group"><summary><span class="connection-source"><strong>${esc(group.title)}</strong><small>${esc(group.info.label)} · ${group.steps} input steps</small></span></summary><div class="connection-steps">${group.entries.map((entry) => (entry.nodes.length ? entry.nodes.map((node) => ui`<section class="connection-step"><h3>${esc(node.name)}</h3>${keyValues(connectionFields(connectionInfo(entry.connection, node), node))}<button class="button" data-connection-step="${esc(node.id)}">View step connection settings</button></section>`).join('') : ui`<section class="connection-step"><h3>${esc(entry.info.name || ui('Connection definition'))}</h3>${keyValues(connectionFields(entry.info))}<p class="overview-note">No input steps use this connection.</p></section>`)).join('')}</div></details>`).join('')}`;
}

function overviewHelpHtml() {
  return ui`<div class="overview-help"><h3>Explore the flow</h3><ul><li>Click a step to see details. Click it again or click a blank area of the diagram to return to flow information.</li><li>Scroll to zoom and drag to pan.</li><li>Double-click a blank area or use the fit icon in the toolbar to show the entire flow.</li><li>Fit mode adjusts automatically when the details panel is resized. Manual zooming or panning preserves your view.</li></ul><h3>Inspect transformations and formulas</h3><ul><li>Switch between Fields, Changes and Settings. Use search to filter fields and transformations.</li><li>Open a formula to switch between Original and Formatted views. You can copy formulas and highlight matching brackets.</li></ul>${CAN_EDIT ? ui('<h3>Edit, save and share</h3><ul><li>After editing a formula, select Confirm changes. At this point, changes apply only within the Viewer.</li><li>Use Undo / Redo in the toolbar for confirmed edits. Select Save flow from the download icon to save as TFL / TFLX.</li><li>Choose languages in Export HTML, then export from the Single export or Batch export tab.</li><li>Use the publish icon to publish to Tableau Server. This is separate from saving a flow on your PC.</li><li>Select Edit output destination on an output step to change its file format, name, folder or Tableau Server destination. Server projects are verified on the default site using your credentials. Write options are read-only. Closing with × discards unconfirmed edits.</li><li>Use the play icon to review destinations and run individual outputs or all outputs. Running requires Tableau Prep Builder and updates actual destination data. Track progress in the execution log.</li></ul>') : ui('<h3>About this HTML</h3><p>This file is read-only. Use the Viewer application to edit formulas, save flows and publish to Server.</p>')}<p class="overview-note">Displays definitions saved in the flow without connecting to data sources.</p></div>`;
}

function renderFlowInfo(container) {
  const source = DATA.sourcePath || '',
    folder = source.slice(0, Math.max(source.lastIndexOf('/'), source.lastIndexOf('\\')) + 1);
  container.innerHTML = ui`<div class="meta-stats">${[
    [ui('Steps'), DATA.stats.steps],
    [ui('Transformations'), DATA.stats.actions],
    [ui('Formula'), DATA.stats.calculations],
  ]
    .map(
      ([label, value]) =>
        `<div class="meta-stat"><strong>${value || 0}</strong><span>${label}</span></div>`,
    )
    .join(
      '',
    )}</div>${keyValues({ File: DATA.name, 'Saved location': CAN_EDIT ? folder || ui('Not yet set (shown after saving the flow)') : null, 'File size': formatFileSize(DATA.fileSizeBytes), 'Definition parsing time': DATA.stats.parseMs + ' ms', 'Saved positions': DATA.stats.savedPositions + ui(' steps'), 'Flow format version': DATA.formatVersion, Analysis: ui('Python / No connections or data loading') })}<p>Shows transformations from flow and layout/colors from displaySettings. Fields are reconstructed statically, not from execution results. Each step notes estimates and unsupported transformations.</p>${DATA.warnings.map((w) => `<p class="warning">${esc(uiMessage(w))}</p>`).join('')}<details class="raw-details"><summary>Packaged files (data not loaded)</summary><pre class="raw-pre">${esc(DATA.entries.map((e) => `${e.name}  (${e.bytes.toLocaleString()} bytes)`).join('\n'))}</pre></details><details class="raw-details"><summary>Parameters</summary><pre class="raw-pre">${esc(json(DATA.parameters))}</pre></details><details class="raw-details"><summary>maestroMetadata</summary><pre class="raw-pre">${esc(json(DATA.metadata))}</pre></details>`;
  if (folder && SERVER.token) {
    const cell = container.querySelector('.kv dd:nth-of-type(2)'),
      button = document.createElement('button');
    cell.classList.add('flow-location');
    button.className = 'button folder-open';
    button.id = 'open-source-folder-panel';
    uiBind(button, 'textContent', () => ui('Open saved location'));
    button.onclick = async () => {
      button.disabled = true;
      cell.querySelector('.folder-error')?.remove();
      try {
        const response = await uiFetch('/api/open-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Viewer-Token': SERVER.token },
          body: JSON.stringify({ exportKey: DATA.exportKey }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || ui('Could not open saved location.'));
      } catch (error) {
        const message = document.createElement('p');
        message.className = 'folder-error';
        message.setAttribute('role', 'alert');
        uiBind(message, 'textContent', () => uiMessage(error.message));
        cell.append(message);
      } finally {
        button.disabled = false;
      }
    };
    cell.append(button);
  }
}
