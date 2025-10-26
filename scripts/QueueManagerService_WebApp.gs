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
  DISCREP_QUEUE_SHEET_NAME: 'BOTS',
  REFUND_QUEUE_SHEET_NAME: 'BOTS',
  STALE_LOCK_TIMEOUT_MS: 120000, // 2 minutes
  MAX_LOCK_WAIT_MS: 30000 // 30 seconds
};

/**
 * Handle HTTP POST requests from Helper Docs
 */
function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
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

      default:
        result = {success: false, message: 'Unknown action: ' + action};
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (e) {
    Logger.log('ERROR in doPost: ' + e);
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: 'Server error: ' + e.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Simple test endpoint (GET request)
 */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'Queue Manager Service is running',
    timestamp: new Date().toISOString(),
    activeClaims: getActiveClaims().length
  })).setMimeType(ContentService.MimeType.JSON);
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
