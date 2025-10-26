"""
Vercel Queue Management API for Helper Doc Coordination

Endpoints:
- POST /api/queue - Manage SQ claims and Refund Log reservations

All coordination is stateless using timestamp-based locking.
"""

from http.server import BaseHTTPRequestHandler
import json
from datetime import datetime, timedelta
import os

# In-memory storage (persists during Vercel function lifetime)
# For production, consider Vercel KV or Redis
_queue_storage = {
    'sq_claims': {},      # {sqNumber: {botId, timestamp, status}}
    'refund_reservations': {}  # {sqNumber: {botId, startRow, rowCount, timestamp}}
}

CLAIM_TIMEOUT_SECONDS = 600  # 10 minutes

def clean_stale_claims():
    """Remove claims older than CLAIM_TIMEOUT_SECONDS"""
    now = datetime.now()

    # Clean SQ claims
    stale_sqs = []
    for sq_number, claim in _queue_storage['sq_claims'].items():
        claim_time = datetime.fromisoformat(claim['timestamp'])
        if (now - claim_time).total_seconds() > CLAIM_TIMEOUT_SECONDS:
            stale_sqs.append(sq_number)

    for sq in stale_sqs:
        del _queue_storage['sq_claims'][sq]

    # Clean Refund Log reservations
    stale_refunds = []
    for sq_number, reservation in _queue_storage['refund_reservations'].items():
        reservation_time = datetime.fromisoformat(reservation['timestamp'])
        if (now - reservation_time).total_seconds() > CLAIM_TIMEOUT_SECONDS:
            stale_refunds.append(sq_number)

    for sq in stale_refunds:
        del _queue_storage['refund_reservations'][sq]

def try_claim_sq(bot_id, sq_number):
    """Try to claim an SQ for a bot"""
    clean_stale_claims()

    # Check if already claimed
    if sq_number in _queue_storage['sq_claims']:
        claim = _queue_storage['sq_claims'][sq_number]
        if claim['status'] == 'CLAIMING':
            return {
                'success': False,
                'message': f"SQ {sq_number} already claimed by {claim['botId']}",
                'claimedBy': claim['botId']
            }

    # Claim it
    _queue_storage['sq_claims'][sq_number] = {
        'botId': bot_id,
        'timestamp': datetime.now().isoformat(),
        'status': 'CLAIMING'
    }

    return {
        'success': True,
        'message': f"Successfully claimed SQ {sq_number}",
        'sqNumber': sq_number,
        'botId': bot_id
    }

def release_sq(bot_id, sq_number):
    """Release an SQ claim"""
    if sq_number not in _queue_storage['sq_claims']:
        return {
            'success': False,
            'message': f"No claim found for SQ {sq_number}"
        }

    claim = _queue_storage['sq_claims'][sq_number]
    if claim['botId'] != bot_id:
        return {
            'success': False,
            'message': f"SQ {sq_number} claimed by {claim['botId']}, not {bot_id}"
        }

    # Mark as completed (don't delete immediately - helps with debugging)
    _queue_storage['sq_claims'][sq_number]['status'] = 'COMPLETED'
    _queue_storage['sq_claims'][sq_number]['completedAt'] = datetime.now().isoformat()

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
        current_last_row: Last used row from Refund Log sheet (passed by caller)

    Returns:
        Starting row number for this reservation
    """
    clean_stale_claims()

    # Calculate next available row based on:
    # 1. Current last row in sheet (passed by caller)
    # 2. Existing active reservations
    next_row = current_last_row + 1

    # Find highest reserved row from active reservations
    for reservation in _queue_storage['refund_reservations'].values():
        if reservation.get('status') != 'COMPLETED':
            end_row = reservation['startRow'] + reservation['rowCount']
            if end_row > next_row:
                next_row = end_row

    # Create reservation
    _queue_storage['refund_reservations'][sq_number] = {
        'botId': bot_id,
        'startRow': next_row,
        'rowCount': row_count,
        'status': 'WRITING',
        'timestamp': datetime.now().isoformat()
    }

    return {
        'success': True,
        'startRow': next_row,
        'rowCount': row_count,
        'sqNumber': sq_number,
        'botId': bot_id
    }

def release_refund_log_write(bot_id, sq_number):
    """Mark Refund Log reservation as completed (don't delete - helps with debugging)"""
    if sq_number not in _queue_storage['refund_reservations']:
        return {
            'success': False,
            'message': f"No reservation found for SQ {sq_number}"
        }

    reservation = _queue_storage['refund_reservations'][sq_number]
    if reservation['botId'] != bot_id:
        return {
            'success': False,
            'message': f"Reservation for SQ {sq_number} owned by {reservation['botId']}, not {bot_id}"
        }

    # Mark as completed (don't delete - helps calculate next row correctly)
    _queue_storage['refund_reservations'][sq_number]['status'] = 'COMPLETED'
    _queue_storage['refund_reservations'][sq_number]['completedAt'] = datetime.now().isoformat()

    return {
        'success': True,
        'message': f"Released Refund Log reservation for SQ {sq_number}"
    }

def get_queue_status():
    """Get current queue status (for debugging)"""
    clean_stale_claims()

    return {
        'success': True,
        'sqClaims': _queue_storage['sq_claims'],
        'refundReservations': _queue_storage['refund_reservations'],
        'timestamp': datetime.now().isoformat()
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
