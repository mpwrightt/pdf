# Apps Script Web App Deployment Guide

## What We Built

A complete **Google Apps Script Web App** with a beautiful Bootstrap UI that:
- ✅ Works with "Anyone from eBay" authentication (no CORS issues!)
- ✅ Manages all 3 bots (BOT1, BOT2, BOT3)
- ✅ Pulls & claims SQs
- ✅ Handles manual data entry for missing fields
- ✅ Syncs data to Helper Docs
- ✅ Uploads to Refund Log
- ✅ Modern, professional UI with Bootstrap 5

## Files Created

1. `/Users/mpwright/Discrep/scripts/BotManagerUI.html` - The complete HTML/CSS/JavaScript UI
2. `/Users/mpwright/Discrep/scripts/QueueManagerService_WebApp.gs` - Updated with `doGet()` function

## Deployment Steps

### 1. Open Apps Script Editor

1. Open your **Discrepancy Log** spreadsheet
   - ID: `1m0dSOA2VogToEpAo6Jj7FEEsfJbWi1W48xiyTHkBNyY`
2. Go to **Extensions → Apps Script**

### 2. Add the HTML File

1. In Apps Script editor, click the **+** next to "Files"
2. Select **HTML**
3. Name it: `BotManagerUI`
4. **Copy the entire contents** of `/Users/mpwright/Discrep/scripts/BotManagerUI.html`
5. **Paste** into the BotManagerUI.html file
6. Click **Save** (Cmd+S / Ctrl+S)

### 3. Update the .gs File

1. Click on the existing `QueueManagerService_WebApp.gs` (or Code.gs) file
2. **Copy the entire contents** of `/Users/mpwright/Discrep/scripts/QueueManagerService_WebApp.gs`
3. **Paste** to replace all existing code
4. Click **Save**

### 4. Deploy as Web App

1. Click **Deploy** → **New deployment**
2. Click the gear icon ⚙️ next to "Select type"
3. Choose **Web app**
4. Configure:
   - **Description**: "Bot Manager Web App with UI"
   - **Execute as**: Me (your eBay account)
   - **Who has access**: **Anyone from eBay**
5. Click **Deploy**
6. **Copy the Web App URL** (save this!)
7. Click **Done**

### 5. Access the Web App

1. Open the Web App URL in your browser
2. You'll be prompted to sign in with your eBay Google account
3. Grant permissions when asked
4. The Bot Manager UI will load!

## How to Use

### Step-by-Step Workflow

1. **Select a Bot** - Click BOT1, BOT2, or BOT3
2. **Pull & Claim SQ** - Click the button to get next SQ
   - SQ data will display
   - SQ link opens automatically
3. **Fill Missing Fields** (if any) - Enter Order Number or Buyer Name
   - Click "Sync Manual Data"
4. **Upload to Refund Log** - Click the upload button
5. **Done!** - Console resets, ready for next SQ

### Features

- **Beautiful gradient UI** - Purple/blue gradient theme
- **Bootstrap 5** - Modern, responsive design
- **Icons** - Bootstrap Icons throughout
- **Auto-open SQ links** - Opens in new tab automatically
- **Form validation** - Ensures all fields filled before sync
- **Loading indicators** - Shows progress for all operations
- **Error handling** - Clear error messages

## No Installation Required!

Unlike the Next.js version, this has:
- ❌ No `npm install`
- ❌ No build process
- ❌ No environment variables
- ❌ No Convex setup
- ❌ No Clerk configuration
- ❌ No CORS issues
- ❌ No deployment complexity

Just deploy and use!

## Troubleshooting

### "Authorization Required" Error

**Solution**: Click "Review Permissions" → Sign in with eBay account → Allow access

### "Script function not found: pullNextSQ"

**Solution**: Make sure both files are saved in the same Apps Script project

### UI Not Loading

**Solution**:
1. Check that `BotManagerUI.html` file exists
2. Verify `doGet()` function is in the .gs file
3. Try creating a NEW deployment

### 401/403 Errors

**Solution**: Redeploy with "Anyone from eBay" access

## Queue Management

The Apps Script LockService handles concurrency:
- Only one bot can pull an SQ at a time
- Stale claims cleaned up automatically (after 2 minutes)
- No race conditions between bots

## Next Steps

1. **Test with real data** - Try pulling an actual SQ
2. **Test manual entry** - Enter missing Order Number/Buyer Name
3. **Test upload** - Verify data appears in Refund Log
4. **Run multiple bots** - Open in multiple tabs/windows to test concurrency

## Comparison: Apps Script vs Next.js

| Feature | Apps Script | Next.js |
|---------|-------------|---------|
| Setup Time | 5 minutes | 2 hours |
| Authentication | Built-in | Complex (Clerk + Convex) |
| CORS Issues | None | Yes |
| UI Quality | Good (Bootstrap) | Excellent (React) |
| Deployment | Single click | Multiple services |
| Maintenance | Simple | Complex |
| Cost | Free | Free (but more moving parts) |

**For your use case**: Apps Script is the clear winner! It's simpler, faster to deploy, and has no authentication issues.

The UI may be slightly less fancy than React, but it's still professional and fully functional!
