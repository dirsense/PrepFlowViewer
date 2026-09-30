// 計算式の表示と編集ダイアログ。入力中の履歴は確定済みのフロー履歴と分けて管理する。

function syntax(expr) {
  return tokenizeFormula(expr)
    .map((t) =>
      t.kind === 'plain' ? esc(t.text) : `<span class="${t.kind}">${esc(t.text)}</span>`,
    )
    .join('');
}

function expressionHtml(expr, origin = null) {
  return ui`<div class="formula-wrap"><button class="formula-unfold" title="計算式を展開" aria-label="計算式を展開" aria-expanded="false" hidden><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 7 6 6 6-6"/></svg></button><button class="formula-expand" data-formula="${esc(encodeURIComponent(expr))}" data-formula-origin="${esc(encodeURIComponent(JSON.stringify(origin)))}" title="計算式を拡大表示" aria-label="計算式を拡大表示" aria-haspopup="dialog"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11 3h6v6M17 3l-8 8M8 4H3v13h13v-5"/></svg></button><button class="copy-button" data-copy="${esc(encodeURIComponent(expr))}" title="計算式をコピー" aria-label="計算式をコピー"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 12H3V3h9v4M8 8h9v9H8z"/></svg></button><pre class="code"><span class="formula-preview-text">${syntax(expr)}</span></pre></div>`;
}

function updateFormulaPreviews() {
  document.querySelectorAll('.changes-list .formula-wrap').forEach((wrap) => {
    const text = wrap.querySelector('.formula-preview-text'),
      button = wrap.querySelector('.formula-unfold');
    button.hidden =
      !wrap.classList.contains('full-formula') && text.scrollHeight <= text.clientHeight + 1;
  });
}

let formulaPopup = { original: '', formatted: '', mode: 'original' },
  formulaComposing = false;

const formulaDrafts = new Map();

function formulaPopupSyntax(source) {
  const pairs = formulaBracketPairs(source);
  let offset = 0;
  return tokenizeFormula(source)
    .map((token) => {
      const start = offset;
      offset += token.text.length;
      let text = '',
        segment = 0;
      for (let i = 0; i < token.text.length; i++)
        if (pairs.has(start + i)) {
          text +=
            esc(token.text.slice(segment, i)) +
            ui`<span class="formula-bracket" data-bracket="${start + i}" data-match="${pairs.get(start + i)}" aria-label="${esc(token.text[i])}：対応する括弧を強調" aria-pressed="false">${esc(token.text[i])}</span>`;
          segment = i + 1;
        }
      text += esc(token.text.slice(segment));
      return token.kind === 'plain' ? text : `<span class="${token.kind}">${text}</span>`;
    })
    .join('');
}

function sizeFormulaPopup() {
  const dialog = $('formula-dialog');
  if (!dialog.open) return;
  const code = $('formula-full'),
    source = formulaPopup[formulaPopup.mode];
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = getComputedStyle(code).font;
  const width = source
    .split(/\r?\n/)
    .reduce((max, line) => Math.max(max, measure.measureText(line.replace(/\t/g, '  ')).width), 0);
  const maxWidth = Math.max(0, Math.min(1200, window.innerWidth - 32));
  const headerHeight = document.querySelector('.app-header').getBoundingClientRect().height;
  document.documentElement.style.setProperty('--formula-header-height', headerHeight + 'px');
  const maxHeight = Math.max(0, Math.min(850, window.innerHeight - headerHeight - 32));
  dialog.style.width =
    Math.min(maxWidth, Math.max(formulaPopup.history?.started ? 580 : 420, Math.ceil(width) + 62)) +
    'px';
  // Measure the wrapped content at its final width before clamping the height.
  dialog.style.height = 'auto';
  code.style.flex = 'none';
  code.style.height = 'auto';
  const height =
    code.scrollHeight +
    dialog.querySelector('.formula-dialog-toolbar').getBoundingClientRect().height +
    $('formula-save-error').getBoundingClientRect().height +
    2;
  dialog.style.height = Math.min(maxHeight, Math.max(200, height)) + 'px';
  code.style.flex = '1 1 auto';
  code.style.height = '';
}

