# Bot Locking Feature Added

## What Was Added

I've added **real-time bot status checking** that automatically locks/disables bot buttons when they're in use by someone else.

## How It Works

### Visual Indicators
- **Available bots**: Colorful, clickable buttons (blue/green/teal)
- **Locked bots**: Greyed out, disabled with lock icon 🔒
- **Status text**: Shows "In Use - Processing SQ 12345" under locked bots

### Automatic Updates
- Checks bot status **every 5 seconds** automatically
- Updates in real-time without page refresh
- Shows which SQ each bot is currently processing

### Smart Behavior
- **On bot selection page**: Continuously checks and updates status
- **Inside a bot console**: Stops checking (saves resources)
- **When returning to selection**: Restarts status checking

## Technical Details

### Frontend Changes (BotManagerUI.html)

1. **Added IDs to bot buttons**:
   - `bot1Btn`, `bot2Btn`, `bot3Btn`
   - Status spans: `bot1Status`, `bot2Status`, `bot3Status`

2. **New JavaScript Functions**:
   - `checkBotStatus()` - Calls Apps Script to get active claims
   - `updateBotStatus(claims)` - Updates UI based on active claims
   - Auto-runs on page load and every 5 seconds

3. **Status Interval Management**:
   - Starts when on bot selection page
   - Stops when entering bot console (performance)
   - Restarts when returning to selection

### Backend (Already Exists!)

The `getActiveClaims()` function was already in the Apps Script:
```javascript
function getActiveClaims() {
  // Returns array of active claims with:
  // - botId: 'BOT1', 'BOT2', 'BOT3'
  // - sqNumber: 'SQ-12345'
  // - status: 'CLAIMING'
  // - claimedAt: timestamp
}
```

## User Experience

### Scenario 1: All Bots Available
```
┌─────────────────────┐
│   Select Bot        │
├─────────────────────┤
│  [BOT 1]  Available │
│  [BOT 2]  Available │
│  [BOT 3]  Available │
└─────────────────────┘
```

### Scenario 2: BOT1 In Use
```
┌──────────────────────────────┐
│   Select Bot                 │
├──────────────────────────────┤
│  [BOT 1 - Greyed Out]        │
│  🔒 In Use - Processing      │
│      SQ 12345                │
│                              │
│  [BOT 2]  Available          │
│  [BOT 3]  Available          │
└──────────────────────────────┘
```

User **cannot** click BOT1 - button is disabled!

### Scenario 3: Multiple Bots Busy
```
┌──────────────────────────────┐
│   Select Bot                 │
├──────────────────────────────┤
│  [BOT 1 - Greyed Out]        │
│  🔒 In Use - SQ 12345        │
│                              │
│  [BOT 2 - Greyed Out]        │
│  🔒 In Use - SQ 12346        │
│                              │
│  [BOT 3]  Available          │
└──────────────────────────────┘
```

Only BOT3 is clickable!

## Prevents Race Conditions

This feature helps prevent:
- ❌ Two people selecting same bot simultaneously
- ❌ Accidentally interrupting someone's work
- ❌ Confusion about which bot is busy

## Deployment

### To Update Your Web App

1. **Update BotManagerUI.html**:
   - Copy the updated HTML from `/Users/mpwright/Discrep/scripts/BotManagerUI.html`
   - Paste into Apps Script editor (replace existing)
   - Save

2. **Create NEW Deployment**:
   - Deploy → New deployment → Web app
   - Or update existing: Deploy → Manage → Edit → New version

3. **Test**:
   - Open Web App URL
   - You should see bot buttons
   - Open another tab/window, select a bot
   - Go back to first tab - that bot should be greyed out!

## Performance

- **Network traffic**: Very light (one API call every 5 seconds)
- **Server load**: Minimal (quick database query)
- **User experience**: Seamless, no lag

The 5-second interval is a good balance between:
- Real-time enough to prevent conflicts
- Not too frequent to waste resources

## Future Enhancements (Optional)

Could add:
- Show who is using each bot (requires user tracking)
- "Take Over" button for admins
- Notification when a bot becomes available
- Adjustable refresh interval

But the current implementation is solid and production-ready!
