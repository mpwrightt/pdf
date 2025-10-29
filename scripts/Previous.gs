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
  DISCREP_LOG_ID: '1kclj3INA5M_sq3a-upgBclFJSZTWVqVV8elxJ3xLIZs',
  REFUND_LOG_ID: '12LX6r_7HW6oNeT6tNKx5PRBrd9R36eMuTuhNU_2zy14',
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

      case 'loadFromHelperDoc':
        result = loadFromHelperDoc(botId);
        break;

      case 'getSQList':
        result = getSQList(botId);
        break;

      case 'loadSingleSQ':
        result = loadSingleSQ(botId, params.sqNumber);
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

      case 'syncAllItemsToHelper':
        result = syncAllItemsToHelper(botId, params.items);
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
 * Build SQ link dynamically from SQ number
 * SQ format: YYMMDD-number (e.g., 251019-200rpb)
 * Returns URL to TCGplayer SQ admin page
 */
function buildSQLink(sqNumber) {
  if (!sqNumber || typeof sqNumber !== 'string') {
    return '';
  }

  try {
    // Extract date parts from SQ number (first 6 digits: YYMMDD)
    const year = '20' + sqNumber.substring(0, 2);  // 25 → 2025
    const month = sqNumber.substring(2, 4);        // 10
    const day = sqNumber.substring(4, 6);          // 19

    // Build start date (format: MM/DD/YYYY)
    const startDate = month + '%2F' + day + '%2F' + year;

    // Build end date (next day)
    const nextDay = parseInt(day) + 1;
    const endDate = month + '%2F' + nextDay + '%2F' + year;

    // Build full URL
    const url = 'https://store.tcgplayer.com/admin/SQ' +
      '?Created=false&Processing=false&Packaged=false&Shipped=false' +
      '&ShippingQueueNumber=' + sqNumber +
      '&sDate=' + startDate +
      '&eDate=' + endDate;

    return url;
  } catch (e) {
    Logger.log('ERROR building SQ link for ' + sqNumber + ': ' + e);
    return '';
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
        const cardName = rowData[COL_CARD_NAME] || '';

        // VALIDATION: Skip rows with no card name
        if (!cardName || cardName.trim() === '') {
          Logger.log('[' + botId + '] ⚠️ Skipping row ' + rowIdx + ' of SQ ' + sqNumber + ' - no card name');
          continue; // Skip this row
        }

        itemsForSQ.push({
          rowIndex: rowIdx,
          sqNumber: sqNumber,
          game: rowData[GAME_IDX] || 'Magic: The Gathering',
          cardName: cardName,
          collectorNum: rowData[COL_COLLECTOR_NUM] || '',
          rarity: rowData[COL_RARITY] || '',
          setName: rowData[COL_SET_NAME] || '',
          condition: rowData[COL_CONDITION] || '',
          qty: rowData[COL_QTY] || 1
        });
      }

      Logger.log('[' + botId + '] Read full data for ' + itemsForSQ.length + ' rows');

      // VALIDATION: Skip this SQ entirely if no valid rows found
      if (itemsForSQ.length === 0) {
        Logger.log('[' + botId + '] ⚠️ Skipping entire SQ ' + sqNumber + ' - no valid card data found');
        releaseSQ(botId, sqNumber);
        continue; // Try next SQ
      }

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

              // Wait for formulas to load (order/buyer data)
              Utilities.sleep(2000);
              checkTimeout('waiting for Helper Doc formulas');

              // Build SQ link dynamically from SQ number (more reliable than reading from formula)
              sqLink = buildSQLink(sqNumber);
              if (sqLink) {
                Logger.log('[' + botId + '] Built SQ link: ' + sqLink);
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
  const TIMEOUT_MS = 300000; // 5 minutes (leave 60s buffer for cleanup before Apps Script 6-min limit)

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
    Logger.log('[' + botId + '] Found ' + uniqueSQs.length + ' unclaimed SQ(s) in Discrepancy Log');

    if (uniqueSQs.length === 0) {
      return {success: false, message: 'No unclaimed SQs available', sqBatch: null};
    }

    // IMPORTANT: Clear Helper Doc FIRST (before filtering) to prevent race condition
    // If we filter before clearing, leftover SQs from previous session get excluded incorrectly
    checkTimeout('pre-helper-doc-clear');
    const helperDocId = QUEUE_CONFIG.HELPER_DOCS[botId];

    if (!helperDocId) {
      return {success: false, message: 'Helper Doc not configured for ' + botId, sqBatch: null};
    }

    const helperDoc = SpreadsheetApp.openById(helperDocId);
    const helperSheet = helperDoc.getSheetByName(QUEUE_CONFIG.HELPER_SHEET_NAME);

    if (!helperSheet) {
      return {success: false, message: 'Helper sheet not found', sqBatch: null};
    }

    // Clear existing data from Helper Doc
    const lastRow = helperSheet.getLastRow();
    if (lastRow > 2) {
      helperSheet.getRange(3, 1, lastRow - 2, helperSheet.getLastColumn()).clearContent();
      Logger.log('[' + botId + '] Cleared Helper Doc (had ' + (lastRow - 2) + ' rows)');
    }

    // Now check Helper Doc for already-pulled SQs (should be empty after clearing above)
    // This section kept for safety in case clearing failed or was skipped
    checkTimeout('pre-helper-doc-check');
    const alreadyPulledSQs = new Set();

    try {
      if (helperSheet && helperSheet.getLastRow() > 2) {
        // Read SQ numbers from Helper Doc (column J, starting from row 3)
        const helperSQs = helperSheet.getRange(3, 10, helperSheet.getLastRow() - 2, 1).getValues();

        for (let i = 0; i < helperSQs.length; i++) {
          const sqNum = helperSQs[i][0];
          if (sqNum) {
            alreadyPulledSQs.add(sqNum);
          }
        }

        Logger.log('[' + botId + '] Helper Doc already contains ' + alreadyPulledSQs.size + ' SQ(s)');
      }
    } catch (helperError) {
      Logger.log('[' + botId + '] Warning: Could not check Helper Doc: ' + helperError);
      // Continue anyway - this is just a safety check
    }

    // Filter out SQs that are already in Helper Doc
    const newSQs = uniqueSQs.filter(function(sqNumber) {
      if (alreadyPulledSQs.has(sqNumber)) {
        Logger.log('[' + botId + '] ⚠️ Skipping SQ ' + sqNumber + ' - already in Helper Doc');
        return false;
      }
      return true;
    });

    Logger.log('[' + botId + '] After filtering: ' + newSQs.length + ' new SQ(s) to claim');

    if (newSQs.length === 0) {
      return {success: false, message: 'All unclaimed SQs are already in Helper Doc. Clear Helper Doc to pull fresh batch.', sqBatch: null};
    }

    // BATCH PROCESSING: Accumulate data for multiple SQs, then write in batches
    // This is MUCH faster than writing each SQ individually
    const claimedSQs = [];
    const sqBatch = []; // Array of {sqNumber, sqLink, rowCount, rows: [...]}
    let currentRow = 3; // Track current write position in Helper Doc

    // Batch accumulation buffers
    const BATCH_SIZE = 10; // Process 10 SQs at a time for optimal performance
    let batchHelperData = []; // Accumulated Helper Doc rows for this batch
    let batchDisccrepUpdates = []; // Accumulated Discrep Log updates: [{rowIdx, botId, timestamp}, ...]
    let totalRowsClaimed = 0; // Track total rows claimed across all batches

    // IMPORTANT: Only claim batchSize SQs to keep Helper Doc small and fast
    // This prevents performance degradation from large Helper Doc sizes
    const sqsToProcess = Math.min(batchSize || 20, newSQs.length);
    Logger.log('[' + botId + '] Reading card data for ' + sqsToProcess + ' SQ(s) (out of ' + newSQs.length + ' available)...');
    Logger.log('[' + botId + '] Using BATCH processing strategy - write ' + BATCH_SIZE + ' SQs at a time');

    for (let sqIdx = 0; sqIdx < sqsToProcess; sqIdx++) {
      checkTimeout('SQ batch loop iteration ' + sqIdx);

      const sqNumber = newSQs[sqIdx];
      const rowIndices = unclaimedSQMap[sqNumber];

      Logger.log('[' + botId + '] [' + (sqIdx + 1) + '/' + sqsToProcess + '] Processing SQ: ' + sqNumber + ' (' + rowIndices.length + ' rows)');

      // Read full data for all rows of this SQ (OPTIMIZED: batch read)
      const itemsForSQ = [];
      const GAME_IDX = 3;

      // OPTIMIZATION: Read all rows for this SQ in one batch instead of one-by-one
      if (rowIndices.length === 1) {
        // Single row - direct read
        const rowData = discrepSheet.getRange(rowIndices[0], 1, 1, 23).getValues()[0];
        const cardName = rowData[COL_CARD_NAME] || '';

        // VALIDATION: Skip rows with no card name
        if (!cardName || cardName.trim() === '') {
          Logger.log('[' + botId + '] ⚠️ Skipping SQ ' + sqNumber + ' - row ' + rowIndices[0] + ' has no card name');
          continue; // Skip this SQ
        }

        itemsForSQ.push({
          rowIndex: rowIndices[0],
          sqNumber: sqNumber,
          game: rowData[GAME_IDX] || 'Magic: The Gathering',
          cardName: cardName,
          collectorNum: rowData[COL_COLLECTOR_NUM] || '',
          rarity: rowData[COL_RARITY] || '',
          setName: rowData[COL_SET_NAME] || '',
          condition: rowData[COL_CONDITION] || '',
          qty: rowData[COL_QTY] || 1
        });
      } else {
        // Multiple rows - batch read
        // Find min/max row indices for contiguous read
        const minRow = Math.min(...rowIndices);
        const maxRow = Math.max(...rowIndices);
        const rowCount = maxRow - minRow + 1;

        // Read all rows in range
        const allRowsData = discrepSheet.getRange(minRow, 1, rowCount, 23).getValues();

        // Extract only the rows we need (in case there are gaps)
        for (const rowIdx of rowIndices) {
          const offsetIdx = rowIdx - minRow;
          const rowData = allRowsData[offsetIdx];
          const cardName = rowData[COL_CARD_NAME] || '';

          // VALIDATION: Skip rows with no card name
          if (!cardName || cardName.trim() === '') {
            Logger.log('[' + botId + '] ⚠️ Skipping row ' + rowIdx + ' of SQ ' + sqNumber + ' - no card name');
            continue; // Skip this row
          }

          itemsForSQ.push({
            rowIndex: rowIdx,
            sqNumber: sqNumber,
            game: rowData[GAME_IDX] || 'Magic: The Gathering',
            cardName: cardName,
            collectorNum: rowData[COL_COLLECTOR_NUM] || '',
            rarity: rowData[COL_RARITY] || '',
            setName: rowData[COL_SET_NAME] || '',
            condition: rowData[COL_CONDITION] || '',
            qty: rowData[COL_QTY] || 1
          });
        }
      }

      // VALIDATION: Skip this SQ entirely if no valid rows found
      if (itemsForSQ.length === 0) {
        Logger.log('[' + botId + '] ⚠️ Skipping entire SQ ' + sqNumber + ' - no valid card data found');
        continue; // Skip to next SQ
      }

      // BATCH ACCUMULATION: Add this SQ's data to batch buffers
      checkTimeout('pre-batch-accumulation for SQ ' + sqNumber);

      const now = new Date();

      // Accumulate Helper Doc data
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
      batchHelperData.push(...rowsData);

      // Accumulate Discrep Log updates (row indices for batch claiming)
      for (const item of itemsForSQ) {
        batchDisccrepUpdates.push({
          rowIdx: item.rowIndex,
          botId: botId,
          timestamp: now
        });
      }

      // Store for final processing
      claimedSQs.push({sqNumber: sqNumber, items: itemsForSQ});

      // BATCH CHECKPOINT: Write when we've accumulated BATCH_SIZE SQs OR reached last SQ
      const isLastSQ = (sqIdx === sqsToProcess - 1);
      const isBatchFull = ((sqIdx + 1) % BATCH_SIZE === 0);

      if (isBatchFull || isLastSQ) {
        Logger.log('[' + botId + '] ✓ Batch checkpoint at SQ ' + (sqIdx + 1) + '/' + sqsToProcess + ' - writing ' + batchHelperData.length + ' rows');

        // Step 1: CLAIM all rows in Discrep Log (OPTIMIZED BATCH WRITE)
        if (batchDisccrepUpdates.length > 0) {
          // Sort updates by row index for efficient batch processing
          batchDisccrepUpdates.sort((a, b) => a.rowIdx - b.rowIdx);

          // Group into contiguous ranges and write each range in one API call
          let rangeStart = 0;
          for (let i = 0; i < batchDisccrepUpdates.length; i++) {
            const isLastUpdate = (i === batchDisccrepUpdates.length - 1);
            const isContiguous = !isLastUpdate && (batchDisccrepUpdates[i + 1].rowIdx === batchDisccrepUpdates[i].rowIdx + 1);

            if (!isContiguous || isLastUpdate) {
              // Write this contiguous range (single batch API call)
              const rangeEnd = i;
              const rangeSize = rangeEnd - rangeStart + 1;
              const firstRowIdx = batchDisccrepUpdates[rangeStart].rowIdx;

              // Build 2D arrays for each column (columns O, P, R are not contiguous - column Q is skipped)
              const initialsData = [];
              const resolutionData = [];
              const solveData = [];

              for (let j = rangeStart; j <= rangeEnd; j++) {
                initialsData.push([batchDisccrepUpdates[j].botId]);
                resolutionData.push(['Missing Note']);
                solveData.push([batchDisccrepUpdates[j].timestamp]);
              }

              // 3 batch writes (one per column) - still much faster than row-by-row
              discrepSheet.getRange(firstRowIdx, COL_INITIALS + 1, rangeSize, 1).setValues(initialsData);
              discrepSheet.getRange(firstRowIdx, COL_RESOLUTION_TYPE + 1, rangeSize, 1).setValues(resolutionData);
              discrepSheet.getRange(firstRowIdx, COL_SOLVE_DATE + 1, rangeSize, 1).setValues(solveData);

              // Move to next range
              rangeStart = i + 1;
            }
          }
          totalRowsClaimed += batchDisccrepUpdates.length;
          Logger.log('[' + botId + '] ✓ Claimed ' + batchDisccrepUpdates.length + ' rows in Discrep Log (batch optimized)');
        }

        // Step 2: Write all rows to Helper Doc (BATCH WRITE - single API call)
        if (batchHelperData.length > 0) {
          helperSheet.getRange(currentRow, 10, batchHelperData.length, 8).setValues(batchHelperData);
          currentRow += batchHelperData.length;
          Logger.log('[' + botId + '] ✓ Wrote ' + batchHelperData.length + ' rows to Helper Doc (now at row ' + currentRow + ')');
        }

        // Step 3: Flush to commit batch
        SpreadsheetApp.flush();
        Logger.log('[' + botId + '] ✓ Flushed batch: ' + (currentRow - 3) + ' total rows in Helper Doc, ' + batchDisccrepUpdates.length + ' rows claimed in Discrep Log');

        // Clear batch buffers for next batch
        batchHelperData = [];
        batchDisccrepUpdates = [];
      }
    }

    // Final flush to ensure all data is written
    SpreadsheetApp.flush();

    if (claimedSQs.length === 0) {
      return {success: false, message: 'Failed to read any SQ data from batch', sqBatch: null};
    }

    Logger.log('[' + botId + '] ✓ Successfully wrote ' + (currentRow - 3) + ' rows from ' + claimedSQs.length + ' SQ(s) to Helper Doc');
    Logger.log('[' + botId + '] ✓ Successfully claimed ' + totalRowsClaimed + ' rows in Discrepancy Log');

    // IMPORTANT: Both Helper Doc write AND Discrep Log claiming are now COMPLETE
    // If timeout happens after this point, all processed SQs are fully saved and claimed
    checkTimeout('post-batch-processing');

    // Wait for Helper Doc formulas to populate (order/buyer data)
    Logger.log('[' + botId + '] Waiting 2 seconds for Helper Doc formulas to populate...');
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

        // Build SQ link dynamically from SQ number (first row only)
        if (i === 0) {
          sqLink = buildSQLink(sq.sqNumber);
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

    // IMPORTANT: Don't return full sqBatch - it's too large for google.script.run serialization
    // Instead, return just the SQ numbers and let UI call loadFromHelperDoc() to get the data
    const sqNumbers = sqBatch.map(sq => sq.sqNumber);

    const result = {
      success: true,
      message: 'Claimed ' + sqBatch.length + ' SQs successfully',
      sqNumbers: sqNumbers, // Just SQ numbers, not full data
      totalSQs: sqBatch.length,
      totalRows: rowIdx,
      useResume: true // Tell UI to call loadFromHelperDoc() to get full data
    };

    Logger.log('[' + botId + '] Returning lightweight result with ' + sqNumbers.length + ' SQ numbers');
    Logger.log('[' + botId + '] UI will call loadFromHelperDoc() to fetch full data');

    return result;

  } catch (e) {
    Logger.log('ERROR in pullNextBatchOfSQs: ' + e);
    return {success: false, message: 'Exception: ' + e.message, sqBatch: null};
  }
}

/**
 * Load existing SQ data from Helper Doc (for resuming interrupted sessions)
 * Reads all data from Helper Doc and reconstructs the sqBatch structure
 * Same format as pullNextBatchOfSQs() so UI can process it identically
 */
function loadFromHelperDoc(botId) {
  try {
    Logger.log('[' + botId + '] Loading existing data from Helper Doc...');

    // Get Helper Doc for this bot
    const helperDocId = QUEUE_CONFIG.HELPER_DOCS[botId];
    if (!helperDocId) {
      return {success: false, message: 'Helper Doc not configured for ' + botId, sqBatch: null};
    }

    const helperDoc = SpreadsheetApp.openById(helperDocId);
    const helperSheet = helperDoc.getSheetByName(QUEUE_CONFIG.HELPER_SHEET_NAME);

    if (!helperSheet) {
      return {success: false, message: 'Helper sheet not found', sqBatch: null};
    }

    // Read ALL data from Helper Doc (columns A-Q, starting from row 3)
    const lastRow = helperSheet.getLastRow();

    if (lastRow < 3) {
      return {success: false, message: 'Helper Doc is empty - no SQs to resume', sqBatch: null};
    }

    // Read all data (columns A-Q = 17 columns)
    const allData = helperSheet.getRange(3, 1, lastRow - 2, 17).getValues();

    Logger.log('[' + botId + '] Read ' + allData.length + ' rows from Helper Doc');

    // Group rows by SQ number
    const sqGroups = {}; // {sqNumber: [{rowData}, {rowData}, ...]}

    for (let i = 0; i < allData.length; i++) {
      const row = allData[i];
      const sqNumber = row[9]; // Column J (SQ Number) - index 9

      // Skip rows with no SQ number
      if (!sqNumber) {
        Logger.log('[' + botId + '] ⚠️ Skipping row ' + (i + 3) + ' - no SQ number');
        continue;
      }

      if (!sqGroups[sqNumber]) {
        sqGroups[sqNumber] = [];
      }

      // Store row data with column mappings
      sqGroups[sqNumber].push({
        orderNumber: row[7] || '',   // Column H (index 7)
        buyerName: row[8] || '',     // Column I (index 8)
        sqNumber: row[9],            // Column J (index 9)
        game: row[10] || 'Magic: The Gathering', // Column K (index 10)
        cardName: row[11] || '',     // Column L (index 11)
        collectorNum: row[12] || '', // Column M (index 12)
        rarity: row[13] || '',       // Column N (index 13)
        setName: row[14] || '',      // Column O (index 14)
        condition: row[15] || '',    // Column P (index 15)
        qty: row[16] || 1,           // Column Q (index 16)
        sqLink: '',                  // Will be populated from column G
        rowIndex: i + 3              // Store original row number for debugging
      });
    }

    // Convert to sqBatch array format (same as pullNextBatchOfSQs)
    const sqBatch = [];

    for (const sqNumber in sqGroups) {
      const rows = sqGroups[sqNumber];

      // Build SQ link dynamically from SQ number
      const sqLink = buildSQLink(sqNumber);

      // Update sqLink for all rows and remove rowIndex (not needed in UI)
      const cleanRows = rows.map(row => {
        return {
          orderNumber: row.orderNumber,
          buyerName: row.buyerName,
          sqNumber: row.sqNumber,
          game: row.game,
          cardName: row.cardName,
          collectorNum: row.collectorNum,
          rarity: row.rarity,
          setName: row.setName,
          condition: row.condition,
          qty: row.qty,
          sqLink: sqLink
        };
      });

      sqBatch.push({
        sqNumber: sqNumber,
        sqLink: sqLink,
        rowCount: cleanRows.length,
        rows: cleanRows
      });
    }

    const totalRows = allData.length;
    const totalSQs = sqBatch.length;

    Logger.log('[' + botId + '] 🎉 Successfully loaded ' + totalSQs + ' SQ(s) (' + totalRows + ' rows) from Helper Doc');
    Logger.log('[' + botId + '] Building result object...');

    const result = {
      success: true,
      message: 'Loaded ' + totalSQs + ' SQ(s) from Helper Doc',
      sqBatch: sqBatch,
      totalSQs: totalSQs,
      totalRows: totalRows
    };

    Logger.log('[' + botId + '] Result object created successfully');
    Logger.log('[' + botId + '] result.success = ' + result.success);
    Logger.log('[' + botId + '] result.totalSQs = ' + result.totalSQs);
    Logger.log('[' + botId + '] result.sqBatch type = ' + typeof result.sqBatch);
    Logger.log('[' + botId + '] result.sqBatch.length = ' + result.sqBatch.length);

    // Try to stringify to see if serialization is the issue
    try {
      const jsonStr = JSON.stringify(result);
      Logger.log('[' + botId + '] JSON serialization successful, size = ' + jsonStr.length + ' bytes');
    } catch (jsonError) {
      Logger.log('[' + botId + '] ERROR: JSON serialization failed: ' + jsonError.message);
      return {success: false, message: 'Failed to serialize result: ' + jsonError.message};
    }

    Logger.log('[' + botId + '] About to return result...');
    return result;

  } catch (e) {
    Logger.log('ERROR in loadFromHelperDoc: ' + e);
    return {success: false, message: 'Exception: ' + e.message, sqBatch: null};
  }
}

// Global in-memory cache to avoid repeated Script Properties reads in same execution
const _rowRangesMemoryCache = {};

/**
 * Cache row ranges in Script Properties for fast lookups
 * Prevents re-scanning entire Helper Doc for every operation
 * @param {string} botId - Bot identifier
 * @param {Object} sqRowRanges - Map of SQ numbers to {startRow, endRow}
 */
function cacheRowRanges(botId, sqRowRanges) {
  try {
    // Update memory cache first (instant)
    _rowRangesMemoryCache[botId] = sqRowRanges;

    // Then persist to Script Properties (slower, but survives across executions)
    const key = 'SQ_ROW_RANGES_' + botId;
    PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(sqRowRanges));
    Logger.log('[' + botId + '] Cached row ranges for ' + Object.keys(sqRowRanges).length + ' SQs (memory + Script Properties)');
  } catch (e) {
    Logger.log('[' + botId + '] Warning: Failed to cache row ranges: ' + e.message);
  }
}

