# Critical Issues Found in Web App

## Issue 1: Missing Vercel Queue Integration

### Problem
The web app is missing the Vercel-based centralized queue that prevents race conditions when multiple users/bots try to claim the same SQ.

### HelperDocAutomation.gs Uses:
1. **tryReserveSQ(sqNumber)** - Calls Vercel API to atomically reserve an SQ
   - URL: `CONFIG.VERCEL_QUEUE_URL`
   - Action: `tryClaimSQ`
   - Returns success/failure
   - Only proceeds if Vercel grants the reservation

2. **releaseSQ(sqNumber)** - Releases the reservation after processing
   - URL: `CONFIG.VERCEL_QUEUE_URL`
   - Action: `releaseSQ`

3. **BOTS Sheet Sync** - Also writes to BOTS sheet for visibility (secondary)

### Web App Current Behavior:
- ❌ No Vercel queue integration
- ❌ Direct writes to Discrepancy Log without reservation
- ❌ Race condition possible if two users claim same SQ simultaneously
- ⚠️ Only uses Google Sheets BOTS tab (not atomic enough)

### Fix Required:
The web app's `pullNextSQ` function MUST:
1. Call Vercel queue API `tryClaimSQ` first
2. Only proceed with claiming if Vercel approves
3. If another bot already claimed it, try the next SQ
4. Release reservation after upload to Refund Log

---

## Issue 2: Oversimplified PDF Matching Logic

### Problem
The web app's PDF matching is WAY too simple - it only does exact card name matching, causing most cards to not match.

### HelperDocAutomation.gs Has:

**1. Multiple Normalization Levels:**
```javascript
normalizeNameExact(name)  // Basic: trim, lowercase, collapse spaces
normalizeNameLoose(name)  // Remove parentheticals, punctuation, hyphens
stripParentheticals(name) // Remove (text in parens)
normalizeSetName(name)    // Ignore "Holofoil" and other noise
normalizeCondition(cond)  // Map "Near Mint" → "nm", "Lightly Played" → "lp"
normalizeCollector(num)   // Clean collector numbers
```

**2. Sophisticated findMatchingOrder() Function:**
- Tries EXACT match first (name + set + condition)
- Falls back to BASE match (no parentheticals)
- Falls back to LOOSE match (ignore punctuation)
- Falls back to COLLECTOR NUMBER match
- Falls back to WEAK CANDIDATE (name + set, ignore condition)
- Has extensive debug logging

**3. Multi-Level Matching Strategy:**
```javascript
// Level 1: Exact name + set + condition match
if (cardNameNormalized === normalizedCardName &&
    setMatch && condMatch) {
  return order;
}

// Level 2: Base name (no parens) + set + condition
if (cardNameBase === baseCardName &&
    setMatch && condMatch) {
  return order;
}

// Level 3: Loose name (ignore punctuation) + set
if (cardNameLoose === looseCardName && setMatch) {
  weakCandidate = order;
}

// Level 4: Collector number + set
if (normalizedCollector &&
    cardCollectorNormalized === normalizedCollector &&
    setMatch) {
  collectorCandidate = order;
}

// Return best match found
return collectorCandidate || weakCandidate;
```

### Web App Current Matching:
```javascript
// TOO SIMPLE!
const parsedCardName = (card.name || '').toLowerCase().trim();
if (parsedCardName === normalizedCardName) {
  // Set and condition checks are weak
  if (setMatch && conditionMatch) {
    // Match!
  }
}
```

**Problems:**
- ❌ No parenthetical stripping
- ❌ No punctuation normalization
- ❌ No collector number fallback
- ❌ No condition normalization (NM vs Near Mint)
- ❌ No weak candidate fallback
- ❌ Set matching is too strict (doesn't handle "Holofoil" etc)
- ❌ Missing debug logging

### Fix Required:
Replace the web app's `fillOrderInfo` function with the FULL matching logic from HelperDocAutomation.gs:
1. Copy all normalization functions
2. Copy `findMatchingOrder()` function
3. Use multi-level matching strategy
4. Add proper fallbacks

---

## Recommendation

We need to:
1. ✅ Add Vercel queue integration to web app `pullNextSQ`
2. ✅ Replace simple PDF matching with sophisticated matching from HelperDocAutomation.gs
3. ✅ Add all helper functions for normalization
4. ✅ Test with actual PDFs to verify matching works

Without these fixes:
- Multiple users WILL create race conditions
- PDF uploads WILL fail to match most cards
- Users will be forced to use manual entry for everything
