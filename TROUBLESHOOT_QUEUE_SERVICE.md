# Troubleshooting Queue Manager Service

## Error: `"<!DOCTYPE "... is not valid JSON`

This means the Queue Manager Web App is returning HTML (probably an error page) instead of JSON.

### Quick Fix Steps

#### 1. Test the Web App URL Directly

Open this URL in your browser:
```
https://script.google.com/a/macros/ebay.com/s/AKfycbwrLg1hD-_d4LA4iky6VGYTUCYuJeUbHZbfyN7KWX4MzK98pzp1HOR3TxVqt7__R8higA/exec
```

**Expected response** (JSON):
```json
{
  "status": "Queue Manager Service is running",
  "timestamp": "2025-10-26T...",
  "activeClaims": 0
}
```

**If you see an authorization page:**
- Click "Authorize"
- Choose your Google account
- Click "Advanced" → "Go to Queue Manager (unsafe)"
- Click "Allow"
- The page should now show JSON

#### 2. Check Web App Deployment Settings

1. Open **Discrepancy Log** spreadsheet
2. Go to Extensions → Apps Script
3. Click **Deploy** → **Manage deployments**
4. Find the "Queue Manager Service" deployment
5. Verify settings:
   - ✅ Type: **Web app**
   - ✅ Execute as: **Me** (your account)
   - ✅ Who has access: **Anyone** (or "Anyone with Google account")

**If settings are wrong:**
- Click the pencil icon (Edit)
- Fix the settings
- Click **Deploy**
- Copy the NEW Web App URL
- Update `QUEUE_SERVICE_URL` in all Helper Docs

#### 3. Check for Script Errors

1. In Discrepancy Log → Extensions → Apps Script
2. Click **Executions** (left sidebar)
3. Look for any errors in recent executions
4. If you see errors, they'll tell you what's wrong with the Queue Manager script

#### 4. Re-deploy the Web App

If the Web App was deployed incorrectly:

1. Open **Discrepancy Log** → Extensions → Apps Script
2. Make sure `QueueManagerService_WebApp.gs` is there with all the code
3. Click **Deploy** → **New deployment**
4. Type: **Web app**
5. Description: "Queue Manager Service v2"
6. Execute as: **Me**
7. Who has access: **Anyone**
8. Click **Deploy**
9. **Copy the new URL**
10. Update `QUEUE_SERVICE_URL` in ALL Helper Docs with the new URL

### Common Issues

**Issue: "Authorization required"**
→ Open the Web App URL in a browser and authorize it first

**Issue: "Script function not found: doPost"**
→ The Queue Manager script is missing or incomplete. Re-deploy `QueueManagerService_WebApp.gs`

**Issue: Different URL format**
→ Make sure you're using the `/exec` URL (not `/dev`)

**Issue: "You need permission"**
→ Change deployment to "Who has access: Anyone"

### Testing After Fix

1. Open the Web App URL in browser → should see JSON
2. Run "Claim Next SQ" from Helper Doc → check logs
3. Should see: `[BOT1] ✓ Reserved SQ XXXXX via centralized service`

### Still Not Working?

Check the updated logs with the enhanced error logging. The logs will now show:
```
[BOT1] ERROR: Queue service returned HTML instead of JSON:
<!DOCTYPE html>... [first 500 chars of the HTML error page]
```

This will tell you exactly what error page is being returned.
