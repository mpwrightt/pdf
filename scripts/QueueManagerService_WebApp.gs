/**
 * CENTRALIZED QUEUE MANAGER SERVICE - WEB APP VERSION
 *
 * Deploy this script to the Discrepancy Log spreadsheet as a Web App.
 * All Helper Docs will call these functions via HTTP POST.
 *
 * DEPLOYMENT:
 * 1. Open Discrepancy Log → Extensions → Apps Script
 * 2. Paste this entire script
 * 3. Click Deploy → New deployment → Web app
 * 4. Execute as: Me
 * 5. Who has access: Anyone (or "Anyone with Google account")
 * 6. Deploy and copy the Web App URL
 * 7. Paste that URL into each Helper Doc's QUEUE_SERVICE_URL constant
 */

// Configuration
const QUEUE_CONFIG = {
  DISCREP_LOG_ID: '1m0dSOA2VogToEpAo6Jj7FEEsfJbWi1W48xiyTHkBNyY',
  REFUND_LOG_ID: '1raaUEsPoMl5dEZwilnHtBwdR0wOV2JRqYzdlVYMdohI',
  DISCREP_SHEET_NAME: 'SQ Discrepancy Log', // The tab with SQ data
  DISCREP_QUEUE_SHEET_NAME: 'BOTS',
  REFUND_QUEUE_SHEET_NAME: 'BOTS',
  STALE_LOCK_TIMEOUT_MS: 120000, // 2 minutes
  MAX_LOCK_WAIT_MS: 30000, // 30 seconds

  // Helper Doc Sheet IDs (one per bot)
  HELPER_DOCS: {
    'BOT1': '1VcpaoXllWGTB3APt9Gjhi4-D_1XUH4qldWiZYQlYoH0',
    'BOT2': '1dsEzEIm2GXtAPbqBYtwFYDFnE0PbgaaoAUAOXghIyeI',
    'BOT3': '1RZm3lPGjRxiPqnLSpL0PFOhFGWcCL6zjQ1V8UjUUB4I'
  },
  HELPER_SHEET_NAME: 'Paste Here', // The tab name in Helper Docs

  // Vercel API for PDF processing
  VERCEL_API_URL: 'https://pdf-nine-psi.vercel.app/api/parse',

  // Convex API for queue coordination and real-time sync
  // Note: HTTP routes use .convex.site, not .convex.cloud
  CONVEX_URL: 'https://energized-spoonbill-94.convex.site',

  // Helper Doc column indices (0-based array indices)
  HELPER_COLS: {
    ORDER_NUMBER: 7,   // Column H (index 7)
    BUYER_NAME: 8,     // Column I (index 8)
    SQ_NUMBER: 9,      // Column J (index 9)
    GAME: 10,          // Column K (index 10)
    CARD_NAME: 11,     // Column L (index 11)
    COLLECTOR_NUM: 12, // Column M (index 12)
    RARITY: 13,        // Column N (index 13)
    SET_NAME: 14,      // Column O (index 14)
    CONDITION: 15,     // Column P (index 15)
    QTY: 16            // Column Q (index 16)
  },

  // API Key for server-side authentication (change this to a random string)
  API_KEY: 'bot-manager-secret-key-change-this-12345'
};

/**
 * Serve the HTML UI for the Bot Manager Web App
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('BotManagerUI')
    .setTitle('Bot Manager')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Handle HTTP OPTIONS requests (CORS preflight)
 */
function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type')
    .setHeader('Access-Control-Max-Age', '3600');
}

/**
 * Handle HTTP POST requests from Helper Docs and Web UI
 */
function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);

    // Validate API Key (made optional - eBay auth is primary security)
    const apiKey = params.apiKey;
    if (apiKey && apiKey !== QUEUE_CONFIG.API_KEY) {
      // Only reject if key is provided but wrong
      Logger.log('⚠️ Unauthorized request - invalid API key');
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: 'Unauthorized - Invalid API key'
      }))
        .setMimeType(ContentService.MimeType.JSON)
        .setHeader('Access-Control-Allow-Origin', '*');
    }
    // If no key provided, rely on eBay authentication from deployment settings

    const action = params.action;
    const botId = params.botId;
    const sqNumber = params.sqNumber;
    const rowCount = params.rowCount;

    Logger.log(`[QUEUE SERVICE] Received ${action} from ${botId} for SQ ${sqNumber}`);

    let result;

    switch (action) {
      case 'tryClaimSQ':
        result = tryClaimSQ(botId, sqNumber);
        break;

      case 'markSQCompleted':
        result = markSQCompleted(botId, sqNumber);
        break;

      case 'reserveRefundLogRows':
        result = reserveRefundLogRows(botId, sqNumber, rowCount);
        break;

      case 'releaseRefundLogReservation':
        result = releaseRefundLogReservation(botId, sqNumber);
        break;

      case 'getActiveClaims':
        result = {success: true, claims: getActiveClaims()};
        break;

      case 'cleanupStaleClaims':
        const removed = cleanupStaleClaims();
        result = {success: true, removed: removed};
        break;

      case 'pullNextSQ':
        result = pullNextSQ(botId);
        break;

      case 'uploadToRefundLog':
        result = uploadToRefundLog(params.sqData, params.manualData);
        break;

      case 'syncManualDataToHelper':
        result = syncManualDataToHelper(botId, sqNumber, params.manualData);
        break;

      case 'processPDFUpload':
        result = processPDFUpload(botId, sqNumber, params.base64Data, params.fileName);
        break;

      default:
        result = {success: false, message: 'Unknown action: ' + action};
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*');

  } catch (e) {
    Logger.log('ERROR in doPost: ' + e);
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: 'Server error: ' + e.message
    }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*');
  }
}

