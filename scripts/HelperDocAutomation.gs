/**
 * Helper Doc Automation for Discrepancy Refunds
 * 
 * Workflow:
 * 1. Pull unclaimed SQ items from Discrepancy Log (no initials)
 * 2. Paste into this Helper Doc
 * 3. User uploads PDF for the SQ
 * 4. Process PDF and send results to Refund Log
 */

// Configuration
const CONFIG = {
  // ⚙️ IMPORTANT: Change BOT_ID for each cloned helper doc (e.g., 'BOT1', 'BOT2', 'BOT3')
  BOT_ID: 'BOT1',

  VERCEL_API_URL: 'https://pdf-nine-psi.vercel.app/api/parse',
  VERCEL_QUEUE_URL: 'https://pdf-nine-psi.vercel.app/api/queue',

  // Discrepancy Log
  DISCREP_LOG_ID: '1m0dSOA2VogToEpAo6Jj7FEEsfJbWi1W48xiyTHkBNyY',

  // Refund Log
  REFUND_LOG_ID: '1raaUEsPoMl5dEZwilnHtBwdR0wOV2JRqYzdlVYMdohI',

  // Bot Queue Sheets (for coordinating concurrent bots)
  DISCREP_QUEUE_SHEET_NAME: 'BOTS',  // In Discrepancy Log - for SQ claiming coordination
  REFUND_QUEUE_SHEET_NAME: 'BOTS',   // In Refund Log - for write coordination
  
  // Discrepancy Log Columns (based on actual sheet layout)
  DISCREP_COLS: {
    SQ_NUMBER: 2,      // Column C
    GAME: 3,           // Column D
    CARD_NAME: 4,      // Column E
    COLLECTOR_NUM: 5,  // Column F (Number)
    RARITY: 6,         // Column G
    SET_NAME: 7,       // Column H (Set)
    CONDITION: 8,      // Column I
    QTY: 9,            // Column J
    LOCATION_ID: 10,   // Column K (LocationID - skip if "NONE")
    INITIALS: 14,      // Column O (Inv. Initials - for claiming)
    RESOLUTION_TYPE: 15, // Column P (Resolution Type - "Missing Note")
    SOLVE_DATE: 17,    // Column R (Solve Date)
    MANUAL_INTERVENTION: 18 // Column S (if has value, skip - needs manual intervention)
  },
  
  // Helper Doc Columns (this sheet - matches "Paste Here" tab)
  HELPER_COLS: {
    ORDER_NUMBER: 7,   // Column H (Direct Order #) - HIDDEN, filled by PDF
    BUYER_NAME: 8,     // Column I (Buyer Name) - HIDDEN, filled by PDF
    SQ_NUMBER: 9,      // Column J
    GAME: 10,          // Column K
    CARD_NAME: 11,     // Column L
    COLLECTOR_NUM: 12, // Column M (Card #)
    RARITY: 13,        // Column N
    SET_NAME: 14,      // Column O
    CONDITION: 15,     // Column P
    QTY: 16            // Column Q
  },
  
  REFUND_COLS: {
    ORDER_NUMBER: 2,   // Column C
    BUYER_NAME: 3,     // Column D
    SQ_NUMBER: 4,      // Column E
    GAME: 5,           // Column F
    CARD_NAME: 6,      // Column G (Card Name)
    CARD_NUM: 7,       // Column H (Card #)
    RARITY: 8,         // Column I
    SET_NAME: 9,       // Column J
    CONDITION: 10,     // Column K
    QUANTITY: 11,      // Column L
  },
  COUNTER_KEYS: {
    SQ: 'helperdoc_total_sq_count',
    ROWS: 'helperdoc_total_row_count'
  }
};

/** Normalize collector number to comparable string (handle numbers and '123/456') */
function normalizeCollector(num) {
  if (num === null || num === undefined) return '';
  let s = String(num).trim().toUpperCase().replace(/\s+/g, ' ');
  // Drop leading '#'
  if (s.startsWith('#')) s = s.slice(1);
  if (!s) return '';
  // Pure numeric -> drop leading zeros
  if (/^\d+$/.test(s)) {
    return String(parseInt(s, 10));
  }
  // Fractional numeric like 0307/123 -> normalize each segment
  if (/^\d+\/\d+$/.test(s)) {
    const [a, b] = s.split('/');
    return `${parseInt(a, 10)}/${parseInt(b, 10)}`;
  }
  // YGO-style codes: e.g., DOOD-EN 085 vs DOOD-EN 85 -> unify by removing space and zero-padding to 3
  // Only apply when a hyphenated alpha-numeric prefix exists
  const ygo = s.match(/^([A-Z0-9]+-[A-Z0-9]+)\s*(\d+)$/);
  if (ygo) {
    const prefix = ygo[1];
    const digits = ygo[2].padStart(3, '0');
    return `${prefix}${digits}`;
  }
  return s; // alphanumerics like SWSH286 remain uppercased
}

/**
 * Queue Management Functions (Vercel API)
 * Uses Vercel serverless API for coordination across all Helper Docs.
 * Works for multi-user scenarios - no Google auth required.
 */

/**
 * Try to reserve an SQ using Vercel Queue API
 */
function tryReserveSQ(sqNumber) {
  const payload = {
    action: 'tryClaimSQ',
    botId: CONFIG.BOT_ID,
    sqNumber: sqNumber
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    Logger.log(`[${CONFIG.BOT_ID}] Attempting to claim SQ ${sqNumber} via Vercel...`);
    const response = UrlFetchApp.fetch(CONFIG.VERCEL_QUEUE_URL, options);
    const result = JSON.parse(response.getContentText());

    if (result.success) {
      Logger.log(`[${CONFIG.BOT_ID}] ✓ Reserved SQ ${sqNumber} via Vercel queue`);

      // Also write to BOTS sheet for visibility
      try {
        const discrepLog = SpreadsheetApp.openById(CONFIG.DISCREP_LOG_ID);
        const queueSheet = discrepLog.getSheetByName(CONFIG.DISCREP_QUEUE_SHEET_NAME);
        if (queueSheet) {
          const nextRow = queueSheet.getLastRow() + 1;
          queueSheet.getRange(nextRow, 1, 1, 4).setValues([[
            CONFIG.BOT_ID,
            sqNumber,
            'CLAIMING',
            new Date()
          ]]);
        }
      } catch (e) {
        Logger.log(`[${CONFIG.BOT_ID}] Warning: Could not write to BOTS sheet: ${e}`);
      }

      return true;
    } else {
      Logger.log(`[${CONFIG.BOT_ID}] ⚠️ Could not claim SQ ${sqNumber}: ${result.message}`);
      return false;
    }
  } catch (e) {
    Logger.log(`[${CONFIG.BOT_ID}] ERROR calling Vercel queue: ${e}`);
    return false;
  }
}

