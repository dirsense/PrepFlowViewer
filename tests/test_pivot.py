import copy
import unittest

import prepflow


class PivotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        model = prepflow.analyze(prepflow.ROOT / 'samples' / 'PreppinData_2023_Week_15.tflx')
        cls.nodes = {n['name']: n for n in model['nodes']}

    def detail(self, node):
        return next(a['pivot'] for a in node['actions'] if 'pivot' in a)

    def test_wildcard_columns_and_downstream_schema(self):
        node = self.nodes['Pivot 3']
        pivot = self.detail(node)
        group = pivot['groups'][0]
        self.assertEqual([f['name'] for f in pivot['retained']], ['Row'])
        self.assertEqual(pivot['retained'][0]['type'], 'integer')
        self.assertEqual(group['name'], 'Pivot1 Names')
        self.assertEqual(group['columns'][0]['name'], 'F')
        expected = sorted(['F' + str(i) for i in range(3, 38)])
        self.assertEqual(group['values'], expected)
        self.assertEqual([f['name'] for f in group['columns'][0]['fields']], expected)
        self.assertEqual([f['name'] for f in node['fields']], ['Row', 'Pivot1 Names', 'F'])
        self.assertFalse(node['warnings'])

    def test_rows_to_columns_saved_names_and_aggregation(self):
        node = self.nodes['Pivot 5']
        pivot = self.detail(node)
        self.assertEqual(pivot['direction'], 'rowsToColumns')
        self.assertEqual([f['name'] for f in pivot['retained']], ['Pivot1 Names'])
        self.assertEqual(pivot['pivotField']['name'], 'Row')
        self.assertEqual(pivot['valueField']['name'], 'F')
        self.assertEqual(pivot['aggregation'], 'MAX')
        self.assertEqual(pivot['newColumns'], ['1', '2'])
        self.assertEqual([f['name'] for f in node['fields']], ['Pivot1 Names', '1', '2'])

    def test_manual_mapping_and_post_pivot_renames(self):
        model = prepflow.analyze(prepflow.ROOT / 'samples' / 'PreppinData_2024_Week_31.tflx')
        node = next(n for n in model['nodes'] if n['name'] == 'Pivot 1')
        group = self.detail(node)['groups'][0]
        self.assertEqual(group['values'], ['200', '800', '100H', 'HJ', 'JT', 'LJ', 'SP'])
        self.assertEqual([f['name'] for f in group['columns'][0]['fields']], group['values'])
        self.assertIn('Event', [f['name'] for f in node['fields']])
        self.assertIn('Value', [f['name'] for f in node['fields']])

    def test_legacy_unpivot(self):
        model = prepflow.analyze(prepflow.ROOT / 'samples' / 'Superstore.tflx')
        node = next(n for n in model['nodes'] if n['kind'] == 'pivot')
        pivot = self.detail(node)
        self.assertEqual([f['name'] for f in pivot['retained']], ['販売地域'])
        self.assertEqual(pivot['groups'][0]['name'], '年')
        self.assertEqual(pivot['groups'][0]['values'], ['2015', '2016', '2017', '2018'])
        self.assertEqual(pivot['groups'][0]['columns'][0]['name'], 'ノルマ')
        self.assertEqual({f['name']: f['type'] for f in node['fields']},
                         {'販売地域': 'string', '年': 'integer', 'ノルマ': 'integer'})

    def test_wildcard_modes_and_additional_columns(self):
        fields = {s: prepflow.make_field(s, 'string', 'input') for s in ['X1', 'X2', '2X', 'other']}
        for mode, expected in [('Contains', ['2X', 'X1', 'X2', 'other']),
                               ('Starts with', ['X1', 'X2', 'other']), ('Ends with', ['2X', 'other'])]:
            raw = {'nodeType': '.v2018_3_4.UnpivotExtended', 'unpivotGroup': {
                'literalColumn': {'literalColumnName': 'Names', 'names': []},
                'unpivotColumns': [{'unpivotColumnName': 'Values', 'columnInformation': {
                    'bindingsType': 'wildcard', 'wildcardType': mode, 'wildcardExpression': 'X',
                    'additionalColumns': ['other']}}]}}
            original = copy.deepcopy(raw)
            self.assertEqual(prepflow.pivot_details(raw, fields)['groups'][0]['values'], expected)
            self.assertEqual(raw, original)
            raw['unpivotGroup']['unpivotColumns'][0]['columnInformation']['wildcardType'] = 'Date'
            self.assertTrue(prepflow.pivot_details(raw, fields)['notes'])

    def test_unsaved_pivot_values_not_invented(self):
        raw = {'nodeType': '.v2018_3_3.Pivot', 'pivotColumnName': 'Category',
               'aggregateColumnName': 'Value', 'defaultAggregation': 'SUM'}
        pivot = prepflow.pivot_details(raw, {})
        self.assertEqual(pivot['newColumns'], [])
        self.assertTrue(pivot['notes'])


if __name__ == '__main__':
    unittest.main()
