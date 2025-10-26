# Quick Update Checklist - Centralized Queue

Your Queue Manager Web App URL:
```
https://script.google.com/a/macros/ebay.com/s/AKfycbwrLg1hD-_d4LA4iky6VGYTUCYuJeUbHZbfyN7KWX4MzK98pzp1HOR3TxVqt7__R8higA/exec
```

## For Each Helper Doc (BOT1, BOT2, BOT3)

### 1. Update CONFIG
- [ ] Open Helper Doc → Extensions → Apps Script
- [ ] Find `const CONFIG = {`
- [ ] Add this line right after `BOT_ID`:
```javascript
QUEUE_SERVICE_URL: 'https://script.google.com/a/macros/ebay.com/s/AKfycbwrLg1hD-_d4LA4iky6VGYTUCYuJeUbHZbfyN7KWX4MzK98pzp1HOR3TxVqt7__R8higA/exec',
```

### 2. Replace 4 Queue Functions
Copy from: `/Users/mpwright/Discrep/scripts/HELPER_DOC_QUEUE_FUNCTIONS_UPDATE.gs`

- [ ] Replace `tryReserveSQ()` - Makes HTTP call to queue service
- [ ] Replace `releaseSQ()` - Makes HTTP call to queue service
- [ ] Replace `tryReserveRefundLogWrite()` - Makes HTTP call to queue service
- [ ] Replace `releaseRefundLogWrite()` - Makes HTTP call to queue service

### 3. Delete Old Lock Functions
- [ ] Delete `acquireQueueLock()` (not needed anymore)
- [ ] Delete `releaseQueueLock()` (not needed anymore)
- [ ] Delete `acquireRefundLogLock()` (not needed anymore)
- [ ] Delete `releaseRefundLogLock()` (not needed anymore)

### 4. Verify BOT_ID
- [ ] BOT1 should have: `BOT_ID: 'BOT1',`
- [ ] BOT2 should have: `BOT_ID: 'BOT2',`
- [ ] BOT3 should have: `BOT_ID: 'BOT3',`

### 5. Save
- [ ] Ctrl+S / Cmd+S
- [ ] Close Apps Script editor

## Repeat for All Bots
- [ ] BOT1 updated
- [ ] BOT2 updated
- [ ] BOT3 updated

## Test
- [ ] Clear BOTS queue in Discrepancy Log (delete rows 2+)
- [ ] Have 3 agents run "Claim Next SQ" simultaneously
- [ ] Check Discrepancy Log BOTS tab → should show 3 different SQ numbers
- [ ] Check Discrepancy Log execution logs → should show queue service messages

## Expected Results

**Helper Doc logs (BOT1):**
```
[BOT1] ✓ Reserved SQ 251019-XXX via centralized service
```

**Discrepancy Log logs (Queue Service):**
```
[QUEUE SERVICE] Received tryClaimSQ from BOT1 for SQ 251019-XXX
[BOT1] Successfully claimed SQ 251019-XXX at row 2
```

**BOTS Queue Sheet:**
```
| Bot ID | SQ Number       | Status    | Timestamp   |
|--------|-----------------|-----------|-------------|
| BOT1   | 251019-XXX      | CLAIMING  | 10/26/2025  |
| BOT2   | 251019-YYY      | CLAIMING  | 10/26/2025  |
| BOT3   | 251019-ZZZ      | CLAIMING  | 10/26/2025  |
```

✅ **All 3 bots claim DIFFERENT SQs** = Success!
❌ **Any 2 bots claim SAME SQ** = Something went wrong

## If Something Goes Wrong

1. **Check Web App URL** - Make sure all 3 Helper Docs have the exact same URL
2. **Check BOT_ID** - Each Helper Doc must have a unique ID
3. **Check Queue Service Logs** - Go to Discrepancy Log → Extensions → Apps Script → Executions
4. **Test Web App** - Open the URL in browser, should see JSON response

## Quick Reference Files

- Web App script: `/Users/mpwright/Discrep/scripts/QueueManagerService_WebApp.gs` (already deployed)
- Helper Doc updates: `/Users/mpwright/Discrep/scripts/HELPER_DOC_QUEUE_FUNCTIONS_UPDATE.gs` (copy from here)
- Full guide: `/Users/mpwright/Discrep/DEPLOY_CENTRALIZED_QUEUE.md`
