const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./ui-test-context.cjs');
const { declaration: viewerDeclaration } = require('./viewer-source.cjs');
const definition = viewerDeclaration;
const context = vm.createContext({
  esc: (v) =>
    String(v ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;'),
  actionIcon: () => '<svg></svg>',
});
vm.runInContext(['actionHtml', 'fieldChanges'].map(definition).join('\n'), context);
for (const [locale, title] of Object.entries({
  ja: JSON.parse(fs.readFileSync(require.resolve('../web/ja.json'), 'utf8'))['Remove fields'],
  en: 'Remove fields',
  fr: 'Supprimer les champs',
  es: 'Eliminar campos',
  de: 'Felder entfernen',
  'pt-BR': 'Remover campos',
})) {
  vm.runInContext(`uiLanguage = ${JSON.stringify(locale)}`, context);
  for (const type of ['RemoveColumn', 'RemoveColumns']) {
    const field = 'Order Year <売上>&';
    const raw =
      type === 'RemoveColumn' ? { columnName: field } : { columnNames: [field, 'Ship Year'] };
    const action = { id: 'remove', type, label: 'Remove fields', expressions: [], raw };
    const card = context.actionHtml(action, 0);
    assert.ok(card.includes(`<h3>${title}</h3>`), `${locale}: ${card}`);
    assert.ok(card.includes('<span class="chip">Order Year &lt;売上&gt;&amp;</span>'));
    assert.ok(!card.includes('RemoveColumn'));
    if (type === 'RemoveColumns') assert.ok(card.includes('<span class="chip">Ship Year</span>'));
    const badge = context.fieldChanges({
      name: field,
      deleted: true,
      changes: [{ type, label: 'Remove fields', actionId: 'remove' }],
    });
    assert.equal((badge.match(/<button/g) || []).length, 1);
    assert.ok(badge.includes('change-icon removed'));
    assert.ok(badge.includes('data-action-id="remove"'));
  }
}
console.log(
  'Singular/plural field deletions: translated cards, escaped names and action badges passed.',
);
