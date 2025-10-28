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

  // EMERGENCY KILL SWITCH: Set this to true to make all running executions exit immediately
  // Use this when you need to kill zombie executions
  // IMPORTANT: Deploy with this as FALSE normally, only set to TRUE during emergency cleanup
  EMERGENCY_SHUTDOWN: false,

  // Helper Doc Sheet ID (single bot for batch processing)
  HELPER_DOCS: {
    'BATCH_BOT': '1VcpaoXllWGTB3APt9Gjhi4-D_1XUH4qldWiZYQlYoH0',  // Using BOT1's Helper Doc for batch mode
    // Legacy bot IDs kept for backwards compatibility (but not actively used)
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

      case 'pullNextBatchOfSQs':
        result = pullNextBatchOfSQs(botId, params.batchSize || 20);
        break;

      case 'uploadToRefundLog':
        result = uploadToRefundLog(params.sqData, params.manualData);
        break;

      case 'uploadBatchToRefundLog':
        result = uploadBatchToRefundLog(botId, params.sqNumbers);
        break;

      case 'syncManualDataToHelper':
        result = syncManualDataToHelper(botId, sqNumber, params.manualData);
        break;

      case 'processPDFUpload':
        result = processPDFUpload(botId, sqNumber, params.base64Data, params.fileName);
        break;

      case 'clearHelperDoc':
        result = clearHelperDoc(botId);
        break;

      case 'acquireBotSession':
        result = acquireBotSession(botId);
        break;

      case 'releaseBotSession':
        result = releaseBotSession(botId);
        break;

      case 'renewBotSession':
        result = renewBotSession(botId);
        break;

      case 'forceReleaseBotSession':
        result = forceReleaseBotSession(botId);
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
 * Get list of all active sessions from Convex (for UI to grey out busy bots)
 */
function getActiveClaims() {
  try {
    const startTime = new Date().getTime();
    const url = QUEUE_CONFIG.CONVEX_URL + '/bot-manager/get-active-sessions';

    const options = {
      method: 'get',
      muteHttpExceptions: true,
      timeout: 5 // 5 second timeout
    };

    Logger.log('getActiveClaims: Fetching from ' + url);
    const response = UrlFetchApp.fetch(url, options);
    const elapsed = new Date().getTime() - startTime;
    Logger.log('getActiveClaims: Request took ' + elapsed + 'ms');

    const result = JSON.parse(response.getContentText());
    Logger.log('getActiveClaims: Response: ' + JSON.stringify(result));

    if (result.success && result.sessions) {
      // Transform sessions to match expected format for UI
      // Use simple objects only - no Date objects as they don't serialize well
      const sessions = result.sessions.map(function(session) {
        return {
          botId: session.botId,
          sqNumber: 'SESSION',
          status: 'SESSION',
          timestamp: session.lastActivity, // Keep as timestamp number
          age: session.age
        };
      });

      Logger.log('getActiveClaims: Returning ' + sessions.length + ' active sessions from Convex');
      return sessions;
    } else {
      Logger.log('getActiveClaims: No active sessions found or result not successful');
      return [];
    }

  } catch (e) {
    Logger.log('ERROR in getActiveClaims: ' + e);
    Logger.log('ERROR stack: ' + e.stack);
    return [];
  }
}

/**
 * Clean up stale claims and sessions
 * Note: Sessions are now managed in Convex and auto-expire after 10 minutes
 * This function is kept for backwards compatibility
 */
function cleanupStaleClaims() {
  Logger.log('cleanupStaleClaims: Session cleanup now handled automatically by Convex');
  return {success: true, removed: 0};
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
 * LOCK OPTIMIZED: Only locks when writing to shared Discrepancy Log
 */
function pullNextSQ(botId) {
  // Validate botId
  if (!botId) {
    Logger.log('ERROR: pullNextSQ called with null/undefined botId');
    return {success: false, message: 'Bot ID is required', sqData: null};
  }

  // Start timeout timer (3 minutes - operation took 2min14s in testing)
  const startTime = new Date().getTime();
  const TIMEOUT_MS = 180000; // 3 minutes - Apps Script has 6 min limit, gives plenty of room

  function checkTimeout(operation) {
    // EMERGENCY KILL SWITCH: Check if system is in shutdown mode
    if (QUEUE_CONFIG.EMERGENCY_SHUTDOWN) {
      const errorMsg = 'EMERGENCY SHUTDOWN ACTIVE - All operations halted';
      Logger.log('[' + botId + '] 🛑 ' + errorMsg);
      throw new Error(errorMsg);
    }

    const elapsed = new Date().getTime() - startTime;
    if (elapsed > TIMEOUT_MS) {
      const errorMsg = 'Operation timed out after ' + Math.round(elapsed/1000) + 's during: ' + operation;
      Logger.log('[' + botId + '] TIMEOUT: ' + errorMsg);
      throw new Error(errorMsg);
    }
  }

  function getRemainingTime() {
    const elapsed = new Date().getTime() - startTime;
    return TIMEOUT_MS - elapsed;
  }

  // Reset session timestamp to keep session alive
  touchBotSession(botId);

  try {
    checkTimeout('initialization');
    const ss = SpreadsheetApp.openById(QUEUE_CONFIG.DISCREP_LOG_ID);
    const discrepSheet = ss.getSheetByName(QUEUE_CONFIG.DISCREP_SHEET_NAME);

    if (!discrepSheet) {
      return {success: false, message: 'Sheet "' + QUEUE_CONFIG.DISCREP_SHEET_NAME + '" not found', sqData: null};
    }

    // TEMPORARILY DISABLED: Convex pre-fetch causing timeouts
    // This optimization is skipped - tryReserveSQ will still prevent duplicate claims
    let convexClaimedSQs = [];
    Logger.log('[' + botId + '] Skipping Convex pre-fetch (disabled due to timeout issues)');
    Logger.log('[' + botId + '] Duplicate prevention will happen via tryReserveSQ instead');

    /* DISABLED FOR DEBUGGING - RE-ENABLE ONCE CONVEX PERFORMANCE IMPROVES
    // Get list of already-claimed SQs from Convex to avoid race conditions
    // This is optional - if it fails or times out, tryReserveSQ will still prevent duplicates
    const remaining = getRemainingTime();

    if (remaining < 5000) {
      Logger.log('[' + botId + '] Skipping Convex fetch - not enough time remaining (' + Math.round(remaining/1000) + 's)');
    } else {
      try {
        checkTimeout('pre-Convex-fetch');
        const convexUrl = QUEUE_CONFIG.CONVEX_URL + '/bot-manager/get-claimed-sqs';
        Logger.log('[' + botId + '] Fetching claimed SQs from Convex with 3s timeout...');

        const convexResponse = UrlFetchApp.fetch(convexUrl, {
          method: 'get',
          muteHttpExceptions: true,
          validateHttpsCertificates: false,
          timeout: 3 // 3 second timeout
        });

        checkTimeout('post-Convex-fetch');
        const responseText = convexResponse.getContentText();

        if (responseText) {
          const convexResult = JSON.parse(responseText);
          if (convexResult.success && convexResult.claimedSQs) {
            convexClaimedSQs = convexResult.claimedSQs;
            Logger.log('[' + botId + '] Convex reports ' + convexClaimedSQs.length + ' already claimed SQs');
          }
        }
      } catch (convexError) {
        Logger.log('[' + botId + '] Convex fetch failed: ' + convexError.toString());
      }
    }
    */

    checkTimeout('pre-data-fetch');
    Logger.log('[' + botId + '] Fetching Discrepancy Log data (optimized scan)...');

    // Column indices - same as working.gs CONFIG.DISCREP_COLS
    const COL_SQ_NUMBER = 2;            // Column C
    const COL_GAME = 3;                 // Column D
    const COL_CARD_NAME = 4;            // Column E
    const COL_COLLECTOR_NUM = 5;        // Column F
    const COL_RARITY = 6;               // Column G
    const COL_SET_NAME = 7;             // Column H
    const COL_CONDITION = 8;            // Column I
    const COL_QTY = 9;                  // Column J
    const COL_LOCATION_ID = 10;         // Column K
    const COL_INITIALS = 14;            // Column O (Inv. Initials)
    const COL_RESOLUTION_TYPE = 15;     // Column P (Resolution Type)
    const COL_SOLVE_DATE = 17;          // Column R (Solve Date)
    const COL_MANUAL_INTERVENTION = 18; // Column S (Manual/IN THE VAULT)

    // OPTIMIZATION: Read only the columns we need for filtering (C, K, O, R, S)
    // This is much faster than reading all 23 columns
    const totalRows = discrepSheet.getLastRow();
    Logger.log('[' + botId + '] Sheet has ' + totalRows + ' rows - reading filter columns only...');

    // Read just columns C (SQ#), K (Location), O (Initials), R (Solve Date), S (Manual)
    const filterData = discrepSheet.getRange(2, 3, totalRows - 1, 1).getValues() // Column C
      .map(function(row, idx) {
        return {
          rowIndex: idx + 2, // 1-based row number
          sqNumber: row[0]
        };
      });

    // Read columns O, P, Q, R, S for all rows at once
    const statusColumns = discrepSheet.getRange(2, 15, totalRows - 1, 5).getValues(); // O-S (cols 15-19)

    checkTimeout('post-filter-data-fetch');
    Logger.log('[' + botId + '] Loaded filter data for ' + filterData.length + ' rows');

    // Build map of unclaimed SQ numbers
    const unclaimedSQMap = {}; // {sqNumber: [rowIndex1, rowIndex2, ...]}

    for (let i = 0; i < filterData.length; i++) {
      const sqNumber = filterData[i].sqNumber;
      const rowIndex = filterData[i].rowIndex;
      const initials = statusColumns[i][0]; // Column O (Initials)
      const solveDate = statusColumns[i][3]; // Column R (Solve Date)
      const manualIntervention = statusColumns[i][4]; // Column S (Manual/Vault)

      // Skip if empty SQ number
      if (!sqNumber) continue;

      // Skip if claimed, solved, or in vault
      if (initials) continue;
      if (solveDate) continue;
      if (manualIntervention && manualIntervention.toString().toLowerCase().includes('vault')) continue;

      // This row is unclaimed - add to map
      if (!unclaimedSQMap[sqNumber]) {
        unclaimedSQMap[sqNumber] = [];
      }
      unclaimedSQMap[sqNumber].push(rowIndex);
    }

    const uniqueSQs = Object.keys(unclaimedSQMap);
    Logger.log('[' + botId + '] Found ' + uniqueSQs.length + ' unclaimed SQ(s)');

    if (uniqueSQs.length === 0) {
      return {success: false, message: 'No unclaimed SQs available', sqData: null};
    }

    // RETRY LOOP: Try SQs in order until we successfully claim one
    for (const sqNumber of uniqueSQs) {
      checkTimeout('SQ retry loop iteration');

      const rowIndices = unclaimedSQMap[sqNumber];
      Logger.log('[' + botId + '] Trying SQ: ' + sqNumber + ' (' + rowIndices.length + ' rows) - attempting Convex queue reservation...');

      // Try to reserve this SQ in Convex queue (prevents race conditions)
      if (!tryReserveSQ(botId, sqNumber)) {
        Logger.log('[' + botId + '] ⚠️ Failed to reserve SQ ' + sqNumber + ' in queue - trying next SQ...');
        continue; // Another bot reserved it first - try next SQ
      }

      Logger.log('[' + botId + '] ✓ Convex reserved SQ ' + sqNumber + ' - reading full data for these rows...');

      // Now read the full data for all rows of this SQ
      // We need columns D-K (Game, Card Name, Collector#, Rarity, Set, Condition, Qty, Location)
      const itemsForSQ = [];
      const GAME_IDX = 3; // Column D

      for (const rowIdx of rowIndices) {
        const rowData = discrepSheet.getRange(rowIdx, 1, 1, 23).getValues()[0];
        itemsForSQ.push({
          rowIndex: rowIdx,
          sqNumber: sqNumber,
          game: rowData[GAME_IDX] || 'Magic: The Gathering',
          cardName: rowData[COL_CARD_NAME] || '',
          collectorNum: rowData[COL_COLLECTOR_NUM] || '',
          rarity: rowData[COL_RARITY] || '',
          setName: rowData[COL_SET_NAME] || '',
          condition: rowData[COL_CONDITION] || '',
          qty: rowData[COL_QTY] || 1
        });
      }

      Logger.log('[' + botId + '] Read full data for ' + itemsForSQ.length + ' rows');

      // Claim ALL rows for this SQ (Convex already reserved it for us)
      // LOCK ONLY FOR THIS WRITE to shared Discrepancy Log
      const lock = acquireLock(QUEUE_CONFIG.MAX_LOCK_WAIT_MS);
      if (!lock) {
        Logger.log('[' + botId + '] ⚠️ Failed to acquire lock for claiming rows - releasing SQ reservation');
        releaseSQ(botId, sqNumber);
        continue; // Try next SQ
      }

      const now = new Date();

      try {
        Logger.log('[' + botId + '] Claiming ' + itemsForSQ.length + ' rows for SQ ' + sqNumber);

        // Claim rows one-by-one (same as working.gs)
        let claimedCount = 0;
        for (const item of itemsForSQ) {
          discrepSheet.getRange(item.rowIndex, COL_INITIALS + 1).setValue(botId);
          discrepSheet.getRange(item.rowIndex, COL_RESOLUTION_TYPE + 1).setValue('Missing Note');
          discrepSheet.getRange(item.rowIndex, COL_SOLVE_DATE + 1).setValue(now);
          claimedCount++;

          if (claimedCount % 10 === 0) {
            Logger.log('  Claimed ' + claimedCount + '/' + itemsForSQ.length + ' rows...');
          }
        }

        SpreadsheetApp.flush();
        lock.releaseLock(); // Release immediately after write

        checkTimeout('claiming rows');
        Logger.log('[' + botId + '] ✓ Claimed ' + itemsForSQ.length + ' rows for SQ ' + sqNumber);

        // Write ALL rows to Helper Doc and read back complete data
        checkTimeout('pre-helper-doc-access');
        const helperDocId = QUEUE_CONFIG.HELPER_DOCS[botId];
        const missingFields = [];
        let completeItems = []; // Will be populated from Helper Doc
        let sqLink = '';

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

              checkTimeout('writing to Helper Doc');
              Logger.log('[' + botId + '] Wrote ' + itemsForSQ.length + ' rows to Helper Doc');

              // Wait for formulas to load (especially SQ link in G3)
              Utilities.sleep(2000);
              checkTimeout('waiting for Helper Doc formulas');

              // Get SQ link from cell G3 (column 7)
              const sqLinkCell = helperSheet.getRange(3, 7); // Column G

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

              // Read ALL rows back from Helper Doc to get complete data with order/buyer info
              // Columns: H=Order#, I=Buyer, J=SQ#, K=Game, L=Card, M=Collector#, N=Rarity, O=Set, P=Condition, Q=Qty
              checkTimeout('reading back Helper Doc data');
              const allHelperData = helperSheet.getRange(3, 8, itemsForSQ.length, 10).getValues(); // Columns H-Q (8-17)

              // Check if ANY row is missing order/buyer data
              // Note: An SQ can have items from multiple orders, so we check all rows
              let hasAnyMissingOrder = false;
              let hasAnyMissingBuyer = false;

              for (let i = 0; i < allHelperData.length; i++) {
                if (!allHelperData[i][0]) hasAnyMissingOrder = true;  // Column H
                if (!allHelperData[i][1]) hasAnyMissingBuyer = true;   // Column I
              }

              if (hasAnyMissingOrder) missingFields.push('orderNumber');
              if (hasAnyMissingBuyer) missingFields.push('buyerName');

              // Create array of items with complete data from Helper Doc
              completeItems = allHelperData.map((row, idx) => {
                const orderNum = row[0]; // Column H
                const buyerName = row[1]; // Column I
                const sqNum = row[2]; // Column J
                const game = row[3]; // Column K
                const cardName = row[4]; // Column L
                const collectorNum = row[5]; // Column M
                const rarity = row[6]; // Column N
                const setName = row[7]; // Column O
                const condition = row[8]; // Column P
                const qty = row[9]; // Column Q

                return {
                  sqNumber: sqNum,
                  orderNumber: orderNum || '',
                  buyerName: buyerName || '',
                  game: game || 'Magic: The Gathering',
                  cardName: cardName || '',
                  collectorNum: collectorNum || '',
                  rarity: rarity || '',
                  setName: setName || '',
                  condition: condition || '',
                  qty: qty || 1,
                  sqLink: sqLink || ''
                };
              });

              Logger.log('[' + botId + '] Read back ' + completeItems.length + ' complete items from Helper Doc');
            }
          } catch (helperError) {
            Logger.log('Warning: Could not access Helper Doc for ' + botId + ': ' + helperError);
          }
        }

        // Success! Release queue reservation
        releaseSQ(botId, sqNumber);

        Logger.log('[' + botId + '] 🎉 Successfully claimed SQ ' + sqNumber + ' (' + itemsForSQ.length + ' rows)' + (missingFields.length > 0 ? ' - Missing: ' + missingFields.join(', ') : ' - Complete'));
        return {
          success: true,
          message: 'SQ claimed successfully',
          sqData: completeItems, // Return array of all items, not single object
          sqNumber: sqNumber,
          totalRows: itemsForSQ.length,
          missingFields: missingFields
        };

      } catch (claimError) {
        Logger.log('[' + botId + '] ERROR: Failed to claim SQ ' + sqNumber + ': ' + claimError);
        if (lock) lock.releaseLock(); // Release lock if still held
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
  }
}

/**
 * Pull next BATCH of unclaimed SQs from Discrep Log (for batch processing mode)
 * Claims multiple SQs at once and writes all to Helper Doc grouped by SQ number
 * Returns array of SQ objects with metadata for UI processing
 */
function pullNextBatchOfSQs(botId, batchSize) {
  // Validate botId
  if (!botId) {
    Logger.log('ERROR: pullNextBatchOfSQs called with null/undefined botId');
    return {success: false, message: 'Bot ID is required', sqBatch: null};
  }

  const startTime = new Date().getTime();
  const TIMEOUT_MS = 180000; // 3 minutes

  function checkTimeout(operation) {
    if (QUEUE_CONFIG.EMERGENCY_SHUTDOWN) {
      const errorMsg = 'EMERGENCY SHUTDOWN ACTIVE - All operations halted';
      Logger.log('[' + botId + '] 🛑 ' + errorMsg);
      throw new Error(errorMsg);
    }

    const elapsed = new Date().getTime() - startTime;
    if (elapsed > TIMEOUT_MS) {
      const errorMsg = 'Operation timed out after ' + Math.round(elapsed/1000) + 's during: ' + operation;
      Logger.log('[' + botId + '] TIMEOUT: ' + errorMsg);
      throw new Error(errorMsg);
    }
  }

  // Reset session timestamp to keep session alive
  touchBotSession(botId);

  try {
    checkTimeout('initialization');
    const ss = SpreadsheetApp.openById(QUEUE_CONFIG.DISCREP_LOG_ID);
    const discrepSheet = ss.getSheetByName(QUEUE_CONFIG.DISCREP_SHEET_NAME);

    if (!discrepSheet) {
      return {success: false, message: 'Sheet "' + QUEUE_CONFIG.DISCREP_SHEET_NAME + '" not found', sqBatch: null};
    }

    Logger.log('[' + botId + '] Fetching Discrepancy Log data for batch of ' + batchSize + ' SQs...');

    // Column indices
    const COL_SQ_NUMBER = 2;
    const COL_GAME = 3;
    const COL_CARD_NAME = 4;
    const COL_COLLECTOR_NUM = 5;
    const COL_RARITY = 6;
    const COL_SET_NAME = 7;
    const COL_CONDITION = 8;
    const COL_QTY = 9;
    const COL_LOCATION_ID = 10;
    const COL_INITIALS = 14;
    const COL_RESOLUTION_TYPE = 15;
    const COL_SOLVE_DATE = 17;
    const COL_MANUAL_INTERVENTION = 18;

    const totalRows = discrepSheet.getLastRow();
    Logger.log('[' + botId + '] Sheet has ' + totalRows + ' rows - reading filter columns...');

    // Read SQ numbers and status columns
    const filterData = discrepSheet.getRange(2, 3, totalRows - 1, 1).getValues()
      .map(function(row, idx) {
        return {
          rowIndex: idx + 2,
          sqNumber: row[0]
        };
      });

    const statusColumns = discrepSheet.getRange(2, 15, totalRows - 1, 5).getValues(); // O-S (cols 15-19)

    checkTimeout('post-filter-data-fetch');

    // Build map of unclaimed SQ numbers
    const unclaimedSQMap = {}; // {sqNumber: [rowIndex1, rowIndex2, ...]}

    for (let i = 0; i < filterData.length; i++) {
      const sqNumber = filterData[i].sqNumber;
      const rowIndex = filterData[i].rowIndex;
      const initials = statusColumns[i][0]; // Column O (Initials)
      const solveDate = statusColumns[i][3]; // Column R (Solve Date)
      const manualIntervention = statusColumns[i][4]; // Column S (Manual/Vault)

      if (!sqNumber) continue;
      if (initials) continue;
      if (solveDate) continue;
      if (manualIntervention && manualIntervention.toString().toLowerCase().includes('vault')) continue;

      if (!unclaimedSQMap[sqNumber]) {
        unclaimedSQMap[sqNumber] = [];
      }
      unclaimedSQMap[sqNumber].push(rowIndex);
    }

    const uniqueSQs = Object.keys(unclaimedSQMap);
    Logger.log('[' + botId + '] Found ' + uniqueSQs.length + ' unclaimed SQ(s)');

    if (uniqueSQs.length === 0) {
      return {success: false, message: 'No unclaimed SQs available', sqBatch: null};
    }

    // Claim up to batchSize SQs
    const claimedSQs = [];
    const sqBatch = []; // Array of {sqNumber, sqLink, rowCount, rows: [...]}

    for (let sqIdx = 0; sqIdx < Math.min(batchSize, uniqueSQs.length); sqIdx++) {
      checkTimeout('SQ batch loop iteration ' + sqIdx);

      const sqNumber = uniqueSQs[sqIdx];
      const rowIndices = unclaimedSQMap[sqNumber];

      Logger.log('[' + botId + '] [' + (sqIdx + 1) + '/' + batchSize + '] Trying SQ: ' + sqNumber + ' (' + rowIndices.length + ' rows)');

      // Try to reserve this SQ in Convex queue
      if (!tryReserveSQ(botId, sqNumber)) {
        Logger.log('[' + botId + '] ⚠️ Failed to reserve SQ ' + sqNumber + ' - skipping');
        continue;
      }

      Logger.log('[' + botId + '] ✓ Convex reserved SQ ' + sqNumber);

      // Read full data for all rows of this SQ
      const itemsForSQ = [];
      const GAME_IDX = 3;

      for (const rowIdx of rowIndices) {
        const rowData = discrepSheet.getRange(rowIdx, 1, 1, 23).getValues()[0];
        itemsForSQ.push({
          rowIndex: rowIdx,
          sqNumber: sqNumber,
          game: rowData[GAME_IDX] || 'Magic: The Gathering',
          cardName: rowData[COL_CARD_NAME] || '',
          collectorNum: rowData[COL_COLLECTOR_NUM] || '',
          rarity: rowData[COL_RARITY] || '',
          setName: rowData[COL_SET_NAME] || '',
          condition: rowData[COL_CONDITION] || '',
          qty: rowData[COL_QTY] || 1
        });
      }

      // Claim rows in Discrepancy Log
      const lock = acquireLock(QUEUE_CONFIG.MAX_LOCK_WAIT_MS);
      if (!lock) {
        Logger.log('[' + botId + '] ⚠️ Failed to acquire lock - releasing SQ ' + sqNumber);
        releaseSQ(botId, sqNumber);
        continue;
      }

      const now = new Date();
      try {
        for (const item of itemsForSQ) {
          discrepSheet.getRange(item.rowIndex, COL_INITIALS + 1).setValue(botId);
          discrepSheet.getRange(item.rowIndex, COL_RESOLUTION_TYPE + 1).setValue('Missing Note');
          discrepSheet.getRange(item.rowIndex, COL_SOLVE_DATE + 1).setValue(now);
        }
        SpreadsheetApp.flush();
        lock.releaseLock();

        Logger.log('[' + botId + '] ✓ Claimed ' + itemsForSQ.length + ' rows for SQ ' + sqNumber);
        claimedSQs.push({sqNumber: sqNumber, items: itemsForSQ});

      } catch (claimError) {
        Logger.log('[' + botId + '] ERROR claiming SQ ' + sqNumber + ': ' + claimError);
        if (lock) lock.releaseLock();
        releaseSQ(botId, sqNumber);
        continue;
      }
    }

    if (claimedSQs.length === 0) {
      return {success: false, message: 'Failed to claim any SQs from batch', sqBatch: null};
    }

    Logger.log('[' + botId + '] Successfully claimed ' + claimedSQs.length + ' SQs');

    // Write ALL SQs to Helper Doc (grouped by SQ number)
    checkTimeout('pre-helper-doc-write');
    const helperDocId = QUEUE_CONFIG.HELPER_DOCS[botId];

    if (!helperDocId) {
      return {success: false, message: 'Helper Doc not configured for ' + botId, sqBatch: null};
    }

    const helperDoc = SpreadsheetApp.openById(helperDocId);
    const helperSheet = helperDoc.getSheetByName(QUEUE_CONFIG.HELPER_SHEET_NAME);

    if (!helperSheet) {
      return {success: false, message: 'Helper sheet not found', sqBatch: null};
    }

    // Clear existing data
    const lastRow = helperSheet.getLastRow();
    if (lastRow > 2) {
      helperSheet.getRange(3, 1, lastRow - 2, helperSheet.getLastColumn()).clearContent();
    }

    // Write all SQs grouped by SQ number
    let currentRow = 3;
    for (const sq of claimedSQs) {
      const rowsData = sq.items.map(item => [
        item.sqNumber,     // Column J
        item.game,         // Column K
        item.cardName,     // Column L
        item.collectorNum, // Column M
        item.rarity,       // Column N
        item.setName,      // Column O
        item.condition,    // Column P
        item.qty           // Column Q
      ]);

      // Write this SQ's rows
      helperSheet.getRange(currentRow, 10, rowsData.length, rowsData[0].length).setValues(rowsData);
      currentRow += rowsData.length;
    }

    SpreadsheetApp.flush();
    Logger.log('[' + botId + '] Wrote ' + (currentRow - 3) + ' total rows to Helper Doc');

    // Wait for formulas to populate
    Utilities.sleep(2000);
    checkTimeout('waiting for Helper Doc formulas');

    // Read back all data with order/buyer info and build sqBatch array
    const allHelperData = helperSheet.getRange(3, 1, currentRow - 3, 17).getValues(); // Columns A-Q

    let rowIdx = 0;
    for (const sq of claimedSQs) {
      const sqRows = [];
      let sqLink = '';

      for (let i = 0; i < sq.items.length; i++) {
        const row = allHelperData[rowIdx];

        // Get SQ link from column G (index 6) of first row for this SQ
        if (i === 0) {
          const sqLinkCell = helperSheet.getRange(rowIdx + 3, 7);
          try {
            const richTextValue = sqLinkCell.getRichTextValue();
            if (richTextValue) {
              const url = richTextValue.getLinkUrl();
              if (url) sqLink = url;
            }
          } catch (e) {
            // Fallback to cell value
            const cellValue = sqLinkCell.getValue();
            if (cellValue && typeof cellValue === 'string' && cellValue.toString().startsWith('http')) {
              sqLink = cellValue.toString();
            }
          }
        }

        sqRows.push({
          orderNumber: row[7] || '',   // Column H
          buyerName: row[8] || '',     // Column I
          sqNumber: row[9],            // Column J
          game: row[10],               // Column K
          cardName: row[11],           // Column L
          collectorNum: row[12],       // Column M
          rarity: row[13],             // Column N
          setName: row[14],            // Column O
          condition: row[15],          // Column P
          qty: row[16]                 // Column Q
        });

        rowIdx++;
      }

      sqBatch.push({
        sqNumber: sq.sqNumber,
        sqLink: sqLink,
        rowCount: sqRows.length,
        rows: sqRows
      });
    }

    Logger.log('[' + botId + '] 🎉 Successfully claimed batch of ' + sqBatch.length + ' SQs');

    return {
      success: true,
      message: 'Claimed ' + sqBatch.length + ' SQs successfully',
      sqBatch: sqBatch,
      totalSQs: sqBatch.length,
      totalRows: rowIdx
    };

  } catch (e) {
    Logger.log('ERROR in pullNextBatchOfSQs: ' + e);
    return {success: false, message: 'Exception: ' + e.message, sqBatch: null};
  }
}

/**
 * Upload SQ data to Refund Log by reading directly from Helper Doc
 * Much simpler and more reliable than passing data through UI
 * LOCK OPTIMIZED: Only locks when writing to shared Refund Log
 */
function uploadToRefundLog(botId, sqNumber) {
  // Reset session timestamp to keep session alive
  touchBotSession(botId);

  try {
    // Get Helper Doc for this bot (NO LOCK - per-bot resource)
    const helperDocId = QUEUE_CONFIG.HELPER_DOCS[botId];
    if (!helperDocId) {
      return {success: false, message: 'Helper Doc not configured for ' + botId, rows: null};
    }

    const helperDoc = SpreadsheetApp.openById(helperDocId);
    const helperSheet = helperDoc.getSheetByName(QUEUE_CONFIG.HELPER_SHEET_NAME);

    if (!helperSheet) {
      return {success: false, message: 'Helper sheet not found', rows: null};
    }

    // Read ALL data from Helper Doc (NO LOCK - exclusive bot access)
    const helperData = helperSheet.getDataRange().getValues();

    Logger.log(`uploadToRefundLog: Helper Doc has ${helperData.length} total rows (including headers)`);
    Logger.log(`uploadToRefundLog: Looking for SQ number: "${sqNumber}"`);

    // Find all rows for this SQ (starting from row 3, rows 1-2 are headers)
    const rowsForSQ = [];
    for (let i = 2; i < helperData.length; i++) {
      const row = helperData[i];
      const rowSQ = row[QUEUE_CONFIG.HELPER_COLS.SQ_NUMBER];

      // Log first few rows to debug
      if (i < 5) {
        Logger.log(`  Row ${i + 1}: SQ="${rowSQ}", Card="${row[QUEUE_CONFIG.HELPER_COLS.CARD_NAME]}"`);
      }

      if (rowSQ === sqNumber) {
        rowsForSQ.push({
          orderNumber: row[QUEUE_CONFIG.HELPER_COLS.ORDER_NUMBER] || '',
          buyerName: row[QUEUE_CONFIG.HELPER_COLS.BUYER_NAME] || '',
          sqNumber: row[QUEUE_CONFIG.HELPER_COLS.SQ_NUMBER] || '',
          game: row[QUEUE_CONFIG.HELPER_COLS.GAME] || 'Magic: The Gathering',
          cardName: row[QUEUE_CONFIG.HELPER_COLS.CARD_NAME] || '',
          collectorNum: row[QUEUE_CONFIG.HELPER_COLS.COLLECTOR_NUM] || '',
          rarity: row[QUEUE_CONFIG.HELPER_COLS.RARITY] || '',
          setName: row[QUEUE_CONFIG.HELPER_COLS.SET_NAME] || '',
          condition: row[QUEUE_CONFIG.HELPER_COLS.CONDITION] || '',
          qty: row[QUEUE_CONFIG.HELPER_COLS.QTY] || 1
        });
      }
    }

    if (rowsForSQ.length === 0) {
      Logger.log(`⚠️ uploadToRefundLog: No rows found matching SQ "${sqNumber}"`);
      Logger.log(`⚠️ Possible causes: (1) Helper Doc was cleared, (2) Wrong SQ number, (3) Data not yet written`);
      return {success: false, message: 'No data found in Helper Doc for SQ ' + sqNumber + '. Did you pull this SQ first?', rows: null};
    }

    Logger.log(`uploadToRefundLog: Found ${rowsForSQ.length} rows in Helper Doc for SQ ${sqNumber}`);

    // Log first 3 items
    for (let i = 0; i < Math.min(3, rowsForSQ.length); i++) {
      Logger.log(`  Row ${i + 1}: order="${rowsForSQ[i].orderNumber}", buyer="${rowsForSQ[i].buyerName}", card="${rowsForSQ[i].cardName}"`);
    }

    // Prepare all rows for Refund Log (NO LOCK YET - just preparing data)
    const rowsToWrite = rowsForSQ.map(item => {
      const rowData = Array(12).fill(''); // Columns A-L
      rowData[0] = new Date();                    // Column A (Date)
      // rowData[1] stays empty                   // Column B (order link or formula)
      rowData[2] = item.orderNumber;              // Column C
      rowData[3] = item.buyerName;                // Column D
      rowData[4] = item.sqNumber;                 // Column E
      rowData[5] = item.game;                     // Column F
      rowData[6] = item.cardName;                 // Column G
      rowData[7] = item.collectorNum;             // Column H
      rowData[8] = item.rarity;                   // Column I
      rowData[9] = item.setName;                  // Column J
      rowData[10] = item.condition;               // Column K
      rowData[11] = item.qty;                     // Column L
      return rowData;
    });

    // LOCK ONLY FOR WRITING to shared Refund Log
    const lock = acquireLock(QUEUE_CONFIG.MAX_LOCK_WAIT_MS);
    if (!lock) {
      return {success: false, message: 'Failed to acquire lock for Refund Log write', rows: null};
    }

    try {
      // Open Refund Log
      const refundLog = SpreadsheetApp.openById(QUEUE_CONFIG.REFUND_LOG_ID);
      const refundSheet = refundLog.getSheetByName('Refund Log');

      if (!refundSheet) {
        return {success: false, message: 'Refund Log sheet not found', rows: null};
      }

      // Get next available row
      const nextRow = refundSheet.getLastRow() + 1;

      // Write all rows to Refund Log at once
      refundSheet.getRange(nextRow, 1, rowsToWrite.length, rowsToWrite[0].length).setValues(rowsToWrite);
      // Format date column
      refundSheet.getRange(nextRow, 1, rowsToWrite.length, 1).setNumberFormat('m/d/yyyy');
      SpreadsheetApp.flush();

      lock.releaseLock(); // Release immediately after write

      Logger.log(`✓ Uploaded ${rowsToWrite.length} rows to Refund Log starting at row ${nextRow}`);

      // Clear Helper Doc after successful upload (NO LOCK - per-bot resource)
      helperSheet.getRange(3, 1, helperSheet.getLastRow() - 2, helperSheet.getLastColumn()).clearContent();
      SpreadsheetApp.flush();
      Logger.log(`✓ Cleared Helper Doc for ${botId}`);

      return {
        success: true,
        message: `Uploaded ${rowsToWrite.length} item(s) to Refund Log`,
        rows: rowsToWrite.length,
        startRow: nextRow
      };

    } catch (writeError) {
      lock.releaseLock();
      throw writeError;
    }

  } catch (e) {
    Logger.log('ERROR in uploadToRefundLog: ' + e);
    return {success: false, message: 'Exception: ' + e.message, rows: null};
  }
}

/**
 * Upload BATCH of SQ data to Refund Log by reading directly from Helper Doc
 * Handles multiple SQs at once - reads all rows from Helper Doc and uploads to Refund Log
 * NO LOCK NEEDED for Helper Doc read - Only locks when writing to shared Refund Log
 */
function uploadBatchToRefundLog(botId, sqNumbers) {
  // Reset session timestamp to keep session alive
  touchBotSession(botId);

  try {
    // Validate input
    if (!sqNumbers || !Array.isArray(sqNumbers) || sqNumbers.length === 0) {
      return {success: false, message: 'Invalid sqNumbers array', rows: null};
    }

    Logger.log(`uploadBatchToRefundLog: Processing ${sqNumbers.length} SQs for ${botId}`);

    // Get Helper Doc for this bot (NO LOCK - per-bot resource)
    const helperDocId = QUEUE_CONFIG.HELPER_DOCS[botId];
    if (!helperDocId) {
      return {success: false, message: 'Helper Doc not configured for ' + botId, rows: null};
    }

    const helperDoc = SpreadsheetApp.openById(helperDocId);
    const helperSheet = helperDoc.getSheetByName(QUEUE_CONFIG.HELPER_SHEET_NAME);

    if (!helperSheet) {
      return {success: false, message: 'Helper sheet not found', rows: null};
    }

    // Read ALL data from Helper Doc (NO LOCK - exclusive bot access)
    const helperData = helperSheet.getDataRange().getValues();

    Logger.log(`uploadBatchToRefundLog: Helper Doc has ${helperData.length} total rows (including headers)`);

    // Find all rows for ALL SQs in the batch
    const allRowsForBatch = [];
    for (let i = 2; i < helperData.length; i++) {
      const row = helperData[i];
      const rowSQ = row[QUEUE_CONFIG.HELPER_COLS.SQ_NUMBER];

      // Check if this row belongs to any of the SQs in our batch
      if (sqNumbers.indexOf(rowSQ) !== -1) {
        allRowsForBatch.push({
          orderNumber: row[QUEUE_CONFIG.HELPER_COLS.ORDER_NUMBER] || '',
          buyerName: row[QUEUE_CONFIG.HELPER_COLS.BUYER_NAME] || '',
          sqNumber: row[QUEUE_CONFIG.HELPER_COLS.SQ_NUMBER] || '',
          game: row[QUEUE_CONFIG.HELPER_COLS.GAME] || 'Magic: The Gathering',
          cardName: row[QUEUE_CONFIG.HELPER_COLS.CARD_NAME] || '',
          collectorNum: row[QUEUE_CONFIG.HELPER_COLS.COLLECTOR_NUM] || '',
          rarity: row[QUEUE_CONFIG.HELPER_COLS.RARITY] || '',
          setName: row[QUEUE_CONFIG.HELPER_COLS.SET_NAME] || '',
          condition: row[QUEUE_CONFIG.HELPER_COLS.CONDITION] || '',
          qty: row[QUEUE_CONFIG.HELPER_COLS.QTY] || 1
        });
      }
    }

    if (allRowsForBatch.length === 0) {
      Logger.log(`⚠️ uploadBatchToRefundLog: No rows found for SQs: ${sqNumbers.join(', ')}`);
      return {success: false, message: 'No data found in Helper Doc for specified SQs', rows: null};
    }

    Logger.log(`uploadBatchToRefundLog: Found ${allRowsForBatch.length} total rows for batch`);

    // Prepare all rows for Refund Log (NO LOCK YET - just preparing data)
    const rowsToWrite = allRowsForBatch.map(item => {
      const rowData = Array(12).fill(''); // Columns A-L
      rowData[0] = new Date();                    // Column A (Date)
      // rowData[1] stays empty                   // Column B (order link or formula)
      rowData[2] = item.orderNumber;              // Column C
      rowData[3] = item.buyerName;                // Column D
      rowData[4] = item.sqNumber;                 // Column E
      rowData[5] = item.game;                     // Column F
      rowData[6] = item.cardName;                 // Column G
      rowData[7] = item.collectorNum;             // Column H
      rowData[8] = item.rarity;                   // Column I
      rowData[9] = item.setName;                  // Column J
      rowData[10] = item.condition;               // Column K
      rowData[11] = item.qty;                     // Column L
      return rowData;
    });

    // LOCK ONLY FOR WRITING to shared Refund Log
    const lock = acquireLock(QUEUE_CONFIG.MAX_LOCK_WAIT_MS);
    if (!lock) {
      return {success: false, message: 'Failed to acquire lock for Refund Log write', rows: null};
    }

    try {
      // Open Refund Log
      const refundLog = SpreadsheetApp.openById(QUEUE_CONFIG.REFUND_LOG_ID);
      const refundSheet = refundLog.getSheetByName('Refund Log');

      if (!refundSheet) {
        return {success: false, message: 'Refund Log sheet not found', rows: null};
      }

      // Get next available row
      const nextRow = refundSheet.getLastRow() + 1;

      // Write all rows to Refund Log at once
      refundSheet.getRange(nextRow, 1, rowsToWrite.length, rowsToWrite[0].length).setValues(rowsToWrite);
      // Format date column
      refundSheet.getRange(nextRow, 1, rowsToWrite.length, 1).setNumberFormat('m/d/yyyy');
      SpreadsheetApp.flush();

      lock.releaseLock(); // Release immediately after write

      Logger.log(`✓ Uploaded ${rowsToWrite.length} rows to Refund Log starting at row ${nextRow}`);

      // Clear Helper Doc after successful upload (NO LOCK - per-bot resource)
      helperSheet.getRange(3, 1, helperSheet.getLastRow() - 2, helperSheet.getLastColumn()).clearContent();
      SpreadsheetApp.flush();
      Logger.log(`✓ Cleared Helper Doc for ${botId}`);

      // Release all SQs from Convex queue
      for (const sqNum of sqNumbers) {
        releaseSQ(botId, sqNum);
      }

      return {
        success: true,
        message: `Uploaded ${rowsToWrite.length} item(s) from ${sqNumbers.length} SQ(s) to Refund Log`,
        rows: rowsToWrite.length,
        sqCount: sqNumbers.length,
        startRow: nextRow
      };

    } catch (writeError) {
      lock.releaseLock();
      throw writeError;
    }

  } catch (e) {
    Logger.log('ERROR in uploadBatchToRefundLog: ' + e);
    return {success: false, message: 'Exception: ' + e.message, rows: null};
  }
}

/**
 * Sync manual data to Helper Doc
 * Updates the Helper Doc sheet with manually entered order/buyer info
 * NO LOCK NEEDED - Each bot has exclusive access to their own Helper Doc via session
 */
function syncManualDataToHelper(botId, sqNumber, manualData) {
  // Reset session timestamp to keep session alive
  touchBotSession(botId);

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
  }
}

