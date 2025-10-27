# Apps Script Deployment Instructions

## Critical Fixes Required in Deployed Apps Script

### Fix 1: Update Convex URL
**Problem**: Using wrong domain for HTTP routes (`.convex.cloud` instead of `.convex.site`)

### Fix 2: Return All Items from pullNextSQ
**Problem**: Only returning first item's data instead of all rows for the SQ, causing only 1 row to upload to Refund Log

### Fix 3: Handle Multiple Rows in uploadToRefundLog
**Problem**: Function not handling arrays of items properly

## Deployment Steps

### Step 1: Open Apps Script Editor

1. **Open the Discrepancy Log Spreadsheet**
   - URL: https://docs.google.com/spreadsheets/d/1m0dSOA2VogToEpAo6Jj7FEEsfJbWi1W48xiyTHkBNyY

2. **Open Apps Script Editor**
   - Click: **Extensions** → **Apps Script**

### Step 2: Copy Updated Script

**IMPORTANT**: The local file `/Users/mpwright/Discrep/scripts/QueueManagerService_WebApp.gs` has been updated with ALL fixes.

**Option A (Recommended)**: Replace the entire script
1. Open `/Users/mpwright/Discrep/scripts/QueueManagerService_WebApp.gs` locally
2. Copy the entire file contents
3. In Apps Script Editor, select all (`Cmd+A`) and paste
4. Save (`Cmd+S`)

**Option B (Manual)**: Apply individual fixes below

### Step 3: Individual Fixes (if not replacing entire script)

#### Fix 1: Update CONVEX_URL (Line ~40)

**Change FROM:**
```javascript
CONVEX_URL: 'https://energized-spoonbill-94.convex.cloud',
```

**Change TO:**
```javascript
// Convex API for queue coordination and real-time sync
// Note: HTTP routes use .convex.site, not .convex.cloud
CONVEX_URL: 'https://energized-spoonbill-94.convex.site',
```

#### Fix 2: Update pullNextSQ Return Structure (Lines ~710-847)

This is the **critical fix** for the "only 1 row uploaded" issue.

**Find this section** (around line 710):
```javascript
// Prepare SQ data to return (use first item as representative)
const firstItem = itemsForSQ[0];
const sqData = {
  sqNumber: sqNumber,
  orderNumber: '', // Will be filled from Helper Doc
  buyerName: '', // Will be filled from Helper Doc
  game: firstItem.game,
  cardName: firstItem.cardName,
  collectorNum: firstItem.collectorNum,
  rarity: firstItem.rarity,
  setName: firstItem.setName,
  condition: firstItem.condition,
  qty: firstItem.qty,
  sqLink: '', // Will be extracted from Helper Doc cell G3
  rowIndex: firstItem.rowIndex,
  totalRows: itemsForSQ.length
};

// Write ALL rows to Helper Doc and check for missing data
const helperDocId = QUEUE_CONFIG.HELPER_DOCS[botId];
const missingFields = [];
```

**Replace with:**
```javascript
// Write ALL rows to Helper Doc and read back complete data
const helperDocId = QUEUE_CONFIG.HELPER_DOCS[botId];
const missingFields = [];
let completeItems = []; // Will be populated from Helper Doc
let sqLink = '';
```

**Then find** (around line 798):
```javascript
// Now check for Order Number and Buyer Name (columns H and I) in first row
// getRange uses 1-based column numbers: H=8, I=9
const helperOrderNum = helperSheet.getRange(3, 8).getValue(); // Column H
const helperBuyerName = helperSheet.getRange(3, 9).getValue(); // Column I

if (!helperOrderNum) missingFields.push('orderNumber');
if (!helperBuyerName) missingFields.push('buyerName');

// Update sqData with Helper Doc data if available
if (helperOrderNum) sqData.orderNumber = helperOrderNum;
if (helperBuyerName) sqData.buyerName = helperBuyerName;
```

