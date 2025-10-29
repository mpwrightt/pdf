# Condition Matching Fix - October 29, 2025

## Problem
PDF parser successfully extracted 138 orders from SQ 251019-247clc, but only **30 out of 46 cards** were matched. 16 cards remained unmatched with empty Order# and Buyer Name.

## Root Cause
The `normalizeCondition()` function was not properly handling condition suffix variations between:
- **PDF format**: `"Near Mint Holofoil"`, `"Near Mint 1st Edition"`, `"Moderately Played Unlimited"`
- **Discrepancy Log format**: `NMF`, `NMH`, `NM1`, `MPU`, `LPF`, `MPH`, etc.

## Examples of Unmatched Cards (Before Fix)
| Row | Card Name | Log Condition | PDF Condition | Issue |
|-----|-----------|---------------|---------------|-------|
| 210 | Theoden, Strength Restored | **LPF** | "Lightly Played Foil" | "F" suffix |
| 217 | Weezing | **MPU** | "Moderately Played Unlimited" | "U" suffix |
| 218 | Stay with Me - Rhystic Study | **NMF** | "Near Mint Foil" | "F" suffix |
| 222 | Demonic Consultation | **NMF** | "Near Mint Foil" | "F" suffix |
| 229 | Token: Sheep (Pink) | **NML** | "Near Mint Limited" | "L" suffix |
| 230 | Red-Eyes Dark Dragoon | **NM1** | "Near Mint 1st Edition" | "1" suffix |

## Solution
Updated `normalizeCondition()` function in `QueueManagerService_WebApp.gs` (lines 2734-2773) to:

1. **Strip trailing suffix words** from PDF text:
   - "Reverse Holofoil", "Holofoil", "Foil"
   - "1st Edition", "Unlimited", "Limited"

2. **Strip single-letter suffixes** from abbreviated codes:
   - F, H, U, L, 1

3. **Normalize to base condition** only (NM, LP, MP, HP)

### Code Change
```javascript
// OLD (preserved foil suffixes, causing mismatches)
const isFoil = cond.includes('foil') || cond.endsWith('f');
if (cond.startsWith('nm')) return isFoil ? 'nmf' : 'nm';

// NEW (strips all suffixes for matching)
cond = cond
  .replace(/\s*(reverse holofoil|reverse holo|holofoil|holo foil|foil|1st edition|unlimited|limited)\s*$/gi, '')
  .trim();
cond = cond.replace(/[fhul1]$/, '').trim();
if (cond === 'nm' || cond.startsWith('nm')) return 'nm';
```

## Test Results
All condition variations now normalize correctly:

✓ PDF "Near Mint Holofoil" → `nm` matches Log "NMH" → `nm`  
✓ PDF "Near Mint 1st Edition" → `nm` matches Log "NM1" → `nm`  
✓ PDF "Moderately Played Unlimited" → `mp` matches Log "MPU" → `mp`  
✓ PDF "Near Mint Reverse Holofoil" → `nm` matches Log "NMH" → `nm`  
✓ PDF "Lightly Played Foil" → `lp` matches Log "LPF" → `lp`

## Deployment Steps

### 1. Open Apps Script Editor
- URL: https://docs.google.com/spreadsheets/d/1m0dSOA2VogToEpAo6Jj7FEEsfJbWi1W48xiyTHkBNyY
- Click: **Extensions** → **Apps Script**

### 2. Update the Script
- Open `/Users/mpwright/Discrep/scripts/QueueManagerService_WebApp.gs` locally
- Copy entire file contents
- In Apps Script Editor: Select All (Cmd+A), Paste, Save (Cmd+S)

### 3. Deploy
- Click: **Deploy** → **Manage deployments**
- Click pencil icon (✏️) next to active deployment
- Version: **New version**
- Description: `Fix condition matching - strip foil/holofoil/1st ed/unlimited suffixes`
- Click **Deploy**

### 4. Test
- Re-upload PDF for SQ 251019-247clc
- Verify all 46 cards now have Order# and Buyer Name filled
- Expected match rate: **46/46 (100%)**

## Files Changed
- `/Users/mpwright/Discrep/scripts/QueueManagerService_WebApp.gs` (lines 2734-2773)

## Expected Outcome
All 16 previously unmatched cards should now match:
- Row 210: Theoden, Strength Restored (LPF)
- Row 212: Balin's Tomb - Ancient Tomb (MPF)
- Row 217: Weezing (MPU)
- Row 218-222: FINAL FANTASY cards (NMF)
- Row 223-224: Pokemon cards (NMH)
- Row 226-231: Pokemon/YuGiOh cards (MPH, MPUH, NML, NM1, LP1)

**Total expected matches**: 46/46 (100%)