/**
 * Sync ALL items to Helper Doc
 * Updates Helper Doc with complete array of items (each row may have different order/buyer)
 * NO LOCK NEEDED - Each bot has exclusive access to their own Helper Doc via session
 */
function syncAllItemsToHelper(botId, items) {
  // Reset session timestamp to keep session alive
  touchBotSession(botId);

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

    // Update each row with corresponding item data
    // Helper Doc columns: H=Order#, I=Buyer, J=SQ#, K=Game, L=Card, M=Collector#, N=Rarity, O=Set, P=Condition, Q=Qty
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rowNum = i + 3; // Start from row 3 (rows 1-2 are headers)

      // Update columns H (Order#) and I (Buyer) for this row
      if (item.orderNumber) {
        helperSheet.getRange(rowNum, 8).setValue(item.orderNumber); // Column H
      }
      if (item.buyerName) {
        helperSheet.getRange(rowNum, 9).setValue(item.buyerName); // Column I
      }
    }

    SpreadsheetApp.flush();
    Logger.log('[' + botId + '] Synced ' + items.length + ' items to Helper Doc');
    return {success: true, message: 'All items synced to Helper Doc'};

  } catch (e) {
    Logger.log('ERROR in syncAllItemsToHelper: ' + e);
    return {success: false, message: 'Exception: ' + e.message};
  }
}

