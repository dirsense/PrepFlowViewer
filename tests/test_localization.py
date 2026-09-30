import json
import re
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from html.parser import HTMLParser
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from desktop_launcher import DesktopServer
from localization import (LanguagePreference, english_catalog, translation_catalog,
                          SUPPORTED_LANGUAGES, language, set_language, translate, preferred_language)
from prepflow import empty_model, render_html


class LocalizationTests(unittest.TestCase):
    def tearDown(self):
        set_language('en')

    def test_export_is_self_contained_and_preserves_model(self):
        model = empty_model()
        model['name'] = 'Calculated field</script>.tfl'
        before = json.dumps(model, ensure_ascii=False)
        set_language('en')
        html = render_html(model)
        self.assertIn('data-language="en"', html)
        choices = re.findall(r'<button role="menuitemradio" data-language="([^"]+)"', html)
        self.assertEqual(choices, list(SUPPORTED_LANGUAGES),
                         'The export language must not overwrite the Japanese menu choice')
        self.assertIn('<html lang="en"', html)
        self.assertIn('const UI_CATALOGS = ', html)
        self.assertIn('function setUiLanguage(', html)
        self.assertIn('id="language-button"', html)
        self.assertNotIn('Calculated field</script>.tfl', html)
        self.assertEqual(json.dumps(model, ensure_ascii=False), before)
        self.assertIn('data-language="ja"', self._japanese_html(model))

    def _japanese_html(self, model):
        set_language('ja')
        return render_html(model)

    def test_preferences_survive_reopen_and_invalid_values(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'settings/language.json'
            preference = LanguagePreference(path)
            self.assertIsNone(preference.get())
            preference.save('en')
            self.assertEqual(LanguagePreference(path).get(), 'en')
            with self.assertRaises(ValueError):
                preference.save('xx')
            self.assertEqual(preference.get(), 'en')
            path.write_text('broken', encoding='utf-8')
            self.assertIsNone(preference.get())

    def test_first_visit_uses_browser_preferences(self):
        for header, expected in [('', 'en'), ('ja-JP,en;q=0.9', 'ja'),
                                 ('en-US,ja;q=0.9', 'en'), ('fr-FR', 'fr'),
                                 ('fr-CA,en;q=0.8', 'fr'), ('es-MX', 'es'),
                                 ('de-AT', 'de'), ('pt-BR', 'pt-BR'), ('pt-PT', 'pt-BR'),
                                 ('zh-CN,es;q=0.8', 'es'), ('ko-KR', 'en'),
                                 ('en;q=0.4,ja;q=0.9', 'ja'), ('ja;q=0', 'en'),
                                 ('ja;q=invalid', 'en')]:
            self.assertEqual(preferred_language(header), expected, header)

    def test_contexts_do_not_share_language(self):
        set_language('en')
        with ThreadPoolExecutor(max_workers=1) as executor:
            self.assertEqual(executor.submit(language.get).result(), 'en')
        self.assertEqual(translate('Calculated field'), 'Calculated field')
        self.assertEqual(translate('Untranslated user file name'), 'Untranslated user file name')

    def test_all_catalogs_and_native_labels(self):
        with tempfile.TemporaryDirectory() as folder:
            preference = LanguagePreference(Path(folder) / 'language.json')
            for locale in SUPPORTED_LANGUAGES:
                preference.save(locale)
                self.assertEqual(LanguagePreference(preference.path).get(), locale)
                set_language(locale)
                catalog = translation_catalog(locale)
                self.assertEqual(translate('Open flow'), catalog.get('Open flow', 'Open flow'))
                if locale == 'ja':
                    continue
                self.assertEqual(catalog.keys(), english_catalog().keys())
                for key, value in catalog.items():
                    self.assertTrue(value.strip(), (locale, key))
                    self.assertEqual(sorted(re.findall(r'\{\{\d+\}\}', key)),
                                     sorted(re.findall(r'\{\{\d+\}\}', value)), (locale, key))
                    self.assertNotRegex(value, '[ぁ-んァ-ヶ一-龯]', (locale, key))
                html = render_html(empty_model())
                self.assertIn(f'<html lang="{locale}"', html)
                for bundled in SUPPORTED_LANGUAGES[1:]:
                    self.assertIn(json.dumps(translation_catalog(bundled), ensure_ascii=True).replace('<', '\\u003c'), html)

    def test_server_language_persists_between_ports_and_auth_is_required(self):
        with tempfile.TemporaryDirectory() as folder, patch('native_explorer.worker'):
            history = Path(folder) / 'recent.json'
            server = DesktopServer(history_path=history)
            url = server.start()
            try:
                html = urlopen(url).read().decode('utf-8')
                self.assertTrue('<html lang="en"' in html)
                japanese = urlopen(Request(url, headers={'Accept-Language':'ja-JP,en;q=0.9'})).read().decode('utf-8')
                self.assertTrue('<html lang="ja"' in japanese)
                config = json.loads(re.search(r'<script id="server-config" type="application/json">(.*?)</script>', html).group(1))
                headers = {'Origin':url, 'Content-Type':'application/json', 'X-Viewer-Token':config['token']}
                data = json.dumps({'language':'en'}).encode()
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(url+'/api/language', data=data))
                self.assertEqual(error.exception.code, 403)
                response = json.load(urlopen(Request(url+'/api/language',data=data,headers=headers)))
                self.assertEqual(response, {'language':'en'})
                self.assertIn('data-language="en"', urlopen(url).read().decode('utf-8'))
                japanese = urlopen(Request(url, headers={'Accept-Language':'ja-JP'})).read().decode('utf-8')
                self.assertTrue('<html lang="en"' in japanese, 'Manual preference overrides environment')
            finally:
                server.close()
            restarted = DesktopServer(history_path=history)
            try:
                self.assertIn('data-language="en"', urlopen(restarted.start()).read().decode('utf-8'))
            finally:
                restarted.close()

    def test_native_picker_uses_current_language(self):
        import native_dialogs
        set_language('en')
        with patch.object(native_dialogs, '_choose_windows', return_value=None) as chooser:
            native_dialogs.choose_file(title='Open flow', directory='.', filetypes=[('Flow files', '*.tfl;*.tflx')])
        # Dialog titles are translated; system-owned controls use Windows language.
        self.assertIn('Open flow', str(chooser.call_args))

    def test_static_ui_has_english_translations(self):
        catalog = english_catalog()
        missing = []

        class Labels(HTMLParser):
            def handle_data(self, data):
                value = data.strip()
                if re.search('[ぁ-んァ-ヶ一-龯]', value) and value != '日本語' and value not in catalog:
                    missing.append(value)

            def handle_starttag(self, tag, attrs):
                for key, value in attrs:
                    if key in ('title', 'aria-label', 'placeholder') and value:
                        self.handle_data(value)

        Labels().feed((Path(__file__).resolve().parents[1] / 'web/viewer.html').read_text(encoding='utf-8'))
        self.assertEqual(missing, [])


if __name__ == '__main__':
    unittest.main()