/**
 * Acquire script lock (bulletproof within same project)
 */
function acquireLock(timeoutMs) {
  const lock = LockService.getScriptLock();
  try {
    const success = lock.tryLock(timeoutMs);
    if (!success) {
      Logger.log('⚠️ Failed to acquire script lock after ' + timeoutMs + 'ms');
      return null;
    }
    return lock;
  } catch (e) {
    Logger.log('ERROR acquiring lock: ' + e);
    return null;
  }
}

/**
 * Try to claim an SQ from the Discrepancy Log queue
 */
function tryClaimSQ(botId, sqNumber) {
  const lock = acquireLock(QUEUE_CONFIG.MAX_LOCK_WAIT_MS);
  if (!lock) {
    return {success: false, message: 'Failed to acquire lock', row: null};
  }

  try {
    const ss = SpreadsheetApp.openById(QUEUE_CONFIG.DISCREP_LOG_ID);
    const queueSheet = ss.getSheetByName(QUEUE_CONFIG.DISCREP_QUEUE_SHEET_NAME);

    if (!queueSheet) {
      return {success: false, message: 'BOTS sheet not found', row: null};
    }

    const timestamp = new Date();

    // Check if SQ is already claimed
    const data = queueSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const queueBotId = row[0];
      const queueSQ = row[1];
      const queueStatus = row[2];
      const queueTimestamp = row[3];

      if (queueSQ === sqNumber) {
        const age = timestamp - new Date(queueTimestamp);

        // If claimed recently (not stale), reject
        if (queueStatus === 'CLAIMING' && age < QUEUE_CONFIG.STALE_LOCK_TIMEOUT_MS) {
          return {
            success: false,
            message: 'SQ already claimed by ' + queueBotId,
            row: null
          };
        }

        // If stale, we can reclaim it - delete the old row
        if (queueStatus === 'CLAIMING' && age >= QUEUE_CONFIG.STALE_LOCK_TIMEOUT_MS) {
          Logger.log('Removing stale claim from ' + queueBotId + ' (age: ' + Math.floor(age/1000) + 's)');
          queueSheet.deleteRow(i + 1);
          break; // Re-check after deletion
        }
      }
    }

    // Write new claim
    const nextRow = queueSheet.getLastRow() + 1;
    queueSheet.getRange(nextRow, 1, 1, 4).setValues([[
      botId,
      sqNumber,
      'CLAIMING',
      timestamp
    ]]);

    // Force flush to ensure write is committed
    SpreadsheetApp.flush();

    // Verify write succeeded
    const verify = queueSheet.getRange(nextRow, 1, 1, 2).getValues();
    if (verify[0][0] !== botId || verify[0][1] !== sqNumber) {
      return {
        success: false,
        message: 'Write verification failed - data corrupted',
        row: null
      };
    }

    Logger.log('[' + botId + '] Successfully claimed SQ ' + sqNumber + ' at row ' + nextRow);
    return {success: true, message: 'Claimed successfully', row: nextRow};

  } catch (e) {
    Logger.log('ERROR in tryClaimSQ: ' + e);
    return {success: false, message: 'Exception: ' + e.message, row: null};
  } finally {
    lock.releaseLock();
  }
}

/**
 * Mark an SQ as completed in the queue
 */
function markSQCompleted(botId, sqNumber) {
  const lock = acquireLock(QUEUE_CONFIG.MAX_LOCK_WAIT_MS);
  if (!lock) {
    return {success: false, message: 'Failed to acquire lock'};
  }

  try {
    const ss = SpreadsheetApp.openById(QUEUE_CONFIG.DISCREP_LOG_ID);
    const queueSheet = ss.getSheetByName(QUEUE_CONFIG.DISCREP_QUEUE_SHEET_NAME);

    if (!queueSheet) {
      return {success: false, message: 'BOTS sheet not found'};
    }

    const data = queueSheet.getDataRange().getValues();

    // Find the bot's claim for this SQ
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[0] === botId && row[1] === sqNumber) {
        queueSheet.getRange(i + 1, 3).setValue('COMPLETED');
        SpreadsheetApp.flush();
        Logger.log('[' + botId + '] Marked SQ ' + sqNumber + ' as COMPLETED');
        return {success: true, message: 'Marked as completed'};
      }
    }

    return {success: false, message: 'No claim found for this bot/SQ'};

  } catch (e) {
    Logger.log('ERROR in markSQCompleted: ' + e);
    return {success: false, message: 'Exception: ' + e.message};
  } finally {
    lock.releaseLock();
  }
}

/**
 * Reserve rows in the Refund Log for writing
 */
function reserveRefundLogRows(botId, sqNumber, rowCount) {
  const lock = acquireLock(QUEUE_CONFIG.MAX_LOCK_WAIT_MS);
  if (!lock) {
    return {success: false, message: 'Failed to acquire lock', startRow: null};
  }

  try {
    const refundLog = SpreadsheetApp.openById(QUEUE_CONFIG.REFUND_LOG_ID);
    const refundSheet = refundLog.getSheetByName('Refund Log');
    const queueSheet = refundLog.getSheetByName(QUEUE_CONFIG.REFUND_QUEUE_SHEET_NAME);

    if (!queueSheet) {
      return {success: false, message: 'BOTS sheet not found in Refund Log', startRow: null};
    }

    const timestamp = new Date();

    // Atomically get next available row
    const currentLastRow = refundSheet.getLastRow();
    const assignedRow = currentLastRow + 1;

    // Write reservation to queue
    const queueNextRow = queueSheet.getLastRow() + 1;
    queueSheet.getRange(queueNextRow, 1, 1, 5).setValues([[
      botId,
      sqNumber,
      assignedRow,
      rowCount,
      timestamp
    ]]);

    SpreadsheetApp.flush();

    Logger.log('[' + botId + '] Reserved Refund Log rows ' + assignedRow + '-' + (assignedRow + rowCount - 1));
    return {success: true, message: 'Rows reserved', startRow: assignedRow};

  } catch (e) {
    Logger.log('ERROR in reserveRefundLogRows: ' + e);
    return {success: false, message: 'Exception: ' + e.message, startRow: null};
  } finally {
    lock.releaseLock();
  }
}

