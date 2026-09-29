"""Windows distribution entry point. No external Python installation is used."""
import argparse
import ctypes
import json
import os
import sys
import queue
import threading
from pathlib import Path

import prepflow


class DesktopServer:
    """Own a separate server, without reusing or stopping a browser session."""
    def __init__(self, source=None, history_path=None):
        self.source, self.history_path = source, history_path
        self.server = None
        self.ready = queue.Queue()
        self.thread = threading.Thread(target=self._run, name='Viewer server')

    def _run(self):
        try:
            prepflow.serve(self.source, 0, False, history_path=self.history_path,
                           on_ready=self._ready)
        except Exception as exc:
            self.ready.put(exc)

    def _ready(self, server, url):
        self.server = server
        self.ready.put(url)

    def start(self):
        self.thread.start()
        result = self.ready.get()
        if isinstance(result, Exception):
            self.thread.join()
            raise result
        return result

    def close(self):
        if self.server:
            self.server.shutdown()
        self.thread.join()


class CloseGuard:
    """Query the page off the UI thread to avoid blocking the native close event."""
    def __init__(self, window):
        self.window = window
        self.allowed = False
        self.checking = False

    def closing(self):
        if self.allowed:
            return True
        if not self.checking:
            self.checking = True
            threading.Thread(target=self._check, name='Viewer close check', daemon=True).start()
        return False

    def _check(self):
        from localization import set_language, translate
        try:
            state = self.window.evaluate_js(
                'typeof viewerCloseState === "function" ? viewerCloseState() : {dirty:false,busy:false}')
            set_language(state.get('language'))
            if state.get('busy'):
                self.window.create_confirmation_dialog('PrepFlow Viewer', translate('処理中です。処理が終わってから閉じてください。'))
                return
            if state.get('dirty') and not self.window.create_confirmation_dialog(
                'PrepFlow Viewer', translate('保存していない編集があります。編集を破棄して終了しますか？')
            ):
                return
            self.allowed = True
            self.window.destroy()
        except Exception:
            if self.window.create_confirmation_dialog(
                'PrepFlow Viewer', translate('画面の状態を確認できませんでした。保存していない編集を破棄して終了しますか？')
            ):
                self.allowed = True
                self.window.destroy()
        finally:
            self.checking = False


class NativeFlowDrop:
    """Use pywebview's native file paths while sharing the normal load/save model."""
    def __init__(self, window, server, url):
        self.window, self.server, self.url = window, server, url.rstrip('/')

    def bind(self):
        from webview.dom import DOMEventHandler
        if self.window.get_current_url().rstrip('/') != self.url:
            return
        self.window.dom.document.events.drop += DOMEventHandler(self.on_drop, prevent_default=True)
        self.window.evaluate_js('nativeDropReady = true')

    def on_drop(self, event):
        files = (event.get('dataTransfer') or {}).get('files') or []
        if not files or self.window.get_current_url().rstrip('/') != self.url:
            return
        if not self.window.evaluate_js('beginNativeFlowDrop()'):
            return
        model, error = None, None
        try:
            path = files[0].get('pywebviewFullPath')
            if not path:
                raise ValueError('元ファイルの場所を取得できませんでした。「フローを開く」から選択してください。')
            model = self.server.open_flow_path(path)
        except Exception as exc:
            error = f'フローを開けませんでした: {exc}'
        self.window.evaluate_js('finishNativeFlowDrop(' + json.dumps(model, ensure_ascii=True)
                                + ',' + json.dumps(error, ensure_ascii=True) + ')')


def main():
    for name in ('stdout', 'stderr'):
        if getattr(sys, name) is None:
            setattr(sys, name, open(os.devnull, 'w', encoding='utf-8'))
    parser = argparse.ArgumentParser(description='PrepFlow Viewer')
    parser.add_argument('flow', nargs='?', type=Path)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--history-file', type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if os.name == 'nt' and getattr(sys, 'frozen', False):
        ctypes.windll.kernel32.SetDllDirectoryW(None)
    if args.flow and not args.flow.is_file():
        raise ValueError('指定されたフローファイルが見つかりません。')
    if args.no_browser:
        prepflow.serve(args.flow, args.port, False, history_path=args.history_file)
        return
    import webview
    webview.settings['ALLOW_DOWNLOADS'] = True
    server = DesktopServer(args.flow, args.history_file)
    url = server.start()
    try:
        window = webview.create_window('PrepFlow Viewer', url, width=1440, height=900,
                                      min_size=(900, 600), text_select=True)
        guard = CloseGuard(window)
        window.events.closing += guard.closing
        drop = NativeFlowDrop(window, server.server, url)
        window.events.loaded += drop.bind
        webview.start(gui='edgechromium', localization={
            'global.ok': 'OK', 'global.cancel': 'キャンセル',
        })
    finally:
        server.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        if os.name == 'nt':
            ctypes.windll.user32.MessageBoxW(None, f'起動できませんでした。\n{exc}', 'PrepFlow Viewer', 0x10)
        else:
            raise
