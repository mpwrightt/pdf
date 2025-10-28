/**
 * EMERGENCY CLEANUP SCRIPT
 *
 * Run this when the system is stuck/slow to clear out all Convex data
 *
 * Usage:
 *   cd convex-backend
 *   node cleanup-convex.js
 */

const { ConvexHttpClient } = require("convex/browser");

// Your Convex deployment URL
const CONVEX_URL = "https://energized-spoonbill-94.convex.cloud";

async function cleanup() {
  console.log("🧹 Starting emergency cleanup...");
  console.log("Connecting to:", CONVEX_URL);

  const client = new ConvexHttpClient(CONVEX_URL);

  try {
    // Force cleanup all claims and reservations
    console.log("\n1️⃣ Cleaning up SQ claims and refund reservations...");
    const claimsResult = await client.mutation("queue:forceCleanupAll", {});
    console.log("✅ Deleted:", claimsResult);

    // Force release all sessions
    console.log("\n2️⃣ Releasing all bot sessions...");
    const sessionsResult = await client.mutation("sessions:forceReleaseAllSessions", {});
    console.log("✅ Deleted:", sessionsResult);

    console.log("\n✨ Cleanup complete! All Convex data cleared.");
    console.log("\n⚠️  All bots are now available and all claims have been released.");
    console.log("Users can now select any bot and pull SQs.");

  } catch (error) {
    console.error("\n❌ Error during cleanup:", error);
    console.error("\nTry running from the Convex dashboard instead:");
    console.error("1. Go to: https://dashboard.convex.dev");
    console.error("2. Select your project: energized-spoonbill-94");
    console.error("3. Go to Functions tab");
    console.error("4. Run: queue:forceCleanupAll");
    console.error("5. Run: sessions:forceReleaseAllSessions");
  } finally {
    client.close();
  }
}

cleanup();