/**
 * Release an SQ reservation
 */
function releaseSQ(sqNumber) {
  const payload = {
    action: 'releaseSQ',
    botId: CONFIG.BOT_ID,
    sqNumber: sqNumber
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(CONFIG.VERCEL_QUEUE_URL, options);
    const result = JSON.parse(response.getContentText());

    if (result.success) {
      Logger.log(`[${CONFIG.BOT_ID}] ✓ Released SQ ${sqNumber} from Vercel queue`);

      // Also update BOTS sheet for visibility
      try {
        const discrepLog = SpreadsheetApp.openById(CONFIG.DISCREP_LOG_ID);
        const queueSheet = discrepLog.getSheetByName(CONFIG.DISCREP_QUEUE_SHEET_NAME);
        if (queueSheet) {
          const data = queueSheet.getDataRange().getValues();
          for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (row[0] === CONFIG.BOT_ID && row[1] === sqNumber) {
              queueSheet.getRange(i + 1, 3).setValue('COMPLETED');
              break;
            }
          }
        }
      } catch (e) {
        Logger.log(`[${CONFIG.BOT_ID}] Warning: Could not update BOTS sheet: ${e}`);
      }

      return true;
    } else {
      Logger.log(`[${CONFIG.BOT_ID}] ⚠️ Could not release SQ ${sqNumber}: ${result.message}`);
      return false;
    }
  } catch (e) {
    Logger.log(`[${CONFIG.BOT_ID}] Warning: Could not release SQ ${sqNumber}: ${e}`);
    return false;
  }
}

/**
 * Reserve rows in Refund Log
 */
function tryReserveRefundLogWrite(sqNumber, rowCount) {
  try {
    // Get current state from Refund Log
    const refundLog = SpreadsheetApp.openById(CONFIG.REFUND_LOG_ID);
    const refundSheet = refundLog.getSheetByName('Refund Log');
    const queueSheet = refundLog.getSheetByName(CONFIG.REFUND_QUEUE_SHEET_NAME);

    if (!queueSheet) {
      throw new Error(`Queue sheet "${CONFIG.REFUND_QUEUE_SHEET_NAME}" not found in Refund Log`);
    }

    // Get current last row from actual data sheet
    const currentLastRow = refundSheet.getLastRow();
    Logger.log(`[${CONFIG.BOT_ID}] Current Refund Log last row: ${currentLastRow}`);

    // Call Vercel to reserve rows
    const payload = {
      action: 'reserveRefundLogWrite',
      botId: CONFIG.BOT_ID,
      sqNumber: sqNumber,
      rowCount: rowCount,
      currentLastRow: currentLastRow
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    Logger.log(`[${CONFIG.BOT_ID}] Reserving ${rowCount} Refund Log rows via Vercel...`);
    const response = UrlFetchApp.fetch(CONFIG.VERCEL_QUEUE_URL, options);
    const result = JSON.parse(response.getContentText());

    if (result.success) {
      const assignedRow = result.startRow;
      Logger.log(`[${CONFIG.BOT_ID}] ✓ Reserved Refund Log rows ${assignedRow}-${assignedRow + rowCount - 1}`);

      // Write reservation to BOTS sheet (source of truth)
      const queueNextRow = queueSheet.getLastRow() + 1;
      queueSheet.getRange(queueNextRow, 1, 1, 6).setValues([[
        CONFIG.BOT_ID,
        sqNumber,
        assignedRow,
        rowCount,
        'WRITING',
        new Date()
      ]]);
      SpreadsheetApp.flush();

      Logger.log(`[${CONFIG.BOT_ID}] Recorded reservation in BOTS sheet at row ${queueNextRow}`);
      return assignedRow;
    } else {
      Logger.log(`[${CONFIG.BOT_ID}] ⚠️ Could not reserve Refund Log rows: ${result.message}`);
      return null;
    }
  } catch (e) {
    Logger.log(`[${CONFIG.BOT_ID}] ERROR: Failed to reserve Refund Log rows: ${e}`);
    return null;
  }
}

/**
 * Release Refund Log reservation (mark as COMPLETED)
 */
function releaseRefundLogWrite(sqNumber) {
  const payload = {
    action: 'releaseRefundLogWrite',
    botId: CONFIG.BOT_ID,
    sqNumber: sqNumber
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(CONFIG.VERCEL_QUEUE_URL, options);
    const result = JSON.parse(response.getContentText());

    if (result.success) {
      Logger.log(`[${CONFIG.BOT_ID}] ✓ Released Refund Log reservation`);

      // Mark as COMPLETED in BOTS sheet (don't delete - helps with row calculation)
      try {
        const refundLog = SpreadsheetApp.openById(CONFIG.REFUND_LOG_ID);
        const queueSheet = refundLog.getSheetByName(CONFIG.REFUND_QUEUE_SHEET_NAME);
        if (queueSheet) {
          const data = queueSheet.getDataRange().getValues();
          for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (row[0] === CONFIG.BOT_ID && row[1] === sqNumber && row[4] === 'WRITING') {
              queueSheet.getRange(i + 1, 5).setValue('COMPLETED');
              SpreadsheetApp.flush();
              Logger.log(`[${CONFIG.BOT_ID}] Marked reservation as COMPLETED in BOTS sheet`);
              break;
            }
          }
        }
      } catch (e) {
        Logger.log(`[${CONFIG.BOT_ID}] Warning: Could not update Refund BOTS sheet: ${e}`);
      }

      return true;
    } else {
      Logger.log(`[${CONFIG.BOT_ID}] ⚠️ Could not release Refund Log reservation: ${result.message}`);
      return false;
    }
  } catch (e) {
    Logger.log(`[${CONFIG.BOT_ID}] Warning: Could not release Refund Log reservation: ${e}`);
    return false;
  }
}

