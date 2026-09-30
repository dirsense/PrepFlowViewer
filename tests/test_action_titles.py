import copy
import unittest
import prepflow


class ActionTitleTests(unittest.TestCase):
    def test_quick_calc_titles_for_legacy_and_current_formats(self):
        expected = {
            'Lowercase': 'Convert to lowercase', 'Uppercase': 'Convert to uppercase', 'Titlecase': 'Convert to title case',
            'RemoveLetters': 'Remove letters', 'RemoveNumbers': 'Remove numbers', 'RemovePunctuations': 'Remove punctuation',
            'RemoveAllSpaces': 'Remove all spaces', 'RemoveExtraSpaces': 'Remove extra spaces',
            'TrimSpaces': 'Trim spaces',
        }
        for version in ('v1', 'v2018_3_3', 'v2024_2_0'):
            for kind, title in expected.items():
                with self.subTest(version=version, kind=kind):
                    raw = {'nodeType': f'.{version}.QuickCalcColumn', 'calcExpressionType': kind,
                           'columnName': 'Column-1', 'expression': '[Column]'}
                    original = copy.deepcopy(raw)
                    self.assertEqual(prepflow.action_label(raw), title)
                    self.assertEqual(raw, original)

    def test_order_step_titles_keep_fields_and_expressions(self):
        from flow_fixtures import flow_stream
        model = prepflow.analyze(flow_stream({'Code': 'string'}, [
            {'nodeType': '.v1.AddColumn', 'columnName': 'Copy', 'expression': '[Code]'},
            {'nodeType': '.v2018_3_3.QuickCalcColumn', 'calcExpressionType': 'RemoveLetters',
             'columnName': 'Copy', 'expression': "REGEXP_REPLACE([Copy], '[[:alpha:]]', '')"}]))
        actions = next(n for n in model['nodes'] if n['id'] == 'transform')['actions']
        self.assertEqual([a['label'] for a in actions], ['Calculated field', 'Remove letters'])
        self.assertEqual(actions[0]['expressions'], [{'field': 'Copy', 'expression': '[Code]'}])
        self.assertIn('REGEXP_REPLACE', actions[1]['expressions'][0]['expression'])