/**
 * Get cached row ranges from Script Properties (with in-memory caching)
 * @param {string} botId - Bot identifier
 * @returns {Object|null} Map of SQ numbers to {startRow, endRow} or null if not cached
 */
function getCachedRowRanges(botId) {
  try {
    // Check in-memory cache first (instant!)
    if (_rowRangesMemoryCache[botId]) {
      return _rowRangesMemoryCache[botId];
    }

    // Fall back to Script Properties (slow, but only once per execution)
    const key = 'SQ_ROW_RANGES_' + botId;
    const cached = PropertiesService.getScriptProperties().getProperty(key);
    if (cached) {
      const ranges = JSON.parse(cached);
      Logger.log('[' + botId + '] Retrieved cached row ranges for ' + Object.keys(ranges).length + ' SQs from Script Properties');

      // Store in memory cache for future calls in this execution
      _rowRangesMemoryCache[botId] = ranges;

      return ranges;
    }
    return null;
  } catch (e) {
    Logger.log('[' + botId + '] Warning: Failed to retrieve cached row ranges: ' + e.message);
    return null;
  }
}

/**
 * Clear cached row ranges (called after upload to Refund Log)
 * @param {string} botId - Bot identifier
 */
function clearRowRangesCache(botId) {
  try {
    // Clear both memory and persistent cache
    delete _rowRangesMemoryCache[botId];

    const key = 'SQ_ROW_RANGES_' + botId;
    PropertiesService.getScriptProperties().deleteProperty(key);
    Logger.log('[' + botId + '] Cleared cached row ranges (memory + Script Properties)');
  } catch (e) {
    Logger.log('[' + botId + '] Warning: Failed to clear cached row ranges: ' + e.message);
  }
}

