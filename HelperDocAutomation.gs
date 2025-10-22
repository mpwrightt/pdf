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
  VERCEL_API_URL: 'https://pdf-six-flax.vercel.app/api/parse',
  
  // Discrepancy Log
  DISCREP_LOG_ID: '1Jyf236hcpsm-x5TONHQ5tbxtFM9gfjg-BAGYwk4BNtI',
  
  // Refund Log
  REFUND_LOG_ID: '1uMF_4fluOcnnDsUPLFpM-oWfIpd1HD6Ij4d8UNlgaFc',
  
  // Discrepancy Log Columns (adjust based on your actual sheet)
  DISCREP_COLS: {
    INITIALS: 1,       // Column B (where initials are)
    SQ_NUMBER: 2,      // Column C
    CARD_NAME: 3,      // Column D
    COLLECTOR_NUM: 4,  // Column E
    RARITY: 5,         // Column F
    SET_NAME: 6,       // Column G
    CONDITION: 7,      // Column H
    QTY: 8,            // Column I
    RESOLUTION: 11     // Column L (Missing Note)
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
  }
  
  // Refund Log Columns
  REFUND_COLS: {
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
  ui.createMenu('🤖 Refund Tools')
    .addItem('1️⃣ Pull Unclaimed Items', 'pullUnclaimedItems')
    .addSeparator()
    .addItem('2️⃣ Upload SQ PDF', 'showUploadDialog')
    .addSeparator()
    .addItem('3️⃣ Send to Refund Log', 'sendToRefundLog')
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
    const discrepSheet = discrepLog.getSheets()[0];
    
    // Get all data
    const dataRange = discrepSheet.getDataRange();
    const data = dataRange.getValues();
    
    // Find unclaimed items (no initials AND Missing Note)
    const unclaimedItems = [];
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const initials = row[CONFIG.DISCREP_COLS.INITIALS];
      const resolution = row[CONFIG.DISCREP_COLS.RESOLUTION];
      
      // If no initials and is "Missing Note"
      if (!initials && resolution && resolution.toString().includes('Missing Note')) {
        unclaimedItems.push({
          sqNumber: row[CONFIG.DISCREP_COLS.SQ_NUMBER],
          cardName: row[CONFIG.DISCREP_COLS.CARD_NAME],
          collectorNum: row[CONFIG.DISCREP_COLS.COLLECTOR_NUM],
          rarity: row[CONFIG.DISCREP_COLS.RARITY],
          setName: row[CONFIG.DISCREP_COLS.SET_NAME],
          condition: row[CONFIG.DISCREP_COLS.CONDITION],
          qty: row[CONFIG.DISCREP_COLS.QTY]
        });
      }
    }
    
    if (unclaimedItems.length === 0) {
      ui.alert('No Unclaimed Items', 'No unclaimed "Missing Note" items found in Discrepancy Log.', ui.ButtonSet.OK);
      return;
    }
    
    // Ask user which SQ to work on
    const uniqueSQs = [...new Set(unclaimedItems.map(item => item.sqNumber))];
    
    if (uniqueSQs.length === 0) {
      ui.alert('No Items', 'No unclaimed items found.', ui.ButtonSet.OK);
      return;
    }
    
    // Show first few SQs
    const sqList = uniqueSQs.slice(0, 10).join(', ');
    const response = ui.prompt(
      'Select SQ Number',
      `Found ${uniqueSQs.length} unclaimed SQs:\n${sqList}${uniqueSQs.length > 10 ? '...' : ''}\n\nEnter SQ number to pull:`,
      ui.ButtonSet.OK_CANCEL
    );
    
    if (response.getSelectedButton() !== ui.Button.OK) {
      return;
    }
    
    const selectedSQ = response.getResponseText().trim();
    
    // Filter items for selected SQ
    const itemsForSQ = unclaimedItems.filter(item => item.sqNumber === selectedSQ);
    
    if (itemsForSQ.length === 0) {
      ui.alert('Not Found', `No items found for SQ: ${selectedSQ}`, ui.ButtonSet.OK);
      return;
    }
    
    // Write to current sheet (Helper Doc)
    const currentSheet = SpreadsheetApp.getActiveSheet();
    
    // Clear existing data (keep header)
    const lastRow = currentSheet.getLastRow();
    if (lastRow > 1) {
      currentSheet.getRange(2, 1, lastRow - 1, currentSheet.getLastColumn()).clearContent();
    }
    
    // Prepare rows to match Helper Doc columns
    const rowsToWrite = itemsForSQ.map(item => [
      '',              // Column A (empty)
      '',              // Column B (empty)
      '',              // Column C (empty)
      '',              // Column D (empty)
      '',              // Column E (empty)
      '',              // Column F (empty)
      '',              // Column G (empty)
      '',              // Column H - Order Number (HIDDEN, to be filled by PDF)
      '',              // Column I - Buyer Name (HIDDEN, to be filled by PDF)
      item.sqNumber,   // Column J - SQ Number
      'Magic',         // Column K - Game
      item.cardName,   // Column L - Card Name
      item.collectorNum, // Column M - Card #
      item.rarity,     // Column N - Rarity
      item.setName,    // Column O - Set Name
      item.condition,  // Column P - Condition
      item.qty         // Column Q - Quantity
    ]);
    
    // Write to sheet starting at row 2
    currentSheet.getRange(2, 1, rowsToWrite.length, rowsToWrite[0].length).setValues(rowsToWrite);
    
    ui.alert(
      'Items Loaded',
      `Pulled ${itemsForSQ.length} items for SQ: ${selectedSQ}\n\nNext: Upload the PDF for this SQ.`,
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
        showStatus('PDF processed successfully! Found ' + result.orderCount + ' orders. Ready to send to Refund Log.', 'success');
        setTimeout(() => google.script.host.close(), 3000);
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
    // Convert base64 to blob
    const data = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(data, 'application/pdf', fileName);
    
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
    
    const response = UrlFetchApp.fetch(CONFIG.VERCEL_API_URL, options);
    const responseData = JSON.parse(response.getContentText());
    
    if (!responseData.success) {
      throw new Error(responseData.error || 'API request failed');
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
  
  // Start from row 2 (skip header)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const cardName = row[CONFIG.HELPER_COLS.CARD_NAME];
    const setName = row[CONFIG.HELPER_COLS.SET_NAME];
    const condition = row[CONFIG.HELPER_COLS.CONDITION];
    
    if (!cardName) continue; // Skip empty rows
    
    // Find matching order
    const matchedOrder = findMatchingOrder(cardName, setName, condition, parsedOrders);
    
    if (matchedOrder) {
      // Fill in Order Number and Buyer Name
      sheet.getRange(i + 1, CONFIG.HELPER_COLS.ORDER_NUMBER + 1).setValue(matchedOrder.orderNumber);
      sheet.getRange(i + 1, CONFIG.HELPER_COLS.BUYER_NAME + 1).setValue(matchedOrder.buyerName);
    } else {
      Logger.log(`No match found for: ${cardName} (${setName})`);
    }
  }
}

