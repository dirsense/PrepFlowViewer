"""Windows Common Item Dialog (IFileOpenDialog / IFileSaveDialog).

The Shell supplies the current Explorer UI, including search and address bars.
No legacy OPENFILENAME hooks or folder-tree picker are used.
https://learn.microsoft.com/windows/win32/shell/common-file-dialog
"""
import ctypes as c
import os
from pathlib import Path
from uuid import UUID


class GUID(c.Structure):
    _fields_ = [('data', c.c_ubyte * 16)]

    def __init__(self, value):
        super().__init__((c.c_ubyte * 16).from_buffer_copy(UUID(value).bytes_le))


OPEN_CLASS = GUID('DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7')
SAVE_CLASS = GUID('C0B4E2F3-BA21-4773-8DBA-335EC946EB8B')
OPEN_INTERFACE = GUID('D57C7288-D4AD-4768-BE02-9D969532D960')
SAVE_INTERFACE = GUID('84BCCD23-5FDE-4CDB-AEA4-AF64B83D78AB')
SHELL_ITEM = GUID('43826D1E-E718-42EE-BC55-A1E261C37BFE')
OLE_WINDOW = GUID('00000114-0000-0000-C000-000000000046')
CANCELLED = 0x800704C7


def checked(result):
    if result < 0:
        raise OSError(f'Windows file picker failed (0x{result & 0xffffffff:08X}).')
    return result


def call(pointer, slot, types=(), args=(), result=c.c_int32):
    table = c.cast(pointer, c.POINTER(c.POINTER(c.c_void_p))).contents
    method = c.WINFUNCTYPE(result, c.c_void_p, *types)(table[slot])
    return method(pointer, *args)


def release(pointer):
    if pointer:
        call(pointer, 2, result=c.c_ulong)


