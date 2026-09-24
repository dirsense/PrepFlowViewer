"""System file pickers; Windows uses its native API without Tcl/Tk."""
import os
from pathlib import Path


def choose_file(*, title, directory, filename="", save=False):
    if os.name != "nt":
        import tkinter as tk
        from tkinter import filedialog
        window = None
        try:
            window = tk.Tk()
            window.withdraw()
            window.attributes("-topmost", True)
            options = dict(parent=window, title=title, initialdir=str(directory),
                           filetypes=[("Tableau Prep", "*.tflx *.tfl")])
            if save:
                options.update(initialfile=filename, defaultextension=Path(filename).suffix,
                               confirmoverwrite=True)
            value = (filedialog.asksaveasfilename if save else filedialog.askopenfilename)(**options)
            return Path(value).resolve() if value else None
        except tk.TclError as exc:
            raise RuntimeError("ファイル選択画面を開けませんでした。") from exc
        finally:
            if window is not None:
                window.destroy()

    import ctypes
    from ctypes import wintypes as w

    class OpenFileName(ctypes.Structure):
        _fields_ = [
            ("lStructSize", w.DWORD), ("hwndOwner", w.HWND), ("hInstance", w.HINSTANCE),
            ("lpstrFilter", w.LPCWSTR), ("lpstrCustomFilter", w.LPWSTR),
            ("nMaxCustFilter", w.DWORD), ("nFilterIndex", w.DWORD),
            ("lpstrFile", w.LPWSTR), ("nMaxFile", w.DWORD),
            ("lpstrFileTitle", w.LPWSTR), ("nMaxFileTitle", w.DWORD),
            ("lpstrInitialDir", w.LPCWSTR), ("lpstrTitle", w.LPCWSTR),
            ("Flags", w.DWORD), ("nFileOffset", w.WORD), ("nFileExtension", w.WORD),
            ("lpstrDefExt", w.LPCWSTR), ("lCustData", w.LPARAM),
            ("lpfnHook", ctypes.c_void_p), ("lpTemplateName", w.LPCWSTR),
            ("pvReserved", ctypes.c_void_p), ("dwReserved", w.DWORD), ("FlagsEx", w.DWORD),
        ]

    class NotificationHeader(ctypes.Structure):
        _fields_ = [("hwndFrom", w.HWND), ("idFrom", ctypes.c_size_t), ("code", w.UINT)]

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.GetParent.argtypes = [w.HWND]
    user32.GetParent.restype = w.HWND
    user32.SetWindowPos.argtypes = [w.HWND, w.HWND, ctypes.c_int, ctypes.c_int,
                                    ctypes.c_int, ctypes.c_int, w.UINT]
    user32.SetWindowPos.restype = w.BOOL
    user32.SetForegroundWindow.argtypes = [w.HWND]
    user32.SetForegroundWindow.restype = w.BOOL
    user32.ShowWindow.argtypes = [w.HWND, ctypes.c_int]
    user32.ShowWindow.restype = w.BOOL
    user32.PostMessageW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM]
    user32.PostMessageW.restype = w.BOOL
    user32.GetForegroundWindow.argtypes = []
    user32.GetForegroundWindow.restype = w.HWND
    user32.IsWindowVisible.argtypes = [w.HWND]
    user32.IsWindowVisible.restype = w.BOOL
    user32.GetWindowRect.argtypes = [w.HWND, ctypes.POINTER(w.RECT)]
    user32.GetWindowRect.restype = w.BOOL
    owner = user32.GetForegroundWindow()
    hook_type = ctypes.WINFUNCTYPE(ctypes.c_size_t, w.HWND, w.UINT, w.WPARAM, w.LPARAM)

    @hook_type
    def foreground_dialog(child, message, _wparam, lparam):
        # Defer until the initial ShowWindow has consumed STARTUPINFO/SW_HIDE.
        # Raising inside CDN_INITDONE is too early: the standard dialog can hide
        # itself afterwards when its server was launched as a background process.
        if message == 0x004E and lparam:
            notification = ctypes.cast(lparam, ctypes.POINTER(NotificationHeader)).contents
            if notification.code == ctypes.c_uint(-601).value:
                user32.PostMessageW(child, 0x8001, 0, 0)
        elif message == 0x8001:
            dialog = user32.GetParent(child)
            if dialog:
                user32.ShowWindow(dialog, 9)  # SW_RESTORE, including minimized dialogs.
                # Z-order visibility must not depend on foreground activation being
                # permitted for this background HTTP-server process.
                raised = user32.SetWindowPos(dialog, w.HWND(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 | 0x0040)
                activated = user32.SetForegroundWindow(dialog)
                rect = w.RECT()
                user32.GetWindowRect(dialog, ctypes.byref(rect))
                # Diagnostic metadata only: no paths, filenames, or formula text.
                print('File picker display:', {'owned': bool(owner), 'raised': bool(raised),
                      'activated': bool(activated), 'foreground': user32.GetForegroundWindow() == dialog,
                      'visible': bool(user32.IsWindowVisible(dialog)),
                      'bounds': [rect.left, rect.top, rect.right, rect.bottom]}, flush=True)
        return 0

    buffer = ctypes.create_unicode_buffer(filename, 32768)
    extension = Path(filename).suffix or ".tflx"
    pattern = "*" + extension if save else "*.tflx;*.tfl"
    spec = OpenFileName()
    spec.lStructSize = ctypes.sizeof(spec)
    # An owned dialog remains above the browser that initiated the request.
    # Without an owner, Windows treats this as a background app stealing focus.
    spec.hwndOwner = owner
    spec.lpstrFilter = f"Tableau Prep ({pattern})\0{pattern}\0\0"
    spec.nFilterIndex = 1
    spec.lpstrFile = ctypes.cast(buffer, w.LPWSTR)
    spec.nMaxFile = len(buffer)
    spec.lpstrInitialDir = str(directory)
    spec.lpstrTitle = title
    spec.lpstrDefExt = extension.lstrip(".")
    # Explorer style, existing folder, and no process-wide current-directory changes.
    spec.Flags = 0x00080000 | 0x00000800 | 0x00000008 | 0x00000020 | (0x00000002 if save else 0x00001000)
    # Keep the callback alive locally until the modal picker has returned.
    spec.lpfnHook = ctypes.cast(foreground_dialog, ctypes.c_void_p)
    library = ctypes.WinDLL("comdlg32", use_last_error=True)
    picker = library.GetSaveFileNameW if save else library.GetOpenFileNameW
    picker.argtypes = [ctypes.POINTER(OpenFileName)]
    picker.restype = w.BOOL
    library.CommDlgExtendedError.argtypes = []
    library.CommDlgExtendedError.restype = w.DWORD
    if picker(ctypes.byref(spec)):
        return Path(buffer.value).resolve()
    error = library.CommDlgExtendedError()
    if error:
        raise RuntimeError(f"ファイル選択画面を開けませんでした（Windows: {error:#x}）。")
    return None
