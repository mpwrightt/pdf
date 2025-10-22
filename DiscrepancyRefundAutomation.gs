/**
 * Discrepancy Refund Automation
 * 
 * Automates the refund processing workflow:
 * 1. Reads Discrepancy Log for unsolved "Missing Note" items
 * 2. Calls Vercel API to get order information by SQ number
 * 3. Matches cards and writes to Refund Log
 * 4. Updates Discrepancy Log with solve date
 */

// Configuration
const CONFIG = {
  VERCEL_API_URL: 'https://pdf-six-flax.vercel.app/api/parse',
  
  // Discrepancy Log
  DISCREP_LOG_ID: '1Jyf236hcpsm-x5TONHQ5tbxtFM9gfjg-BAGYwk4BNtI',
  DISCREP_LOG_GID: '1984354615',
  
  // Refund Log
  REFUND_LOG_ID: '1uMF_4fluOcnnDsUPLFpM-oWfIpd1HD6Ij4d8UNlgaFc',
  REFUND_LOG_GID: '1331496674',
  
  // Discrepancy Log Columns (adjust as needed)
  DISCREP_COLS: {
    SQ_NUMBER: 2,      // Column C
    CARD_NAME: 3,      // Column D
    COLLECTOR_NUM: 4,  // Column E
    RARITY: 5,         // Column F
    SET_NAME: 6,       // Column G
    CONDITION: 7,      // Column H
    QTY: 8,            // Column I
    RESOLUTION: 11,    // Column L (Missing Note indicator)
    SOLVE_DATE: 15     // Column P (or wherever solve date goes)
  },
  
  // Refund Log Columns
  REFUND_COLS: {
    ORDER_LINK: 2,     // Column C
    ORDER_NUMBER: 3,   // Column D
    BUYER_NAME: 4,     // Column E
    SQ_NUMBER: 5,      // Column F
    GAME: 6,           // Column G
    CARD_NUM: 7,       // Column H
    RARITY: 8,         // Column I
    SET_NAME: 9,       // Column J
    CONDITION: 10,     // Column K
    QUANTITY: 11       // Column L
  }
};

/**
 * Creates custom menu when spreadsheet opens
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🤖 Refund Automation')
    .addItem('▶️ Process Missing Notes', 'processDiscrepancies')
    .addSeparator()
    .addItem('📊 Show Status', 'showProcessingStatus')
    .addToUi();
}

/**
 * Main processing function
 */
function processDiscrepancies() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    // Get Discrepancy Log
    const discrepLog = SpreadsheetApp.openById(CONFIG.DISCREP_LOG_ID);
    const discrepSheet = discrepLog.getSheets()[0]; // First sheet
    
    // Get unsolved Missing Note items
    const unsolvedItems = getUnsolvedMissingNotes(discrepSheet);
    
    if (unsolvedItems.length === 0) {
      ui.alert('No Items to Process', 'No unsolved "Missing Note" items found in Discrepancy Log.', ui.ButtonSet.OK);
      return;
    }
    
    // Confirm processing
    const response = ui.alert(
      'Process Refunds',
      `Found ${unsolvedItems.length} unsolved items.\n\nProceed with automation?`,
      ui.ButtonSet.YES_NO
    );
    
    if (response !== ui.Button.YES) {
      return;
    }
    
    // Group by SQ number (to minimize API calls)
    const itemsBySQ = groupBySQNumber(unsolvedItems);
    const sqNumbers = Object.keys(itemsBySQ);
    
    ui.alert('Processing', `Processing ${sqNumbers.length} SQ numbers...`, ui.ButtonSet.OK);
    
    // Process each SQ
    const results = [];
    let processedCount = 0;
    let errorCount = 0;
    
    for (const sqNumber of sqNumbers) {
      try {
        const items = itemsBySQ[sqNumber];
        
        // TODO: Call Vercel API to get order data
        // For now, this is a placeholder - you need to download the PDF first
        // In the final version with Engineering's API, this will be a direct API call
        
        Logger.log(`Processing SQ ${sqNumber} with ${items.length} items`);
        
        // This would be replaced with actual API call:
        // const orderData = await callTCGPlayerAPI(sqNumber);
        
        processedCount += items.length;
        
      } catch (error) {
        Logger.log(`Error processing SQ ${sqNumber}: ${error}`);
        errorCount++;
      }
    }
    
    // Show results
    ui.alert(
      'Processing Complete',
      `Processed: ${processedCount} items\nErrors: ${errorCount}\n\nCheck the Refund Log for results.`,
      ui.ButtonSet.OK
    );
    
  } catch (error) {
    Logger.log('Error in processDiscrepancies: ' + error.toString());
    ui.alert('Error', 'Failed to process discrepancies: ' + error.message, ui.ButtonSet.OK);
  }
}

/**
 * Get unsolved "Missing Note" items from Discrepancy Log
 */
