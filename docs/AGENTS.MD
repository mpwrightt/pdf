# Pull Discrep Refunds (Confirmed Missing Cards)

## Overview
Process for refunding cards not found during the pulling process by Shipping Generalists or in the discrepancy solving process by Inventory Specialists.

## Required Access
- [Inventory Refund Log](https://docs.google.com/spreadsheets/d/1raaUEsPoMl5dEZwilnHtBwdR0wOV2JRqYzdlVYMdohI/edit?gid=1331496674#gid=1331496674)
- [Discrepancy Help Docs](https://docs.google.com/spreadsheets/d/1hrKt4XvlxytyY2ZqYVXjCOAS97WzNWnxaHOzLc0kv_c/edit?gid=0#gid=0)
- [Discrepancy Log](https://docs.google.com/spreadsheets/d/1m0dSOA2VogToEpAo6Jj7FEEsfJbWi1W48xiyTHkBNyY/edit?pli=1&gid=1984354615#gid=1984354615)
- [Admin Panel](https://store.tcgplayer.com/admin/Direct)

---

## First Time Setup

1. Open the [Helper Docs](https://docs.google.com/spreadsheets/d/1hrKt4XvlxytyY2ZqYVXjCOAS97WzNWnxaHOzLc0kv_c/edit?gid=0#gid=0)
2. Navigate to the "Paste Here" tab

**Note:** For CX Department assisting with Discrep/Refunds, everything is marked as a Missing Note. Take anything unsolved, initial it to claim it, and copy to the Helper Batch Docs.

---

## Add Data to Batch Discrepancy Notes Tool

### Steps

1. **Copy from Discrepancy Log**
   - Look for missing note solves
   - Copy from Column C (SQs) to Column J (Quantity)

2. **Paste to Batch Discrepancy**
   - Paste in Column J (SQ Number) using `Ctrl+Shift+V` (paste values only)
   - This will auto-fill needed columns

3. **Look up Buyer Info for Each Line**
   - Click the "SQ Link" for each line/SQ
   - Download PDF by clicking "Print Sheets"
   - Search for missing card(s) using `Ctrl+F`
     - Verify only 1 match exists (check Condition, Set, Printing type like Extended Art)
   - Copy Direct Order Number and Buyer Name from PDF to Batch Discrep Notes tool (use `Ctrl+Shift+V`)

**Important:** If two buyers have the same exact card, refund ALL buyers for CX Department purposes.

---

## Update the Refund Log

1. **Copy Refund Data**
   - Copy from 'H3' to last line of 'Q' (Direct Order # to QTY)

2. **Paste to Refund Log**
   - Find next open lines at bottom of [Refund Log](https://docs.google.com/spreadsheets/d/1raaUEsPoMl5dEZwilnHtBwdR0wOV2JRqYzdlVYMdohI/edit?gid=1331496674#gid=1331496674)
   - Paste values only (`Ctrl+Shift+V`) starting in Column 'C' (Order Number)

3. **Handle Highlighted Orders**
   - **Blue highlight** = Duplicate order
     - Use `Ctrl/Cmd+F` to locate other associated orders
     - Move them next to each other if possible
   - **Yellow highlight** = International order
     - Follow [International Refund procedure](#international-refunds)

4. **Assign Resolution**
   - Click dropdown menu and select the solve
   - Enter today's date in 'Solve Date' column
   - **Note:** For CX Department, everything is marked as "Missing Note"

---

## Setup for Refunds

1. Log into old Seller Portal Admin Panel (if not already logged in)
   - Needed for checking orders and issuing refunds

2. Open Refund Log spreadsheet
   - Check how many instances are older than current date
   - **Ignore entries from today's date** (cards may be found or incorrect cards marked)

---

## Solving Refunds

### Initial Steps

1. Go to first unsolved order in log
2. Type your initials under "Initials" column to claim a run
   - Solved orders have initials + monetary value in original amount column

**Important:** If yellow highlighted order is in your batch, follow [International Refund](#international-refunds) procedure.

### Partial Refunds

1. **Open the Order**
   - Hover over order hyperlink and click to open

2. **Find the Card**
   - Use `Ctrl/Cmd+F` to search for the card
   - Verify correct condition and set
   - Tip: Keep second Refund Log window open to avoid toggling

3. **Initiate Partial Refund**
   - Right-click "Partial Refund" button
   - Open in separate window

4. **Enter Refund Quantity**
   - Scroll to bottom and find the card
   - Enter number of cards in "Refund Quantity" box

5. **Add Refund Reason (First Card)**
   - **Macro:** "Domestic refunds"

   ```
   TCGplayer is fully refunding this card due to an unfortunate inventory issue. We have applied an additional $1.00 in store credit to your TCGplayer account so you can purchase it from another Seller on our site. We're sorry for any inconvenience this may cause you.
   ```

6. **Add Refund Reason (Additional Cards on Same Order)**
   - **Macro:** "Duplicate refund"

   ```
   TCGplayer is fully refunding this card due to an unfortunate inventory issue. We're sorry for any inconvenience this may cause you.
   ```

7. **Select Refund Reason Category**
   - From dropdown: "Product - Inventory Issue"
   - Used for ALL refunds

8. **Apply Store Credit**
   - Check "Apply $1.00 TCGplayer store credit" box
   - **Rules:**
     - Multiple cards from same order = store credit ONCE
     - Same customer, different orders in same SQ = store credit for EACH order
   - **International orders:** DO NOT apply $1.00 credit during refund (see [International Refunds](#international-refunds))

9. **Complete Refund**
   - Enter total "Refund Amount" into "Original Amount" column in Refund Log
   - Click "Give Refund" button (bottom left)
   - Click "Yes" on confirmation prompt
   - **Note:** System will NOT remind you about store credit - double-check!

### Full Refund (One Card Orders)

1. **Click "Full Refund" button** (top left of page)
2. Apply refunding reasons in text box
3. **Still check 'apply the 1-dollar store credit' box**
   - Customer receives card price + shipping refund

---

## International Refunds

**Key Differences:**
- DO NOT apply $1.00 store credit during refund itself
- Use "International Refund" macro instead of "Domestic Refund"
- Manually add $5.99 store credit separately

### Refund Reason Macro

```
TCGplayer is fully refunding this card due to an unfortunate inventory issue. We have applied an additional $5.99 in store credit to your TCGplayer account so you can purchase it from another Seller on our site. We're sorry for any inconvenance this may cause you.
```

### Manual Store Credit Steps

1. **Access Customer Account**
   - On order page, click button beside customer email

2. **Add Store Credit**
   - Find "Store Credit" box
   - Click "Add/Remove Store Credit" button (top right)

3. **Enter Credit Details**
   - Amount: `5.99`
   - Note: "International refund Order Number" macro

   ```
   Product not in Direct Inventory Order #XXXXXXXX.
   ```

4. **Save and Continue**
   - Hit "Save" button
   - Proceed with rest of refund as normal

---

## Key Notes

- **CX Department:** All issues marked as "Missing Note"
- **Duplicate Cards:** Refund all buyers
- **Store Credit:**
  - Domestic: $1.00 per order
  - International: $5.99 per order (manual process)
- **Same-day entries:** Ignored (cards may still be found)
- **Verification:** Always check card condition, set, and printing type

---

## Macros Quick Reference

### Domestic Refund (First Card)
```
TCGplayer is fully refunding this card due to an unfortunate inventory issue. We have applied an additional $1.00 in store credit to your TCGplayer account so you can purchase it from another Seller on our site. We're sorry for any inconvenience this may cause you.
```

### Duplicate Refund (Additional Cards)
```
TCGplayer is fully refunding this card due to an unfortunate inventory issue. We're sorry for any inconvenience this may cause you.
```

### International Refund
```
TCGplayer is fully refunding this card due to an unfortunate inventory issue. We have applied an additional $5.99 in store credit to your TCGplayer account so you can purchase it from another Seller on our site. We're sorry for any inconvenance this may cause you.
```

### International Order Note
```
Product not in Direct Inventory Order #XXXXXXXX.
```
