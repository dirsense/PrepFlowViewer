"""Output destination edits. No data is written and no server is contacted here."""
import copy
import ntpath
import re
from urllib.parse import urlsplit


FORMATS = {
    'hyper': ('.v1.WriteToHyper', 'hyperOutputFile', '.hyper'),
    'csv': ('.v1.WriteToCsv', 'csvOutputFile', '.csv'),
    'excel': ('.v2021_1_1.WriteToExcel', 'excelOutputFile', '.xlsx'),
    'server': ('.v1.PublishExtract', None, None),
}
REFRESH = 'com.tableau.loom.doc.fileformat.v2020_2_1.OutputRefreshOptions'
DESTINATION_KEYS = {
    'hyperOutputFile', 'tdsOutput', 'csvOutputFile', 'separator',
    'excelOutputFile', 'excelOutputSheetName', 'serverUrl', 'projectName',
    'projectLuid', 'datasourceName', 'datasourceDescription',
    'siteName', 'siteContentUrl', 'siteUrl', 'siteId', 'siteLuid',
}


def output_format(node):
    kind = node.get('nodeType', '').split('.')[-1]
    for name, (node_type, _, _) in FORMATS.items():
        if kind == node_type.split('.')[-1]:
            return name
    raise ValueError('この出力形式の編集には対応していません。')


def configuration(node):
    kind = output_format(node)
    _, key, extension = FORMATS[kind]
    path = node.get(key, '') if key else ''
    folder, filename = ntpath.split(path)
    return {
        'format': kind,
        'name': (filename[:-len(extension)] if filename.lower().endswith(extension or '\0') else filename)
                if key else node.get('datasourceName', ''),
        'folder': folder,
        'sheet': node.get('excelOutputSheetName', '[Sheet1$]'),
        'server': node.get('serverUrl', ''),
        'project': node.get('projectName', ''),
        'projectId': node.get('projectLuid', ''),
    }


def server_url(value):
    value = value.strip().rstrip('/')
    url = urlsplit(value)
    if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError('Server URLを http:// または https:// から入力してください。')
    return value


def refresh_options(properties, kind):
    explicit = next((p for p in properties.values() if isinstance(p, dict)
                     and p.get('nodePropertyType') == '.v2020_2_1.OutputRefreshOptions'), {})
    return {**explicit, 'outputOperationType': explicit.get('outputOperationType') or
            ('outputOperationTypeAppend' if kind == 'excel' else 'outputOperationTypeCreate')}


