"""Request-scoped language for exported HTML and native dialog labels."""
import json
import os
import sys
import tempfile
import threading
from contextvars import ContextVar
from functools import lru_cache
from pathlib import Path

language = ContextVar('viewer_language', default='en')
SUPPORTED_LANGUAGES = ('en', 'ja', 'fr', 'es', 'de', 'pt-BR')


def normalize_language(value):
    """Map regional preferences to the translations provided by the Viewer."""
    base = str(value or '').lower().replace('_', '-').split('-')[0]
    return 'pt-BR' if base == 'pt' else base if base in SUPPORTED_LANGUAGES else None


def set_language(value):
    language.set(normalize_language(value) or 'en')


def preferred_language(accept_language=''):
    """Use the browser's ordered language preferences, without geolocation."""
    choices = []
    for entry in accept_language.split(','):
        parts = entry.strip().lower().split(';')
        tag = normalize_language(parts[0])
        try:
            quality = next((float(p.strip()[2:]) for p in parts[1:] if p.strip().startswith('q=')), 1.0)
        except ValueError:
            continue
        if tag and 0 < quality <= 1:
            choices.append((quality, tag))
    return max(choices, key=lambda item: item[0])[1] if choices else 'en'


@lru_cache(maxsize=6)
def translation_catalog(locale):
    if locale not in SUPPORTED_LANGUAGES:
        raise ValueError('Unsupported language')
    root = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
    return json.loads((root / 'web' / f'{locale}.json').read_text(encoding='utf-8'))


def english_catalog():
    return translation_catalog('en')


def translate(text):
    return translation_catalog(language.get()).get(text, text)


class LanguagePreference:
    """Shared by desktop windows even when their local server ports differ."""

    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.RLock()

    def get(self):
        with self.lock:
            try:
                value = json.loads(self.path.read_text(encoding='utf-8'))
                return value if value in SUPPORTED_LANGUAGES else None
            except (OSError, ValueError):
                return None

    def save(self, value):
        if value not in SUPPORTED_LANGUAGES:
            raise ValueError('Unsupported language')
        with self.lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8',
                                                 dir=self.path.parent, delete=False) as handle:
                    temporary = Path(handle.name)
                    json.dump(value, handle)
                os.replace(temporary, self.path)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
