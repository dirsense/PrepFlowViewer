import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import prepflow


class OpenFolderTests(unittest.TestCase):
    def test_registered_folder_uses_warmed_worker(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / 'space & unicode 日本語'
            folder.mkdir()
            with patch('native_explorer.worker.open') as open_folder:
                prepflow.open_source_folder({'path': folder / 'file.tflx', 'temporary': False})
            open_folder.assert_called_once_with(folder)

    def test_foreground_failure_propagates(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch('native_explorer.worker.open', side_effect=RuntimeError('failed')), self.assertRaises(RuntimeError):
                prepflow.open_source_folder({'path': Path(directory) / 'file.tfl', 'temporary': False})

    def test_missing_or_temporary_sources_cannot_open_other_folders(self):
        with patch('native_explorer.worker.open') as run:
            for info in [None, {'path': prepflow.ROOT / 'file.tfl', 'temporary': True},
                         {'path': prepflow.ROOT / 'missing-folder-test/file.tfl', 'temporary': False}]:
                with self.assertRaises(ValueError):
                    prepflow.open_source_folder(info)
            run.assert_not_called()
