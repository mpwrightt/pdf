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
  VERCEL_API_URL: 'https://pdf-nine-psi.vercel.app/api/parse',
  
  // Discrepancy Log
  DISCREP_LOG_ID: '1m0dSOA2VogToEpAo6Jj7FEEsfJbWi1W48xiyTHkBNyY',
  
  // Refund Log
  REFUND_LOG_ID: '1raaUEsPoMl5dEZwilnHtBwdR0wOV2JRqYzdlVYMdohI',
  
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
  const s = String(num).trim();
  if (!s) return '';
  return s; // keep as string, comparisons are string-based
}

/**
 * Creates custom menu when spreadsheet opens
{{ ... }}
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🤖 Refund Tools')
    .addItem('1️⃣ Pull Unclaimed Items', 'pullUnclaimedItems')
    .addSeparator()
    .addItem('2️⃣ Upload SQ PDF', 'showUploadDialog')
    .addSeparator()
    .addItem('3️⃣ Send to Refund Log', 'sendToRefundLog')
    .addSeparator()
    .addItem('🧮 Reset Counters', 'resetCounters')
    .addSeparator()
    .addItem('🗑️ Clear Helper Sheet', 'clearHelperSheet')
    .addToUi();
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
    Logger.log('Getting background colors...');
    const backgrounds = dataRange.getBackgrounds();
    Logger.log(`Total rows in sheet: ${data.length}`);
    Logger.log(`Total columns: ${data[0] ? data[0].length : 0}`);
    Logger.log(`Checking columns - Initials: ${CONFIG.DISCREP_COLS.INITIALS}, SolveDate: ${CONFIG.DISCREP_COLS.SOLVE_DATE}, Manual: ${CONFIG.DISCREP_COLS.MANUAL_INTERVENTION}`);
    // Detect Game column index from header if available (fallback to CONFIG)
    const header = data[0] || [];
    const headerGameIdx = header.findIndex(h => (h || '').toString().trim().toLowerCase() === 'game');
    const GAME_IDX = headerGameIdx >= 0 ? headerGameIdx : CONFIG.DISCREP_COLS.GAME;
    Logger.log(`Detected Game column index: ${GAME_IDX} (header: ${header[GAME_IDX]})`);
    
    // Find unclaimed items: no initials, no solve date, not red, not in vault
    const unclaimedItems = [];
    let debugCount = 0;
    
    Logger.log(`Starting to scan ${data.length - 1} data rows...`);
    Logger.log(`Filter criteria: No initials + No solve date + Not red + Not in vault`);
    
    let skipCounts = {
      hasInitials: 0,
      hasSolveDate: 0,
      hasManual: 0,
      isRed: 0,
      hasNoneLocation: 0
    };
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const initials = row[CONFIG.DISCREP_COLS.INITIALS];
      const resolutionType = row[CONFIG.DISCREP_COLS.RESOLUTION_TYPE];
      const solveDate = row[CONFIG.DISCREP_COLS.SOLVE_DATE];
      const manualIntervention = row[CONFIG.DISCREP_COLS.MANUAL_INTERVENTION];
      const locationId = row[CONFIG.DISCREP_COLS.LOCATION_ID];
      const sqNumber = row[CONFIG.DISCREP_COLS.SQ_NUMBER];
      const sqBackgroundColor = backgrounds[i][CONFIG.DISCREP_COLS.SQ_NUMBER];
      
      // Log first 5 rows for debugging
      if (debugCount < 5) {
        Logger.log(`Row ${i}: SQ=${sqNumber}, Initials='${initials}', ResType='${resolutionType}', SolveDate='${solveDate}', Manual='${manualIntervention}', BgColor='${sqBackgroundColor}'`);
        debugCount++;
      }
      
      // Check if SQ Number has red background (skip if red)
      // Red in Sheets is typically #ff0000, #ff0001, etc.
      const colorLower = sqBackgroundColor ? sqBackgroundColor.toLowerCase() : '';
      const isRedBackground = colorLower && (
        colorLower.startsWith('#ff0000') ||
        colorLower.startsWith('#ff0001') ||
        colorLower === '#f00' ||
        colorLower.includes('rgb(255, 0, 0') ||
        colorLower === 'red'
      );
      
      // Track why items are skipped
      // Filter logic: no initials, no solve date, not red, not in vault, not "NONE" location
      if (initials) {
        skipCounts.hasInitials++;
      } else if (solveDate) {
        skipCounts.hasSolveDate++;
      } else if (isRedBackground) {
        skipCounts.isRed++;
        if (skipCounts.isRed === 1) {
          Logger.log(`First red background found at row ${i}: color='${sqBackgroundColor}'`);
        }
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
    Logger.log(`  - Red background (needs attention): ${skipCounts.isRed}`);
    Logger.log(`  - Has manual intervention flag (in vault): ${skipCounts.hasManual}`);
    Logger.log(`  - Location is "NONE": ${skipCounts.hasNoneLocation}`);
    
    if (unclaimedItems.length === 0) {
      Logger.log('\nNo items matched ALL criteria. Check skip breakdown above.');
      ui.alert(
        'No Unclaimed Items', 
        `No unclaimed items found.\n\nSkipped:\n` +
        `- Has initials: ${skipCounts.hasInitials}\n` +
        `- Has solve date: ${skipCounts.hasSolveDate}\n` +
        `- Red background: ${skipCounts.isRed}\n` +
        `- In vault: ${skipCounts.hasManual}\n` +
        `- Location "NONE": ${skipCounts.hasNoneLocation}\n\n` +
        `Check Extensions > Apps Script > Executions for details.`,
        ui.ButtonSet.OK
      );
      return;
    }
    
    // Auto-select first unclaimed SQ
    const uniqueSQs = [...new Set(unclaimedItems.map(item => item.sqNumber))];
    
    if (uniqueSQs.length === 0) {
      ui.alert('No Items', 'No unclaimed items found.', ui.ButtonSet.OK);
      return;
    }
    
    // Automatically select the first SQ
    const selectedSQ = uniqueSQs[0];
    Logger.log(`Auto-selected first unclaimed SQ: ${selectedSQ} (${uniqueSQs.length} total unclaimed SQs)`);
    
    // Filter items for selected SQ
    const itemsForSQ = unclaimedItems.filter(item => item.sqNumber === selectedSQ);
    
    if (itemsForSQ.length === 0) {
      ui.alert('Not Found', `No items found for SQ: ${selectedSQ}`, ui.ButtonSet.OK);
      return;
    }
    
    // Claim the selected items in the Discrepancy Log: set Initials = 'BOT', Resolution Type = 'Missing Note', and Solve Date = today
    try {
      const now = new Date();
      let claimed = 0;
      for (const item of itemsForSQ) {
        // Initials (O), Resolution Type (P), and Solve Date (R)
        discrepSheet.getRange(item.rowIndex, CONFIG.DISCREP_COLS.INITIALS + 1).setValue('BOT');
        discrepSheet.getRange(item.rowIndex, CONFIG.DISCREP_COLS.RESOLUTION_TYPE + 1).setValue('Missing Note');
        discrepSheet.getRange(item.rowIndex, CONFIG.DISCREP_COLS.SOLVE_DATE + 1).setValue(now);
        claimed++;
      }
      Logger.log(`Claimed ${claimed} row(s) in Discrepancy Log for SQ ${selectedSQ} (Initials='BOT', Resolution='Missing Note', Solve Date=${now.toDateString()}).`);
    } catch (e) {
      Logger.log(`WARNING: Failed to claim items for SQ ${selectedSQ}: ${e}`);
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
    
    ui.alert(
      'Items Loaded',
      `Pulled ${itemsForSQ.length} items for SQ: ${selectedSQ}\n\n${uniqueSQs.length} total unclaimed SQs remaining.\n\nNext: Upload the PDF for this SQ.`,
      ui.ButtonSet.OK
    );
    
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
    
    return {
      success: true,
      orderCount: parsedOrders.length,
      fileName: fileName
    };
    
  } catch (error) {
    Logger.log('Error processing PDF: ' + error.toString());
    throw new Error('Failed to process PDF: ' + error.message);
  }
}

/**
 * Call Vercel API to parse PDF
 */
