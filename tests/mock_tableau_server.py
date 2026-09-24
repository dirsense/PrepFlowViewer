"""Loopback-only Tableau REST stub. No production server is contacted."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
from urllib.parse import parse_qs, urlsplit


@contextmanager
def mock_tableau():
    calls = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, body, status=200):
            data = ('<tsResponse xmlns="http://tableau.com/api">' + body + '</tsResponse>').encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/xml')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            calls.append(('GET', self.path, b''))
            if self.path.endswith('/serverInfo'):
                return self.reply('<serverInfo><productVersion build="test">2026.2</productVersion><restApiVersion>3.29</restApiVersion></serverInfo>')
            if urlsplit(self.path).path.endswith('/projects'):
                filters = parse_qs(urlsplit(self.path).query)['filter'][0]
                project = '<project id="root" name="Parent"/>' if 'topLevelProject:eq:true' in filters else '<project id="child" name="Child" parentProjectId="root"/>'
                return self.reply('<pagination pageNumber="1" pageSize="1000" totalAvailable="1"/><projects>' + project + '</projects>')
            self.reply('<error code="404000"><summary>Not found</summary></error>', 404)

        def do_POST(self):
            data = self.rfile.read(int(self.headers.get('Content-Length', '0')))
            calls.append(('POST', self.path, data))
            if self.path.endswith('/auth/signin'):
                return self.reply('<credentials token="test-session"><site id="site" contentUrl=""/><user id="user"/></credentials>')
            if self.path.endswith('/auth/signout'):
                return self.reply('', 204)
            if urlsplit(self.path).path.endswith('/flows'):
                return self.reply('<flow id="published" name="Published"><project id="child" name="Child"/></flow>', 201)
            self.reply('<error code="404000"><summary>Not found</summary></error>', 404)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}', calls
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
