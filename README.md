# TCGplayer Discrepancy Refund Automation

Automated workflow for processing refunds for missing cards in TCGplayer Direct inventory. Uses Google Apps Script with a centralized queue service for concurrent bot coordination, plus a Python-based PDF parser deployed on Vercel.

## Quick Start (Concurrent Bots)

### ✅ Queue Manager Already Deployed

The centralized Queue Manager Web App is deployed at:
```
https://script.google.com/a/macros/ebay.com/s/AKfycbwrLg1hD-_d4LA4iky6VGYTUCYuJeUbHZbfyN7KWX4MzK98pzp1HOR3TxVqt7__R8higA/exec
```

### To Add a New Bot (BOT4, BOT5, etc.)

1. **Clone a Helper Doc** - Duplicate BOT1's Helper Doc
2. **Deploy the script** - Extensions → Apps Script → Copy `scripts/HelperDocAutomation.gs`
3. **Change BOT_ID** - Update line 14: `BOT_ID: 'BOT4',` (must be unique!)
4. **Save** - Ctrl+S / Cmd+S
5. **Test** - Run "🤖 Refund Tools > 1️⃣ Claim Next SQ"

### Full Deployment Guide

See **[DEPLOY_CENTRALIZED_QUEUE.md](DEPLOY_CENTRALIZED_QUEUE.md)** for complete setup instructions.

## Overview

This system automates the refund processing workflow by:

1. Pulling unclaimed items from the Discrepancy Log
2. Parsing SQ detail PDFs (mixed game support: Pokémon, Magic, Yu-Gi-Oh, Marvel’s Spider-Man) to extract order information
3. Matching cards to orders with multi-criteria fallbacks (name, set, condition, collector number)
4. Sending completed refund data to the Refund Log

## Project Structure

```text
/
├── scripts/              # Google Apps Script files
│   ├── HelperDocAutomation.gs        # Main automation workflow + match logic
│   ├── AutoFillOrderInfo_Upload.gs   # Upload trigger glue
│   └── DiscrepancyRefundAutomation.gs # Legacy script (reference only)
├── pdf-parser-server/    # Vercel serverless PDF parser
│   ├── api/parse.py      # Python PDF parsing endpoint
│   ├── vercel.json       # Deployment configuration
│   └── requirements.txt  # Python dependencies
├── docs/                 # Documentation
│   ├── AUTOMATION_PLAN.md   # Original API requirements
│   ├── MATCHING_LOGIC.md    # Card matching algorithm
│   └── AGENTS.MD            # Manual process documentation
├── tests/                # Test files
│   └── test_matching.js  # Matching logic tests
├── data/                 # Local test data (gitignored)
└── README.md             # This file
```

## Components

### 1. Google Apps Script (scripts/)

**Key entry point:** `HelperDocAutomation.gs`

**Highlights:**

- Pulls unclaimed SQ items from the Discrepancy Log using configurable filters (no initials, unsolved, not red, not in vault, `LocationID != "NONE"`).
- Calls the Vercel PDF parser, then merges the response with CSV data using normalized identifiers:
  - `normalizeCollector()` strips leading `#`, collapses whitespace, normalizes fractions, zero-pads YGO codes (e.g., `DOOD-EN085`).
  - `normalizeCondition()` maps verbose text to the canonical codes (NM, LP, MP, HP, Foil variants).
  - Collector-first fallback picks matches when name or set differs but collector matches.
- Logs every decision (`Matched!`, fallbacks, duplicates, errors) so agents can audit quickly.

### 2. PDF Parser API (pdf-parser-server/)

**Deployment:** <https://pdf-nine-psi.vercel.app/api/parse>

**Tech stack:** Python, `pdfplumber`, Vercel serverless.

**Capabilities:**

- Supports multiple layout variants in a single run (mixed games, slot prefixes, missing `#`, multi-line headers, Yu-Gi-Oh `DOOD-EN###` splits, Pokémon collector fractions).
- Cleans condition strings (drops trailing game tokens, merges `Foil` continuation lines).
- Deduplicates cards by `(name, collectorNumber)` and prefers entries with clean set names.
- Returns `orders` array with `orderNumber`, `buyerName`, and normalized `cards` payloads consumed by Apps Script.

## Documentation

- **[docs/AUTOMATION_PLAN.md](docs/AUTOMATION_PLAN.md)** – Original system requirements and manual process.
- **[docs/MATCHING_LOGIC.md](docs/MATCHING_LOGIC.md)** – Up-to-date matching heuristics, normalization, and troubleshooting (see “Current Logic Highlights” section).
- **[docs/AGENTS.MD](docs/AGENTS.MD)** – Human SOP for handling edge cases.

## Daily Workflow

1. **Pull next SQ** (`🤖 Refund Tools > 1️⃣ Claim Next SQ`). Confirm the helper sheet populates `SQ Number`, game, and card data from the Discrepancy Log.
2. **Upload PDF** (`🤖 Refund Tools > 2️⃣ Upload SQ PDF`) and monitor the Apps Script logs for API latency or parser errors.
3. **Review matches** directly in the helper sheet; unmatched rows are logged with `✗ No match found`. Resolve manually if needed or adjust normalization logic.
4. **Send to Refund Log** (`🤖 Refund Tools > 4️⃣ Send to Refund Log`) once all rows show Direct Order numbers.
5. **Clear helper** to prepare for the next SQ.

## Testing & Tooling

- **Local parser regression:**

  ```bash
  python -m pdf_parser.check pdf-parser-server/api/parse.py docs/<sample>.pdf
  ```
- or run the inline harness in `tests/test_matching.js` for Apps Script logic.
- **Vercel verification:** `npm install -g vercel && vercel logs pdf-nine-psi` when diagnosing production parsing failures.
- **Apps Script logs:** `View > Executions` provides timestamps and detailed match logs.

## Maintenance Checklist

- **Parser updates:** After modifying `pdf-parser-server/api/parse.py`, run the regression harness on all PDFs in `docs/` to detect layout regressions. Push to `main` to trigger the Vercel redeploy.
- **Apps Script changes:** Re-run `coderabbit review --plain` to capture lint suggestions, then sync scripts in Google Sheets via `File > Manage Versions`.
- **Docs:** Update `docs/MATCHING_LOGIC.md` whenever normalization or fallback heuristics change.
- **Archon tracking:** Log each task’s lifecycle (todo → doing → review) per the Archon workflow memory.
## Dependencies

- Google Apps Script (connected to Discrepancy Helper and Refund Log sheets)
- Vercel account with project `pdf-nine-psi`
- Python 3.11+ and `pdfplumber` for local validation

## License

Internal TCGplayer project – Not for external distribution
