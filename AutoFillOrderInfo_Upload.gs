/**
 * Auto-Fill Order Information from SQ Details PDF (Upload Version)
 * 
 * Features:
 * - Upload PDF directly through Google Sheets menu
 * - Automatically converts PDF to text
 * - Stores converted text for reuse
 * - Processes your discrepancy sheet
 * 
 * Setup:
 * 1. Copy this entire script to Google Apps Script (Extensions > Apps Script)
 * 2. Save and authorize the script
 * 3. Refresh your Google Sheet
 * 4. Use "Order Tools > Upload SQ Details PDF" to upload your PDF
 * 5. Use "Order Tools > Process Sheet" to fill in order info
 */

// Column configuration based on your sheet layout
const COLUMNS = {
  DIRECT_ORDER: 7,   // Column H (0-based = 7)
  BUYER_NAME: 8,     // Column I
  SQ_NUMBER: 9,      // Column J
  GAME: 10,          // Column K
  CARD_NAME: 11,     // Column L
  COLLECTOR_NUM: 12, // Column M
  RARITY: 13,        // Column N
  SET_NAME: 14,      // Column O
  CONDITION: 15,     // Column P
  QUANTITY: 16       // Column Q
};

/**
 * Creates custom menu when spreadsheet opens
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Order Tools')
    .addItem('📤 Upload SQ Details PDF', 'showUploadDialog')
    .addSeparator()
    .addItem('▶️ Process Sheet', 'processCurrentSheet')
    .addItem('ℹ️ Show Upload Status', 'showPDFStatus')
    .addSeparator()
    .addItem('🔍 Debug: Show PDF Sample', 'debugShowPDFSample')
    .addSeparator()
    .addItem('🗑️ Clear Uploaded PDF', 'clearStoredPDF')
    .addToUi();
}

/**
 * Show PDF upload dialog
 */
function showUploadDialog() {
  const html = HtmlService.createHtmlOutput(`
    <!DOCTYPE html>
    <html>
      <head>
        <base target="_top">
        <style>
          body {
            font-family: Arial, sans-serif;
            padding: 20px;
            max-width: 500px;
          }
          .upload-area {
            border: 2px dashed #4285f4;
            border-radius: 8px;
            padding: 30px;
            text-align: center;
            background: #f8f9fa;
            margin: 20px 0;
          }
          .upload-area:hover {
            background: #e8f0fe;
          }
          input[type="file"] {
            display: none;
          }
          .upload-button {
            background: #4285f4;
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
          }
          .upload-button:hover {
            background: #357ae8;
          }
          .status {
            margin-top: 15px;
            padding: 10px;
            border-radius: 4px;
            display: none;
          }
          .status.success {
            background: #d4edda;
            color: #155724;
            display: block;
          }
          .status.error {
            background: #f8d7da;
            color: #721c24;
            display: block;
          }
          .status.processing {
            background: #fff3cd;
            color: #856404;
            display: block;
          }
        </style>
      </head>
      <body>
        <h2>Upload SQ Details PDF</h2>
        <p>Select your SQ Details PDF file to upload and convert:</p>
        
        <div class="upload-area" onclick="document.getElementById('fileInput').click()">
          <p>📄 Click to select PDF file</p>
          <p style="font-size: 12px; color: #666;">or drag and drop here</p>
          <input type="file" id="fileInput" accept=".pdf" onchange="handleFileSelect(event)">
        </div>
        
        <div id="status" class="status"></div>
        
        <script>
          function handleFileSelect(event) {
            const file = event.target.files[0];
            if (!file) return;
            
            if (!file.name.toLowerCase().endsWith('.pdf')) {
              showStatus('Please select a PDF file', 'error');
              return;
            }
            
            showStatus('Converting PDF to text...', 'processing');
            
            const reader = new FileReader();
            reader.onload = function(e) {
              const data = e.target.result;
              
              // Convert to base64 in chunks to avoid stack overflow
              const uint8Array = new Uint8Array(data);
              let base64 = '';
              const chunkSize = 0x8000; // 32KB chunks
              
              for (let i = 0; i < uint8Array.length; i += chunkSize) {
                const chunk = uint8Array.subarray(i, i + chunkSize);
                base64 += String.fromCharCode.apply(null, chunk);
              }
              
              base64 = btoa(base64);
              
              google.script.run
                .withSuccessHandler(onUploadSuccess)
                .withFailureHandler(onUploadError)
                .processPDFUpload(base64, file.name);
            };
            reader.readAsArrayBuffer(file);
          }
          
          function onUploadSuccess(result) {
            showStatus('✅ PDF converted successfully! Found ' + result.orderCount + ' orders. You can now close this and click "Process Sheet".', 'success');
          }
          
          function onUploadError(error) {
            showStatus('❌ Error: ' + error.message, 'error');
          }
          
          function showStatus(message, type) {
            const status = document.getElementById('status');
            status.textContent = message;
            status.className = 'status ' + type;
          }
        </script>
      </body>
    </html>
  `)
    .setWidth(550)
    .setHeight(350);
  
  SpreadsheetApp.getUi().showModalDialog(html, 'Upload SQ Details PDF');
}

