import copy
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import prepflow


def test_flow():
    return {'nodes': {'step': {'id': 'step', 'name': 'Edit test', 'baseType': 'transform',
        'nodeType': '.v1.Container', 'loomContainer': {'nodes': {
            'calc': {'id': 'calc', 'nodeType': '.v1.AddColumn', 'columnName': 'Result',
                     'expression': '1 + 2', 'nextNodes': [], 'description': 'keep this comment'}}}}}}


class FormulaSaveTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / 'flow.tflx'
        self.flow = test_flow()
        self.change = {'stepId': 'step', 'actionId': 'calc', 'field': 'Result',
                       'before': '1 + 2', 'expression': '1 + 3'}
        with zipfile.ZipFile(self.path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.comment = b'package comment'
            archive.writestr('nested/flow', json.dumps(self.flow))
            archive.writestr('displaySettings', '{"keep": "positions"}')
            archive.writestr('maestroMetadata', '{"flowEntryName": "flow"}')
            archive.writestr('Data/source.csv', b'original,data\r\n1,2\r\n')
            archive.writestr('Data/binary.hyper', bytes(range(256)) * 100)
        self.revision = prepflow.file_revision(self.path)

    def test_archive_changes_only_target_expression(self):
        with zipfile.ZipFile(self.path) as archive:
            original = {i.filename: (archive.read(i), i.date_time, i.compress_type, i.external_attr) for i in archive.infolist()}
        result, revision = prepflow.save_formula_file(self.path, self.revision, self.change)
        self.assertNotEqual(revision, self.revision)
        self.assertEqual(revision, prepflow.file_revision(self.path))
        self.assertEqual(result['nodes'][0]['actions'][0]['expressions'][0]['expression'], '1 + 3')
        with zipfile.ZipFile(self.path) as archive:
            self.assertEqual(archive.comment, b'package comment')
            self.assertEqual(set(archive.namelist()), set(original))
            expected = copy.deepcopy(self.flow)
            expected['nodes']['step']['loomContainer']['nodes']['calc']['expression'] = '1 + 3'
            self.assertEqual(json.loads(archive.read('nested/flow')), expected)
            for name, (data, date, compression, attributes) in original.items():
                if name == 'nested/flow':
                    continue
                self.assertEqual(archive.read(name), data)
                info = archive.getinfo(name)
                self.assertEqual((info.date_time, info.compress_type, info.external_attr), (date, compression, attributes))

    def test_external_change_and_wrong_target_do_not_write(self):
        for change in [{**self.change, 'actionId': 'missing'}, {**self.change, 'field': 'wrong'},
                       {**self.change, 'before': 'outdated'}, {**self.change, 'expression': ''}]:
            with self.assertRaises(ValueError):
                prepflow.save_formula_file(self.path, self.revision, change)
            self.assertEqual(prepflow.file_revision(self.path), self.revision)
        with self.path.open('ab') as stream:
            stream.write(b'external change')
        externally_changed = self.path.read_bytes()
        with self.assertRaises(ValueError):
            prepflow.save_formula_file(self.path, self.revision, self.change)
        self.assertEqual(self.path.read_bytes(), externally_changed)

    def test_filter_expression_round_trip_does_not_add_regular_expression(self):
        from flow_fixtures import filter_package
        source = Path(self.temporary.name) / 'source.tflx'
        source.write_bytes(filter_package())
        self.path.write_bytes(source.read_bytes())
        model = prepflow.analyze(self.path)
        step, action = next((n, a) for n in model['nodes'] for a in n['actions'] if a['type'] == 'FilterOperation')
        before = action['raw']['filterExpression']
        change = {'stepId': step['id'], 'actionId': action['id'], 'field': 'Condition',
                  'before': before, 'expression': '// test\n(' + before + ') AND TRUE'}
        package = prepflow.read_package(self.path)
        prepflow.apply_formula_change(package[1], change)
        preview = prepflow.analyze(None, package=package)
        preview_action = next(a for n in preview['nodes'] for a in n['actions'] if a['id'] == action['id'])
        self.assertEqual(preview_action['expressions'][0]['expression'], change['expression'])
        saved, _ = prepflow.save_formula_file(self.path, prepflow.file_revision(self.path), change)
        saved_action = next(a for n in saved['nodes'] for a in n['actions'] if a['id'] == action['id'])
        self.assertNotIn('expression', saved_action['raw'])
        self.assertEqual(saved_action['raw']['filterExpression'], change['expression'])
        with zipfile.ZipFile(source) as original, zipfile.ZipFile(self.path) as edited:
            for name in original.namelist():
                if name != 'flow':
                    self.assertEqual(original.read(name), edited.read(name))
            expected = json.loads(original.read('flow'))
            prepflow.apply_formula_change(expected, change)
            self.assertEqual(json.loads(edited.read('flow')), expected)

    def test_failed_replacement_keeps_original_and_cleans_temporary(self):
        with patch('os.replace', side_effect=PermissionError('file in use')):
            with self.assertRaises(PermissionError):
                prepflow.save_formula_file(self.path, self.revision, self.change)
        self.assertEqual(prepflow.file_revision(self.path), self.revision)
        self.assertEqual(list(self.path.parent.glob('.prepflow-*')), [])

    def test_plain_tfl_and_type_conversion_expression(self):
        flow = test_flow()
        raw = flow['nodes']['step']['loomContainer']['nodes']['calc']
        raw.pop('expression')
        raw.update(nodeType='.v1.ChangeColumnType', fields={'Result': {'type': 'integer', 'calc': '1 + 2'}})
        path = self.path.with_suffix('.tfl')
        path.write_text(json.dumps(flow), encoding='utf-8')
        prepflow.save_formula_file(path, prepflow.file_revision(path), self.change)
        saved = json.loads(path.read_text(encoding='utf-8'))
        self.assertEqual(saved['nodes']['step']['loomContainer']['nodes']['calc']['fields']['Result']['calc'], '1 + 3')

    def test_memory_preview_and_save_as_with_sequential_edits(self):
        package = copy.deepcopy(prepflow.read_package(self.path))
        second = {**self.change, 'before': '1 + 3', 'expression': '1 + 4'}
        for change in [self.change, second]:
            prepflow.apply_formula_change(package[1], change)
        preview = prepflow.analyze(None, filename=self.path.name, package=package)
        self.assertEqual(preview['nodes'][0]['actions'][0]['expressions'][0]['expression'], '1 + 4')
        self.assertEqual(prepflow.file_revision(self.path), self.revision)
        destination = self.path.with_name('renamed.tflx')
        saved, revision = prepflow.save_formula_file(self.path, self.revision, [self.change, second], destination)
        self.assertEqual(saved['name'], 'renamed.tflx')
        self.assertEqual(prepflow.file_revision(self.path), self.revision)
        third = {**second, 'before': '1 + 4', 'expression': '1 + 5'}
        saved, _ = prepflow.save_formula_file(destination, revision, [third])
        self.assertEqual(saved['nodes'][0]['actions'][0]['expressions'][0]['expression'], '1 + 5')

    def test_failed_batch_does_not_write_partial_changes(self):
        with self.assertRaises(ValueError):
            prepflow.save_formula_file(self.path, self.revision, [self.change, self.change])
        self.assertEqual(prepflow.file_revision(self.path), self.revision)

    def test_save_dialog_defaults_to_source_folder_and_name(self):
        with patch('native_dialogs.choose_file', return_value=None) as dialog:
            self.assertIsNone(prepflow.choose_save_file(self.path, self.path.name))
            self.assertEqual(dialog.call_args.kwargs['directory'], self.path.parent)
            self.assertEqual(dialog.call_args.kwargs['filename'], self.path.name)
            self.assertTrue(dialog.call_args.kwargs['save'])
