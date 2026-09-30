import tempfile
import unittest
import zipfile
from pathlib import Path

from build_windows import public_archive


class PublicArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.package = root / 'package'
        self.dist = root / 'dist'
        self.package.mkdir()
        for name in ('PrepFlowViewer_v1.0.exe', '_internal/python313.dll',
                     '_internal/web/assets.json', '操作ガイド.html', 'はじめに.txt',
                     'publish.example.ini', 'Python-LICENSE.txt', 'licenses/dependency/LICENSE'):
            file = self.package / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(name, encoding='utf-8')

    def test_one_unencrypted_zip_contains_application_guides_and_licenses(self):
        for name in ('publish.ini', 'build-password.txt', 'private-flow.tflx'):
            (self.package / name).write_text('local-only', encoding='utf-8')
        result = public_archive(self.package, self.dist, '1.0')
        self.assertEqual(result.name, 'PrepFlowViewer-v1.0-Windows-x64.zip')
        with zipfile.ZipFile(result) as archive:
            names = archive.namelist()
            for name in ('PrepFlowViewer_v1.0.exe', '_internal/python313.dll',
                         '_internal/web/assets.json', '操作ガイド.html', 'はじめに.txt',
                         'publish.example.ini', 'Python-LICENSE.txt', 'licenses/dependency/LICENSE'):
                self.assertIn('PrepFlowViewer/' + name, names)
            self.assertFalse(any(info.flag_bits & 1 for info in archive.infolist()))
            self.assertFalse(any('local-only' in archive.read(name).decode('utf-8') for name in names))
            self.assertIsNone(archive.testzip())

    def test_rebuild_replaces_archive_without_retaining_old_members(self):
        result = public_archive(self.package, self.dist, '1.0')
        with zipfile.ZipFile(result, 'a') as archive:
            archive.writestr('old-file.txt', 'old')
        public_archive(self.package, self.dist, '1.0')
        with zipfile.ZipFile(result) as archive:
            self.assertNotIn('old-file.txt', archive.namelist())

    def test_missing_guide_keeps_previous_archive_intact(self):
        result = public_archive(self.package, self.dist, '1.0')
        previous = result.read_bytes()
        (self.package / '操作ガイド.html').unlink()
        with self.assertRaises(RuntimeError):
            public_archive(self.package, self.dist, '1.0')
        self.assertEqual(result.read_bytes(), previous)


if __name__ == '__main__':
    unittest.main()
