# Bot Manager System - Claude Code Guide

## System Overview

This is a **TCGplayer Discrepancy Refund Processing System** that automates processing of shipping discrepancies (SQs) using batch processing. The system consists of:

1. **Google Apps Script Web App** - Queue manager and batch processor
2. **Bot Manager UI** - Web interface for batch SQ processing (20 at a time)
3. **Convex Backend** - Real-time atomic queue coordination
4. **Vercel PDF Parser** - Serverless API for extracting order data from PDFs
5. **Google Sheets** - Discrepancy Log, Refund Log, and Helper Doc (single bot)

## Architecture

```
┌─────────────────┐      HTTP POST      ┌──────────────────────┐
│  Bot Manager UI │ ───────────────────> │  Apps Script Web App │
│  (Batch Mode)   │                      │  (Batch Processor)   │
│  - 20 SQs batch │                      │  - Claim 20 SQs      │
│  - 1 at a time  │                      │  - Process iterative │
└─────────────────┘                      └──────────────────────┘
                                                   │
                                                   │ Reads/Writes
                     ┌─────────────────────────────┼─────────────────────────┐
                     │                             │                         │
                     ▼                             ▼                         ▼
         ┌─────────────────────┐      ┌─────────────────────┐   ┌─────────────────────┐
         │ Discrepancy Log     │      │ Helper Doc (1)      │   │ Refund Log          │
         │ - SQ data           │      │ - BATCH_BOT         │   │ - Final output      │
         │ - Queue tracking    │      │ - 20 SQs at once    │   │ - Batch uploads     │
         └─────────────────────┘      └─────────────────────┘   └─────────────────────┘
                                                   │
                                                   │ Formulas pull from
                                                   ▼
                                         ┌─────────────────────┐
                                         │ TCGplayer SQ System │
                                         │ (External Data)     │
                                         └─────────────────────┘

         ┌──────────────────────────────────────────────────────┐
         │            ATOMIC QUEUE COORDINATION                 │
         │  ┌────────────────┐         ┌──────────────────┐    │
         │  │ Convex Backend │ <────── │ Apps Script      │    │
         │  │ (.convex.site) │         │ tryReserveSQ()   │    │
         │  │                │         │ (20x per batch)  │    │
         │  └────────────────┘         └──────────────────┘    │
         └──────────────────────────────────────────────────────┘

         ┌──────────────────────────────────────────────────────┐
         │            PDF PARSING SERVICE                       │
         │  ┌────────────────┐         ┌──────────────────┐    │
         │  │ Vercel API     │ <────── │ Apps Script      │    │
         │  │ (pdfplumber)   │         │ processPDFUpload()│    │
         │  └────────────────┘         └──────────────────┘    │
         └──────────────────────────────────────────────────────┘
```

## Critical Files

### Google Apps Script (Deployed to Discrepancy Log Spreadsheet)

- **`scripts/QueueManagerService_WebApp.gs`** - Main server logic
  - Queue management with atomic locking
  - SQ claiming and completion tracking
  - PDF processing and data matching
  - Refund Log upload
  - Session management (10-min activity-based timeout)

- **`scripts/BotManagerUI.html`** - Web UI for bot operators
  - Bot selection interface
  - SQ pull and claim workflow
  - PDF upload and manual data entry
  - Status monitoring

### Convex Backend

- **`convex-backend/convex/http.ts`** - HTTP endpoints for queue coordination
- **`convex-backend/convex/schema.ts`** - Database schema
- **`convex-backend/.env.local`** - Environment configuration

### PDF Parser (Vercel)

- **`pdf-parser/api/parse.py`** - Python pdfplumber-based PDF extraction

### Documentation

- **`README.md`** - Project overview and daily workflow
- **`CONVEX_SETUP.md`** - Convex deployment and troubleshooting
- **`APPS_SCRIPT_DEPLOYMENT.md`** - Step-by-step deployment instructions

## Important Technical Patterns

