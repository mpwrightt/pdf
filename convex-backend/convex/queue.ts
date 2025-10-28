import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const CLAIM_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Clean up stale claims older than CLAIM_TIMEOUT_MS
 */
export const cleanupStaleClaims = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - CLAIM_TIMEOUT_MS;

    // Clean stale SQ claims
    const staleSqClaims = await ctx.db
      .query("sq_claims")
      .withIndex("by_claimed_at")
      .filter((q) => q.lt(q.field("claimedAt"), cutoff))
      .collect();

    for (const claim of staleSqClaims) {
      await ctx.db.delete(claim._id);
    }

    // Clean stale refund reservations
    const staleRefunds = await ctx.db
      .query("refund_reservations")
      .withIndex("by_reserved_at")
      .filter((q) => q.lt(q.field("reservedAt"), cutoff))
      .collect();

    for (const reservation of staleRefunds) {
      await ctx.db.delete(reservation._id);
    }

    return {
      deletedSqClaims: staleSqClaims.length,
      deletedRefundReservations: staleRefunds.length,
    };
  },
});

/**
 * EMERGENCY: Clean up ALL claims and reservations (use when system is stuck)
 */
export const forceCleanupAll = mutation({
  args: {},
  handler: async (ctx) => {
    // Delete ALL SQ claims
    const allSqClaims = await ctx.db.query("sq_claims").collect();
    for (const claim of allSqClaims) {
      await ctx.db.delete(claim._id);
    }

    // Delete ALL refund reservations
    const allRefunds = await ctx.db.query("refund_reservations").collect();
    for (const reservation of allRefunds) {
      await ctx.db.delete(reservation._id);
    }

    return {
      deletedSqClaims: allSqClaims.length,
      deletedRefundReservations: allRefunds.length,
      message: "All claims and reservations cleared",
    };
  },
});

/**
 * Internal mutation wrapper for tryClaimSQ (for HTTP actions)
 */
export const tryClaimSQInternal = internalMutation({
  args: {
    botId: v.string(),
    sqNumber: v.string(),
  },
  handler: async (ctx, args) => {
    // Clean up stale claims first
    await ctx.runMutation(internal.queue.cleanupStaleClaims, {});

    // Check if already claimed (get ALL claims for this SQ, not just first)
    const existingClaims = await ctx.db
      .query("sq_claims")
      .withIndex("by_sq_number", (q) => q.eq("sqNumber", args.sqNumber))
      .collect();

    // Check for any active claims (CLAIMING status)
    const activeClaim = existingClaims.find(c => c.status === "CLAIMING");
    if (activeClaim) {
      return {
        success: false,
        message: `SQ ${args.sqNumber} already claimed by ${activeClaim.botId}`,
        claimedBy: activeClaim.botId,
      };
    }

    // Check for recent COMPLETED claims (within last 60 seconds)
    const now = Date.now();
    const recentCompleted = existingClaims.find(c =>
      c.status === "COMPLETED" &&
      c.completedAt &&
      (now - c.completedAt) < 60000
    );

    if (recentCompleted) {
      return {
        success: false,
        message: `SQ ${args.sqNumber} was recently completed by ${recentCompleted.botId}`,
        claimedBy: recentCompleted.botId,
      };
    }

    // Claim it
    await ctx.db.insert("sq_claims", {
      sqNumber: args.sqNumber,
      botId: args.botId,
      status: "CLAIMING",
      claimedAt: Date.now(),
    });

    return {
      success: true,
      message: `Successfully claimed SQ ${args.sqNumber}`,
      sqNumber: args.sqNumber,
      botId: args.botId,
    };
  },
});

/**
 * Try to claim an SQ for a bot (client-facing mutation)
 */
export const tryClaimSQ = mutation({
  args: {
    botId: v.string(),
    sqNumber: v.string(),
  },
  handler: async (ctx, args) => {
    // Clean up stale claims first
    await ctx.runMutation(internal.queue.cleanupStaleClaims, {});

    // Check if already claimed (get ALL claims for this SQ, not just first)
    const existingClaims = await ctx.db
      .query("sq_claims")
      .withIndex("by_sq_number", (q) => q.eq("sqNumber", args.sqNumber))
      .collect();

    // Check for any active claims (CLAIMING status)
    const activeClaim = existingClaims.find(c => c.status === "CLAIMING");
    if (activeClaim) {
      return {
        success: false,
        message: `SQ ${args.sqNumber} already claimed by ${activeClaim.botId}`,
        claimedBy: activeClaim.botId,
      };
    }

    // Check for recent COMPLETED claims (within last 60 seconds)
    // This prevents race condition where BOT1 completes and BOT2 tries to claim immediately
    const now = Date.now();
    const recentCompleted = existingClaims.find(c =>
      c.status === "COMPLETED" &&
      c.completedAt &&
      (now - c.completedAt) < 60000
    );

    if (recentCompleted) {
      return {
        success: false,
        message: `SQ ${args.sqNumber} was recently completed by ${recentCompleted.botId}`,
        claimedBy: recentCompleted.botId,
      };
    }

    // Claim it
    await ctx.db.insert("sq_claims", {
      sqNumber: args.sqNumber,
      botId: args.botId,
      status: "CLAIMING",
      claimedAt: Date.now(),
    });

    return {
      success: true,
      message: `Successfully claimed SQ ${args.sqNumber}`,
      sqNumber: args.sqNumber,
      botId: args.botId,
    };
  },
});

