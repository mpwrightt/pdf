# TCGplayer Discrepancy Refund Automation

Automation system for processing refunds for confirmed missing cards in the TCGplayer Direct inventory workflow.

## Overview

This project automates the refund processing workflow that currently requires manual data entry, PDF searching, and order matching. The system connects the Discrepancy Log directly to the Refund Log via a TCGplayer internal API and Google Apps Script bot.

## Components

### 1. Google Apps Script Bot
- **File:** `AutoFillOrderInfo_Upload.gs`
- **Purpose:** Automates reading Discrepancy Log, calling the API, matching cards, and writing to Refund Log
- **Throughput:** ~6,000-8,000 cards per hour
- **Location:** Deployed in Google Sheets

### 2. PDF Parser Server (Legacy)
- **Directory:** `pdf-parser-server/`
- **Status:** Superseded by API approach
- **Note:** Originally built for parsing SQ detail PDFs, but internal API is preferred solution

## Documentation

- **[AUTOMATION_PLAN.md](AUTOMATION_PLAN.md)** - Requirements document for Engineering (API specifications)
- **[MATCHING_LOGIC.md](MATCHING_LOGIC.md)** - Card matching algorithm and logic
- **[AGENTS.MD](AGENTS.MD)** - Current manual process documentation

## Requirements

### From Engineering Team
Internal API endpoint to lookup orders by SQ number:

```
GET /api/internal/orders/by-sq/{sq_number}

Response:
{
  "sq_number": "251013-236rmb",
  "orders": [
    {
      "direct_order_number": "251012-2179",
      "buyer_name": "Buyer Name",
      "cards": [...]
    }
  ]
}
```

### Dependencies
- Google Apps Script (built-in to Google Sheets)
- TCGplayer internal API (pending)
- Access to Discrepancy Log and Refund Log spreadsheets

## How It Works

1. Bot reads Discrepancy Log for unsolved cards
2. For each SQ number, calls TCGplayer internal API
3. API returns all orders in that SQ (with buyer names and card details)
4. Bot matches cards from Discrepancy Log to orders and writes to Refund Log
5. Bot updates Discrepancy Log with solve date

## Testing

- **File:** `test_matching.js`
- Run matching logic tests to verify card matching accuracy

## Status

- ✅ Bot implementation ready
- ✅ Matching logic tested
- ⏳ Awaiting internal API from Engineering
- ⏳ Production deployment pending API availability

## License

Internal TCGplayer project - Not for external distribution