function renderFormulaPopup() {
  formulaPopup.original = formulaPopup.history.source;
  formulaPopup.formatted = formatFormula(formulaPopup.history.source);
  document.querySelectorAll('[data-formula-mode]').forEach((button) => {
    const active = button.dataset.formulaMode === formulaPopup.mode;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $('formula-full').innerHTML = formulaPopupSyntax(formulaPopup[formulaPopup.mode]);
  $('formula-full').scrollTop = 0;
  updateFormulaEditButtons();
  sizeFormulaPopup();
}

function openFormulaPopup(source, origin) {
  if (formulaPopup.key) formulaDrafts.delete(formulaPopup.key);
  formulaComposing = false;
  if (!origin) {
    const candidates = DATA.nodes.flatMap((n) =>
      n.actions.flatMap((a) =>
        a.expressions
          .filter((e) => e.expression === source)
          .map((e) => ({ stepId: n.id, actionId: a.id, field: e.field })),
      ),
    );
    if (candidates.length === 1) origin = candidates[0];
  }
  const key = JSON.stringify([DATA.exportKey || DATA.name, origin || source]);
  const history = new FormulaEditHistory(source);
  formulaDrafts.set(key, history);
  formulaPopup = {
    original: source,
    formatted: formatFormula(source),
    mode: 'original',
    history,
    origin,
    key,
    saving: false,
  };
  $('formula-save-error').hidden = true;
  configureFormulaEditor();
  renderFormulaPopup();
  if (!$('formula-dialog').open) $('formula-dialog').show();
  $('formula-backdrop').hidden = false;
  sizeFormulaPopup();
  $('formula-original-tab').focus();
}

function closeFormulaPopup() {
  if (flowEditBusy) return;
  // Drafts belong to the open editor only. Confirmed edits live in the flow history.
  if (formulaPopup.key) formulaDrafts.delete(formulaPopup.key);
  formulaPopup = { original: '', formatted: '', mode: 'original' };
  formulaComposing = false;
  $('formula-dialog').close();
  $('formula-backdrop').hidden = true;
  $('formula-full').textContent = '';
  $('formula-save-error').hidden = true;
}

function configureFormulaEditor() {
  const editor = $('formula-full');
  editor.contentEditable = CAN_EDIT && !flowEditBusy ? 'plaintext-only' : 'false';
  editor.setAttribute('role', CAN_EDIT ? 'textbox' : 'region');
  editor.setAttribute('aria-label', CAN_EDIT ? ui('計算式を編集') : ui('計算式'));
  if (CAN_EDIT) editor.setAttribute('aria-multiline', 'true');
  else editor.removeAttribute('aria-multiline');
}

function updateFormulaEditButtons() {
  if (!CAN_EDIT) return;
  const history = formulaPopup.history;
  if (!history) return;
  $('save-formula').hidden = !history.dirty;
  $('save-formula').disabled = flowEditBusy || !SERVER.token || !formulaPopup.origin;
  $('save-formula').title = !SERVER.token
    ? ui('ファイルに保存するにはローカルビューアーから開いてください')
    : !formulaPopup.origin
      ? ui('この式の保存元を特定できません')
      : '';
  uiBind($('save-formula'), 'textContent', () =>
    formulaPopup.saving ? ui('確定中…') : ui('変更を確定'),
  );
  $('close-formula').disabled = flowEditBusy;
  document.querySelectorAll('[data-formula-mode]').forEach((b) => (b.disabled = flowEditBusy));
}

function formulaSelection() {
  const selection = window.getSelection(),
    editor = $('formula-full');
  if (!selection.rangeCount || !editor.contains(selection.anchorNode)) return null;
  const range = selection.getRangeAt(0),
    before = range.cloneRange();
  before.selectNodeContents(editor);
  before.setEnd(range.startContainer, range.startOffset);
  return {
    start: before.toString().length,
    end: before.toString().length + range.toString().length,
  };
}

function restoreFormulaSelection(selection) {
  if (!selection) return;
  const editor = $('formula-full'),
    walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT),
    nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const point = (offset) => {
    for (const node of nodes) {
      if (offset <= node.length) return [node, offset];
      offset -= node.length;
    }
    return nodes.length ? [nodes.at(-1), nodes.at(-1).length] : [editor, 0];
  };
  const range = document.createRange();
  range.setStart(...point(selection.start));
  range.setEnd(...point(selection.end));
  const current = window.getSelection();
  current.removeAllRanges();
  current.addRange(range);
}

function recordFormulaInput() {
  if (
    !CAN_EDIT ||
    !$('formula-dialog').open ||
    !formulaPopup.history ||
    formulaComposing ||
    formulaPopup.saving
  )
    return;
  const editor = $('formula-full'),
    text = editor.innerText,
    selection = formulaSelection(),
    scroll = editor.scrollTop;
  if (text === formulaPopup[formulaPopup.mode]) return;
  const baselineView =
    formulaPopup.mode === 'formatted'
      ? formatFormula(formulaPopup.history.baseline)
      : formulaPopup.history.baseline;
  formulaPopup.history.push(text === baselineView ? formulaPopup.history.baseline : text);
  formulaPopup.original = formulaPopup.history.source;
  formulaPopup.formatted = formulaPopup.mode === 'formatted' ? text : formatFormula(text);
  editor.innerHTML = formulaPopupSyntax(text);
  restoreFormulaSelection(selection);
  $('formula-save-error').hidden = true;
  updateFormulaEditButtons();
  sizeFormulaPopup();
  editor.scrollTop = scroll;
}

function moveFormulaHistory(direction) {
  if (!CAN_EDIT || flowEditBusy) return;
  formulaPopup.history[direction]();
  renderFormulaPopup();
  $('formula-full').focus();
}

function hoverFormulaBrackets(target) {
  const editor = $('formula-full');
  const positions =
    target && editor.contains(target) ? [target.dataset.bracket, target.dataset.match] : [];
  editor.querySelectorAll('[data-bracket]').forEach((bracket) => {
    bracket.classList.toggle('hovered-bracket', positions.includes(bracket.dataset.bracket));
  });
}

function highlightFormulaBrackets(target) {
  const positions =
    target && !target.classList.contains('matched-bracket')
      ? [target.dataset.bracket, target.dataset.match]
      : [];
  $('formula-full')
    .querySelectorAll('[data-bracket]')
    .forEach((bracket) => {
      const active = positions.includes(bracket.dataset.bracket);
      bracket.classList.toggle('matched-bracket', active);
      bracket.setAttribute('aria-pressed', String(active));
    });
}
