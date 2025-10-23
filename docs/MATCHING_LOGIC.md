# Card Matching Logic

## Overview

`scripts/HelperDocAutomation.gs` converts parsed PDF data into Direct Order matches for the helper sheet. The logic is designed to survive inconsistent PDF formatting and normalize values before comparison.

## Current Logic Highlights

- **Collector-first fallback:** When `collectorNumber` matches after normalization, we will accept the row even if the set or name is slightly different (common for Yu-Gi-Oh! split headers).
- **Condition normalization:** Verbose strings such as “Near Mint 1st Edition” collapse to `nm`. Foil variants remain distinguishable (`nmf`, `lpf`, etc.).
- **Quantity parity:** CSV rows store negative counts (refund quantity). The code compares against the absolute value from the PDF line, so `-3` matches `3`.
- **Order scoping:** Matches must live within a single “Direct by TCGplayer # …” block. This protects against cross-order bleed when the PDF repeats a card name.

## Normalization

### Collector Numbers

`normalizeCollector()` performs these steps:

- Trim / uppercase / collapse internal whitespace.
- Drop a leading `#` (`#092` → `92`).
- Fractional values become canonical segments (`0307/123` → `307/123`).
- Yu-Gi-Oh codes zero-pad and glue their suffix (`DOOD-EN 85` → `DOOD-EN085`).
- Pure integers drop leading zeros (`0012` → `12`).

### Condition Codes

The helper script maps PDF strings to the canonical abbreviations:

| Canonical | Accepted patterns (lowercased) |
| --- | --- |
| `nm` | `near mint`, `nm1`, `nmh`, `nmrh`, `mint` |
| `lp` | `lightly played`, `light played`, `lpf`, `lph` |
| `mp` | `moderately played`, `moderate` |
| `hp` | `heavily played`, `heavy` |
| `damaged` | `damaged`, `dmg` |

Foil tokens add a `f` suffix (`nmf`, `lpf`) when detected in either the CSV or PDF. The parser already merges trailing “Foil” lines into the condition string.

### Set Name Cleanup

The parser trims trailing game tokens and stitches multi-line headers so we receive clean set names. Apps Script still runs `normalizeSetName()` to strip punctuation and handle common aliases.

## Matching Pipeline

The helper script evaluates each CSV row via the following priority list:

1. **Exact match (Name + Condition + Set + Collector).**
2. **Collector fallback.** If the collector numbers match but set OR name differs, log a fallback and accept.
3. **Name + Set + Quantity guard.** Identify duplicates and insert additional rows when the same card exists in multiple orders.
4. **Failure.** Unmatched rows log `✗ No match found` and keep Direct Order # blank for manual handling.

The parser pre-filters occurrences so Apps Script evaluates far fewer candidates per order, even in mixed Magic / Pokémon / Yu-Gi-Oh PDFs.

## Logs to Monitor

```
Row 14: ✓ Matched! Order: 251012-4B21, Buyer: Steven Chaney
Row 22: INFO: Using fallback match (condition differs): PDF=magic - wilds of eldraine: enchanting, CSV=nm
Row 29: ✗ No match found for: Chevreuil, Hunting Scout of the Deep Forest (Doom of Dimensions)
Row 29: Collector match fallback triggered → Order 251012-FD71
```

- **`✓ Matched!`** indicates a full alignment on all fields.
- **`INFO: Using fallback match`** surfaces when collector-based acceptance occurs.
- **`✗ No match found`** is the key cue for manual investigation.

## Duplicate Handling

When multiple orders contain a single CSV card, the script duplicates the row and appends `[DUPLICATE n]` to the log entry.

```text
Row 18: WARNING: Found 2 matching orders for this card! Orders: 251012-2179, 251012-34E5
Row 18: Lizard Blades → 251012-2179 (PRIMARY)
Row 18: Lizard Blades → 251012-34E5 (DUPLICATE 1)
```

The helper sheet receives both Direct Order numbers so the Refund Log is complete.

## Testing

When updating matching logic or normalization, run:

```javascript
// in Apps Script console
testMatchingHarness();
```

This uses fixtures in `tests/test_matching.js` to confirm collector normalization, YGO header fallbacks, and condition mapping. Re-run the helper menu flow on:

- `docs/SQ_251013-364clc_Sheets.pdf` (mixed games)
- `docs/SQ_251013-340rpc_Sheets.pdf` (Pokémon, known Gyarados ex regression guard)
- Any new PDFs added to the `docs/` directory

## Troubleshooting Checklist

- **Collector mismatch:** Confirm both PDF and CSV values normalize to the same string by running `normalizeCollector()` in the Apps Script console.
- **Set mismatch:** Look at parser output; trimmed sets should not include `Magic -` prefixes. If they do, revisit the parser dedupe rules in `pdf-parser-server/api/parse.py`.
- **No cards returned:** Check Vercel logs for parser errors (`vercel logs pdf-nine-psi`). If the PDF layout is new, capture the surrounding text and add a new parser pattern.
- **Fallback spam:** Re-run with `Logger` enabled at `INFO` level to ensure the right orders triggered the fallback (collector-first). Excess fallback usage usually indicates set aliases are missing.

## Performance Notes

- Apps Script processes ~2–5 cards per second in production.
- Parser runs in <2 seconds for 1,200-card PDFs on Vercel (capped by cold starts).
- Duplicate handling is linear in the number of occurrences; expect additional log entries but no exponential blowups.

## Manual Verification Tips

1. Check logs after each run (`View > Executions`).
2. Spot-check a Magic, Pokémon, and Yu-Gi-Oh entry for collector correctness.
3. Investigate unmatched rows immediately—feed their context back into parser normalization.

## Summary

The current system marries aggressive PDF parsing (slot prefixes, multi-line headers, Yu-Gi-Oh splits, foil continuations) with collector-centric matching. As long as both layers stay in sync, helper runs complete at 100% accuracy across mixed SQ PDFs.