/**
 * Step 1: Pull unclaimed items from Discrepancy Log
 */
function pullUnclaimedItems() {
  const ui = SpreadsheetApp.getUi();

  try {
    // Get Discrepancy Log
    const discrepLog = SpreadsheetApp.openById(CONFIG.DISCREP_LOG_ID);
    const discrepSheet = discrepLog.getSheetByName('SQ Discrepancy Log');
    
    if (!discrepSheet) {
      Logger.log('ERROR: Could not find sheet "SQ Discrepancy Log"');
      ui.alert('Error', 'Could not find sheet "SQ Discrepancy Log" in Discrepancy Log spreadsheet.', ui.ButtonSet.OK);
      return;
    }
    
    Logger.log('Getting data range...');
    const dataRange = discrepSheet.getDataRange();
    Logger.log(`Data range: ${dataRange.getA1Notation()}`);
    
    Logger.log('Getting values...');
    const data = dataRange.getValues();
    Logger.log(`Total rows in sheet: ${data.length}`);
    Logger.log(`Total columns: ${data[0] ? data[0].length : 0}`);
    Logger.log(`Checking columns - Initials: ${CONFIG.DISCREP_COLS.INITIALS}, SolveDate: ${CONFIG.DISCREP_COLS.SOLVE_DATE}, Manual: ${CONFIG.DISCREP_COLS.MANUAL_INTERVENTION}`);
    // Detect Game column index from header if available (fallback to CONFIG)
    const header = data[0] || [];
    const headerGameIdx = header.findIndex(h => (h || '').toString().trim().toLowerCase() === 'game');
    const GAME_IDX = headerGameIdx >= 0 ? headerGameIdx : CONFIG.DISCREP_COLS.GAME;
    Logger.log(`Detected Game column index: ${GAME_IDX} (header: ${header[GAME_IDX]})`);
    
    // Find unclaimed items: no initials, no solve date, not in vault
    const unclaimedItems = [];
    let debugCount = 0;

    Logger.log(`Starting to scan ${data.length - 1} data rows...`);
    Logger.log(`Filter criteria: No initials + No solve date + Not in vault`);

    let skipCounts = {
      hasInitials: 0,
      hasSolveDate: 0,
      hasManual: 0,
      hasNoneLocation: 0
    };
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const initials = row[CONFIG.DISCREP_COLS.INITIALS];
      const solveDate = row[CONFIG.DISCREP_COLS.SOLVE_DATE];
      const manualIntervention = row[CONFIG.DISCREP_COLS.MANUAL_INTERVENTION];
      const locationId = row[CONFIG.DISCREP_COLS.LOCATION_ID];
      const sqNumber = row[CONFIG.DISCREP_COLS.SQ_NUMBER];

      // Log first 5 rows for debugging
      if (debugCount < 5) {
        Logger.log(`Row ${i}: SQ=${sqNumber}, Initials='${initials}', SolveDate='${solveDate}', Manual='${manualIntervention}'`);
        debugCount++;
      }

      // Filter logic: no initials, no solve date, not in vault, not "NONE" location
      if (initials) {
        skipCounts.hasInitials++;
      } else if (solveDate) {
        skipCounts.hasSolveDate++;
      } else if (manualIntervention) {
        skipCounts.hasManual++;
      } else if (locationId && locationId.toString().toUpperCase() === 'NONE') {
        skipCounts.hasNoneLocation++;
      } else {
        // All criteria met!
        Logger.log(`✓ Found unclaimed item at row ${i}: ${sqNumber}`);
        unclaimedItems.push({
          rowIndex: i + 1, // 1-based row index in Discrepancy Log
          sqNumber: row[CONFIG.DISCREP_COLS.SQ_NUMBER],
          game: row[GAME_IDX],
          cardName: row[CONFIG.DISCREP_COLS.CARD_NAME],
          collectorNum: row[CONFIG.DISCREP_COLS.COLLECTOR_NUM],
          rarity: row[CONFIG.DISCREP_COLS.RARITY],
          setName: row[CONFIG.DISCREP_COLS.SET_NAME],
          condition: row[CONFIG.DISCREP_COLS.CONDITION],
          qty: row[CONFIG.DISCREP_COLS.QTY]
        });
      }
    }
    
    Logger.log(`Total unclaimed items found: ${unclaimedItems.length}`);
    Logger.log(`\nSkip breakdown:`);
    Logger.log(`  - Has initials (claimed): ${skipCounts.hasInitials}`);
    Logger.log(`  - Has solve date (already solved): ${skipCounts.hasSolveDate}`);
    Logger.log(`  - Has manual intervention flag (in vault): ${skipCounts.hasManual}`);
    Logger.log(`  - Location is "NONE": ${skipCounts.hasNoneLocation}`);

    if (unclaimedItems.length === 0) {
      Logger.log('\nNo items matched ALL criteria. Check skip breakdown above.');
      ui.alert(
        'No Unclaimed Items',
        `No unclaimed items found.\n\nSkipped:\n` +
        `- Has initials: ${skipCounts.hasInitials}\n` +
        `- Has solve date: ${skipCounts.hasSolveDate}\n` +
        `- In vault: ${skipCounts.hasManual}\n` +
        `- Location "NONE": ${skipCounts.hasNoneLocation}\n\n` +
        `Check Extensions > Apps Script > Executions for details.`,
        ui.ButtonSet.OK
      );
      return;
    }
    
    // Find first SQ that is FULLY unclaimed (all rows for that SQ have no initials)
    // Strategy: Work sequentially through unclaimed SQs
    const uniqueUnclaimedSQs = [...new Set(unclaimedItems.map(item => item.sqNumber))];

    let selectedSQ = null;
    let itemsForSQ = [];

    Logger.log(`Checking ${uniqueUnclaimedSQs.length} unique unclaimed SQ(s) for full availability...`);

    // 🔁 RETRY LOOP: Keep trying SQs until we successfully claim one
    let claimSuccessful = false;

    for (const sqNumber of uniqueUnclaimedSQs) {
      // Quick check: is this SQ partially claimed?
      // We scan ONLY rows for this specific SQ and break early if we find initials
      let hasClaimedRows = false;

      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const rowSQ = row[CONFIG.DISCREP_COLS.SQ_NUMBER];

        // Skip if not the SQ we're checking
        if (rowSQ !== sqNumber) continue;

        const initials = row[CONFIG.DISCREP_COLS.INITIALS];
        const locationId = row[CONFIG.DISCREP_COLS.LOCATION_ID];
        const solveDate = row[CONFIG.DISCREP_COLS.SOLVE_DATE];
        const manualIntervention = row[CONFIG.DISCREP_COLS.MANUAL_INTERVENTION];

        // Skip rows with NONE location (they don't count)
        if (locationId && locationId.toString().toUpperCase() === 'NONE') continue;

        // Skip rows already filtered (solve date or manual intervention)
        if (solveDate || manualIntervention) continue;

        // Check if this row is claimed
        if (initials) {
          hasClaimedRows = true;
          Logger.log(`⚠️ Skipping partially claimed SQ: ${sqNumber} (found initials='${initials}' at row ${i + 1})`);
          break; // Stop scanning this SQ
        }
      }

      if (hasClaimedRows) {
        // Skip this SQ and try the next one
        continue;
      }

      // This SQ is fully unclaimed - try to reserve it in the queue!
      selectedSQ = sqNumber;
      itemsForSQ = unclaimedItems.filter(item => item.sqNumber === selectedSQ);

      Logger.log(`✓ Found fully unclaimed SQ: ${selectedSQ} (${itemsForSQ.length} rows) - attempting queue reservation...`);

      // 🔒 QUEUE RESERVATION: Try to reserve this SQ in the queue
      if (!tryReserveSQ(selectedSQ)) {
        Logger.log(`⚠️ Failed to reserve SQ ${selectedSQ} in queue - trying next SQ...`);
        continue; // Another bot reserved it first - try next SQ
      }

      Logger.log(`✓ Convex reserved SQ ${selectedSQ} - claiming rows in Discrepancy Log...`);

      // 🔒 ATOMIC CLAIM: Convex already reserved this SQ for us, just write to sheet
      const now = new Date();

      try {
        // Claim all rows (no verification needed - Convex guarantees we won)
        Logger.log(`Claiming ${itemsForSQ.length} rows...`);

        let claimedCount = 0;
        for (const item of itemsForSQ) {
          discrepSheet.getRange(item.rowIndex, CONFIG.DISCREP_COLS.INITIALS + 1).setValue(CONFIG.BOT_ID);
          discrepSheet.getRange(item.rowIndex, CONFIG.DISCREP_COLS.RESOLUTION_TYPE + 1).setValue('Missing Note');
          discrepSheet.getRange(item.rowIndex, CONFIG.DISCREP_COLS.SOLVE_DATE + 1).setValue(now);
          claimedCount++;

          if (claimedCount % 10 === 0) {
            Logger.log(`  Claimed ${claimedCount}/${itemsForSQ.length} rows...`);
          }
        }

        SpreadsheetApp.flush(); // Ensure writes are committed

        Logger.log(`✓ Claimed ${itemsForSQ.length} row(s) for SQ ${selectedSQ}`);

        // Success! Convex guaranteed this was ours
        claimSuccessful = true;
        Logger.log(`🎉 Successfully claimed SQ ${selectedSQ} with ${itemsForSQ.length} rows!`);

        // Release queue reservation (we successfully claimed it)
        releaseSQ(selectedSQ);

        break; // Exit the loop - we got our SQ!

      } catch (e) {
        Logger.log(`ERROR: Failed to claim SQ ${selectedSQ}: ${e}`);
        // Release queue reservation before trying next SQ
        releaseSQ(selectedSQ);
        // Try next SQ
        selectedSQ = null;
        itemsForSQ = [];
        continue;
      }
    }

    // Check if we successfully claimed an SQ
    if (!claimSuccessful || !selectedSQ || itemsForSQ.length === 0) {
      ui.alert(
        'No Available SQs',
        'All SQs were either partially claimed or claimed by other agents during the attempt.\n\nPlease try running again.',
        ui.ButtonSet.OK
      );
      return;
    }
    
    // Write to current sheet (Helper Doc)
    const currentSheet = SpreadsheetApp.getActiveSheet();
    
    // Clear existing data (keep header rows 1-2)
    const lastRow = currentSheet.getLastRow();
    if (lastRow > 2) {
      currentSheet.getRange(3, 1, lastRow - 2, currentSheet.getLastColumn()).clearContent();
    }
    
    // Prepare rows - only columns J-Q (columns H-I stay empty for PDF data)
    const rowsToWrite = itemsForSQ.map(item => [
      item.sqNumber,     // Column J - SQ Number
      (item.game || 'Magic'), // Column K - Game
      item.cardName,     // Column L - Card Name
      item.collectorNum, // Column M - Card #
      item.rarity,       // Column N - Rarity
      item.setName,      // Column O - Set Name
      item.condition,    // Column P - Condition
      item.qty           // Column Q - Quantity
    ]);
    
    // Write to sheet starting at row 3, column J (10th column)
    currentSheet.getRange(3, 10, rowsToWrite.length, rowsToWrite[0].length).setValues(rowsToWrite);

    // Toast notification instead of modal
    SpreadsheetApp.getActiveSpreadsheet().toast(
      `Pulled ${itemsForSQ.length} items for SQ: ${selectedSQ}. Auto-opening PDF link in 5 seconds...`,
      'Items Loaded',
      8
    );

    // 🔗 AUTO-OPEN PDF LINK: Wait 5 seconds for formulas to load, then open the PDF link
    Logger.log('Waiting 5 seconds for PDF link formula to load...');
    Utilities.sleep(5000);

    // Get the PDF link from cell G3 (extract URL from rich text hyperlink)
    const pdfLinkCell = currentSheet.getRange(3, 7); // Column G (7th column), Row 3
    let pdfLink = null;

    // Method 1: Try to get URL from rich text value
    try {
      const richTextValue = pdfLinkCell.getRichTextValue();
      if (richTextValue) {
        const url = richTextValue.getLinkUrl();
        if (url) {
          pdfLink = url;
          Logger.log(`Found PDF link from rich text: ${pdfLink}`);
        }
      }
    } catch (e) {
      Logger.log(`Could not get rich text URL: ${e}`);
    }

    // Method 2: Fallback - check if cell value is a direct URL
    if (!pdfLink) {
      const cellValue = pdfLinkCell.getValue();
      if (cellValue && typeof cellValue === 'string' && cellValue.startsWith('http')) {
        pdfLink = cellValue;
        Logger.log(`Found PDF link from cell value: ${pdfLink}`);
      }
    }

    if (pdfLink && pdfLink.startsWith('http')) {
      Logger.log(`Opening PDF link: ${pdfLink}`);
      const html = HtmlService.createHtmlOutput(
        `<script>window.open('${pdfLink}', '_blank'); google.script.host.close();</script>`
      ).setWidth(100).setHeight(50);
      SpreadsheetApp.getUi().showModalDialog(html, 'Opening PDF...');
    } else {
      Logger.log(`No valid PDF link found in G3. Cell value: ${pdfLinkCell.getValue()}`);
    }

  } catch (error) {
    Logger.log('Error in pullUnclaimedItems: ' + error.toString());
    ui.alert('Error', 'Failed to pull items: ' + error.message, ui.ButtonSet.OK);
  }
}