/**
 * Process PDF upload to extract Order Number and Buyer Name
 * NO LOCK NEEDED - Only writes to bot's own Helper Doc (exclusive access via session)
 */
function processPDFUpload(botId, sqNumber, base64Data, fileName) {
  // Reset session timestamp to keep session alive
  touchBotSession(botId);

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

    // Return success with updated order/buyer info AND complete array of items
    return {
      success: true,
      message: 'PDF processed successfully! ' + result.matchCount + ' items matched.',
      orderNumber: result.orderNumber,
      buyerName: result.buyerName,
      matchCount: result.matchCount,
      updatedItems: result.updatedItems || []  // Return complete array with per-row data
    };

  } catch (e) {
    Logger.log('ERROR in processPDFUpload: ' + e);
    return {success: false, message: 'Failed to process PDF: ' + e.message};
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
 * Find ALL matching orders for a card (handles multiple orders with same card)
 * Returns array of {orderNumber, buyerName, quantity}
 */
function findAllMatchingOrders(cardName, setName, condition, collectorNum, orders) {
  // Normalize names (exact / base / loose) for robust matching
  const normalizedCardName = normalizeNameExact(cardName);
  const baseCardName = normalizeNameExact(stripParentheticals(cardName));
  const looseCardName = normalizeNameLoose(cardName);
  const normalizedSetName = setName.toLowerCase().trim();
  const normalizedCondition = normalizeCondition(condition);
  const normalizedCollector = normalizeCollector(collectorNum);

  const exactMatches = [];
  const fallbackMatches = [];
  const collectorMatches = [];

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

      // Exact match (name + set + condition)
      if (matchesName && matchesSet && matchesCondition) {
        exactMatches.push({
          orderNumber: order.orderNumber,
          buyerName: order.buyerName,
          quantity: card.quantity || 1
        });
      }
      // Fallback match (name + set, but condition differs)
      else if (matchesName && matchesSet && !matchesCondition) {
        fallbackMatches.push({
          orderNumber: order.orderNumber,
          buyerName: order.buyerName,
          quantity: card.quantity || 1,
          pdfCondition: normalizeCondition(card.condition),
          csvCondition: normalizedCondition
        });
      }
      // Collector number match
      else {
        const pdfCollector = normalizeCollector(card.collectorNumber);
        if (normalizedCollector && pdfCollector && normalizedCollector === pdfCollector && (matchesSet || matchesName)) {
          collectorMatches.push({
            orderNumber: order.orderNumber,
            buyerName: order.buyerName,
            quantity: card.quantity || 1
          });
        }
      }
    }
  }

  // Return exact matches if found
  if (exactMatches.length > 0) {
    if (exactMatches.length > 1) {
      Logger.log('  INFO: Found ' + exactMatches.length + ' exact matches in different orders');
    }
    return exactMatches;
  }

  // Return fallback matches if no exact matches
  if (fallbackMatches.length > 0) {
    Logger.log('  INFO: Using fallback match (condition differs): PDF=' + fallbackMatches[0].pdfCondition + ', CSV=' + fallbackMatches[0].csvCondition);
    return fallbackMatches;
  }

  // Return collector matches if no other matches
  if (collectorMatches.length > 0) {
    Logger.log('  INFO: Using collector# fallback (' + collectorMatches.length + ' matches)');
    return collectorMatches;
  }

  return [];
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

    // Track rows to insert (for multiple-order matches)
    const rowsToInsert = [];

    // Start from row 3 (rows 1-2 are headers, data starts at row 3)
    for (let i = 2; i < data.length; i++) {
      const row = data[i];
      const cardName = row[QUEUE_CONFIG.HELPER_COLS.CARD_NAME];
      const setName = row[QUEUE_CONFIG.HELPER_COLS.SET_NAME];
      const condition = row[QUEUE_CONFIG.HELPER_COLS.CONDITION];
      const collectorNum = row[QUEUE_CONFIG.HELPER_COLS.COLLECTOR_NUM];
      const rowSQ = row[QUEUE_CONFIG.HELPER_COLS.SQ_NUMBER];
      const rowQty = row[QUEUE_CONFIG.HELPER_COLS.QTY] || 1;

      // Only process rows for this SQ
      if (rowSQ !== sqNumber) continue;
      if (!cardName) continue; // Skip empty rows

      Logger.log('Row ' + (i + 1) + ': Looking for match - ' + cardName + ' | ' + setName + ' | ' + condition + ' | Qty: ' + rowQty);

      // Use sophisticated multi-level matching - NOW RETURNS ARRAY
      const matchedOrders = findAllMatchingOrders(cardName, setName, condition, collectorNum, parsedOrders);

      if (matchedOrders.length > 0) {
        Logger.log('  ✓ Found ' + matchedOrders.length + ' matching order(s)');

        // Check if all matches are from the SAME order (same orderNumber + buyerName)
        const uniqueOrders = [];
        for (const order of matchedOrders) {
          const existingOrder = uniqueOrders.find(o =>
            o.orderNumber === order.orderNumber && o.buyerName === order.buyerName
          );

          if (existingOrder) {
            // Same order - add to quantity
            existingOrder.quantity += order.quantity;
          } else {
            // New unique order
            uniqueOrders.push({
              orderNumber: order.orderNumber,
              buyerName: order.buyerName,
              quantity: order.quantity
            });
          }
        }

        Logger.log('  → Consolidated to ' + uniqueOrders.length + ' unique order(s) (same card may appear multiple times in PDF)');

        // Fill first match in existing row
        helperSheet.getRange(i + 1, 8).setValue(uniqueOrders[0].orderNumber); // Column H
        helperSheet.getRange(i + 1, 9).setValue(uniqueOrders[0].buyerName); // Column I
        // Set quantity to total quantity for this order
        helperSheet.getRange(i + 1, 17).setValue(uniqueOrders[0].quantity); // Column Q (qty)
        matchCount++;

        // Save order/buyer info to return
        orderNumber = uniqueOrders[0].orderNumber;
        buyerName = uniqueOrders[0].buyerName;

        Logger.log('    Order 1: ' + uniqueOrders[0].orderNumber + ' (' + uniqueOrders[0].buyerName + ') - Total Qty: ' + uniqueOrders[0].quantity);

        // If multiple DIFFERENT orders (different buyers), insert additional rows
        if (uniqueOrders.length > 1) {
          Logger.log('  ⚠️ Multiple different orders found! Need to insert ' + (uniqueOrders.length - 1) + ' additional row(s)');

          for (let j = 1; j < uniqueOrders.length; j++) {
            const additionalOrder = uniqueOrders[j];
            Logger.log('    Order ' + (j + 1) + ': ' + additionalOrder.orderNumber + ' (' + additionalOrder.buyerName + ') - Total Qty: ' + additionalOrder.quantity);

            // Copy the entire row
            const newRow = row.slice(); // Clone array
            // Update with new order/buyer/qty
            newRow[QUEUE_CONFIG.HELPER_COLS.ORDER_NUMBER] = additionalOrder.orderNumber;
            newRow[QUEUE_CONFIG.HELPER_COLS.BUYER_NAME] = additionalOrder.buyerName;
            newRow[QUEUE_CONFIG.HELPER_COLS.QTY] = additionalOrder.quantity;

            // Track row to insert after current row
            rowsToInsert.push({
              afterRow: i + 1, // Insert after this row (1-based sheet row number)
              data: newRow
            });

            matchCount++;
          }
        }
      } else {
        Logger.log('  ✗ No match found for: ' + cardName);
      }
    }

    // Insert additional rows (work backwards to maintain row indices)
    if (rowsToInsert.length > 0) {
      Logger.log('Inserting ' + rowsToInsert.length + ' additional rows for multiple-order matches');
      rowsToInsert.sort((a, b) => b.afterRow - a.afterRow); // Sort descending

      for (const insert of rowsToInsert) {
        helperSheet.insertRowAfter(insert.afterRow);
        const newRowNum = insert.afterRow + 1;
        // Write all columns (A through Q)
        helperSheet.getRange(newRowNum, 1, 1, insert.data.length).setValues([insert.data]);
      }
    }

    SpreadsheetApp.flush();

    Logger.log('Matched ' + matchCount + ' items');

    if (matchCount === 0) {
      return {success: false, message: 'No matching cards found in PDF'};
    }

    // Read back ALL updated rows from Helper Doc to get per-row order/buyer data
    SpreadsheetApp.flush(); // Make sure all writes are committed before reading

    const updatedItems = [];

    // Re-read the ENTIRE Helper Doc to get fresh data after our writes
    const freshData = helperSheet.getDataRange().getValues();
    Logger.log('Re-read Helper Doc - total rows: ' + freshData.length);

    for (let i = 2; i < freshData.length; i++) {
      const row = freshData[i];
      const rowSQ = row[QUEUE_CONFIG.HELPER_COLS.SQ_NUMBER];

      if (rowSQ !== sqNumber) continue;
      if (!row[QUEUE_CONFIG.HELPER_COLS.CARD_NAME]) continue;

      // Log the RAW data from the row to see what we're actually reading
      Logger.log('  Row ' + (i + 1) + ' RAW data:');
      Logger.log('    Column H (index 7, orderNumber): "' + row[7] + '" (type: ' + typeof row[7] + ')');
      Logger.log('    Column I (index 8, buyerName): "' + row[8] + '" (type: ' + typeof row[8] + ')');
      Logger.log('    Column L (index 11, cardName): "' + row[11] + '"');

      const item = {
        orderNumber: row[QUEUE_CONFIG.HELPER_COLS.ORDER_NUMBER] || '',  // Column H (index 7)
        buyerName: row[QUEUE_CONFIG.HELPER_COLS.BUYER_NAME] || '',      // Column I (index 8)
        sqNumber: row[QUEUE_CONFIG.HELPER_COLS.SQ_NUMBER],              // Column J (index 9)
        game: row[QUEUE_CONFIG.HELPER_COLS.GAME],                       // Column K (index 10)
        cardName: row[QUEUE_CONFIG.HELPER_COLS.CARD_NAME],              // Column L (index 11)
        collectorNum: row[QUEUE_CONFIG.HELPER_COLS.COLLECTOR_NUM],      // Column M (index 12)
        rarity: row[QUEUE_CONFIG.HELPER_COLS.RARITY],                   // Column N (index 13)
        setName: row[QUEUE_CONFIG.HELPER_COLS.SET_NAME],                // Column O (index 14)
        condition: row[QUEUE_CONFIG.HELPER_COLS.CONDITION],             // Column P (index 15)
        qty: row[QUEUE_CONFIG.HELPER_COLS.QTY]                          // Column Q (index 16)
      };

      Logger.log('  Item ' + (updatedItems.length + 1) + ': ' + item.cardName + ' → Order: "' + item.orderNumber + '", Buyer: "' + item.buyerName + '"');
      updatedItems.push(item);
    }

    Logger.log('Total updatedItems: ' + updatedItems.length);

    return {
      success: true,
      matchCount: matchCount,
      message: 'Matched ' + matchCount + ' items',
      updatedItems: updatedItems  // Return complete array with per-row data
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
 * Acquire exclusive session lock for a bot via Convex
 * Prevents multiple users from using the same bot simultaneously
 */
function acquireBotSession(botId) {
  try {
    const startTime = new Date().getTime();
    const url = QUEUE_CONFIG.CONVEX_URL + '/bot-manager/acquire-session';
    const payload = JSON.stringify({ botId });

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: payload,
      muteHttpExceptions: true,
      timeout: 10 // 10 second timeout for HTTP request
    };

    const response = UrlFetchApp.fetch(url, options);
    const elapsed = new Date().getTime() - startTime;
    Logger.log('[' + botId + '] Session acquisition took ' + elapsed + 'ms');

    const result = JSON.parse(response.getContentText());

    if (result.success) {
      Logger.log('[' + botId + '] Session lock acquired via Convex');
    } else {
      Logger.log('[' + botId + '] Could not acquire session: ' + result.message);
    }

    return result;

  } catch (e) {
    Logger.log('ERROR in acquireBotSession: ' + e);
    return {success: false, message: 'Exception: ' + e.message};
  }
}

