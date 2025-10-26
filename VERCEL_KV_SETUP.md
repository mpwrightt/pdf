# Vercel KV Setup Guide

## What is Vercel KV?

Vercel KV is a Redis-compatible key-value database that provides **persistent, atomic storage** across all serverless function instances. This solves the race condition where multiple bots were claiming the same SQ.

## Why We Need It

**The Problem:**
- In-memory storage resets when serverless functions cold-start
- Multiple concurrent requests can hit different function instances
- Result: BOT1 and BOT3 both claimed SQ 251019-164rmb

**The Solution:**
- Vercel KV provides shared, persistent storage
- All function instances read/write to the same Redis database
- Atomic operations prevent race conditions
- Free tier: 256 MB, 100k reads/month (more than enough for our use case)

---

## Setup Steps (5 minutes)

### 1. Open Vercel Dashboard

Visit: https://vercel.com/dashboard

### 2. Navigate to Your Project

Click on: **pdf-nine-psi**

### 3. Go to Storage Tab

At the top of the page, click: **Storage**

### 4. Create New Database

1. Click: **"Create Database"**
2. Select: **"KV"** (key-value store)

### 5. Configure Database

- **Name**: `queue-coordination` (or any name you prefer)
- **Region**: Choose closest to you:
  - `us-east-1` (US East)
  - `us-west-1` (US West)
  - `eu-west-1` (Europe)
- Click: **"Create"**

### 6. Connect to Project

1. After creation, it will ask: **"Connect to project?"**
2. Select: **pdf-nine-psi**
3. Click: **"Connect"**

### 7. Done! 🎉

Vercel automatically adds these environment variables to your project:
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

The next deployment will automatically pick them up - **no manual configuration needed!**

---

## Verify Setup

### Option 1: Check Vercel Dashboard

1. Go to your project: **pdf-nine-psi**
2. Click: **Settings** → **Environment Variables**
3. You should see:
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`

### Option 2: Test the API

After the next deployment completes, visit:
```
https://pdf-nine-psi.vercel.app/api/queue
```

**Before KV Setup (you'll see this now):**
```json
{
  "success": false,
  "error": "KV not configured. Visit Vercel dashboard to set up KV storage."
}
```

**After KV Setup (what you should see):**
```json
{
  "success": true,
  "sqClaims": {},
  "refundReservations": {},
  "timestamp": "2025-10-26T...",
  "kvConfigured": true
}
```

---

## How It Works

### Data Structure in KV

**SQ Claims:**
```
Key: sq:{sqNumber}
Value: {"botId": "BOT1", "timestamp": "...", "status": "CLAIMING"}
```

**Refund Log Reservations:**
```
Key: refund:{sqNumber}
Value: {"botId": "BOT1", "startRow": 51, "rowCount": 5, "status": "WRITING", "timestamp": "..."}
```

### Auto-Cleanup

- All keys auto-expire after 10 minutes (600 seconds)
- Prevents stale locks from blocking other bots
- Stale claims are also manually cleaned on each request

---

## Pricing

**Vercel KV Free Tier:**
- ✅ 256 MB storage
- ✅ 100,000 reads per month
- ✅ 100,000 writes per month
- ✅ 100 MB bandwidth

**Your Usage (estimated):**
- 3 concurrent bots
- ~10 SQs per day per bot = 30 SQs/day
- ~60 operations per SQ (claim, release, reserve, etc.)
- **Total: ~1,800 operations/day = ~54,000/month**

✅ **Well within free tier limits!**

---

## Troubleshooting

### "KV not configured" Error

**Cause:** Environment variables not set

**Solution:**
1. Go to Vercel Dashboard → Storage
2. Verify KV database is created
3. Verify it's connected to `pdf-nine-psi` project
4. Check Settings → Environment Variables for `KV_REST_API_URL` and `KV_REST_API_TOKEN`
5. Redeploy project (push to GitHub triggers auto-deploy)

### Race Condition Still Happening

**Cause:** Using old code without KV

**Solution:**
1. Verify KV is set up (see above)
2. Pull latest code: `git pull origin main`
3. Check `pdf-parser-server/api/queue.py` contains `VercelKV` class
4. Wait for Vercel deployment to complete

### Check KV Data (Debugging)

Visit: `https://pdf-nine-psi.vercel.app/api/queue`

This shows:
- All active SQ claims
- All active Refund Log reservations
- Timestamps for debugging

---

## Next Steps

After setting up KV:

1. ✅ **Set up KV in Vercel Dashboard** (follow steps above)
2. ✅ **Wait for deployment** (GitHub push triggers auto-deploy)
3. ✅ **Test with 3 concurrent bots** - Each should get different SQ
4. ✅ **Monitor queue status** at `/api/queue` endpoint

---

## Summary

- **Before:** In-memory storage → race conditions
- **After:** Vercel KV → atomic, persistent coordination
- **Setup:** 5 minutes in Vercel Dashboard
- **Cost:** Free tier is plenty
- **Result:** Bulletproof multi-user bot coordination! 🎉