/**
 * Step 2: Show PDF upload dialog
 */
function showUploadDialog() {
  const html = HtmlService.createHtmlOutput(`
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; }
      .upload-area { border: 2px dashed #ccc; padding: 40px; text-align: center; margin: 20px 0; }
      .upload-area:hover { border-color: #4285f4; background: #f0f8ff; }
      button { background: #4285f4; color: white; border: none; padding: 12px 24px; font-size: 16px; cursor: pointer; margin: 10px; }
      button:hover { background: #357ae8; }
      #status { margin-top: 20px; padding: 10px; display: none; }
      .success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
      .error { background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; }
    </style>
    
    <h2>📤 Upload SQ Details PDF</h2>
    <div class="upload-area" onclick="document.getElementById('fileInput').click()">
      <p>Click to select PDF file</p>
      <input type="file" id="fileInput" accept=".pdf" style="display:none" onchange="uploadFile()">
    </div>
    
    <div id="status"></div>
    
    <script>
      function uploadFile() {
        const fileInput = document.getElementById('fileInput');
        const file = fileInput.files[0];
        
        if (!file) return;
        
        if (!file.name.toLowerCase().endsWith('.pdf')) {
          showStatus('Please select a PDF file', 'error');
          return;
        }
        
        showStatus('Uploading and processing PDF...', 'success');
        
        const reader = new FileReader();
        reader.onload = function(e) {
          const base64Data = e.target.result.split(',')[1];
          
          google.script.run
            .withSuccessHandler(onSuccess)
            .withFailureHandler(onError)
            .processPDFUpload(base64Data, file.name);
        };
        reader.readAsDataURL(file);
      }
      
      function onSuccess(result) {
        // Close modal immediately - processing is complete
        google.script.host.close();
      }

      function onError(error) {
        showStatus('Error: ' + error.message, 'error');
      }
      
      function showStatus(message, type) {
        const status = document.getElementById('status');
        status.textContent = message;
        status.className = type;
        status.style.display = 'block';
      }
    </script>
  `)
    .setWidth(500)
    .setHeight(300);
  
  SpreadsheetApp.getUi().showModalDialog(html, 'Upload PDF');
}

