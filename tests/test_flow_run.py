import copy
import io
import json
import re
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import prepflow
from flow_runner import FlowRunner, output_details, prepare_snapshot, select_outputs, cli_command
from desktop_launcher import DesktopServer
from tests.test_formula_save import test_flow


def fixture():
    flow = test_flow()
    flow['nodes']['step']['nextNodes'] = [{'nextNodeId': 'csv'}, {'nextNodeId': 'hyper'}]
    for key, typ, pathkey in [('csv', 'WriteToCsv', 'csvOutputFile'), ('hyper', 'WriteToHyper', 'hyperOutputFile')]:
        flow['nodes'][key] = {'id': key, 'baseType': 'output', 'nodeType': '.v1.' + typ, 'name': key,
                              pathkey: 'C:\\Destination\\結果.' + key, 'nextNodes': []}
    return flow


class FlowRunTests(unittest.TestCase):
    def test_snapshot_preserves_other_entries_and_applies_confirmed_changes(self):
        with tempfile.TemporaryDirectory() as folder:
            src, dst = Path(folder) / 'src.tflx', Path(folder) / 'run.tflx'
            flow = fixture()
            display = {'flowDisplaySettings': {'flowNodeDisplaySettings': {'step': {}, 'csv': {}, 'hyper': {}}}}
            with zipfile.ZipFile(src, 'w') as z:
                z.writestr('nested/flow', json.dumps(flow))
                z.writestr('nested/displaySettings', json.dumps(display))
                z.writestr('maestroMetadata', '{"flowEntryName":"flow"}')
                z.writestr('Data/source.xls', b'unchanged data')
            before = src.read_bytes()
            edit = {'stepId': 'step', 'actionId': 'calc', 'field': 'Result', 'before': '1 + 2', 'expression': '1 + 3'}
            prepare_snapshot(src, prepflow.file_revision(src), [edit], ['csv'], dst)
            with zipfile.ZipFile(dst) as z:
                result = json.loads(z.read('nested/flow'))
                self.assertNotIn('hyper', result['nodes'])
                self.assertEqual(result['nodes']['step']['nextNodes'], [{'nextNodeId': 'csv'}])
                self.assertEqual(result['nodes']['step']['loomContainer']['nodes']['calc']['expression'], '1 + 3')
                self.assertEqual(z.read('Data/source.xls'), b'unchanged data')
                self.assertEqual(z.read('maestroMetadata'), b'{"flowEntryName":"flow"}')
                self.assertNotIn('hyper', json.loads(z.read('nested/displaySettings'))['flowDisplaySettings']['flowNodeDisplaySettings'])
            self.assertEqual(src.read_bytes(), before)
            prepare_snapshot(src, prepflow.file_revision(src), [], ['csv', 'hyper'], dst)
            self.assertEqual(prepflow.read_package(dst)[1], flow)
            with self.assertRaises(ValueError):
                prepare_snapshot(src, 'stale', [], ['csv'], dst)

    def test_bad_selection_does_not_mutate_flow(self):
        for selected in [[], ['missing'], ['step'], ['csv', 'csv'], 'csv']:
            flow = fixture()
            with self.assertRaises(ValueError):
                select_outputs(flow, {}, selected)
            self.assertEqual(flow, fixture())
        details = output_details(fixture())
        self.assertEqual(details[0]['filename'], '結果.csv')
        self.assertEqual(details[0]['folder'], 'C:\\Destination')
        with self.assertRaises(ValueError):
            cli_command('C:/tableau-prep-cli.bat', 'C:/bad%PATH%.tfl')
        command = cli_command('C:/Program Files/Tableau/tableau-prep-cli.bat', 'C:/日本語 & file.tfl')
        self.assertIn('"C:/日本語 & file.tfl"', command)

    def test_job_logs_failure_redaction_cleanup_and_double_start(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'flow.tfl'
            source.write_text(json.dumps(fixture()), encoding='utf-8')
            cli = root / 'tableau-prep-cli.bat'; cli.write_text('test')
            cred = root / 'credentials.json'; cred.write_text('{"password":"sensitive-test-value"}')
            gate = threading.Event()
            process = unittest.mock.MagicMock()
            process.__enter__.return_value = process
            process.stdout = io.BytesIO(b'failed sensitive-test-value\n')
            process.wait.side_effect = lambda: (gate.wait(5), 7)[1]
            runner = FlowRunner(); runner.configure('cli', cli); runner.configure('credentials', cred)
            model = {'name': source.name, 'editRevision': prepflow.file_revision(source)}
            with patch('flow_runner.subprocess.Popen', return_value=process) as popen:
                job = runner.start(source, model, [], ['csv'], 'same-request-id-1')
                self.assertTrue(job['running'])
                self.assertEqual(runner.start(source, model, [], ['csv'], 'same-request-id-1')['requestId'], job['requestId'])
                with self.assertRaises(ValueError):
                    runner.start(source, model, [], ['hyper'], 'other-request-id-2')
                gate.set(); runner.wait()
                self.assertEqual(popen.call_count, 1)
            result = runner.status()
            self.assertEqual(result['state'], 'error'); self.assertEqual(result['exitCode'], 7)
            self.assertNotIn('sensitive-test-value', json.dumps(result))
            self.assertFalse(result['running'])
            self.assertIsNotNone(result['finishedAt'])
            self.assertGreaterEqual(result['elapsedMs'], 0)
            self.assertEqual(result['elapsedMs'], runner.status()['elapsedMs'])
            self.assertEqual(list(root.glob('.prepflow-run-*')), [])
            self.assertEqual(json.loads(source.read_text()), fixture())

    def test_cancel_before_launch_and_during_owned_process(self):
        for before_launch in [True, False]:
            with self.subTest(before_launch=before_launch), tempfile.TemporaryDirectory() as folder:
                root = Path(folder); source = root / 'flow.tfl'
                source.write_text(json.dumps(fixture()), encoding='utf-8')
                cli = root / 'tableau-prep-cli.bat'; cli.write_text('test')
                runner = FlowRunner(); runner.configure('cli', cli)
                gate, reached = threading.Event(), threading.Event()
                process = unittest.mock.MagicMock()
                process.__enter__.return_value = process
                process.pid = 7654321
                process.poll.return_value = None
                process.wait.return_value = 1
                def read(*args):
                    reached.set(); gate.wait(5); return b''
                process.stdout.readline.side_effect = read
                def prepare(*args):
                    if before_launch:
                        reached.set(); gate.wait(5)
                def stop(*args, **kwargs):
                    self.assertEqual(args[0][1:], ['/PID', '7654321', '/T', '/F'])
                    gate.set()
                    return unittest.mock.Mock(returncode=0)
                with patch('flow_runner.prepare_snapshot', side_effect=prepare), patch('flow_runner.subprocess.Popen', return_value=process) as popen, patch('flow_runner.subprocess.run', side_effect=stop) as kill:
                    runner.start(source, {'name': source.name, 'editRevision': prepflow.file_revision(source)}, [], ['csv'], 'cancel-request-123')
                    self.assertTrue(reached.wait(5))
                    with self.assertRaises(ValueError):
                        runner.cancel('different-request')
                    kill.assert_not_called()
                    self.assertEqual(runner.cancel('cancel-request-123')['state'], 'cancelling')
                    gate.set(); runner.wait()
                    result = runner.status()
                    self.assertEqual(result['state'], 'cancelled')
                    self.assertFalse(result['running'])
                    self.assertIsNotNone(result['finishedAt'])
                    self.assertEqual(kill.call_count, 0 if before_launch else 1)
                    self.assertEqual(popen.call_count, 0 if before_launch else 1)
                    self.assertFalse(runner.cancel('cancel-request-123')['running'])
                self.assertEqual(list(root.glob('.prepflow-run-*')), [])

    def test_server_auth_options_selection_and_stale_revision(self):
        with tempfile.TemporaryDirectory() as folder, patch('native_explorer.worker'):
            root = Path(folder); src = root / 'flow.tfl'
            src.write_text(json.dumps(fixture()), encoding='utf-8')
            server = DesktopServer(src, history_path=root / 'history.json'); base = server.start()
            try:
                page = urlopen(base).read().decode()
                embedded = lambda key: json.loads(re.search(r'<script id="'+key+r'" type="application/json">(.*?)</script>', page, re.S)[1])
                model, config = embedded('flow-data'), embedded('server-config')
                def post(route, payload, token=config['token']):
                    return json.load(urlopen(Request(base + '/api/run/' + route, data=json.dumps(payload).encode(),
                                                    headers={'Origin': base, 'X-Viewer-Token': token})))
                with self.assertRaises(HTTPError):
                    post('status', {}, 'bad-token')
                options = post('options', {'exportKey': model['exportKey']})
                self.assertEqual([o['id'] for o in options['outputs']], ['csv', 'hyper'])
                with patch('flow_runner.FlowRunner.start') as start:
                    with self.assertRaises(HTTPError):
                        post('start', {'exportKey': model['exportKey'], 'revision': 'stale', 'outputs': ['csv']})
                    start.assert_not_called()
                    start.return_value = {'running': True}
                    result = post('start', {'exportKey': model['exportKey'], 'revision': model['editRevision'],
                        'changes': [], 'outputs': ['csv'], 'requestId': 'request-id-12345678'})
                    self.assertTrue(result['job']['running'])
                    self.assertEqual(start.call_args.args[3], ['csv'])
                with patch('native_dialogs.choose_file', return_value=None):
                    self.assertEqual(post('credentials', {})['credentials'], '')
            finally:
                server.close()


if __name__ == '__main__':
    unittest.main()