/**
 * Refresh cache for next batch of SQs
 * Called when moving to a new batch to keep cache small and fast
 * @param {string} botId - Bot identifier
 * @param {number} batchSize - Number of SQs to cache (e.g., 20)
 * @returns {Object} - {success, message, cachedCount}
 */
function refreshCacheForNextBatch(botId, batchSize) {
  try {
    Logger.log('[' + botId + '] Refreshing cache for next batch of ' + batchSize + ' SQs...');

    // Call getSQList with batchSize to rebuild cache
    const result = getSQList(botId, batchSize);

    if (!result.success) {
      return {success: false, message: result.message};
    }

    return {
      success: true,
      message: 'Cached ' + batchSize + ' SQs',
      cachedCount: result.incompleteCount > 0 ? Math.min(batchSize, result.incompleteCount) : 0
    };
  } catch (e) {
    Logger.log('[' + botId + '] ERROR in refreshCacheForNextBatch: ' + e);
    return {success: false, message: 'Exception: ' + e.message};
  }
}

/**
 * Get list of SQ numbers from Helper Doc with completion status
 * Checks which SQs have order/buyer data to determine which ones are already processed
 * Used for smart resume - skips SQs that are already complete
 *
 * @param {string} botId - Bot identifier
 * @param {number} batchSize - Optional: number of incomplete SQs to cache (default: 20)
 *                              Pass null or 0 to cache ALL SQs (not recommended for large batches)
 */
