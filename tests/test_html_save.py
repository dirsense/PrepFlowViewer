import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from desktop_launcher import DesktopServer
from tests.test_formula_save import test_flow


class HtmlSaveTests(unittest.TestCase):
    def test_native_save_confirmed_snapshot_cancel_overwrite_and_failure(self):
        with tempfile.TemporaryDirectory() as folder, patch('native_explorer.worker'):
            root = Path(folder)
            source = root / '日本語.tfl'
            source.write_text(json.dumps(test_flow()), encoding='utf-8')
            original = source.read_bytes()
            target = root / '日本語.html'
            target.write_text('old', encoding='utf-8')
            server = DesktopServer(source, history_path=root / 'history.json')
            base = server.start()
            try:
                page = urlopen(base).read().decode()
                def embedded(id):
                    return json.loads(re.search(r'<script id="' + id + r'" type="application/json">(.*?)</script>', page, re.S)[1])
                model = embedded('flow-data')
                token = embedded('server-config')['token']
                def post(route, payload, key=token):
                    return json.load(urlopen(Request(base + route, data=json.dumps(payload).encode(),
                        headers={'Origin': base, 'X-Viewer-Token': key})))
                payload = {'exportKey': model['exportKey']}
                with patch('native_dialogs.choose_file', return_value=target) as picker:
                    with self.assertRaises(HTTPError):
                        post('/api/save-html', payload, 'invalid')
                    picker.assert_not_called()
                    change = {'stepId': 'step', 'actionId': 'calc', 'field': 'Result', 'before': '1 + 2', 'expression': '1 + 3'}
                    edited = post('/api/preview-edits', {**payload, 'revision': model['editRevision'], 'changes': [change]})
                    result = post('/api/save-html', payload)
                    self.assertEqual(result['path'], str(target))
                    self.assertEqual(picker.call_args.kwargs['filename'], '日本語.html')
                    self.assertEqual(picker.call_args.kwargs['filetypes'], [('HTML ファイル', '*.html')])
                    html = target.read_text(encoding='utf-8')
                    saved = json.loads(re.search(r'<script id="flow-data" type="application/json">(.*?)</script>', html, re.S)[1])
                    self.assertEqual(saved['nodes'], edited['nodes'])
                    self.assertIn('<script id="server-config" type="application/json">{}</script>', html)
                with patch('native_dialogs.choose_file', return_value=None):
                    self.assertTrue(post('/api/save-html', payload)['cancelled'])
                    self.assertEqual(target.read_text(encoding='utf-8'), html)
                with patch('native_dialogs.choose_file', return_value=target), patch('prepflow.render_html', side_effect=OSError('write error')):
                    with self.assertRaises(HTTPError):
                        post('/api/save-html', payload)
                    self.assertEqual(target.read_text(encoding='utf-8'), html)
                self.assertEqual(source.read_bytes(), original)
                self.assertEqual(list(root.glob('.prepflow-*.tmp')), [])
            finally:
                server.close()