function callVercelAPI(blob) {
  try {
    const base64PDF = Utilities.base64Encode(blob.getBytes());
    
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ pdf: base64PDF }),
      muteHttpExceptions: true
    };
    
    Logger.log(`Calling Vercel API: ${CONFIG.VERCEL_API_URL}`);
    const response = UrlFetchApp.fetch(CONFIG.VERCEL_API_URL, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    Logger.log(`API Response Status: ${statusCode}`);
    Logger.log(`API Response (first 500 chars): ${responseText.substring(0, 500)}`);
    
    if (statusCode !== 200) {
      throw new Error(`API returned status ${statusCode}: ${responseText.substring(0, 200)}`);
    }
    
    const responseData = JSON.parse(responseText);
    
    if (!responseData.success) {
      throw new Error(responseData.error || 'API request failed');
    }
    
    Logger.log(`Found ${responseData.orders.length} orders in PDF`);
    if (responseData.orders.length > 0) {
      Logger.log(`First order: ${responseData.orders[0].orderNumber}, ${responseData.orders[0].cards.length} cards`);
    }
    
    return responseData.orders;
    
  } catch (error) {
    Logger.log('Error calling Vercel API: ' + error.toString());
    throw new Error('Failed to parse PDF via API: ' + error.message);
  }
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
  const cond = condition.toLowerCase().trim();
  
  // Map various condition formats to standard abbreviations
  if (cond.includes('near mint') || cond === 'nm' || cond === 'nmf' || cond === 'nmh' || cond === 'nmrh') return 'nm';
  if (cond.includes('lightly played') || cond.includes('light') || cond === 'lp' || cond === 'lpf' || cond === 'lph') return 'lp';
  if (cond.includes('moderately played') || cond.includes('moderate') || cond === 'mp' || cond === 'mpf') return 'mp';
  if (cond.includes('heavily played') || cond.includes('heavy') || cond === 'hp' || cond === 'hpf') return 'hp';
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

      // Capture collector-number-based fallback if set matches and collector matches
      const pdfCollector = normalizeCollector(card.collectorNumber);
      if (!collectorCandidate && normalizedCollector && pdfCollector && normalizedCollector === pdfCollector && matchesSet) {
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
    ui.alert('Success', `${completedItems.length} items sent to Refund Log!\nTotals so far: ${counters.sq} SQ(s), ${counters.rows} row(s).`, ui.ButtonSet.OK);
    SpreadsheetApp.getActiveSpreadsheet().toast(`Totals — SQs: ${counters.sq} | Rows: ${counters.rows}`, 'Counters', 5);
    
  } catch (error) {
    Logger.log('Error in sendToRefundLog: ' + error.toString());
    ui.alert('Error', 'Failed to send to Refund Log: ' + error.message, ui.ButtonSet.OK);
  }
}

/**
 * Write items to Refund Log
 */
function writeToRefundLog(items) {
  const refundLog = SpreadsheetApp.openById(CONFIG.REFUND_LOG_ID);
  const refundSheet = refundLog.getSheetByName('Refund Log');
  
  // Find next empty row
  const lastRow = refundSheet.getLastRow();
  const nextRow = lastRow + 1;
  
  // Prepare rows
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
  
  // Write to sheet
  refundSheet.getRange(nextRow, 1, rowsToWrite.length, rowsToWrite[0].length).setValues(rowsToWrite);
  // Ensure column A displays as date
  refundSheet.getRange(nextRow, 1, rowsToWrite.length, 1).setNumberFormat('m/d/yyyy');
}

/**
 * Clear Helper Sheet
 */
function clearHelperSheet() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Clear Sheet',
    'Clear all data from Helper Sheet?',
    ui.ButtonSet.YES_NO
  );
  
  if (response === ui.Button.YES) {
    const sheet = SpreadsheetApp.getActiveSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow > 2) {
      sheet.getRange(3, 1, lastRow - 2, sheet.getLastColumn()).clearContent();
    }
    ui.alert('Cleared', 'Helper sheet cleared.', ui.ButtonSet.OK);
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
