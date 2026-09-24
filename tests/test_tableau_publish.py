import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as Item
from unittest.mock import Mock

from tableau_publish import PublishSettings, credentials, project_default, resolve_project, run_publish, safe_error


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.settings = PublishSettings(Path(self.folder.name) / 'publish.ini')
        self.values = {'server_url': 'https://tableau.example.com', 'token_name': 'name', 'token_value': 'secret%<&'}
        self.log = Mock()

    def client(self):
        # Real TSC request options and FlowItem; every network endpoint is mocked.
        import tableauserverclient as TSC
        server = Mock()
        server.auth.sign_in.return_value = Mock(__enter__=Mock(), __exit__=Mock(return_value=False))
        tsc = Mock(wraps=TSC)
        tsc.RequestOptions = TSC.RequestOptions
        tsc.Filter = TSC.Filter
        tsc.FlowItem = TSC.FlowItem
        tsc.Server = Mock(return_value=server)
        tsc.Server.PublishMode = TSC.Server.PublishMode
        tsc.Pager = Mock(side_effect=[
            [Item(id='root', name='Parent', parent_id=None)],
            [Item(id='child', name='Child', parent_id='root')],
        ])
        return tsc, server

    def test_settings_missing_and_roundtrip_percent_token(self):
        self.assertEqual(self.settings.load(), dict.fromkeys(self.values, ''))
        self.settings.save(self.values)
        self.assertEqual(self.settings.load(), self.values)
        self.settings.save({**self.values, 'token_value': 'replacement'})
        self.assertEqual(self.settings.load()['token_value'], 'replacement')

    def test_auth_success_persists_and_signs_out_without_publishing(self):
        tsc, server = self.client()
        run_publish(self.values, self.settings, self.log, tsc=tsc)
        tsc.PersonalAccessTokenAuth.assert_called_once_with('name', 'secret%<&', site_id='')
        server.flows.publish.assert_not_called()
        self.assertEqual(self.settings.load(), self.values)
        server.auth.sign_in.return_value.__exit__.assert_called_once()

    def test_failure_does_not_create_or_overwrite_settings(self):
        tsc, server = self.client()
        server.auth.sign_in.side_effect = RuntimeError('denied')
        with self.assertRaises(RuntimeError):
            run_publish(self.values, self.settings, self.log, tsc=tsc)
        self.assertFalse(self.settings.path.exists())
        self.settings.save(self.values)
        with self.assertRaises(RuntimeError):
            run_publish({**self.values, 'token_value': 'bad'}, self.settings, self.log, tsc=tsc)
        self.assertEqual(self.settings.load(), self.values)

    def test_nested_publish_uses_filtered_pages_parent_and_overwrite(self):
        tsc, server = self.client()
        run_publish(self.values, self.settings, self.log, source=Path('flow.tflx'), name='Published', project='Parent/Child', tsc=tsc)
        calls = tsc.Pager.call_args_list
        filters = [','.join(str(f) for f in call.args[1].filter) for call in calls]
        self.assertIn('topLevelProject:eq:true', filters[0])
        self.assertIn('name:eq:Parent', filters[0])
        self.assertIn('parentProjectId:eq:root', filters[1])
        item, file, mode = server.flows.publish.call_args.args
        self.assertEqual((item.project_id, item.name, file, mode), ('child', 'Published', 'flow.tflx', 'Overwrite'))
        self.assertEqual(self.settings.load(), self.values)

    def test_missing_or_ambiguous_project_never_publishes(self):
        for found in ([], [Item(id='a',name='Parent',parent_id=None),Item(id='b',name='Parent',parent_id=None)]):
            tsc, server = self.client()
            tsc.Pager.side_effect = [found]
            with self.assertRaises(ValueError):
                run_publish(self.values, self.settings, self.log, source='f.tfl', name='x', project='Parent', tsc=tsc)
            server.flows.publish.assert_not_called()
            self.assertFalse(self.settings.path.exists())

    def test_reserved_filter_chars_use_parent_filter_and_exact_match(self):
        tsc, server = self.client()
        tsc.Pager.side_effect = [[Item(id='ok',name='A&B',parent_id=None),Item(id='no',name='other',parent_id=None)]]
        self.assertEqual(resolve_project(server, tsc, 'A&B', self.log), 'ok')
        self.assertNotIn('name:eq', ','.join(str(f) for f in tsc.Pager.call_args.args[1].filter))

    def test_metadata_does_not_take_output_datasource_destination(self):
        self.assertEqual(project_default(('f', {'nodes': {'out': {'projectPath':'Wrong'}}}, {}, {}, [])), '')
        self.assertEqual(project_default(('f', {}, {}, {'publishSettings':{'projectPath':'Parent/Child'}}, [])), 'Parent/Child')

    def test_error_redacts_token_and_invalid_url_is_rejected(self):
        self.assertNotIn(self.values['token_value'], safe_error(RuntimeError('bad '+self.values['token_value']),self.values))
        for url in ('file:///a','https://user:pass@server','https://server/#/site',''):
            with self.assertRaises(ValueError):
                credentials({**self.values,'server_url':url})


if __name__ == '__main__':
    unittest.main()
