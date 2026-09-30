import unittest

import prepflow
from formula_types import infer_type


class FormulaTypeTests(unittest.TestCase):
    fields = {name: {'type': kind} for name, kind in {
        'Series': 'integer', 'Total Score': 'integer', 'Couple': 'string',
        'Theme': 'string', 'Music': 'string', 'Rate': 'real',
        'Date': 'date', 'Time': 'datetime', 'Odd]Name': 'string', 'Unresolved': 'unknown',
    }.items()}

    def test_branches_and_arithmetic(self):
        cases = {
            'if [Series]<=2 then 2004 else 2002+[Series] end': 'integer',
            "IF [Couple]='Group' THEN NULL ELSE [Total Score] END": 'integer',
            "IF CONTAINS([Theme],'Quarter') THEN 'Quarter Final' ELSEIF CONTAINS([Theme],'Semi') THEN 'Semi Final' END": 'string',
            "IF TRUE THEN IF FALSE THEN NULL ELSE [Couple] END ELSE 'Group' END": 'string',
            "CASE [Series] WHEN 1 THEN [Couple] WHEN 2 THEN 'Other' ELSE NULL END": 'string',
            "IIF([Series] IN (1, 2), 1, [Rate], NULL)": 'real',
            'IFNULL([Total Score], 0)': 'integer',
            "IFNULL(NULL, 'missing')": 'string',
            '([Series] + 2) * -3': 'integer',
            '[Series] / 2': 'real',
            '[Series] + [Rate]': 'real',
            "[Couple] + ' (' + STR([Series]) + ')'": 'string',
            "REPLACE(REPLACE([Music], ',', '|'), '&', '|')": 'string',
            'ZN([Total Score])': 'integer',
            'SUM([Total Score])': 'integer',
            "DATEADD('month', [Series], [Date])": 'date',
            "DATETRUNC('month', [Time])": 'datetime',
            'LEN([Music]) > 3': 'boolean',
        }
        for expression, expected in cases.items():
            with self.subTest(expression=expression):
                self.assertEqual(infer_type(expression, self.fields), expected)

    def test_literals_comments_and_escaped_fields_do_not_confuse_branches(self):
        cases = {
            '// IF THEN [Missing]\nIF TRUE THEN "END ELSE //" /* ELSE */ ELSE "x" END': 'string',
            "IF TRUE THEN 'it''s THEN' ELSE 'it\\'s END' END": 'string',
            '[Odd]]Name]': 'string',
            '1e3 + .5': 'real',
            '#2026-09-24#': 'date',
            '#2026-09-24 12:34:56#': 'datetime',
        }
        for expression, expected in cases.items():
            with self.subTest(expression=expression):
                self.assertEqual(infer_type(expression, self.fields), expected)

    def test_unknown_or_conflicting_result_types_are_not_guessed(self):
        expressions = [
            "IF TRUE THEN 'x' ELSE 1 END", 'IF TRUE THEN [Unresolved] ELSE 1 END',
            'IFNULL([Missing], 0)', 'NULL', 'IF TRUE THEN NULL END',
            'UNSUPPORTED([Total Score])', "REPLACE([Music], 'x', '') + 1",
            'INT([Music]) + [Unresolved]', "DATEADD([Couple], 1, [Missing])",
            'IF TRUE THEN 1', 'IF THEN 1 END', '1 +', 'LEN([Music]) garbage',
            'INT()', '"unclosed', '/* unclosed', '(', 'CASE [Series] END',
            '(' * 150 + '1' + ')' * 150,
        ]
        for expression in expressions:
            with self.subTest(expression=expression):
                self.assertEqual(infer_type(expression, self.fields), 'unknown')

    def test_inferred_types_propagate_through_cleanup(self):
        from flow_fixtures import flow_stream
        model = prepflow.analyze(flow_stream({'Text': 'string'}, [
            {'nodeType': '.v1.AddColumn', 'columnName': 'Length', 'expression': 'LEN([Text])'},
            {'nodeType': '.v1.AddColumn', 'columnName': 'Next', 'expression': '[Length] + 1'},
            {'nodeType': '.v1.RemoveColumns', 'columnNames': ['Text']}]))
        node = next(n for n in model['nodes'] if n['id'] == 'transform')
        fields = {f['name']: f for f in node['fieldInventory']}
        self.assertEqual(fields['Length']['type'], 'integer')
        self.assertEqual(fields['Next']['type'], 'integer')
        self.assertEqual(fields['Next']['typeSource'], 'Estimated')
        self.assertTrue(fields['Text']['deleted'])

    def test_same_field_replacement_reads_previous_type_without_mutating_it(self):
        fields = {'Score': prepflow.make_field('Score', 'integer', 'input')}
        action = {'raw': {'nodeType': '.v1.AddColumn', 'columnName': 'Score',
                         'expression': 'IF [Score] < 0 THEN NULL ELSE [Score] END'}}
        result = prepflow.apply_action(fields, action, 'clean', [])
        self.assertEqual(result['Score']['type'], 'integer')
        self.assertEqual(fields['Score']['typeSource'], 'Definition')
        self.assertEqual(result['Score']['typeSource'], 'Estimated')


if __name__ == '__main__':
    unittest.main()
