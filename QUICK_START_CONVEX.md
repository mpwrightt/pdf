# Quick Start - Convex Setup

## TL;DR - 5 Steps

```bash
# 1. Sign up for Convex
# Go to: https://dashboard.convex.dev/
# Click "Sign up with GitHub"

# 2. Create project
# Name: refund-queue
# Save the deployment URL (e.g., https://happy-animal-123.convex.cloud)

# 3. Deploy Convex backend (on your local machine)
cd /Users/mpwright/Discrep/convex-backend
npm install
npx convex dev
# → Paste your deployment URL when prompted
# → Authorize in browser
# → Wait for "✓ Convex functions deployed"

# 4. Add CONVEX_URL to Vercel
# Go to: https://vercel.com/dashboard
# Project: pdf-nine-psi → Settings → Environment Variables
# Add: CONVEX_URL = https://happy-animal-123.convex.cloud
# Click "Redeploy"

# 5. Test
# Visit: https://pdf-nine-psi.vercel.app/api/queue
# Should see: "convexConfigured": true
```

## That's It!

No more race conditions. Each bot gets a different SQ. 🎉

## Full Guide

See: **CONVEX_SETUP.md** for detailed instructions and troubleshooting.

## Monitor Queue

- **Convex Dashboard:** https://dashboard.convex.dev/
- **Queue Status:** https://pdf-nine-psi.vercel.app/api/queue
- **BOTS Sheet:** Still works for visibility

## Free Tier

- ✅ 1M function calls/month
- ✅ Way more than you need
- ✅ No credit card required