### 1. Session Management (Activity-Based Timeout)

**Pattern**: 10-minute inactivity timeout with automatic renewal on user actions

**Implementation**:
```javascript
// Touch session on ANY user action
function touchBotSession(botId) {
  // Updates timestamp in BOTS sheet
  // Called from: pullNextSQ, processPDFUpload, uploadToRefundLog, etc.
}
```

**Key Functions**:
- `acquireBotSession(botId)` - Claim exclusive bot access
- `releaseBotSession(botId)` - Release when done
- `renewBotSession(botId)` - Heartbeat (every 2 min from UI)
- `touchBotSession(botId)` - Reset timeout on activity
- `forceReleaseBotSession(botId)` - Admin override

**Locations**:
- `QueueManagerService_WebApp.gs:1655-1844`

### 2. Helper Doc as Single Source of Truth

**Pattern**: All SQ data flows through Helper Doc before final upload

**Why**: Helper Doc has formulas that fetch order/buyer data from TCGplayer SQ system. We write to it, let formulas populate, then read back complete data.

**Flow**:
1. `pullNextSQ()` writes card data to Helper Doc columns J-Q
2. Wait 2 seconds for formulas to load
3. Read back columns H-Q (now includes order/buyer from formulas)
4. Return complete data array to UI
5. `uploadToRefundLog()` reads from Helper Doc and writes to Refund Log

**Critical**: Helper Doc columns are 0-indexed in code but 1-indexed in Google Sheets:
```javascript
HELPER_COLS: {
  ORDER_NUMBER: 7,   // Column H (index 7)
  BUYER_NAME: 8,     // Column I (index 8)
  SQ_NUMBER: 9,      // Column J (index 9)
  GAME: 10,          // Column K (index 10)
  CARD_NAME: 11,     // Column L (index 11)
  // ... etc
}
```

### 3. Atomic Queue Coordination with Convex

**Pattern**: Prevent race conditions when multiple bots try to claim same SQ

**Flow**:
```javascript
// BOT1 tries to claim SQ 251019-200rpb
tryReserveSQ('BOT1', '251019-200rpb')
  → POST to https://energized-spoonbill-94.convex.site/bot-manager/try-claim-sq
  → Convex checks if already claimed
  → Returns {success: true} if available
  → BOT1 proceeds to write initials to Discrepancy Log

// BOT2 tries to claim SAME SQ
tryReserveSQ('BOT2', '251019-200rpb')
  → POST to Convex
  → Convex rejects: {success: false, message: "Already claimed by BOT1"}
  → BOT2 moves to next SQ
```

**Critical URLs**:
- ❌ `.convex.cloud` - For database queries/mutations ONLY
- ✅ `.convex.site` - For HTTP routes called from Apps Script

**Locations**:
- `QueueManagerService_WebApp.gs:528-631` (tryReserveSQ, releaseSQ)
- `convex-backend/convex/http.ts`

### 4. PDF Parsing with Multi-Level Card Matching

**Pattern**: Sophisticated matching to handle variations in card names, sets, conditions

**Matching Levels** (in order of preference):
1. **Exact Match**: Name + Set + Condition all match exactly
2. **Fallback Match**: Name + Set match, but condition differs (still accepts)
3. **Collector Number Match**: Collector# matches + (Set OR Name) matches

**Normalization**:
- Card Names: Case-insensitive, punctuation-insensitive, parentheticals-stripped
- Set Names: "Holofoil" removed, case-insensitive, partial matches allowed
- Collector Numbers: Leading zeros removed, fractional format normalized (0307/123 → 307/123)
- Conditions: NM1/NMH/NMRH → "nm", LP/LPF/LPH → "lp", etc.

**Locations**:
- `QueueManagerService_WebApp.gs:1261-1418` (normalization functions)
- `QueueManagerService_WebApp.gs:1349-1419` (findMatchingOrder)

### 5. Multi-Row SQ Handling

**Pattern**: An SQ can contain multiple cards (1 to 100+ rows)

