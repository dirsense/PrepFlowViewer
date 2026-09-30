import unittest
import io
import json
import prepflow


class FilterActionTests(unittest.TestCase):
    def test_sample_formula_filters_are_visible_and_track_fields(self):
        count = 0
        from flow_fixtures import filter_package
        for path in [io.BytesIO(filter_package())]:
            model = prepflow.analyze(path)
            for node in model['nodes']:
                for action in node['actions']:
                    if action['type'] != 'FilterOperation':
                        continue
                    count += 1
                    with self.subTest(file="synthetic", action=action['id']):
                        expression = action['raw']['filterExpression']
                        self.assertEqual(action['label'], 'Filter')
                        self.assertEqual(action['expressions'][0]['expression'], expression)
                        self.assertEqual(action['expressions'][0]['references'], prepflow.field_ref(expression))
                        self.assertFalse(any('FilterOperation' in w for w in node['warnings']))
                        for field in node['fields']:
                            if field['name'] in prepflow.field_ref(expression):
                                self.assertTrue(any(c['actionId'] == action['id'] for c in field.get('changes', [])))
        self.assertGreater(count, 0)

    def test_input_filter_preserves_multiline_formula_and_comments(self):
        expression = '// Filter by date\nDATETRUNC(\'month\', [Date]) > DATEADD(\'month\', -13, TODAY())\nAND [Source] <> ""'
        flow = {'nodes': {'input': {'nodeType': '.v1.LoadExcel', 'baseType': 'input',
            'filters': [{'id': 'filter', 'nodeType': '.v1.FilterOperation', 'filterExpression': expression}]}}}
        model = prepflow.analyze(io.BytesIO(json.dumps(flow).encode()))
        action = model['nodes'][0]['actions'][0]
        self.assertEqual(action['expressions'][0]['expression'], expression)
        self.assertEqual(action['expressions'][0]['references'], ['Date', 'Source'])
        self.assertEqual(action['phase'], 'Input filter')

    def test_filter_sequence_tracks_fields(self):
        from flow_fixtures import flow_stream
        model = prepflow.analyze(flow_stream({'Amount': 'integer'}, [
            {'nodeType': '.v1.FilterOperation', 'filterExpression': '[Amount] > 0'},
            {'nodeType': '.v1.FilterOperation', 'filterExpression': '[Amount] < 100'}]))
        node = next(n for n in model['nodes'] if n['id'] == 'transform')
        self.assertEqual([a['label'] for a in node['actions']], ['Filter', 'Filter'])
        self.assertEqual([a['expressions'][0]['expression'] for a in node['actions']],
                         ['[Amount] > 0', '[Amount] < 100'])
        self.assertEqual(len(node['fields'][0]['changes']), 2)
        self.assertFalse(node['warnings'])

    def test_lod_is_not_rank(self):
        self.assertEqual(prepflow.action_label({'nodeType': '.v2020_1_3.MultiRowCalc', 'specificRowCalc': {'calcType': 'fixedLodCalc'}}), 'LOD calculation')
        self.assertEqual(prepflow.action_label({'nodeType': '.v2020_1_3.MultiRowCalc', 'specificRowCalc': None}), 'Calculated field')
