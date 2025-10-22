"""
TCGplayer Direct PDF Parser
Serverless function for Vercel
"""
from http.server import BaseHTTPRequestHandler
import json
import re
import io
import base64

try:
    import pdfplumber
except ImportError:
    pdfplumber = None


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        """Handle PDF upload and parsing"""
        try:
            # Read request body
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            # Parse JSON body
            try:
                body = json.loads(post_data.decode('utf-8'))
                pdf_base64 = body.get('pdf')
                
                if not pdf_base64:
                    self.send_error_response(400, "Missing 'pdf' field in request body")
                    return
                
                # Decode base64 PDF
                pdf_bytes = base64.b64decode(pdf_base64)
                
            except json.JSONDecodeError:
                self.send_error_response(400, "Invalid JSON in request body")
                return
            except Exception as e:
                self.send_error_response(400, f"Error decoding PDF: {str(e)}")
                return
            
            # Check if pdfplumber is available
            if pdfplumber is None:
                self.send_error_response(500, "pdfplumber not installed")
                return
            
            # Parse PDF
            orders = self.parse_pdf(pdf_bytes)
            
            # Return JSON response
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            response = {
                'success': True,
                'orders': orders,
                'totalOrders': len(orders)
            }
            
            self.wfile.write(json.dumps(response).encode('utf-8'))
            
        except Exception as e:
            self.send_error_response(500, f"Internal server error: {str(e)}")
    
    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def send_error_response(self, code, message):
        """Send error response"""
        self.send_response(code)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        
        response = {
            'success': False,
            'error': message
        }
        
        self.wfile.write(json.dumps(response).encode('utf-8'))
    
    def parse_pdf(self, pdf_bytes):
        """Parse TCGplayer Direct PDF and extract orders"""
        orders = []
        
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            full_text = ""
            
            # Extract all text with positions
            for page_num, page in enumerate(pdf.pages):
                page_text = page.extract_text()
                if page_text:
                    full_text += page_text + "\n\n"
            
            # Find all order sections
            order_pattern = r'Direct by TCGplayer #\s*(\d{6}-[A-F0-9]{4})'
            order_matches = list(re.finditer(order_pattern, full_text))
            
            for i, match in enumerate(order_matches):
                order_num = match.group(1)
                start_pos = match.start()
                
                # Determine end position (start of next order or end of text)
                end_pos = order_matches[i + 1].start() if i + 1 < len(order_matches) else len(full_text)
                
                # Extract this order's section
                order_section = full_text[start_pos:end_pos]
                
                # Extract buyer name (billing person)
                buyer_name = self.extract_buyer_name(order_section, order_num)
                
                # Extract cards from this order
                cards = self.extract_cards(order_section)
                
                orders.append({
                    'orderNumber': order_num,
                    'buyerName': buyer_name,
                    'cards': cards,
                    'startPos': start_pos,
                    'endPos': end_pos
                })
        
        return orders
    
    def extract_buyer_name(self, order_text, order_num):
        """Extract billing person name from order section"""
        exclude_names = [
            'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged',
            'Billing Address', 'Shipping Address', 'Order Date', 'Direct by TCGplayer'
        ]
        
        # Pattern: Look for person name (no newlines between parts!) followed by street address
        # Use [ \t] instead of \s to exclude newlines within the name
        name_pattern = r'([A-Z][a-z]+(?:[ \t]+[A-Z]\'?[A-Za-z]+)+)\s*\n\s*(\d+[ \t]+[\w \t]+)'
        
        matches = list(re.finditer(name_pattern, order_text))
        
        # Get the last match (billing person, not shipping recipient)
        for match in reversed(matches):
            candidate_name = match.group(1).strip()
            
            # Skip if it contains excluded words
            if any(excluded in candidate_name for excluded in exclude_names):
                continue
            
            return candidate_name
        
        return None
    
    def extract_cards(self, order_text):
        """Extract card details from order section - robust multi-line handling"""
        cards = []
        seen_cards = set()  # Deduplicate by name+collector#
        
        # Pattern 1: With "Bin X" prefix - handles multiline set names
        pattern_bin = r'Bin\s+[\w\-]+\s+(\d+)\s+(.+?)\s+-\s+#(\d+)\s+-\s+(\w+)\s+-\s+(.+?)$'
        
        for match in re.finditer(pattern_bin, order_text, re.MULTILINE):
            # Get the line after this match to check for set name continuation
            match_end = match.end()
            next_line_start = match_end + 1
            next_line_end = order_text.find('\n', next_line_start)
            if next_line_end == -1:
                next_line_end = len(order_text)
            next_line = order_text[next_line_start:next_line_end].strip()
            
            condition = match.group(5).strip()
            set_name = ""
            
            # Check if condition has "Magic -" already
            if "Magic -" in condition:
                parts = condition.split("Magic -", 1)
                condition = parts[0].strip()
                set_name = parts[1].strip() if len(parts) > 1 else ""
            else:
                # Set name on next line
                if next_line and not next_line.startswith('Bin') and not re.match(r'^\d+\s+', next_line):
                    if "Magic -" in next_line:
                        set_name = next_line.split("Magic -", 1)[1].strip() if "Magic -" in next_line else next_line
                    else:
                        set_name = next_line
            
            card_key = f"{match.group(2)}|{match.group(3)}"
            if card_key not in seen_cards:
                seen_cards.add(card_key)
                cards.append({
                    'name': match.group(2).strip(),
                    'quantity': int(match.group(1)),
                    'condition': condition,
                    'setName': set_name,
                    'collectorNumber': match.group(3).strip(),
                    'rarity': match.group(4).strip()
                })
        
        # Pattern 2: Standard format (no Bin prefix)
        pattern_standard = r'(?<!Bin\s)(?<!\d\s)(\d+)\s+(.+?)\s+-\s+#(\d+)\s+-\s+(\w+)\s+-\s+(.+?)\s+Magic\s+-\s+(.+?)$'
        
        for match in re.finditer(pattern_standard, order_text, re.MULTILINE):
            card_key = f"{match.group(2)}|{match.group(3)}"
            if card_key not in seen_cards:
                seen_cards.add(card_key)
                cards.append({
                    'name': match.group(2).strip(),
                    'quantity': int(match.group(1)),
                    'condition': match.group(5).strip(),
                    'setName': match.group(6).strip(),
                    'collectorNumber': match.group(3).strip(),
                    'rarity': match.group(4).strip()
                })
        
        # Pattern 3: Extreme split case (card name on one line, Bin+qty on next)
        pattern_split = r'([A-Z][\w\s,\(\)]+?)\s+-\s+#(\d+)\s+-\s+(\w+)\s+-\s+([A-Za-z\s]+)$'
        
        for match in re.finditer(pattern_split, order_text, re.MULTILINE):
            match_end = match.end()
            next_line_start = match_end + 1
            next_line_end = order_text.find('\n', next_line_start)
            if next_line_end == -1:
                next_line_end = len(order_text)
            next_line = order_text[next_line_start:next_line_end].strip()
            
            bin_match = re.match(r'Bin\s+[\w\-]+\s+(\d+)\s+Magic\s+-\s+(.+)', next_line)
            if bin_match:
                card_key = f"{match.group(1)}|{match.group(2)}"
                if card_key not in seen_cards:
                    seen_cards.add(card_key)
                    cards.append({
                        'name': match.group(1).strip(),
                        'quantity': int(bin_match.group(1)),
                        'condition': match.group(4).strip(),
                        'setName': bin_match.group(2).strip(),
                        'collectorNumber': match.group(2).strip(),
                        'rarity': match.group(3).strip()
                    })
        
        return cards
