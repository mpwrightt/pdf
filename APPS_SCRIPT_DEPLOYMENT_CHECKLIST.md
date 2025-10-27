# Apps Script Deployment Checklist

## Current Status
- **API Key in .env.local**: `bot-manager-secret-key-change-this-12345`
- **API Key in Apps Script**: Line 35 shows matching key
- **Apps Script URL**: https://script.google.com/a/macros/ebay.com/s/AKfycbwrLg1hD-_d4LA4iky6VGYTUCYuJeUbHZbfyN7KWX4MzK98pzp1HOR3TxVqt7__R8higA/exec

## Issue
Getting 401 Unauthorized despite API keys appearing to match.

## Troubleshooting Steps

### 1. Verify Apps Script Code
Open your Discrepancy Log spreadsheet → Extensions → Apps Script

Check line 35 of `QueueManagerService_WebApp.gs`:
```javascript
API_KEY: 'bot-manager-secret-key-change-this-12345'
```

This MUST match exactly (character for character).

### 2. Create a NEW Deployment (CRITICAL)

Apps Script doesn't automatically update the live deployment when you save code changes. You MUST create a new version:

**Steps:**
1. In Apps Script editor, click **Deploy** → **Manage deployments**
2. Click the ⚙️ (gear icon) next to your existing deployment
3. In "Version" dropdown, select **New version**
4. Add a description like "Added API key authentication"
5. Click **Deploy**
6. **Copy the NEW deployment URL** (it might be different!)
7. Update `.env.local` with the new URL if it changed

### 3. Test the Deployment

After creating a new version:

1. Open http://localhost:3001 in your browser
2. Navigate to one of the bots (BOT1, BOT2, or BOT3)
3. Click "Pull & Claim SQ"
4. Check the terminal running `npm run dev` for detailed logs showing:
   - 🔑 API Key being sent
   - 📤 Request URL
   - 📦 Payload
   - 📥 Response status
   - ❌ Error details if it fails

### 4. Alternative: Test with curl

You can test the Apps Script directly without the UI:

```bash
curl -X POST \
  https://script.google.com/a/macros/ebay.com/s/AKfycbwrLg1hD-_d4LA4iky6VGYTUCYuJeUbHZbfyN7KWX4MzK98pzp1HOR3TxVqt7__R8higA/exec \
  -H "Content-Type: application/json" \
  -d '{"action":"pullNextSQ","botId":"BOT1","apiKey":"bot-manager-secret-key-change-this-12345"}'
```

This should return JSON with either:
- Success: `{"success":true,"sqData":{...}}`
- Unauthorized: `{"success":false,"message":"Unauthorized - Invalid API key"}`
- No SQs: `{"success":false,"message":"No unclaimed SQs available"}`

### 5. Common Issues

**Issue**: "401 Unauthorized"
- **Cause**: Old deployment is still active
- **Fix**: Create NEW version (see step 2)

**Issue**: "403 Forbidden"
- **Cause**: Deployment access level wrong
- **Fix**: Redeploy with "Who has access: Anyone from eBay"

**Issue**: Different error in curl vs browser
- **Cause**: CORS issue or different deployments
- **Fix**: Make sure using same URL in both tests

## Next Steps After Successful Test

Once the API returns success:
1. The UI should display the SQ data
2. You can manually enter missing Order Number or Buyer Name
3. Click "Sync Manual Data" to update the Helper Doc
4. Click "Upload to Refund Log" to complete the process

## Need Help?

If still getting 401 after creating a new deployment version:
1. Share the exact error message from the terminal logs
2. Confirm the deployment URL hasn't changed
3. Try the curl command and share its output
