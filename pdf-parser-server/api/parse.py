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
        # Allow both capitalized and lowercase names
        name_pattern = r'([A-Za-z][a-z]+(?:[ \t]+[A-Za-z]\'?[A-Za-z]+)+)\s*\n\s*(\d+[ \t]+[\w \t]+)'
        
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

        # Preprocess: drop slot headers and table headers that can break patterns
        cleaned_lines = []
        for line in order_text.split('\n'):
            l = line.strip()
            if not l:
                continue
            # Skip slot header like "Slot C - Near Mint" or "Slot X - Lightly Played"
            if re.match(r'^Slot\s+[A-Z]\s+-\s+', l, flags=re.IGNORECASE):
                continue
            # Skip table header rows
            if re.match(r'^(SLOT\s+)?QTY\s+PRODUCT\s+NAME\s+SET\s+NAME$', l, flags=re.IGNORECASE):
                continue
            # Normalize leading slot code prefixes like 'K 1 ' or 'K-T 1 ' -> '1 '
            m_slot = re.match(r'^[A-Z](?:-[A-Z])?\s+(\d+)\s+(.*)$', l)
            if m_slot:
                l = f"{m_slot.group(1)} {m_slot.group(2)}".strip()
            cleaned_lines.append(l)
        order_text = '\n'.join(cleaned_lines)
        
        # Pattern 1: With "Bin X" prefix - handles multiline set names
        pattern_bin = r'Bin\s+[\w\-]+\s+(\d+)\s+(.+?)\s+-\s#([A-Za-z0-9/\-]+)\s+-\s+([A-Za-z ]+)\s+-\s+(.+?)$'
        
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
            
            # Generic "<Game> - <Set>" splitter on same line as condition
            m_line = re.match(r'^(.*?)\s+[A-Za-z]+\s+-\s+(.+)$', condition)
            if m_line:
                condition = m_line.group(1).strip()
                set_name = m_line.group(2).strip()
            else:
                # Set name may be on the next line; try to split "<Game> - <Set>"
                if next_line and not next_line.startswith('Bin') and not re.match(r'^\d+\s+', next_line):
                    m_next = re.match(r'^[A-Za-z]+\s+-\s+(.+)$', next_line)
                    set_name = m_next.group(1).strip() if m_next else next_line
            
            card_key = f"{match.group(2)}|{match.group(3)}|{condition}"
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
        # Matches: "1 CardName - #123 - R - Condition <Game> - Set" (Game can be Magic, Pokemon, etc.)
        # Allow game tokens with hyphens/apostrophes (e.g., Yu-Gi-Oh, Marvel's)
        pattern_standard = r'^(\d+)\s+(.+?)\s+-\s#([A-Za-z0-9/\-]+)\s+-\s+([A-Za-z ]+)\s+-\s+(.+?)\s+[A-Za-z\-\']+\s+-\s+(.+?)$'
        
        for match in re.finditer(pattern_standard, order_text, re.MULTILINE):
            condition = match.group(5).strip()
            card_key = f"{match.group(2)}|{match.group(3)}|{condition}"
            if card_key not in seen_cards:
                seen_cards.add(card_key)
                cards.append({
                    'name': match.group(2).strip(),
                    'quantity': int(match.group(1)),
                    'condition': condition,
                    'setName': match.group(6).strip(),
                    'collectorNumber': match.group(3).strip(),
                    'rarity': match.group(4).strip()
                })

        # Pattern 8: Card line without game/set on same line; look at adjacent line for "<Game> - <Set>"
        card_no_game = re.compile(r'^(?:[A-Z]\s+)?(\d+)\s+(.+?)\s+-\s#([A-Za-z0-9/\-]+)\s+-\s+([A-Za-z ]+)\s+-\s+(.+?)$')
        card_no_game_no_hash = re.compile(r'^(?:[A-Z]\s+)?(\d+)\s+(.+?)\s+-\s([A-Za-z0-9/\- ]+)\s+-\s+([A-Za-z ]+)\s+-\s+(.+?)$')
        game_set_line = re.compile(r"^(?:\d+\s+)?[A-Za-z\-']+\s+-\s+(.+)$")

        lines = order_text.split('\n')
        for i, line in enumerate(lines):
            m = card_no_game.match(line)
            m2 = card_no_game_no_hash.match(line)
            if not m and not m2:
                continue
            qty, name, col, rarity, condition = (m.groups() if m else m2.groups())
            # look previous then next for game-set
            set_name = ''
            if i-1 >= 0:
                gs = game_set_line.match(lines[i-1].strip())
                if gs:
                    set_name = gs.group(1).strip()
            if not set_name and i+1 < len(lines):
                gs = game_set_line.match(lines[i+1].strip())
                if gs:
                    set_name = gs.group(1).strip()
            # If the 'col' token looks like a rarity (e.g., 'U', 'C', 'R', 'M', 'Common', 'Uncommon', etc.),
            # then this line likely has NO collector number and the trailing token is actually the set name.
            rarity_alias = {
                'common': 'Common',
                'uncommon': 'Uncommon',
                'rare': 'Rare',
                'mythic': 'Mythic',
                'special': 'Special',
                'promo': 'Promo',
                'short print': 'Short Print',
                'secret rare': 'Secret Rare',
                'double rare': 'Double Rare',
                'illustration rare': 'Illustration Rare',
                'ultra rare': 'Ultra Rare',
                'holo rare': 'Holo Rare',
                'super rare': 'Super Rare'
            }
            col_l = col.strip().lower()
            col_is_letter_code = len(col.strip()) == 1 and col.strip().upper() in {'C','U','R','M','S'}
            col_is_word = col_l in rarity_alias
            if col_is_letter_code or col_is_word:
                # shift fields: rarity comes from 'col', condition from 'rarity', and 'condition' token is actually set
                mapped_rarity = col.strip().upper() if col_is_letter_code else rarity_alias[col_l]
                set_name = set_name or condition.strip()
                condition = rarity  # e.g., 'Lightly Played Magic'
                rarity = mapped_rarity
                col = ''  # no collector number present
            condition = condition.strip()
            # If condition still contains inline "<Game> - <Set>", split it
            m_inline = re.match(r"^(.*?)\s+[A-Za-z\-']+\s+-\s+(.+)$", condition)
            if m_inline:
                condition = m_inline.group(1).strip()
                set_name = m_inline.group(2).strip()
            # If condition ends with a lone game token (no dash), drop it
            for g in ("Magic", "Pokemon", "Yu-Gi-Oh", "Marvel's Spider-Man"):
                if condition.endswith(g):
                    condition = condition[: -len(g)].rstrip()
                    break
            # Clean set_name to remove any leading "Game - " prefix if present
            if set_name:
                set_name = re.sub(r"^[A-Za-z\-']+\s+-\s+", "", set_name).strip()
            card_key = f"{name}|{col}|{condition}"
            if card_key in seen_cards:
                continue
            seen_cards.add(card_key)
            cards.append({
                'name': name.strip(),
                'quantity': int(qty),
                'condition': condition,
                'setName': set_name,
                'collectorNumber': col.strip(),
                'rarity': rarity.strip()
            })

        # Pattern 9: Header line without quantity; next/prev line contains quantity and game-set
        # Example:
        #   Bitterblossom (Anime Borderless) (Confetti Foil) - #92 - M - Near Mint
        #   M-T 1 Magic - Wilds of Eldraine: Enchanting Tales
        #   Foil
        header_no_qty = re.compile(r'^(?![A-Z](?:-[A-Z])?\s+\d+\s)(?!\d+\s)(.+?)\s+-\s#([A-Za-z0-9/\-]+)\s+-\s+([A-Za-z ]+)\s+-\s+(.+?)$')
        header_no_qty_no_hash = re.compile(r'^(?![A-Z](?:-[A-Z])?\s+\d+\s)(?!\d+\s)(.+?)\s+-\s([A-Za-z0-9/\- ]+)\s+-\s+([A-Za-z ]+)\s+-\s+(.+?)$')
        for i, line in enumerate(lines):
            m = header_no_qty.match(line)
            m2 = header_no_qty_no_hash.match(line)
            if not m and not m2:
                continue
            name, col, rarity, condition = (m.groups() if m else m2.groups())
            qty = 1
            set_name = ''

            # Prefer inline Game - Set in the condition token
            m_inline = re.match(r"^(.*?)\s+[A-Za-z\-']+\s+-\s+(.+)$", condition.strip())
            if m_inline:
                condition = m_inline.group(1).strip()
                set_name = m_inline.group(2).strip()

            # If 'col' looks like a rarity code/word, shift fields (no collector number)
            rarity_alias = {
                'common': 'Common', 'uncommon': 'Uncommon', 'rare': 'Rare', 'mythic': 'Mythic',
                'special': 'Special', 'promo': 'Promo', 'short print': 'Short Print',
                'secret rare': 'Secret Rare', 'double rare': 'Double Rare',
                'illustration rare': 'Illustration Rare', 'ultra rare': 'Ultra Rare',
                'holo rare': 'Holo Rare', 'super rare': 'Super Rare'
            }
            col_l = col.strip().lower()
            col_is_letter_code = len(col.strip()) == 1 and col.strip().upper() in {'C','U','R','M','S','L','T'}
            col_is_word = col_l in rarity_alias
            if col_is_letter_code or col_is_word:
                mapped_rarity = col.strip().upper() if col_is_letter_code else rarity_alias[col_l]
                # If no inline set yet, try to treat current 'rarity' token as condition and 'condition' token as set
                if not set_name:
                    set_name = condition.strip()
                condition = rarity.strip()
                rarity = mapped_rarity
                col = ''  # ensure dedupe with other paths

            # Look next for quantity + game-set if set_name still empty
            if not set_name and i+1 < len(lines):
                nxt = lines[i+1].strip()
                m_slot = re.match(r"^[A-Z](?:-[A-Z])?\s+(\d+)\s+[A-Za-z\-']+\s+-\s+(.+)$", nxt)
                m_simple = re.match(r"^(\d+)\s+[A-Za-z\-']+\s+-\s+(.+)$", nxt)
                m_game = re.match(r"^[A-Za-z\-']+\s+-\s+(.+)$", nxt)
                if m_slot:
                    qty = int(m_slot.group(1))
                    set_name = m_slot.group(2).strip()
                elif m_simple:
                    qty = int(m_simple.group(1))
                    set_name = m_simple.group(2).strip()
                elif m_game:
                    set_name = m_game.group(1).strip()
            # Merge trailing 'Foil' line into condition if present
            if i+2 < len(lines):
                nxt2 = lines[i+2].strip()
                if nxt2.lower() == 'foil' and 'foil' not in condition.lower():
                    condition = (condition + ' Foil').strip()
                # If set_name looks truncated and next token is a short word continuation (e.g., 'Tales'), append it
                if set_name and nxt2 and ' - ' not in nxt2 and nxt2.lower() not in {'foil'} and not re.search(r'\d', nxt2) and len(nxt2) <= 20:
                    set_name = (set_name + ' ' + nxt2).strip()

            condition = condition.strip()
            # Remove trailing lone game token if stuck in condition
            for g in ("Magic", "Pokemon", "Yu-Gi-Oh", "Marvel's Spider-Man"):
                if condition.endswith(g):
                    condition = condition[: -len(g)].rstrip()
                    break
            # Clean set_name to remove any leading "Game - " prefix if present
            if set_name:
                set_name = re.sub(r"^[A-Za-z\-']+\s+-\s+", "", set_name).strip()
            card_key = f"{name}|{col}|{condition}"
            if card_key in seen_cards:
                continue
            seen_cards.add(card_key)
            cards.append({
                'name': name.strip(),
                'quantity': int(qty),
                'condition': condition,
                'setName': set_name,
                'collectorNumber': col.strip(),
                'rarity': rarity.strip()
            })
        
        # Cleanup: strip leading quantity that may have leaked into names like '1 Red Elemental Blast'
        if cards:
            for e in cards:
                e['name'] = re.sub(r'^\d+\s+', '', e['name']).strip()

        # Dedupe: prefer entries with non-empty setName or cleaner condition (no embedded 'Game - ')
        if cards:
            best = {}
            def score(entry):
                s = 0
                set_name = (entry.get('setName') or '')
                cond = (entry.get('condition') or '')
                if set_name:
                    s += 2
                    sn = set_name.lower()
                    # Penalize malformed/borrowed set names (contain '#', embedded dashes chain, or 'magic -')
                    if '#' in sn or ' - ' in sn or 'magic - ' in sn:
                        s -= 2
                if ' - ' not in cond:
                    s += 1
                return s
            for e in cards:
                key = (e['name'].lower().strip(), (e.get('collectorNumber') or '').lower().strip())
                if key not in best or score(e) > score(best[key]):
                    best[key] = e
            cards = list(best.values())

        # Pattern 3: Bin format WITHOUT collector number (e.g. "Bin 7 2 Raging Goblin - C - Lightly Played Magic - Portal")
        pattern_bin_no_num = r'Bin\s+[\w\-]+\s+(\d+)\s+(.+?)\s+-\s+([A-Za-z ]+)\s+-\s+(.+?)$'
        
        for match in re.finditer(pattern_bin_no_num, order_text, re.MULTILINE):
            # Skip if card name contains collector number (would be caught by pattern 1)
            if ' - #' in match.group(2):
                continue
                
            condition = match.group(4).strip()
            set_name = ""
            
            # Generic "<Game> - <Set>" splitter on same line as condition
            m_line = re.match(r'^(.*?)\s+[A-Za-z]+\s+-\s+(.+)$', condition)
            if m_line:
                condition = m_line.group(1).strip()
                set_name = m_line.group(2).strip()
            
            # Use card name + set + condition as key since no collector number
            card_key = f"{match.group(2)}|{set_name}|{condition}"
            if card_key not in seen_cards:
                seen_cards.add(card_key)
                cards.append({
                    'name': match.group(2).strip(),
                    'quantity': int(match.group(1)),
                    'condition': condition,
                    'setName': set_name,
                    'collectorNumber': '',  # No collector number
                    'rarity': match.group(3).strip()
                })
        
        # Pattern 4: Extreme split case (card name on one line, Bin+qty on next)
        # Handles cases where condition might be split across 3 lines
        # Use a broad name matcher to include apostrophes and punctuation; allow collector numbers with slashes
        pattern_split = r'^(.+?)\s+-\s#([A-Za-z0-9/\-]+)\s+-\s+([A-Za-z ]+)\s+-\s+([A-Za-z ]+)$'
        
        for match in re.finditer(pattern_split, order_text, re.MULTILINE):
            match_end = match.end()
            next_line_start = match_end + 1
            next_line_end = order_text.find('\n', next_line_start)
            if next_line_end == -1:
                next_line_end = len(order_text)
            next_line = order_text[next_line_start:next_line_end].strip()
            
            # Check if next line has Bin info
            bin_match = re.match(r'Bin\s+[\w\-]+\s+(\d+)\s+[A-Za-z]+\s+-\s+(.+)', next_line)
            if bin_match:
                # Condition from first line
                condition_part1 = match.group(4).strip()
                
                # Check if there's a third line with rest of condition
                third_line_start = next_line_end + 1
                third_line_end = order_text.find('\n', third_line_start)
                if third_line_end == -1:
                    third_line_end = len(order_text)
                third_line = order_text[third_line_start:third_line_end].strip()
                
                # If third line is a single word (like "Played"), append it to condition
                if third_line and not third_line.startswith('Bin') and not re.match(r'^\d+', third_line) and len(third_line.split()) <= 2:
                    full_condition = f"{condition_part1} {third_line}"
                else:
                    full_condition = condition_part1
                
                card_key = f"{match.group(1)}|{match.group(2)}|{full_condition}"
                if card_key not in seen_cards:
                    seen_cards.add(card_key)
                    cards.append({
                        'name': match.group(1).strip(),
                        'quantity': int(bin_match.group(1)),
                        'condition': full_condition,
                        'setName': bin_match.group(2).strip(),
                        'collectorNumber': match.group(2).strip(),
                        'rarity': match.group(3).strip()
                    })

        # Pattern 5: Split case where condition is absent on first line (e.g., ends with '-')
        # Example:
        #   Mondrak, Glory Dominus (Oil Slick Raised Foil) - #346 - M -
        #   Bin 8-T 1 Magic - Phyrexia: All Will Be One
        #   Lightly Played Foil
        pattern_split_no_cond = r'^(.+?)\s+-\s#([A-Za-z0-9/\-]+)\s+-\s+([A-Za-z ]+)\s+-\s*$'
        for match in re.finditer(pattern_split_no_cond, order_text, re.MULTILINE):
            match_end = match.end()
            next_line_start = match_end + 1
            next_line_end = order_text.find('\n', next_line_start)
            if next_line_end == -1:
                next_line_end = len(order_text)
            next_line = order_text[next_line_start:next_line_end].strip()

            bin_match = re.match(r'Bin\s+[\w\-]+\s+(\d+)\s+[A-Za-z]+\s+-\s+(.+)', next_line)
            if bin_match:
                # Condition expected on the following line
                third_line_start = next_line_end + 1
                third_line_end = order_text.find('\n', third_line_start)
                if third_line_end == -1:
                    third_line_end = len(order_text)
                third_line = order_text[third_line_start:third_line_end].strip()
                full_condition = third_line if third_line else ''

                card_key = f"{match.group(1)}|{match.group(2)}|{full_condition}"
                if card_key not in seen_cards:
                    seen_cards.add(card_key)
                    cards.append({
                        'name': match.group(1).strip(),
                        'quantity': int(bin_match.group(1)),
                        'condition': full_condition.strip(),
                        'setName': bin_match.group(2).strip(),
                        'collectorNumber': match.group(2).strip(),
                        'rarity': match.group(3).strip()
                    })

        # Pattern 6: Split case where the line with Bin information lacks the "Magic -" portion
        # Example:
        #   Hakbal ... - #19 - M - Lightly Magic - Commander: The Lost Caverns of
        #   Bin 8 1
        #   Played Foil Ixalan
        pattern_split_bin_simple = r'^(.+?)\s+-\s#([A-Za-z0-9/\-]+)\s+-\s+([A-Za-z ]+)\s+-\s+([A-Za-z]+)\s+[A-Za-z\-\']+\s+-\s+(.+)$'

        # Pattern 7: Slot-letter prefix quantity (e.g., "X 1 Pikachu ... - #027/078 - Common - Near Mint Pokemon - Pokemon GO")
        pattern_slotqty = r'^[A-Z](?:-[A-Z])?\s+(\d+)\s+(.+?)\s+-\s#([A-Za-z0-9/\-]+)\s+-\s+([A-Za-z ]+)\s+-\s+(.+?)\s+[A-Za-z\-\']+\s+-\s+(.+?)$'
        pattern_slotqty_no_hash = r'^[A-Z](?:-[A-Z])?\s+(\d+)\s+(.+?)\s+-\s([A-Za-z0-9/\-]+)\s+-\s+([A-Za-z ]+)\s+-\s+(.+?)\s+[A-Za-z\-\']+\s+-\s+(.+?)$'

        # Pattern 2b: Standard format without '#' before collector number (e.g., "1 Ditto - 132/165 - Rare - Near Mint Pokemon - Deck Exclusives")
        pattern_standard_no_hash = r'^(\d+)\s+(.+?)\s+-\s([A-Za-z0-9/\-]+)\s+-\s+([A-Za-z ]+)\s+-\s+(.+?)\s+[A-Za-z\-\']+\s+-\s+(.+?)$'
        condition_tokens_whitelist = {
            'near', 'mint', 'lightly', 'played', 'moderately', 'heavily', 'damaged', 'foil',
            'nm', 'lp', 'mp', 'hp', 'nif', 'lpf', 'mpf', 'nmf', 'good', 'excellent', 'poor',
            'signed', 'graded', 'pld', 'gd', 'ex', 'sp', 'pr', 'heavily', 'moderate', 'moderately', 'light'
        }
        for match in re.finditer(pattern_split_bin_simple, order_text, re.MULTILINE):
            match_end = match.end()
            next_line_start = match_end + 1
            next_line_end = order_text.find('\n', next_line_start)
            if next_line_end == -1:
                next_line_end = len(order_text)
            next_line = order_text[next_line_start:next_line_end].strip()

            bin_match = re.match(r'Bin\s+[\w\-]+\s+(\d+)', next_line)
            if bin_match:
                # Third line contains remaining condition + possible set tail
                third_line_start = next_line_end + 1
                third_line_end = order_text.find('\n', third_line_start)
                if third_line_end == -1:
                    third_line_end = len(order_text)
                third_line = order_text[third_line_start:third_line_end].strip()

                condition_part1 = match.group(4).strip()
                set_part1 = match.group(5).strip()

                additional_condition_tokens = []
                set_tail_tokens = []
                tokens = third_line.split()
                for token in tokens:
                    clean = re.sub(r'[^a-z]', '', token.lower())
                    if clean in condition_tokens_whitelist and not set_tail_tokens:
                        additional_condition_tokens.append(token)
                    else:
                        set_tail_tokens.append(token)

                condition_tokens = [condition_part1] + additional_condition_tokens
                full_condition = ' '.join(condition_tokens).strip()

                if set_tail_tokens:
                    full_set = f"{set_part1} {' '.join(set_tail_tokens)}".strip()
                else:
                    full_set = set_part1

                card_key = f"{match.group(1)}|{match.group(2)}|{full_condition}"
                if card_key not in seen_cards:
                    seen_cards.add(card_key)
                    cards.append({
                        'name': match.group(1).strip(),
                        'quantity': int(bin_match.group(1)),
                        'condition': full_condition,
                        'setName': full_set,
                        'collectorNumber': match.group(2).strip(),
                        'rarity': match.group(3).strip()
                    })

        # Iterate Pattern 2b (no '#')
        for match in re.finditer(pattern_standard_no_hash, order_text, re.MULTILINE):
            condition = match.group(5).strip()
            card_key = f"{match.group(2)}|{match.group(3)}|{condition}"
            if card_key not in seen_cards:
                seen_cards.add(card_key)
                cards.append({
                    'name': match.group(2).strip(),
                    'quantity': int(match.group(1)),
                    'condition': condition,
                    'setName': match.group(6).strip(),
                    'collectorNumber': match.group(3).strip(),
                    'rarity': match.group(4).strip()
                })
        
        return cards
