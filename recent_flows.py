"""Persistent, bounded history of actual flow files (never upload temp files)."""
import hashlib
import json
import os
import threading
from pathlib import Path


class RecentFlows:
    def __init__(self, storage=None):
        self.storage = Path(storage) if storage else Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local/share")) / "PrepFlowViewer/recent-flows.json"
        self.lock = threading.RLock()

    @staticmethod
    def identity(path):
        return hashlib.sha256(os.path.normcase(str(Path(path).resolve())).encode("utf-8")).hexdigest()

    def _write(self, paths):
        self.storage.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.storage.with_suffix(".tmp")
        temporary.write_text(json.dumps(paths, ensure_ascii=False), encoding="utf-8")
        temporary.replace(self.storage)

    def list(self):
        with self.lock:
            try:
                stored = json.loads(self.storage.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                stored = []
            if not isinstance(stored, list):
                stored = []
            paths, seen = [], set()
            for value in stored:
                if not isinstance(value, str):
                    continue
                path = Path(value)
                try:
                    if not path.is_absolute() or path.suffix.lower() not in {".tfl", ".tflx"} or not path.is_file():
                        continue
                    key = self.identity(path)
                    if key not in seen:
                        paths.append(str(path.resolve()))
                        seen.add(key)
                except OSError:
                    continue
                if len(paths) == 10:
                    break
            if stored != paths:
                self._write(paths)
            return [{"id": self.identity(p), "name": Path(p).name, "path": p} for p in paths]

    def add(self, path):
        with self.lock:
            path = Path(path).resolve()
            if not path.is_file():
                return
            key = self.identity(path)
            paths = [str(path)] + [x["path"] for x in self.list() if x["id"] != key]
            self._write(paths[:10])

    def find(self, key):
        return next((Path(x["path"]) for x in self.list() if x["id"] == key), None)
