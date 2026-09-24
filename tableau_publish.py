"""Tableau publishing. Importing this module never contacts a server."""
import configparser
import os
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit


def config_path():
    root = Path(sys.executable).parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parent
    return root / 'publish.ini'


class PublishSettings:
    def __init__(self, path=None):
        self.path = Path(path) if path else config_path()

    def load(self):
        config = configparser.ConfigParser(interpolation=None)
        if self.path.exists():
            with self.path.open(encoding='utf-8-sig') as stream:
                config.read_file(stream)
        section = config['tableau'] if config.has_section('tableau') else {}
        return {key: section.get(key, '') for key in ('server_url', 'token_name', 'token_value')}

    def save(self, values):
        config = configparser.ConfigParser(interpolation=None)
        config['tableau'] = {key: values[key] for key in ('server_url', 'token_name', 'token_value')}
        fd, name = tempfile.mkstemp(prefix='.publish-', dir=self.path.parent)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                config.write(stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.path)
        finally:
            Path(name).unlink(missing_ok=True)


def credentials(payload):
    values = {key: payload.get(key, '') for key in ('server_url', 'token_name', 'token_value')}
    if any(not isinstance(v, str) or not v.strip() or len(v) > 8192 for v in values.values()):
        raise ValueError('Server URL・トークン名・トークン値を入力してください。')
    values['server_url'] = values['server_url'].strip().rstrip('/')
    values['token_name'] = values['token_name'].strip()
    url = urlsplit(values['server_url'])
    if url.scheme not in ('https', 'http') or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError('Server URLには http:// または https:// から始まるサーバーのURLを入力してください。')
    return values


def project_default(package):
    # Only explicit flow-publishing metadata is relevant. Output nodes publish
    # data sources and must never be mistaken for the flow's destination.
    candidates = set()
    for document in (package[1], package[3]):
        for key in ('publishSettings', 'publishingSettings', 'publishInfo'):
            info = document.get(key)
            if isinstance(info, dict):
                value = info.get('projectPath') or info.get('projectFullPath')
                if isinstance(value, str) and value.strip():
                    candidates.add(value.strip())
    return next(iter(candidates)) if len(candidates) == 1 else ''


def resolve_project(server, tsc, path, log):
    levels = path.strip().strip('/').split('/')
    if not levels or any(not level.strip() for level in levels):
        raise ValueError('パブリッシュ先を「親プロジェクト/子プロジェクト」の形式で入力してください。')
    parent = None
    for index, name in enumerate(levels):
        options = tsc.RequestOptions(pagesize=1000)
        # Tableau cannot encode comma/ampersand in filter values. In that case
        # filter by parent only and match the exact name locally.
        if not any(c in name for c in ',&'):
            options.filter.add(tsc.Filter(tsc.RequestOptions.Field.Name, tsc.RequestOptions.Operator.Equals, name))
        field = tsc.RequestOptions.Field.ParentProjectId if parent else tsc.RequestOptions.Field.TopLevelProject
        options.filter.add(tsc.Filter(field, tsc.RequestOptions.Operator.Equals, parent or 'true'))
        log('公開先を検索中: ' + '/'.join(levels[:index + 1]))
        matches = [p for p in tsc.Pager(server.projects, options)
                   if p.name == name and (p.parent_id or None) == parent]
        if len(matches) != 1:
            raise ValueError('公開先を一意に特定できません（存在・閲覧権限・同名の階層を確認してください）: ' + '/'.join(levels[:index + 1]))
        parent = matches[0].id
    return parent


def run_publish(values, settings, log, *, source=None, name='', project='', tsc=None):
    """source=None tests authentication. Persist credentials only on success."""
    if tsc is None:
        import tableauserverclient as tsc
    log('認証中…')
    server = tsc.Server(values['server_url'], use_server_version=True, http_options={'timeout': (15, 180)})
    auth = tsc.PersonalAccessTokenAuth(values['token_name'], values['token_value'], site_id='')
    with server.auth.sign_in(auth):
        if source is not None:
            project_id = resolve_project(server, tsc, project, log)
            item = tsc.FlowItem(project_id, name=name)
            log('パブリッシュ中: ' + name + '（同名のフローは上書き）')
            result = server.flows.publish(item, str(source), tsc.Server.PublishMode.Overwrite)
            log('パブリッシュが完了しました。フローID: ' + str(result.id))
        else:
            log('認証テストが完了しました。')
        try:
            settings.save(values)
            log('認証情報を publish.ini に保存しました。')
        except OSError:
            log('処理は成功しましたが、publish.ini を保存できませんでした。ツールのフォルダーへの書き込み権限を確認してください。', 'warning')


def safe_error(exc, values):
    text = str(exc)
    from html import escape
    from urllib.parse import quote
    secret = values.get('token_value', '')
    if secret:
        for variant in (secret, escape(secret), quote(secret, safe='')):
            text = text.replace(variant, '********')
    return text[:4000] or type(exc).__name__
