// Field lists, change cards and per-step settings in the details panel.

function warningHtml(n) {
  return n.warnings.length
    ? ui`<details class="warning"><summary>ⓘ Field reconstruction notes (${n.warnings.length})</summary><ul>${n.warnings.map((w) => `<li>${esc(uiMessage(w))}</li>`).join('')}</ul></details>`
    : '';
}

const CHANGE_SYMBOLS = {
  AddColumn: 'ƒx',
  QuickCalcColumn: 'ƒx',
  RemoveColumns: '⊠',
  RenameColumn: '✎',
  ChangeColumnType: 'Ab',
  RangeFilter: '▼',
  Filter: '▼',
  Remap: '⇄',
  Aggregate: 'Σ',
  SimpleJoin: '⋈',
  SimpleUnion: '⊞',
  Unpivot: '↳',
};

function actionIcon(type, size = 17) {
  const spec = ANNOTATIONS.find((item) => item.types.includes(type));
  return spec
    ? `<img class="action-icon" src="${PREP_ICONS.annotations[spec.key]}" width="${size}" height="${size}" alt="">`
    : esc(CHANGE_SYMBOLS[type] || '•');
}

function rawDetail(raw) {
  return ui`<details class="raw-details"><summary>Operation definition</summary><pre class="raw-pre">${esc(json(raw))}</pre></details>`;
}

function fieldChanges(f) {
  const unique = [...new Map((f.changes || []).map((c) => [c.type, c])).values()];
  const isRemoval = (c) => c.type === 'RemoveColumn' || c.type === 'RemoveColumns';
  if (f.deleted && !unique.some(isRemoval))
    unique.push({ type: 'RemoveColumns', label: ui('Removed') });
  return unique
    .map(
      (c) =>
        `<button class="change-icon ${isRemoval(c) ? 'removed' : ''}" data-action-id="${esc(c.actionId || '')}" title="${esc(ui(c.label))}" aria-label="${esc(f.name + ': ' + ui(c.label))}">${actionIcon(c.type, 15)}${isRemoval(c) ? ui('<span>Removed</span>') : ''}</button>`,
    )
    .join('');
}

function fieldDetailHtml(f) {
  let html = keyValues({
    'Data type':
      (TYPE_NAMES[f.type] || f.type) +
      (f.typeSource !== 'Definition' ? ' (' + ui(f.typeSource) + ')' : ''),
    Origin: f.origin,
    Status: f.deleted ? ui('Removed in this step') : ui('In use'),
  });
  if (f.expression) html += expressionHtml(f.expression);
  if (f.expressionVariants?.some((v) => v.expression))
    html += ui`<details class="raw-details"><summary>Formulas by input</summary>${f.expressionVariants.map((v) => `<p class="field-origin">${esc(v.source)}</p>${v.expression ? expressionHtml(v.expression) : ui('<p>Inherited input field</p>')}`).join('')}</details>`;
  if (f.changes?.length)
    html += `<div class="field-changes">${f.changes.map((c) => `<button data-action-id="${esc(c.actionId)}">${actionIcon(c.type, 15)} ${esc(ui(c.label))}${c.before ? ' : ' + esc(c.before) + ' → ' + esc(c.after) : ''} ↗</button>`).join('')}</div>`;
  return html;
}

