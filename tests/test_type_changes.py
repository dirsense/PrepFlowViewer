import unittest

import prepflow


class TypeChangeTests(unittest.TestCase):
    def test_type_change_keeps_name_at_time_of_action(self):
        from flow_fixtures import flow_stream
        model = prepflow.analyze(flow_stream({'Value': 'string'}, [
            {'nodeType': '.v1.ChangeColumnType', 'fields': {'Value': {'type': 'integer'}}},
            {'nodeType': '.v1.RenameColumn', 'columnName': 'Value', 'rename': 'Renamed'}]))
        node = next(n for n in model['nodes'] if n['id'] == 'transform')
        action = next(a for a in node['actions'] if a['type'] == 'ChangeColumnType')
        self.assertEqual(action['typeChanges'], [{'field': 'Value', 'before': 'string', 'after': 'integer'}])

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
