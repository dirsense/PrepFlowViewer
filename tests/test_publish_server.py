import json
import queue
import re
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import prepflow
from tableau_publish import PublishSettings


class PublishServerTests(unittest.TestCase):
    def test_stream_snapshot_auth_guards_and_standalone_export(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            source=root/'Example.tfl'
            source.write_text(json.dumps({'nodes': {'step': {'id':'step','name':'Test','baseType':'transform','nodeType':'.v1.Container','loomContainer':{'nodes':{'calc':{'id':'calc','nodeType':'.v1.AddColumn','columnName':'Result','expression':'1 + 2','nextNodes':[]}}}}}}))
            original=source.read_bytes()
            settings=PublishSettings(root/'publish.ini')
            ready=queue.Queue()
            with patch('native_explorer.worker'), patch('tableau_publish.PublishSettings',return_value=settings):
                thread=threading.Thread(target=prepflow.serve,kwargs=dict(source=source,port=0,open_browser=False,history_path=root/'recent.json',on_ready=lambda server,url:ready.put((server,url))))
                thread.start()
                server,base=ready.get(timeout=5)
                try:
                    page=urlopen(base).read().decode()
                    token=json.loads(re.search(r'id="server-config" type="application/json">(.*?)</script>',page)[1])['token']
                    model=json.loads(re.search(r'id="flow-data" type="application/json">(.*?)</script>',page,re.S)[1])
                    def post(endpoint,payload,origin=None):
                        return urlopen(Request(base+endpoint,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','X-Viewer-Token':token,'Origin':origin or base}))
                    defaults=json.load(post('/api/publish/defaults',{'exportKey':model['exportKey']}))
                    self.assertEqual((defaults['name'],defaults['project'],defaults['token_value']),('Example','',''))
                    with self.assertRaises(HTTPError) as error:
                        post('/api/publish/test-auth',{},'https://outside.invalid')
                    self.assertEqual(error.exception.code,403)
                    payload={'exportKey':model['exportKey'],'revision':model['editRevision'],'name':'Published','project':'Parent/Child','server_url':'https://tableau.example.com','token_name':'name','token_value':'TEST_SECRET_ONLY','changes':[{'stepId':'step','actionId':'calc','field':'Result','before':'1 + 2','expression':'1 + 3'}]}
                    def mocked_run(values,store,log,**kwargs):
                        self.assertEqual(prepflow.read_package(kwargs['source'])[1]['nodes']['step']['loomContainer']['nodes']['calc']['expression'],'1 + 3')
                        self.assertEqual(source.read_bytes(),original)
                        self.assertEqual(kwargs['name'],'Published')
                        store.save(values)
                        log('Completed')
                    with patch('tableau_publish.run_publish',side_effect=mocked_run):
                        events=[json.loads(line) for line in post('/api/publish/start',payload)]
                    self.assertTrue(events[-1]['ok'])
                    self.assertEqual(source.read_bytes(),original)
                    def remembered(key=model['exportKey']):
                        result=json.load(post('/api/publish/defaults',{'exportKey':key}))
                        return result['name'],result['project']
                    self.assertEqual(remembered(),('Published','Parent/Child'))
                    changed={**payload,'name':'Different','project':'Elsewhere'}
                    with patch('tableau_publish.run_publish'):
                        auth=[json.loads(line) for line in post('/api/publish/test-auth',changed)]
                    self.assertTrue(auth[-1]['ok'])
                    self.assertEqual(remembered(),('Published','Parent/Child'))
                    with patch('tableau_publish.run_publish',side_effect=RuntimeError('publish failed')):
                        failed_publish=[json.loads(line) for line in post('/api/publish/start',changed)]
                    self.assertFalse(failed_publish[-1]['ok'])
                    self.assertEqual(remembered(),('Published','Parent/Child'))
                    reopened=server.open_flow_path(source)
                    self.assertEqual(remembered(reopened['exportKey']),('Published','Parent/Child'))
                    other=root/'Other.tfl'
                    other.write_bytes(original)
                    other_model=server.open_flow_path(other)
                    self.assertEqual(remembered(other_model['exportKey']),('Other',''))
                    with patch('tableau_publish.run_publish'):
                        republished=[json.loads(line) for line in post('/api/publish/start',changed)]
                    self.assertTrue(republished[-1]['ok'])
                    self.assertEqual(remembered(),('Different','Elsewhere'))
                    self.assertEqual(set(settings.load()),{'server_url','token_name','token_value'})
                    self.assertNotIn('Parent/Child',settings.path.read_text(encoding='utf-8'))
                    with patch('tableau_publish.run_publish',side_effect=RuntimeError('denied TEST_SECRET_ONLY')):
                        failed=[json.loads(line) for line in post('/api/publish/test-auth',payload)]
                    self.assertFalse(failed[-1]['ok'])
                    self.assertNotIn('TEST_SECRET_ONLY',json.dumps(failed))
                    exported=urlopen(base+'/export/'+model['exportKey']).read().decode()
                    self.assertIn('<script id="server-config" type="application/json">{}</script>',exported)
                    self.assertNotIn('TEST_SECRET_ONLY',exported)
                    self.assertIn('id="publish-button" title=',exported)
                    self.assertIn('aria-label="Publish to Tableau Server" hidden',exported)
                finally:
                    server.shutdown()
                    thread.join(timeout=5)
                    self.assertFalse(thread.is_alive())

if __name__ == '__main__':
    unittest.main()
