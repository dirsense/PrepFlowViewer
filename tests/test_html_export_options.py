import copy
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from desktop_launcher import DesktopServer
from localization import set_language
from prepflow import empty_model, html_export_options, render_html


def embedded_json(page, name):
    return json.loads(re.search(r'<script id="' + name + r'" type="application/json">(.*?)</script>', page, re.S)[1])


def catalogs(page):
    return json.loads(re.search(r'const UI_CATALOGS = (.*?);\n', page)[1])


class HtmlExportOptionsTests(unittest.TestCase):
    def tearDown(self):
        set_language('ja')

    def test_bundles_only_selected_languages_and_preserves_flow(self):
        model = empty_model()
        model['name'] = 'English</script>日本語.tfl'
        original = copy.deepcopy(model)
        sizes = []
        for languages, switcher in [(['ja'], False), (['fr'], False), (['ja', 'en'], True)]:
            options = {'languages': languages, 'showSwitcher': switcher, 'defaultLanguage': languages[0]}
            page = render_html(model, options)
            self.assertEqual(set(catalogs(page)), set(languages) - {'ja'})
            self.assertEqual(re.findall(r'<button role="menuitemradio" data-language="([^"]+)"', page), languages)
            self.assertEqual('class="language-picker" hidden' in page, not switcher)
            self.assertIn(f'<html lang="{languages[0]}"', page)
            self.assertEqual(embedded_json(page, 'flow-data'), model)
            sizes.append(len(page.encode()))
        self.assertLess(sizes[0], sizes[1])
        self.assertEqual(model, original)

    def test_validation_single_multiple_default_and_invalid_selections(self):
        set_language('es')
        self.assertEqual(html_export_options(None), {'languages': ['es'], 'defaultLanguage': 'es', 'showSwitcher': False})
        self.assertEqual(html_export_options({'languages': ['ja', 'en'], 'showSwitcher': True})['defaultLanguage'], 'ja')
        for options in [[], {}, {'languages': []}, {'languages': ['xx']}, {'languages': [['en']]},
                        {'languages': ['ja', 'en'], 'showSwitcher': False},
                        {'languages': ['ja'], 'showSwitcher': 'true'}]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                html_export_options(options)

    def test_single_selection_and_batch_share_settings_without_replacing_open_flow(self):
        with tempfile.TemporaryDirectory() as folder, patch('native_explorer.worker'):
            root = Path(folder)
            current, other = root / 'current.tfl', root / 'other.tfl'
            for path in (current, other):
                path.write_text('{"nodes": {}}', encoding='utf-8')
            server = DesktopServer(current, history_path=root / 'recent.json')
            base = server.start()
            try:
                page = urlopen(base).read().decode()
                token = embedded_json(page, 'server-config')['token']
                def post(route, data):
                    return json.load(urlopen(Request(base + route, data=json.dumps(data).encode(),
                        headers={'Origin': base, 'X-Viewer-Token': token, 'X-Viewer-Language': 'ja'})))
                with patch('native_dialogs.choose_file', return_value=None):
                    self.assertTrue(post('/api/batch/file', {})['cancelled'])
                with patch('native_dialogs.choose_file', return_value=other):
                    chosen = post('/api/batch/file', {})
                options = {'languages': ['fr', 'es'], 'showSwitcher': True, 'defaultLanguage': 'fr'}
                target = root / 'single.html'
                with patch('native_dialogs.choose_file', return_value=target):
                    post('/api/save-html', {'sourceId': chosen['id'], 'htmlOptions': options})
                single = target.read_text(encoding='utf-8')
                self.assertEqual(set(catalogs(single)), {'fr', 'es'})
                self.assertEqual(embedded_json(single, 'flow-data')['name'], 'other.tfl')
                with patch('native_dialogs.choose_directory', return_value=root):
                    destination = post('/api/batch/destination', {})
                post('/api/batch/convert', {'id': chosen['id'], 'destination': destination['id'], 'htmlOptions': options})
                batch = (root / 'other.html').read_text(encoding='utf-8')
                self.assertEqual(catalogs(single), catalogs(batch))
                with patch('native_dialogs.choose_file') as picker:
                    with self.assertRaises(HTTPError):
                        post('/api/save-html', {'sourceId': chosen['id'], 'htmlOptions': {'languages': []}})
                    with self.assertRaises(HTTPError):
                        post('/api/save-html', {'sourceId': 'unknown'})
                    picker.assert_not_called()
                self.assertEqual(embedded_json(urlopen(base).read().decode(), 'flow-data')['name'], 'current.tfl')
            finally:
                server.close()