/**
 * Process uploaded PDF data
 */
function processPDFUpload(base64Data, fileName) {
  try {
    // Convert base64 to blob
    const data = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(data, 'application/pdf', fileName);
    
    // Extract text from PDF using Google Drive
    const textContent = extractTextFromPDF(blob);
    
    if (!textContent || textContent.length < 100) {
      throw new Error('PDF text extraction failed or file is too short. Try converting the PDF to text manually.');
    }
    
    // Store in Script Properties
    PropertiesService.getScriptProperties().setProperty('SQ_PDF_TEXT', textContent);
    PropertiesService.getScriptProperties().setProperty('SQ_PDF_NAME', fileName);
    PropertiesService.getScriptProperties().setProperty('SQ_PDF_DATE', new Date().toISOString());
    
    // Parse to count orders
    const orders = parseOrders(textContent);
    
    return {
      success: true,
      orderCount: orders.length,
      fileName: fileName
    };
    
  } catch (error) {
    Logger.log('Error processing PDF: ' + error.toString());
    throw new Error('Failed to process PDF: ' + error.message);
  }
}

/**
 * Extract text from PDF using Vercel API
 */
function extractTextFromPDF(blob) {
  try {
    // Call Vercel PDF Parser API
    const VERCEL_API_URL = 'https://pdf-six-flax.vercel.app/api/parse';
    
    // Convert blob to base64
    const base64PDF = Utilities.base64Encode(blob.getBytes());
    
    // Call API
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ pdf: base64PDF }),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(VERCEL_API_URL, options);
    const responseData = JSON.parse(response.getContentText());
    
    if (!responseData.success) {
      throw new Error(responseData.error || 'API request failed');
    }
    
    // Store parsed orders for later use
    PropertiesService.getScriptProperties().setProperty('PARSED_ORDERS', JSON.stringify(responseData.orders));
    
    // Return a text representation for compatibility
    return JSON.stringify(responseData.orders);
    
  } catch (error) {
    Logger.log('Error calling Vercel API: ' + error.toString());
    throw new Error('Failed to parse PDF via API: ' + error.message);
  }
}

/**
 * OLD FUNCTION - Extract text from PDF using Google Drive (DEPRECATED)
 */
function extractTextFromPDF_OLD(blob) {
  try {
    // Save PDF to Drive temporarily
    const folder = DriveApp.getRootFolder();
    const file = folder.createFile(blob);
    
    try {
      // Use Drive API to convert PDF to Google Doc
      const resource = {
        title: file.getName(),
        mimeType: MimeType.GOOGLE_DOCS
      };
      
      const doc = Drive.Files.copy(resource, file.getId(), {
        convert: true,
        ocrLanguage: 'en'
      });
      
      // Get the text content
      const docFile = DocumentApp.openById(doc.id);
      const text = docFile.getBody().getText();
      
      // Clean up
      DriveApp.getFileById(doc.id).setTrashed(true);
      file.setTrashed(true);
      
      return text;
      
    } catch (conversionError) {
      // Cleanup on error
      file.setTrashed(true);
      throw conversionError;
    }
    
  } catch (error) {
    Logger.log('PDF extraction error: ' + error.toString());
    throw new Error('Could not extract text from PDF. Try manually converting the PDF to text.');
  }
}

