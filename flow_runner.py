"""Run an isolated, confirmed flow snapshot through the installed Prep CLI."""
import copy
import json
import locale
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path, PureWindowsPath


def output_nodes(flow):
    from prepflow import kind_of
    return {key: node for key, node in flow['nodes'].items() if kind_of(node) == 'output'}


def output_details(flow):
    result = []
    for key, node in output_nodes(flow).items():
        path = next((node.get(k) for k in ('hyperOutputFile', 'csvOutputFile', 'excelOutputFile',
                     'jsonOutputFile', 'outputFile') if isinstance(node.get(k), str) and node[k]), '')
        item = {'id': key, 'name': node.get('name') or key, 'type': node.get('nodeType', '').split('.')[-1],
                'path': path, 'folder': str(PureWindowsPath(path).parent) if path else '',
                'filename': PureWindowsPath(path).name if path else '', 'details': []}
        for field, label in [('excelOutputSheetName', 'Sheet'),
                             ('serverUrl', 'Server'), ('siteName', 'Site'), ('projectName', 'Project'),
                             ('datasourceName', 'Data source')]:
            if isinstance(node.get(field), str) and node[field]:
                item['details'].append([label, node[field]])
        for field, label in [('dbname', 'Database'), ('schema', 'Schema'), ('tablename', 'Table')]:
            value = (node.get('attributes') or {}).get(field)
            if isinstance(value, str) and value:
                item['details'].append([label, value])
        result.append(item)
    return result


def select_outputs(flow, display, selected):
    """Match Prep's deletion: output node, its incoming references, display entry.

    Intermediate branches, inputs, calculations, and metadata are left intact.
    """
    outputs = output_nodes(flow)
    if not isinstance(selected, list) or not selected or not all(isinstance(k, str) for k in selected):
        raise ValueError('Select output steps to run.')
    if len(set(selected)) != len(selected) or not set(selected) <= outputs.keys():
        raise ValueError('Output step to run was not found. Reopen the flow.')
    removed = outputs.keys() - set(selected)
    for key in removed:
        del flow['nodes'][key]
    for node in flow['nodes'].values():
        if 'nextNodes' in node:
            node['nextNodes'] = [edge for edge in node['nextNodes'] if edge.get('nextNodeId') not in removed]
    positions = display.get('flowDisplaySettings', {}).get('flowNodeDisplaySettings', {})
    for key in removed:
        positions.pop(key, None)
        # Other Prep versions can retain per-node display / refresh options.
        for data, field in [(display, 'fieldOrder'), (display, 'hiddenColumns'), (flow, 'nodeProperties')]:
            if isinstance(data.get(field), dict):
                data[field].pop(key, None)
    if isinstance(flow.get('initialNodes'), list):
        flow['initialNodes'] = [key for key in flow['initialNodes'] if key not in removed]
    return removed


def prepare_snapshot(source, revision, changes, selected, destination):
    import zipfile
    from prepflow import read_package, file_revision, apply_flow_change
    source, destination = Path(source), Path(destination)
    if file_revision(source) != revision:
        raise ValueError('The source file has changed. Reopen the flow before running it.')
    _, flow, display, metadata, _ = read_package(source)
    for change in changes:
        apply_flow_change(flow, change)
    removed = select_outputs(flow, display, selected)
    encode = lambda data: json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if zipfile.is_zipfile(source):
        with zipfile.ZipFile(source) as original, zipfile.ZipFile(destination, 'w') as updated:
            def entry(name):
                found = [i.filename for i in original.infolist() if i.filename == name or i.filename.rsplit('/', 1)[-1] == name]
                if len(found) != 1:
                    raise ValueError('Cannot uniquely identify the flow definition to execute.')
                return found[0]
            replacements = {entry(metadata.get('flowEntryName', 'flow')): encode(flow)}
            if removed and display:
                replacements[entry(metadata.get('displaySettingsEntryName', 'displaySettings'))] = encode(display)
            updated.comment = original.comment
            for info in original.infolist():
                clone = copy.copy(info)
                if info.filename in replacements:
                    updated.writestr(clone, replacements[info.filename])
                else:
                    with original.open(info) as src, updated.open(clone, 'w', force_zip64=info.file_size >= zipfile.ZIP64_LIMIT) as dst:
                        shutil.copyfileobj(src, dst, 1024**2)
    else:
        destination.write_bytes(encode(flow))
    if file_revision(source) != revision:
        raise ValueError('Execution was cancelled because the source file changed during preparation.')