def edited_node(node, properties, desired):
    """Validate editable fields and preserve identity, graph and writing options."""
    old_kind = output_format(node)
    kind = desired.get('format')
    if kind not in FORMATS:
        raise ValueError('出力タイプを選択してください。')
    for key in ('name', 'folder', 'sheet', 'server', 'project', 'projectId'):
        if not isinstance(desired.get(key, ''), str) or len(desired.get(key, '')) > 8192:
            raise ValueError('出力設定の形式が正しくありません。')
    name = desired.get('name', '').strip()
    if not name or any(ord(c) < 32 for c in name):
        raise ValueError('出力名を入力してください。')
    options = refresh_options(properties, old_kind)
    if kind == 'csv' and (options['outputOperationType'] != 'outputOperationTypeCreate' or
                         options.get('isIncrementalDefault')):
        raise ValueError('現在の書き込みオプションを維持したままCSVへ変更できません。CSVはテーブルの作成のみ対応します。')
    result, result_props = copy.deepcopy(node), copy.deepcopy(properties)
    if kind != old_kind:
        for key in DESTINATION_KEYS:
            result.pop(key, None)
        result['nodeType'] = FORMATS[kind][0]
        # Excel's implicit default differs from the other output types.
        if not any(isinstance(p, dict) and p.get('nodePropertyType') == '.v2020_2_1.OutputRefreshOptions'
                   for p in result_props.values()) and (kind == 'excel' or old_kind == 'excel'):
            result_props[REFRESH] = {'nodePropertyType': '.v2020_2_1.OutputRefreshOptions', **options}
    if kind == 'server':
        project = desired.get('project', '').strip().strip('/')
        project_id = desired.get('projectId', '').strip()
        if not project or not project_id or any(not level.strip() for level in project.split('/')):
            raise ValueError('プロジェクトを確認してから変更を確定してください。')
        if old_kind == 'server' and any(node.get(k) not in (None, '', 'Default') for k in ('siteName', 'siteContentUrl', 'siteUrl', 'siteId', 'siteLuid')):
            raise ValueError('既定サイト以外へのServer出力は編集できません。')
        result.update(serverUrl=server_url(desired.get('server', '')), projectName=project.split('/')[-1],
                      projectLuid=project_id, datasourceName=name)
        result.setdefault('datasourceDescription', '')
    else:
        # Names are filenames; separators belong in the separate folder field.
        if re.search(r'[<>:"/\\|?*]', name) or name.endswith(('.', ' ')) or re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)', name, re.I):
            raise ValueError('ファイル名に使用できない文字が含まれています。')
        folder = desired.get('folder', '').strip()
        if any(ord(c) < 32 for c in folder):
            raise ValueError('出力パスを確認してください。')
        _, key, extension = FORMATS[kind]
        # The name field has no extension; the selected type determines it.
        filename = name + extension
        separator = '/' if '/' in folder and '\\' not in folder else '\\'
        path = folder.rstrip('/\\') + separator + filename if folder else filename
        result[key] = path
        if kind == 'hyper':
            result['tdsOutput'] = path[:-len(extension)] + '.tds'
        elif kind == 'csv' and kind != old_kind:
            result['separator'] = None
        elif kind == 'excel':
            sheet = desired.get('sheet', '').strip()
            if sheet.startswith('[') and sheet.endswith('$]'):
                sheet = sheet[1:-2]
            if not sheet or len(sheet) > 31 or re.search(r'[\\/?*\[\]:]', sheet):
                raise ValueError('Excelシート名は31文字以内で、\\ / ? * [ ] : を含めずに入力してください。')
            result['excelOutputSheetName'] = '[' + sheet + '$]'
    return result, result_props


def make_change(node, properties, desired):
    edited_node(node, properties, desired)
    return {'kind': 'output', 'stepId': node['id'], 'before': copy.deepcopy(node),
            'beforeProperties': copy.deepcopy(properties), 'destination': copy.deepcopy(desired)}


def apply_output_change(flow, change):
    node = flow.get('nodes', {}).get(change.get('stepId'))
    if not node or node.get('baseType') != 'output':
        raise ValueError('編集する出力ステップが見つかりません。')
    properties = flow.get('nodeProperties', {}).get(change['stepId'], {})
    if node != change.get('before') or properties != change.get('beforeProperties'):
        raise ValueError('出力設定が更新されています。開き直してから編集してください。')
    result, result_props = edited_node(node, properties, change.get('destination', {}))
    flow['nodes'][change['stepId']] = result
    if result_props != properties:
        flow.setdefault('nodeProperties', {})[change['stepId']] = result_props


def lookup_project(url, path, settings, *, tsc=None):
    """Use only the PAT saved for this server; authentication always uses Default."""
    from tableau_publish import credentials, resolve_project, safe_error
    values = settings.load()
    url = server_url(url)
    if not values.get('server_url') or server_url(values['server_url']).casefold() != url.casefold():
        raise ValueError('このServer URLの認証情報がありません。パブリッシュ画面でトークンを入力し、認証テストを行ってください。')
    values = credentials(values)
    if tsc is None:
        import tableauserverclient as tsc
    try:
        server = tsc.Server(url, use_server_version=True, http_options={'timeout': (15, 60)})
        auth = tsc.PersonalAccessTokenAuth(values['token_name'], values['token_value'], site_id='')
        with server.auth.sign_in(auth):
            project_id = resolve_project(server, tsc, path, lambda message: None)
        return {'server': url, 'project': path.strip().strip('/'), 'projectId': project_id}
    except Exception as exc:
        raise ValueError(safe_error(exc, values)) from None
