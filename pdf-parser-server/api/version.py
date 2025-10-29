from http.server import BaseHTTPRequestHandler
import json
import subprocess

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            # Try to get git commit hash
            try:
                commit = subprocess.check_output(['git', 'rev-parse', '--short', 'HEAD'], 
                                                stderr=subprocess.DEVNULL).decode('utf-8').strip()
            except:
                commit = "unknown"
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            response = {
                'commit': commit,
                'message': 'Pattern 0b/0c with constraints',
                'patterns': ['0', '0a', '0b', '0c', '1', '2', '3', '4']
            }
            
            self.wfile.write(json.dumps(response).encode('utf-8'))
            return
            
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
