# 🤖 Automation Requirements for Pull Discrep Refunds

**Created:** October 22, 2025  
**Purpose:** Document requirements for automating the refund processing workflow

---

## 📋 Current Manual Process

1. **Pull Sheet Access** → Manual download from TCGplayer Admin Panel
2. **Discrepancy Log** → Copy missing cards (columns C-J)
3. **Open Sheet in Browser** → View downloaded pull sheet
4. **Card Search** → Use Ctrl+F to find each card in the sheet
5. **Order Matching** → Manual lookup of order # and buyer name
6. **Refund Log** → Manual copy/paste (columns H-Q)
7. **Solve Date** → Manual update in Discrepancy Log

**Issues:** Time-consuming, copy/paste errors, missing names, not scalable

---

## 🎯 Proposed Architecture

```
Discrepancy Log → Apps Script Bot → TCGplayer API → Refund Log
                       ↓                  ↓
                  Read SQ #s      Get All Orders in SQ
                                        ↓
                                  Write Results
```

**How It Works:**
1. Bot reads Discrepancy Log for unsolved cards
2. For each SQ number, calls TCGplayer internal API
3. API returns all orders in that SQ (with buyer names and card details)
4. Bot matches cards from Discrepancy Log to orders and writes to Refund Log
5. Bot updates Discrepancy Log with solve date

---

## 📋 What We Need

### 1. TCGplayer Internal API Endpoint

**Example Endpoint:** `GET /api/internal/orders/by-sq/{sq_number}`

**Request Example:**
```
GET /api/internal/orders/by-sq/251013-236rmb
```

**Response:**
```json
{
  "sq_number": "251013-236rmb",
  "orders": [
    {
      "direct_order_number": "251012-2179",
      "buyer_name": "Buyer Name",
      "cards": [
        {
          "card_name": "Copperline Gorge",
          "quantity": 1,
          "condition": "Near Mint",
          "set_name": "Commander: Bloomburrow",
          "collector_number": "301",
          "rarity": "R"
        }
      ]
    },
    {
      "direct_order_number": "251012-2180",
      "buyer_name": "Another Buyer",
      "cards": [
        {
          "card_name": "Another Card",
          "quantity": 1,
          "condition": "Lightly Played",
          "set_name": "Another Set",
          "collector_number": "123",
          "rarity": "M"
        }
      ]
    }
  ]
}
```

### 2. Google Apps Script Bot

**Purpose:** Automate the entire workflow from Discrepancy Log to Refund Log

**Technical Approach:**
```javascript
function processRefunds() {
  // 1. Read Discrepancy Log
  const discrepLog = SpreadsheetApp.openById(DISCREP_LOG_ID);
  const unsolvedItems = getUnsolvedItems(discrepLog);
  
  // 2. Call API for each SQ number
  unsolvedItems.forEach(item => {
    const sqNumber = item.sqNumber;
    const apiResponse = callTCGPlayerAPI(sqNumber);
    
    // 3. Match cards from Discrepancy Log to API orders
    const matchedOrder = findMatchingOrder(item, apiResponse.orders);
    
    // 4. Write to Refund Log
    writeToRefundLog(matchedOrder, item);
    
    // 5. Update Discrepancy Log
    markAsSolved(item);
  });
}
```

**Features:**
- Reads Google Sheets (Discrepancy Log)
- Calls TCGplayer internal API via `UrlFetchApp`
- Card matching logic (name, condition, set, quantity)
- Writes results to Refund Log
- Updates Discrepancy Log with solve date
- Error handling for missing data or API failures
- Logging for audit trail

**Dependencies:**
- Google Apps Script (built-in to Google Sheets)
- TCGplayer API endpoint (from Engineering)
- Access to Discrepancy Log and Refund Log spreadsheets

**Estimated Throughput:**
- **~2-4 seconds per SQ number** (API call + matching all cards + writing)
- **15-30 SQ numbers per minute**
- **150-300 cards per minute** (assuming ~10 cards per SQ on average)
- **~6,000-8,000 cards per hour** (accounting for Google Sheets API limits)
- Typical batch (50-100 cards across 5-10 SQs): **20-40 seconds**

**Rate Limit Considerations:**
- Google Sheets API: 500 write requests per 100 seconds per project
- Mitigation: Batch write operations (write multiple rows per API call)
- Apps Script execution: 6-minute max runtime per execution
- For large batches: Process in chunks with brief pauses to stay within quotas

*Note: Actual speed depends on API response time, network latency, and Google Sheets quotas. One API call per SQ processes all cards in that shipment, making this extremely efficient for batches with multiple cards per SQ.*
