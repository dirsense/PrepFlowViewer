import io
import json
import unittest

import prepflow
from formula_types import infer_type


def model(nodes):
    return prepflow.analyze(io.BytesIO(json.dumps({'nodes': nodes}).encode()))


def joined(left, right):
    def source(key, names, namespace):
        return {'id': key, 'name': key, 'nodeType': '.v1.LoadCsv', 'baseType': 'input',
                'fields': [{'name': name, 'type': 'string'} for name in names],
                'nextNodes': [{'nextNodeId': 'join', 'nextNamespace': namespace}]}
    return {n['id']: n for n in model({
        'left': source('left', left, 'Left'), 'right': source('right', right, 'Right'),
        'join': {'id': 'join', 'name': 'join', 'nodeType': '.v1.Join',
                 'actionNode': {'nodeType': '.v1.SimpleJoin', 'joinType': 'inner'},
                 'nextNodes': [{'nextNodeId': 'after', 'nextNamespace': 'Default'}]},
        'after': {'id': 'after', 'nodeType': '.v1.Container', 'name': 'after',
                  'loomContainer': {'nodes': {}}},
    })['nodes']}


class SchemaRecoveryTests(unittest.TestCase):
    def test_normal_join_names_and_downstream_are_certain(self):
        nodes = joined(['ID', 'ID-1', 'Left value'], ['ID', 'Right value'])
        self.assertEqual({f['name'] for f in nodes['join']['fields']},
                         {'ID', 'ID-1', 'ID-2', 'Left value', 'Right value'})
        self.assertFalse(nodes['join']['schemaUncertain'])
        self.assertFalse(nodes['after']['schemaUncertain'])

    def test_complex_right_names_are_preserved_and_flagged(self):
        nodes = joined(['ID'], ['ID', 'ID-1'])
        self.assertEqual({f['name'] for f in nodes['join']['fields']}, {'ID', 'ID-1', 'ID-2'})
        self.assertTrue(nodes['join']['schemaUncertain'])
        self.assertTrue(nodes['after']['schemaUncertain'])

    def test_missing_input_schema_still_propagates_uncertainty(self):
        nodes = joined([], ['ID'])
        self.assertTrue(nodes['left']['schemaUncertain'])
        self.assertTrue(nodes['join']['schemaUncertain'])
        self.assertTrue(nodes['after']['schemaUncertain'])

    def test_merge_uses_named_target_not_first_source(self):
        fields = {name: prepflow.make_field(name, 'string', name, expression='"old"',
                                           fieldKey=name, fieldOrder=i)
                  for i, name in enumerate(['first', 'target', 'third', 'untouched'])}
        warnings, removed = [], []
        raw = {'nodeType': '.v1.MergeColumns', 'mergedColumnName': 'target',
               'mergeColumnsList': ['first', 'target', 'third']}
        result = prepflow.apply_action(fields, {'raw': raw, 'id': 'merge'}, 'clean', warnings, removed)
        self.assertEqual(list(result), ['target', 'untouched'])
        self.assertEqual(result['target']['type'], 'string')
        self.assertEqual(result['target']['fieldKey'], 'target')
        self.assertIsNone(result['target']['expression'])
        self.assertEqual({f['name'] for f in removed}, {'first', 'third'})
        self.assertTrue(all(f['changes'][-1]['mergedInto'] == 'target' for f in removed))
        self.assertEqual(len(fields), 4)
        self.assertFalse(warnings)

    def test_merge_mixed_types_vs_missing_fields(self):
        raw = {'nodeType': '.v1.MergeColumns', 'mergedColumnName': 'target',
               'mergeColumnsList': ['target', 'source']}
        fields = {name: prepflow.make_field(name, type_, 'input')
                  for name, type_ in [('target', 'string'), ('source', 'integer')]}
        warnings = []
        result = prepflow.apply_action(fields, {'raw': raw}, 'clean', warnings)
        self.assertEqual(set(result), {'target'})
        self.assertEqual(result['target']['type'], 'unknown')
        self.assertFalse(warnings, 'unknown type does not imply an unknown field list')
        del fields['source']
        prepflow.apply_action(fields, {'raw': raw}, 'clean', warnings)
        self.assertTrue(warnings)
        warnings = []
        self.assertEqual(prepflow.apply_action(fields, {'raw': {'nodeType': '.v1.MergeColumns'}}, 'clean', warnings), fields)
        self.assertTrue(warnings)

    def test_saved_date_formula_and_result_type(self):
        expression = "DATENAME('weekday', [Birthday])"
        fields = {'Birthday': prepflow.make_field('Birthday', 'date', 'input')}
        warnings = []
        result = prepflow.apply_action(fields, {'raw': {'nodeType': '.v2021_1_4.QuickDateNameCalcColumn',
                    'columnName': 'Birthday', 'expression': expression}}, 'clean', warnings)
        self.assertEqual(result['Birthday']['type'], 'string')
        self.assertEqual(result['Birthday']['expression'], expression)
        self.assertFalse(warnings)
        self.assertEqual(infer_type("DATENAME('month', [Birthday], 'monday')", fields), 'string')
        self.assertEqual(infer_type('DATENAME()', fields), 'unknown')

    def test_merge_and_date_conversion_in_analyzed_flow(self):
        from flow_fixtures import flow_stream
        result = prepflow.analyze(flow_stream({'Primary': 'string', 'Secondary': 'string', 'Day': 'date'}, [
            {'nodeType': '.v1.MergeColumns', 'mergedColumnName': 'Primary', 'mergeColumnsList': ['Primary', 'Secondary']},
            {'nodeType': '.v2021_1_4.QuickDateNameCalcColumn', 'columnName': 'Day', 'expression': "DATENAME('weekday', [Day])"}]))
        node = next(n for n in result['nodes'] if n['id'] == 'transform')
        fields = {f['name']: f for f in node['fields']}
        self.assertNotIn('Secondary', fields)
        self.assertEqual(fields['Day']['type'], 'string')
        self.assertFalse(node['schemaUncertain'])


if __name__ == '__main__':
    unittest.main()