/**
 * Process uploaded PDF
 */
function processPDFUpload(base64Data, fileName) {
  try {
    Logger.log(`Processing PDF upload: ${fileName}`);
    Logger.log(`PDF size: ${base64Data.length} bytes (base64)`);
    
    // Convert base64 to blob
    const data = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(data, 'application/pdf', fileName);
    Logger.log(`Blob created: ${blob.getBytes().length} bytes`);
    
    // Call Vercel API
    const parsedOrders = callVercelAPI(blob);
    
    if (!parsedOrders || parsedOrders.length === 0) {
      throw new Error('No orders found in PDF');
    }
    
    // Match cards and fill in Order Number and Buyer Name
    fillOrderInfo(parsedOrders);

    // Check if all rows have order numbers and buyer names
    const sheet = SpreadsheetApp.getActiveSheet();
    const dataRange = sheet.getDataRange();
    const sheetData = dataRange.getValues();

    let missingCount = 0;
    let totalRows = 0;
    const missingRows = [];

    // Check rows starting from row 3 (data rows)
    for (let i = 2; i < sheetData.length; i++) {
      const row = sheetData[i];
      const orderNumber = row[CONFIG.HELPER_COLS.ORDER_NUMBER];
      const buyerName = row[CONFIG.HELPER_COLS.BUYER_NAME];
      const cardName = row[CONFIG.HELPER_COLS.CARD_NAME];

      // Skip empty rows
      if (!cardName) continue;

      totalRows++;

      if (!orderNumber || !buyerName) {
        missingCount++;
        missingRows.push(i + 1); // 1-based row number
        Logger.log(`⚠️ Missing data at row ${i + 1}: Order=${orderNumber}, Buyer=${buyerName}`);
      }
    }

    Logger.log(`Processed ${totalRows} rows: ${totalRows - missingCount} complete, ${missingCount} missing data`);

    if (missingCount === 0 && totalRows > 0) {
      // All rows complete - auto-send to Refund Log!
      Logger.log('✓ All rows complete - auto-sending to Refund Log...');

      try {
        // Call sendToRefundLog directly
        sendToRefundLog();

        // Auto-clear helper sheet after successful send
        Logger.log('Auto-clearing helper sheet...');
        clearHelperSheet();

        return {
          success: true,
          orderCount: parsedOrders.length,
          fileName: fileName,
          autoSent: true,
          message: `All ${totalRows} items matched! Automatically sent to Refund Log and cleared.`
        };
      } catch (sendError) {
        Logger.log(`ERROR: Failed to auto-send to Refund Log: ${sendError}`);
        return {
          success: true,
          orderCount: parsedOrders.length,
          fileName: fileName,
          autoSent: false,
          message: `PDF processed successfully, but auto-send failed: ${sendError.message}. Please use "Send to Refund Log" manually.`
        };
      }
    } else {
      // Some rows missing data - require manual intervention
      return {
        success: true,
        orderCount: parsedOrders.length,
        fileName: fileName,
        autoSent: false,
        missingCount: missingCount,
        totalRows: totalRows,
        message: `${missingCount} of ${totalRows} items need manual matching. Please review rows: ${missingRows.join(', ')}`
      };
    }

  } catch (error) {
    Logger.log('Error processing PDF: ' + error.toString());
    throw new Error('Failed to process PDF: ' + error.message);
  }
}

