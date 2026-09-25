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
                        raise ValueError('一度に追加できるのは4,096ファイルまでです。リストをクリアしてください。')
                    key = secrets.token_urlsafe(24)
                    self.files[key] = {'path': path, 'name': path.name, 'temporary': False}
                items.append(self.describe(key))
            return items

    def describe(self, key):
        item = self.files[key]
        return {'id': key, 'name': item['name'],
                'location': 'ドロップしたファイル' if item['temporary'] else str(item['path'].parent)}

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
                        raise ValueError('4,096ファイルを超えています。対象フォルダーを絞ってください。')
        return self.add(paths)

    def upload(self, stream, length, filename):
        name = filename.replace('\\', '/').rsplit('/', 1)[-1]
        if not name or Path(name).suffix.lower() not in {'.tfl', '.tflx'}:
            raise ValueError('.tflx または .tfl を選択してください。')
        if not 0 < length <= 2 * 1024**3:
            raise ValueError('空のファイル、または2GBを超えるファイルは追加できません。')
        with self.lock:
            if len(self.files) >= 4096:
                raise ValueError('一度に追加できるのは4,096ファイルまでです。')
            key = secrets.token_urlsafe(24)
            path = self.temporary / (key + Path(name).suffix.lower())
            try:
                with path.open('xb') as output:
                    while length:
                        chunk = stream.read(min(length, 1024**2))
                        if not chunk:
                            raise ValueError('ファイルの受信が途中で終了しました。')
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
            raise ValueError('保存先フォルダーが見つかりません。')
        with self.lock:
            key = secrets.token_urlsafe(24)
            self.destinations[key] = folder
        return {'id': key, 'path': str(folder)}

    def convert(self, key, destination):
        from prepflow import analyze, render_html
        # Serialize conversion/removal. Replace only after the full HTML is written.
        with self.lock:
            item = self.files.get(key)
            folder = self.destinations.get(destination)
            if item is None or folder is None:
                raise ValueError('対象ファイルと保存先を選び直してください。')
            with item['path'].open('rb') as source:
                model = analyze(source, filename=item['name'])
            html = render_html(model)
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
