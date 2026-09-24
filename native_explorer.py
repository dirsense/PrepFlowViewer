"""One warmed, hidden Shell worker per Viewer, with bounded request waits."""
import atexit
import json
import os
import queue
import subprocess
import threading
from pathlib import Path


class ExplorerWorker:
    def __init__(self):
        self.lock = threading.RLock()
        self.process = None
        self.lines = None

    def close(self):
        with self.lock:
            process, self.process = self.process, None
            if process:
                process.kill() if process.poll() is None else None
                process.wait(timeout=5)
                process.stdin.close()
                process.stdout.close()

    def start(self):
        with self.lock:
            if self.process and self.process.poll() is None:
                return
            self.close()
            self.lines = queue.Queue()
            self.process = subprocess.Popen(
                ['powershell.exe', '-NoProfile', '-NonInteractive', '-STA', '-File',
                 str(Path(__file__).with_name('open_folder.ps1'))],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                encoding='utf-8', creationflags=subprocess.CREATE_NO_WINDOW,
                cwd=os.environ.get('SystemRoot', r'C:\Windows'),
            )
            def read_lines(process, lines):
                for line in process.stdout:
                    lines.put(line.strip())
                lines.put(None)
            threading.Thread(target=read_lines, args=(self.process, self.lines), daemon=True).start()
            try:
                if self.lines.get(timeout=15) != 'ready':
                    raise RuntimeError('Explorer helper did not start')
            except Exception:
                self.close()
                raise

    def open(self, folder):
        with self.lock:
            try:
                self.start()
                self.process.stdin.write(json.dumps({'folder': str(folder)}, ensure_ascii=True) + '\n')
                self.process.stdin.flush()
                result = self.lines.get(timeout=15)
                if not result or not json.loads(result).get('ok'):
                    raise RuntimeError('Explorer was not activated')
            except (OSError, ValueError, RuntimeError, queue.Empty) as exc:
                self.close()
                raise RuntimeError('保存場所を前面に表示できませんでした。もう一度お試しください。') from exc

    def warm(self):
        def prepare():
            try:
                self.start()
            except Exception:
                pass  # A click will retry and report an actionable error.
        threading.Thread(target=prepare, daemon=True).start()


worker = ExplorerWorker()
atexit.register(worker.close)