/**
 * Call Vercel API to parse PDF
 */
function callVercelAPI(blob) {
  const base64PDF = Utilities.base64Encode(blob.getBytes());
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ pdf: base64PDF }),
    muteHttpExceptions: true,
    followRedirects: true,
    validateHttpsCertificates: true
  };

  const maxAttempts = 3;
  let lastErrText = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      Logger.log(`Calling Vercel API (attempt ${attempt}/${maxAttempts}): ${CONFIG.VERCEL_API_URL}`);
      const response = UrlFetchApp.fetch(CONFIG.VERCEL_API_URL, options);
      const statusCode = response.getResponseCode();
      const responseText = response.getContentText();
      Logger.log(`API Response Status: ${statusCode}`);
      Logger.log(`API Response (first 500 chars): ${responseText.substring(0, 500)}`);

      if (statusCode !== 200) {
        lastErrText = `HTTP ${statusCode}: ${responseText.substring(0, 200)}`;
        if (attempt < maxAttempts) {
          Utilities.sleep(500 * Math.pow(2, attempt - 1));
          continue;
        }
        throw new Error(`API returned status ${statusCode}: ${responseText.substring(0, 200)}`);
      }

      const responseData = JSON.parse(responseText);
      if (!responseData.success) {
        lastErrText = responseData.error || 'API request failed';
        if (attempt < maxAttempts) {
          Utilities.sleep(500 * Math.pow(2, attempt - 1));
          continue;
        }
        throw new Error(lastErrText);
      }

      Logger.log(`Found ${responseData.orders.length} orders in PDF`);
      if (responseData.orders.length > 0) {
        Logger.log(`First order: ${responseData.orders[0].orderNumber}, ${responseData.orders[0].cards.length} cards`);
      }
      return responseData.orders;
    } catch (err) {
      lastErrText = String(err && err.message ? err.message : err);
      // transient network/model issues like 'unavailable: unexpected EOF'
      if (attempt < maxAttempts && /unavailable|eof|timeout|timed out|rate limit/i.test(lastErrText)) {
        Logger.log(`Transient error calling API (attempt ${attempt}): ${lastErrText}. Retrying...`);
        Utilities.sleep(500 * Math.pow(2, attempt - 1));
        continue;
      }
      if (attempt >= maxAttempts) {
        Logger.log('Error calling Vercel API (final): ' + lastErrText);
        throw new Error('Failed to parse PDF via API: ' + lastErrText);
      }
    }
  }

  throw new Error('Failed to parse PDF via API: ' + lastErrText);
}

/**
 * Fill in Order Number and Buyer Name from parsed orders
 */
function fillOrderInfo(parsedOrders) {
  const sheet = SpreadsheetApp.getActiveSheet();
  const dataRange = sheet.getDataRange();
  const data = dataRange.getValues();
  
  Logger.log(`fillOrderInfo: Processing ${parsedOrders.length} parsed orders`);
  Logger.log(`Total data rows: ${data.length}`);
  
  let matchCount = 0;
  let noMatchCount = 0;
  
  // Start from row 3 (rows 1-2 are headers, data starts at row 3)
  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    const cardName = row[CONFIG.HELPER_COLS.CARD_NAME];
    const setName = row[CONFIG.HELPER_COLS.SET_NAME];
    const condition = row[CONFIG.HELPER_COLS.CONDITION];
    const collectorNum = row[CONFIG.HELPER_COLS.COLLECTOR_NUM];
    
    if (!cardName) continue; // Skip empty rows
    
    Logger.log(`Row ${i + 1}: Looking for match - ${cardName} | ${setName} | ${condition}`);

    // Add debug logging for Emblem card
    if (cardName.includes('Emblem') && cardName.includes('Liliana')) {
      Logger.log(`  DEBUG: Raw card name: ${JSON.stringify(cardName)}`);
      const normalized = cardName.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').toLowerCase().trim();
      Logger.log(`  DEBUG: Normalized: ${JSON.stringify(normalized)}`);
    }

    // Find matching order
    const matchedOrder = findMatchingOrder(cardName, setName, condition, collectorNum, parsedOrders);
    
    if (matchedOrder) {
      // Fill in Order Number and Buyer Name (columns H and I, indices 7 and 8)
      sheet.getRange(i + 1, CONFIG.HELPER_COLS.ORDER_NUMBER + 1).setValue(matchedOrder.orderNumber);
      sheet.getRange(i + 1, CONFIG.HELPER_COLS.BUYER_NAME + 1).setValue(matchedOrder.buyerName);
      Logger.log(`  ✓ Matched! Order: ${matchedOrder.orderNumber}, Buyer: ${matchedOrder.buyerName}`);
      matchCount++;
    } else {
      Logger.log(`  ✗ No match found for: ${cardName} (${setName})`);
      noMatchCount++;
    }
  }
  
  Logger.log(`\nMatching complete: ${matchCount} matched, ${noMatchCount} not matched`);
}

/**
 * Normalize condition to standard abbreviation
 */
function normalizeCondition(condition) {
  const cond = (condition || '').toLowerCase().trim();
  
  // Fast-path codes like nm1, nmh, nmrh, lph, lpf, etc.
  if (cond.startsWith('nm')) return 'nm';
  if (cond.startsWith('lp')) return 'lp';
  if (cond.startsWith('mp')) return 'mp';
  if (cond.startsWith('hp')) return 'hp';

  // Map various verbose formats to standard abbreviations
  if (cond.includes('near mint')) return 'nm';
  if (cond.includes('lightly played') || cond.includes('light')) return 'lp';
  if (cond.includes('moderately played') || cond.includes('moderate')) return 'mp';
  if (cond.includes('heavily played') || cond.includes('heavy')) return 'hp';
  if (cond.includes('damaged') || cond === 'dmg') return 'damaged';
  
  return cond; // Return as-is if no match
}

/**
 * Name normalization helpers for robust comparisons
 */
function normalizeNameExact(name) {
  return (name || '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .toLowerCase()
    .trim();
}

// Normalize set names (ignore extra descriptors like 'Holofoil')
function normalizeSetName(setName) {
  return (setName || '')
    .toLowerCase()
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[():]/g, ' ') // remove punctuation that splits tokens
    .replace(/\b(holofoil)\b/g, '') // drop noise terms
    .replace(/\s+/g, ' ')
    .trim();
}