**Critical**: ALL rows for an SQ must be processed together:
1. `pullNextSQ()` returns **array** of items, not single object
2. PDF parsing matches each row individually (different orders possible)
3. Manual data entry shows form for each row with missing data
4. `uploadToRefundLog()` writes all rows to Refund Log in one batch

**Example**:
```javascript
// SQ 251019-200rpb has 25 cards
currentSQ = [
  {sqNumber: "251019-200rpb", cardName: "Lightning Bolt", orderNumber: "12345", ...},
  {sqNumber: "251019-200rpb", cardName: "Counterspell", orderNumber: "12345", ...},
  // ... 23 more items
]

// Upload writes 25 rows to Refund Log
uploadToRefundLog(botId, sqNumber) → Writes 25 rows starting at row 1523
```

## Common Commands

### Deployment

```bash
# Deploy Convex Backend
cd convex-backend
npx convex dev  # Development mode (auto-redeploy)
npx convex deploy  # Production deployment

# Test Convex HTTP Endpoints
curl -X POST https://energized-spoonbill-94.convex.site/bot-manager/try-claim-sq \
  -H "Content-Type: application/json" \
  -d '{"botId":"TEST","sqNumber":"TEST123"}'
```

### Apps Script Deployment

1. Open Discrepancy Log → Extensions → Apps Script
2. Replace code with `scripts/QueueManagerService_WebApp.gs` and `scripts/BotManagerUI.html`
3. Deploy → Manage deployments → Edit (pencil icon)
4. Version → New version → Deploy
5. Copy Web App URL (used in `.env.local` as `NEXT_PUBLIC_APPS_SCRIPT_URL`)

**Deployment URL**:
```
https://script.google.com/a/macros/ebay.com/s/AKfycby0zYE3szCMq7Z1MYzPOIwdCCrYDyU58D8JIFclx5cDoucbpf2lJG3o-5v-wwsDQTQcfQ/exec
```

## Critical Gotchas

### 1. Convex URL Domains

**Problem**: Using wrong domain causes HTTP 404 errors

**Solution**:
- HTTP Routes (Apps Script): `https://energized-spoonbill-94.convex.site`
- Queries/Mutations (UI Dashboard): `https://energized-spoonbill-94.convex.cloud`

**Symptoms**: `SyntaxError: Unexpected end of JSON input` in Apps Script logs

### 2. Data Serialization Through Apps Script

**Problem**: Apps Script's `google.script.run` has strict limits on object complexity

**Solution**: Always return simple objects with primitive values. Avoid deeply nested structures.

**Example**:
```javascript
// ❌ BAD - Complex nested object
return {
  sqData: {
    items: [{card: {name: "...", set: {...}}}]
  }
};

// ✅ GOOD - Flat array of simple objects
return {
  sqData: [
    {cardName: "Lightning Bolt", setName: "Alpha", orderNumber: "12345"},
    {cardName: "Counterspell", setName: "Alpha", orderNumber: "12345"}
  ]
};
```

### 3. Helper Doc Column Indices

**Problem**: Code uses 0-based array indices, but Google Sheets uses 1-based column numbers

**Solution**: Always refer to `HELPER_COLS` config and use `getRange(row, col+1)` for writes

**Example**:
```javascript
// Config (0-based)
ORDER_NUMBER: 7  // Column H

// When writing to sheet (add 1)
helperSheet.getRange(rowNum, 8).setValue(orderNumber);  // Column H = index 7, getRange uses 8
```

### 4. Session Lost During Long Operations

**Problem**: 10-minute timeout can expire during PDF upload or manual data entry

**Solution**: `touchBotSession()` is called at start of ALL user actions:
- `pullNextSQ()`
- `processPDFUpload()`
- `uploadToRefundLog()`
- `syncManualDataToHelper()`
- `syncAllItemsToHelper()`

Plus UI sends heartbeat every 2 minutes via `renewBotSession()`

