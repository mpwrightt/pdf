import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { paymentAttemptSchemaValidator } from "./paymentAttemptTypes";

export default defineSchema({
    users: defineTable({
      name: v.string(),
      // this the Clerk ID, stored in the subject JWT field
      externalId: v.string(),
    }).index("byExternalId", ["externalId"]),

    paymentAttempts: defineTable(paymentAttemptSchemaValidator)
      .index("byPaymentId", ["payment_id"])
      .index("byUserId", ["userId"])
      .index("byPayerUserId", ["payer.user_id"]),

    // Bot Manager Queue Tables
    sq_claims: defineTable({
      botId: v.string(),
      sqNumber: v.string(),
      status: v.union(v.literal("CLAIMING"), v.literal("COMPLETED")),
      claimedAt: v.number(),
      completedAt: v.optional(v.number()),
    })
      .index("by_bot_id", ["botId"])
      .index("by_sq_number", ["sqNumber"])
      .index("by_status", ["status"])
      .index("by_claimed_at", ["claimedAt"]),

    refund_reservations: defineTable({
      botId: v.string(),
      sqNumber: v.string(),
      startRow: v.number(),
      rowCount: v.number(),
      status: v.union(v.literal("WRITING"), v.literal("COMPLETED")),
      reservedAt: v.number(),
      completedAt: v.optional(v.number()),
    })
      .index("by_bot_id", ["botId"])
      .index("by_sq_number", ["sqNumber"])
      .index("by_status", ["status"])
      .index("by_reserved_at", ["reservedAt"]),

    // Bot session tracking (activity-based 10-minute timeout)
    bot_sessions: defineTable({
      botId: v.string(),
      lastActivity: v.number(), // Timestamp - updated on every user action
      acquiredAt: v.number(),   // When session was first acquired
    })
      .index("by_bot_id", ["botId"])
      .index("by_last_activity", ["lastActivity"]),
  });