/**
 * Release a Refund Log reservation
 */
function releaseRefundLogReservation(botId, sqNumber) {
  const lock = acquireLock(QUEUE_CONFIG.MAX_LOCK_WAIT_MS);
  if (!lock) {
    return {success: false, message: 'Failed to acquire lock'};
  }

  try {
    const refundLog = SpreadsheetApp.openById(QUEUE_CONFIG.REFUND_LOG_ID);
    const queueSheet = refundLog.getSheetByName(QUEUE_CONFIG.REFUND_QUEUE_SHEET_NAME);

    if (!queueSheet) {
      return {success: false, message: 'BOTS sheet not found in Refund Log'};
    }

    const data = queueSheet.getDataRange().getValues();

    // Find and delete reservation
    for (let i = data.length - 1; i >= 1; i--) {
      const row = data[i];
      if (row[0] === botId && row[1] === sqNumber) {
        queueSheet.deleteRow(i + 1);
        SpreadsheetApp.flush();
        Logger.log('[' + botId + '] Released Refund Log reservation for SQ ' + sqNumber);
        return {success: true, message: 'Reservation released'};
      }
    }

    return {success: false, message: 'No reservation found'};

  } catch (e) {
    Logger.log('ERROR in releaseRefundLogReservation: ' + e);
    return {success: false, message: 'Exception: ' + e.message};
  } finally {
    lock.releaseLock();
  }
}

/**
 * Get list of all active claims (for monitoring/debugging)
 */
function getActiveClaims() {
  const lock = acquireLock(QUEUE_CONFIG.MAX_LOCK_WAIT_MS);
  if (!lock) {
    return [];
  }

  try {
    const ss = SpreadsheetApp.openById(QUEUE_CONFIG.DISCREP_LOG_ID);
    const queueSheet = ss.getSheetByName(QUEUE_CONFIG.DISCREP_QUEUE_SHEET_NAME);

    if (!queueSheet) return [];

    const data = queueSheet.getDataRange().getValues();
    const claims = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[0]) { // Has bot ID
        claims.push({
          botId: row[0],
          sqNumber: row[1],
          status: row[2],
          timestamp: row[3]
        });
      }
    }

    return claims;

  } catch (e) {
    Logger.log('ERROR in getActiveClaims: ' + e);
    return [];
  } finally {
    lock.releaseLock();
  }
}

/**
 * Clean up stale claims (optional maintenance function)
 */