### 5. Manual Entry Form Showing All Rows

**Problem**: PDF parsing updated Helper Doc but UI didn't get fresh data

**Solution**: Server MUST return `updatedItems` array in `processPDFUpload()` response:
```javascript
return {
  success: true,
  updatedItems: result.updatedItems || []  // Critical!
};
```

UI then replaces `currentSQ` with this array and filters for missing fields.

**Location**: `QueueManagerService_WebApp.gs:1177`

## Daily Workflow (Batch Mode)

### Step 1: Claim Batch (20 SQs at once)
1. **User Opens Bot Manager UI**
   - URL: Apps Script Web App URL
   - Single-bot batch processing interface

2. **Claim Next 20 SQs**
   - User clicks "Claim Next 20 SQs" button
   - Calls `pullNextBatchOfSQs('BATCH_BOT', 20)`
   - System claims 20 SQs atomically via Convex (loops tryReserveSQ 20 times)
   - Writes ALL 20 SQs to Helper Doc **grouped by SQ number**
   - Helper Doc layout:
     ```
     Row 3-5:   SQ 251019-200rpb (3 cards)
     Row 6-8:   SQ 251019-201abc (3 cards)
     Row 9-15:  SQ 251019-202xyz (7 cards)
     ... (17 more SQs)
     ```
   - Returns array of SQ objects with metadata: `[{sqNumber, sqLink, rowCount, rows}, ...]`
   - UI stores batch in sessionStorage (survives page refresh)

### Step 2: Process Each SQ (1 at a time)
3. **Navigate Through SQs**
   - UI shows: "Processing SQ 1 of 20"
   - Displays current SQ's card data (first row preview)
   - Auto-opens SQ link in new tab
   - Shows "Next SQ" button (disabled until current SQ complete)

4. **Upload PDF for Current SQ (Optional)**
   - User uploads SQ details PDF
   - Vercel API parses PDF
   - `processPDFUpload()` matches cards and fills Helper Doc
   - Returns `updatedItems` array with per-row data
   - UI updates current SQ's rows in memory
   - UI shows manual entry form for any rows still missing Order/Buyer

5. **Manual Entry (If Needed)**
   - Shows form for ONLY current SQ's rows with missing order/buyer
   - User enters data per row
   - Calls `syncAllItemsToHelper()` to update Helper Doc
   - UI enables "Next SQ" button when all fields complete

6. **Next SQ**
   - User clicks "Next SQ" button
   - Increments to next SQ in batch
   - Auto-opens next SQ link
   - Repeats steps 3-6 until all 20 SQs processed

### Step 3: Upload Batch (All 20 SQs at once)
7. **Upload All to Refund Log**
   - After processing all 20 SQs, UI shows upload screen
   - Displays summary: "Upload 150 rows from 20 SQs"
   - User clicks "Upload All to Refund Log"
   - Calls `uploadBatchToRefundLog('BATCH_BOT', [all 20 sqNumbers])`
   - Reads ALL rows from Helper Doc (for all 20 SQs)
   - Writes to Refund Log in single batch (150+ rows at once)
   - Releases all 20 SQs from Convex queue
   - Clears Helper Doc
   - Resets UI for next batch

8. **Start New Batch**
   - User clicks "Start New Batch"
   - Returns to Step 1
   - Ready to claim next 20 SQs

## Configuration

### Sheet IDs

```javascript
// In QueueManagerService_WebApp.gs
DISCREP_LOG_ID: '1m0dSOA2VogToEpAo6Jj7FEEsfJbWi1W48xiyTHkBNyY'
REFUND_LOG_ID: '1raaUEsPoMl5dEZwilnHtBwdR0wOV2JRqYzdlVYMdohI'

HELPER_DOCS: {
  'BATCH_BOT': '1VcpaoXllWGTB3APt9Gjhi4-D_1XUH4qldWiZYQlYoH0'  // Use BOT1's Helper Doc for batch processing
}
```

