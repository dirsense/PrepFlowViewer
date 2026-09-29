import copy
import unittest

import prepflow


class RemoveColumnTests(unittest.TestCase):
    def test_both_formats_remove_fields_and_preserve_action_identity(self):
        for kind, properties in (
            ('RemoveColumn', {'columnName': 'Order Year'}),
            ('RemoveColumns', {'columnNames': ['Order Year', 'Ship Year']}),
        ):
            with self.subTest(kind=kind):
                raw = {'nodeType': '.v1.' + kind, 'id': 'remove', **properties}
                source = {'nodes': {
                    'input': {'id': 'input', 'nodeType': '.v1.LoadCsv', 'baseType': 'input',
                              'name': 'Orders', 'fields': [{'name': name, 'type': 'integer'}
                                                         for name in ['Order Year', 'Ship Year', 'Keep']],
                              'actions': [raw], 'nextNodes': [{'nextNodeId': 'output'}]},
                    'output': {'id': 'output', 'nodeType': '.v1.WriteToCsv',
                               'baseType': 'output', 'name': 'Output', 'nextNodes': []},
                }}
                original = copy.deepcopy(source)
                model = prepflow.analyze(None, package=('test.tfl', source, {}, {}, []))
                node, output = model['nodes']
                expected = properties.get('columnNames', [properties.get('columnName')])
                deleted = [f for f in node['fieldInventory'] if f['deleted']]
                self.assertEqual([f['name'] for f in deleted], expected)
                for field in deleted:
                    self.assertEqual(field['changes'][-1]['type'], kind)
                    self.assertEqual(field['changes'][-1]['actionId'], 'remove')
                    self.assertEqual(field['changes'][-1]['label'], 'フィールドの削除')
                for step in (node, output):
                    self.assertFalse(set(expected) & {f['name'] for f in step['fields']})
                    self.assertFalse(step['warnings'])
                self.assertEqual(node['actions'][0]['label'], 'フィールドの削除')
                self.assertEqual(source, original)

    def test_missing_singular_field_does_not_remove_unrelated_fields(self):
        fields = {'Keep': prepflow.make_field('Keep', 'string', 'input')}
        for properties in ({}, {'columnName': 'Missing'}):
            removed = []
            result = prepflow.apply_action(fields, {'raw': {'nodeType': '.v1.RemoveColumn', **properties}},
                                           'step', [], removed)
            self.assertEqual(result, fields)
            self.assertEqual(removed, [])
