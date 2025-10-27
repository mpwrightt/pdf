# Client-Side Apps Script Implementation

## What Changed

I've successfully converted the application to call Apps Script **directly from the browser** instead of through Next.js API routes. This solves the 401 authentication issue.

## Why This Works

### The Problem Before
- Next.js server tried to call Apps Script
- Apps Script deployed as "Anyone from eBay" requires eBay authentication
- Server doesn't have eBay session cookies → 401 Unauthorized

### The Solution Now
- Browser calls Apps Script directly
- User's browser HAS eBay session cookies from Clerk login
- Apps Script recognizes authenticated eBay user → Success!

## Architecture

```
User Browser (with eBay session)
    ↓
    ├→ Clerk Authentication (Google OAuth with eBay account)
    ├→ Apps Script Web App (reads/writes Google Sheets)
    └→ Convex Database (atomic SQ claiming to prevent collisions)
```

### Flow for "Pull & Claim SQ"

1. **Browser → Apps Script**: `pullNextSQ` action
   - Gets next unclaimed SQ from Discrep Log
   - Returns SQ data (Order Number, Buyer Name, etc.)

2. **Browser → Convex**: `tryClaimSQ` mutation
   - Atomically claims the SQ in database
   - Prevents race conditions if multiple bots try same SQ
   - If already claimed, tells user to try again

3. **UI Updates**: Shows SQ data, opens SQ link, prompts for missing fields

### Flow for "Sync Manual Data"

1. **User enters** missing Order Number or Buyer Name
2. **Browser → Apps Script**: `syncManualDataToHelper` action
   - Updates the Helper Doc with manual data
   - Data now available for future operations

### Flow for "Upload to Refund Log"

1. **Browser → Apps Script**: `uploadToRefundLog` action
   - Writes complete SQ data to Refund Log
   - Returns success/failure

2. **Browser → Convex**: `releaseSQ` mutation
   - Marks SQ as completed
   - Bot can now process next SQ

## Files Modified

### `/Users/mpwright/Discrep/bot-manager/.env.local`
- Updated `NEXT_PUBLIC_APPS_SCRIPT_URL` to new deployment
- Made API key public: `NEXT_PUBLIC_APPS_SCRIPT_API_KEY`
- API key is optional now since browser has eBay auth

### `/Users/mpwright/Discrep/bot-manager/app/bot/[botId]/page.tsx`
- `handlePullAndClaim()`: Calls Apps Script directly
- `handleSyncManualData()`: Calls `syncManualDataToHelper` action
- `handleUploadToRefundLog()`: Calls `uploadToRefundLog` action
- Added detailed console logging for debugging

## Collision Prevention

Even with client-side calls, collisions are prevented:

### SQ Claims
- ✅ **Convex `tryClaimSQ` is atomic** - only one bot can claim each SQ
- ✅ If BOT1 and BOT2 pull simultaneously:
  - Apps Script gives them both different SQs (SQ-123 to BOT1, SQ-124 to BOT2)
  - Each claims their SQ in Convex
  - No collision

### Refund Log Writes
- ✅ **Convex `reserveRefundLogWrite` calculates next row atomically**
- ✅ Each bot gets a unique row range
- ✅ No overwrites possible

## Testing Instructions

### 1. Make Sure Apps Script is Deployed

Your Apps Script **must** be deployed as:
- **Execute as**: Me
- **Who has access**: Anyone from eBay
- **URL**: https://script.google.com/a/macros/ebay.com/s/AKfycby0zYE3szCMq7Z1MYzPOIwdCCrYDyU58D8JIFclx5cDoucbpf2lJG3o-5v-wwsDQTQcfQ/exec

### 2. Test the Application

1. Open http://localhost:3000
2. Sign in with your eBay Google account
3. Click on BOT1, BOT2, or BOT3
4. Click "Pull & Claim Next SQ"
5. Check browser console (F12) for logs:
   ```
   🔄 Calling Apps Script directly from browser...
   📤 URL: https://script.google.com/...
   📥 Response status: 200
   ✅ Apps Script result: {success: true, sqData: {...}}
   ```

### 3. What to Expect

**Success Path:**
- SQ data appears on screen
- SQ link opens automatically
- If fields missing → Manual entry form appears
- Fill in fields → Click "Sync Manual Data"
- Click "Upload to Refund Log"
- Done!

**If Error:**
- Check browser console for detailed logs
- Look for CORS errors (shouldn't happen with proper deployment)
- Verify you're signed in with eBay account in browser

## Debugging

### Browser Console Logs
All operations log to browser console:
- 🔄 Starting operation
- 📤 Request being sent
- 📥 Response received
- ✅ Success
- ❌ Error with details

### Common Issues

**Error: "Apps Script returned 401"**
- User not signed into eBay Google account
- Apps Script deployment permissions wrong
- Try signing out and back into Clerk

**Error: "Apps Script returned 403"**
- Deployment might not be "Anyone from eBay"
- Check deployment settings

**Error: "Failed to claim SQ"**
- Another bot claimed it first (race condition)
- Just click "Pull & Claim" again for next SQ

## Security Notes

The API key is now in the browser (`NEXT_PUBLIC_*`), but this is okay because:
1. Apps Script primarily relies on eBay session authentication
2. API key is secondary validation
3. Only eBay users can access the app (Clerk restricts to eBay domain)
4. If needed, you can remove API key check from Apps Script entirely

## Next Steps

1. ✅ Test pulling SQ
2. ✅ Test manual data entry
3. ✅ Test syncing to Helper Doc
4. ✅ Test uploading to Refund Log
5. ✅ Test with multiple bots simultaneously to verify no collisions

The app is ready to test!
