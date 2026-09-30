// 共有状態と小さな表示ユーティリティ。状態の所有範囲と読み込み順は web/README.md を参照。

'use strict';

let DATA = JSON.parse(document.getElementById('flow-data').textContent);

const SERVER = JSON.parse(document.getElementById('server-config').textContent);

const CAN_EDIT = !!SERVER.token;

const $ = (id) => document.getElementById(id);

const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

const json = (value) => JSON.stringify(value, null, 2);

const TYPE_NAMES = uiLabels({
  string: '文字列',
  integer: '整数',
  real: '小数',
  date: '日付',
  datetime: '日時',
  boolean: '真偽値',
  unknown: '未確定',
  spatial: '空間',
});

const TYPE_SYMBOL = {
  string: 'Abc',
  integer: '#',
  real: '#.0',
  date: '▦',
  datetime: '▦',
  boolean: 'T/F',
  unknown: '?',
};

const NS_NAMES = uiLabels({ Left: '左入力', Right: '右入力', Default: '共通' });

// ステップと詳細パネルの選択。初期化・切替は viewer-navigation.js で行う。
let selected = null,
  activeTab = 'fields',
  fieldMode = 'all',
  changesMode = 'all';

let overviewTab = 'info';

// マップの配置と表示位置。倍率変更は元のフローファイルへ保存しない。
let byId = new Map(),
  positions = new Map(),
  scale = 1,
  offset = { x: 0, y: 0 },
  bounds = { width: 1000, height: 500 };

let autoFit = true;

let toastTimer,
  dragState,
  dropDepth = 0;

let recentFiles = [],
  loadingFlow = false,
  nativeDropReady = false;

// フローを切り替えても確定済みの編集履歴を保持する。
// 計算式ダイアログ内の未確定入力は viewer-formula.js の formulaDrafts に分離。
const flowSessions = new Map();

let flowSession,
  flowEditBusy = false;

let publishBusy = false;

let expandedComments = new Set();

let commentFont = 12.6;

const commentMeasure = document.createElement('canvas').getContext('2d');

commentMeasure.font = '12px "Segoe UI", "Yu Gothic UI", Meiryo, sans-serif';

function toast(message) {
  uiBind($('toast'), 'textContent', () => uiMessage(message));
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 4800);
}

function textMatch(value, query) {
  return (
    !query ||
    String(value ?? '')
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase())
  );
}

function matchNode(n, q) {
  return (
    textMatch(n.name, q) ||
    n.fields.some((f) => textMatch(f.name, q)) ||
    n.actions.some((a) => textMatch(a.name, q)) ||
    n.calculations.some((c) => textMatch(c.field + ' ' + c.expression, q))
  );
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(ui('コピーしました'));
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.append(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    toast(
      ok
        ? ui('コピーしました')
        : ui('コピーできませんでした。テキストを選択してコピーしてください。'),
    );
  }
}

let splitDragging = false;