/**
 * Find matching order for a card
 */
function findMatchingOrder(cardName, setName, condition, orders) {
  const normalizedCardName = cardName.toLowerCase().trim();
  const normalizedSetName = setName.toLowerCase().trim();
  const normalizedCondition = condition.toLowerCase().trim();
  
  for (const order of orders) {
    for (const card of order.cards) {
      const matchesName = card.name.toLowerCase().trim() === normalizedCardName;
      const matchesSet = card.setName.toLowerCase().includes(normalizedSetName) || 
                         normalizedSetName.includes(card.setName.toLowerCase());
      const matchesCondition = card.condition.toLowerCase().includes(normalizedCondition);
      
      if (matchesName && matchesSet && matchesCondition) {
        return {
          orderNumber: order.orderNumber,
          buyerName: order.buyerName
        };
      }
    }
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
    
    // Collect rows with Order Number filled in
    const completedItems = [];
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const orderNumber = row[CONFIG.HELPER_COLS.ORDER_NUMBER];
      const buyerName = row[CONFIG.HELPER_COLS.BUYER_NAME];
      
      if (orderNumber && buyerName) {
        completedItems.push({
          orderNumber: orderNumber,
          buyerName: buyerName,
          sqNumber: row[CONFIG.HELPER_COLS.SQ_NUMBER],
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
    
    // Confirm
    const response = ui.alert(
      'Send to Refund Log',
      `Send ${completedItems.length} items to Refund Log?`,
      ui.ButtonSet.YES_NO
    );
    
    if (response !== ui.Button.YES) {
      return;
    }
    
    // Write to Refund Log
    writeToRefundLog(completedItems);
    
    ui.alert('Success', `${completedItems.length} items sent to Refund Log!`, ui.ButtonSet.OK);
    
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
  const refundSheet = refundLog.getSheets()[0];
  
  // Find next empty row
  const lastRow = refundSheet.getLastRow();
  const nextRow = lastRow + 1;
  
  // Prepare rows
  const rowsToWrite = items.map(item => {
    const row = Array(CONFIG.REFUND_COLS.QUANTITY + 1).fill('');
    
    row[CONFIG.REFUND_COLS.ORDER_NUMBER] = item.orderNumber;
    row[CONFIG.REFUND_COLS.BUYER_NAME] = item.buyerName;
    row[CONFIG.REFUND_COLS.SQ_NUMBER] = item.sqNumber;
    row[CONFIG.REFUND_COLS.GAME] = 'Magic';
    row[CONFIG.REFUND_COLS.CARD_NUM] = item.collectorNum;
    row[CONFIG.REFUND_COLS.RARITY] = item.rarity;
    row[CONFIG.REFUND_COLS.SET_NAME] = item.setName;
    row[CONFIG.REFUND_COLS.CONDITION] = item.condition;
    row[CONFIG.REFUND_COLS.QUANTITY] = item.qty;
    
    return row;
  });
  
  // Write to sheet
  refundSheet.getRange(nextRow, 1, rowsToWrite.length, rowsToWrite[0].length).setValues(rowsToWrite);
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
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
    }
    ui.alert('Cleared', 'Helper sheet cleared.', ui.ButtonSet.OK);
  }
}
