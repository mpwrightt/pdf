# CORS Fix Required for Apps Script

## The Problem

When the browser tries to call the Apps Script Web App, it gets blocked by CORS (Cross-Origin Resource Sharing) policy:

```
Access to fetch at 'https://script.google.com/...' from origin 'http://localhost:3000'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present
```

## The Solution

I've updated the Apps Script file (`/Users/mpwright/Discrep/scripts/QueueManagerService_WebApp.gs`) to include CORS support.

### Changes Made

1. **Added `doOptions()` function** - Handles CORS preflight requests
   ```javascript
   function doOptions(e) {
     return ContentService.createTextOutput('')
       .setMimeType(ContentService.MimeType.JSON)
       .setHeader('Access-Control-Allow-Origin', '*')
       .setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
       .setHeader('Access-Control-Allow-Headers', 'Content-Type')
       .setHeader('Access-Control-Max-Age', '3600');
   }
   ```

2. **Added CORS headers to all `doPost()` responses**
   - Success response (line 122)
   - Error response (line 131)
   - Unauthorized response (line 66)

## What You Need to Do

### 1. Update the Apps Script

1. Open the Discrepancy Log spreadsheet
2. Go to **Extensions → Apps Script**
3. The file `QueueManagerService_WebApp.gs` should already have the CORS code I added
4. If not, copy the updated version from `/Users/mpwright/Discrep/scripts/QueueManagerService_WebApp.gs`

### 2. Create a NEW Deployment

**This is critical** - You must create a NEW deployment version for the changes to take effect:

1. In Apps Script, click **Deploy → Manage deployments**
2. Click the ⚙️ (gear icon) next to your existing deployment
3. In "Version" dropdown, select **New version**
4. Description: "Added CORS support for browser calls"
5. Click **Deploy**
6. **Copy the NEW deployment URL** (it might be different!)

### 3. Update .env.local (if URL changed)

If the deployment URL changed, update `/Users/mpwright/Discrep/bot-manager/.env.local`:

```bash
NEXT_PUBLIC_APPS_SCRIPT_URL=<NEW_URL_HERE>
```

Then restart the dev server:
```bash
# Kill the current server (Ctrl+C)
npm run dev
```

## Testing

After redeploying with CORS support:

1. Open http://localhost:3000
2. Navigate to BOT1, BOT2, or BOT3
3. Click "Pull & Claim Next SQ"
4. Check browser console (F12)

### Expected Success:
```
🔄 Calling Apps Script directly from browser...
📤 URL: https://script.google.com/...
📥 Response status: 200
✅ Apps Script result: {success: true, sqData: {...}}
```

### If Still Getting CORS Error:

1. **Verify the deployment URL is correct** in `.env.local`
2. **Clear browser cache** (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)
3. **Make sure you created a NEW version** (not just saved the code)
4. Check that `doOptions` function exists in the deployed script

## Why This Happens

- **Browser security**: Browsers block requests to different domains unless server explicitly allows it
- **Apps Script default**: Doesn't include CORS headers by default
- **Solution**: Add `Access-Control-Allow-Origin: *` header to responses
- **Preflight**: Browser sends OPTIONS request first, Apps Script must respond with allowed methods/headers

## Alternative: Use API Routes (if CORS continues to fail)

If CORS continues to be problematic, we can go back to using Next.js API routes as a proxy. However, this requires deploying the App with "Anyone" access (not "Anyone from eBay"), which you mentioned might not be possible.

The CORS approach should work once you redeploy with the new version!