/**
 * Debug: Show specific order section
 */
function debugShowSpecificOrder() {
  const props = PropertiesService.getScriptProperties();
  const pdfText = props.getProperty('SQ_PDF_TEXT');
  
  if (!pdfText) {
    SpreadsheetApp.getUi().alert('No PDF uploaded');
    return;
  }
  
  // Look for order 251012-9C75
  const orderNum = '251012-9C75';
  const index = pdfText.indexOf(orderNum);
  
  if (index > -1) {
    const sample = pdfText.substring(Math.max(0, index - 200), index + 600);
    Logger.log(`\n=== Order ${orderNum} Context ===`);
    Logger.log(sample);
    Logger.log('\n=== With visible whitespace ===');
    Logger.log(sample.replace(/\n/g, '\\n').replace(/\r/g, '\\r'));
  } else {
    Logger.log(`Order ${orderNum} not found in PDF`);
  }
  
  SpreadsheetApp.getUi().alert('Debug', 'Check Extensions > Apps Script > Logs', SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Debug: Show sample of converted PDF text
 */
function debugShowPDFSample() {
  const props = PropertiesService.getScriptProperties();
  const pdfText = props.getProperty('SQ_PDF_TEXT');
  
  if (!pdfText) {
    SpreadsheetApp.getUi().alert('No PDF uploaded');
    return;
  }
  
  Logger.log('=== PDF TEXT DEBUG ===');
  Logger.log(`Total length: ${pdfText.length} characters`);
  
  // Find ALL occurrences of "Direct by TCGplayer"
  let index = 0;
  let count = 0;
  
  while ((index = pdfText.indexOf('Direct by TCGplayer', index)) !== -1 && count < 3) {
    count++;
    const sample = pdfText.substring(index, index + 400);
    Logger.log(`\n--- Sample ${count} (position ${index}) ---`);
    Logger.log(sample);
    Logger.log('--- End Sample ---\n');
    
    // Show with visible whitespace
    const escaped = sample.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    Logger.log('With visible whitespace:');
    Logger.log(escaped.substring(0, 300));
    
    index += 100;
  }
  
  Logger.log(`\n=== Found ${count} samples ===`);
  
  SpreadsheetApp.getUi().alert(
    'Debug Info Logged', 
    `Found ${count} samples of "Direct by TCGplayer" sections.\n\nCheck Extensions > Apps Script > View > Logs to see the exact format.`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * Show current PDF upload status
 */
function showPDFStatus() {
  const props = PropertiesService.getScriptProperties();
  const fileName = props.getProperty('SQ_PDF_NAME');
  const uploadDate = props.getProperty('SQ_PDF_DATE');
  const textLength = (props.getProperty('SQ_PDF_TEXT') || '').length;
  
  const ui = SpreadsheetApp.getUi();
  
  if (!fileName) {
    ui.alert('No PDF Uploaded', 'No SQ Details PDF has been uploaded yet.\\n\\nUse "Upload SQ Details PDF" to upload a file.', ui.ButtonSet.OK);
    return;
  }
  
  const date = new Date(uploadDate);
  const formattedDate = Utilities.formatDate(date, Session.getScriptTimeZone(), 'MMM dd, yyyy HH:mm:ss');
  
  ui.alert(
    'Current PDF Status',
    `File: ${fileName}\\nUploaded: ${formattedDate}\\nText Size: ${textLength.toLocaleString()} characters\\n\\nReady to process!`,
    ui.ButtonSet.OK
  );
}

/**
 * Clear stored PDF data
 */
function clearStoredPDF() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Clear Uploaded PDF',
    'Are you sure you want to clear the currently uploaded PDF?\\n\\nYou will need to upload a new PDF before processing.',
    ui.ButtonSet.YES_NO
  );
  
  if (response === ui.Button.YES) {
    PropertiesService.getScriptProperties().deleteProperty('SQ_PDF_TEXT');
    PropertiesService.getScriptProperties().deleteProperty('SQ_PDF_NAME');
    PropertiesService.getScriptProperties().deleteProperty('SQ_PDF_DATE');
    ui.alert('Cleared', 'Uploaded PDF data has been cleared.', ui.ButtonSet.OK);
  }
}

/**
 * Main processing function
 */
function processCurrentSheet() {
  try {
    Logger.log('Starting order info extraction...');
    
    // Get stored PDF text
    const pdfText = PropertiesService.getScriptProperties().getProperty('SQ_PDF_TEXT');
    
    if (!pdfText) {
      SpreadsheetApp.getUi().alert(
        'No PDF Uploaded',
        'Please upload an SQ Details PDF first using "Upload SQ Details PDF" from the Order Tools menu.',
        SpreadsheetApp.getUi().ButtonSet.OK
      );
      return;
    }
    
    const sheet = SpreadsheetApp.getActiveSheet();
    Logger.log(`Processing sheet: ${sheet.getName()}`);
    
    // Parse orders from PDF text
    const orders = parseOrders(pdfText);
    Logger.log(`Found ${orders.length} orders`);
    
    // Get all data from sheet
    const dataRange = sheet.getDataRange();
    const data = dataRange.getValues();
    
    // Skip header row
    let processedCount = 0;
    let errorCount = 0;
    let duplicatedCount = 0;
    const rowsToInsert = [];
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      
      // Skip if already filled
      if (row[COLUMNS.DIRECT_ORDER] && row[COLUMNS.BUYER_NAME]) {
        Logger.log(`Row ${i + 1}: Already filled, skipping`);
        continue;
      }
      
      const cardName = row[COLUMNS.CARD_NAME];
      const condition = row[COLUMNS.CONDITION];
      const quantity = row[COLUMNS.QUANTITY];
      
      if (!cardName) {
        Logger.log(`Row ${i + 1}: No card name, skipping`);
        continue;
      }
      
      try {
        // Find which order(s) this card belongs to
        const orderMatches = findCardInOrders(cardName, null, condition, quantity, orders, pdfText);
        
        if (orderMatches.length === 0) {
          Logger.log(`Row ${i + 1}: Could not find order for ${cardName}`);
          errorCount++;
        } else if (orderMatches.length === 1) {
          // Single match
          row[COLUMNS.DIRECT_ORDER] = orderMatches[0].orderNumber;
          row[COLUMNS.BUYER_NAME] = orderMatches[0].buyerName;
          
          Logger.log(`Row ${i + 1}: ${cardName} → ${orderMatches[0].orderNumber} (${orderMatches[0].buyerName})`);
          processedCount++;
        } else {
          // Multiple matches - duplicate row
          row[COLUMNS.DIRECT_ORDER] = orderMatches[0].orderNumber;
          row[COLUMNS.BUYER_NAME] = orderMatches[0].buyerName;
          
          Logger.log(`Row ${i + 1}: ${cardName} → ${orderMatches[0].orderNumber} (${orderMatches[0].buyerName}) [PRIMARY]`);
          
          for (let j = 1; j < orderMatches.length; j++) {
            const duplicateRow = row.slice();
            duplicateRow[COLUMNS.DIRECT_ORDER] = orderMatches[j].orderNumber;
            duplicateRow[COLUMNS.BUYER_NAME] = orderMatches[j].buyerName;
            
            rowsToInsert.push({
              afterRow: i,
              data: duplicateRow
            });
            
            Logger.log(`Row ${i + 1}: ${cardName} → ${orderMatches[j].orderNumber} (${orderMatches[j].buyerName}) [DUPLICATE ${j}]`);
            duplicatedCount++;
          }
          
          processedCount++;
        }
      } catch (error) {
        Logger.log(`Row ${i + 1}: Error processing ${cardName}: ${error.message}`);
        errorCount++;
      }
    }
    
    // Write updates back
    dataRange.setValues(data);
    
    // Insert duplicate rows if any
    if (rowsToInsert.length > 0) {
      Logger.log(`Inserting ${rowsToInsert.length} duplicate row(s)...`);
      rowsToInsert.reverse();
      
      for (const insert of rowsToInsert) {
        sheet.insertRowAfter(insert.afterRow + 1);
        const newRowIndex = insert.afterRow + 2;
        const newRange = sheet.getRange(newRowIndex, 1, 1, insert.data.length);
        newRange.setValues([insert.data]);
      }
    }
    
    // Show completion message
    const ui = SpreadsheetApp.getUi();
    let message = `✅ Processed: ${processedCount} cards\\n❌ Errors: ${errorCount} cards`;
    if (duplicatedCount > 0) {
      message += `\\n🔄 Duplicated: ${duplicatedCount} cards (found in multiple orders)`;
    }
    message += '\\n\\nCheck View > Logs for details.';
    
    ui.alert('Processing Complete', message, ui.ButtonSet.OK);
    
    Logger.log('Processing complete!');
    
  } catch (error) {
    Logger.log(`Fatal error: ${error.message}`);
    SpreadsheetApp.getUi().alert('Error', error.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

/**
 * Parse all orders from the SQ Details text
 */
function parseOrders(text) {
  const orderSectionPattern = /Order Number: (\d{6}-[A-F0-9]{4}) \| Page (\d+) of (\d+)/g;
  const orderSections = [];
  
  let match;
  while ((match = orderSectionPattern.exec(text)) !== null) {
    orderSections.push({
      orderNumber: match[1],
      pageNum: parseInt(match[2]),
      totalPages: parseInt(match[3]),
      position: match.index
    });
  }
  
  const orderGroups = {};
  
  for (const section of orderSections) {
    if (!orderGroups[section.orderNumber]) {
      orderGroups[section.orderNumber] = {
        orderNumber: section.orderNumber,
        pages: [],
        firstPagePos: Infinity,
        lastPagePos: -1
      };
    }
    
    orderGroups[section.orderNumber].pages.push(section);
    orderGroups[section.orderNumber].firstPagePos = Math.min(orderGroups[section.orderNumber].firstPagePos, section.position);
    orderGroups[section.orderNumber].lastPagePos = Math.max(orderGroups[section.orderNumber].lastPagePos, section.position);
  }
  
  // Set startPos to first page
  for (const orderNum in orderGroups) {
    orderGroups[orderNum].startPos = orderGroups[orderNum].firstPagePos;
    orderGroups[orderNum].endPos = orderGroups[orderNum].lastPagePos + 5000;
  }
  
  // Now get buyer names - simpler approach
  // For each order, look in a window after the order number for: Name followed by address
  
  for (const orderNum in orderGroups) {
    if (orderGroups[orderNum].buyerName) continue; // Already found
    
    // Find the order number in text
    const orderPos = text.indexOf(orderNum);
    if (orderPos === -1) continue;
    
    // Look in next 1000 chars for pattern: Person Name\nStreet Address
    const window = text.substring(orderPos, orderPos + 1000);
    
    // Find all person names followed by addresses in this window
    // Exclude condition names (Near Mint, Lightly Played, etc.)
    const namePattern = /([A-Z][a-z]+(?:\s+[A-Z]'?[A-Za-z]+)+)\s*\n\s*(\d+\s+[\w\s]+)/g;
    const conditionNames = ['Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];
    
    let lastMatch = null;
    let nameMatch;
    while ((nameMatch = namePattern.exec(window)) !== null) {
      const candidateName = nameMatch[1].trim();
      // Skip if it's a condition name
      if (!conditionNames.includes(candidateName)) {
        lastMatch = nameMatch;
      }
    }
    
    if (lastMatch) {
      const buyerName = lastMatch[1].trim();
      orderGroups[orderNum].buyerName = buyerName;
      Logger.log(`Found buyer: ${orderNum} -> ${buyerName}`);
    }
  }
  
  // Convert to array and sort by start position
  const orders = Object.values(orderGroups).sort((a, b) => a.startPos - b.startPos);
  
  // Calculate proper end positions
  for (let i = 0; i < orders.length; i++) {
    orders[i].endPos = (i < orders.length - 1) ? orders[i + 1].startPos : text.length;
  }
  
  // Log summary
  const ordersWithBuyers = orders.filter(o => o.buyerName).length;
  Logger.log(`Parsed ${orders.length} orders, ${ordersWithBuyers} have buyer names`);
  
  // Log orders without buyer names
  orders.forEach(order => {
    if (!order.buyerName) {
      Logger.log(`⚠️ Missing buyer name for order: ${order.orderNumber}`);
    }
  });
  
  return orders;
}

/**
 * Find which order(s) a card belongs to
 */
function findCardInOrders(cardName, setName, condition, quantity, orders, fullText) {
  const searchName = cardName.replace(/["""]/g, '"').trim();
  const occurrences = [];
  
  const cardPatterns = [
    searchName,
    searchName.replace(/"/g, '')
  ];
  
  for (const pattern of cardPatterns) {
    // Escape regex special characters FIRST, then replace spaces with \s+
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped.replace(/\s+/g, '\\s+'), 'gi');
    let match;
    
    while ((match = regex.exec(fullText)) !== null) {
      occurrences.push({
        position: match.index,
        matchText: match[0]
      });
    }
    
    if (occurrences.length > 0) break;
  }
  
  if (occurrences.length === 0) {
    Logger.log(`  No occurrences found for: ${searchName}`);
    return [];
  }
  
  Logger.log(`  Found ${occurrences.length} occurrence(s) of ${searchName}`);
  
  const matches = [];
  
  for (const occ of occurrences) {
    let foundInOrder = false;
    for (const order of orders) {
      if (occ.position >= order.startPos && occ.position < order.endPos) {
        foundInOrder = true;
        const conditionInfo = checkConditionNearCard(fullText, occ.position, condition);
        if (!conditionInfo.matches) {
          Logger.log(`    ❌ Pos ${occ.position} in ${order.orderNumber}: Condition mismatch (need ${condition}, checking for ${conditionInfo.conditionText})`);
          continue;
        }
        
        let quantityMatches = true;
        if (quantity) {
          const pdfQuantity = extractQuantityNearCard(fullText, occ.position);
          const expectedQuantity = Math.abs(quantity);
          
          if (pdfQuantity && pdfQuantity !== expectedQuantity) {
            Logger.log(`    ❌ Pos ${occ.position} in ${order.orderNumber}: Quantity mismatch (expected ${expectedQuantity}, found ${pdfQuantity})`);
            quantityMatches = false;
          }
        }
        
        if (!quantityMatches) {
          continue;
        }
        
        Logger.log(`    ✅ Pos ${occ.position}: Match in ${order.orderNumber} (${order.buyerName})`);
        matches.push({
          orderNumber: order.orderNumber,
          buyerName: order.buyerName,
          position: occ.position
        });
        break;
      }
    }
    if (!foundInOrder) {
      Logger.log(`    ⏭️  Pos ${occ.position}: Not in any order (inventory section)`);
    }
  }
  
  if (matches.length > 1) {
    Logger.log(`  WARNING: Found ${matches.length} matching orders!`);
  }
  
  return matches;
}

/**
 * Check condition near card
 */
function checkConditionNearCard(text, cardPosition, condition) {
  const windowSize = 500;
  const start = Math.max(0, cardPosition - windowSize);
  const end = Math.min(text.length, cardPosition + windowSize);
  const window = text.substring(start, end);
  
  const conditionMap = {
    'NM': 'Near Mint',
    'NMF': 'Near Mint Foil',
    'LP': 'Lightly Played',
    'LPF': 'Lightly Played Foil',
    'MP': 'Moderately Played',
    'MPF': 'Moderately Played Foil',
    'HP': 'Heavily Played',
    'HPF': 'Heavily Played Foil',
    'DMG': 'Damaged',
    'DMGF': 'Damaged Foil'
  };
  
  const conditionText = conditionMap[condition] || condition;
  
  // Normalize whitespace to handle line breaks in PDF text
  const normalizedWindow = window.replace(/\s+/g, ' ');
  const normalizedCondition = conditionText.replace(/\s+/g, ' ');
  
  const matches = normalizedWindow.includes(normalizedCondition);
  
  return {
    matches: matches,
    conditionText: conditionText
  };
}

/**
 * Extract quantity from near the card position
 */
function extractQuantityNearCard(text, cardPosition) {
  const windowSize = 200;
  const start = Math.max(0, cardPosition - windowSize);
  const window = text.substring(start, cardPosition);
  
  const qtyPattern = /\n\n(\d+)\n\n/g;
  const matches = [];
  let match;
  
  while ((match = qtyPattern.exec(window)) !== null) {
    matches.push({
      quantity: parseInt(match[1]),
      position: match.index
    });
  }
  
  if (matches.length > 0) {
    return matches[matches.length - 1].quantity;
  }
  
  return null;
}