function renderFields(n, q) {
  const inventory = n.fieldInventory || n.fields.map((f) => ({ ...f, deleted: false }));
  const used = inventory.filter((f) => !f.deleted).length,
    deleted = inventory.length - used;
  const list = inventory
    .map((f, i) => ({ f, i }))
    .filter(
      ({ f }) =>
        (fieldMode === 'all' || (fieldMode === 'used' ? !f.deleted : f.deleted)) &&
        textMatch(f.name + ' ' + f.type + ' ' + (f.expression || ''), q),
    );
  return ui`<div class="inventory-heading">Fields: <strong>${inventory.length}</strong> in total; <strong>${used}</strong> in use</div><div class="field-filters" aria-label="Field visibility">${[
    ['all', ui('All'), inventory.length],
    ['used', ui('In use'), used],
    ['deleted', ui('Removed'), deleted],
  ]
    .map(
      ([key, label, count]) =>
        `<button data-field-mode="${key}" class="${key === fieldMode ? 'active' : ''}" aria-pressed="${key === fieldMode}">${label} <span>${count}</span></button>`,
    )
    .join(
      '',
    )}</div>${warningHtml(n)}<table class="field-table"><thead><tr><th>Type</th><th>Field name</th><th>Change</th></tr></thead><tbody>${list.map(({ f, i }) => ui`<tr class="${f.deleted ? 'deleted-row' : ''}"><td><span class="type-symbol" title="${esc((TYPE_NAMES[f.type] || f.type) + ' / ' + ui(f.typeSource))}">${esc(TYPE_SYMBOL[f.type] || '?')}</span></td><td><button class="field-name" data-field="${i}" aria-expanded="false" title="Field details">${esc(f.name)}</button>${f.namespace && f.namespace !== 'Default' ? `<span class="namespace">${esc(NS_NAMES[f.namespace] || f.namespace)}</span>` : ''}</td><td><div class="change-icons">${fieldChanges(f)}</div></td></tr>`).join('')}</tbody></table>${list.length ? '' : ui('<div class="empty-note">No matching fields.</div>')}`;
}

function changeCategory(action) {
  if (ANNOTATIONS.find((spec) => spec.key === 'filter').types.includes(action.type))
    return 'filters';
  if (action.type !== 'ChangeColumnType' && action.expressions?.length) return 'formulas';
  return 'other';
}