**Replace with:**
```javascript
// Read ALL rows back from Helper Doc to get complete data with order/buyer info
// Columns: H=Order#, I=Buyer, J=SQ#, K=Game, L=Card, M=Collector#, N=Rarity, O=Set, P=Condition, Q=Qty
const allHelperData = helperSheet.getRange(3, 8, itemsForSQ.length, 10).getValues(); // Columns H-Q (8-17)

// Create array of items with complete data from Helper Doc
completeItems = allHelperData.map((row, idx) => {
  const orderNum = row[0]; // Column H
  const buyerName = row[1]; // Column I
  const sqNum = row[2]; // Column J
  const game = row[3]; // Column K
  const cardName = row[4]; // Column L
  const collectorNum = row[5]; // Column M
  const rarity = row[6]; // Column N
  const setName = row[7]; // Column O
  const condition = row[8]; // Column P
  const qty = row[9]; // Column Q

  // Check for missing data in this row
  if (!orderNum) missingFields.push('orderNumber (row ' + (idx + 1) + ')');
  if (!buyerName) missingFields.push('buyerName (row ' + (idx + 1) + ')');

  return {
    sqNumber: sqNum,
    orderNumber: orderNum || '',
    buyerName: buyerName || '',
    game: game || 'Magic: The Gathering',
    cardName: cardName || '',
    collectorNum: collectorNum || '',
    rarity: rarity || '',
    setName: setName || '',
    condition: condition || '',
    qty: qty || 1,
    sqLink: sqLink || ''
  };
});

Logger.log('[' + botId + '] Read back ' + completeItems.length + ' complete items from Helper Doc');
```

**Then find** (around line 820):
```javascript
Logger.log('[' + botId + '] 🎉 Successfully claimed SQ ' + sqNumber + ' (' + itemsForSQ.length + ' rows)' + (missingFields.length > 0 ? ' - Missing: ' + missingFields.join(', ') : ' - Complete'));
return {success: true, message: 'SQ claimed successfully', sqData: sqData};
```

**Replace with:**
```javascript
Logger.log('[' + botId + '] 🎉 Successfully claimed SQ ' + sqNumber + ' (' + itemsForSQ.length + ' rows)' + (missingFields.length > 0 ? ' - Missing: ' + missingFields.join(', ') : ' - Complete'));
return {
  success: true,
  message: 'SQ claimed successfully',
  sqData: completeItems, // Return array of all items, not single object
  sqNumber: sqNumber,
  totalRows: itemsForSQ.length,
  missingFields: missingFields
};
```

#### Fix 3: Update uploadToRefundLog (Lines ~846-913)

**Find the function** `uploadToRefundLog` and ensure it has array handling:

```javascript
function uploadToRefundLog(sqData, manualData) {
  const lock = acquireLock(QUEUE_CONFIG.MAX_LOCK_WAIT_MS);
  if (!lock) {
    return {success: false, message: 'Failed to acquire lock', rows: null};
  }

  try {
    const refundLog = SpreadsheetApp.openById(QUEUE_CONFIG.REFUND_LOG_ID);
    const refundSheet = refundLog.getSheetByName('Refund Log');

    if (!refundSheet) {
      return {success: false, message: 'Refund Log sheet not found', rows: null};
    }

    // Check if sqData is an array of items (from Helper Doc with multiple rows)
    // or a single item (from Web UI manual entry)
    const items = Array.isArray(sqData) ? sqData : [sqData];

    Logger.log(`uploadToRefundLog: Processing ${items.length} item(s)`);

    // Get next available row
    const nextRow = refundSheet.getLastRow() + 1;

    // Prepare all rows
    const rowsToWrite = items.map(item => {
      // Merge item with manualData if provided (manualData takes precedence)
      const finalData = manualData ? Object.assign({}, item, manualData) : item;

      // Prepare row data matching HelperDocAutomation.gs REFUND_COLS
      // Use array indices to match exact column positions
      const rowData = Array(12).fill(''); // Initialize array for columns A-L (0-11)
      rowData[0] = new Date();                              // Column A (Date)
      // rowData[1] stays empty                             // Column B (order link or formula)
      rowData[2] = finalData.orderNumber || '';             // Column C
      rowData[3] = finalData.buyerName || '';               // Column D
      rowData[4] = finalData.sqNumber || '';                // Column E
      rowData[5] = finalData.game || 'Magic: The Gathering';// Column F
      rowData[6] = finalData.cardName || '';                // Column G
      rowData[7] = finalData.collectorNum || finalData.collectorNumber || ''; // Column H
      rowData[8] = finalData.rarity || '';                  // Column I
      rowData[9] = finalData.setName || '';                 // Column J
      rowData[10] = finalData.condition || '';              // Column K
      rowData[11] = finalData.qty || finalData.quantity || 1; // Column L

      return rowData;
    });

    // Write all rows to Refund Log at once
    refundSheet.getRange(nextRow, 1, rowsToWrite.length, rowsToWrite[0].length).setValues(rowsToWrite);
    // Format date column for all rows
    refundSheet.getRange(nextRow, 1, rowsToWrite.length, 1).setNumberFormat('m/d/yyyy');
    SpreadsheetApp.flush();

    Logger.log(`Uploaded ${rowsToWrite.length} row(s) to Refund Log starting at row ${nextRow}`);
    return {
      success: true,
      message: `Uploaded ${rowsToWrite.length} item(s) to Refund Log`,
      rows: rowsToWrite.length,
      startRow: nextRow
    };

  } catch (e) {
    Logger.log('ERROR in uploadToRefundLog: ' + e);
    return {success: false, message: 'Exception: ' + e.message, rows: null};
  } finally {
    lock.releaseLock();
  }
}
```