function cleanupStaleClaims() {
  const lock = acquireLock(QUEUE_CONFIG.MAX_LOCK_WAIT_MS);
  if (!lock) {
    return 0;
  }

  try {
    const ss = SpreadsheetApp.openById(QUEUE_CONFIG.DISCREP_LOG_ID);
    const queueSheet = ss.getSheetByName(QUEUE_CONFIG.DISCREP_QUEUE_SHEET_NAME);

    if (!queueSheet) return 0;

    const data = queueSheet.getDataRange().getValues();
    const now = new Date();
    let removed = 0;

    // Iterate backwards to safely delete rows
    for (let i = data.length - 1; i >= 1; i--) {
      const row = data[i];
      const status = row[2];
      const timestamp = row[3];

      if (status === 'CLAIMING' && timestamp) {
        const age = now - new Date(timestamp);
        if (age > QUEUE_CONFIG.STALE_LOCK_TIMEOUT_MS) {
          Logger.log('Removing stale claim: ' + row[0] + ' / ' + row[1] + ' (age: ' + Math.floor(age/1000) + 's)');
          queueSheet.deleteRow(i + 1);
          removed++;
        }
      }
    }

    SpreadsheetApp.flush();
    Logger.log('Cleanup complete: removed ' + removed + ' stale claims');
    return removed;

  } catch (e) {
    Logger.log('ERROR in cleanupStaleClaims: ' + e);
    return 0;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Try to reserve an SQ in the Convex queue (prevents race conditions)
 */
function tryReserveSQ(botId, sqNumber) {
  const payload = {
    botId: botId,
    sqNumber: sqNumber
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    Logger.log('[' + botId + '] Attempting to claim SQ ' + sqNumber + ' via Convex queue...');
    const response = UrlFetchApp.fetch(QUEUE_CONFIG.CONVEX_URL + '/bot-manager/try-claim-sq', options);
    const result = JSON.parse(response.getContentText());

    if (result.success) {
      Logger.log('[' + botId + '] ✓ Reserved SQ ' + sqNumber + ' via Convex queue');

      // Also write to BOTS sheet for visibility
      try {
        const ss = SpreadsheetApp.openById(QUEUE_CONFIG.DISCREP_LOG_ID);
        const queueSheet = ss.getSheetByName(QUEUE_CONFIG.DISCREP_QUEUE_SHEET_NAME);
        if (queueSheet) {
          const nextRow = queueSheet.getLastRow() + 1;
          queueSheet.getRange(nextRow, 1, 1, 4).setValues([[
            botId,
            sqNumber,
            'CLAIMING',
            new Date()
          ]]);
          SpreadsheetApp.flush();
        }
      } catch (e) {
        Logger.log('[' + botId + '] Warning: Could not write to BOTS sheet: ' + e);
      }

      return true;
    } else {
      Logger.log('[' + botId + '] ⚠️ Could not claim SQ ' + sqNumber + ': ' + result.message);
      return false;
    }
  } catch (e) {
    Logger.log('[' + botId + '] ERROR calling Convex queue: ' + e);
    return false;
  }
}

/**
 * Release an SQ reservation in the Convex queue
 */
function releaseSQ(botId, sqNumber) {
  const payload = {
    botId: botId,
    sqNumber: sqNumber
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(QUEUE_CONFIG.CONVEX_URL + '/bot-manager/release-sq', options);
    const result = JSON.parse(response.getContentText());

    if (result.success) {
      Logger.log('[' + botId + '] ✓ Released SQ ' + sqNumber + ' from Convex queue');

      // Also update BOTS sheet for visibility
      try {
        const ss = SpreadsheetApp.openById(QUEUE_CONFIG.DISCREP_LOG_ID);
        const queueSheet = ss.getSheetByName(QUEUE_CONFIG.DISCREP_QUEUE_SHEET_NAME);
        if (queueSheet) {
          const data = queueSheet.getDataRange().getValues();
          for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (row[0] === botId && row[1] === sqNumber) {
              queueSheet.getRange(i + 1, 3).setValue('COMPLETED');
              SpreadsheetApp.flush();
              break;
            }
          }
        }
      } catch (e) {
        Logger.log('[' + botId + '] Warning: Could not update BOTS sheet: ' + e);
      }

      return true;
    } else {
      Logger.log('[' + botId + '] ⚠️ Could not release SQ ' + sqNumber + ': ' + result.message);
      return false;
    }
  } catch (e) {
    Logger.log('[' + botId + '] Warning: Could not release SQ ' + sqNumber + ': ' + e);
    return false;
  }
}

/**
 * Pull next unclaimed SQ from Discrep Log
 * Returns SQ data and marks it as claimed by the bot
 */
function pullNextSQ(botId) {
  const lock = acquireLock(QUEUE_CONFIG.MAX_LOCK_WAIT_MS);
  if (!lock) {
    return {success: false, message: 'Failed to acquire lock', sqData: null};
  }

  try {
    const ss = SpreadsheetApp.openById(QUEUE_CONFIG.DISCREP_LOG_ID);
    const discrepSheet = ss.getSheetByName(QUEUE_CONFIG.DISCREP_SHEET_NAME);

    if (!discrepSheet) {
      return {success: false, message: 'Sheet "' + QUEUE_CONFIG.DISCREP_SHEET_NAME + '" not found', sqData: null};
    }

    const data = discrepSheet.getDataRange().getValues();

    // Column indices matching HelperDocAutomation.gs DISCREP_COLS
    const COL_SQ_NUMBER = 2;      // Column C
    const COL_GAME = 3;           // Column D
    const COL_CARD_NAME = 4;      // Column E
    const COL_COLLECTOR_NUM = 5;  // Column F
    const COL_RARITY = 6;         // Column G
    const COL_SET_NAME = 7;       // Column H
    const COL_CONDITION = 8;      // Column I
    const COL_QTY = 9;            // Column J
    const COL_LOCATION_ID = 10;   // Column K (LocationID - skip if "NONE")
    const COL_INITIALS = 14;      // Column O (Inv. Initials - for claiming)
    const COL_RESOLUTION_TYPE = 15; // Column P (Resolution Type - "Missing Note")
    const COL_SOLVE_DATE = 17;    // Column R (Solve Date)
    const COL_MANUAL_INTERVENTION = 18; // Column S (if has value, skip - needs manual intervention)

    // Note: Order Number and Buyer Name come from Helper Doc, not Discrep Log

    // Step 1: Find all unclaimed items matching skip criteria
    const unclaimedItems = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const initials = row[COL_INITIALS];
      const solveDate = row[COL_SOLVE_DATE];
      const manualIntervention = row[COL_MANUAL_INTERVENTION];
      const locationId = row[COL_LOCATION_ID];
      const sqNumber = row[COL_SQ_NUMBER];

      // Skip if SQ number is empty
      if (!sqNumber) continue;

      // Skip if already has initials (claimed)
      if (initials) continue;

      // Skip if already has solve date (already solved)
      if (solveDate) continue;

      // Skip if has manual intervention flag (in vault)
      if (manualIntervention) continue;

      // Skip if location ID is "NONE"
      if (locationId && locationId.toString().toUpperCase() === 'NONE') continue;

      // This row is unclaimed
      unclaimedItems.push({
        rowIndex: i + 1, // 1-based for sheet access
        sqNumber: sqNumber,
        game: row[COL_GAME] || 'Magic: The Gathering',
        cardName: row[COL_CARD_NAME] || '',
        collectorNum: row[COL_COLLECTOR_NUM] || '',
        rarity: row[COL_RARITY] || '',
        setName: row[COL_SET_NAME] || '',
        condition: row[COL_CONDITION] || '',
        qty: row[COL_QTY] || 1
      });
    }

    if (unclaimedItems.length === 0) {
      return {success: false, message: 'No unclaimed SQs available', sqData: null};
    }

    // Step 2: Find first SQ that is FULLY unclaimed (all rows for that SQ have no issues)
    const uniqueSQs = [...new Set(unclaimedItems.map(item => item.sqNumber))];

    // RETRY LOOP: Keep trying SQs until we successfully claim one via Convex queue
    for (const sqNumber of uniqueSQs) {
      const itemsForSQ = unclaimedItems.filter(item => item.sqNumber === sqNumber);

      Logger.log('[' + botId + '] Found fully unclaimed SQ: ' + sqNumber + ' (' + itemsForSQ.length + ' rows) - attempting Convex queue reservation...');

      // Try to reserve this SQ in Convex queue (prevents race conditions)
      if (!tryReserveSQ(botId, sqNumber)) {
        Logger.log('[' + botId + '] ⚠️ Failed to reserve SQ ' + sqNumber + ' in queue - trying next SQ...');
        continue; // Another bot reserved it first - try next SQ
      }

      Logger.log('[' + botId + '] ✓ Convex reserved SQ ' + sqNumber + ' - claiming rows in Discrepancy Log...');

      // Claim ALL rows for this SQ (Convex already reserved it for us)
      const now = new Date();

      try {
        Logger.log('[' + botId + '] Claiming ' + itemsForSQ.length + ' rows for SQ ' + sqNumber);

        for (const item of itemsForSQ) {
          discrepSheet.getRange(item.rowIndex, COL_INITIALS + 1).setValue(botId);
          discrepSheet.getRange(item.rowIndex, COL_RESOLUTION_TYPE + 1).setValue('Missing Note');
          discrepSheet.getRange(item.rowIndex, COL_SOLVE_DATE + 1).setValue(now);
        }

        SpreadsheetApp.flush();

        Logger.log('[' + botId + '] ✓ Claimed ' + itemsForSQ.length + ' rows for SQ ' + sqNumber);

        // Prepare SQ data to return (use first item as representative)
        const firstItem = itemsForSQ[0];
        const sqData = {
          sqNumber: sqNumber,
          orderNumber: '', // Will be filled from Helper Doc
          buyerName: '', // Will be filled from Helper Doc
          game: firstItem.game,
          cardName: firstItem.cardName,
          collectorNum: firstItem.collectorNum,
          rarity: firstItem.rarity,
          setName: firstItem.setName,
          condition: firstItem.condition,
          qty: firstItem.qty,
          sqLink: '', // Will be extracted from Helper Doc cell G3
          rowIndex: firstItem.rowIndex,
          totalRows: itemsForSQ.length
        };

        // Write ALL rows to Helper Doc and check for missing data
        const helperDocId = QUEUE_CONFIG.HELPER_DOCS[botId];
        const missingFields = [];

        if (helperDocId) {
          try {
            const helperDoc = SpreadsheetApp.openById(helperDocId);
            const helperSheet = helperDoc.getSheetByName(QUEUE_CONFIG.HELPER_SHEET_NAME);

            if (helperSheet) {
              // Clear existing data (keep header rows 1-2)
              const lastRow = helperSheet.getLastRow();
              if (lastRow > 2) {
                helperSheet.getRange(3, 1, lastRow - 2, helperSheet.getLastColumn()).clearContent();
              }

              // Write ALL items for this SQ to Helper Doc
              // Columns: J=SQ Number, K=Game, L=Card Name, M=Collector#, N=Rarity, O=Set, P=Condition, Q=Qty
              const rowsData = itemsForSQ.map(item => [
                item.sqNumber,     // Column J
                item.game,         // Column K
                item.cardName,     // Column L
                item.collectorNum, // Column M
                item.rarity,       // Column N
                item.setName,      // Column O
                item.condition,    // Column P
                item.qty           // Column Q
              ]);

              // Write to columns J-Q (getRange uses 1-based: J=10)
              helperSheet.getRange(3, 10, rowsData.length, rowsData[0].length).setValues(rowsData);
              SpreadsheetApp.flush();

              Logger.log('[' + botId + '] Wrote ' + itemsForSQ.length + ' rows to Helper Doc');

              // Wait for formulas to load (especially SQ link in G3)
              Utilities.sleep(2000);

              // Get SQ link from cell G3 (column 7)
              const sqLinkCell = helperSheet.getRange(3, 7); // Column G
              let sqLink = null;

              // Try to get URL from rich text value
              try {
                const richTextValue = sqLinkCell.getRichTextValue();
                if (richTextValue) {
                  const url = richTextValue.getLinkUrl();
                  if (url) {
                    sqLink = url;
                    Logger.log('[' + botId + '] Found SQ link from rich text: ' + sqLink);
                  }
                }
              } catch (e) {
                Logger.log('[' + botId + '] Could not get rich text URL: ' + e);
              }

              // Fallback - check if cell value is a direct URL
              if (!sqLink) {
                const cellValue = sqLinkCell.getValue();
                if (cellValue && typeof cellValue === 'string' && cellValue.toString().startsWith('http')) {
                  sqLink = cellValue.toString();
                  Logger.log('[' + botId + '] Found SQ link from cell value: ' + sqLink);
                }
              }

              // Update sqData with SQ link
              if (sqLink) {
                sqData.sqLink = sqLink;
              }

              // Now check for Order Number and Buyer Name (columns H and I) in first row
              // getRange uses 1-based column numbers: H=8, I=9
              const helperOrderNum = helperSheet.getRange(3, 8).getValue(); // Column H
              const helperBuyerName = helperSheet.getRange(3, 9).getValue(); // Column I

              if (!helperOrderNum) missingFields.push('orderNumber');
              if (!helperBuyerName) missingFields.push('buyerName');

              // Update sqData with Helper Doc data if available
              if (helperOrderNum) sqData.orderNumber = helperOrderNum;
              if (helperBuyerName) sqData.buyerName = helperBuyerName;
            }
          } catch (helperError) {
            Logger.log('Warning: Could not access Helper Doc for ' + botId + ': ' + helperError);
          }
        }

        sqData.missingFields = missingFields;

        // Success! Release queue reservation
        releaseSQ(botId, sqNumber);

        Logger.log('[' + botId + '] 🎉 Successfully claimed SQ ' + sqNumber + ' (' + itemsForSQ.length + ' rows)' + (missingFields.length > 0 ? ' - Missing: ' + missingFields.join(', ') : ' - Complete'));
        return {success: true, message: 'SQ claimed successfully', sqData: sqData};

      } catch (claimError) {
        Logger.log('[' + botId + '] ERROR: Failed to claim SQ ' + sqNumber + ': ' + claimError);
        // Release queue reservation before trying next SQ
        releaseSQ(botId, sqNumber);
        // Try next SQ
        continue;
      }
    }

    return {success: false, message: 'No unclaimed SQs available', sqData: null};

  } catch (e) {
    Logger.log('ERROR in pullNextSQ: ' + e);
    return {success: false, message: 'Exception: ' + e.message, sqData: null};
  } finally {
    lock.releaseLock();
  }
}

