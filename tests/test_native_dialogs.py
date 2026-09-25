import ctypes as c
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from native_dialogs import choose_file, choose_directory
from windows_file_dialog import FileDialog, call, choose


@unittest.skipUnless(os.name == 'nt', 'Windows Common Item Dialog')
class NativeDialogTests(unittest.TestCase):
    def test_real_modern_dialog_options_and_unicode_names(self):
        for save, multiple, folder in [(False, False, False), (False, True, False), (True, False, False), (False, False, True)]:
            with self.subTest(save=save, multiple=multiple, folder=folder):
                dialog = FileDialog(save)
                try:
                    dialog.configure(title='選択', directory=Path.cwd(), filename='日本語.html' if save else '',
                                     save=save, multiple=multiple, folder=folder,
                                     filetypes=[('HTML ファイル', '*.html')] if save else None)
                    flags = c.c_uint32()
                    self.assertEqual(call(dialog.pointer, 10, [c.POINTER(c.c_uint32)], [c.byref(flags)]), 0)
                    self.assertTrue(flags.value & 0x40)  # Filesystem paths, not virtual Shell items.
                    self.assertTrue(flags.value & 0x800)
                    self.assertEqual(bool(flags.value & 0x200), multiple)
                    self.assertEqual(bool(flags.value & 0x20), folder)
                    if save:
                        self.assertTrue(flags.value & 2)  # Confirm overwrites.
                        name = c.c_void_p()
                        self.assertEqual(call(dialog.pointer, 16, [c.POINTER(c.c_void_p)], [c.byref(name)]), 0)
                        try:
                            self.assertEqual(c.wstring_at(name), '日本語.html')
                        finally:
                            dialog.ole.CoTaskMemFree(name)
                finally:
                    dialog.close()

    def test_cancel_and_error_release_resources(self):
        for outcome in [False, OSError('failed')]:
            dialog = Mock()
            if isinstance(outcome, Exception):
                dialog.show.side_effect = outcome
            else:
                dialog.show.return_value = outcome
            with patch('windows_file_dialog.FileDialog', return_value=dialog):
                if isinstance(outcome, Exception):
                    with self.assertRaises(OSError):
                        choose(title='開く')
                else:
                    self.assertIsNone(choose(title='開く'))
            dialog.results.assert_not_called()
            dialog.close.assert_called_once()

    def test_all_picker_entry_points_use_common_dialog(self):
        with patch('windows_file_dialog.FileDialog') as factory:
            dialog = factory.return_value
            paths = [Path('C:/日本語/一.tfl'), Path('C:/日本語/二.tflx')]
            dialog.results.return_value = paths
            self.assertEqual(choose_file(title='複数', directory=Path.cwd(), multiple=True), paths)
            dialog.results.assert_called_with(True)
            self.assertTrue(dialog.configure.call_args.kwargs['multiple'])
            choose_directory(title='保存先')
            self.assertTrue(dialog.configure.call_args.kwargs['folder'])
            choose_file(title='HTMLを保存', directory=Path.cwd(), filename='保存.html', save=True, filetypes=[('HTML', '*.html')])
            factory.assert_called_with(True)
            self.assertEqual(dialog.configure.call_args.kwargs['filetypes'], [('HTML', '*.html')])


if __name__ == '__main__':
    unittest.main()
