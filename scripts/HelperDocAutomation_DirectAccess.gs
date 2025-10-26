/**
 * SIMPLIFIED QUEUE COORDINATION - NO WEB APP NEEDED
 *
 * Instead of calling a Web App via HTTP, each Helper Doc directly accesses
 * the queue sheets with ScriptLock for coordination.
 *
 * This works because ScriptLock is per-user, and all Helper Docs run as the same user.
 */

/**
 * Try to reserve an SQ using direct sheet access with ScriptLock
 */
function tryReserveSQ(sqNumber) {
  const lock = LockService.getUserLock();

  try {
    // Wait up to 30 seconds to acquire lock
    if (!lock.tryLock(30000)) {
      Logger.log(`[${CONFIG.BOT_ID}] Failed to acquire lock for SQ ${sqNumber}`);
      return false;
    }

    const discrepLog = SpreadsheetApp.openById(CONFIG.DISCREP_LOG_ID);
    const queueSheet = discrepLog.getSheetByName(CONFIG.DISCREP_QUEUE_SHEET_NAME);

    if (!queueSheet) {
      throw new Error(`Queue sheet "${CONFIG.DISCREP_QUEUE_SHEET_NAME}" not found`);
    }

    const timestamp = new Date();
    const botId = CONFIG.BOT_ID;

    Logger.log(`[${botId}] Checking if SQ ${sqNumber} is available...`);

    // Check if another bot already reserved this SQ
    const data = queueSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const queueBotId = row[0];
      const queueSQ = row[1];
      const queueStatus = row[2];
      const queueTimestamp = row[3];

      if (queueSQ === sqNumber && queueStatus === 'CLAIMING') {
        const age = (timestamp - new Date(queueTimestamp)) / 1000;
        if (age < 600) { // 10 minutes
          Logger.log(`[${botId}] ⚠️ SQ ${sqNumber} already reserved by ${queueBotId}`);
          return false;
        }
        // Stale claim - delete it
        Logger.log(`[${botId}] Removing stale claim from ${queueBotId}`);
        queueSheet.deleteRow(i + 1);
        break;
      }
    }

    // Write reservation
    const nextRow = queueSheet.getLastRow() + 1;
    queueSheet.getRange(nextRow, 1, 1, 4).setValues([[botId, sqNumber, 'CLAIMING', timestamp]]);
    SpreadsheetApp.flush();

    Logger.log(`[${botId}] ✓ Reserved SQ ${sqNumber} at row ${nextRow}`);
    return true;

  } catch (e) {
    Logger.log(`[${CONFIG.BOT_ID}] ERROR in tryReserveSQ: ${e}`);
    return false;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Release an SQ reservation
 */
function releaseSQ(sqNumber) {
  const lock = LockService.getUserLock();

  try {
    if (!lock.tryLock(10000)) {
      Logger.log(`[${CONFIG.BOT_ID}] Warning: Could not acquire lock to release SQ ${sqNumber}`);
      return false;
    }

    const discrepLog = SpreadsheetApp.openById(CONFIG.DISCREP_LOG_ID);
    const queueSheet = discrepLog.getSheetByName(CONFIG.DISCREP_QUEUE_SHEET_NAME);

    if (!queueSheet) return false;

    const data = queueSheet.getDataRange().getValues();
    const botId = CONFIG.BOT_ID;

    // Find and update our reservation
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[0] === botId && row[1] === sqNumber) {
        queueSheet.getRange(i + 1, 3).setValue('COMPLETED');
        SpreadsheetApp.flush();
        Logger.log(`[${botId}] Released SQ ${sqNumber} from queue`);
        return true;
      }
    }

    return false;
  } catch (e) {
    Logger.log(`[${CONFIG.BOT_ID}] Warning: Could not release SQ ${sqNumber}: ${e}`);
    return false;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Reserve rows in Refund Log
 */
function tryReserveRefundLogWrite(sqNumber, rowCount) {
  const lock = LockService.getUserLock();

  try {
    if (!lock.tryLock(30000)) {
      Logger.log(`[${CONFIG.BOT_ID}] Failed to acquire Refund Log lock for SQ ${sqNumber}`);
      return null;
    }

    const refundLog = SpreadsheetApp.openById(CONFIG.REFUND_LOG_ID);
    const refundSheet = refundLog.getSheetByName('Refund Log');
    const queueSheet = refundLog.getSheetByName(CONFIG.REFUND_QUEUE_SHEET_NAME);

    if (!queueSheet) {
      throw new Error(`Queue sheet "${CONFIG.REFUND_QUEUE_SHEET_NAME}" not found in Refund Log`);
    }

    const timestamp = new Date();
    const botId = CONFIG.BOT_ID;

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

    Logger.log(`[${botId}] ✓ Reserved Refund Log rows ${assignedRow}-${assignedRow + rowCount - 1}`);
    return assignedRow;

  } catch (e) {
    Logger.log(`[${CONFIG.BOT_ID}] ERROR: Failed to reserve Refund Log rows: ${e}`);
    return null;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Release Refund Log reservation
 */
function releaseRefundLogWrite(sqNumber) {
  const lock = LockService.getUserLock();

  try {
    if (!lock.tryLock(10000)) {
      Logger.log(`[${CONFIG.BOT_ID}] Warning: Could not acquire lock to release Refund Log reservation`);
      return false;
    }

    const refundLog = SpreadsheetApp.openById(CONFIG.REFUND_LOG_ID);
    const queueSheet = refundLog.getSheetByName(CONFIG.REFUND_QUEUE_SHEET_NAME);

    if (!queueSheet) return false;

    const data = queueSheet.getDataRange().getValues();
    const botId = CONFIG.BOT_ID;

    // Find and delete our reservation
    for (let i = data.length - 1; i >= 1; i--) {
      const row = data[i];
      if (row[0] === botId && row[1] === sqNumber) {
        queueSheet.deleteRow(i + 1);
        SpreadsheetApp.flush();
        Logger.log(`[${botId}] Released Refund Log write reservation for SQ ${sqNumber}`);
        return true;
      }
    }

    return false;
  } catch (e) {
    Logger.log(`[${CONFIG.BOT_ID}] Warning: Could not release Refund Log reservation: ${e}`);
    return false;
  } finally {
    lock.releaseLock();
  }
}
