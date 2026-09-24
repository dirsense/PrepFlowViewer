import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.request import urlopen

from desktop_launcher import CloseGuard, DesktopServer, NativeFlowDrop
from recent_flows import RecentFlows


class DesktopLifecycleTests(unittest.TestCase):
    def test_native_drop_keeps_path_history_and_registered_save_source(self):
        with tempfile.TemporaryDirectory() as folder, patch('native_explorer.worker'):
            root = Path(folder)
            source = root / '日本語 フロー.tfl'
            source.write_text('{"nodes": {}}', encoding='utf-8')
            history = root / 'recent.json'
            server = DesktopServer(history_path=history)
            url = server.start()
            try:
                window = Mock()
                window.get_current_url.return_value = url + '/'
                window.evaluate_js.return_value = True
                NativeFlowDrop(window, server.server, url).on_drop({
                    'dataTransfer': {'files': [{'name': source.name, 'pywebviewFullPath': str(source)}]}})
                script = window.evaluate_js.call_args.args[0]
                # JSON arguments remain literal even for non-ASCII paths.
                model, error = json.loads('[' + script.removeprefix('finishNativeFlowDrop(')[:-1] + ']')
                self.assertIsNone(error)
                self.assertEqual(model['sourcePath'], str(source.resolve()))
                self.assertTrue(model['editRevision'])
                self.assertTrue(model['exportKey'])
                self.assertEqual(RecentFlows(history).list()[0]['path'], str(source.resolve()))
                with urlopen(url, timeout=3) as response:
                    html = response.read().decode()
                opened = json.loads(re.search(r'<script id="flow-data" type="application/json">(.*?)</script>', html, re.S)[1])
                self.assertEqual(opened['sourcePath'], str(source.resolve()))
                self.assertEqual(source.read_text(encoding='utf-8'), '{"nodes": {}}')
                with self.assertRaises(ValueError):
                    server.server.open_flow_path(root / 'unsupported.txt')
                with self.assertRaises(ValueError):
                    server.server.open_flow_path(root / 'missing.tflx')
            finally:
                server.close()

    def test_native_drop_missing_path_error_and_busy_guard(self):
        window, server = Mock(), Mock()
        window.get_current_url.return_value = 'http://127.0.0.1:1234/'
        window.evaluate_js.return_value = True
        drop = NativeFlowDrop(window, server, 'http://127.0.0.1:1234')
        drop.on_drop({'dataTransfer': {'files': [{'name': 'test.tflx'}]}})
        server.open_flow_path.assert_not_called()
        self.assertIn('finishNativeFlowDrop(null,', window.evaluate_js.call_args.args[0])
        window.reset_mock()
        window.evaluate_js.return_value = False
        drop.on_drop({'dataTransfer': {'files': [{'pywebviewFullPath': 'test.tflx'}]}})
        server.open_flow_path.assert_not_called()
        window.evaluate_js.assert_called_once_with('beginNativeFlowDrop()')
        window.reset_mock()
        window.get_current_url.return_value = 'https://example.com'
        drop.on_drop({'dataTransfer': {'files': [{'pywebviewFullPath': 'test.tflx'}]}})
        window.evaluate_js.assert_not_called()

    def test_server_lifetime_closes_listener_and_helper(self):
        with tempfile.TemporaryDirectory() as folder, patch('native_explorer.worker') as worker:
            server = DesktopServer(history_path=Path(folder) / 'recent.json')
            url = server.start()
            with urlopen(url + '/health', timeout=3) as response:
                self.assertEqual(json.load(response)['app'], 'PrepFlowViewer')
            server.close()
            self.assertFalse(server.thread.is_alive())
            worker.close.assert_called_once()
            with self.assertRaises(OSError):
                urlopen(url + '/health', timeout=1)

    def test_startup_error_is_propagated_without_orphan_thread(self):
        with patch('prepflow.serve', side_effect=RuntimeError('test failure')):
            server = DesktopServer()
            with self.assertRaisesRegex(RuntimeError, 'test failure'):
                server.start()
            self.assertFalse(server.thread.is_alive())

    def test_unmodified_window_closes_without_prompt(self):
        window = Mock()
        window.evaluate_js.return_value = {'dirty': False, 'busy': False}
        guard = CloseGuard(window)
        guard._check()
        window.destroy.assert_called_once()
        window.create_confirmation_dialog.assert_not_called()
        self.assertTrue(guard.closing())

    def test_unsaved_cancel_keeps_window_and_save_blocks_close(self):
        for state in ({'dirty': True, 'busy': False}, {'dirty': True, 'busy': True}):
            window = Mock()
            window.evaluate_js.return_value = state
            window.create_confirmation_dialog.return_value = False
            guard = CloseGuard(window)
            guard._check()
            window.destroy.assert_not_called()
            self.assertFalse(guard.allowed)
            self.assertFalse(guard.checking)

    def test_unsaved_discard_closes(self):
        window = Mock()
        window.evaluate_js.return_value = {'dirty': True, 'busy': False}
        window.create_confirmation_dialog.return_value = True
        CloseGuard(window)._check()
        window.destroy.assert_called_once()


if __name__ == '__main__':
    unittest.main()