function stripParentheticals(name) {
  return (name || '').replace(/\s*\([^\)]*\)/g, '').trim();
}

function normalizeNameLoose(name) {
  // Remove parentheticals, punctuation, collapse spaces
  const noParens = stripParentheticals(name);
  return noParens
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[\-–—]/g, ' ') // hyphen variations to space
    .replace(/[^a-zA-Z0-9\s,]/g, '') // strip punctuation except commas
    .replace(/\s*,\s*/g, ',')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

/**
 * Find matching order for a card
 */
function findMatchingOrder(cardName, setName, condition, collectorNum, orders) {
  // Normalize names (exact / base / loose) for robust matching
  const normalizedCardName = normalizeNameExact(cardName);
  const baseCardName = normalizeNameExact(stripParentheticals(cardName));
  const looseCardName = normalizeNameLoose(cardName);
  const normalizedSetName = setName.toLowerCase().trim();
  const normalizedCondition = normalizeCondition(condition);
  const normalizedCollector = normalizeCollector(collectorNum);
  
  // Fallback candidate if only condition differs
  let weakCandidate = null;
  // Collector-number-based fallback
  let collectorCandidate = null;

  for (const order of orders) {
    for (const card of order.cards) {
      const cardNameNormalized = normalizeNameExact(card.name);
      const cardNameBase = normalizeNameExact(stripParentheticals(card.name));
      const cardNameLoose = normalizeNameLoose(card.name);
      
      // Debug logging for Emblem card
      if (normalizedCardName.includes('emblem') && normalizedCardName.includes('liliana')) {
        if (cardNameNormalized.includes('emblem') && cardNameNormalized.includes('liliana')) {
          Logger.log(`  DEBUG: Found Emblem in PDF: ${JSON.stringify(card.name)}`);
          Logger.log(`  DEBUG: PDF normalized: ${JSON.stringify(cardNameNormalized)}`);
          Logger.log(`  DEBUG: CSV normalized: ${JSON.stringify(normalizedCardName)}`);
          Logger.log(`  DEBUG: Names match: ${cardNameNormalized === normalizedCardName}`);
          Logger.log(`  DEBUG: Set match: ${card.setName} vs ${setName}`);
          Logger.log(`  DEBUG: Condition: ${normalizeCondition(card.condition)} vs ${normalizedCondition}`);
        }
      }
      // Debug logging for Hakbal case
      if (normalizedCardName.includes('hakbal') && normalizedCardName.includes('surging')) {
        if (cardNameNormalized.includes('hakbal')) {
          Logger.log(`  DEBUG: Hakbal PDF: name=${card.name}, set=${card.setName}, cond=${card.condition}, col=${card.collectorNumber}`);
        }
      }
      
      // Name can match by exact, base-without-parentheticals, or loose (punctuation-insensitive)
      const matchesName = (
        cardNameNormalized === normalizedCardName ||
        cardNameBase === baseCardName ||
        cardNameLoose === looseCardName
      );
      const pdfSetNorm = normalizeSetName(card.setName);
      const csvSetNorm = normalizeSetName(setName);
      const matchesSet = pdfSetNorm.includes(csvSetNorm) || csvSetNorm.includes(pdfSetNorm);
      const matchesCondition = normalizeCondition(card.condition) === normalizedCondition;
      
      if (matchesName && matchesSet && matchesCondition) {
        return {
          orderNumber: order.orderNumber,
          buyerName: order.buyerName
        };
      }

      // Capture fallback if only condition differs
      if (!matchesCondition && matchesName && matchesSet && weakCandidate === null) {
        weakCandidate = {
          orderNumber: order.orderNumber,
          buyerName: order.buyerName,
          pdfCondition: normalizeCondition(card.condition),
          csvCondition: normalizedCondition,
          pdfName: card.name,
          pdfSet: card.setName
        };
      }

      // Capture collector-number-based fallback when collector matches; prefer if name OR set matches
      const pdfCollector = normalizeCollector(card.collectorNumber);
      if (!collectorCandidate && normalizedCollector && pdfCollector && normalizedCollector === pdfCollector && (matchesSet || matchesName)) {
        collectorCandidate = {
          orderNumber: order.orderNumber,
          buyerName: order.buyerName,
          pdfName: card.name,
          pdfSet: card.setName,
          pdfCondition: normalizeCondition(card.condition)
        };
      }
    }
  }
  
  if (weakCandidate) {
    Logger.log(`  INFO: Using fallback match (condition differs): PDF=${weakCandidate.pdfCondition}, CSV=${weakCandidate.csvCondition}`);
    return { orderNumber: weakCandidate.orderNumber, buyerName: weakCandidate.buyerName };
  }

  if (collectorCandidate) {
    Logger.log(`  INFO: Using collector# fallback: PDF name=${collectorCandidate.pdfName}, set=${collectorCandidate.pdfSet}, cond=${collectorCandidate.pdfCondition}`);
    return { orderNumber: collectorCandidate.orderNumber, buyerName: collectorCandidate.buyerName };
  }

  return null;
}

/**
 * Step 3: Send to Refund Log
 */
function sendToRefundLog() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    const sheet = SpreadsheetApp.getActiveSheet();
    const dataRange = sheet.getDataRange();
    const data = dataRange.getValues();
    
    // Collect rows with Order Number filled in (data starts at row 3)
    const completedItems = [];
    
    for (let i = 2; i < data.length; i++) {
      const row = data[i];
      const orderNumber = row[CONFIG.HELPER_COLS.ORDER_NUMBER];
      const buyerName = row[CONFIG.HELPER_COLS.BUYER_NAME];
      
      if (orderNumber && buyerName) {
        completedItems.push({
          orderNumber: orderNumber,
          buyerName: buyerName,
          sqNumber: row[CONFIG.HELPER_COLS.SQ_NUMBER],
          game: row[CONFIG.HELPER_COLS.GAME],
          cardName: row[CONFIG.HELPER_COLS.CARD_NAME],
          collectorNum: row[CONFIG.HELPER_COLS.COLLECTOR_NUM],
          rarity: row[CONFIG.HELPER_COLS.RARITY],
          setName: row[CONFIG.HELPER_COLS.SET_NAME],
          condition: row[CONFIG.HELPER_COLS.CONDITION],
          qty: row[CONFIG.HELPER_COLS.QTY]
        });
      }
    }
    
    if (completedItems.length === 0) {
      ui.alert('No Items Ready', 'No items with Order Number and Buyer Name filled in. Upload PDF first.', ui.ButtonSet.OK);
      return;
    }
    
    // Write to Refund Log
    writeToRefundLog(completedItems);

    incrementCounters(1, completedItems.length);
    const counters = getCounters();

    // Toast notification instead of modal
    SpreadsheetApp.getActiveSpreadsheet().toast(
      `✓ ${completedItems.length} items sent to Refund Log! Totals: ${counters.sq} SQ(s), ${counters.rows} row(s)`,
      'Success',
      5
    );

  } catch (error) {
    Logger.log('Error in sendToRefundLog: ' + error.toString());
    ui.alert('Error', 'Failed to send to Refund Log: ' + error.message, ui.ButtonSet.OK);
  }
}

