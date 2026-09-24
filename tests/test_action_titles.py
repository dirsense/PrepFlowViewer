import copy
import unittest
import prepflow


class ActionTitleTests(unittest.TestCase):
    def test_quick_calc_titles_for_legacy_and_current_formats(self):
        expected = {
            'Lowercase': '小文字にする', 'Uppercase': '大文字にする', 'Titlecase': 'タイトルケースにする',
            'RemoveLetters': '文字を削除', 'RemoveNumbers': '数値を削除', 'RemovePunctuations': '句読点を削除',
            'RemoveAllSpaces': 'すべてのスペースを削除', 'RemoveExtraSpaces': '余分なスペースを削除',
            'TrimSpaces': 'スペースのトリミング',
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
        model = prepflow.analyze(prepflow.ROOT / 'samples' / 'PreppinData_2023_Week_15.tflx')
        order = next(n for n in model['nodes'] if n['name'] == 'Order')
        self.assertEqual([a['label'] for a in order['actions']],
                         ['フィールドを複製', '文字を削除', 'タイプを変更', 'フィールド名の変更'])
        self.assertEqual(order['actions'][0]['expressions'], [{'field': 'Column-1', 'expression': '[Column]'}])
        self.assertEqual(order['actions'][1]['expressions'],
                         [{'field': 'Column-1', 'expression': "REGEXP_REPLACE([Column-1], '[[:alpha:]]', '')"}])
