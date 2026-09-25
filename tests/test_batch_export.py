import io
import json
import re
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from batch_export import BatchExport
from desktop_launcher import DesktopServer


class BatchTests(unittest.TestCase):
    def test_recursive_selection_dedup_upload_and_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'input'
            source.mkdir()
            child = source / 'nested'
            child.mkdir()
            a = source / '日本語.tfl'
            a.write_text('{"nodes": {}}', encoding='utf-8')
            b = child / 'package.TFLX'
            with zipfile.ZipFile(b, 'w') as archive:
                archive.writestr('flow', '{"nodes": {}}')
            (source / 'ignore.txt').write_text('ignore')
            batch = BatchExport(root)
            self.assertEqual(len(batch.folder(source, False)), 1)
            items = batch.folder(source)
            self.assertEqual(len(items), 2)
            self.assertEqual(batch.add([a])[0]['id'], items[0]['id'])
            destination = batch.destination(root)
            original = a.read_bytes()
            output = root / '日本語.html'
            output.write_text('old', encoding='utf-8')
            result = batch.convert(items[0]['id'], destination['id'])
            self.assertEqual(result['name'], '日本語.html')
            html = output.read_text(encoding='utf-8')
            self.assertIn('<!DOCTYPE html>', html)
            self.assertIn('<script id="server-config" type="application/json">{}</script>', html)
            self.assertEqual(a.read_bytes(), original)
            self.assertFalse((root / '日本語 (2).html').exists())
            batch.convert(items[1]['id'], destination['id'])
            uploaded = batch.upload(io.BytesIO(b'{"nodes": {}}'), 13, '../dropped.tfl')
            batch.convert(uploaded['id'], destination['id'])
            model = json.loads(re.search(r'<script id="flow-data" type="application/json">(.*?)</script>',
                                        (root / 'dropped.html').read_text(encoding='utf-8'), re.S)[1])
            self.assertEqual(model['name'], 'dropped.tfl')
            retained = batch.files[uploaded['id']]['path']
            batch.remove([uploaded['id'], items[0]['id']])
            self.assertFalse(retained.exists())
            self.assertTrue(a.exists())

    def test_failure_preserves_existing_output_and_rejects_unknown_selection(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            a = root / 'broken.tfl'
            a.write_text('not json')
            target = root / 'broken.html'
            target.write_text('keep')
            batch = BatchExport(root)
            item = batch.add([a])[0]
            dest = batch.destination(root)
            with self.assertRaises(ValueError):
                batch.convert(item['id'], dest['id'])
            self.assertEqual(target.read_text(), 'keep')
            with self.assertRaises(ValueError):
                batch.convert('unknown', dest['id'])
            with self.assertRaises(ValueError):
                batch.convert(item['id'], str(root))
            with self.assertRaises(ValueError):
                batch.upload(io.BytesIO(b'{}'), 10, 'short.tfl')
            self.assertEqual(list(root.glob('*.tmp')), [])

    def test_http_selection_upload_conversion_and_auth_do_not_change_open_flow(self):
        with tempfile.TemporaryDirectory() as folder, patch('native_explorer.worker'):
            root = Path(folder)
            current = root / 'current.tfl'
            current.write_text('{"nodes": {}}')
            extra = root / 'extra.tfl'
            extra.write_text('{"nodes": {}}')
            server = DesktopServer(current, history_path=root / 'recent.json')
            base = server.start()
            try:
                page = urlopen(base).read().decode()
                token = json.loads(re.search(r'<script id="server-config" type="application/json">(.*?)</script>', page)[1])['token']
                def request(action, payload=None, body=None, filename=None, authorized=True):
                    headers = {'Origin': base, 'X-Viewer-Token': token if authorized else 'wrong'}
                    if filename:
                        headers['X-File-Name'] = quote(filename)
                    data = body if body is not None else json.dumps(payload or {}).encode()
                    return json.load(urlopen(Request(base + '/api/batch/' + action, data=data, headers=headers)))
                with self.assertRaises(HTTPError) as error:
                    request('files', authorized=False)
                self.assertEqual(error.exception.code, 403)
                with patch('native_dialogs.choose_file', return_value=[extra]) as picker:
                    selected = request('files')['items'][0]
                    self.assertTrue(picker.call_args.kwargs['multiple'])
                with patch('native_dialogs.choose_directory', return_value=root):
                    destination = request('destination')
                    self.assertEqual(len(request('folder', {'recursive': False})['items']), 2)
                uploaded = request('upload', body=b'{"nodes": {}}', filename='ドロップ.tfl')['items'][0]
                for item in [selected, uploaded]:
                    result = request('convert', {'id': item['id'], 'destination': destination['id']})
                    self.assertTrue(Path(result['path']).is_file())
                request('remove', {'ids': [uploaded['id']]})
                with self.assertRaises(HTTPError):
                    request('convert', {'id': uploaded['id'], 'destination': destination['id']})
                page = urlopen(base).read().decode()
                model = json.loads(re.search(r'<script id="flow-data" type="application/json">(.*?)</script>', page, re.S)[1])
                self.assertEqual(model['name'], 'current.tfl')
            finally:
                server.close()


if __name__ == '__main__':
    unittest.main()