function getUnsolvedMissingNotes(sheet) {
  const dataRange = sheet.getDataRange();
  const data = dataRange.getValues();
  const unsolvedItems = [];
  
  // Start from row 2 (skip header)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    
    // Check if this is a "Missing Note" and unsolved
    const resolution = row[CONFIG.DISCREP_COLS.RESOLUTION];
    const solveDate = row[CONFIG.DISCREP_COLS.SOLVE_DATE];
    
    // If resolution contains "Missing Note" and no solve date
    if (resolution && resolution.toString().includes('Missing Note') && !solveDate) {
      unsolvedItems.push({
        rowIndex: i + 1,
        sqNumber: row[CONFIG.DISCREP_COLS.SQ_NUMBER],
        cardName: row[CONFIG.DISCREP_COLS.CARD_NAME],
        collectorNum: row[CONFIG.DISCREP_COLS.COLLECTOR_NUM],
        rarity: row[CONFIG.DISCREP_COLS.RARITY],
        setName: row[CONFIG.DISCREP_COLS.SET_NAME],
        condition: row[CONFIG.DISCREP_COLS.CONDITION],
        quantity: row[CONFIG.DISCREP_COLS.QTY]
      });
    }
  }
  
  return unsolvedItems;
}

/**
 * Group items by SQ number
 */
function groupBySQNumber(items) {
  const grouped = {};
  
  for (const item of items) {
    if (!grouped[item.sqNumber]) {
      grouped[item.sqNumber] = [];
    }
    grouped[item.sqNumber].push(item);
  }
  
  return grouped;
}

/**
 * Call TCGplayer API (placeholder for Engineering's API)
 */
function callTCGPlayerAPI(sqNumber) {
  // This will be replaced with actual API call when Engineering builds it
  // For now, returns empty to show structure
  
  // const url = `https://internal.tcgplayer.com/api/orders/by-sq/${sqNumber}`;
  // const options = {
  //   method: 'get',
  //   headers: {
  //     'Authorization': 'Bearer YOUR_API_KEY'
  //   }
  // };
  // const response = UrlFetchApp.fetch(url, options);
  // return JSON.parse(response.getContentText());
  
  return {
    sq_number: sqNumber,
    orders: []
  };
}

/**
 * Write results to Refund Log
 */
function writeToRefundLog(matchedItems) {
  const refundLog = SpreadsheetApp.openById(CONFIG.REFUND_LOG_ID);
  const refundSheet = refundLog.getSheets()[0];
  
  // Find next empty row
  const lastRow = refundSheet.getLastRow();
  const nextRow = lastRow + 1;
  
  // Prepare rows to write
  const rowsToWrite = [];
  
  for (const item of matchedItems) {
    const row = Array(CONFIG.REFUND_COLS.QUANTITY + 1).fill('');
    
    row[CONFIG.REFUND_COLS.ORDER_LINK] = ''; // TODO: Generate order link
    row[CONFIG.REFUND_COLS.ORDER_NUMBER] = item.orderNumber;
    row[CONFIG.REFUND_COLS.BUYER_NAME] = item.buyerName;
    row[CONFIG.REFUND_COLS.SQ_NUMBER] = item.sqNumber;
    row[CONFIG.REFUND_COLS.GAME] = 'Magic';
    row[CONFIG.REFUND_COLS.CARD_NUM] = item.collectorNum;
    row[CONFIG.REFUND_COLS.RARITY] = item.rarity;
    row[CONFIG.REFUND_COLS.SET_NAME] = item.setName;
    row[CONFIG.REFUND_COLS.CONDITION] = item.condition;
    row[CONFIG.REFUND_COLS.QUANTITY] = item.quantity;
    
    rowsToWrite.push(row);
  }
  
  // Write to sheet
  if (rowsToWrite.length > 0) {
    refundSheet.getRange(nextRow, 1, rowsToWrite.length, rowsToWrite[0].length).setValues(rowsToWrite);
  }
  
  return rowsToWrite.length;
}

/**
 * Update Discrepancy Log with solve date
 */
function updateDiscrepLog(rowIndices) {
  const discrepLog = SpreadsheetApp.openById(CONFIG.DISCREP_LOG_ID);
  const discrepSheet = discrepLog.getSheets()[0];
  
  const today = new Date();
  
  for (const rowIndex of rowIndices) {
    discrepSheet.getRange(rowIndex, CONFIG.DISCREP_COLS.SOLVE_DATE + 1).setValue(today);
  }
}

/**
 * Show processing status
 */
function showProcessingStatus() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    const discrepLog = SpreadsheetApp.openById(CONFIG.DISCREP_LOG_ID);
    const discrepSheet = discrepLog.getSheets()[0];
    
    const unsolvedItems = getUnsolvedMissingNotes(discrepSheet);
    const sqNumbers = [...new Set(unsolvedItems.map(item => item.sqNumber))];
    
    ui.alert(
      'Processing Status',
      `Unsolved Missing Notes: ${unsolvedItems.length}\n` +
      `Unique SQ Numbers: ${sqNumbers.length}\n\n` +
      `Ready to process.`,
      ui.ButtonSet.OK
    );
    
  } catch (error) {
    ui.alert('Error', 'Failed to get status: ' + error.message, ui.ButtonSet.OK);
  }
}
