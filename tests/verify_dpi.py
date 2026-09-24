"""Check the packaged manifest and the DPI context of a real native Viewer window."""
import ctypes
from ctypes import wintypes
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / '.build-tools'))
from build_windows import EXE_NAME
from PyInstaller.utils.win32.winmanifest import read_manifest_from_executable


def verify():
    exe = ROOT / 'dist/PrepFlowViewer' / EXE_NAME
    manifest = ET.fromstring(read_manifest_from_executable(str(exe)))
    ns = {'dpi': 'http://schemas.microsoft.com/SMI/2016/WindowsSettings'}
    assert manifest.find('.//dpi:dpiAwareness', ns).text == 'PerMonitorV2, PerMonitor'

    user32 = ctypes.WinDLL('user32', use_last_error=True)
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowDpiAwarenessContext.argtypes = [wintypes.HWND]
    user32.GetWindowDpiAwarenessContext.restype = ctypes.c_void_p
    user32.AreDpiAwarenessContextsEqual.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    user32.AreDpiAwarenessContextsEqual.restype = wintypes.BOOL
    user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.EnumChildWindows.argtypes = [wintypes.HWND, callback_type, wintypes.LPARAM]

    with tempfile.TemporaryDirectory(prefix='dpi-check-', dir=ROOT / 'output') as folder:
        startup = subprocess.STARTUPINFO()
        startup.dwFlags = subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 0  # Keep this test launch hidden where the UI host permits it.
        process = subprocess.Popen([str(exe), '--history-file', str(Path(folder) / 'recent.json')],
                                   cwd=folder, startupinfo=startup, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            windows = []

            @callback_type
            def find_window(hwnd, _):
                pid = wintypes.DWORD()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                name = ctypes.create_unicode_buffer(256)
                user32.GetClassNameW(hwnd, name, len(name))
                if pid.value == process.pid and name.value.startswith('WindowsForms10.Window'):
                    windows.append(hwnd)
                return True

            @callback_type
            def find_webview(hwnd, _):
                name = ctypes.create_unicode_buffer(256)
                user32.GetClassNameW(hwnd, name, len(name))
                if name.value.startswith('Chrome_WidgetWin'):
                    webviews.append(hwnd)
                return True

            for _ in range(300):
                assert process.poll() is None, 'Native Viewer exited during startup'
                windows.clear()
                user32.EnumWindows(find_window, 0)
                webviews = []
                for hwnd in windows:
                    user32.EnumChildWindows(hwnd, find_webview, 0)
                if webviews:
                    break
                time.sleep(.1)
            else:
                raise AssertionError('Native WebView2 window did not start')
            for hwnd in windows + webviews:
                context = user32.GetWindowDpiAwarenessContext(hwnd)
                assert user32.AreDpiAwarenessContextsEqual(context, ctypes.c_void_p(-4)), 'Expected PerMonitorV2'
            print('Packaged manifest, native window and WebView2: PerMonitorV2 confirmed.')
        finally:
            process.terminate()
            process.wait(timeout=10)


if __name__ == '__main__':
    if os.name != 'nt':
        raise SystemExit('Windows-only verification')
    verify()
