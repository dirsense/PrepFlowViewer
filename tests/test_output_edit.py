import copy
import json
import re
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import prepflow
from desktop_launcher import DesktopServer
from flow_runner import prepare_snapshot
from output_edit import configuration, make_change, edited_node, lookup_project, REFRESH
from tableau_publish import PublishSettings
from tests.test_flow_run import fixture


class OutputEditTests(unittest.TestCase):
    def test_conversion_preserves_graph_and_options(self):
        flow = fixture()
        original = copy.deepcopy(flow)
        node = flow['nodes']['csv']
        node['description'] = 'keep comment'
        config = {**configuration(node), 'format': 'server', 'name': 'Sales',
                  'server': 'https://tableau.example.com', 'project': 'Parent/Child', 'projectId': 'project-123'}
        change = make_change(node, {}, config)
        prepflow.apply_flow_change(flow, change)
        result = flow['nodes']['csv']
        self.assertEqual(result['nodeType'], '.v1.PublishExtract')
        self.assertEqual(result['projectName'], 'Parent/Child')
        self.assertEqual(result['projectLuid'], 'project-123')
        self.assertEqual(result['description'], 'keep comment')
        self.assertNotIn('csvOutputFile', result)
        self.assertEqual(flow['nodes']['step'], original['nodes']['step'])
        with self.assertRaises(ValueError):
            prepflow.apply_flow_change(flow, change)
        for target, key in [('hyper', 'hyperOutputFile'), ('csv', 'csvOutputFile'), ('excel', 'excelOutputFile')]:
            desired = {**config, 'format': target, 'name': 'New', 'folder': 'C:\\Exports', 'sheet': 'Results'}
            converted, properties = edited_node(result, {}, desired)
            self.assertEqual(converted[key], 'C:\\Exports\\New.' + {'hyper': 'hyper', 'csv': 'csv', 'excel': 'xlsx'}[target])
            self.assertNotIn('serverUrl', converted)
            self.assertNotIn('projectLuid', converted)
            if target == 'excel':
                self.assertEqual(properties[REFRESH]['outputOperationType'], 'outputOperationTypeCreate')
                self.assertEqual(converted['excelOutputSheetName'], '[Results$]')

    def test_nested_project_survives_save_reopen_and_execution_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            for suffix in ('.tfl', '.tflx'):
                with self.subTest(suffix=suffix):
                    source, saved, run = [Path(folder) / (name + suffix) for name in ('source', 'saved', 'run')]
                    flow = fixture()
                    if suffix == '.tflx':
                        with zipfile.ZipFile(source, 'w') as package:
                            package.writestr('flow', json.dumps(flow))
                    else:
                        source.write_text(json.dumps(flow), encoding='utf-8')
                    original = source.read_bytes()
                    node = flow['nodes']['csv']
                    desired = {**configuration(node), 'format': 'server', 'name': 'Sales',
                               'server': 'https://tableau.example.com',
                               'project': 'aaa/bbb/ccc', 'projectId': 'verified-project-id'}
                    change = make_change(node, {}, desired)
                    revision = prepflow.file_revision(source)
                    prepflow.save_formula_file(source, revision, [change], saved)
                    prepare_snapshot(source, revision, [change], ['csv'], run)
                    for path in (saved, run):
                        reopened = prepflow.read_package(path)[1]['nodes']['csv']
                        self.assertEqual(reopened['projectName'], 'aaa/bbb/ccc')
                        self.assertEqual(reopened['projectLuid'], 'verified-project-id')
                        self.assertEqual(configuration(reopened)['project'], 'aaa/bbb/ccc')
                        again, _ = edited_node(reopened, {}, configuration(reopened))
                        self.assertEqual(again, reopened)
                    self.assertEqual(source.read_bytes(), original)

    def test_writing_options_are_preserved_and_incompatible_csv_rejected(self):
        node = fixture()['nodes']['hyper']
        properties = {REFRESH: {'nodePropertyType': '.v2020_2_1.OutputRefreshOptions',
                               'outputOperationType': 'outputOperationTypeAppend',
                               'incrementalOutputOperationType': 'outputOperationTypeAppend', 'isIncrementalDefault': False}}
        config = {**configuration(node), 'name': 'Changed', 'format': 'excel', 'sheet': 'Results'}
        _, result = edited_node(node, properties, config)
        self.assertEqual(result, properties)
        with self.assertRaisesRegex(ValueError, 'CSV'):
            edited_node(node, properties, {**config, 'format': 'csv'})
        excel, _ = edited_node(node, {}, config)
        _, result = edited_node(excel, {}, {**config, 'format': 'hyper'})
        self.assertEqual(result[REFRESH]['outputOperationType'], 'outputOperationTypeAppend')

    def test_save_and_run_snapshot_include_mixed_edits_without_touching_source(self):
        with tempfile.TemporaryDirectory() as folder:
            source, saved, run = [Path(folder) / (name + '.tflx') for name in ('source', 'saved', 'run')]
            flow = fixture()
            with zipfile.ZipFile(source, 'w') as z:
                z.writestr('flow', json.dumps(flow))
                z.writestr('displaySettings', '{}')
                z.writestr('maestroMetadata', '{}')
                z.writestr('Data/file.bin', b'unchanged')
            before = source.read_bytes()
            revision = prepflow.file_revision(source)
            node = flow['nodes']['csv']
            change = make_change(node, {}, {**configuration(node), 'format': 'hyper', 'name': 'Changed'})
            formula = {'stepId': 'step', 'actionId': 'calc', 'field': 'Result', 'before': '1 + 2', 'expression': '99'}
            changes = [change, formula]
            prepflow.save_formula_file(source, revision, changes, saved)
            prepare_snapshot(source, revision, changes, ['csv'], run)
            for path in (saved, run):
                updated = prepflow.read_package(path)[1]
                self.assertTrue(updated['nodes']['csv']['hyperOutputFile'].endswith('Changed.hyper'))
                self.assertEqual(updated['nodes']['step']['loomContainer']['nodes']['calc']['expression'], '99')
                with zipfile.ZipFile(path) as z:
                    self.assertEqual(z.read('Data/file.bin'), b'unchanged')
            self.assertEqual(source.read_bytes(), before)

    def test_project_lookup_uses_saved_auth_default_site_and_redacts_errors(self):
        with tempfile.TemporaryDirectory() as folder:
            settings = PublishSettings(Path(folder) / 'publish.ini')
            settings.save({'server_url': 'https://tableau.example.com', 'token_name': 'token', 'token_value': 'secret-test'})
            tsc = MagicMock()
            with patch('tableau_publish.resolve_project', return_value='resolved-id') as resolve:
                result = lookup_project('https://tableau.example.com/', 'Parent/Child', settings, tsc=tsc)
                self.assertEqual(result['projectId'], 'resolved-id')
                tsc.PersonalAccessTokenAuth.assert_called_once_with('token', 'secret-test', site_id='')
                self.assertEqual(resolve.call_args.args[2], 'Parent/Child')
                tsc.Server.return_value.flows.publish.assert_not_called()
            tsc.reset_mock()
            with self.assertRaisesRegex(ValueError, '認証情報'):
                lookup_project('https://different.example.com', 'Child', settings, tsc=tsc)
            tsc.Server.assert_not_called()
            tsc.Server.side_effect = RuntimeError('error secret-test')
            with self.assertRaises(ValueError) as error:
                lookup_project('https://tableau.example.com', 'Child', settings, tsc=tsc)
            self.assertNotIn('secret-test', str(error.exception))

    def test_endpoints_preview_undo_run_details_and_verification_invalidation(self):
        with tempfile.TemporaryDirectory() as folder, patch('native_explorer.worker'):
            root = Path(folder)
            source = root / 'flow.tfl'
            source.write_text(json.dumps(fixture()), encoding='utf-8')
            settings = PublishSettings(root / 'publish.ini')
            with patch('tableau_publish.PublishSettings', return_value=settings):
                server = DesktopServer(source, history_path=root / 'history.json')
                base = server.start()
                try:
                    page = urlopen(base).read().decode()
                    embedded = lambda key: json.loads(re.search(r'<script id="' + key + r'" type="application/json">(.*?)</script>', page, re.S)[1])
                    model, token = embedded('flow-data'), embedded('server-config')['token']
                    identity = {'exportKey': model['exportKey'], 'revision': model['editRevision'], 'stepId': 'csv'}
                    def post(route, **payload):
                        request = Request(base + '/api/' + route, data=json.dumps({**identity, **payload}).encode(),
                                          headers={'Origin': base, 'X-Viewer-Token': token})
                        return json.load(urlopen(request))
                    defaults = post('output/defaults')
                    self.assertNotIn('token_value', defaults)
                    desired = {**defaults['configuration'], 'name': 'Changed', 'format': 'hyper'}
                    change = post('output/prepare', destination=desired)['change']
                    preview = post('preview-edits', changes=[change])
                    self.assertIn('Changed.hyper', json.dumps(preview))
                    self.assertEqual(post('run/options')['outputs'][0]['filename'], 'Changed.hyper')
                    post('preview-edits', changes=[])
                    self.assertEqual(post('run/options')['outputs'][0]['filename'], '結果.csv')
                    resolved = {'server': 'https://tableau.example.com', 'project': 'Parent/Child', 'projectId': 'id-123'}
                    desired.update(format='server', **resolved)
                    with self.assertRaises(HTTPError):
                        post('output/prepare', destination=desired)
                    with patch('output_edit.lookup_project', return_value=resolved):
                        verification = post('output/project', server=resolved['server'], project=resolved['project'])
                    change = post('output/prepare', destination=desired, proof=verification['proof'])['change']
                    self.assertNotIn('proof', change['destination'])
                    with self.assertRaises(HTTPError):
                        post('output/prepare', destination={**desired, 'project': 'Other'}, proof=verification['proof'])
                    preview = post('preview-edits', changes=[change])
                    self.assertIn('PublishExtract', json.dumps(preview))
                    output = next(node for node in preview['nodes'] if node['id'] == 'csv')
                    self.assertEqual(output['raw']['projectName'], 'Parent/Child')
                    reopened = post('output/defaults')['configuration']
                    self.assertEqual(reopened['project'], 'Parent/Child')
                    self.assertEqual(reopened['projectId'], 'id-123')
                    with patch('output_edit.lookup_project', return_value=resolved) as lookup:
                        post('output/project', server=reopened['server'], project=reopened['project'])
                        self.assertEqual(lookup.call_args.args[1], 'Parent/Child')
                    self.assertNotIn('token_value', prepflow.render_html(preview).split('<script id="flow-data"')[1].split('</script>')[0])
                finally:
                    server.close()


if __name__ == '__main__':
    unittest.main()