/**
 * Upload SQ data to Refund Log
 * Combines sqData with any manually entered data
 */
function uploadToRefundLog(sqData, manualData) {
  const lock = acquireLock(QUEUE_CONFIG.MAX_LOCK_WAIT_MS);
  if (!lock) {
    return {success: false, message: 'Failed to acquire lock', row: null};
  }

  try {
    const refundLog = SpreadsheetApp.openById(QUEUE_CONFIG.REFUND_LOG_ID);
    const refundSheet = refundLog.getSheetByName('Refund Log');

    if (!refundSheet) {
      return {success: false, message: 'Refund Log sheet not found', row: null};
    }

    // Get next available row
    const nextRow = refundSheet.getLastRow() + 1;

    // Merge sqData with manualData (manualData takes precedence)
    const finalData = Object.assign({}, sqData, manualData);

    // Prepare row data matching HelperDocAutomation.gs REFUND_COLS
    // Column A: Date, Column B: empty/formula, then C-L for data
    const rowData = [
      new Date(), // Column A (Date)
      '', // Column B (order link or formula)
      finalData.orderNumber || '', // Column C
      finalData.buyerName || '', // Column D
      finalData.sqNumber || '', // Column E
      finalData.game || 'Magic: The Gathering', // Column F
      finalData.cardName || '', // Column G
      finalData.collectorNum || '', // Column H
      finalData.rarity || '', // Column I
      finalData.setName || '', // Column J
      finalData.condition || '', // Column K
      finalData.qty || 1 // Column L
    ];

    // Write to Refund Log
    refundSheet.getRange(nextRow, 1, 1, rowData.length).setValues([rowData]);
    // Format date column
    refundSheet.getRange(nextRow, 1).setNumberFormat('m/d/yyyy');
    SpreadsheetApp.flush();

    // Sync completion to Convex for real-time dashboard
    // Note: We don't have botId here, so we'll need to pass it from the frontend
    // For now, just log the upload
    Logger.log('Uploaded SQ ' + finalData.sqNumber + ' to Refund Log at row ' + nextRow);
    return {success: true, message: 'Uploaded to Refund Log', row: nextRow};

  } catch (e) {
    Logger.log('ERROR in uploadToRefundLog: ' + e);
    return {success: false, message: 'Exception: ' + e.message, row: null};
  } finally {
    lock.releaseLock();
  }
}

