import io
import json
import re
import socket
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import prepflow
from recent_flows import RecentFlows


class RecentServerTests(unittest.TestCase):
    def test_history_startup_selection_missing_file_and_upload_formats(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            history = RecentFlows(root / 'recent.json')
            a, b = root / 'A.tfl', root / 'B.tfl'
            a.write_text('{"nodes": {}}', encoding='utf-8')
            b.write_text('{"nodes": {}}', encoding='utf-8')
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                port = probe.getsockname()[1]
            process = subprocess.Popen([sys.executable, '-u', '-c',
                'import prepflow,sys; prepflow.serve(None,int(sys.argv[1]),False,history_path=sys.argv[2])',
                str(port), str(history.storage)], cwd=prepflow.ROOT,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                self.assertIn(b'PrepFlow Viewer:', process.stdout.readline())
                base = f'http://127.0.0.1:{port}'

                def opening():
                    page = urlopen(base).read().decode('utf-8')
                    model = json.loads(re.search(r'<script id="flow-data" type="application/json">(.*?)</script>', page, re.S)[1])
                    config = json.loads(re.search(r'<script id="server-config" type="application/json">(.*?)</script>', page, re.S)[1])
                    return model, config['token']

                model, token = opening()
                self.assertEqual(model['nodes'], [])
                self.assertEqual(model['name'], 'PrepFlow Viewer')

                def request(endpoint, data=None, filename=None):
                    headers = {'X-Viewer-Token': token, 'Origin': base}
                    if filename:
                        headers['X-File-Name'] = filename
                    elif data is not None:
                        data = json.dumps(data).encode()
                    return json.load(urlopen(Request(base + endpoint, data=data, headers=headers)))

                history.add(a)
                history.add(b)
                model, _ = opening()
                self.assertEqual(model['sourcePath'], str(b))
                result = request('/api/recent/open', {'id': history.identity(a)})
                self.assertEqual(result['sourcePath'], str(a))
                self.assertEqual(opening()[0]['name'], 'A.tfl')
                a.unlink()
                with self.assertRaises(HTTPError) as error:
                    request('/api/recent/open', {'id': history.identity(a)})
                self.assertEqual(error.exception.code, 404)
                self.assertEqual([x['name'] for x in request('/api/recent')['recent']], ['B.tfl'])
                self.assertEqual(opening()[0]['name'], 'B.tfl')
                for suffix in ['tfl', 'tflx']:
                    data = b'{"nodes": {}}'
                    if suffix == 'tflx':
                        archive = io.BytesIO()
                        with zipfile.ZipFile(archive, 'w') as z:
                            z.writestr('flow', data)
                        data = archive.getvalue()
                    uploaded = request('/api/analyze', data, 'Dropped.' + suffix)
                    self.assertEqual(uploaded['name'], 'Dropped.' + suffix)
                    self.assertIn('exportKey', uploaded)
                    self.assertNotIn('sourcePath', uploaded)
                b.unlink()
                self.assertEqual(opening()[0]['nodes'], [])
                self.assertEqual(request('/api/recent')['recent'], [])
            finally:
                process.terminate()
                process.communicate(timeout=10)


if __name__ == '__main__':
    unittest.main()
