import copy
import unittest

import prepflow


class PivotTests(unittest.TestCase):
    def detail(self, node):
        return next(a['pivot'] for a in node['actions'] if 'pivot' in a)

    def test_rows_to_columns_saved_names_and_aggregation(self):
        fields = {name: prepflow.make_field(name, kind, 'input') for name, kind in
                  [('Region', 'string'), ('Category', 'string'), ('Amount', 'integer')]}
        raw = {'nodeType': '.v2018_3_3.Pivot', 'pivotColumnName': 'Category',
               'aggregateColumnName': 'Amount', 'defaultAggregation': 'MAX',
               'newColumnNames': ['Retail', 'Wholesale']}
        pivot = prepflow.pivot_details(raw, fields)
        self.assertEqual(pivot['direction'], 'rowsToColumns')
        self.assertEqual(pivot['pivotField']['name'], 'Category')
        self.assertEqual(pivot['valueField']['name'], 'Amount')
        self.assertEqual(pivot['aggregation'], 'MAX')

    def test_manual_mapping_and_retained_fields(self):
        fields = {name: prepflow.make_field(name, 'integer', 'input') for name in ['ID', 'Q1', 'Q2']}
        raw = {'nodeType': '.v2018_3_4.UnpivotExtended', 'unpivotGroup': {
            'literalColumn': {'literalColumnName': 'Quarter', 'names': ['First', 'Second']},
            'unpivotColumns': [{'unpivotColumnName': 'Amount', 'columnInformation': {
                'bindingsType': 'manual', 'manualBindings': ['Q1', 'Q2']}}]}}
        pivot = prepflow.pivot_details(raw, fields)
        self.assertEqual([f['name'] for f in pivot['retained']], ['ID'])
        self.assertEqual([f['name'] for f in pivot['groups'][0]['columns'][0]['fields']], ['Q1', 'Q2'])

    def test_legacy_unpivot(self):
        model = prepflow.analyze(prepflow.ROOT / 'samples' / 'Superstore.tflx')
        node = next(n for n in model['nodes'] if n['kind'] == 'pivot')
        pivot = self.detail(node)
        self.assertEqual([f['name'] for f in pivot['retained']], ['Region', '2014'])
        self.assertEqual(pivot['groups'][0]['name'], 'Year')
        self.assertEqual(pivot['groups'][0]['values'], ['2015', '2016', '2018', '2017'])
        self.assertEqual(pivot['groups'][0]['columns'][0]['name'], 'Quota')
        self.assertEqual({f['name']: f['type'] for f in node['fields']},
                         {'Region': 'string', '2014': 'integer', 'Year': 'integer', 'Quota': 'unknown'})

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
