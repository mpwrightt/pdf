# Deploy Centralized Queue Manager - Step by Step

## Why This Approach is Bulletproof

All previous attempts failed because of:
1. ~~LockService.getDocumentLock() doesn't work across Apps Script projects~~
2. ~~Google Sheets caches data, causing bots to miss each other's writes~~

**NEW SOLUTION**: Deploy a **centralized Web App** in the Discrepancy Log that handles ALL queue operations. Helper Docs make HTTP calls to it.

### Why This Works

✅ **All queue operations execute in ONE Apps Script project** (Discrepancy Log)
✅ **ScriptLock works perfectly** within a single project
✅ **No cross-project issues** - Helper Docs just make HTTP calls
✅ **No cache problems** - Only one script accesses the queue sheets
✅ **Easy debugging** - All queue logs in one place (Discrepancy Log execution logs)

---

## Deployment Steps (15 minutes)

### Part 1: Deploy Queue Manager Service

**1. Open Discrepancy Log**
- Go to: https://docs.google.com/spreadsheets/d/1m0dSOA2VogToEpAo6Jj7FEEsfJbWi1W48xiyTHkBNyY/edit

**2. Open Apps Script Editor**
- Click Extensions → Apps Script

**3. Add Queue Manager Script**
- In the Apps Script editor, click the **+** next to Files
- Name it: `QueueManagerService`
- Copy the ENTIRE contents of `/Users/mpwright/Discrep/scripts/QueueManagerService_WebApp.gs`
- Paste into the new file
- Click **Save** (Ctrl+S / Cmd+S)

**4. Deploy as Web App**
- Click **Deploy** button (top right) → **New deployment**
- Click the gear icon next to "Select type" → Choose **Web app**
- Fill in:
  - Description: `Queue Manager Service v1`
  - Execute as: **Me** (your account)
  - Who has access: **Anyone** (or "Anyone with Google account" if you want restriction)
- Click **Deploy**

