import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";

/**
 * Create a new SQ claim
 */
export const createClaim = internalMutation({
  args: {
    botId: v.string(),
    sqNumber: v.string(),
    status: v.union(v.literal("CLAIMING"), v.literal("COMPLETED")),
    claimedAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Check if claim already exists
    const existing = await ctx.db
      .query("sq_claims")
      .withIndex("by_sq_number", (q) => q.eq("sqNumber", args.sqNumber))
      .filter((q) => q.eq(q.field("botId"), args.botId))
      .first();

    if (existing) {
      // Update existing claim
      await ctx.db.patch(existing._id, {
        status: args.status,
        claimedAt: args.claimedAt,
      });
      return existing._id;
    }

    // Create new claim
    return await ctx.db.insert("sq_claims", {
      botId: args.botId,
      sqNumber: args.sqNumber,
      status: args.status,
      claimedAt: args.claimedAt,
    });
  },
});

/**
 * Mark an SQ claim as completed
 */
export const completeClaim = internalMutation({
  args: {
    botId: v.string(),
    sqNumber: v.string(),
    completedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const claim = await ctx.db
      .query("sq_claims")
      .withIndex("by_sq_number", (q) => q.eq("sqNumber", args.sqNumber))
      .filter((q) => q.eq(q.field("botId"), args.botId))
      .first();

    if (!claim) {
      throw new Error(`Claim not found for bot ${args.botId} and SQ ${args.sqNumber}`);
    }

    await ctx.db.patch(claim._id, {
      status: "COMPLETED",
      completedAt: args.completedAt,
    });

    return claim._id;
  },
});

/**
 * Get all active claims (status = CLAIMING)
 */
export const getActiveClaims = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("sq_claims")
      .withIndex("by_status", (q) => q.eq("status", "CLAIMING"))
      .collect();
  },
});

/**
 * Get claims by bot ID
 */
export const getClaimsByBot = query({
  args: {
    botId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sq_claims")
      .withIndex("by_bot_id", (q) => q.eq("botId", args.botId))
      .order("desc")
      .take(100);
  },
});

/**
 * Get claim by SQ number
 */
export const getClaimBySQ = query({
  args: {
    sqNumber: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sq_claims")
      .withIndex("by_sq_number", (q) => q.eq("sqNumber", args.sqNumber))
      .first();
  },
});

/**
 * Delete old completed claims (cleanup)
 */
export const deleteOldClaims = internalMutation({
  args: {
    olderThanMs: v.number(),
  },
  handler: async (ctx, args) => {
    const cutoffTime = Date.now() - args.olderThanMs;
    const oldClaims = await ctx.db
      .query("sq_claims")
      .withIndex("by_status", (q) => q.eq("status", "COMPLETED"))
      .filter((q) => q.lt(q.field("completedAt"), cutoffTime))
      .collect();

    for (const claim of oldClaims) {
      await ctx.db.delete(claim._id);
    }

    return oldClaims.length;
  },
});

/**
 * Create a refund log reservation
 */
export const createRefundReservation = internalMutation({
  args: {
    botId: v.string(),
    sqNumber: v.string(),
    startRow: v.number(),
    rowCount: v.number(),
    reservedAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("refund_reservations", {
      botId: args.botId,
      sqNumber: args.sqNumber,
      startRow: args.startRow,
      rowCount: args.rowCount,
      status: "WRITING",
      reservedAt: args.reservedAt,
    });
  },
});

/**
 * Complete a refund log reservation
 */
export const completeRefundReservation = internalMutation({
  args: {
    botId: v.string(),
    sqNumber: v.string(),
    completedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const reservation = await ctx.db
      .query("refund_reservations")
      .withIndex("by_sq_number", (q) => q.eq("sqNumber", args.sqNumber))
      .filter((q) => q.eq(q.field("botId"), args.botId))
      .first();

    if (!reservation) {
      throw new Error(`Reservation not found for bot ${args.botId} and SQ ${args.sqNumber}`);
    }

    await ctx.db.patch(reservation._id, {
      status: "COMPLETED",
      completedAt: args.completedAt,
    });

    return reservation._id;
  },
});