function renderDetail() {
  const hasSelection = byId.has(selected),
    content = $('detail-content');
  document.querySelector('.detail-tabs:not(.overview-tabs)').hidden = !hasSelection;
  $('overview-tabs').hidden = hasSelection;
  document
    .querySelector('.detail-section')
    .setAttribute('aria-label', hasSelection ? ui('Step details') : ui('Flow overview'));
  document.querySelector('.detail-heading').hidden = !hasSelection;
  content.classList.toggle('flow-overview', !hasSelection);
  content.setAttribute('role', 'tabpanel');
  if (!hasSelection) {
    document.querySelector('.detail-search').hidden = true;
    document.querySelectorAll('[data-overview-tab]').forEach((button) => {
      const on = button.dataset.overviewTab === overviewTab;
      button.classList.toggle('active', on);
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
    });
    content.setAttribute('aria-labelledby', 'overview-' + overviewTab);
    if (overviewTab === 'info') renderFlowInfo(content);
    else if (overviewTab === 'connections') content.innerHTML = connectionsHtml();
    else content.innerHTML = overviewHelpHtml();
    content.scrollTop = 0;
    return;
  }
  document.querySelectorAll('[data-tab]').forEach((b) => {
    const on = b.dataset.tab === activeTab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $('detail-content').setAttribute('aria-labelledby', 'tab-' + activeTab);
  document.querySelector('.detail-search').hidden = !selected || activeTab === 'settings';
  $('detail-search').placeholder =
    activeTab === 'fields' ? ui('Search fields') : ui('Search changes and formulas');
  const n = byId.get(selected),
    q = $('detail-search').value.trim();
  if (!n) {
    $('detail-content').innerHTML =
      `<div class="empty-note">${DATA.nodes.length ? ui('Select a step in the flow diagram.') : ui('Open a flow and select a step.')}</div>`;
    return;
  }
  if (activeTab === 'fields') $('detail-content').innerHTML = renderFields(n, q);
  else if (activeTab === 'actions') {
    const counts = { all: n.actions.length, formulas: 0, filters: 0, other: 0 };
    n.actions.forEach((a) => counts[changeCategory(a)]++);
    if (!counts[changesMode]) changesMode = 'all';
    const tabs = [
      ['all', ui('All')],
      ['formulas', ui('Formula')],
      ['filters', ui('Filter')],
      ['other', ui('Other')],
    ].filter(([mode]) => counts[mode]);
    const list = n.actions
      .map((a, i) => ({ a, i }))
      .filter(
        ({ a }) =>
          (changesMode === 'all' || changeCategory(a) === changesMode) && textMatch(json(a), q),
      );
    $('detail-content').innerHTML =
      ui`<div class="changes-toolbar"><span>Changes <strong>${n.actions.length}</strong> items</span>${tabs.length ? ui`<div class="change-filters" role="group" aria-label="Change categories">${tabs.map(([mode, label]) => `<button data-changes-mode="${mode}" class="${changesMode === mode ? 'active' : ''}" aria-pressed="${changesMode === mode}">${label}${mode === 'all' ? '' : ' ' + counts[mode]}</button>`).join('')}</div>` : ''}</div><div class="changes-list">${list.map(({ a, i }) => actionHtml(a, i)).join('')}</div>${list.length ? '' : ui('<div class="empty-note">No matching changes.</div>')}`;
  } else $('detail-content').innerHTML = settingsHtml(n);
  $('detail-content').scrollTop = 0;
  requestAnimationFrame(updateFormulaPreviews);
}

function actionHtml(a, index) {
  if (a.type === 'SimpleUnion') return unionHtml(a.raw, byId.get(selected));
  const n = a.raw;
  let body = '';
  const heading =
    {
      AddColumn: ui('Calculated field'),
      RenameColumn: ui('Rename field'),
      RemoveColumn: ui('Remove fields'),
      RemoveColumns: ui('Remove fields'),
    }[a.type] || ui(a.label);
  const chips = (values) =>
    `<div class="field-chips">${values.map((v) => `<span class="chip">${esc(v)}</span>`).join('')}</div>`;
  if (a.type === 'SimpleJoin') {
    body = ui`<p class="change-context">${esc(JOIN_TYPE_LABELS[n.joinType] || n.joinType || ui('Unknown'))} join · ${(n.conditions || []).length} clauses</p>`;
  } else if (a.pivot) {
    const p = a.pivot;
    const sources = new Set(
      p.groups.flatMap((g) => g.columns.flatMap((c) => c.fields.map((f) => f.name))),
    );
    const outputs = new Set(
      p.groups.flatMap((g) => [g.name, ...g.columns.map((c) => c.name)]).filter(Boolean),
    );
    const summary =
      p.direction === 'columnsToRows'
        ? ui`${sources.size} source fields · ${outputs.size} output fields`
        : `${p.pivotField.name} → ${p.newColumns.length ? p.newColumns.length + ui(' columns') : ui('Column names not saved')} · ${p.aggregation || ui('Not set')}(${p.valueField.name})`;
    body = `<p class="change-context">${esc(summary)}</p>`;
  } else if (a.type === 'ChangeColumnType') {
    const changes =
      a.typeChanges ||
      Object.entries(n.fields || {}).map(([field, v]) => ({
        field,
        before: 'unknown',
        after: v.type || 'unknown',
      }));
    body = changes
      .map(
        (c) =>
          chips([c.field]) +
          `<p class="change-context">${esc(TYPE_NAMES[c.before] || c.before)} → <strong>${esc(TYPE_NAMES[c.after] || c.after)}</strong></p>`,
      )
      .join('');
  } else if (a.expressions.length) {
    body = a.expressions
      .map(
        (e) =>
          `${e.field && e.field !== 'Condition' ? chips([e.field]) : e.references?.length ? chips(e.references) : ''}${expressionHtml(e.expression, { stepId: selected, actionId: a.id, field: e.field })}`,
      )
      .join('');
  } else if (a.type === 'RemoveColumn') {
    body = chips(n.columnName ? [n.columnName] : []);
  } else if (a.type === 'RemoveColumns') {
    body = chips(n.columnNames || []);
  } else if (a.type === 'RenameColumn') {
    body =
      chips([n.rename]) +
      `<p class="change-context">${esc(n.columnName)} → <strong>${esc(n.rename)}</strong></p>`;
  } else if (a.type === 'MergeColumns') {
    body =
      chips(n.mergeColumnsList || []) +
      ui`<p class="change-context">Merge into: <strong>${esc(n.mergedColumnName || ui('Not set'))}</strong></p>`;
  } else if (['RangeFilter', 'ValueFilter'].includes(a.type)) {
    body = filterDisplayRows(n, a.type)
      .map(
        (row) =>
          chips([row.field]) + `<p class="change-context filter-context">${esc(row.summary)}</p>`,
      )
      .join('');
  } else if (a.type === 'Remap') {
    body =
      chips([n.columnName]) +
      ui`<table class="small-table"><thead><tr><th>Original value</th><th>Replacement</th></tr></thead><tbody>${Object.entries(
        n.values || {},
      )
        .map(
          ([to, from]) =>
            `<tr><td>${esc(Array.isArray(from) ? from.join(' / ') : json(from))}</td><td>${esc(to)}</td></tr>`,
        )
        .join('')}</tbody></table>`;
  } else if (a.type === 'SimpleUnion') body = unionHtml(n, byId.get(selected));
  else if (a.type === 'Aggregate') body = aggregateHtml(n);
  const phase =
    a.phase === 'Before' || a.phase === 'After'
      ? ui(a.phase) +
        (a.namespace !== 'Default' ? ' · ' + (NS_NAMES[a.namespace] || a.namespace) : '')
      : '';
  const symbol = actionIcon(a.type);
  return `<article class="change-entry" id="action-${index}" data-action="${esc(a.id)}"><div class="change-symbol" title="${esc(ui(a.label))}">${symbol}</div><div class="change-main"><div class="change-heading"><h3>${esc(heading)}</h3>${phase ? `<span class="phase-badge">${esc(phase)}</span>` : ''}<span class="change-order">${index + 1}</span></div>${n.description ? `<div class="action-comment">${esc(n.description)}</div>` : ''}${body}</div></article>`;
}

const JOIN_TYPE_LABELS = uiLabels({
  inner: 'Inner',
  left: 'Left',
  right: 'Right',
  full: 'Full outer',
  leftOnly: 'Left only',
  rightOnly: 'Right only',
  notInner: 'Not inner',
});

function joinHtml(n, node = byId.get(selected)) {
  const inputs = DATA.edges.filter((e) => e.target === node?.id);
  const left = byId.get(inputs.find((e) => e.namespace === 'Left')?.source),
    right = byId.get(inputs.find((e) => e.namespace === 'Right')?.source);
  const lc = left?.color || '#8395a0',
    rc = right?.color || '#8395a0',
    ln = left?.name || ui('Left input'),
    rn = right?.name || ui('Right input');
  const field = (value) => (/^\[[^\]]+\]$/.test(value || '') ? value.slice(1, -1) : value);
  const comparator = (value) =>
    ({ '==': '=', '!=': '≠', '<>': '≠', '>=': '≥', '<=': '≤' })[value] || value;
  const type = n.joinType,
    label = JOIN_TYPE_LABELS[type] || type || ui('Unknown'),
    clip = 'join-left-' + String(n.id || 'settings').replace(/[^a-zA-Z0-9_-]/g, '');
  const regions = joinRegions(type),
    fill = '#c8cdd0',
    leftFill = regions.left ? fill : 'white',
    rightFill = regions.right ? fill : 'white';
  const intersection = regions.overlap ? fill : 'white';
  const diagram = `<svg class="join-venn" viewBox="0 0 78 48" role="img" aria-label="${esc(ui('Join type: ') + label)}"><defs><clipPath id="${clip}"><circle cx="29" cy="24" r="19"/></clipPath></defs><circle cx="29" cy="24" r="19" fill="${leftFill}"/><circle cx="49" cy="24" r="19" fill="${rightFill}"/><circle cx="49" cy="24" r="19" fill="${intersection}" clip-path="url(#${clip})"/><circle cx="29" cy="24" r="19" fill="none" stroke="${lc}" stroke-width="1.5"/><circle cx="49" cy="24" r="19" fill="none" stroke="${rc}" stroke-width="1.5"/></svg>`;
  return ui`<section class="join-settings" style="--join-left:${lc};--join-right:${rc}"><h3>Applied join clauses</h3><table class="join-clauses"><thead><tr><th scope="col" class="join-left"><span>Left</span>${esc(ln)}</th><th scope="col" class="join-comparator"><span class="sr-only">Clause</span></th><th scope="col" class="join-right"><span>Right</span>${esc(rn)}</th></tr></thead><tbody>${(n.conditions || []).map((c) => `<tr><td class="join-left">${esc(field(c.leftExpression))}</td><td class="join-comparator">${esc(comparator(c.comparator))}</td><td class="join-right">${esc(field(c.rightExpression))}</td></tr>`).join('')}</tbody></table>${n.conditions?.length ? '' : ui('<p class="change-context">Join clauses were not saved.</p>')}<h3 class="join-type-heading">Join type: ${esc(label)}</h3><div class="join-type-preview"><span class="join-source-label" style="--source-color:${lc}">${esc(ln)}</span>${diagram}<span class="join-source-label" style="--source-color:${rc}">${esc(rn)}</span></div></section>`;
}

function aggregateHtml(n) {
  return ui`<table class="small-table"><thead><tr><th>Field</th><th>Role / Aggregation</th><th>Output field</th></tr></thead><tbody>${[...(n.groupByFields || []).map((x) => ({ ...x, role: ui('Group by') })), ...(n.aggregateFields || []).map((x) => ({ ...x, role: x.function }))].map((x) => `<tr><td>${esc(x.columnName)}</td><td><span class="badge changed">${esc(x.role)}</span></td><td>${esc(x.newColumnName || x.columnName)}</td></tr>`).join('')}</tbody></table>`;
}

function pivotHtml(pivot, node) {
  if (!pivot) return ui('<p class="change-context">Pivot settings were not saved.</p>');
  const field = (f) =>
    `<span class="pivot-field"><span class="type-symbol" title="${esc(TYPE_NAMES[f.type] || ui('Unknown'))}">${esc(TYPE_SYMBOL[f.type] || '?')}</span><span>${esc(f.name)}</span></span>`;
  const patterns = {
    Contains: ui(' contains'),
    'Starts with': ui(' starts with'),
    'Ends with': ui(' ends with'),
    'Regular Expression': ui(' (regular expression)'),
    Date: ui(' (date)'),
  };
  const retained = ui`<section class="pivot-retained"><h3>Field</h3>${pivot.retained.length ? `<ul>${pivot.retained.map((f) => `<li>${field(f)}</li>`).join('')}</ul>` : ui('<p class="change-context">None</p>')}</section>`;
  let content = '';
  if (pivot.direction === 'columnsToRows') {
    content = pivot.groups
      .map((group) => {
        const length = Math.max(group.values.length, ...group.columns.map((c) => c.fields.length));
        return `<table class="pivot-columns"><thead><tr><th scope="col">${esc(group.name)}</th>${group.columns.map((c) => `<th scope="col">${esc(c.name)}${c.pattern ? `<span class="pivot-pattern">「${esc(c.pattern.expression)}」${esc(patterns[c.pattern.type] || c.pattern.type)}</span>` : ''}</th>`).join('')}</tr></thead><tbody>${Array.from({ length }, (_, i) => `<tr><td>${esc(group.values[i] ?? '')}</td>${group.columns.map((c) => `<td>${c.fields[i] ? field(c.fields[i]) : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      })
      .join('');
  } else {
    content = ui`<div class="pivot-row-field"><h4>${esc(pivot.pivotField.name)}</h4><ul>${pivot.newColumns.map((name) => `<li>${esc(name)}</li>`).join('')}</ul></div><section class="pivot-aggregate"><h3>Aggregation for new columns</h3><div><span class="pivot-aggregation">${esc(pivot.aggregation || ui('Not set'))}</span>${field(pivot.valueField)}</div></section>`;
  }
  return ui`<section class="pivot-settings" aria-label="Pivot settings" style="--pivot-color:${esc(node?.color || '#499893')}">${retained}<section class="pivot-transformed"><div class="pivot-section-heading"><h3>Pivoted fields</h3><span class="pivot-direction">${pivot.direction === 'columnsToRows' ? ui('Columns to rows') : ui('Rows to columns')}</span></div>${content}</section>${pivot.notes.map((note) => `<p class="change-context">${esc(uiMessage(note))}</p>`).join('')}</section>`;
}

function unionHtml(n, node) {
  const inputs = [...new Set(DATA.edges.filter((e) => e.target === node?.id).map((e) => e.source))]
    .map((id) => byId.get(id))
    .filter(Boolean);
  return ui`<section class="union-inputs" aria-label="Union inputs"><h3>Input</h3><ul>${inputs.map((input) => `<li><span class="union-input-color" style="background:${esc(input.color)}" aria-hidden="true"></span><span>${esc(input.name)}</span></li>`).join('')}</ul></section>`;
}

function keyValues(object) {
  return `<dl class="kv">${Object.entries(object)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `<dt>${esc(ui(k))}</dt><dd>${esc(typeof v === 'object' ? json(v) : v)}</dd>`)
    .join('')}</dl>`;
}

function outputSettingsHtml(n) {
  const r = n.raw,
    type = (n.nodeType || '').split('.').pop();
  const formats = {
    WriteToHyper: ui('Tableau Data Extract (.hyper)'),
    WriteToCsv: 'CSV (.csv)',
    WriteToExcel: 'Microsoft Excel (.xlsx)',
    WriteToJson: 'JSON (.json)',
    WriteToDatabase: ui('Database'),
    PublishExtract: ui('Published data source'),
  };
  const path =
    r.hyperOutputFile ||
    r.csvOutputFile ||
    r.excelOutputFile ||
    r.jsonOutputFile ||
    r.outputFile ||
    '';
  const split = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const filename = path.slice(split + 1),
    folder = split < 0 ? '' : path.slice(0, split + 1).replace(/([^:])[\\/]$/, '$1');
  const fileType = ['WriteToHyper', 'WriteToCsv', 'WriteToExcel', 'WriteToJson'].includes(type);
  const row = (label, value) =>
    `<div class="output-row"><dt>${esc(label)}</dt><dd>${esc(value || ui('Not set'))}</dd></div>`;
  const props =
    Object.values(n.properties || {}).find(
      (p) => p?.nodePropertyType === '.v2020_2_1.OutputRefreshOptions',
    ) || {};
  const defaults = {
    WriteToHyper: 'Create',
    WriteToCsv: 'Create',
    WriteToJson: 'Create',
    PublishExtract: 'Create',
    WriteToDatabase: 'Append',
    WriteToExcel: 'Append',
  };
  const mode =
    props.outputOperationType || (defaults[type] ? 'outputOperationType' + defaults[type] : '');
  const modeLabels = {
    outputOperationTypeCreate: ui('Create table'),
    outputOperationTypeAppend: ui('Append to table'),
    outputOperationTypeTruncate: ui('Replace data'),
    outputOperationTypeUpsert: ui('Update and insert data'),
  };
  let fields = row(
    ui('Output destination'),
    fileType || path
      ? ui('File')
      : type === 'WriteToDatabase'
        ? ui('Database')
        : type === 'PublishExtract'
          ? ui('Published data source')
          : ui('No destination information'),
  );
  if (type === 'PublishExtract') {
    const connection = connectionInfo(n.connection);
    const text = (value) => (typeof value === 'string' ? value.trim() : '');
    const server = text(r.serverUrl) || connection.server;
    const project = text(r.projectName) || connection.project;
    const siteKeys = ['siteName', 'siteContentUrl', 'siteUrl'];
    const site =
      siteKeys.map((key) => text(r[key])).find(Boolean) ||
      (siteKeys.some((key) => r[key] === '') ? 'Default' : connection.site);
    fields += row(ui('Server'), server || ui('Not recorded in flow'));
    if (site) fields += row(ui('Site'), site);
    fields += row(ui('Project'), project || ui('Not recorded in flow'));
  }
  fields += row(
    ui('Name'),
    filename
      ? filename.replace(/\.(hyper|csv|xlsx|json)$/i, '')
      : r.attributes?.tablename || r.datasourceName || n.name,
  );
  if (fileType || path) fields += row(ui('Location'), folder);
  fields += row(ui('Output type'), formats[type] || type || ui('Unknown'));
  let options = row(ui('Full refresh'), modeLabels[mode] || mode || ui('No settings recorded'));
  if (props.incrementalOutputOperationType)
    options += row(
      ui('Incremental refresh'),
      modeLabels[props.incrementalOutputOperationType] || props.incrementalOutputOperationType,
    );
  if (props.isIncrementalDefault) options += row(ui('Default refresh'), ui('Incremental refresh'));
  const edit =
    typeof CAN_EDIT !== 'undefined' &&
    CAN_EDIT &&
    ['WriteToHyper', 'WriteToCsv', 'WriteToExcel', 'PublishExtract'].includes(type)
      ? ui`<button class="button" data-edit-output="${esc(n.id)}">Edit output destination</button>`
      : '';
  return ui`<section class="output-settings" aria-label="Output settings">${edit}<dl>${fields}</dl><h3>Write options</h3><dl>${options}</dl></section>`;
}

function settingsHtml(n) {
  if (n.kind === 'output') return outputSettingsHtml(n);
  if (n.kind === 'join') return joinHtml(n.raw.actionNode || n.raw, n);
  if (n.kind === 'union') return unionHtml(n.raw.actionNode || n.raw, n);
  if (n.kind === 'pivot') return pivotHtml(n.actions.find((a) => a.pivot)?.pivot, n);
  let out = '';
  const r = n.raw,
    action = r.actionNode;
  if (n.kind === 'input') {
    const info = connectionInfo(n.connection, n);
    out = ui`<div class="settings-grid"><div class="settings-card"><h3>${info.tableau ? 'Tableau Server' : ui('Input and connection')}</h3><div class="card-content">${info.tableau ? tableauConnectionHtml(info) : keyValues({ 'Connection name': n.connection.name, 'Connection type': n.connection.connectionAttributes?.class, 'Packaged data': n.connection.isPackaged ? ui('Yes') : ui('No / Unknown'), Table: r.relation?.table, File: n.connection.connectionAttributes?.filename, 'Input type': n.nodeType })}</div></div><div class="settings-card"><h3>Read settings</h3><div class="card-content">${keyValues({ Encoding: r.charSet, Delimiter: r.separator, Locale: r.locale, Header: r.containsHeaders, 'File pattern': r.filePattern, 'Include subfolders': r.includeSubDirectory, 'Data row count': ui('Not retrieved') })}</div></div></div>`;
    if (r.generatedInputs?.length)
      out += ui`<div class="settings-card"><h3>Wildcard input · ${r.generatedInputs.length} files</h3><div class="card-content">${r.generatedInputs.map((x) => `<p>${esc(x.filePath || x.inputNode?.name)}</p>`).join('')}</div></div>`;
    const extra = { ...r };
    ['fields', 'actions', 'generatedInputs', 'nextNodes'].forEach((k) => delete extra[k]);
    out +=
      ui`<div class="settings-card"><h3>Connections</h3><div class="card-content"><pre class="raw-pre">${esc(json(n.connection.connectionAttributes || n.connection))}</pre></div></div>` +
      rawDetail(extra);
  } else if (action) {
    const content =
      n.kind === 'join'
        ? joinHtml(action)
        : n.kind === 'aggregate'
          ? aggregateHtml(action)
          : n.kind === 'union'
            ? unionHtml(action, n)
            : n.kind === 'pivot'
              ? pivotHtml(action)
              : rawDetail(action);
    const inputs = DATA.edges.filter((e) => e.target === n.id);
    out = ui`<div class="settings-card"><h3>${esc(ui(n.kindLabel))} settings</h3><div class="card-content">${inputs.length > 1 ? `<div class="field-chips">${inputs.map((e) => `<span class="chip">${esc(NS_NAMES[e.namespace] || ui('Input'))} : ${esc(byId.get(e.source)?.name)}</span>`).join('')}</div>` : ''}${content}</div></div>${rawDetail(action)}`;
  } else
    out = ui`<div class="settings-card"><h3>Cleaning overview</h3><div class="card-content">${keyValues({ 'Step name': n.name, Transformations: n.actions.length, Formulas: n.calculations.length, Description: n.description || ui('No description saved'), Transformations: ui('See the Changes tab for operations in execution order.') })}</div></div>`;
  return (
    out +
    ui`<details class="raw-details"><summary>Original step definition</summary><pre class="raw-pre">${esc(json(n.raw))}</pre></details><details class="raw-details"><summary>Layout and color definition</summary><pre class="raw-pre">${esc(json(n.display))}</pre></details>`
  );
}
