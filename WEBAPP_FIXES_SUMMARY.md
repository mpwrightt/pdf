# Web App Fixes Summary

## Issues Fixed

### 1. Bot Locking - Null Safety Error ✓
**File**: `BotManagerUI.html` (line 267-272)

**Problem**: `updateBotStatus()` function crashed with "Cannot read properties of null (reading 'forEach')" when `getActiveClaims()` returned null.

**Fix**: Added null/undefined check:
```javascript
function updateBotStatus(claims) {
  // Add null/undefined check
  if (!claims || !Array.isArray(claims)) {
    console.warn('No claims data received, all bots will show as available');
    claims = [];
  }
  // ... rest of function
}
```

### 2. Wrong Sheet Name ✓
**File**: `QueueManagerService_WebApp.gs` (line 21, 473)

**Problem**: Code was looking for sheet named 'Discrep' but actual sheet is 'SQ Discrepancy Log'.

**Fix**:
- Added configuration: `DISCREP_SHEET_NAME: 'SQ Discrepancy Log'`
- Updated function to use: `discrepSheet = ss.getSheetByName(QUEUE_CONFIG.DISCREP_SHEET_NAME)`

### 3. Wrong Column Indices for Discrepancy Log ✓
**File**: `QueueManagerService_WebApp.gs` (lines 481-492)

**Problem**: Column indices didn't match HelperDocAutomation.gs structure.

**Original (WRONG)**:
```javascript
const COL_CARD_NAME = 3;      // Column D
const COL_COLLECTOR_NUM = 4;  // Column E
const COL_RARITY = 5;         // Column F
const COL_SET_NAME = 6;       // Column G
const COL_CONDITION = 7;      // Column H
const COL_QTY = 8;            // Column I
const COL_INITIALS = 13;      // Column N
const COL_GAME = 9;           // Column J
```

**Fixed (CORRECT)**:
```javascript
const COL_SQ_NUMBER = 2;      // Column C
const COL_GAME = 3;           // Column D
const COL_CARD_NAME = 4;      // Column E
const COL_COLLECTOR_NUM = 5;  // Column F
const COL_RARITY = 6;         // Column G
const COL_SET_NAME = 7;       // Column H
const COL_CONDITION = 8;      // Column I
const COL_QTY = 9;            // Column J
const COL_INITIALS = 14;      // Column O
```

### 4. Wrong Column Indices for Helper Doc ✓
**File**: `QueueManagerService_WebApp.gs` (lines 536-553)

**Problem**: Helper Doc columns were wrong (was using A, B, C; should use H, I, J).

**Original (WRONG)**:
```javascript
const helperSQ = helperRow[2]; // Column C
const helperOrderNum = helperRow[0]; // Column A
const helperBuyerName = helperRow[1]; // Column B
```

**Fixed (CORRECT)**:
```javascript
const helperSQ = helperRow[8]; // SQ Number in column J (index 8)
const helperOrderNum = helperRow[6]; // Order Number in column H (index 6)
const helperBuyerName = helperRow[7]; // Buyer Name in column I (index 7)
```

### 5. Wrong Column Indices for Manual Data Sync ✓
**File**: `QueueManagerService_WebApp.gs` (lines 657-676)

**Problem**: `syncManualDataToHelper()` was writing to wrong columns.

**Original (WRONG)**:
```javascript
const rowSQ = row[2]; // Column C
helperSheet.getRange(i + 1, 1).setValue(manualData.orderNumber); // Column A
helperSheet.getRange(i + 1, 2).setValue(manualData.buyerName); // Column B
```

**Fixed (CORRECT)**:
```javascript
const rowSQ = row[8]; // SQ Number in column J (index 8)
helperSheet.getRange(i + 1, 7).setValue(manualData.orderNumber); // Column H (7)
helperSheet.getRange(i + 1, 8).setValue(manualData.buyerName); // Column I (8)
```

### 6. Refund Log Upload Format ✓
**File**: `QueueManagerService_WebApp.gs` (lines 597-621)

**Problem**: Row data wasn't properly formatted with date and number format.

**Fixed**:
- Added `new Date()` for Column A
- Added date formatting: `refundSheet.getRange(nextRow, 1).setNumberFormat('m/d/yyyy')`
- Proper column alignment matching HelperDocAutomation.gs REFUND_COLS

## Column Mapping Reference

### Discrepancy Log ("SQ Discrepancy Log" sheet)
- Column C (index 2): SQ Number
- Column D (index 3): Game
- Column E (index 4): Card Name
- Column F (index 5): Collector Number
- Column G (index 6): Rarity
- Column H (index 7): Set Name
- Column I (index 8): Condition
- Column J (index 9): Quantity
- Column O (index 14): Initials (for claiming)

### Helper Doc ("Paste Here" sheet)
- Column H (index 6): Order Number (filled by PDF or manual)
- Column I (index 7): Buyer Name (filled by PDF or manual)
- Column J (index 8): SQ Number
- Column K (index 9): Game
- Column L (index 10): Card Name
- Column M (index 11): Collector Number
- Column N (index 12): Rarity
- Column O (index 13): Set Name
- Column P (index 14): Condition
- Column Q (index 15): Quantity

### Refund Log ("Refund Log" sheet)
- Column A: Date (formatted as m/d/yyyy)
- Column B: Order Link (formula or empty)
- Column C (REFUND_COLS.ORDER_NUMBER = 2): Order Number
- Column D (REFUND_COLS.BUYER_NAME = 3): Buyer Name
- Column E (REFUND_COLS.SQ_NUMBER = 4): SQ Number
- Column F (REFUND_COLS.GAME = 5): Game
- Column G (REFUND_COLS.CARD_NAME = 6): Card Name
- Column H (REFUND_COLS.CARD_NUM = 7): Card #
- Column I (REFUND_COLS.RARITY = 8): Rarity
- Column J (REFUND_COLS.SET_NAME = 9): Set Name
- Column K (REFUND_COLS.CONDITION = 10): Condition
- Column L (REFUND_COLS.QUANTITY = 11): Quantity

## Deployment Steps

1. **Update Apps Script**:
   - Open Discrepancy Log spreadsheet
   - Go to Extensions → Apps Script
   - Replace `QueueManagerService_WebApp.gs` with updated version from `/Users/mpwright/Discrep/scripts/QueueManagerService_WebApp.gs`
   - Replace `BotManagerUI.html` with updated version from `/Users/mpwright/Discrep/scripts/BotManagerUI.html`
   - Save both files

2. **Create NEW Deployment**:
   - Click Deploy → New deployment
   - Select type: Web app
   - Description: "Bot Manager - Column Fixes + Bot Locking"
   - Execute as: Me
   - Who has access: Anyone from eBay
   - Click Deploy
   - Copy the new URL

3. **Test**:
   - Open the Web App URL
   - Bot buttons should appear
   - Bot locking should work (no errors in console)
   - Try selecting a bot and pulling an SQ
   - Verify data appears correctly

## What Should Work Now

✅ Bot status checking (no more forEach errors)
✅ Correct sheet name lookup ("SQ Discrepancy Log")
✅ Correct column reading from Discrepancy Log
✅ Correct column reading from Helper Docs
✅ Manual data sync to correct Helper Doc columns
✅ Upload to Refund Log with proper formatting
✅ Bot locking UI (buttons grey out when in use)

## Files Modified

1. `/Users/mpwright/Discrep/scripts/BotManagerUI.html`
2. `/Users/mpwright/Discrep/scripts/QueueManagerService_WebApp.gs`