**5. Authorize**
- You'll see an authorization screen
- Click **Authorize access**
- Choose your Google account
- Click **Advanced** → **Go to Queue Manager (unsafe)** (it's safe, Google just flags all custom scripts)
- Click **Allow**

**6. Copy the Web App URL**
- After deployment, you'll see a URL like:
  ```
  https://script.google.com/macros/s/AKfycbz.../exec
  ```
- **COPY THIS URL** - you'll need it for each Helper Doc!

**7. Test the Service**
- Open the Web App URL in your browser
- You should see JSON like:
  ```json
  {
    "status": "Queue Manager Service is running",
    "timestamp": "2025-10-26T...",
    "activeClaims": 0
  }
  ```
- If you see this, **deployment successful!** ✅

---

### Part 2: Update Helper Doc Scripts

Now update each Helper Doc (BOT1, BOT2, BOT3) to call the centralized service.

**For EACH Helper Doc:**

**1. Open the Helper Doc**
- BOT1: [Your Helper Doc URL]
- BOT2: [Your Helper Doc URL]
- BOT3: [Your Helper Doc URL]

**2. Open Apps Script**
- Extensions → Apps Script

**3. Add the Queue Service URL**
- At the top of the script, RIGHT AFTER `const CONFIG = {`, add:

```javascript
const CONFIG = {
  // ⚙️ IMPORTANT: Change BOT_ID for each cloned helper doc
  BOT_ID: 'BOT1', // ← Change to 'BOT2', 'BOT3', etc.

  // 🔗 QUEUE SERVICE: Web App URL from Discrepancy Log deployment
  QUEUE_SERVICE_URL: 'https://script.google.com/macros/s/YOUR_WEB_APP_URL/exec', // ← PASTE YOUR URL HERE!

  VERCEL_API_URL: 'https://pdf-nine-psi.vercel.app/api/parse',
  // ... rest of config ...
```

**4. Replace Queue Functions**
- Find and REPLACE these 4 functions with the new versions below:

```javascript
/**
 * Try to reserve an SQ via centralized queue service
 */
function tryReserveSQ(sqNumber) {
  const payload = {
    action: 'tryClaimSQ',
    botId: CONFIG.BOT_ID,
    sqNumber: sqNumber
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(CONFIG.QUEUE_SERVICE_URL, options);
    const result = JSON.parse(response.getContentText());

    if (result.success) {
      Logger.log(`[${CONFIG.BOT_ID}] ✓ Reserved SQ ${sqNumber} via centralized service`);
    } else {
      Logger.log(`[${CONFIG.BOT_ID}] ⚠️ Could not reserve SQ ${sqNumber}: ${result.message}`);
    }

    return result.success;
  } catch (e) {
    Logger.log(`[${CONFIG.BOT_ID}] ERROR calling queue service: ${e}`);
    return false;
  }
}

/**
 * Release an SQ reservation via centralized queue service
 */
function releaseSQ(sqNumber) {
  const payload = {
    action: 'markSQCompleted',
    botId: CONFIG.BOT_ID,
    sqNumber: sqNumber
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(CONFIG.QUEUE_SERVICE_URL, options);
    const result = JSON.parse(response.getContentText());

    if (result.success) {
      Logger.log(`[${CONFIG.BOT_ID}] ✓ Released SQ ${sqNumber}`);
    } else {
      Logger.log(`[${CONFIG.BOT_ID}] ⚠️ Could not release SQ ${sqNumber}: ${result.message}`);
    }

    return result.success;
  } catch (e) {
    Logger.log(`[${CONFIG.BOT_ID}] ERROR calling queue service: ${e}`);
    return false;
  }
}

/**
 * Reserve rows in Refund Log via centralized service
 */
function tryReserveRefundLogWrite(sqNumber, rowCount) {
  const payload = {
    action: 'reserveRefundLogRows',
    botId: CONFIG.BOT_ID,
    sqNumber: sqNumber,
    rowCount: rowCount
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(CONFIG.QUEUE_SERVICE_URL, options);
    const result = JSON.parse(response.getContentText());

    if (result.success) {
      Logger.log(`[${CONFIG.BOT_ID}] ✓ Reserved ${rowCount} rows starting at ${result.startRow}`);
      return result.startRow;
    } else {
      Logger.log(`[${CONFIG.BOT_ID}] ⚠️ Could not reserve rows: ${result.message}`);
      return null;
    }
  } catch (e) {
    Logger.log(`[${CONFIG.BOT_ID}] ERROR calling queue service: ${e}`);
    return null;
  }
}

/**
 * Release Refund Log reservation via centralized service
 */
function releaseRefundLogWrite(sqNumber) {
  const payload = {
    action: 'releaseRefundLogReservation',
    botId: CONFIG.BOT_ID,
    sqNumber: sqNumber
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(CONFIG.QUEUE_SERVICE_URL, options);
    const result = JSON.parse(response.getContentText());

    if (result.success) {
      Logger.log(`[${CONFIG.BOT_ID}] ✓ Released Refund Log reservation`);
    } else {
      Logger.log(`[${CONFIG.BOT_ID}] ⚠️ Could not release reservation: ${result.message}`);
    }

    return result.success;
  } catch (e) {
    Logger.log(`[${CONFIG.BOT_ID}] ERROR calling queue service: ${e}`);
    return false;
  }
}
```

**5. DELETE Old Lock Functions**
- Find and DELETE these functions (they're no longer needed):
  - `acquireQueueLock()`
  - `releaseQueueLock()`
  - `acquireRefundLogLock()`
  - `releaseRefundLogLock()`

**6. Save**
- Click Save (Ctrl+S / Cmd+S)

**7. Repeat for all Helper Docs**
- Do steps 1-6 for BOT1, BOT2, BOT3 (all Helper Docs)
- **IMPORTANT**: Each must have a unique `BOT_ID` ('BOT1', 'BOT2', 'BOT3')
- All must have the SAME `QUEUE_SERVICE_URL`

---

### Part 3: Test with 3 Concurrent Bots

**1. Clear Queue**
- Open Discrepancy Log → BOTS tab
- Delete all rows except the header

**2. Verify Unclaimed SQs**
- Make sure you have at least 3 unclaimed SQs in the Discrepancy Log

**3. Run Concurrent Test**
- Have 3 people (or windows) ready
- All click `🤖 Refund Tools > 1️⃣ Claim Next SQ` at the same time
- Wait 30-60 seconds

**4. Check Results**

**In Discrepancy Log BOTS tab:**
- Should show 3 rows with 3 DIFFERENT SQ numbers
- Each row should have a different Bot ID (BOT1, BOT2, BOT3)

**In Helper Doc execution logs:**
```
[BOT1] ✓ Reserved SQ 251019-XXX via centralized service
```

**In Discrepancy Log execution logs (Extensions → Apps Script → Executions):**
```
[QUEUE SERVICE] Received tryClaimSQ from BOT1 for SQ 251019-XXX
[BOT1] Successfully claimed SQ 251019-XXX at row 2

[QUEUE SERVICE] Received tryClaimSQ from BOT2 for SQ 251019-YYY
[BOT2] Successfully claimed SQ 251019-YYY at row 3

[QUEUE SERVICE] Received tryClaimSQ from BOT3 for SQ 251019-ZZZ
[BOT3] Successfully claimed SQ 251019-ZZZ at row 4
```

**Expected: Each bot claims a DIFFERENT SQ** ✅

---

## Troubleshooting

**Error: "Queue Manager Service is not accessible"**
→ Re-deploy the Web App and make sure "Who has access" is set to "Anyone"

**Error: "Failed to acquire lock"**
→ The Queue Manager might be overloaded. This is normal if 10+ bots run simultaneously.

**Error: "SQ already claimed by BOT2"**
→ This is CORRECT behavior! BOT1 tried to claim an SQ that BOT2 already claimed. It will try the next SQ.

**Bots still claiming same SQ**
→ Double-check that all Helper Docs have the SAME `QUEUE_SERVICE_URL`

---

## Monitoring

**View Queue Service Logs:**
- Open Discrepancy Log
- Extensions → Apps Script → Executions
- All queue operations are logged here!

**View Active Claims:**
- Open the Web App URL with `?action=status` appended
- Shows how many active claims exist

---

## Success Criteria

✅ Each bot claims a different SQ when run concurrently
✅ Queue Service logs show sequential claim requests
✅ No "Write verification failed" errors
✅ BOTS queue sheet shows 3 rows with unique SQ numbers

This approach is **bulletproof** because everything runs in one Apps Script project! 🎯