/**
 * Sync manual data to Helper Doc
 * Updates the Helper Doc sheet with manually entered order/buyer info
 */
function syncManualDataToHelper(botId, sqNumber, manualData) {
  const lock = acquireLock(QUEUE_CONFIG.MAX_LOCK_WAIT_MS);
  if (!lock) {
    return {success: false, message: 'Failed to acquire lock'};
  }

  try {
    const helperDocId = QUEUE_CONFIG.HELPER_DOCS[botId];

    if (!helperDocId) {
      return {success: false, message: 'Helper Doc not configured for ' + botId};
    }

    const helperDoc = SpreadsheetApp.openById(helperDocId);
    const helperSheet = helperDoc.getSheetByName(QUEUE_CONFIG.HELPER_SHEET_NAME);

    if (!helperSheet) {
      return {success: false, message: 'Helper sheet "' + QUEUE_CONFIG.HELPER_SHEET_NAME + '" not found'};
    }

    const data = helperSheet.getDataRange().getValues();

    // Find row with matching SQ number
    // Helper Doc columns: ORDER_NUMBER=H (col 8), BUYER_NAME=I (col 9), SQ_NUMBER=J (col 10)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowSQ = row[8]; // SQ Number in column J (index 8)

      if (rowSQ === sqNumber) {
        // Update Order Number (column H) and Buyer Name (column I) if provided
        // getRange uses 1-based column numbers: H=8, I=9
        if (manualData.orderNumber) {
          helperSheet.getRange(i + 1, 8).setValue(manualData.orderNumber); // Column H
        }
        if (manualData.buyerName) {
          helperSheet.getRange(i + 1, 9).setValue(manualData.buyerName); // Column I
        }

        SpreadsheetApp.flush();
        Logger.log('[' + botId + '] Synced manual data for SQ ' + sqNumber);
        return {success: true, message: 'Manual data synced to Helper Doc'};
      }
    }

    return {success: false, message: 'SQ ' + sqNumber + ' not found in Helper Doc'};

  } catch (e) {
    Logger.log('ERROR in syncManualDataToHelper: ' + e);
    return {success: false, message: 'Exception: ' + e.message};
  } finally {
    lock.releaseLock();
  }
}

