# Emergency Cleanup Guide

## When to Use This

If the system becomes slow, unresponsive, or you see timeout errors, there may be zombie Apps Script executions holding locks or continuously hitting Convex. This guide will help you clean everything up.

## Symptoms of a Stuck System

- ✗ "Operation timed out" errors
- ✗ Convex fetch taking 60+ seconds
- ✗ Bots showing as "in use" even when no one is using them
- ✗ Pull SQ operation never completes
- ✗ Multiple failed executions in Apps Script logs

## Quick Fix (Do This First)

### 1. Enable Emergency Kill Switch (KILLS ZOMBIE EXECUTIONS)

**This will force ALL running Apps Script executions to exit immediately:**

1. Open Apps Script Editor: https://script.google.com
2. Open the Discrepancy Log project
3. Find line ~30: `EMERGENCY_SHUTDOWN: false,`
4. Change to: `EMERGENCY_SHUTDOWN: true,`
5. **Save** (Ctrl+S / Cmd+S)
6. Wait 30 seconds for zombie executions to die
7. **IMPORTANT**: Change it back to `false` and save again
8. Deploy the updated version

**What this does:**
- Every `checkTimeout()` call checks the kill switch
- If `true`, execution immediately throws error and exits
- Zombies die within seconds instead of running for 6 minutes
- Once all zombies are dead, set back to `false`

### 2. Clean Up Convex Database

**Option A: Using Convex Dashboard (EASIEST)**

1. Go to: https://dashboard.convex.dev/d/energized-spoonbill-94
2. Click on "Functions" tab
3. Find and run: `queue:forceCleanupAll`
   - This deletes all SQ claims and refund reservations
4. Find and run: `sessions:forceReleaseAllSessions`
   - This releases all bot sessions

**Option B: Using Command Line**

```bash
cd convex-backend
node cleanup-convex.js
```

**Option C: From Convex Dev Environment**

```bash
cd convex-backend
npx convex dev
```

Then in another terminal:
```bash
npx convex run queue:forceCleanupAll
npx convex run sessions:forceReleaseAllSessions
```

### 2. Check Apps Script Executions

1. Open: https://script.google.com/home/executions
2. Look for "pullNextSQ" executions that are still "Running" for >5 minutes
3. Note: **You cannot manually stop Apps Script executions**
   - They will timeout automatically after 6 minutes
   - Wait for them to finish or timeout
4. If you see many failed executions, that's normal - the cleanup will fix it

### 3. Verify Cleanup Worked

**Check Convex Dashboard:**
1. Go to: https://dashboard.convex.dev/d/energized-spoonbill-94/data
2. Click on `bot_sessions` table - should be empty or only show active users
3. Click on `sq_claims` table - should be empty or only show current claims
4. Click on `refund_reservations` table - should be empty

**Test the System:**
1. Open Bot Manager UI
2. Select any bot - should work immediately
3. Click "Pull & Claim SQ" - should complete in 10-30 seconds
4. If still slow, wait 5-10 minutes for Apps Script executions to fully clear

## Prevention

### How the System Got Stuck

1. **Timeout cascade**: One slow operation caused others to queue up
2. **Zombie executions**: Failed operations didn't release locks
3. **Convex overload**: Too many concurrent requests to Convex
4. **Large sheet**: Discrepancy Log grew too large

### Changes Made to Prevent This

1. ✅ **Disabled Convex pre-fetch** - Removed slow Convex call from pullNextSQ
2. ✅ **Reduced timeout** - Changed from 60s to 45s to prevent hard timeouts
3. ✅ **Optimized data loading** - Only load needed columns from Discrepancy Log
4. ✅ **Added HTTP timeouts** - All Convex calls have 3-5s max wait
5. ✅ **Client-side timeouts** - UI will stop waiting after 50s
6. ✅ **Better error handling** - System continues even if Convex is slow

### Best Practices

1. **Don't spam the "Pull SQ" button** - Wait for it to complete
2. **Use "Back" button properly** - Always release session when done
3. **Refresh if stuck** - Close tab and reopen if things seem hung
4. **Check execution logs** - Monitor for repeated errors
5. **Run cleanup weekly** - Keeps system healthy

## Manual Cleanup Functions

### In Convex (Available via Dashboard or CLI)

```javascript
// Delete ALL SQ claims and refund reservations
queue:forceCleanupAll()

// Release ALL bot sessions
sessions:forceReleaseAllSessions()

// Delete only stale claims (>10 minutes old)
queue:cleanupStaleClaims()

// Delete only stale sessions (>10 minutes old)
sessions:cleanupStaleSessions()
```

### In Apps Script

No manual cleanup needed - sessions auto-expire after 10 minutes of inactivity.

## Monitoring

### Check System Health

```bash
# View Convex logs
cd convex-backend
npx convex logs

# Check current database state
npx convex run queue:getQueueStatus
```

### Apps Script Logs

1. Go to: https://script.google.com/home/executions
2. Filter by "pullNextSQ"
3. Look for patterns:
   - **Good**: Executions completing in 10-30s
   - **Warning**: Executions taking 40-50s (near timeout)
   - **Bad**: Executions timing out or failing repeatedly

## Contact

If cleanup doesn't work:
1. Check GitHub issues: https://github.com/anthropics/claude-code/issues
2. Review CLAUDE.md for system architecture
3. Check CONVEX_SETUP.md for Convex troubleshooting

---

**Last Updated**: 2025-10-27
**System Version**: 2.1 (Post-timeout optimization)