### Step 4: Save and Deploy

5. **Save the Changes**
   - Click the Save icon (💾) or press `Cmd+S`

6. **Deploy the Updated Script**
   - Click: **Deploy** → **Manage deployments**
   - Click the **pencil icon (✏️)** next to the active deployment
   - In the "Version" dropdown, select **New version**
   - Add description: "Fix: Convex URL, return all items from pullNextSQ, array handling in uploadToRefundLog"
   - Click **Deploy**
   - Wait for "Deployment successful" message

### Step 5: Verify the Fixes

**Test in Web UI**:
1. Open the Bot Manager Web UI
2. Click "Pull Next SQ" for any bot
3. Upload a PDF or manually enter order/buyer info
4. Click "Upload to Refund Log"
5. Check the Refund Log spreadsheet
6. **Expected**: ALL rows for the SQ should be inserted (e.g., if SQ has 25 items, you should see 25 rows)
7. **NOT**: Only 1 row inserted

**Check Execution Logs** (in Apps Script Editor):
- Click: **Executions** icon (📋) on the left sidebar
- Look for recent executions
- Click on an execution to see details
- You should see:
  - `✓ Reserved SQ XXX via Convex queue` (not HTTP errors)
  - `Read back 25 complete items from Helper Doc` (or however many rows)
  - `Uploaded 25 row(s) to Refund Log` (not just 1)

### Why This Matters

Convex uses different domains for different types of endpoints:
- **`.convex.cloud`** - For database queries/mutations (used by UI dashboards)
- **`.convex.site`** - For HTTP routes (used by Apps Script for queue coordination)

Using the wrong domain causes HTTP 404 errors with empty response bodies, which results in the "Unexpected end of JSON input" error when Apps Script tries to parse the response.

### Current Deployment URL

The Apps Script Web App is deployed at:
```
https://script.google.com/a/macros/ebay.com/s/AKfycby0zYE3szCMq7Z1MYzPOIwdCCrYDyU58D8JIFclx5cDoucbpf2lJG3o-5v-wwsDQTQcfQ/exec
```

### Testing After Deployment

You can test the Convex endpoints directly:

```bash
# Test claim endpoint
curl -X POST https://energized-spoonbill-94.convex.site/bot-manager/try-claim-sq \
  -H "Content-Type: application/json" \
  -d '{"botId":"TEST","sqNumber":"TEST123"}'

# Expected response:
# {"success":true,"message":"Successfully claimed SQ TEST123",...}

# Test release endpoint
curl -X POST https://energized-spoonbill-94.convex.site/bot-manager/release-sq \
  -H "Content-Type: application/json" \
  -d '{"botId":"TEST","sqNumber":"TEST123"}'

# Expected response:
# {"success":true,"message":"Released SQ TEST123"}
```
