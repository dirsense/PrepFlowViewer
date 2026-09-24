import unittest
import io
import json
import prepflow


class FilterActionTests(unittest.TestCase):
    def test_sample_formula_filters_are_visible_and_track_fields(self):
        count = 0
        for path in (prepflow.ROOT / 'samples').glob('*.tflx'):
            model = prepflow.analyze(path)
            for node in model['nodes']:
                for action in node['actions']:
                    if action['type'] != 'FilterOperation':
                        continue
                    count += 1
                    with self.subTest(file=path.name, action=action['id']):
                        expression = action['raw']['filterExpression']
                        self.assertEqual(action['label'], 'フィルター')
                        self.assertEqual(action['expressions'][0]['expression'], expression)
                        self.assertEqual(action['expressions'][0]['references'], prepflow.field_ref(expression))
                        self.assertFalse(any('FilterOperation' in w for w in node['warnings']))
                        for field in node['fields']:
                            if field['name'] in prepflow.field_ref(expression):
                                self.assertTrue(any(c['actionId'] == action['id'] for c in field.get('changes', [])))
        self.assertGreaterEqual(count, 9)

    def test_input_filter_preserves_multiline_formula_and_comments(self):
        expression = '// 日付で絞る\nDATETRUNC(\'month\', [Date]) > DATEADD(\'month\', -13, TODAY())\nAND [Source] <> ""'
        flow = {'nodes': {'input': {'nodeType': '.v1.LoadExcel', 'baseType': 'input',
            'filters': [{'id': 'filter', 'nodeType': '.v1.FilterOperation', 'filterExpression': expression}]}}}
        model = prepflow.analyze(io.BytesIO(json.dumps(flow).encode()))
        action = model['nodes'][0]['actions'][0]
        self.assertEqual(action['expressions'][0]['expression'], expression)
        self.assertEqual(action['expressions'][0]['references'], ['Date', 'Source'])
        self.assertEqual(action['phase'], '入力のフィルター')

    def test_dates_filter_sequence_and_rank_field(self):
        model = prepflow.analyze(prepflow.ROOT / 'samples' / 'PreppinData_2023_Week_15.tflx')
        dates = next(n for n in model['nodes'] if n['name'] == 'Dates')
        self.assertEqual([a['label'] for a in dates['actions']], ['フィルター', 'フィルター', 'フィールドの削除', 'ランク'])
        row = next(f for f in dates['fields'] if f['name'] == 'Row')
        self.assertEqual(row['expression'], '{{ORDERBY [F3] ASC: RANK()}}')
        f3 = next(f for f in dates['fields'] if f['name'] == 'F3')
        self.assertTrue(any(c['type'] == 'ValueFilter' for c in f3['changes']))
        self.assertFalse(any('ValueFilter' in w or 'MultiRowCalc' in w for w in dates['warnings']))

    def test_lod_is_not_rank(self):
        self.assertEqual(prepflow.action_label({'nodeType': '.v2020_1_3.MultiRowCalc', 'specificRowCalc': {'calcType': 'fixedLodCalc'}}), 'LOD計算')
        self.assertEqual(prepflow.action_label({'nodeType': '.v2020_1_3.MultiRowCalc', 'specificRowCalc': None}), '計算フィールド')