/**
 * Write items to Refund Log with atomic append protection
 */
function writeToRefundLog(items) {
  const refundLog = SpreadsheetApp.openById(CONFIG.REFUND_LOG_ID);
  const refundSheet = refundLog.getSheetByName('Refund Log');

  // Generate unique timestamp for this batch
  const batchTimestamp = new Date().getTime();
  const botId = CONFIG.BOT_ID;

  Logger.log(`Writing ${items.length} items to Refund Log (BOT: ${botId}, Timestamp: ${batchTimestamp})`);

  let writeSuccessful = false;
  let attemptCount = 0;
  const maxAttempts = 3;

  // Get SQ number from items for queue coordination
  const sqNumber = items[0]?.sqNumber || 'UNKNOWN';

  while (!writeSuccessful && attemptCount < maxAttempts) {
    attemptCount++;
    Logger.log(`Write attempt ${attemptCount}/${maxAttempts}...`);

    try {
      // 🔒 QUEUE RESERVATION: Reserve our spot in the write queue
      const assignedRow = tryReserveRefundLogWrite(sqNumber, items.length);

      if (!assignedRow) {
        Logger.log(`⚠️ Failed to reserve Refund Log write slot - retrying...`);
        Utilities.sleep(5000);
        continue;
      }

      const nextRow = assignedRow;

      Logger.log(`Queue assigned rows ${nextRow}-${nextRow + items.length - 1}`);

      // Prepare rows with unique batch identifier
      const rowsToWrite = items.map(item => {
        const row = Array(CONFIG.REFUND_COLS.QUANTITY + 1).fill('');
        // Column A: today's date
        row[0] = new Date();

        row[CONFIG.REFUND_COLS.ORDER_NUMBER] = item.orderNumber;
        row[CONFIG.REFUND_COLS.BUYER_NAME] = item.buyerName;
        row[CONFIG.REFUND_COLS.SQ_NUMBER] = item.sqNumber;
        row[CONFIG.REFUND_COLS.GAME] = item.game || 'Magic';
        row[CONFIG.REFUND_COLS.CARD_NAME] = item.cardName;
        row[CONFIG.REFUND_COLS.CARD_NUM] = item.collectorNum;
        row[CONFIG.REFUND_COLS.RARITY] = item.rarity;
        row[CONFIG.REFUND_COLS.SET_NAME] = item.setName;
        row[CONFIG.REFUND_COLS.CONDITION] = item.condition;
        row[CONFIG.REFUND_COLS.QUANTITY] = item.qty;

        return row;
      });

      // Write to sheet (Convex already reserved these rows for us)
      refundSheet.getRange(nextRow, 1, rowsToWrite.length, rowsToWrite[0].length).setValues(rowsToWrite);
      // Ensure column A displays as date
      refundSheet.getRange(nextRow, 1, rowsToWrite.length, 1).setNumberFormat('m/d/yyyy');
      SpreadsheetApp.flush(); // Ensure writes are committed

      Logger.log(`✓ Wrote ${rowsToWrite.length} rows starting at row ${nextRow}`);

      // Success! Convex guaranteed these rows were ours
      writeSuccessful = true;

      // Release queue reservation after successful write
      releaseRefundLogWrite(sqNumber);

    } catch (e) {
      Logger.log(`ERROR during write attempt ${attemptCount}: ${e}`);
      // Release queue reservation on error
      releaseRefundLogWrite(sqNumber);
      if (attemptCount >= maxAttempts) {
        throw new Error(`Failed to write to Refund Log after ${maxAttempts} attempts: ${e.message}`);
      }
      Utilities.sleep(10000);
    }
  }

  if (!writeSuccessful) {
    throw new Error('Failed to write to Refund Log after multiple attempts - data may have been overwritten by concurrent writes');
  }
}

/**
 * Clear Helper Sheet
 */
function clearHelperSheet() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow > 2) {
    sheet.getRange(3, 1, lastRow - 2, sheet.getLastColumn()).clearContent();
    SpreadsheetApp.getActiveSpreadsheet().toast('Helper sheet cleared', 'Cleared', 3);
  } else {
    SpreadsheetApp.getActiveSpreadsheet().toast('Sheet already empty', 'Cleared', 3);
  }
}

/**
 * Counters: total SQs processed and total rows sent
 */
function getCounters() {
  const props = PropertiesService.getDocumentProperties();
  const sq = parseInt(props.getProperty(CONFIG.COUNTER_KEYS.SQ), 10) || 0;
  const rows = parseInt(props.getProperty(CONFIG.COUNTER_KEYS.ROWS), 10) || 0;
  return { sq, rows };
}

function incrementCounters(sqDelta, rowDelta) {
  const props = PropertiesService.getDocumentProperties();
  const current = getCounters();
  const nextSq = current.sq + (sqDelta || 0);
  const nextRows = current.rows + (rowDelta || 0);
  props.setProperty(CONFIG.COUNTER_KEYS.SQ, String(nextSq));
  props.setProperty(CONFIG.COUNTER_KEYS.ROWS, String(nextRows));
}

function resetCounters() {
  const props = PropertiesService.getDocumentProperties();
  props.deleteProperty(CONFIG.COUNTER_KEYS.SQ);
  props.deleteProperty(CONFIG.COUNTER_KEYS.ROWS);
  SpreadsheetApp.getActiveSpreadsheet().toast('Counters reset.', 'Counters', 3);
}