function getSQList(botId, batchSize) {
  try {
    const helperDocId = QUEUE_CONFIG.HELPER_DOCS[botId];
    if (!helperDocId) {
      return {success: false, message: 'Helper Doc not configured for ' + botId};
    }

    const helperDoc = SpreadsheetApp.openById(helperDocId);
    const helperSheet = helperDoc.getSheetByName(QUEUE_CONFIG.HELPER_SHEET_NAME);

    if (!helperSheet) {
      return {success: false, message: 'Helper sheet not found'};
    }

    const lastRow = helperSheet.getLastRow();
    if (lastRow < 3) {
      return {success: false, message: 'Helper Doc is empty'};
    }

    // Read SQ numbers (column J) AND order/buyer data (columns H, I)
    // Columns H-J (8-10): Order#, Buyer, SQ#
    const allData = helperSheet.getRange(3, 8, lastRow - 2, 3).getValues();

    // Build map of SQs with their completion status
    const sqMap = {}; // {sqNumber: {complete: bool, totalRows: num, completeRows: num}}

    for (let i = 0; i < allData.length; i++) {
      const orderNumber = allData[i][0]; // Column H (index 0)
      const buyerName = allData[i][1];   // Column I (index 1)
      const sqNumber = allData[i][2];    // Column J (index 2)

      if (!sqNumber) continue; // Skip empty rows

      // Initialize if first time seeing this SQ
      if (!sqMap[sqNumber]) {
        sqMap[sqNumber] = {
          complete: true, // Assume complete until we find missing data
          totalRows: 0,
          completeRows: 0
        };
      }

      sqMap[sqNumber].totalRows++;

      // Check if this row has order AND buyer data
      if (orderNumber && buyerName) {
        sqMap[sqNumber].completeRows++;
      } else {
        // Missing order or buyer - SQ is incomplete
        sqMap[sqNumber].complete = false;
      }
    }

    // Build arrays of complete and incomplete SQs (in order)
    // ALSO build row range map for fast lookups
    const sqNumbers = [];
    const completedSQs = [];
    const incompleteSQs = [];
    const sqRowRanges = {}; // {sqNumber: {startRow, endRow}} for fast loadSingleSQ
    const seen = new Set();

    for (let i = 0; i < allData.length; i++) {
      const sqNumber = allData[i][2]; // Column J
      if (!sqNumber) continue;

      // Track row range for this SQ
      if (!sqRowRanges[sqNumber]) {
        sqRowRanges[sqNumber] = {
          startRow: i + 3, // Convert to 1-based sheet row number
          endRow: i + 3    // Will be updated as we find more rows
        };
      } else {
        sqRowRanges[sqNumber].endRow = i + 3; // Update end row
      }

      // Only add to sqNumbers array once
      if (seen.has(sqNumber)) continue;

      seen.add(sqNumber);
      sqNumbers.push(sqNumber);

      if (sqMap[sqNumber].complete) {
        completedSQs.push(sqNumber);
      } else {
        incompleteSQs.push(sqNumber);
      }
    }

    const firstIncompleteIndex = incompleteSQs.length > 0 ?
      sqNumbers.indexOf(incompleteSQs[0]) : sqNumbers.length;

    Logger.log('[' + botId + '] Found ' + sqNumbers.length + ' unique SQ(s) in Helper Doc');
    Logger.log('[' + botId + '] Completed: ' + completedSQs.length + ', Incomplete: ' + incompleteSQs.length);
    if (incompleteSQs.length > 0) {
      Logger.log('[' + botId + '] First incomplete SQ: ' + incompleteSQs[0] + ' (index ' + firstIncompleteIndex + ')');
    }

    // OPTIMIZATION: Cache row ranges in MEMORY ONLY (Script Properties is too slow - 30s reads!)
    // UI will pass row ranges as parameters to loadSingleSQ() to avoid cache lookups entirely
    _rowRangesMemoryCache[botId] = sqRowRanges;
    Logger.log('[' + botId + '] Cached ' + Object.keys(sqRowRanges).length + ' SQ row ranges in MEMORY (not Script Properties)');

    return {
      success: true,
      sqNumbers: sqNumbers,
      sqRowRanges: sqRowRanges, // Return FULL map (not just cached portion)
      totalSQs: sqNumbers.length,
      completedCount: completedSQs.length,
      incompleteCount: incompleteSQs.length,
      firstIncompleteIndex: firstIncompleteIndex
    };

  } catch (e) {
    Logger.log('ERROR in getSQList: ' + e);
    return {success: false, message: 'Exception: ' + e.message};
  }
}

/**
 * Load data for a single SQ from Helper Doc (small payload that can be serialized)
 * @param {string} botId - Bot identifier
 * @param {string} sqNumber - SQ number to load
 * @param {number} startRow - Optional: 1-based start row (if known from getSQList)
 * @param {number} endRow - Optional: 1-based end row (if known from getSQList)
 */
