"""Smoke-test the delivered ZIP with Python discovery deliberately unavailable."""
import contextlib
import io
import json
import os
import re
import socket
import subprocess
import tempfile
import time
import zipfile
import sys
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from build_windows import VERSION, EXE_NAME


def model_from(html):
    return json.loads(re.search(r'<script id="flow-data" type="application/json">(.*?)</script>', html, re.S)[1])


def config_from(html):
    return json.loads(re.search(r'<script id="server-config" type="application/json">(.*?)</script>', html, re.S)[1])


def verify():
    with tempfile.TemporaryDirectory(prefix='配布検証_', dir=ROOT / 'output') as temporary:
        target = Path(temporary)
        release = ROOT / 'dist' / f'PrepFlowViewer-v{VERSION}-Windows-x64.zip'
        unpacked = target / 'PrepFlowViewer'
        with zipfile.ZipFile(release) as archive:
            archive.extractall(target)
        exe = unpacked / EXE_NAME
        assert exe.is_file()
        assert (exe.parent / '_internal/python313.dll').is_file()
        assert not (exe.parent / 'samples').exists()
        assert (exe.parent / '操作ガイド.html').is_file()
        assert (exe.parent / 'はじめに.txt').is_file()
        work = target / 'unrelated-working-folder'
        work.mkdir()
        history = target / 'recent.json'
        env = dict(os.environ)
        system = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32'
        env.update(PATH=str(system) + ';' + str(system / 'WindowsPowerShell/v1.0'),
                   PYTHONHOME=str(target / 'NO_INSTALLED_PYTHON'),
                   PYTHONPATH=str(target / 'NO_PYTHON_MODULES'))
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        base = f'http://127.0.0.1:{port}'

        @contextlib.contextmanager
        def launch(flow=None):
            args = [str(exe), '--port', str(port), '--no-browser', '--history-file', str(history)]
            if flow:
                args.append(str(flow))
            process = subprocess.Popen(args, cwd=work, env=env, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
            try:
                for _ in range(100):
                    if process.poll() is not None:
                        raise AssertionError(process.communicate())
                    try:
                        result = json.load(urlopen(base + '/health', timeout=.2))
                        assert result['app'] == 'PrepFlowViewer'
                        break
                    except OSError:
                        time.sleep(.1)
                else:
                    raise AssertionError('Packaged Viewer did not start')
                yield process
            finally:
                process.terminate()
                process.communicate(timeout=10)

        with launch():
            html = urlopen(base).read().decode('utf-8')
            assert model_from(html)['nodes'] == []
            assert config_from(html)['restoredFlow'] is False
            assert 'フローの中身を、すぐに。' not in html
            assert "mode:'original',history" in html
            assert 'data-join-region="overlap"' in html
            assert 'function handleFileDrop(' in html
            assert 'minimumFractionDigits:digits' in html
            token = json.loads(re.search(r'<script id="server-config" type="application/json">(.*?)</script>', html)[1])['token']

            def post(endpoint, data, filename=None):
                headers = {'X-Viewer-Token': token, 'Origin': base}
                if filename:
                    headers['X-File-Name'] = filename
                else:
                    data = json.dumps(data).encode()
                    headers['Content-Type'] = 'application/json'
                return json.load(urlopen(Request(base + endpoint, data=data, headers=headers)))

            flow = {'nodes': {'step': {'id': 'step', 'name': 'Packaged test', 'baseType': 'transform',
                'nodeType': '.v1.Container', 'loomContainer': {'nodes': {'calc': {'id': 'calc',
                'nodeType': '.v1.AddColumn', 'columnName': 'Result', 'expression': '1 + 2', 'nextNodes': []}}}}}}
            source = json.dumps(flow).encode()
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('flow', source)
            for filename, data in [('test.tfl', source), ('test.tflx', archive.getvalue())]:
                model = post('/api/analyze', data, filename)
                assert model['stats']['steps'] == 1
                edited = post('/api/preview-edits', {'exportKey': model['exportKey'], 'revision': model['editRevision'],
                    'changes': [{'stepId': 'step', 'actionId': 'calc', 'field': 'Result', 'before': '1 + 2', 'expression': '1 + 3'}]})
                exported = urlopen(base + '/export/' + edited['exportKey']).read().decode('utf-8')
                assert model_from(exported)['nodes'][0]['calculations'][0]['expression'] == '1 + 3'
                assert '<script id="server-config" type="application/json">{}</script>' in exported
            print('Moved ZIP, no Python PATH/HOME, empty startup, TFL/TFLX, edit and HTML export: passed', flush=True)
            from mock_tableau_server import mock_tableau
            with mock_tableau() as (tableau_url, calls):
                payload = {'server_url': tableau_url, 'token_name': 'test-name', 'token_value': 'TEST_ONLY',
                    'name': 'Published', 'project': 'Parent/Child', 'exportKey': model['exportKey'],
                    'revision': model['editRevision'], 'changes': []}
                for operation in ('test-auth', 'start'):
                    request = Request(base + '/api/publish/' + operation, data=json.dumps(payload).encode(),
                        headers={'Content-Type': 'application/json', 'X-Viewer-Token': token, 'Origin': base})
                    events = [json.loads(line) for line in urlopen(request)]
                    assert events[-1].get('ok'), events
                publications = [call for call in calls if '/flows?' in call[1]]
                assert len(publications) == 1 and 'overwrite=true' in publications[0][1]
                assert b'name="Published"' in publications[0][2]
                assert b'contentUrl=""' in next(call[2] for call in calls if call[1].endswith('/auth/signin'))
                assert (exe.parent / 'publish.ini').exists()
                assert 'TEST_ONLY' not in urlopen(base + '/export/' + model['exportKey']).read().decode()
                defaults=post('/api/publish/defaults',{'exportKey':model['exportKey']})
                assert (defaults['name'],defaults['project']) == ('Published','Parent/Child')
            print('Bundled TSC: local mock sign-in, filtered project search, overwrite publish and sign-out: passed', flush=True)
            types = post('/api/analyze', (ROOT / 'samples/PreppinData_2024_Week_42.tflx').read_bytes(), 'types.tflx')
            music = next(n for n in types['nodes'] if n['name'] == 'Music Split')
            fields = {f['name']: f['type'] for f in music['fieldInventory']}
            for name, kind in {'Couple': 'string', 'Judges Scores': 'string', 'Music': 'string',
                               'Stage': 'string', 'Theme': 'string', 'Total Score': 'integer', 'Year': 'integer'}.items():
                assert fields[name] == kind, (name, fields[name])
            merged = next(n for n in types['nodes'] if n['name'] == 'Theme Detail')
            assert not merged['schemaUncertain']
            assert 'Theme Detail' in {f['name'] for f in merged['fields']}
            assert not {'Film', 'Musical', 'Country', 'CelebratingBBC'} & {f['name'] for f in merged['fields']}
            dates = post('/api/analyze', (ROOT / 'samples/PreppinData_2024_Week_34.tflx').read_bytes(), 'dates.tflx')
            birthday = next(n for n in dates['nodes'] if n['name'] == 'Birthday Day')
            assert not birthday['schemaUncertain']
            assert next(f['type'] for f in birthday['fields'] if f['name'] == 'Birthday Day') == 'string'
            filters = post('/api/analyze', (ROOT / 'samples/PreppinData_2023_Week_15.tflx').read_bytes(), 'filters.tflx')
            node, action = next((n, a) for n in filters['nodes'] for a in n['actions'] if a['type'] == 'FilterOperation')
            assert action['label'] == 'フィルター'
            assert action['expressions'][0]['expression'] == action['raw']['filterExpression']
            expression = action['raw']['filterExpression']
            edited = post('/api/preview-edits', {'exportKey': filters['exportKey'], 'revision': filters['editRevision'],
                'changes': [{'stepId': node['id'], 'actionId': action['id'], 'field': '条件式',
                             'before': expression, 'expression': '(' + expression + ') AND TRUE'}]})
            edited_action = next(a for n in edited['nodes'] for a in n['actions'] if a['id'] == action['id'])
            assert edited_action['raw']['filterExpression'] == '(' + expression + ') AND TRUE'
            print('Packaged fixes: formula filters, filter editing, inferred types and updated UI assets: passed', flush=True)
        file = target / 'remember.tflx'
        file.write_bytes(archive.getvalue())
        with launch(file):
            page = urlopen(base).read().decode()
            assert model_from(page)['name'] == 'remember.tflx'
            assert config_from(page)['restoredFlow'] is False
        with launch():
            page = urlopen(base).read().decode()
            assert model_from(page)['name'] == 'remember.tflx'
            assert config_from(page)['restoredFlow'] is True
        file.unlink()
        with launch():
            page = urlopen(base).read().decode()
            assert model_from(page)['nodes'] == []
            assert config_from(page)['restoredFlow'] is False
        print('Persistent recent file and missing-file removal in packaged EXE: passed', flush=True)


if __name__ == '__main__':
    verify()
