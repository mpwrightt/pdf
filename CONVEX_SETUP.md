# Convex Setup Guide

## Why Convex?

**Better than Vercel KV:**
- ✅ 1M function calls/month (vs 100k for KV)
- ✅ Real-time database with subscriptions
- ✅ Built-in transactions (atomic operations)
- ✅ Better debugging dashboard
- ✅ TypeScript support
- ✅ Easier to set up

---

## Setup Steps (10 minutes)

### Step 1: Sign Up for Convex

1. Go to: https://dashboard.convex.dev/
2. Click "Sign up with GitHub" (easiest option)
3. Authorize Convex to access your GitHub

### Step 2: Create Project

1. After signing in, click **"Create a project"**
2. **Project name:** `refund-queue` (or any name you like)
3. Click **"Create"**

### Step 3: Get Deployment Information

After creation, you'll see:

1. **Deployment URL** (example):
   ```
   https://happy-animal-123.convex.cloud
   ```
   **Save this!** We'll add it to Vercel environment variables.

2. **Deploy Key** (find it in Settings → Deploy Keys):
   ```
   prod:happy-animal-123|a1b2c3d4e5f6...
   ```
   **Save this too!** We'll use it to deploy the backend.

### Step 4: Deploy Convex Backend

On your local machine, run:

```bash
cd /Users/mpwright/Discrep/convex-backend
npm install
npx convex dev
```

When prompted:
1. **"What is your Convex deployment URL?"**
   → Paste the deployment URL from Step 3

2. It will open a browser for authentication → Click "Authorize"

3. The backend will deploy automatically!

You should see:
```
✓ Convex functions deployed
✓ Schema deployed
```

### Step 5: Add Convex URL to Vercel

1. Go to: https://vercel.com/dashboard
2. Click your project: **pdf-nine-psi**
3. Go to: **Settings** → **Environment Variables**
4. Add new variable:
   - **Name:** `CONVEX_URL`
   - **Value:** Your deployment URL (e.g., `https://happy-animal-123.convex.cloud`)
   - Click **Save**

5. **Redeploy** your Vercel project:
   - Go to **Deployments** tab
   - Click **"Redeploy"** on the latest deployment
   - Or just push to GitHub (auto-deploys)

### Step 6: Verify Setup

Visit:
```
https://pdf-nine-psi.vercel.app/api/queue
```

**You should see:**
```json
{
  "success": true,
  "sqClaims": [],
  "refundReservations": [],
  "timestamp": "2025-10-26T...",
  "convexConfigured": true
}
```

✅ **If you see this, you're all set!**

---

## How It Works

### Architecture

```
Helper Doc (Google Apps Script)
    ↓ HTTPS POST
Vercel API (/api/queue.py)
    ↓ HTTPS POST
Convex Backend (queue.ts)
    ↓
Convex Database (PostgreSQL)
```

### Data Flow

**Claim SQ:**
1. BOT1 calls `/api/queue` with action: `tryClaimSQ`
2. Vercel calls Convex mutation: `tryClaimSQ`
3. Convex checks if SQ is already claimed
4. If available → inserts claim record → returns success
5. If claimed → returns error with bot ID

**Race Condition Prevention:**
- Convex uses **transactions** - atomic database operations
- Multiple requests arrive → processed sequentially by database
- First request wins, others get rejection
- **Guaranteed no duplicates!**

---

## Convex Dashboard Features

Visit: https://dashboard.convex.dev/

### Functions Tab
- See all function calls in real-time
- Monitor performance
- View arguments and return values

### Data Tab
- Browse `sq_claims` table
- Browse `refund_reservations` table
- See which bot has which SQ
- Manual cleanup if needed

### Logs Tab
- See console.log output
- Debug errors
- Monitor API calls

---

## Free Tier Limits

**Convex Free Tier:**
- ✅ 1,000,000 function calls/month
- ✅ 1 GB database storage
- ✅ 5 GB bandwidth
- ✅ Unlimited projects

**Your Usage (estimated):**
- 3 concurrent bots
- ~30 SQs/day
- ~60 operations per SQ
- **Total: ~1,800 ops/day = ~54,000/month**

✅ **Well within free tier!**

---

## Troubleshooting

### "Convex not configured" Error

**Cause:** `CONVEX_URL` environment variable not set in Vercel

**Solution:**
1. Verify Convex project is deployed (Step 4)
2. Add `CONVEX_URL` to Vercel env vars (Step 5)
3. Redeploy Vercel project

### "Cannot connect to Convex" Error

**Cause:** Convex backend not deployed or URL is wrong

**Solution:**
1. Go to: https://dashboard.convex.dev/
2. Check your project is showing "Active"
3. Copy the deployment URL
4. Verify it matches the `CONVEX_URL` in Vercel

### Check Convex Backend

In your Convex dashboard:
1. Go to **Functions** tab
2. Look for: `queue:tryClaimSQ`, `queue:releaseSQ`, etc.
3. If missing → backend not deployed → run `npx convex dev` again

---

## Deployment Checklist

- [ ] Sign up for Convex
- [ ] Create project named `refund-queue`
- [ ] Save deployment URL
- [ ] Install dependencies: `cd convex-backend && npm install`
- [ ] Deploy backend: `npx convex dev`
- [ ] Add `CONVEX_URL` to Vercel environment variables
- [ ] Redeploy Vercel project
- [ ] Test: Visit `https://pdf-nine-psi.vercel.app/api/queue`
- [ ] Verify: Should see `"convexConfigured": true`

---

## Next Steps

After setup:

1. ✅ Test with 3 concurrent bots
2. ✅ Monitor in Convex dashboard
3. ✅ Check queue status: `/api/queue`
4. ✅ No more race conditions! 🎉

---

## Summary

- **Setup time:** 10 minutes
- **Cost:** Free (1M calls/month)
- **Benefit:** Bulletproof atomic queue coordination
- **Bonus:** Real-time dashboard for debugging

Much better than Vercel KV! 🚀