def find_cli():
    candidates = []
    for root in {os.environ.get('ProgramW6432'), os.environ.get('ProgramFiles'), os.environ.get('ProgramFiles(x86)')} - {None}:
        candidates.extend((Path(root) / 'Tableau').glob('Tableau Prep Builder */scripts/tableau-prep-cli.bat'))
    candidates.sort(key=lambda p: tuple(int(n) for n in re.findall(r'\d+', p.parent.parent.name)), reverse=True)
    return next((p for p in candidates if p.is_file()), None)


def cli_command(cli, snapshot, credentials=None):
    # cmd is necessary for the vendor's .bat. Quote every path; reject expansions
    # that cmd could reinterpret. No flow names or node text enter the command.
    values = [str(cli), '-t', str(snapshot)]
    if credentials:
        values.extend(['-c', str(credentials)])
    if any(any(c in value for c in '\r\n"%!') for value in values):
        raise ValueError('Executable, flow and credentials file paths cannot contain % ! \" or line breaks.')
    command = '"' + ' '.join('"' + value + '"' for value in values) + '"'
    # Pass cmd its native command line, not list2cmdline's C-runtime escaping:
    # cmd does not interpret backslash-escaped quotes produced for a list arg.
    executable = str(Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/cmd.exe')
    return f'"{executable}" /d /v:off /s /c {command}'


def secret_values(path):
    if not path:
        return []
    if Path(path).stat().st_size > 4 * 1024**2:
        raise ValueError('Credentials file exceeds the 4 MB limit.')
    data = json.loads(Path(path).read_text(encoding='utf-8-sig'))
    secrets = []
    def visit(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if any(word in key.lower() for word in ('password', 'secret', 'token')) and isinstance(child, str) and child:
                    secrets.append(child)
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    visit(data)
    return sorted(set(secrets), key=len, reverse=True)


class FlowRunner:
    def __init__(self):
        self.lock = threading.RLock()
        self.cli = find_cli()
        self.credentials = None
        self.job = None
        self.requests = {}
        self.thread = None
        self.process = None
        self.started = None
        self.log = None

    def options(self):
        with self.lock:
            return {'cli': str(self.cli or ''), 'credentials': str(self.credentials or ''),
                    'job': self.status()}

    def configure(self, kind, path):
        with self.lock:
            if self.job and self.job['running']:
                raise ValueError('Settings cannot be changed while a flow is running.')
            if path is not None:
                path = Path(path).resolve()
                if not path.is_file() or (kind == 'cli' and path.name.lower() != 'tableau-prep-cli.bat') or (kind == 'credentials' and path.suffix.lower() != '.json'):
                    raise ValueError('Select the Tableau Prep executable or a credentials JSON file.')
            setattr(self, kind, path)

    def status(self):
        with self.lock:
            result = copy.deepcopy(self.job)
            if result and result['running'] and self.started is not None:
                result['elapsedMs'] = max(0, int((time.monotonic() - self.started) * 1000))
            return result

    def cancel(self, request_id):
        """Stop only this Viewer's owned CLI process tree; never by executable name."""
        with self.lock:
            if not self.job or self.job['requestId'] != request_id:
                raise ValueError('The execution to stop does not match.')
            if not self.job['running'] or self.job.get('cancelRequested'):
                return self.status()
            process = self.process
            if process is not None and process.poll() is not None:
                return self.status()  # Completion already won the race.
            self.job['cancelRequested'] = True
            self.job['state'] = 'cancelling'
            if process is not None:
                taskkill = Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/taskkill.exe'
                try:
                    result = subprocess.run([str(taskkill), '/PID', str(process.pid), '/T', '/F'],
                                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                            creationflags=subprocess.CREATE_NO_WINDOW, timeout=10)
                    if result.returncode and process.poll() is None:
                        raise RuntimeError('Could not stop the execution process. Try again.')
                except Exception:
                    self.job['cancelRequested'] = False
                    self.job['state'] = 'running'
                    raise
            self.log('Cancellation requested. Waiting for the execution process to exit.', 'warning')
            return self.status()

    def start(self, source, model, changes, selected, request_id):
        with self.lock:
            if request_id in self.requests:
                return copy.deepcopy(self.requests[request_id])
            if self.job and self.job['running']:
                raise ValueError('Another flow is running. Wait until it finishes.')
            if os.name != 'nt' or not self.cli or not self.cli.is_file():
                raise ValueError('Tableau Prep Builder was not found. Select Change and choose tableau-prep-cli.bat.')
            from prepflow import read_package, file_revision, apply_flow_change
            if file_revision(source) != model['editRevision']:
                raise ValueError('The source file has changed. Reopen the flow.')
            _, flow, display, _, _ = read_package(source)
            for change in changes:
                apply_flow_change(flow, change)
            select_outputs(flow, display, selected)
            secrets = secret_values(self.credentials)
            # Keep relative file references based at the original flow directory.
            fd, name = tempfile.mkstemp(prefix='.prepflow-run-', suffix=Path(source).suffix, dir=Path(source).parent)
            os.close(fd)
            snapshot = Path(name)
            try:
                command = cli_command(self.cli, snapshot, self.credentials)
            except Exception:
                snapshot.unlink(missing_ok=True)
                raise
            self.job = {'requestId': request_id, 'running': True, 'state': 'running', 'name': model['name'],
                        'sourcePath': str(Path(source).resolve()), 'exportKey': model.get('exportKey'),
                        'outputs': output_details(flow), 'logs': [], 'exitCode': None,
                        'startedAt': time.time(), 'finishedAt': None, 'elapsedMs': 0, 'cancelRequested': False}
            self.started = time.monotonic()
            self.process = None
            self.requests[request_id] = self.job
            while len(self.requests) > 16:
                self.requests.pop(next(iter(self.requests)))
            def log(message, level='info'):
                text = str(message)
                for secret in secrets:
                    text = text.replace(secret, '***')
                with self.lock:
                    self.job['logs'].append({'message': text[:16000], 'level': level, 'time': time.strftime('%H:%M:%S')})
                    if len(self.job['logs']) > 2000:
                        del self.job['logs'][:-2000]
            self.log = log
            def run():
                try:
                    log('Preparing execution flow with confirmed edits…')
                    prepare_snapshot(source, model['editRevision'], changes, selected, snapshot)
                    log('Outputs to run: ' + '、'.join(item['name'] for item in self.job['outputs']))
                    log('Starting Tableau Prep Builder…')
                    with self.lock:
                        if self.job['cancelRequested']:
                            self.job['state'] = 'cancelled'
                            log('Execution cancelled before startup.')
                            return
                        self.process = subprocess.Popen(command, cwd=Path(source).parent, stdin=subprocess.DEVNULL,
                                                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                                        creationflags=subprocess.CREATE_NO_WINDOW)
                    with self.process as process:
                        while True:
                            raw = process.stdout.readline(65536)
                            if not raw:
                                break
                            try:
                                text = raw.decode('utf-8')
                            except UnicodeDecodeError:
                                text = raw.decode(locale.getpreferredencoding(False), errors='replace')
                            log(text.rstrip('\r\n'))
                        code = process.wait()
                    with self.lock:
                        self.job['exitCode'] = code
                        cancelled = self.job['cancelRequested'] and code != 0
                        self.job['state'] = 'cancelled' if cancelled else 'success' if code == 0 else 'error'
                    if cancelled:
                        log('Execution cancelled. Data already written is not rolled back.', 'warning')
                    else:
                        log('Execution completed.' if code == 0 else f'Execution failed (exit code {code}). Check the log above.', 'info' if code == 0 else 'error')
                except Exception as exc:
                    log(str(exc), 'error')
                    with self.lock:
                        self.job['state'] = 'error'
                finally:
                    try:
                        snapshot.unlink(missing_ok=True)
                    except OSError:
                        log('Could not remove temporary flow: ' + str(snapshot), 'warning')
                    with self.lock:
                        self.job['elapsedMs'] = max(0, int((time.monotonic() - self.started) * 1000))
                        self.job['finishedAt'] = time.time()
                        self.process = None
                        self.job['running'] = False
            self.thread = threading.Thread(target=run, name='Prep flow execution', daemon=True)
            try:
                self.thread.start()
            except Exception:
                snapshot.unlink(missing_ok=True)
                self.job['running'] = False
                self.job['state'] = 'error'
                raise
            return self.status()

    def wait(self):
        if self.thread:
            self.thread.join()
