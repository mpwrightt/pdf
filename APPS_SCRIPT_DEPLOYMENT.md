# Apps Script Deployment Instructions

## Fix: Update Convex URL in Google Apps Script

### Problem
The deployed Apps Script is still using the old Convex URL (`.convex.cloud`) which doesn't support HTTP routes. It needs to use `.convex.site` instead.

### Solution

1. **Open the Discrepancy Log Spreadsheet**
   - URL: https://docs.google.com/spreadsheets/d/1m0dSOA2VogToEpAo6Jj7FEEsfJbWi1W48xiyTHkBNyY

2. **Open Apps Script Editor**
   - Click: **Extensions** → **Apps Script**

3. **Locate the QUEUE_CONFIG**
   - Find line ~40 in the script
   - Look for the `QUEUE_CONFIG` constant

4. **Update the CONVEX_URL**

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

5. **Save the Changes**
   - Click the Save icon (💾) or press `Ctrl+S` / `Cmd+S`

6. **Deploy the Updated Script**
   - Click: **Deploy** → **Manage deployments**
   - Click the **pencil icon (✏️)** next to the active deployment
   - In the "Version" dropdown, select **New version**
   - Add description: "Fix: Use .convex.site for HTTP routes"
   - Click **Deploy**
   - Wait for "Deployment successful" message

7. **Verify the Fix**
   - Run one of the bots (BOT1, BOT2, or BOT3)
   - Check the execution logs
   - You should see: `✓ Reserved SQ XXX via Convex queue`
   - NOT: `ERROR calling Convex queue: SyntaxError: Unexpected end of JSON input`

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
