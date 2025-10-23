# Pull Discrep Refunds (Agent Playbook)

## Mission

Process confirmed-missing cards efficiently using the automated helper sheet and PDF parser. Only fall back to manual refund workflows when automation cannot resolve a row.

## Required Access

- [Discrepancy Helper Sheet](https://docs.google.com/spreadsheets/d/1hrKt4XvlxytyY2ZqYVXjCOAS97WzNWnxaHOzLc0kv_c/edit?gid=0#gid=0)
- [Discrepancy Log](https://docs.google.com/spreadsheets/d/1m0dSOA2VogToEpAo6Jj7FEEsfJbWi1W48xiyTHkBNyY/edit?gid=1984354615#gid=1984354615)
- [Inventory Refund Log](https://docs.google.com/spreadsheets/d/1raaUEsPoMl5dEZwilnHtBwdR0wOV2JRqYzdlVYMdohI/edit?gid=1331496674#gid=1331496674)
- [Direct Admin Panel](https://store.tcgplayer.com/admin/Direct) (for issuing refunds)

## First-Time Setup

- Open the Helper Sheet, authorize the Apps Script if prompted, and ensure the custom menu `🤖 Refund Tools` appears.
- Confirm you can access the Discrepancy Log and Refund Log with edit rights.
- Optional: clone the repo and run `pip install -r pdf-parser-server/requirements.txt` if you plan to debug the parser locally.

## Daily Runbook

1. **Claim an SQ**
   - In the Discrepancy Log, filter for unsolved rows (`Initials` blank, `Solve Date` blank, not red, not vault, `LocationID != "NONE"`).
   - In the Helper Sheet run `🤖 Refund Tools > 1️⃣ Claim Next SQ`. Your initials will populate and the sheet pulls the first eligible SQ automatically.

2. **Upload PDF**
   - Use `🤖 Refund Tools > 2️⃣ Upload SQ PDF` and select the PDF downloaded from the Discrepancy Log link (Print Sheets → PDF).
   - Watch the execution logs (`View > Executions`) for parsing status. Successful runs show `Found XX orders` and `Matched!` messages for each row.

3. **Resolve unmatched rows**
   - Any `✗ No match found` lines indicate cards the parser could not map. Steps:
     - Verify the collector number in the helper table matches the parser output. If the PDF contains a new layout, collect the raw text segment and notify engineering.
     - If automation still fails, manually search the PDF, record the Direct Order # / Buyer Name, and fill the helper row by hand (also log the reason in Archon).

4. **Send to Refund Log**
   - After every row has a Direct Order #, run `🤖 Refund Tools > 4️⃣ Send to Refund Log`.
   - Double-check the pasted rows at the bottom of the Refund Log before proceeding.

5. **Clear helper sheet**
   - Run `🤖 Refund Tools > 5️⃣ Clear Helper Sheet` to prep for the next SQ.

## Automation Internals (for debugging)

- Parser endpoint: `pdf-parser-server/api/parse.py` deployed to `https://pdf-nine-psi.vercel.app/api/parse`.
- `normalizeCollector()` handles alphanumeric collectors, splits like `DOOD-EN 085`, and strips leading `#`.
- `normalizeCondition()` maps verbose text (e.g., `Near Mint 1st Edition`, `Lightly Played Foil`) to canonical codes.
- Logs show fallback usage. A collector-based fallback is acceptable as long as the collector matches and either set or name aligns.

### When to escalate parser issues

- Repeated unmatched rows for the same pattern (new PDF layout).
- Parser returns zero cards for a PDF known to contain multiple orders.
- Condition strings still include game tokens after normalization (e.g., `Lightly Played Magic`).

Capture the raw PDF text block (use `pdfplumber` or the Apps Script log) and open a GitHub issue or Archon task referencing `pdf-parser-server/api/parse.py`.

## Manual Refund Flow

Use the automated data as the source of truth. When manual refunds are required, follow the steps below.

### Partial refunds

1. Open the order from the Refund Log (Column C hyperlink).
2. Click **Partial Refund** in the Direct Admin panel.
3. Enter the refund quantity for each card from the helper sheet.
4. Apply macros:

```text
Domestic refund (first card):
TCGplayer is fully refunding this card due to an unfortunate inventory issue. We have applied an additional $1.00 in store credit to your TCGplayer account so you can purchase it from another Seller on our site. We're sorry for any inconvenience this may cause you.

Duplicate refund (additional cards):
TCGplayer is fully refunding this card due to an unfortunate inventory issue. We're sorry for any inconvenience this may cause you.
```

5. Set reason category to **Product - Inventory Issue**.
6. Apply $1.00 store credit per order (domestic only). International orders follow the flow below.
7. Submit the refund, then record the refund amount in the Refund Log `Original Amount` column and add your initials.

### Full refunds (single-card orders)

- Use **Full Refund**, still add the macro, and apply store credit when appropriate.

### International orders

- Do **not** apply the $1.00 credit during the refund.
- Use the international macro and grant $5.99 store credit manually:

```text
International macro:
TCGplayer is fully refunding this card due to an unfortunate inventory issue. We have applied an additional $5.99 in store credit to your TCGplayer account so you can purchase it from another Seller on our site. We're sorry for any inconvenience this may cause you.

Store credit note:
Product not in Direct Inventory Order #XXXXXXXX.
```

- Add the credit through the customer account screen after the refund.

## Quality Checklist

- **Blue highlights** in the Refund Log indicate duplicates. Group them together and confirm both refunds were issued.
- **Yellow highlights** indicate international orders. Follow the international flow.
- Ignore same-day entries in the Refund Log until the next business day (the card may still arrive).
- After each batch, update Archon: mark the task from *doing* → *review* and document any manual interventions or parser anomalies.

## Escalation

- **Automation failure:** Share the SQ number, PDF, and helper log lines in the engineering channel. Reference the relevant functions (`normalizeCollector()` or parser pattern) and attach screenshots where possible.
- **Refund issues:** If the Direct Admin panel cannot complete a refund, capture error text and escalate to Billing Operations.
- **Customer communication:** CX-specific messaging changes should be coordinated with the CX lead; do not alter macros without approval.

Staying aligned with this playbook keeps the automation reliable and ensures new agents can step into the workflow with minimal ramp time.
