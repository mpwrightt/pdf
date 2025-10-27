# Apps Script Troubleshooting - Getting JSON Instead of UI

## The Problem
When you visit the Web App URL, you're seeing JSON instead of the HTML UI.

## Most Likely Cause
Apps Script is serving a **cached version** of your old deployment.

## Solution: Create a NEW Deployment

### Step 1: Delete Old Deployment (Optional)
1. In Apps Script, click **Deploy → Manage deployments**
2. Click the **Archive** button (trash icon) next to the old deployment
3. Click **Done**

### Step 2: Create Fresh Deployment
1. Click **Deploy → New deployment**
2. Click the gear icon ⚙️ next to "Select type"
3. Choose **Web app**
4. Configure:
   - **Description**: "Bot Manager UI - Fixed" (or any new description)
   - **Execute as**: Me
   - **Who has access**: Anyone from eBay
5. **Important**: Make sure "New version" is selected (not "Head")
6. Click **Deploy**
7. **Copy the NEW URL** (it will be different!)
8. Click **Done**

### Step 3: Test New URL
1. Open the NEW deployment URL in your browser
2. You should see the purple gradient UI with bot buttons

## Alternative: Force Update Existing Deployment

If you want to keep the same URL:

1. **Deploy → Manage deployments**
2. Click the **Edit** (pencil) icon next to your deployment
3. In the "Version" dropdown, select **New version**
4. Add description: "Updated with HTML UI"
5. Click **Deploy**
6. The URL stays the same but now serves the new code

## Verification Checklist

Before deploying, verify in Apps Script editor:

### ✅ Check 1: HTML File Exists
- Look in the left sidebar
- You should see a file named **BotManagerUI.html**
- Click on it to verify it has the Bootstrap UI code

### ✅ Check 2: Only ONE doGet() Function
- Open the .gs file
- Search for "function doGet"
- There should be **only ONE** at the top (around line 41)
- It should say: `HtmlService.createHtmlOutputFromFile('BotManagerUI')`
- There should NOT be another one returning JSON

### ✅ Check 3: File Name Matches
- The HTML file is named: **BotManagerUI.html** (no space, exact case)
- The doGet() references: `'BotManagerUI'` (must match exactly)

## Still Getting JSON?

If you still see JSON after creating a new deployment:

### Test Directly in Apps Script

1. In Apps Script editor, click on the `doGet` function name
2. Click the **Run** button (▶️ play icon) at the top
3. Grant permissions if asked
4. Check the Execution log - it should say "Completed"

If this fails, the issue is with the HTML file name or content.

### Check Browser Cache

1. Open the Web App URL in an **Incognito/Private window**
2. Or clear your browser cache (Cmd+Shift+Delete / Ctrl+Shift+Delete)
3. Hard refresh the page (Cmd+Shift+R / Ctrl+Shift+R)

### Verify HTML File Contents

Make sure `BotManagerUI.html` starts with:
```html
<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bot Manager</title>
```

And NOT with any Apps Script code.

## Common Mistakes

❌ **HTML file named wrong** - Must be exactly `BotManagerUI` (case-sensitive)
❌ **Two doGet() functions** - Only keep the one that returns HtmlService
❌ **Using old deployment URL** - Must create NEW deployment for changes
❌ **Browser cache** - Try incognito window
❌ **Permissions not granted** - Run doGet() manually first

## Expected Result

When it works, you should see:
- Purple/blue gradient background
- "Bot Manager" heading with robot icon
- Three large buttons: BOT 1, BOT 2, BOT 3
- Bootstrap styling (modern, clean UI)

NOT:
- JSON like `{"status": "Queue Manager Service is running"...}`
- Plain text
- Blank page
