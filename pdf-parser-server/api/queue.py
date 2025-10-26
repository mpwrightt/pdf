"""
Vercel Queue Management API for Helper Doc Coordination

Uses Convex backend for persistent, atomic queue coordination.
Convex provides real-time database with transactions.

Endpoints:
- POST /api/queue - Manage SQ claims and Refund Log reservations
- GET /api/queue - Health check and queue status
"""

from http.server import BaseHTTPRequestHandler
import json
import os
import requests

# Convex deployment URL (set in Vercel environment variables)
CONVEX_URL = os.environ.get('CONVEX_URL', '')

def call_convex(function_name, args):
    """Call a Convex function via HTTP API"""
    if not CONVEX_URL:
        return {
            'success': False,
            'error': 'Convex not configured. Add CONVEX_URL environment variable in Vercel.'
        }

    try:
        # Determine if mutation or query
        is_mutation = function_name in ['queue:tryClaimSQ', 'queue:releaseSQ', 'queue:reserveRefundLogWrite', 'queue:releaseRefundLogWrite']

        # Convex HTTP API endpoint
        endpoint = 'mutation' if is_mutation else 'query'
        url = f'{CONVEX_URL.rstrip("/")}/api/{endpoint}'

        # Convex expects args as object, not array
        payload = {
            'path': function_name,
            'args': args if args else {},
            'format': 'json'
        }

        response = requests.post(
            url,
            headers={'Content-Type': 'application/json'},
            json=payload,
            timeout=10
        )

        if response.status_code == 200:
            result = response.json()
            # Convex wraps the result in a 'value' field and status
            if result.get('status') == 'success' and 'value' in result:
                return result['value']
            elif result.get('status') == 'error':
                return {
                    'success': False,
                    'error': f"Convex error: {result.get('message', 'Unknown error')}"
                }
            return result
        else:
            return {
                'success': False,
                'error': f'Convex returned {response.status_code}: {response.text[:200]}'
            }
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to call Convex: {str(e)}'
        }

def try_claim_sq(bot_id, sq_number):
    """Try to claim an SQ for a bot"""
    return call_convex('queue:tryClaimSQ', {
        'botId': bot_id,
        'sqNumber': sq_number
    })

def release_sq(bot_id, sq_number):
    """Release an SQ claim"""
    return call_convex('queue:releaseSQ', {
        'botId': bot_id,
        'sqNumber': sq_number
    })

def reserve_refund_log_write(bot_id, sq_number, row_count, current_last_row=1):
    """Reserve rows in Refund Log"""
    return call_convex('queue:reserveRefundLogWrite', {
        'botId': bot_id,
        'sqNumber': sq_number,
        'rowCount': row_count,
        'currentLastRow': current_last_row
    })

def release_refund_log_write(bot_id, sq_number):
    """Release Refund Log reservation"""
    return call_convex('queue:releaseRefundLogWrite', {
        'botId': bot_id,
        'sqNumber': sq_number
    })

def get_queue_status():
    """Get current queue status (for debugging)"""
    if not CONVEX_URL:
        return {
            'success': False,
            'error': 'Convex not configured. Add CONVEX_URL environment variable in Vercel.',
            'convexConfigured': False
        }

    result = call_convex('queue:getQueueStatus', {})
    if result.get('success'):
        result['convexConfigured'] = True
    return result

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        """Health check and status endpoint"""
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        response = get_queue_status()
        self.wfile.write(json.dumps(response).encode())
        return

    def do_POST(self):
        """Handle queue management requests"""
        try:
            # Read request body
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            data = json.loads(body)

            action = data.get('action')
            bot_id = data.get('botId')
            sq_number = data.get('sqNumber')

            if not action:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': False,
                    'error': 'Missing action parameter'
                }).encode())
                return

            # Route to appropriate handler
            if action == 'tryClaimSQ':
                result = try_claim_sq(bot_id, sq_number)

            elif action == 'releaseSQ':
                result = release_sq(bot_id, sq_number)

            elif action == 'reserveRefundLogWrite':
                row_count = data.get('rowCount', 1)
                current_last_row = data.get('currentLastRow', 1)
                result = reserve_refund_log_write(bot_id, sq_number, row_count, current_last_row)

            elif action == 'releaseRefundLogWrite':
                result = release_refund_log_write(bot_id, sq_number)

            elif action == 'getStatus':
                result = get_queue_status()

            else:
                result = {
                    'success': False,
                    'error': f'Unknown action: {action}'
                }

            # Send response
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'success': False,
                'error': str(e)
            }).encode())

    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