/**
 * Release bot session lock via Convex
 */
function releaseBotSession(botId) {
  try {
    const url = QUEUE_CONFIG.CONVEX_URL + '/bot-manager/release-session';
    const payload = JSON.stringify({ botId });

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: payload,
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());

    Logger.log('[' + botId + '] Session lock released via Convex');
    return result;

  } catch (e) {
    Logger.log('ERROR in releaseBotSession: ' + e);
    return {success: false, message: 'Exception: ' + e.message};
  }
}

/**
 * Renew bot session lock (heartbeat) via Convex
 * Also used as touchSession - updates activity timestamp
 */
function renewBotSession(botId) {
  return touchBotSession(botId);
}

/**
 * Touch bot session to reset inactivity timer via Convex
 * Called on every user action (pullNextSQ, uploadPDF, uploadToRefundLog, etc.)
 */
function touchBotSession(botId) {
  try {
    const url = QUEUE_CONFIG.CONVEX_URL + '/bot-manager/touch-session';
    const payload = JSON.stringify({ botId });

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: payload,
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());

    return result;

  } catch (e) {
    Logger.log('ERROR in touchBotSession: ' + e);
    return {success: false, message: 'Exception: ' + e.message};
  }
}

/**
 * Force release bot session (for cleanup / admin override)
 * Just calls the regular release function via Convex
 */
function forceReleaseBotSession(botId) {
  return releaseBotSession(botId);
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
