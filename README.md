# TCGplayer Discrepancy Refund Automation

Automated workflow for processing refunds for missing cards in TCGplayer Direct inventory.

## Overview

This system automates the refund processing workflow by:

1. Pulling unclaimed items from the Discrepancy Log
2. Parsing SQ detail PDFs to extract order information
3. Matching cards to orders
4. Sending completed refund data to the Refund Log

## Project Structure

```text
/
├── scripts/              # Google Apps Script files
│   ├── HelperDocAutomation.gs      # Main automation workflow
│   ├── AutoFillOrderInfo_Upload.gs  # PDF upload handler
│   └── DiscrepancyRefundAutomation.gs # Legacy script
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
**Main File:** `HelperDocAutomation.gs`

**Features:**
- Auto-pulls unclaimed SQ items from Discrepancy Log
- Filters by: no initials, no solve date, not red-flagged, not in vault, location not "NONE"
- Uploads and processes PDF via Vercel API
- Matches cards using name, set, and condition
- Sends completed items to Refund Log

### 2. PDF Parser API (pdf-parser-server/)

**Deployment:** <https://pdf-nine-psi.vercel.app/api/parse>

**Technology:** Python + pdfplumber on Vercel serverless

**Purpose:** Extracts order numbers, buyer names, and card details from SQ PDFs

## Documentation

- **[docs/AUTOMATION_PLAN.md](docs/AUTOMATION_PLAN.md)** - Original API requirements
- **[docs/MATCHING_LOGIC.md](docs/MATCHING_LOGIC.md)** - Card matching algorithm
- **[docs/AGENTS.MD](docs/AGENTS.MD)** - Manual process documentation

## Workflow

1. **Pull Unclaimed Items** - Auto-select first unclaimed SQ from Discrepancy Log
2. **Upload PDF** - Upload SQ detail PDF to extract order information
3. **Match Cards** - Automatically match cards to orders
4. **Send to Refund Log** - Push completed refund data
5. **Clear & Repeat** - Clear helper sheet and process next SQ

## Filter Criteria

Items are pulled if they meet ALL criteria:

- ✅ No initials (unclaimed)
- ✅ No solve date (unsolved)
- ✅ NOT red background (doesn't need attention)
- ✅ No manual intervention flag (not in vault)
- ✅ LocationID != "NONE"

## Dependencies

- Google Apps Script (built-in to Google Sheets)
- Vercel account (for PDF parser deployment)
- Access to Discrepancy Log and Refund Log spreadsheets

## Status

- ✅ Automated workflow implemented
- ✅ PDF parser deployed on Vercel
- ✅ Card matching logic tested
- ✅ Production ready

## License

Internal TCGplayer project - Not for external distribution
