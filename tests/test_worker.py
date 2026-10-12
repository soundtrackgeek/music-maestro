import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

spec=importlib.util.spec_from_file_location('worker',Path(__file__).parents[1]/'src-tauri/resources/worker.py')
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class ProtocolTests(unittest.TestCase):
    def test_unicode_progress_survives_legacy_windows_pipe_encoding(self):
        script = ("import importlib.util; "
                  f"s=importlib.util.spec_from_file_location('worker', {str(Path(worker.__file__))!r}); "
                  "w=importlib.util.module_from_spec(s); s.loader.exec_module(w); "
                  "w.emit('progress', detail='48 kHz \\u00b7 stereo \\u2014 \\u97f3\\u4e50')")
        result = subprocess.run([sys.executable, '-c', script], capture_output=True,
                                env={**os.environ, 'PYTHONIOENCODING': 'cp1252'}, check=True)
        message = json.loads(result.stdout.decode('ascii'))
        self.assertEqual(message['detail'], '48 kHz · stereo — 音乐')


class DownloadTests(unittest.TestCase):
    data=b'a verified model fixture'*100
    def setUp(self):
        self.ranges=[]
        data=self.data
        ranges=self.ranges
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                header=self.headers.get('Range')
                ranges.append(header)
                offset=int(header.split('=')[1].split('-')[0]) if header else 0
                self.send_response(206 if header else 200)
                self.send_header('Content-Length',str(len(data)-offset))
                if header:self.send_header('Content-Range',f'bytes {offset}-{len(data)-1}/{len(data)}')
                self.end_headers()
                self.wfile.write(data[offset:])
            def log_message(self,*args):pass
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.temp=tempfile.TemporaryDirectory()
        self.path=Path(self.temp.name)/'model.safetensors'
        self.url=f'http://127.0.0.1:{self.server.server_port}/model'
        self.sha=hashlib.sha256(data).hexdigest()
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()
    def test_resume_verified_file_then_offline_reuse(self):
        partial=self.path.with_suffix('.safetensors.partial')
        partial.write_bytes(self.data[:120])
        worker.download_file(self.url,self.path,len(self.data),self.sha,lambda _:None)
        self.assertEqual(self.ranges,['bytes=120-'])
        self.assertEqual(self.path.read_bytes(),self.data)
        self.assertFalse(partial.exists())
        worker.download_file(self.url,self.path,len(self.data),self.sha,lambda _:None)
        self.assertEqual(len(self.ranges),1)
    def test_corrupt_download_is_never_published(self):
        with self.assertRaisesRegex(ValueError,'integrity'):
            worker.download_file(self.url,self.path,len(self.data),'0'*64,lambda _:None)
        self.assertFalse(self.path.exists())
        self.assertFalse(self.path.with_suffix('.safetensors.partial').exists())
    def test_existing_corrupt_model_is_repaired(self):
        self.path.write_bytes(b'x'*len(self.data))
        worker.download_file(self.url,self.path,len(self.data),self.sha,lambda _:None)
        self.assertEqual(self.path.read_bytes(),self.data)


if __name__=='__main__':unittest.main()
