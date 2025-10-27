import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Acquire exclusive session for a bot
 * Returns success: false if bot is already in use (within timeout period)
 */
export const acquireSession = internalMutation({
  args: { botId: v.string() },
  handler: async (ctx, { botId }) => {
    const now = Date.now();

    // Check if bot already has an active session
    const existing = await ctx.db
      .query("bot_sessions")
      .withIndex("by_bot_id", (q) => q.eq("botId", botId))
      .first();

    if (existing) {
      const age = now - existing.lastActivity;

      // If session is still active (< 10 minutes), reject
      if (age < SESSION_TIMEOUT_MS) {
        return {
          success: false,
          message: "Bot is already in use by another user",
          timeRemaining: Math.ceil((SESSION_TIMEOUT_MS - age) / 1000), // seconds
        };
      }

      // Session is stale, delete it
      await ctx.db.delete(existing._id);
    }

    // Create new session
    await ctx.db.insert("bot_sessions", {
      botId,
      lastActivity: now,
      acquiredAt: now,
    });

    return {
      success: true,
      message: "Session acquired successfully",
    };
  },
});

/**
 * Touch session to reset inactivity timer
 * Called on every user action (pullNextSQ, uploadPDF, uploadToRefundLog, etc.)
 */
export const touchSession = internalMutation({
  args: { botId: v.string() },
  handler: async (ctx, { botId }) => {
    const session = await ctx.db
      .query("bot_sessions")
      .withIndex("by_bot_id", (q) => q.eq("botId", botId))
      .first();

    if (!session) {
      return {
        success: false,
        message: "No active session found for this bot",
      };
    }

    // Update lastActivity timestamp
    await ctx.db.patch(session._id, {
      lastActivity: Date.now(),
    });

    return {
      success: true,
      message: "Session activity updated",
    };
  },
});

/**
 * Release session manually
 */
export const releaseSession = internalMutation({
  args: { botId: v.string() },
  handler: async (ctx, { botId }) => {
    const session = await ctx.db
      .query("bot_sessions")
      .withIndex("by_bot_id", (q) => q.eq("botId", botId))
      .first();

    if (session) {
      await ctx.db.delete(session._id);
    }

    return {
      success: true,
      message: "Session released successfully",
    };
  },
});

/**
 * Get all active sessions (for UI to grey out busy bots)
 * Automatically filters out stale sessions (> 10 minutes old)
 */
export const getActiveSessions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const allSessions = await ctx.db.query("bot_sessions").collect();

    // Filter out stale sessions and return only active ones
    const activeSessions = allSessions
      .filter((session) => {
        const age = now - session.lastActivity;
        return age < SESSION_TIMEOUT_MS;
      })
      .map((session) => ({
        botId: session.botId,
        lastActivity: session.lastActivity,
        acquiredAt: session.acquiredAt,
        age: Math.floor((now - session.lastActivity) / 1000), // seconds since last activity
      }));

    return activeSessions;
  },
});

/**
 * Cleanup stale sessions (optional maintenance - could be run on a schedule)
 */
export const cleanupStaleSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const allSessions = await ctx.db.query("bot_sessions").collect();

    let deletedCount = 0;

    for (const session of allSessions) {
      const age = now - session.lastActivity;
      if (age >= SESSION_TIMEOUT_MS) {
        await ctx.db.delete(session._id);
        deletedCount++;
      }
    }

    return {
      success: true,
      deletedCount,
    };
  },
});