**Note**: System now uses single Helper Doc for batch processing (BATCH_BOT). The old BOT1-5 Helper Docs are no longer needed.

### Environment Variables

```bash
# convex-backend/.env.local
CONVEX_DEPLOYMENT=dev:energized-spoonbill-94
NEXT_PUBLIC_CONVEX_URL=https://energized-spoonbill-94.convex.cloud  # Queries
CONVEX_HTTP_URL=https://energized-spoonbill-94.convex.site          # HTTP routes
NEXT_PUBLIC_APPS_SCRIPT_URL=https://script.google.com/a/macros/ebay.com/s/AKfycby...
NEXT_PUBLIC_APPS_SCRIPT_API_KEY=bot-manager-secret-key-change-this-12345
```

## Troubleshooting

### "Bot is already in use"
- **Cause**: Session lock still active (< 10 min since last activity)
- **Solution**: Wait for timeout OR use "Force Release" option in prompt

### "No unclaimed SQs available"
- **Cause**: All SQs either claimed, solved, or flagged for manual intervention
- **Check**: Discrepancy Log for rows without initials, solve date, or manual flag

### "Failed to acquire lock"
- **Cause**: Too many concurrent operations, LockService timeout
- **Solution**: Wait a few seconds and retry

### "Unexpected end of JSON input" in Apps Script logs
- **Cause**: Using `.convex.cloud` instead of `.convex.site` for HTTP routes
- **Solution**: Update `CONVEX_URL` in `QUEUE_CONFIG` to use `.convex.site`

### Only 1 row uploaded to Refund Log (should be 25+)
- **Cause**: `pullNextSQ()` not returning array OR `uploadToRefundLog()` not handling array
- **Solution**: Verify `pullNextSQ()` returns `sqData` as array AND `uploadToRefundLog()` uses `Array.isArray(sqData) ? sqData : [sqData]`

### PDF Upload Shows All Rows in Manual Entry (Not Just Missing)
- **Cause**: Server not returning `updatedItems` in `processPDFUpload()` response
- **Solution**: Add `updatedItems: result.updatedItems || []` to return statement (line 1177)

## Testing

### Local Testing (Convex)
```bash
cd convex-backend
npx convex dev
# Open http://localhost:3000 to test mutations/queries
```

### Apps Script Testing
1. Open Apps Script Editor
2. Select function from dropdown (e.g., `pullNextSQ`)
3. Click Run (▶️)
4. Check Execution log for output
5. Use `Logger.log()` for debugging

### End-to-End Testing
1. Open Bot Manager UI
2. Select BOT1
3. Pull SQ → Verify SQ data displays
4. Upload PDF → Check Execution logs for match count
5. Upload to Refund Log → Verify correct row count in Refund Log sheet

## Future Improvements

1. **Create BOT4 and BOT5 Helper Docs**: Duplicate existing Helper Docs and update IDs in config
2. **Add Bulk Upload**: Process multiple SQs in batch mode
3. **Dashboard Analytics**: Track bot performance, processing times, match rates
4. **Error Recovery**: Auto-retry failed uploads, handle partial completions
5. **Notification System**: Alert when bots idle or errors occur

## Key Metrics

- **Session Timeout**: 10 minutes of inactivity
- **Heartbeat Interval**: 2 minutes (UI → Server)
- **Lock Timeout**: 30 seconds max wait for LockService
- **Stale Cleanup**: Sessions older than 10 minutes auto-removed
- **Helper Doc Wait**: 2 seconds for formulas to populate
- **Concurrent Bots**: 5 (BOT1-BOT5)

## Support

For issues or questions:
1. Check execution logs in Apps Script Editor
2. Review `APPS_SCRIPT_DEPLOYMENT.md` for deployment issues
3. Review `CONVEX_SETUP.md` for Convex issues
4. Check browser console for UI errors
5. Verify sheet IDs and permissions

---

**Last Updated**: 2025-10-27
**System Version**: 2.0 (5-bot expansion with activity-based sessions)