/**
 * Process PDF upload to extract Order Number and Buyer Name
 */
function processPDFUpload(botId, sqNumber, base64Data, fileName) {
  const lock = acquireLock(QUEUE_CONFIG.MAX_LOCK_WAIT_MS);
  if (!lock) {
    return {success: false, message: 'Failed to acquire lock'};
  }

  try {
    Logger.log('[' + botId + '] Processing PDF upload: ' + fileName + ' for SQ ' + sqNumber);
    Logger.log('PDF size: ' + base64Data.length + ' bytes (base64)');

    // Convert base64 to blob
    const data = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(data, 'application/pdf', fileName);
    Logger.log('Blob created: ' + blob.getBytes().length + ' bytes');

    // Call Vercel API to parse PDF
    const parsedOrders = callVercelAPI(blob);

    if (!parsedOrders || parsedOrders.length === 0) {
      return {success: false, message: 'No orders found in PDF'};
    }

    Logger.log('Found ' + parsedOrders.length + ' orders in PDF');

    // Fill in Order Number and Buyer Name in Helper Doc
    const result = fillOrderInfo(botId, sqNumber, parsedOrders);

    if (!result.success) {
      return result;
    }

    // Return success with updated order/buyer info
    return {
      success: true,
      message: 'PDF processed successfully! ' + result.matchCount + ' items matched.',
      orderNumber: result.orderNumber,
      buyerName: result.buyerName,
      matchCount: result.matchCount
    };

  } catch (e) {
    Logger.log('ERROR in processPDFUpload: ' + e);
    return {success: false, message: 'Failed to process PDF: ' + e.message};
  } finally {
    lock.releaseLock();
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
      Logger.log('Calling Vercel API (attempt ' + attempt + '/' + maxAttempts + '): ' + QUEUE_CONFIG.VERCEL_API_URL);
      const response = UrlFetchApp.fetch(QUEUE_CONFIG.VERCEL_API_URL, options);
      const statusCode = response.getResponseCode();
      const responseText = response.getContentText();
      Logger.log('API Response Status: ' + statusCode);
      Logger.log('API Response (first 500 chars): ' + responseText.substring(0, 500));

      if (statusCode !== 200) {
        lastErrText = 'HTTP ' + statusCode + ': ' + responseText.substring(0, 200);
        if (attempt < maxAttempts) {
          Utilities.sleep(500 * Math.pow(2, attempt - 1));
          continue;
        }
        throw new Error('API returned status ' + statusCode + ': ' + responseText.substring(0, 200));
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

      Logger.log('Found ' + responseData.orders.length + ' orders in PDF');
      if (responseData.orders.length > 0) {
        Logger.log('First order: ' + responseData.orders[0].orderNumber + ', ' + responseData.orders[0].cards.length + ' cards');
      }
      return responseData.orders;
    } catch (err) {
      lastErrText = String(err && err.message ? err.message : err);
      // transient network/model issues like 'unavailable: unexpected EOF'
      if (attempt < maxAttempts && /unavailable|eof|timeout|timed out|rate limit/i.test(lastErrText)) {
        Logger.log('Transient error calling API (attempt ' + attempt + '): ' + lastErrText + '. Retrying...');
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
 * Normalize collector number for matching
 */
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
    const parts = s.split('/');
    return parseInt(parts[0], 10) + '/' + parseInt(parts[1], 10);
  }
  // YGO-style codes: e.g., DOOD-EN 085 vs DOOD-EN 85 -> unify by removing space and zero-padding to 3
  const ygo = s.match(/^([A-Z0-9]+-[A-Z0-9]+)\s*(\d+)$/);
  if (ygo) {
    const prefix = ygo[1];
    const digits = ygo[2].padStart(3, '0');
    return prefix + digits;
  }
  return s; // alphanumerics like SWSH286 remain uppercased
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

function normalizeSetName(setName) {
  return (setName || '')
    .toLowerCase()
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[():]/g, ' ')
    .replace(/\b(holofoil)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripParentheticals(name) {
  return (name || '').replace(/\s*\([^\)]*\)/g, '').trim();
}

function normalizeNameLoose(name) {
  const noParens = stripParentheticals(name);
  return noParens
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[\-–—]/g, ' ')
    .replace(/[^a-zA-Z0-9\s,]/g, '')
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
          csvCondition: normalizedCondition
        };
      }

      // Capture collector-number-based fallback when collector matches; prefer if name OR set matches
      const pdfCollector = normalizeCollector(card.collectorNumber);
      if (!collectorCandidate && normalizedCollector && pdfCollector && normalizedCollector === pdfCollector && (matchesSet || matchesName)) {
        collectorCandidate = {
          orderNumber: order.orderNumber,
          buyerName: order.buyerName
        };
      }
    }
  }

  if (weakCandidate) {
    Logger.log('  INFO: Using fallback match (condition differs): PDF=' + weakCandidate.pdfCondition + ', CSV=' + weakCandidate.csvCondition);
    return { orderNumber: weakCandidate.orderNumber, buyerName: weakCandidate.buyerName };
  }

  if (collectorCandidate) {
    Logger.log('  INFO: Using collector# fallback');
    return { orderNumber: collectorCandidate.orderNumber, buyerName: collectorCandidate.buyerName };
  }

  return null;
}

/**
 * Fill in Order Number and Buyer Name from parsed orders
 * Matches cards in Helper Doc with cards in PDF
 */
