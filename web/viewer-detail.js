// 右側パネルのフィールド一覧、変更内容、ステップ別設定。

function warningHtml(n) {
  return n.warnings.length
    ? ui`<details class="warning"><summary>ⓘ フィールド復元の注記 (${n.warnings.length})</summary><ul>${n.warnings.map((w) => `<li>${esc(uiMessage(w))}</li>`).join('')}</ul></details>`
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
  return ui`<details class="raw-details"><summary>この処理の定義</summary><pre class="raw-pre">${esc(json(raw))}</pre></details>`;
}

function fieldChanges(f) {
  const unique = [...new Map((f.changes || []).map((c) => [c.type, c])).values()];
  const isRemoval = (c) => c.type === 'RemoveColumn' || c.type === 'RemoveColumns';
  if (f.deleted && !unique.some(isRemoval))
    unique.push({ type: 'RemoveColumns', label: ui('削除') });
  return unique
    .map(
      (c) =>
        `<button class="change-icon ${isRemoval(c) ? 'removed' : ''}" data-action-id="${esc(c.actionId || '')}" title="${esc(ui(c.label))}" aria-label="${esc(f.name + ': ' + ui(c.label))}">${actionIcon(c.type, 15)}${isRemoval(c) ? ui('<span>削除</span>') : ''}</button>`,
    )
    .join('');
}

