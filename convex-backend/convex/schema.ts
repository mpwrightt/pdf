import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Convex Schema for Queue Coordination
 *
 * Tables:
 * - sq_claims: Track which bot claimed which SQ
 * - refund_reservations: Track Refund Log row reservations
 */

export default defineSchema({
  // SQ Claims - tracks which bot is working on which SQ
  sq_claims: defineTable({
    sqNumber: v.string(),      // SQ identifier (e.g., "251019-164rmb")
    botId: v.string(),          // Bot that claimed it (e.g., "BOT1")
    status: v.string(),         // "CLAIMING" or "COMPLETED"
    claimedAt: v.number(),      // Timestamp when claimed
    completedAt: v.optional(v.number()), // Timestamp when completed
  })
    .index("by_sq_number", ["sqNumber"])
    .index("by_bot_and_status", ["botId", "status"])
    .index("by_claimed_at", ["claimedAt"]), // For cleanup

  // Refund Log Reservations - tracks which rows are reserved
  refund_reservations: defineTable({
    sqNumber: v.string(),       // SQ identifier
    botId: v.string(),          // Bot that reserved rows
    startRow: v.number(),       // First row number
    rowCount: v.number(),       // Number of rows reserved
    status: v.string(),         // "WRITING" or "COMPLETED"
    reservedAt: v.number(),     // Timestamp when reserved
    completedAt: v.optional(v.number()), // Timestamp when completed
  })
    .index("by_sq_number", ["sqNumber"])
    .index("by_status", ["status"])
    .index("by_reserved_at", ["reservedAt"]), // For cleanup
});
