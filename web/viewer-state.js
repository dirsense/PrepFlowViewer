// Shared state and display utilities. See web/README.md for ownership and loading order.

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
  string: 'String',
  integer: 'Integer',
  real: 'Decimal',
  date: 'Date',
  datetime: 'Date and time',
  boolean: 'Boolean',
  unknown: 'Undetermined',
  spatial: 'Spatial',
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

const NS_NAMES = uiLabels({ Left: 'Left input', Right: 'Right input', Default: 'Default' });

// Step and detail-panel selection; initialized in viewer-navigation.js.
let selected = null,
  activeTab = 'fields',
  fieldMode = 'all',
  changesMode = 'all';

let overviewTab = 'info';

// Map positions and viewport. Zoom changes do not modify the source flow.
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

// Preserve confirmed editing history when switching flows.
// Unconfirmed formula drafts live in viewer-formula.js.
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
    toast(ui('Copied'));
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.append(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    toast(ok ? ui('Copied') : ui('Could not copy. Select the text and copy it manually.'));
  }
}

let splitDragging = false;