class FileDialog:
    def __init__(self, save):
        self.ole = c.WinDLL('ole32')
        self.ole.CoInitializeEx.argtypes = [c.c_void_p, c.c_uint32]
        self.ole.CoInitializeEx.restype = c.c_int32
        self.ole.CoCreateInstance.argtypes = [c.POINTER(GUID), c.c_void_p, c.c_uint32, c.POINTER(GUID), c.POINTER(c.c_void_p)]
        self.ole.CoCreateInstance.restype = c.c_int32
        self.ole.CoTaskMemFree.argtypes = [c.c_void_p]
        self.ole.CoUninitialize.argtypes = []
        checked(self.ole.CoInitializeEx(None, 2))  # Each HTTP request runs on its own STA thread.
        self.pointer = c.c_void_p()
        try:
            checked(self.ole.CoCreateInstance(c.byref(SAVE_CLASS if save else OPEN_CLASS), None, 1,
                    c.byref(SAVE_INTERFACE if save else OPEN_INTERFACE), c.byref(self.pointer)))
        except Exception:
            self.ole.CoUninitialize()
            raise

    def close(self):
        release(self.pointer)
        self.ole.CoUninitialize()

    def configure(self, *, title, directory, filename, save, multiple, folder, filetypes):
        flags = c.c_uint32()
        checked(call(self.pointer, 10, [c.POINTER(c.c_uint32)], [c.byref(flags)]))  # GetOptions
        flags.value |= 0x40 | 0x800 | 0x8  # FORCEFILESYSTEM, PATHMUSTEXIST, NOCHANGEDIR
        flags.value |= 0x2 if save else 0x1000  # OVERWRITEPROMPT / FILEMUSTEXIST
        if multiple:
            flags.value |= 0x200
        if folder:
            flags.value |= 0x20  # FOS_PICKFOLDERS: Explorer UI, not a folder tree.
        checked(call(self.pointer, 9, [c.c_uint32], [flags.value]))
        checked(call(self.pointer, 17, [c.c_wchar_p], [title]))
        if not folder:
            class Filter(c.Structure):
                _fields_ = [('name', c.c_wchar_p), ('pattern', c.c_wchar_p)]
            extension = Path(filename).suffix or '.tflx'
            filters = filetypes or [('Tableau Prep', '*' + extension if save else '*.tflx;*.tfl')]
            specs = (Filter * len(filters))(*(Filter(name, pattern.replace(' ', ';')) for name, pattern in filters))
            checked(call(self.pointer, 4, [c.c_uint32, c.POINTER(Filter)], [len(specs), specs]))
            checked(call(self.pointer, 5, [c.c_uint32], [1]))
            if filename:
                checked(call(self.pointer, 15, [c.c_wchar_p], [filename]))
            checked(call(self.pointer, 22, [c.c_wchar_p], [extension.lstrip('.')]))
        if directory and Path(directory).is_dir():
            shell = c.WinDLL('shell32')
            shell.SHCreateItemFromParsingName.argtypes = [c.c_wchar_p, c.c_void_p, c.POINTER(GUID), c.POINTER(c.c_void_p)]
            shell.SHCreateItemFromParsingName.restype = c.c_int32
            item = c.c_void_p()
            checked(shell.SHCreateItemFromParsingName(str(Path(directory).resolve()), None, c.byref(SHELL_ITEM), c.byref(item)))
            try:
                checked(call(self.pointer, 11, [c.c_void_p], [item]))  # SetDefaultFolder preserves last-used folders.
            finally:
                release(item)

    def show(self):
        user = c.WinDLL('user32')
        user.GetForegroundWindow.restype = c.c_void_p
        user.GetWindowThreadProcessId.argtypes = [c.c_void_p, c.POINTER(c.c_uint32)]
        user.SetForegroundWindow.argtypes = [c.c_void_p]
        user.ShowWindow.argtypes = [c.c_void_p, c.c_int]
        user.SetWindowPos.argtypes = [c.c_void_p, c.c_void_p, c.c_int, c.c_int, c.c_int, c.c_int, c.c_uint32]
        timer_type = c.WINFUNCTYPE(None, c.c_void_p, c.c_uint32, c.c_size_t, c.c_uint32)
        user.SetTimer.argtypes = [c.c_void_p, c.c_size_t, c.c_uint32, timer_type]
        user.SetTimer.restype = c.c_size_t
        user.KillTimer.argtypes = [c.c_void_p, c.c_size_t]
        window_interface = c.c_void_p()
        checked(call(self.pointer, 0, [c.POINTER(GUID), c.POINTER(c.c_void_p)],
                     [c.byref(OLE_WINDOW), c.byref(window_interface)]))
        raised = False

        @timer_type
        def raise_dialog(_window, _message, _timer, _time):
            nonlocal raised
            if raised:
                return
            handle = c.c_void_p()
            if call(window_interface, 3, [c.POINTER(c.c_void_p)], [c.byref(handle)]) >= 0 and handle.value:
                # Show after the background process's STARTUPINFO/SW_HIDE is consumed.
                user.ShowWindow(handle, 9)
                user.SetWindowPos(handle, c.c_void_p(-1), 0, 0, 0, 0, 0x53)
                user.SetForegroundWindow(handle)
                raised = True

        timer = user.SetTimer(None, 0, 100, raise_dialog)
        try:
            owner = user.GetForegroundWindow()
            process = c.c_uint32()
            user.GetWindowThreadProcessId(owner, c.byref(process))
            # Own the EXE's window, but never disable another application's UI
            # when a browser calls the local server in a separate process.
            if process.value != os.getpid():
                owner = None
            result = call(self.pointer, 3, [c.c_void_p], [owner])
            if result & 0xffffffff == CANCELLED:
                return False
            checked(result)
            return True
        finally:
            if timer:
                user.KillTimer(None, timer)
            release(window_interface)

    def item_path(self, item):
        value = c.c_void_p()
        checked(call(item, 5, [c.c_uint32, c.POINTER(c.c_void_p)], [0x80058000, c.byref(value)]))
        try:
            return Path(c.wstring_at(value)).resolve()
        finally:
            self.ole.CoTaskMemFree(value)

    def results(self, multiple):
        result = c.c_void_p()
        checked(call(self.pointer, 27 if multiple else 20, [c.POINTER(c.c_void_p)], [c.byref(result)]))
        try:
            if not multiple:
                return self.item_path(result)
            count = c.c_uint32()
            checked(call(result, 7, [c.POINTER(c.c_uint32)], [c.byref(count)]))
            paths = []
            for index in range(count.value):
                item = c.c_void_p()
                checked(call(result, 8, [c.c_uint32, c.POINTER(c.c_void_p)], [index, c.byref(item)]))
                try:
                    paths.append(self.item_path(item))
                finally:
                    release(item)
            return paths
        finally:
            release(result)


def choose(*, title, directory=None, filename='', save=False, multiple=False, folder=False, filetypes=None):
    dialog = FileDialog(save)
    try:
        dialog.configure(title=title, directory=directory, filename=filename, save=save,
                         multiple=multiple, folder=folder, filetypes=filetypes)
        return dialog.results(multiple) if dialog.show() else None
    finally:
        dialog.close()