/**
 * Internal mutation wrapper for releaseSQ (for HTTP actions)
 */
export const releaseSQInternal = internalMutation({
  args: {
    botId: v.string(),
    sqNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const claim = await ctx.db
      .query("sq_claims")
      .withIndex("by_sq_number", (q) => q.eq("sqNumber", args.sqNumber))
      .first();

    if (!claim) {
      return {
        success: false,
        message: `No claim found for SQ ${args.sqNumber}`,
      };
    }

    if (claim.botId !== args.botId) {
      return {
        success: false,
        message: `SQ ${args.sqNumber} claimed by ${claim.botId}, not ${args.botId}`,
      };
    }

    // Mark as completed
    await ctx.db.patch(claim._id, {
      status: "COMPLETED",
      completedAt: Date.now(),
    });

    return {
      success: true,
      message: `Released SQ ${args.sqNumber}`,
    };
  },
});

/**
 * Release an SQ claim (client-facing mutation)
 */
export const releaseSQ = mutation({
  args: {
    botId: v.string(),
    sqNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const claim = await ctx.db
      .query("sq_claims")
      .withIndex("by_sq_number", (q) => q.eq("sqNumber", args.sqNumber))
      .first();

    if (!claim) {
      return {
        success: false,
        message: `No claim found for SQ ${args.sqNumber}`,
      };
    }

    if (claim.botId !== args.botId) {
      return {
        success: false,
        message: `SQ ${args.sqNumber} claimed by ${claim.botId}, not ${args.botId}`,
      };
    }

    // Mark as completed
    await ctx.db.patch(claim._id, {
      status: "COMPLETED",
      completedAt: Date.now(),
    });

    return {
      success: true,
      message: `Released SQ ${args.sqNumber}`,
    };
  },
});

/**
 * Reserve rows in Refund Log
 */
export const reserveRefundLogWrite = mutation({
  args: {
    botId: v.string(),
    sqNumber: v.string(),
    rowCount: v.number(),
    currentLastRow: v.number(),
  },
  handler: async (ctx, args) => {
    // Clean up stale claims first
    await ctx.runMutation(internal.queue.cleanupStaleClaims, {});

    // Calculate next available row
    let nextRow = args.currentLastRow + 1;

    // Find highest reserved row from active reservations
    const activeReservations = await ctx.db
      .query("refund_reservations")
      .withIndex("by_status", (q) => q.eq("status", "WRITING"))
      .collect();

    for (const reservation of activeReservations) {
      const endRow = reservation.startRow + reservation.rowCount;
      if (endRow > nextRow) {
        nextRow = endRow;
      }
    }

    // Create reservation
    await ctx.db.insert("refund_reservations", {
      sqNumber: args.sqNumber,
      botId: args.botId,
      startRow: nextRow,
      rowCount: args.rowCount,
      status: "WRITING",
      reservedAt: Date.now(),
    });

    return {
      success: true,
      startRow: nextRow,
      rowCount: args.rowCount,
      sqNumber: args.sqNumber,
      botId: args.botId,
    };
  },
});

/**
 * Release Refund Log reservation
 */
export const releaseRefundLogWrite = mutation({
  args: {
    botId: v.string(),
    sqNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const reservation = await ctx.db
      .query("refund_reservations")
      .withIndex("by_sq_number", (q) => q.eq("sqNumber", args.sqNumber))
      .first();

    if (!reservation) {
      return {
        success: false,
        message: `No reservation found for SQ ${args.sqNumber}`,
      };
    }

    if (reservation.botId !== args.botId) {
      return {
        success: false,
        message: `Reservation for SQ ${args.sqNumber} owned by ${reservation.botId}, not ${args.botId}`,
      };
    }

    // Mark as completed
    await ctx.db.patch(reservation._id, {
      status: "COMPLETED",
      completedAt: Date.now(),
    });

    return {
      success: true,
      message: `Released Refund Log reservation for SQ ${args.sqNumber}`,
    };
  },
});

/**
 * Get list of currently claimed SQ numbers (for preventing duplicate attempts)
 * Returns array of SQ numbers that are currently CLAIMING (not yet COMPLETED)
 */
export const getClaimedSQs = query({
  args: {},
  handler: async (ctx) => {
    // Get all active (CLAIMING status) SQ claims
    const activeClaims = await ctx.db
      .query("sq_claims")
      .withIndex("by_status", (q) => q.eq("status", "CLAIMING"))
      .collect();

    // Return just the SQ numbers
    return activeClaims.map(claim => claim.sqNumber);
  },
});

/**
 * Get queue status (for debugging)
 */
export const getQueueStatus = query({
  args: {},
  handler: async (ctx) => {
    const sqClaims = await ctx.db.query("sq_claims").collect();
    const refundReservations = await ctx.db.query("refund_reservations").collect();

    return {
      success: true,
      sqClaims: sqClaims.map((c) => ({
        sqNumber: c.sqNumber,
        botId: c.botId,
        status: c.status,
        claimedAt: new Date(c.claimedAt).toISOString(),
        completedAt: c.completedAt ? new Date(c.completedAt).toISOString() : undefined,
      })),
      refundReservations: refundReservations.map((r) => ({
        sqNumber: r.sqNumber,
        botId: r.botId,
        startRow: r.startRow,
        rowCount: r.rowCount,
        status: r.status,
        reservedAt: new Date(r.reservedAt).toISOString(),
        completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : undefined,
      })),
      timestamp: new Date().toISOString(),
    };
  },
});
