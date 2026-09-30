// フロー情報、接続元のまとめ、使い方。

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return ui`${Math.floor(bytes)} バイト`;
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
  const type = value('class') || connection.connectionType || ui('不明');
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
        title: info.server || info.file || info.name || ui('接続元の情報なし'),
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
      サーバー: info.server || ui('フローに情報なし'),
      プロジェクト名: info.project || ui('フローに情報なし'),
      データソース名: info.datasource || ui('フローに情報なし'),
    };
  return {
    データソース名: info.datasource || null,
    プロジェクト名: info.project || null,
    データベース: info.database || null,
    テーブル: node?.raw?.relation?.table || node?.raw?.attributes?.tablename || null,
  };
}

function tableauConnectionHtml(info) {
  return `<div class="tableau-connection">${keyValues(connectionFields(info))}</div>`;
}

function connectionsHtml() {
  const groups = connectionGroups(DATA);
  if (!groups.length) return ui('<p class="overview-note">接続情報はありません。</p>');
  return ui`<p class="overview-note">接続元を開くと、使用している入力ステップを確認できます。</p>${groups.map((group) => ui`<details class="connection-group"><summary><span class="connection-source"><strong>${esc(group.title)}</strong><small>${esc(group.info.label)} · 入力ステップ ${group.steps} 件</small></span></summary><div class="connection-steps">${group.entries.map((entry) => (entry.nodes.length ? entry.nodes.map((node) => ui`<section class="connection-step"><h3>${esc(node.name)}</h3>${keyValues(connectionFields(connectionInfo(entry.connection, node), node))}<button class="button" data-connection-step="${esc(node.id)}">ステップの接続設定を表示</button></section>`).join('') : ui`<section class="connection-step"><h3>${esc(entry.info.name || ui('接続定義'))}</h3>${keyValues(connectionFields(entry.info))}<p class="overview-note">使用している入力ステップはありません。</p></section>`)).join('')}</div></details>`).join('')}`;
}

function overviewHelpHtml() {
  return ui`<div class="overview-help"><h3>フローを見る</h3><ul><li>ステップをクリックすると詳細を表示します。同じステップをもう一度押すか、マップの空白を押すとフロー情報へ戻ります。</li><li>ホイールで拡大・縮小、ドラッグで移動できます。</li><li>空白のダブルクリック、または上部の全体表示アイコンで、フロー全体を表示します。</li><li>全体表示中は右ペインの幅に合わせて自動調整します。手動で拡大・移動した後は倍率と位置を維持します。</li></ul><h3>処理・計算式を確認する</h3><ul><li>「フィールド一覧」「変更内容」「設定」を切り替えて確認します。検索でフィールドや加工を絞り込めます。</li><li>計算式は拡大表示で「原文」と「自動整形」を切り替えられます。コピーや対応する括弧の強調も使えます。</li></ul>${CAN_EDIT ? ui('<h3>編集・保存・共有する</h3><ul><li>計算式を編集したら「変更を確定」。この段階ではViewer内だけに反映します。</li><li>上部のUndo / Redoで確定した変更を戻せます。ダウンロードアイコンの「フローを保存」でTFL / TFLXへ保存します。</li><li>「HTMLを出力」で対応言語を選び、「単一出力」または「一括出力」タブから書き出します。</li><li>上部のパブリッシュアイコンからTableau Serverへ公開できます。PC上のフロー保存とは別の操作です。</li><li>出力ステップの「出力先を編集」から、ファイル形式・名前・保存先、またはTableau Serverへの出力に変更できます。Serverは既定サイトのプロジェクトを認証して確認します。書き込みオプションは変更できません。×で閉じると未確定の変更を破棄します。</li><li>三角の実行アイコンから、出力名・保存先を確認して個別実行・すべて実行できます。実行にはTableau Prep Builderが必要で、出力先の実データを更新します。進捗は実行ログで確認できます。</li></ul>') : ui('<h3>このHTMLについて</h3><p>閲覧専用です。計算式の編集・フローの保存・ServerへのパブリッシュはViewer本体で行います。</p>')}<p class="overview-note">データソースには接続せず、フローに保存された定義を表示しています。</p></div>`;
}

function renderFlowInfo(container) {
  const source = DATA.sourcePath || '',
    folder = source.slice(0, Math.max(source.lastIndexOf('/'), source.lastIndexOf('\\')) + 1);
  container.innerHTML = ui`<div class="meta-stats">${[
    [ui('ステップ'), DATA.stats.steps],
    [ui('加工'), DATA.stats.actions],
    [ui('計算式'), DATA.stats.calculations],
  ]
    .map(
      ([label, value]) =>
        `<div class="meta-stat"><strong>${value || 0}</strong><span>${label}</span></div>`,
    )
    .join(
      '',
    )}</div>${keyValues({ ファイル: DATA.name, 保存場所: CAN_EDIT ? folder || ui('未確定（フローを保存すると表示されます）') : null, ファイルサイズ: formatFileSize(DATA.fileSizeBytes), 定義の解析時間: DATA.stats.parseMs + ' ms', 保存座標: DATA.stats.savedPositions + ui(' ステップ'), フロー形式バージョン: DATA.formatVersion, 解析: ui('Python / 接続・実データの読込なし') })}<p>flow の処理定義と displaySettings の配置・色を表示しています。フィールド一覧は静的に復元したもので、実行結果ではありません。推定箇所や未対応の加工は各ステップに注記します。</p>${DATA.warnings.map((w) => `<p class="warning">${esc(uiMessage(w))}</p>`).join('')}<details class="raw-details"><summary>パッケージ内のファイル一覧（データは未読込）</summary><pre class="raw-pre">${esc(DATA.entries.map((e) => `${e.name}  (${e.bytes.toLocaleString()} bytes)`).join('\n'))}</pre></details><details class="raw-details"><summary>パラメーター</summary><pre class="raw-pre">${esc(json(DATA.parameters))}</pre></details><details class="raw-details"><summary>maestroMetadata</summary><pre class="raw-pre">${esc(json(DATA.metadata))}</pre></details>`;
  if (folder && SERVER.token) {
    const cell = container.querySelector('.kv dd:nth-of-type(2)'),
      button = document.createElement('button');
    cell.classList.add('flow-location');
    button.className = 'button folder-open';
    button.id = 'open-source-folder-panel';
    uiBind(button, 'textContent', () => ui('保存場所を開く'));
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
        if (!response.ok) throw new Error(result.error || ui('保存場所を開けませんでした。'));
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