function loadSingleSQ(botId, sqNumber, startRow, endRow) {
  try {
    const helperDocId = QUEUE_CONFIG.HELPER_DOCS[botId];
    if (!helperDocId) {
      return {success: false, message: 'Helper Doc not configured for ' + botId};
    }

    let firstDataRow, rowCount;

    // OPTIMIZATION 1: ALWAYS use provided row range if available (UI should always provide this)
    if (startRow && endRow) {
      firstDataRow = startRow;
      rowCount = endRow - startRow + 1;
      Logger.log('[' + botId + '] Using provided row range for ' + sqNumber + ': rows ' + startRow + '-' + endRow + ' (' + rowCount + ' rows)');
    } else {
      // FALLBACK: Check in-memory cache ONLY (don't use Script Properties - too slow!)
      const cachedRanges = _rowRangesMemoryCache[botId];
      const rowRange = cachedRanges ? cachedRanges[sqNumber] : null;

      if (rowRange) {
        // Found in memory cache! Use it
        firstDataRow = rowRange.startRow;
        rowCount = rowRange.endRow - rowRange.startRow + 1;
        Logger.log('[' + botId + '] Using MEMORY cached row range for ' + sqNumber + ': rows ' + rowRange.startRow + '-' + rowRange.endRow + ' (' + rowCount + ' rows)');
      }
    }

    // NOW open the spreadsheet (only once we know what to read)
    const helperDoc = SpreadsheetApp.openById(helperDocId);
    const helperSheet = helperDoc.getSheetByName(QUEUE_CONFIG.HELPER_SHEET_NAME);

    if (!helperSheet) {
      return {success: false, message: 'Helper sheet not found'};
    }

    // If we didn't find row range in cache, need to scan column J
    if (!firstDataRow || !rowCount) {
      const lastRow = helperSheet.getLastRow();
      if (lastRow < 3) {
        return {success: false, message: 'Helper Doc is empty'};
      }

      // Last resort: Scan column J to find row range (slowest option)
      Logger.log('[' + botId + '] No cache found - scanning column J for ' + sqNumber + '...');
      const sqColumn = helperSheet.getRange(3, 10, lastRow - 2, 1).getValues(); // Column J only

      // Find first row with this SQ number
      let startIdx = -1;
      let endIdx = -1;

      for (let i = 0; i < sqColumn.length; i++) {
        const rowSQ = sqColumn[i][0];

        if (rowSQ === sqNumber) {
          if (startIdx === -1) {
            startIdx = i; // First occurrence
          }
        } else if (startIdx !== -1 && rowSQ !== sqNumber) {
          // Found a different SQ after our target SQ - this is the end
          endIdx = i;
          break;
        }
      }

      if (startIdx === -1) {
        return {success: false, message: 'SQ ' + sqNumber + ' not found in Helper Doc'};
      }

      // If endIdx is still -1, this SQ goes to the end of the sheet
      if (endIdx === -1) {
        endIdx = sqColumn.length;
      }

      rowCount = endIdx - startIdx;
      firstDataRow = startIdx + 3;
      Logger.log('[' + botId + '] Found SQ ' + sqNumber + ' at rows ' + firstDataRow + '-' + (firstDataRow + rowCount - 1) + ' (' + rowCount + ' rows)');
    }

    // Now read ONLY the rows for this SQ (much faster than reading everything!)
    const sqData = helperSheet.getRange(firstDataRow, 1, rowCount, 17).getValues();

    // Build SQ link dynamically from SQ number
    const sqLink = buildSQLink(sqNumber);

    // Convert to response format
    const sqRows = [];
    for (let i = 0; i < sqData.length; i++) {
      const row = sqData[i];

      sqRows.push({
        orderNumber: String(row[7] || ''),
        buyerName: String(row[8] || ''),
        sqNumber: String(row[9]),
        game: String(row[10] || 'Magic: The Gathering'),
        cardName: String(row[11] || ''),
        collectorNum: String(row[12] || ''),
        rarity: String(row[13] || ''),
        setName: String(row[14] || ''),
        condition: String(row[15] || ''),
        qty: Number(row[16] || 1)
      });
    }

    Logger.log('[' + botId + '] Loaded SQ ' + sqNumber + ' with ' + sqRows.length + ' rows');

    // Build response
    const response = {
      success: true,
      sqData: {
        sqNumber: String(sqNumber),
        sqLink: String(sqLink),
        rowCount: Number(sqRows.length),
        rows: sqRows
      }
    };

    // Test JSON serialization to catch issues early
    try {
      const jsonTest = JSON.stringify(response);
      Logger.log('[' + botId + '] Response size: ' + jsonTest.length + ' bytes');

      if (jsonTest.length > 50000) {
        Logger.log('[' + botId + '] ⚠️ WARNING: Large response (' + jsonTest.length + ' bytes) may fail serialization');
      }
    } catch (jsonError) {
      Logger.log('[' + botId + '] ERROR: Cannot serialize response: ' + jsonError.message);
      return {success: false, message: 'Data too large to serialize (' + sqRows.length + ' rows)'};
    }

    return response;

  } catch (e) {
    Logger.log('ERROR in loadSingleSQ: ' + e);
    return {success: false, message: 'Exception: ' + e.message};
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

    Logger.log(`uploadToRefundLog: Looking for SQ number: "${sqNumber}"`);

    // Try to get cached row ranges first
    const cachedRanges = getCachedRowRanges(botId);
    const rowRange = cachedRanges ? cachedRanges[sqNumber] : null;

    let helperData;
    let startRow;

    if (rowRange) {
      // Fast path: use cached row range (read only needed rows)
      const rowCount = rowRange.endRow - rowRange.startRow + 1;
      helperData = helperSheet.getRange(rowRange.startRow, 1, rowCount, 17).getValues();
      startRow = rowRange.startRow;
      Logger.log(`uploadToRefundLog: Using cached range for SQ ${sqNumber}: rows ${rowRange.startRow}-${rowRange.endRow}`);
    } else {
      // Fallback: scan column J to find this SQ's row range
      Logger.log(`uploadToRefundLog: No cache found, scanning column J for SQ ${sqNumber}`);
      const sqCol = helperSheet.getRange(3, QUEUE_CONFIG.HELPER_COLS.SQ_NUMBER + 1, helperSheet.getLastRow() - 2, 1).getValues();
      let firstRow = -1;
      let lastRow = -1;

      for (let r = 0; r < sqCol.length; r++) {
        if (sqCol[r][0] === sqNumber) {
          if (firstRow === -1) firstRow = r + 3;
          lastRow = r + 3;
        }
      }

      if (firstRow === -1) {
        Logger.log(`⚠️ uploadToRefundLog: No rows found matching SQ "${sqNumber}"`);
        return {success: false, message: 'No data found in Helper Doc for SQ ' + sqNumber + '. Did you pull this SQ first?', rows: null};
      }

      const rowCount = lastRow - firstRow + 1;
      helperData = helperSheet.getRange(firstRow, 1, rowCount, 17).getValues();
      startRow = firstRow;
    }

    // Extract row data (helperData now contains ONLY this SQ's rows)
    const rowsForSQ = [];
    for (let i = 0; i < helperData.length; i++) {
      const row = helperData[i];
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

      // Clear cached row ranges since Helper Doc is now empty
      clearRowRangesCache(botId);

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

    Logger.log(`uploadBatchToRefundLog: Reading data for ${sqNumbers.length} SQs`);

    // Try to use cached row ranges for efficient reading
    const cachedRanges = getCachedRowRanges(botId);
    const allRowsForBatch = [];

    if (cachedRanges) {
      // Fast path: read only the rows for the SQs in this batch
      Logger.log(`uploadBatchToRefundLog: Using cached ranges for ${sqNumbers.length} SQs`);

      for (const sqNumber of sqNumbers) {
        const rowRange = cachedRanges[sqNumber];
        if (!rowRange) {
          Logger.log(`WARNING: No cached range for SQ ${sqNumber}, skipping`);
          continue;
        }

        const rowCount = rowRange.endRow - rowRange.startRow + 1;
        const sqData = helperSheet.getRange(rowRange.startRow, 1, rowCount, 17).getValues();

        for (let i = 0; i < sqData.length; i++) {
          const row = sqData[i];
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
      Logger.log(`uploadBatchToRefundLog: Read ${allRowsForBatch.length} rows using cached ranges`);
    } else {
      // Fallback: read entire Helper Doc if no cache available
      Logger.log(`uploadBatchToRefundLog: No cache found, reading entire Helper Doc`);
      const helperData = helperSheet.getDataRange().getValues();
      Logger.log(`uploadBatchToRefundLog: Helper Doc has ${helperData.length} total rows (including headers)`);

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
      // Delete rows instead of clearContent to actually remove them (clearContent leaves empty rows which slow down reads)
      const rowsToDelete = helperSheet.getLastRow() - 2;
      if (rowsToDelete > 0) {
        helperSheet.deleteRows(3, rowsToDelete);
        Logger.log(`✓ Deleted ${rowsToDelete} rows from Helper Doc for ${botId} (Helper Doc now has only 2 header rows)`);
      } else {
        Logger.log(`✓ Helper Doc for ${botId} already empty`);
      }
      SpreadsheetApp.flush();

      // Clear cached row ranges since Helper Doc is now empty
      clearRowRangesCache(botId);

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
 * Clear Helper Doc after uploading to Refund Log
 * Deletes all data rows (rows 3+) to reset for next batch
 */
function clearHelperDoc(botId) {
  try {
    const helperDocId = QUEUE_CONFIG.HELPER_DOCS[botId];
    if (!helperDocId) {
      return {success: false, message: 'Helper Doc not configured for ' + botId};
    }

    const helperDoc = SpreadsheetApp.openById(helperDocId);
    const helperSheet = helperDoc.getSheetByName(QUEUE_CONFIG.HELPER_SHEET_NAME);

    if (!helperSheet) {
      return {success: false, message: 'Helper sheet not found'};
    }

    const lastRow = helperSheet.getLastRow();

    if (lastRow > 2) {
      // Delete all data rows (row 3 onwards), keep headers (rows 1-2)
      helperSheet.deleteRows(3, lastRow - 2);
      Logger.log('[' + botId + '] Cleared ' + (lastRow - 2) + ' rows from Helper Doc');
    } else {
      Logger.log('[' + botId + '] Helper Doc already empty (no rows to clear)');
    }

    return {success: true, message: 'Helper Doc cleared'};

  } catch (e) {
    Logger.log('ERROR in clearHelperDoc: ' + e);
    return {success: false, message: 'Exception: ' + e.message};
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

    // Try to get cached row ranges first
    const cachedRanges = getCachedRowRanges(botId);
    const rowRange = cachedRanges ? cachedRanges[sqNumber] : null;

    let sqData;
    let startRow;

    if (rowRange) {
      // Fast path: use cached row range (read only needed rows)
      const rowCount = rowRange.endRow - rowRange.startRow + 1;
      sqData = helperSheet.getRange(rowRange.startRow, 1, rowCount, 17).getValues();
      startRow = rowRange.startRow;
      Logger.log('[' + botId + '] Using cached range for SQ ' + sqNumber + ': rows ' + rowRange.startRow + '-' + rowRange.endRow);
    } else {
      // Fallback: scan column J to find this SQ's row range
      Logger.log('[' + botId + '] No cache found, scanning column J for SQ ' + sqNumber);
      const sqCol = helperSheet.getRange(3, QUEUE_CONFIG.HELPER_COLS.SQ_NUMBER + 1, helperSheet.getLastRow() - 2, 1).getValues();
      let firstRow = -1;
      let lastRow = -1;

      for (let r = 0; r < sqCol.length; r++) {
        if (sqCol[r][0] === sqNumber) {
          if (firstRow === -1) firstRow = r + 3;
          lastRow = r + 3;
        }
      }

      if (firstRow === -1) {
        return {success: false, message: 'SQ ' + sqNumber + ' not found in Helper Doc'};
      }

      const rowCount = lastRow - firstRow + 1;
      sqData = helperSheet.getRange(firstRow, 1, rowCount, 17).getValues();
      startRow = firstRow;
    }

    // Update all rows for this SQ (sqData is just this SQ's rows)
    for (let i = 0; i < sqData.length; i++) {
      const rowNum = startRow + i;

      // Update Order Number (column H) and Buyer Name (column I) if provided
      if (manualData.orderNumber) {
        helperSheet.getRange(rowNum, 8).setValue(manualData.orderNumber); // Column H
      }
      if (manualData.buyerName) {
        helperSheet.getRange(rowNum, 9).setValue(manualData.buyerName); // Column I
      }
    }

    SpreadsheetApp.flush();
    Logger.log('[' + botId + '] Synced manual data for SQ ' + sqNumber + ' (' + sqData.length + ' rows)');
    return {success: true, message: 'Manual data synced to Helper Doc'};

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

    Logger.log('[' + botId + '] Syncing ' + items.length + ' items to Helper Doc');

    // Try to get cached row ranges first
    const cachedRanges = getCachedRowRanges(botId);

    // Group items by SQ number to batch reads
    const itemsBySQ = {};
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!itemsBySQ[item.sqNumber]) {
        itemsBySQ[item.sqNumber] = [];
      }
      itemsBySQ[item.sqNumber].push(item);
    }

    // Process each SQ's items
    for (const sqNumber in itemsBySQ) {
      const sqItems = itemsBySQ[sqNumber];
      const rowRange = cachedRanges ? cachedRanges[sqNumber] : null;

      let sqData;
      let startRow;

      if (rowRange) {
        // Fast path: use cached row range (read only needed rows)
        const rowCount = rowRange.endRow - rowRange.startRow + 1;
        sqData = helperSheet.getRange(rowRange.startRow, 1, rowCount, 17).getValues();
        startRow = rowRange.startRow;
        Logger.log('[' + botId + '] Using cached range for SQ ' + sqNumber + ': rows ' + rowRange.startRow + '-' + rowRange.endRow);
      } else {
        // Fallback: scan column J to find this SQ's row range
        Logger.log('[' + botId + '] No cache found, scanning column J for SQ ' + sqNumber);
        const sqCol = helperSheet.getRange(3, QUEUE_CONFIG.HELPER_COLS.SQ_NUMBER + 1, helperSheet.getLastRow() - 2, 1).getValues();
        let firstRow = -1;
        let lastRow = -1;

        for (let r = 0; r < sqCol.length; r++) {
          if (sqCol[r][0] === sqNumber) {
            if (firstRow === -1) firstRow = r + 3; // Convert to 1-based
            lastRow = r + 3;
          }
        }

        if (firstRow === -1) {
          Logger.log('[' + botId + '] ERROR: Could not find SQ ' + sqNumber + ' in Helper Doc');
          continue;
        }

        const rowCount = lastRow - firstRow + 1;
        sqData = helperSheet.getRange(firstRow, 1, rowCount, 17).getValues();
        startRow = firstRow;
      }

      // Now find matching rows within this SQ's data
      for (let i = 0; i < sqItems.length; i++) {
        const item = sqItems[i];

        let foundRow = -1;
        let fallbackRow = -1;

        for (let rowIdx = 0; rowIdx < sqData.length; rowIdx++) {
          const helperCard = sqData[rowIdx][QUEUE_CONFIG.HELPER_COLS.CARD_NAME];
          const helperSet = sqData[rowIdx][QUEUE_CONFIG.HELPER_COLS.SET_NAME];
          const helperCondition = sqData[rowIdx][QUEUE_CONFIG.HELPER_COLS.CONDITION];
          const helperOrder = sqData[rowIdx][QUEUE_CONFIG.HELPER_COLS.ORDER_NUMBER];

          const matchesCard = helperCard === item.cardName;
          const matchesSet = helperSet === item.setName;
          const matchesCondition = helperCondition === item.condition;

          if (matchesCard && matchesSet && matchesCondition) {
            if (fallbackRow === -1) {
              fallbackRow = startRow + rowIdx;
            }

            if (!helperOrder || helperOrder === '') {
              foundRow = startRow + rowIdx;
              Logger.log('[' + botId + '] Found EMPTY row ' + foundRow + ' for ' + item.cardName);
              break;
            }
          }
        }

        if (foundRow === -1) {
          foundRow = fallbackRow;
          if (foundRow !== -1) {
            Logger.log('[' + botId + '] Warning: No empty row found, overwriting row ' + foundRow + ' for ' + item.cardName);
          }
        }

        if (foundRow === -1) {
          Logger.log('[' + botId + '] ERROR: Could not find matching row for ' + item.cardName + ' in SQ ' + item.sqNumber);
          continue;
        }

        // Update columns H (Order#) and I (Buyer) for this row
        if (item.orderNumber) {
          helperSheet.getRange(foundRow, 8).setValue(item.orderNumber); // Column H
          Logger.log('[' + botId + '] Updated row ' + foundRow + ' Order#: ' + item.orderNumber);
        }
        if (item.buyerName) {
          helperSheet.getRange(foundRow, 9).setValue(item.buyerName); // Column I
          Logger.log('[' + botId + '] Updated row ' + foundRow + ' Buyer: ' + item.buyerName);
        }
      }
    }

    SpreadsheetApp.flush();
    Logger.log('[' + botId + '] ✓ Synced ' + items.length + ' items to Helper Doc');
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

    // Return success WITHOUT full updatedItems array (too large for serialization)
    // UI will re-load from Helper Doc to get fresh data
    const response = {
      success: true,
      message: 'PDF processed successfully! ' + result.matchCount + ' items matched.',
      matchCount: result.matchCount,
      sqNumber: sqNumber  // UI needs this to reload
    };

    // Test serialization
    try {
      const jsonTest = JSON.stringify(response);
      Logger.log('[' + botId + '] PDF response size: ' + jsonTest.length + ' bytes');
    } catch (jsonError) {
      Logger.log('[' + botId + '] ERROR: Cannot serialize PDF response: ' + jsonError.message);
      return {success: false, message: 'Response too large to serialize'};
    }

    return response;

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
 * IMPORTANT: Strips all suffix variations (Foil, Holofoil, 1st Edition, etc.) for matching
 * 
 * PDF formats: "Near Mint", "Near Mint Holofoil", "Moderately Played Holofoil"
 * Log formats: NM, NMF, NMH, LPF, MPH, NM1, MPU, etc.
 * 
 * Strategy: Extract base condition (NM/LP/MP/HP) and ignore all suffixes
 */
function normalizeCondition(condition) {
  let cond = (condition || '').toLowerCase().trim();
  
  // Remove trailing suffix words (case-insensitive)
  // Handles: "Near Mint Holofoil" → "Near Mint", "Lightly Played Foil" → "Lightly Played"
  // Also handles: "Near Mint Reverse Holofoil", "Moderately Played Unlimited"
  cond = cond
    .replace(/\s*(reverse holofoil|reverse holo|holofoil|holo foil|foil|1st edition|unlimited|limited)\s*$/gi, '')
    .trim();
  
  // Strip single-letter suffixes from abbreviated codes
  // Handles: "NMF" → "NM", "LPH" → "LP", "MPU" → "MP", "NM1" → "NM"
  cond = cond.replace(/[fhul1]$/, '').trim();

  // Fast-path abbreviated codes - normalize to base condition
  if (cond === 'nm' || cond.startsWith('nm')) return 'nm';
  if (cond === 'lp' || cond.startsWith('lp')) return 'lp';
  if (cond === 'mp' || cond.startsWith('mp')) return 'mp';
  if (cond === 'hp' || cond.startsWith('hp')) return 'hp';
  if (cond === 'dmg' || cond.startsWith('dmg') || cond.startsWith('damaged')) return 'damaged';

  // Map verbose text formats to standard abbreviations
  if (cond.includes('near mint')) return 'nm';
  if (cond.includes('lightly played') || cond === 'light') return 'lp';
  if (cond.includes('moderately played') || cond === 'moderate') return 'mp';
  if (cond.includes('heavily played') || cond === 'heavy') return 'hp';
  if (cond.includes('damaged')) return 'damaged';

  // If no match, return the cleaned base condition
  return cond;
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

  // NOTE: Collector number is NOT used for matching (per user request)
  // Same collector number can exist in different sets, causing false positives
  // Only match on: Card Name + Set Name + Condition

  const exactMatches = [];
  const fallbackMatches = [];

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

      // ONLY exact match (name + set + condition all match)
      // Fallback matching DISABLED to prevent false matches like NM vs NMF
      if (matchesName && matchesSet && matchesCondition) {
        exactMatches.push({
          orderNumber: order.orderNumber,
          buyerName: order.buyerName,
          quantity: card.quantity || 1
        });
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

  // No fallback matching - conditions MUST match exactly
  // This prevents false matches like "Near Mint" matching "Near Mint Foil"
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

    // OPTIMIZATION: Read only the rows for this SQ instead of all rows
    // This prevents slowdown as the Helper Doc grows (from ~2s to ~90s for 100 SQs)
    const lastRow = helperSheet.getLastRow();
    if (lastRow < 3) {
      return {success: false, message: 'Helper Doc is empty'};
    }

    Logger.log('[' + botId + '] fillOrderInfo: Finding row range for SQ ' + sqNumber + '...');

    // Step 1: Read ONLY column J (SQ numbers) to find row range
    const sqColumn = helperSheet.getRange(3, 10, lastRow - 2, 1).getValues();

    let startIdx = -1;
    let endIdx = -1;

    for (let i = 0; i < sqColumn.length; i++) {
      const rowSQ = sqColumn[i][0];

      if (rowSQ === sqNumber) {
        if (startIdx === -1) {
          startIdx = i; // First occurrence
        }
      } else if (startIdx !== -1 && rowSQ !== sqNumber) {
        endIdx = i; // Found end
        break;
      }
    }

    if (startIdx === -1) {
      return {success: false, message: 'SQ ' + sqNumber + ' not found in Helper Doc'};
    }

    if (endIdx === -1) {
      endIdx = sqColumn.length; // SQ goes to end of sheet
    }

    const rowCount = endIdx - startIdx;
    const firstDataRow = startIdx + 3; // Convert to 1-based row number

    Logger.log('[' + botId + '] Found SQ ' + sqNumber + ' at rows ' + firstDataRow + '-' + (firstDataRow + rowCount - 1) + ' (' + rowCount + ' rows)');

    // Step 2: Read ONLY this SQ's rows (all 17 columns)
    const sqData = helperSheet.getRange(firstDataRow, 1, rowCount, 17).getValues();

    Logger.log('fillOrderInfo: Processing ' + parsedOrders.length + ' parsed orders');
    Logger.log('Total SQ rows: ' + rowCount + ' (optimized read, not ' + lastRow + ' rows)');

    let matchCount = 0;
    let orderNumber = '';
    let buyerName = '';

    // Track rows to insert (for multiple-order matches)
    const rowsToInsert = [];

    // Group Helper Doc rows by (cardName + setName + condition)
    // This allows us to handle quantity distribution correctly
    const cardGroups = {}; // {cardKey: [{rowIndex, rowData, qty}, ...]}

    // IMPORTANT: sqData array indices are 0-based, but correspond to sheet rows starting at firstDataRow
    // So sqData[0] = sheet row firstDataRow, sqData[1] = sheet row firstDataRow+1, etc.
    for (let i = 0; i < sqData.length; i++) {
      const row = sqData[i];
      const actualSheetRowIndex = startIdx + 2 + i; // Convert to data array index (0-based, where row 0=header1, row 1=header2, row 2=first data)

      const cardName = row[QUEUE_CONFIG.HELPER_COLS.CARD_NAME];
      const setName = row[QUEUE_CONFIG.HELPER_COLS.SET_NAME];
      const condition = row[QUEUE_CONFIG.HELPER_COLS.CONDITION];
      const rowSQ = row[QUEUE_CONFIG.HELPER_COLS.SQ_NUMBER];
      const rowQty = row[QUEUE_CONFIG.HELPER_COLS.QTY] || 1;

      // Sanity check: Should all be this SQ (but check anyway)
      if (rowSQ !== sqNumber) {
        Logger.log('  WARNING: Found unexpected SQ ' + rowSQ + ' at row index ' + actualSheetRowIndex + ' (expected ' + sqNumber + ')');
        continue;
      }
      if (!cardName) continue; // Skip empty rows

      // Create unique key for this card (name + set + condition)
      const cardKey = normalizeNameExact(cardName) + '|' + normalizeSetName(setName) + '|' + normalizeCondition(condition);

      if (!cardGroups[cardKey]) {
        cardGroups[cardKey] = [];
      }

      cardGroups[cardKey].push({
        rowIndex: actualSheetRowIndex, // Use actual sheet row index for writing back later
        rowData: row,
        qty: rowQty,
        cardName: cardName,
        setName: setName,
        condition: condition,
        collectorNum: row[QUEUE_CONFIG.HELPER_COLS.COLLECTOR_NUM]
      });
    }

    // Process each card group
    for (const cardKey in cardGroups) {
      const cardRows = cardGroups[cardKey];
      const firstCard = cardRows[0];

      Logger.log('\n=== Processing card group: ' + firstCard.cardName + ' | ' + firstCard.setName + ' | ' + firstCard.condition + ' ===');
      Logger.log('  Helper Doc has ' + cardRows.length + ' row(s) for this card');

      // Find all matching orders from PDF
      const matchedOrders = findAllMatchingOrders(
        firstCard.cardName,
        firstCard.setName,
        firstCard.condition,
        firstCard.collectorNum,
        parsedOrders
      );

      if (matchedOrders.length === 0) {
        Logger.log('  ✗ No matches found in PDF');
        continue;
      }

      // Consolidate duplicate orders (same order appearing multiple times in PDF)
      const uniqueOrders = [];
      for (const order of matchedOrders) {
        const existingOrder = uniqueOrders.find(o =>
          o.orderNumber === order.orderNumber && o.buyerName === order.buyerName
        );

        if (existingOrder) {
          existingOrder.quantity += order.quantity;
        } else {
          uniqueOrders.push({
            orderNumber: order.orderNumber,
            buyerName: order.buyerName,
            quantity: order.quantity
          });
        }
      }

      Logger.log('  ✓ Found ' + uniqueOrders.length + ' unique order(s) in PDF');
      for (let j = 0; j < uniqueOrders.length; j++) {
        Logger.log('    Order ' + (j + 1) + ': ' + uniqueOrders[j].orderNumber + ' (' + uniqueOrders[j].buyerName + ') - Qty: ' + uniqueOrders[j].quantity);
      }

      // Distribute orders across Helper Doc rows
      // Fill existing rows first, then insert new rows if needed
      // IMPORTANT: Each Helper Doc row represents 1 card from the Discrep Log
      // So even if PDF says "Qty 2", we set each row to Qty 1 when distributing across multiple orders
      for (let orderIdx = 0; orderIdx < uniqueOrders.length; orderIdx++) {
        const order = uniqueOrders[orderIdx];

        if (orderIdx < cardRows.length) {
          // Fill existing Helper Doc row
          const helperRow = cardRows[orderIdx];
          const sheetRowNum = helperRow.rowIndex + 1; // Convert to 1-based

          helperSheet.getRange(sheetRowNum, 8).setValue(order.orderNumber); // Column H
          helperSheet.getRange(sheetRowNum, 9).setValue(order.buyerName); // Column I

          // Set quantity to 1 for each row when distributing across multiple orders
          // (Helper Doc rows represent individual Discrep Log entries, not PDF quantities)
          helperSheet.getRange(sheetRowNum, 17).setValue(1); // Column Q (qty)

          Logger.log('  → Updated row ' + sheetRowNum + ' with Order ' + (orderIdx + 1) + ' (Qty: 1)');
          matchCount++;

          // Save first order info to return
          if (orderIdx === 0) {
            orderNumber = order.orderNumber;
            buyerName = order.buyerName;
          }
        } else {
          // Need to insert a new row (more orders than Helper Doc rows)
          Logger.log('  ⚠️ Need to insert additional row for Order ' + (orderIdx + 1));

          // Clone the first row's data as template
          const templateRow = cardRows[0].rowData.slice();
          Logger.log('  DEBUG: Template row order/buyer BEFORE update: "' + templateRow[QUEUE_CONFIG.HELPER_COLS.ORDER_NUMBER] + '" / "' + templateRow[QUEUE_CONFIG.HELPER_COLS.BUYER_NAME] + '"');

          templateRow[QUEUE_CONFIG.HELPER_COLS.ORDER_NUMBER] = order.orderNumber;
          templateRow[QUEUE_CONFIG.HELPER_COLS.BUYER_NAME] = order.buyerName;

          Logger.log('  DEBUG: Template row order/buyer AFTER update: "' + templateRow[QUEUE_CONFIG.HELPER_COLS.ORDER_NUMBER] + '" / "' + templateRow[QUEUE_CONFIG.HELPER_COLS.BUYER_NAME] + '"');

          // Set quantity to 1 (each Helper Doc row = 1 Discrep Log entry)
          templateRow[QUEUE_CONFIG.HELPER_COLS.QTY] = 1;

          // Insert after the last row for this card group
          const lastRowIndex = cardRows[cardRows.length - 1].rowIndex;
          rowsToInsert.push({
            afterRow: lastRowIndex + 1, // Convert to 1-based row number for insertRowAfter()
            data: templateRow
          });

          matchCount++;
        }
      }

      // If Helper Doc has MORE rows than orders, clear the extra rows
      if (cardRows.length > uniqueOrders.length) {
        Logger.log('  ⚠️ Helper Doc has ' + (cardRows.length - uniqueOrders.length) + ' extra row(s) - clearing them');
        for (let rowIdx = uniqueOrders.length; rowIdx < cardRows.length; rowIdx++) {
          const helperRow = cardRows[rowIdx];
          const sheetRowNum = helperRow.rowIndex + 1;

          // Clear Order# and Buyer columns for unmatched rows
          helperSheet.getRange(sheetRowNum, 8).setValue(''); // Column H
          helperSheet.getRange(sheetRowNum, 9).setValue(''); // Column I

          Logger.log('  → Cleared row ' + sheetRowNum + ' (no matching order)');
        }
      }
    }

    // Insert additional rows (work backwards to maintain row indices)
    if (rowsToInsert.length > 0) {
      Logger.log('Inserting ' + rowsToInsert.length + ' additional rows for multiple-order matches');
      rowsToInsert.sort((a, b) => b.afterRow - a.afterRow); // Sort descending

      for (const insert of rowsToInsert) {
        Logger.log('  DEBUG: Inserting row after ' + insert.afterRow + ', will write to row ' + (insert.afterRow + 1));
        Logger.log('  DEBUG: New row data - Order: "' + insert.data[QUEUE_CONFIG.HELPER_COLS.ORDER_NUMBER] + '", Buyer: "' + insert.data[QUEUE_CONFIG.HELPER_COLS.BUYER_NAME] + '"');

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

    // Read back ONLY this SQ's rows from Helper Doc to get per-row order/buyer data
    SpreadsheetApp.flush(); // Make sure all writes are committed before reading

    const updatedItems = [];

    // Use cached row ranges or fallback to column scan
    const cachedRanges = getCachedRowRanges(botId);
    const rowRange = cachedRanges ? cachedRanges[sqNumber] : null;

    let freshData;
    let startRow;

    if (rowRange) {
      // Fast path: read only this SQ's rows using cached range
      const rowCount = rowRange.endRow - rowRange.startRow + 1;
      freshData = helperSheet.getRange(rowRange.startRow, 1, rowCount, 17).getValues();
      startRow = rowRange.startRow;
      Logger.log('Re-read Helper Doc (cached range) - rows ' + rowRange.startRow + '-' + rowRange.endRow + ' (' + rowCount + ' rows)');
    } else {
      // Fallback: scan column J to find this SQ's rows
      Logger.log('Re-read Helper Doc (no cache) - scanning for SQ ' + sqNumber);
      const sqCol = helperSheet.getRange(3, QUEUE_CONFIG.HELPER_COLS.SQ_NUMBER + 1, helperSheet.getLastRow() - 2, 1).getValues();
      let firstRow = -1;
      let lastRow = -1;

      for (let r = 0; r < sqCol.length; r++) {
        if (sqCol[r][0] === sqNumber) {
          if (firstRow === -1) firstRow = r + 3;
          lastRow = r + 3;
        }
      }

      if (firstRow === -1) {
        Logger.log('ERROR: Could not find SQ ' + sqNumber + ' in Helper Doc after PDF processing');
        return {success: false, message: 'SQ not found after PDF processing'};
      }

      const rowCount = lastRow - firstRow + 1;
      freshData = helperSheet.getRange(firstRow, 1, rowCount, 17).getValues();
      startRow = firstRow;
      Logger.log('Re-read Helper Doc - rows ' + firstRow + '-' + lastRow + ' (' + rowCount + ' rows)');
    }

    // Process rows (freshData now contains ONLY this SQ's rows)
    for (let i = 0; i < freshData.length; i++) {
      const row = freshData[i];
      if (!row[QUEUE_CONFIG.HELPER_COLS.CARD_NAME]) continue;

      // Log the RAW data from the row to see what we're actually reading
      const actualRowNum = startRow + i;
      Logger.log('  Row ' + actualRowNum + ' RAW data:');
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