function fillOrderInfo(botId, sqNumber, parsedOrders) {
  try {
    const helperDocId = QUEUE_CONFIG.HELPER_DOCS[botId];
    if (!helperDocId) {
      return {success: false, message: 'Helper Doc not configured for ' + botId};
    }

    const helperDoc = SpreadsheetApp.openById(helperDocId);
    const helperSheet = helperDoc.getSheetByName(QUEUE_CONFIG.HELPER_SHEET_NAME);

    if (!helperSheet) {
      return {success: false, message: 'Helper sheet "' + QUEUE_CONFIG.HELPER_SHEET_NAME + '" not found'};
    }

    const data = helperSheet.getDataRange().getValues();

    Logger.log('fillOrderInfo: Processing ' + parsedOrders.length + ' parsed orders');
    Logger.log('Total data rows: ' + data.length);

    let matchCount = 0;
    let orderNumber = '';
    let buyerName = '';

    // Start from row 3 (rows 1-2 are headers, data starts at row 3)
    for (let i = 2; i < data.length; i++) {
      const row = data[i];
      const cardName = row[QUEUE_CONFIG.HELPER_COLS.CARD_NAME];
      const setName = row[QUEUE_CONFIG.HELPER_COLS.SET_NAME];
      const condition = row[QUEUE_CONFIG.HELPER_COLS.CONDITION];
      const collectorNum = row[QUEUE_CONFIG.HELPER_COLS.COLLECTOR_NUM];
      const rowSQ = row[QUEUE_CONFIG.HELPER_COLS.SQ_NUMBER];

      // Only process rows for this SQ
      if (rowSQ !== sqNumber) continue;
      if (!cardName) continue; // Skip empty rows

      Logger.log('Row ' + (i + 1) + ': Looking for match - ' + cardName + ' | ' + setName + ' | ' + condition);

      // Use sophisticated multi-level matching
      const matchedOrder = findMatchingOrder(cardName, setName, condition, collectorNum, parsedOrders);

      if (matchedOrder) {
        // Match found! Fill in Order Number and Buyer Name
        // getRange uses 1-based column numbers: H=8, I=9
        helperSheet.getRange(i + 1, 8).setValue(matchedOrder.orderNumber); // Column H
        helperSheet.getRange(i + 1, 9).setValue(matchedOrder.buyerName); // Column I
        SpreadsheetApp.flush();

        Logger.log('  ✓ Matched! Order: ' + matchedOrder.orderNumber + ', Buyer: ' + matchedOrder.buyerName);
        matchCount++;

        // Save order/buyer info to return
        orderNumber = matchedOrder.orderNumber;
        buyerName = matchedOrder.buyerName;
      } else {
        Logger.log('  ✗ No match found for: ' + cardName);
      }
    }

    Logger.log('Matched ' + matchCount + ' items');

    if (matchCount === 0) {
      return {success: false, message: 'No matching cards found in PDF'};
    }

    return {
      success: true,
      matchCount: matchCount,
      orderNumber: orderNumber,
      buyerName: buyerName
    };

  } catch (e) {
    Logger.log('ERROR in fillOrderInfo: ' + e);
    return {success: false, message: 'Exception: ' + e.message};
  }
}

/**
 * Sync SQ claim to Convex
 */
function syncClaimToConvex(botId, sqNumber, status) {
  try {
    const url = QUEUE_CONFIG.CONVEX_URL + '/bot-manager/claim-sq';
    const payload = {
      botId: botId,
      sqNumber: sqNumber,
      status: status,
      claimedAt: Date.now()
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();

    if (statusCode === 200) {
      Logger.log('[' + botId + '] Synced claim to Convex for SQ ' + sqNumber);
      return true;
    } else {
      Logger.log('⚠️ Failed to sync claim to Convex (HTTP ' + statusCode + '): ' + response.getContentText());
      return false;
    }
  } catch (e) {
    Logger.log('⚠️ Error syncing claim to Convex: ' + e);
    return false; // Don't fail the main operation if Convex sync fails
  }
}

/**
 * Sync SQ completion to Convex
 */
function syncCompletionToConvex(botId, sqNumber) {
  try {
    const url = QUEUE_CONFIG.CONVEX_URL + '/bot-manager/complete-sq';
    const payload = {
      botId: botId,
      sqNumber: sqNumber,
      completedAt: Date.now()
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();

    if (statusCode === 200) {
      Logger.log('[' + botId + '] Synced completion to Convex for SQ ' + sqNumber);
      return true;
    } else {
      Logger.log('⚠️ Failed to sync completion to Convex (HTTP ' + statusCode + '): ' + response.getContentText());
      return false;
    }
  } catch (e) {
    Logger.log('⚠️ Error syncing completion to Convex: ' + e);
    return false; // Don't fail the main operation if Convex sync fails
  }
}

/**
 * Sync refund reservation to Convex
 */
function syncRefundReservationToConvex(botId, sqNumber, startRow, rowCount) {
  try {
    const url = QUEUE_CONFIG.CONVEX_URL + '/bot-manager/reserve-refund-rows';
    const payload = {
      botId: botId,
      sqNumber: sqNumber,
      startRow: startRow,
      rowCount: rowCount,
      reservedAt: Date.now()
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();

    if (statusCode === 200) {
      Logger.log('[' + botId + '] Synced refund reservation to Convex for SQ ' + sqNumber);
      return true;
    } else {
      Logger.log('⚠️ Failed to sync refund reservation to Convex (HTTP ' + statusCode + '): ' + response.getContentText());
      return false;
    }
  } catch (e) {
    Logger.log('⚠️ Error syncing refund reservation to Convex: ' + e);
    return false; // Don't fail the main operation if Convex sync fails
  }
}
