import ctypes
import os
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from native_dialogs import choose_file


@unittest.skipUnless(os.name == 'nt', 'Windows native dialogs')
class NativeDialogTests(unittest.TestCase):
    def library(self, result=False, error=0):
        api = Mock()
        api.GetSaveFileNameW = Mock(return_value=result)
        api.GetOpenFileNameW = Mock(return_value=result)
        api.CommDlgExtendedError = Mock(return_value=error)
        api.GetForegroundWindow = Mock(return_value=9876)
        return api

    def test_save_defaults_unicode_and_native_layout_without_tk(self):
        api = self.library()
        with patch('ctypes.WinDLL', return_value=api), patch.dict('sys.modules', {'tkinter': None}):
            self.assertIsNone(choose_file(title='変更を保存', directory=Path('C:/テスト'), filename='編集.tflx', save=True))
        spec = api.GetSaveFileNameW.call_args.args[0]._obj
        self.assertEqual(spec.lStructSize, 152 if ctypes.sizeof(ctypes.c_void_p) == 8 else 88)
        self.assertEqual(spec.lpstrFile, '編集.tflx')
        self.assertEqual(spec.lpstrInitialDir, str(Path('C:/テスト')))
        self.assertEqual(spec.lpstrDefExt, 'tflx')
        self.assertTrue(spec.Flags & 2)  # native overwrite confirmation
        self.assertTrue(spec.Flags & 8)  # never change the process directory
        self.assertEqual(spec.nMaxFile, 32768)
        self.assertEqual(spec.hwndOwner, 9876)
        api.GetOpenFileNameW.assert_not_called()

    def test_selected_path_and_open_require_existing_file(self):
        api = self.library(result=True)
        with patch('ctypes.WinDLL', return_value=api):
            result = choose_file(title='開く', directory=Path.cwd(), filename='元.tfl')
        self.assertEqual(result, Path('元.tfl').resolve())
        self.assertTrue(api.GetOpenFileNameW.call_args.args[0]._obj.Flags & 0x1000)

    def test_native_failure_is_reportable_instead_of_dropped_connection(self):
        api = self.library(error=0x3002)
        with patch('ctypes.WinDLL', return_value=api):
            with self.assertRaisesRegex(RuntimeError, '0x3002'):
                choose_file(title='保存', directory=Path.cwd(), filename='flow.tflx', save=True)

    def test_dialog_is_raised_after_initialization_even_if_activation_is_denied(self):
        from ctypes import wintypes as w
        api = self.library()
        user32 = Mock()
        user32.GetParent.return_value = 12345
        user32.GetForegroundWindow.return_value = 9876
        user32.SetForegroundWindow.return_value = False

        class Header(ctypes.Structure):
            _fields_ = [('hwndFrom', w.HWND), ('idFrom', ctypes.c_size_t), ('code', w.UINT)]

        def open_dialog(pointer):
            spec = pointer._obj
            self.assertTrue(spec.Flags & 0x20)
            hook = ctypes.WINFUNCTYPE(ctypes.c_size_t, w.HWND, w.UINT, w.WPARAM, w.LPARAM)(spec.lpfnHook)
            hook(11, 0x0110, 0, 0)  # WM_INITDIALOG is too early.
            user32.SetWindowPos.assert_not_called()
            notification = Header(None, 0, ctypes.c_uint(-601).value)
            hook(11, 0x004E, 0, ctypes.addressof(notification))
            user32.SetWindowPos.assert_not_called()
            user32.PostMessageW.assert_called_once_with(11, 0x8001, 0, 0)
            hook(11, 0x8001, 0, 0)
            user32.ShowWindow.assert_called_once_with(12345, 9)
            call = user32.SetWindowPos.call_args.args
            self.assertEqual(call[0], 12345)
            self.assertEqual(call[1].value, ctypes.c_void_p(-1).value)
            self.assertEqual(call[-1], 0x53)  # Show above owner even when activation is denied.
            user32.SetForegroundWindow.assert_called_once_with(12345)
            return False

        api.GetSaveFileNameW.side_effect = open_dialog
        with patch('ctypes.WinDLL', side_effect=lambda name, **kw: user32 if name == 'user32' else api):
            self.assertIsNone(choose_file(title='保存', directory=Path.cwd(), filename='flow.tflx', save=True))
