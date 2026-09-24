import unittest

import prepflow


class TypeChangeTests(unittest.TestCase):
    def test_split_type_change_keeps_name_at_time_of_action(self):
        model = prepflow.analyze(prepflow.ROOT / 'samples' / 'PreppinData_2024_Week_31.tflx')
        node = next(n for n in model['nodes'] if n['name'] == 'Split x2')
        action = next(a for a in node['actions'] if a['type'] == 'ChangeColumnType')
        self.assertEqual(action['typeChanges'], [
            {'field': 'Event Time/Distance - Split 2', 'before': 'string', 'after': 'integer'}])

    def test_consecutive_changes_use_previous_action_type(self):
        fields = {'value': prepflow.make_field('value', 'string', 'input')}
        warnings = []
        first = {'raw': {'nodeType': '.v1.ChangeColumnType', 'fields': {'value': {'type': 'integer'}}}}
        second = {'raw': {'nodeType': '.v1.ChangeColumnType', 'fields': {'value': {'type': 'real'}}}}
        fields = prepflow.apply_action(fields, first, 'step', warnings)
        fields = prepflow.apply_action(fields, second, 'step', warnings)
        self.assertEqual(first['typeChanges'][0]['before'], 'string')
        self.assertEqual(first['typeChanges'][0]['after'], 'integer')
        self.assertEqual(second['typeChanges'][0]['before'], 'integer')
        self.assertEqual(fields['value']['type'], 'real')
        self.assertFalse(warnings)

    def test_unknown_source_type_is_not_invented(self):
        action = {'raw': {'nodeType': '.v1.ChangeColumnType', 'fields': {'missing': {'type': 'date'}}}}
        prepflow.apply_action({}, action, 'step', [])
        self.assertEqual(action['typeChanges'], [{'field': 'missing', 'before': 'unknown', 'after': 'date'}])