function fieldDetailHtml(f) {
  let html = keyValues({
    データ型:
      (TYPE_NAMES[f.type] || f.type) +
      (f.typeSource !== '定義' ? ' (' + ui(f.typeSource) + ')' : ''),
    由来: f.origin,
    状態: f.deleted ? ui('このステップで削除') : ui('使用中'),
  });
  if (f.expression) html += expressionHtml(f.expression);
  if (f.expressionVariants?.some((v) => v.expression))
    html += ui`<details class="raw-details"><summary>入力ごとの計算式</summary>${f.expressionVariants.map((v) => `<p class="field-origin">${esc(v.source)}</p>${v.expression ? expressionHtml(v.expression) : ui('<p>入力フィールドを継承</p>')}`).join('')}</details>`;
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
  return ui`<div class="inventory-heading">含まれるフィールド: <strong>${inventory.length}</strong> のうち <strong>${used}</strong> を使用</div><div class="field-filters" aria-label="フィールドの表示対象">${[
    ['all', ui('すべて'), inventory.length],
    ['used', ui('使用中'), used],
    ['deleted', ui('削除済み'), deleted],
  ]
    .map(
      ([key, label, count]) =>
        `<button data-field-mode="${key}" class="${key === fieldMode ? 'active' : ''}" aria-pressed="${key === fieldMode}">${label} <span>${count}</span></button>`,
    )
    .join(
      '',
    )}</div>${warningHtml(n)}<table class="field-table"><thead><tr><th>型</th><th>フィールド名</th><th>変更</th></tr></thead><tbody>${list.map(({ f, i }) => ui`<tr class="${f.deleted ? 'deleted-row' : ''}"><td><span class="type-symbol" title="${esc((TYPE_NAMES[f.type] || f.type) + ' / ' + ui(f.typeSource))}">${esc(TYPE_SYMBOL[f.type] || '?')}</span></td><td><button class="field-name" data-field="${i}" aria-expanded="false" title="フィールドの詳細">${esc(f.name)}</button>${f.namespace && f.namespace !== 'Default' ? `<span class="namespace">${esc(NS_NAMES[f.namespace] || f.namespace)}</span>` : ''}</td><td><div class="change-icons">${fieldChanges(f)}</div></td></tr>`).join('')}</tbody></table>${list.length ? '' : ui('<div class="empty-note">該当するフィールドはありません。</div>')}`;
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
    .setAttribute('aria-label', hasSelection ? ui('ステップの詳細') : ui('フロー全体の情報'));
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
    activeTab === 'fields' ? ui('フィールドを検索') : ui('変更内容・計算式を検索');
  const n = byId.get(selected),
    q = $('detail-search').value.trim();
  if (!n) {
    $('detail-content').innerHTML =
      `<div class="empty-note">${DATA.nodes.length ? ui('フローマップからステップを選択してください。') : ui('フローを開いて、ステップを選択してください。')}</div>`;
    return;
  }
  if (activeTab === 'fields') $('detail-content').innerHTML = renderFields(n, q);
  else if (activeTab === 'actions') {
    const counts = { all: n.actions.length, formulas: 0, filters: 0, other: 0 };
    n.actions.forEach((a) => counts[changeCategory(a)]++);
    if (!counts[changesMode]) changesMode = 'all';
    const tabs = [
      ['all', ui('すべて')],
      ['formulas', ui('計算式')],
      ['filters', ui('フィルター')],
      ['other', ui('その他')],
    ].filter(([mode]) => counts[mode]);
    const list = n.actions
      .map((a, i) => ({ a, i }))
      .filter(
        ({ a }) =>
          (changesMode === 'all' || changeCategory(a) === changesMode) && textMatch(json(a), q),
      );
    $('detail-content').innerHTML =
      ui`<div class="changes-toolbar"><span>変更内容 <strong>${n.actions.length}</strong> 件</span>${tabs.length ? ui`<div class="change-filters" role="group" aria-label="変更内容の種類">${tabs.map(([mode, label]) => `<button data-changes-mode="${mode}" class="${changesMode === mode ? 'active' : ''}" aria-pressed="${changesMode === mode}">${label}${mode === 'all' ? '' : ' ' + counts[mode]}</button>`).join('')}</div>` : ''}</div><div class="changes-list">${list.map(({ a, i }) => actionHtml(a, i)).join('')}</div>${list.length ? '' : ui('<div class="empty-note">該当する変更内容はありません。</div>')}`;
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
      AddColumn: ui('計算フィールド'),
      RenameColumn: ui('フィールド名を変更'),
      RemoveColumn: ui('フィールドを削除'),
      RemoveColumns: ui('フィールドを削除'),
    }[a.type] || ui(a.label);
  const chips = (values) =>
    `<div class="field-chips">${values.map((v) => `<span class="chip">${esc(v)}</span>`).join('')}</div>`;
  if (a.type === 'SimpleJoin') {
    body = ui`<p class="change-context">${esc(JOIN_TYPE_LABELS[n.joinType] || n.joinType || ui('不明'))}結合 · 条件 ${(n.conditions || []).length} 件</p>`;
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
        ? ui`対象 ${sources.size} フィールド · 出力 ${outputs.size} フィールド`
        : `${p.pivotField.name} → ${p.newColumns.length ? p.newColumns.length + ui(' 列') : ui('列名未保存')} · ${p.aggregation || ui('未設定')}(${p.valueField.name})`;
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
          `${e.field && e.field !== '条件式' ? chips([e.field]) : e.references?.length ? chips(e.references) : ''}${expressionHtml(e.expression, { stepId: selected, actionId: a.id, field: e.field })}`,
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
      ui`<p class="change-context">統合先: <strong>${esc(n.mergedColumnName || ui('未設定'))}</strong></p>`;
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
      ui`<table class="small-table"><thead><tr><th>元の値</th><th>置換後</th></tr></thead><tbody>${Object.entries(
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
    a.phase === '処理前' || a.phase === '処理後'
      ? ui(a.phase) +
        (a.namespace !== 'Default' ? ' · ' + (NS_NAMES[a.namespace] || a.namespace) : '')
      : '';
  const symbol = actionIcon(a.type);
  return `<article class="change-entry" id="action-${index}" data-action="${esc(a.id)}"><div class="change-symbol" title="${esc(ui(a.label))}">${symbol}</div><div class="change-main"><div class="change-heading"><h3>${esc(heading)}</h3>${phase ? `<span class="phase-badge">${esc(phase)}</span>` : ''}<span class="change-order">${index + 1}</span></div>${n.description ? `<div class="action-comment">${esc(n.description)}</div>` : ''}${body}</div></article>`;
}

const JOIN_TYPE_LABELS = uiLabels({
  inner: '内部',
  left: '左',
  right: '右',
  full: '完全外部',
  leftOnly: '左のみ',
  rightOnly: '右のみ',
  notInner: '内部を除外',
});

function joinHtml(n, node = byId.get(selected)) {
  const inputs = DATA.edges.filter((e) => e.target === node?.id);
  const left = byId.get(inputs.find((e) => e.namespace === 'Left')?.source),
    right = byId.get(inputs.find((e) => e.namespace === 'Right')?.source);
  const lc = left?.color || '#8395a0',
    rc = right?.color || '#8395a0',
    ln = left?.name || ui('左入力'),
    rn = right?.name || ui('右入力');
  const field = (value) => (/^\[[^\]]+\]$/.test(value || '') ? value.slice(1, -1) : value);
  const comparator = (value) =>
    ({ '==': '=', '!=': '≠', '<>': '≠', '>=': '≥', '<=': '≤' })[value] || value;
  const type = n.joinType,
    label = JOIN_TYPE_LABELS[type] || type || ui('不明'),
    clip = 'join-left-' + String(n.id || 'settings').replace(/[^a-zA-Z0-9_-]/g, '');
  const regions = joinRegions(type),
    fill = '#c8cdd0',
    leftFill = regions.left ? fill : 'white',
    rightFill = regions.right ? fill : 'white';
  const intersection = regions.overlap ? fill : 'white';
  const diagram = `<svg class="join-venn" viewBox="0 0 78 48" role="img" aria-label="${esc(ui('結合タイプ: ') + label)}"><defs><clipPath id="${clip}"><circle cx="29" cy="24" r="19"/></clipPath></defs><circle cx="29" cy="24" r="19" fill="${leftFill}"/><circle cx="49" cy="24" r="19" fill="${rightFill}"/><circle cx="49" cy="24" r="19" fill="${intersection}" clip-path="url(#${clip})"/><circle cx="29" cy="24" r="19" fill="none" stroke="${lc}" stroke-width="1.5"/><circle cx="49" cy="24" r="19" fill="none" stroke="${rc}" stroke-width="1.5"/></svg>`;
  return ui`<section class="join-settings" style="--join-left:${lc};--join-right:${rc}"><h3>適用した結合句</h3><table class="join-clauses"><thead><tr><th scope="col" class="join-left"><span>左</span>${esc(ln)}</th><th scope="col" class="join-comparator"><span class="sr-only">条件</span></th><th scope="col" class="join-right"><span>右</span>${esc(rn)}</th></tr></thead><tbody>${(n.conditions || []).map((c) => `<tr><td class="join-left">${esc(field(c.leftExpression))}</td><td class="join-comparator">${esc(comparator(c.comparator))}</td><td class="join-right">${esc(field(c.rightExpression))}</td></tr>`).join('')}</tbody></table>${n.conditions?.length ? '' : ui('<p class="change-context">結合条件は保存されていません。</p>')}<h3 class="join-type-heading">結合タイプ: ${esc(label)}</h3><div class="join-type-preview"><span class="join-source-label" style="--source-color:${lc}">${esc(ln)}</span>${diagram}<span class="join-source-label" style="--source-color:${rc}">${esc(rn)}</span></div></section>`;
}

function aggregateHtml(n) {
  return ui`<table class="small-table"><thead><tr><th>フィールド</th><th>役割 / 集計方法</th><th>出力フィールド</th></tr></thead><tbody>${[...(n.groupByFields || []).map((x) => ({ ...x, role: ui('グループ化') })), ...(n.aggregateFields || []).map((x) => ({ ...x, role: x.function }))].map((x) => `<tr><td>${esc(x.columnName)}</td><td><span class="badge changed">${esc(x.role)}</span></td><td>${esc(x.newColumnName || x.columnName)}</td></tr>`).join('')}</tbody></table>`;
}

function pivotHtml(pivot, node) {
  if (!pivot) return ui('<p class="change-context">ピボット設定は保存されていません。</p>');
  const field = (f) =>
    `<span class="pivot-field"><span class="type-symbol" title="${esc(TYPE_NAMES[f.type] || ui('不明'))}">${esc(TYPE_SYMBOL[f.type] || '?')}</span><span>${esc(f.name)}</span></span>`;
  const patterns = {
    Contains: ui('を含む'),
    'Starts with': ui('で始まる'),
    'Ends with': ui('で終わる'),
    'Regular Expression': ui('（正規表現）'),
    Date: ui('（日付）'),
  };
  const retained = ui`<section class="pivot-retained"><h3>フィールド</h3>${pivot.retained.length ? `<ul>${pivot.retained.map((f) => `<li>${field(f)}</li>`).join('')}</ul>` : ui('<p class="change-context">なし</p>')}</section>`;
  let content = '';
  if (pivot.direction === 'columnsToRows') {
    content = pivot.groups
      .map((group) => {
        const length = Math.max(group.values.length, ...group.columns.map((c) => c.fields.length));
        return `<table class="pivot-columns"><thead><tr><th scope="col">${esc(group.name)}</th>${group.columns.map((c) => `<th scope="col">${esc(c.name)}${c.pattern ? `<span class="pivot-pattern">「${esc(c.pattern.expression)}」${esc(patterns[c.pattern.type] || c.pattern.type)}</span>` : ''}</th>`).join('')}</tr></thead><tbody>${Array.from({ length }, (_, i) => `<tr><td>${esc(group.values[i] ?? '')}</td>${group.columns.map((c) => `<td>${c.fields[i] ? field(c.fields[i]) : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      })
      .join('');
  } else {
    content = ui`<div class="pivot-row-field"><h4>${esc(pivot.pivotField.name)}</h4><ul>${pivot.newColumns.map((name) => `<li>${esc(name)}</li>`).join('')}</ul></div><section class="pivot-aggregate"><h3>新しい列の集計フィールド</h3><div><span class="pivot-aggregation">${esc(pivot.aggregation || ui('未設定'))}</span>${field(pivot.valueField)}</div></section>`;
  }
  return ui`<section class="pivot-settings" aria-label="ピボット設定" style="--pivot-color:${esc(node?.color || '#499893')}">${retained}<section class="pivot-transformed"><div class="pivot-section-heading"><h3>ピボットされたフィールド</h3><span class="pivot-direction">${pivot.direction === 'columnsToRows' ? ui('列から行') : ui('行から列')}</span></div>${content}</section>${pivot.notes.map((note) => `<p class="change-context">${esc(uiMessage(note))}</p>`).join('')}</section>`;
}

function unionHtml(n, node) {
  const inputs = [...new Set(DATA.edges.filter((e) => e.target === node?.id).map((e) => e.source))]
    .map((id) => byId.get(id))
    .filter(Boolean);
  return ui`<section class="union-inputs" aria-label="ユニオンの入力"><h3>入力</h3><ul>${inputs.map((input) => `<li><span class="union-input-color" style="background:${esc(input.color)}" aria-hidden="true"></span><span>${esc(input.name)}</span></li>`).join('')}</ul></section>`;
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
    WriteToHyper: ui('Tableau データ抽出 (.hyper)'),
    WriteToCsv: 'CSV (.csv)',
    WriteToExcel: 'Microsoft Excel (.xlsx)',
    WriteToJson: 'JSON (.json)',
    WriteToDatabase: ui('データベース'),
    PublishExtract: ui('パブリッシュされたデータソース'),
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
    `<div class="output-row"><dt>${esc(label)}</dt><dd>${esc(value || ui('未設定'))}</dd></div>`;
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
    outputOperationTypeCreate: ui('テーブルの作成'),
    outputOperationTypeAppend: ui('テーブルに追加'),
    outputOperationTypeTruncate: ui('データの置換'),
    outputOperationTypeUpsert: ui('データの更新と挿入'),
  };
  let fields = row(
    ui('出力の保存先'),
    fileType || path
      ? ui('ファイル')
      : type === 'WriteToDatabase'
        ? ui('データベース')
        : type === 'PublishExtract'
          ? ui('パブリッシュされたデータソース')
          : ui('保存先の情報なし'),
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
    fields += row(ui('サーバー'), server || ui('フローに情報なし'));
    if (site) fields += row(ui('サイト'), site);
    fields += row(ui('プロジェクト'), project || ui('フローに情報なし'));
  }
  fields += row(
    ui('名前'),
    filename
      ? filename.replace(/\.(hyper|csv|xlsx|json)$/i, '')
      : r.attributes?.tablename || r.datasourceName || n.name,
  );
  if (fileType || path) fields += row(ui('場所'), folder);
  fields += row(ui('出力タイプ'), formats[type] || type || ui('不明'));
  let options = row(ui('完全更新'), modeLabels[mode] || mode || ui('設定情報なし'));
  if (props.incrementalOutputOperationType)
    options += row(
      ui('増分更新'),
      modeLabels[props.incrementalOutputOperationType] || props.incrementalOutputOperationType,
    );
  if (props.isIncrementalDefault) options += row(ui('既定の更新方法'), ui('増分更新'));
  const edit =
    typeof CAN_EDIT !== 'undefined' &&
    CAN_EDIT &&
    ['WriteToHyper', 'WriteToCsv', 'WriteToExcel', 'PublishExtract'].includes(type)
      ? ui`<button class="button" data-edit-output="${esc(n.id)}">出力先を編集</button>`
      : '';
  return ui`<section class="output-settings" aria-label="出力設定">${edit}<dl>${fields}</dl><h3>書き込みオプション</h3><dl>${options}</dl></section>`;
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
    out = ui`<div class="settings-grid"><div class="settings-card"><h3>${info.tableau ? 'Tableau Server' : ui('入力と接続')}</h3><div class="card-content">${info.tableau ? tableauConnectionHtml(info) : keyValues({ 接続名: n.connection.name, 接続形式: n.connection.connectionAttributes?.class, 同梱データ: n.connection.isPackaged ? ui('あり') : ui('なし / 不明'), テーブル: r.relation?.table, ファイル: n.connection.connectionAttributes?.filename, 入力の種類: n.nodeType })}</div></div><div class="settings-card"><h3>読み取り設定</h3><div class="card-content">${keyValues({ 文字コード: r.charSet, 区切り文字: r.separator, ロケール: r.locale, ヘッダー: r.containsHeaders, ファイルパターン: r.filePattern, サブフォルダも対象: r.includeSubDirectory, データ行数: ui('取得しません') })}</div></div></div>`;
    if (r.generatedInputs?.length)
      out += ui`<div class="settings-card"><h3>ワイルドカード入力 · ${r.generatedInputs.length} ファイル</h3><div class="card-content">${r.generatedInputs.map((x) => `<p>${esc(x.filePath || x.inputNode?.name)}</p>`).join('')}</div></div>`;
    const extra = { ...r };
    ['fields', 'actions', 'generatedInputs', 'nextNodes'].forEach((k) => delete extra[k]);
    out +=
      ui`<div class="settings-card"><h3>接続情報</h3><div class="card-content"><pre class="raw-pre">${esc(json(n.connection.connectionAttributes || n.connection))}</pre></div></div>` +
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
    out = ui`<div class="settings-card"><h3>${esc(ui(n.kindLabel))}の設定</h3><div class="card-content">${inputs.length > 1 ? `<div class="field-chips">${inputs.map((e) => `<span class="chip">${esc(NS_NAMES[e.namespace] || ui('入力'))} : ${esc(byId.get(e.source)?.name)}</span>`).join('')}</div>` : ''}${content}</div></div>${rawDetail(action)}`;
  } else
    out = ui`<div class="settings-card"><h3>クリーニングの概要</h3><div class="card-content">${keyValues({ ステップ名: n.name, 加工数: n.actions.length, 計算式数: n.calculations.length, 説明: n.description || ui('説明は保存されていません'), 加工内容: ui('「変更内容」タブで実行順に確認できます。') })}</div></div>`;
  return (
    out +
    ui`<details class="raw-details"><summary>ステップの元の定義</summary><pre class="raw-pre">${esc(json(n.raw))}</pre></details><details class="raw-details"><summary>配置・色の定義</summary><pre class="raw-pre">${esc(json(n.display))}</pre></details>`
  );
}
