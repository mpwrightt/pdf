"""
Vercel Queue Management API for Helper Doc Coordination

Uses Vercel KV (Redis) for persistent, atomic queue coordination across
all function instances and concurrent requests.

Endpoints:
- POST /api/queue - Manage SQ claims and Refund Log reservations
- GET /api/queue - Health check and queue status
"""

from http.server import BaseHTTPRequestHandler
import json
from datetime import datetime, timedelta
import os
import requests

# Vercel KV REST API credentials (automatically set by Vercel)
KV_REST_API_URL = os.environ.get('KV_REST_API_URL', '')
KV_REST_API_TOKEN = os.environ.get('KV_REST_API_TOKEN', '')

CLAIM_TIMEOUT_SECONDS = 600  # 10 minutes

class VercelKV:
    """Vercel KV REST API client"""

    def __init__(self, url, token):
        self.url = url.rstrip('/')
        self.headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }

    def get(self, key):
        """Get value for key"""
        try:
            response = requests.get(
                f'{self.url}/get/{key}',
                headers=self.headers,
                timeout=5
            )
            if response.status_code == 200:
                result = response.json()
                return result.get('result')
            return None
        except Exception as e:
            print(f'KV GET error: {e}')
            return None

    def set(self, key, value, ex=None):
        """Set key to value with optional expiration in seconds"""
        try:
            data = [key, value]
            if ex:
                data.extend(['EX', ex])

            response = requests.post(
                f'{self.url}/set',
                headers=self.headers,
                json=data,
                timeout=5
            )
            return response.status_code == 200
        except Exception as e:
            print(f'KV SET error: {e}')
            return False

    def delete(self, key):
        """Delete key"""
        try:
            response = requests.post(
                f'{self.url}/del',
                headers=self.headers,
                json=[key],
                timeout=5
            )
            return response.status_code == 200
        except Exception as e:
            print(f'KV DEL error: {e}')
            return False

    def keys(self, pattern='*'):
        """Get all keys matching pattern"""
        try:
            response = requests.get(
                f'{self.url}/keys/{pattern}',
                headers=self.headers,
                timeout=5
            )
            if response.status_code == 200:
                result = response.json()
                return result.get('result', [])
            return []
        except Exception as e:
            print(f'KV KEYS error: {e}')
            return []

# Initialize KV client
kv = VercelKV(KV_REST_API_URL, KV_REST_API_TOKEN) if KV_REST_API_URL and KV_REST_API_TOKEN else None

def clean_stale_claims():
    """Remove claims older than CLAIM_TIMEOUT_SECONDS"""
    if not kv:
        return

    now = datetime.now()

    # Clean SQ claims
    sq_keys = kv.keys('sq:*')
    for key in sq_keys:
        data = kv.get(key)
        if data:
            try:
                claim = json.loads(data)
                claim_time = datetime.fromisoformat(claim['timestamp'])
                if (now - claim_time).total_seconds() > CLAIM_TIMEOUT_SECONDS:
                    kv.delete(key)
            except:
                pass

    # Clean Refund Log reservations
    refund_keys = kv.keys('refund:*')
    for key in refund_keys:
        data = kv.get(key)
        if data:
            try:
                reservation = json.loads(data)
                reservation_time = datetime.fromisoformat(reservation['timestamp'])
                if (now - reservation_time).total_seconds() > CLAIM_TIMEOUT_SECONDS:
                    kv.delete(key)
            except:
                pass

def try_claim_sq(bot_id, sq_number):
    """Try to claim an SQ for a bot"""
    if not kv:
        return {
            'success': False,
            'error': 'KV not configured. Set up Vercel KV in dashboard.'
        }

    clean_stale_claims()

    key = f'sq:{sq_number}'

    # Check if already claimed
    existing = kv.get(key)
    if existing:
        try:
            claim = json.loads(existing)
            if claim['status'] == 'CLAIMING':
                return {
                    'success': False,
                    'message': f"SQ {sq_number} already claimed by {claim['botId']}",
                    'claimedBy': claim['botId']
                }
        except:
            pass

    # Claim it
    claim = {
        'botId': bot_id,
        'timestamp': datetime.now().isoformat(),
        'status': 'CLAIMING'
    }

    # Set with expiration (auto-cleanup after timeout)
    if kv.set(key, json.dumps(claim), ex=CLAIM_TIMEOUT_SECONDS):
        return {
            'success': True,
            'message': f"Successfully claimed SQ {sq_number}",
            'sqNumber': sq_number,
            'botId': bot_id
        }
    else:
        return {
            'success': False,
            'error': 'Failed to write to KV'
        }

