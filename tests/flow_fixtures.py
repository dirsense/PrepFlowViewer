"""Original, minimal flow definitions for regression tests; no third-party data."""
import io
import json
import zipfile


def flow_bytes(fields, actions, name='Transform'):
    nodes = {}
    for index, raw in enumerate(actions):
        key = f'action-{index}'
        nodes[key] = dict(raw, id=key, nextNodes=(
            [{'nextNodeId': f'action-{index + 1}'}] if index + 1 < len(actions) else []))
    flow = {'nodes': {
        'input': {'id': 'input', 'name': 'Source', 'baseType': 'input',
                  'nodeType': '.v1.LoadCsv',
                  'fields': [{'name': k, 'type': v} for k, v in fields.items()],
                  'nextNodes': [{'nextNodeId': 'transform', 'nextNamespace': 'Default'}]},
        'transform': {'id': 'transform', 'name': name, 'baseType': 'transform',
                      'nodeType': '.v1.Container', 'loomContainer': {'nodes': nodes},
                      'nextNodes': []},
    }}
    return json.dumps(flow).encode()


def flow_stream(fields, actions, name='Transform'):
    return io.BytesIO(flow_bytes(fields, actions, name))


def filter_package():
    result = io.BytesIO()
    with zipfile.ZipFile(result, 'w') as archive:
        archive.writestr('flow', flow_bytes({'Amount': 'integer'}, [
            {'nodeType': '.v1.FilterOperation', 'filterExpression': '[Amount] > 0'}]))
        archive.writestr('Data/example.csv', 'Amount\n1\n2\n')
    return result.getvalue()
