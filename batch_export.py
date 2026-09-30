"""Session-scoped selections and standalone HTML batch exports."""
import os
import secrets
import threading
import tempfile
from pathlib import Path


class BatchExport:
    def __init__(self, temporary):
        self.temporary = Path(temporary)
        self.files = {}
        self.destinations = {}
        self.lock = threading.RLock()

    def add(self, paths):
        with self.lock:
            items = []
            for path in paths:
                path = Path(path).resolve()
                if path.suffix.lower() not in {'.tfl', '.tflx'} or not path.is_file():
                    continue
                key = next((k for k, item in self.files.items() if item['path'] == path), None)
                if key is None:
                    if len(self.files) >= 4096:
                        raise ValueError('You can add up to 4,096 files at a time. Clear the list first.')
                    key = secrets.token_urlsafe(24)
                    self.files[key] = {'path': path, 'name': path.name, 'temporary': False}
                items.append(self.describe(key))
            return items

    def describe(self, key):
        item = self.files[key]
        return {'id': key, 'name': item['name'],
                'location': 'Dropped file' if item['temporary'] else str(item['path'].parent)}

    def folder(self, folder, recursive=True):
        def report_error(error):
            raise error

        paths = []
        for directory, subdirs, files in os.walk(folder, followlinks=False,
                                                onerror=report_error):
            subdirs[:] = sorted(d for d in subdirs if not (Path(directory) / d).is_symlink()) if recursive else []
            for name in sorted(files):
                if Path(name).suffix.lower() in {'.tfl', '.tflx'}:
                    paths.append(Path(directory) / name)
                    if len(paths) > 4096:
                        raise ValueError('More than 4,096 files found. Select a smaller folder.')
        return self.add(paths)

    def upload(self, stream, length, filename):
        name = filename.replace('\\', '/').rsplit('/', 1)[-1]
        if not name or Path(name).suffix.lower() not in {'.tfl', '.tflx'}:
            raise ValueError('Select a .tflx or .tfl file.')
        if not 0 < length <= 2 * 1024**3:
            raise ValueError('Cannot add empty files or files larger than 2 GB.')
        with self.lock:
            if len(self.files) >= 4096:
                raise ValueError('You can add up to 4,096 files at a time.')
            key = secrets.token_urlsafe(24)
            path = self.temporary / (key + Path(name).suffix.lower())
            try:
                with path.open('xb') as output:
                    while length:
                        chunk = stream.read(min(length, 1024**2))
                        if not chunk:
                            raise ValueError('File transfer ended unexpectedly.')
                        output.write(chunk)
                        length -= len(chunk)
                self.files[key] = {'path': path, 'name': name, 'temporary': True}
                return self.describe(key)
            except Exception:
                path.unlink(missing_ok=True)
                raise

    def remove(self, keys):
        with self.lock:
            for key in keys:
                item = self.files.pop(key, None)
                if item and item['temporary']:
                    item['path'].unlink(missing_ok=True)

    def destination(self, folder):
        folder = Path(folder).resolve()
        if not folder.is_dir():
            raise ValueError('Destination folder not found.')
        with self.lock:
            key = secrets.token_urlsafe(24)
            self.destinations[key] = folder
        return {'id': key, 'path': str(folder)}

    def model(self, key):
        from prepflow import analyze
        with self.lock:
            item = self.files.get(key)
            if item is None:
                raise ValueError('Select the files and destination again.')
            with item['path'].open('rb') as source:
                model = analyze(source, filename=item['name'])
            if not item['temporary']:
                model['sourcePath'] = str(item['path'])
            return model

    def convert(self, key, destination, html_options=None):
        from prepflow import render_html, html_export_options
        # Serialize conversion/removal. Replace only after the full HTML is written.
        with self.lock:
            item = self.files.get(key)
            folder = self.destinations.get(destination)
            if item is None or folder is None:
                raise ValueError('Select the files and destination again.')
            model = self.model(key)
            html = render_html(model, html_export_options(html_options))
            name = Path(item['name']).stem + '.html'
            output = folder / name
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=folder,
                                                 prefix='.prepflow-', suffix='.tmp', delete=False) as handle:
                    temporary = Path(handle.name)
                    handle.write(html)
                temporary.replace(output)
            finally:
                if temporary:
                    temporary.unlink(missing_ok=True)
            return {'name': name, 'path': str(output)}