def release_sq(bot_id, sq_number):
    """Release an SQ claim"""
    if not kv:
        return {'success': False, 'error': 'KV not configured'}

    key = f'sq:{sq_number}'

    # Check ownership
    existing = kv.get(key)
    if not existing:
        return {
            'success': False,
            'message': f"No claim found for SQ {sq_number}"
        }

    try:
        claim = json.loads(existing)
        if claim['botId'] != bot_id:
            return {
                'success': False,
                'message': f"SQ {sq_number} claimed by {claim['botId']}, not {bot_id}"
            }
    except:
        pass

    # Mark as completed (keep for debugging)
    claim['status'] = 'COMPLETED'
    claim['completedAt'] = datetime.now().isoformat()
    kv.set(key, json.dumps(claim), ex=CLAIM_TIMEOUT_SECONDS)

    return {
        'success': True,
        'message': f"Released SQ {sq_number}"
    }

def reserve_refund_log_write(bot_id, sq_number, row_count, current_last_row=1):
    """
    Reserve rows in Refund Log - returns starting row number

    Args:
        bot_id: Bot identifier (e.g., 'BOT1')
        sq_number: SQ number being processed
        row_count: Number of rows needed
        current_last_row: Last used row from Refund Log sheet

    Returns:
        Starting row number for this reservation
    """
    if not kv:
        return {'success': False, 'error': 'KV not configured'}

    clean_stale_claims()

    # Calculate next available row
    next_row = current_last_row + 1

    # Find highest reserved row from active reservations
    refund_keys = kv.keys('refund:*')
    for key in refund_keys:
        data = kv.get(key)
        if data:
            try:
                reservation = json.loads(data)
                if reservation.get('status') != 'COMPLETED':
                    end_row = reservation['startRow'] + reservation['rowCount']
                    if end_row > next_row:
                        next_row = end_row
            except:
                pass

    # Create reservation
    reservation = {
        'botId': bot_id,
        'startRow': next_row,
        'rowCount': row_count,
        'status': 'WRITING',
        'timestamp': datetime.now().isoformat()
    }

    key = f'refund:{sq_number}'
    if kv.set(key, json.dumps(reservation), ex=CLAIM_TIMEOUT_SECONDS):
        return {
            'success': True,
            'startRow': next_row,
            'rowCount': row_count,
            'sqNumber': sq_number,
            'botId': bot_id
        }
    else:
        return {
            'success': False,
            'error': 'Failed to write reservation to KV'
        }

def release_refund_log_write(bot_id, sq_number):
    """Mark Refund Log reservation as completed"""
    if not kv:
        return {'success': False, 'error': 'KV not configured'}

    key = f'refund:{sq_number}'

    # Check ownership
    existing = kv.get(key)
    if not existing:
        return {
            'success': False,
            'message': f"No reservation found for SQ {sq_number}"
        }

    try:
        reservation = json.loads(existing)
        if reservation['botId'] != bot_id:
            return {
                'success': False,
                'message': f"Reservation for SQ {sq_number} owned by {reservation['botId']}, not {bot_id}"
            }
    except:
        pass

    # Mark as completed
    reservation['status'] = 'COMPLETED'
    reservation['completedAt'] = datetime.now().isoformat()
    kv.set(key, json.dumps(reservation), ex=CLAIM_TIMEOUT_SECONDS)

    return {
        'success': True,
        'message': f"Released Refund Log reservation for SQ {sq_number}"
    }

def get_queue_status():
    """Get current queue status (for debugging)"""
    if not kv:
        return {
            'success': False,
            'error': 'KV not configured. Visit Vercel dashboard to set up KV storage.'
        }

    clean_stale_claims()

    # Get all SQ claims
    sq_claims = {}
    sq_keys = kv.keys('sq:*')
    for key in sq_keys:
        data = kv.get(key)
        if data:
            try:
                sq_number = key.replace('sq:', '')
                sq_claims[sq_number] = json.loads(data)
            except:
                pass

    # Get all Refund Log reservations
    refund_reservations = {}
    refund_keys = kv.keys('refund:*')
    for key in refund_keys:
        data = kv.get(key)
        if data:
            try:
                sq_number = key.replace('refund:', '')
                refund_reservations[sq_number] = json.loads(data)
            except:
                pass

    return {
        'success': True,
        'sqClaims': sq_claims,
        'refundReservations': refund_reservations,
        'timestamp': datetime.now().isoformat(),
        'kvConfigured': True
    }

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
