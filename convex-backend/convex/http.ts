import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { WebhookEvent } from "@clerk/backend";
import { Webhook } from "svix";
import { transformWebhookData } from "./paymentAttemptTypes";

const http = httpRouter();

http.route({
  path: "/clerk-users-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const event = await validateRequest(request);
    if (!event) {
      return new Response("Error occured", { status: 400 });
    }
    switch ((event as any).type) {
      case "user.created": // intentional fallthrough
      case "user.updated":
        await ctx.runMutation(internal.users.upsertFromClerk, {
          data: event.data as any,
        });
        break;

      case "user.deleted": {
        const clerkUserId = (event.data as any).id!;
        await ctx.runMutation(internal.users.deleteFromClerk, { clerkUserId });
        break;
      }

      case "paymentAttempt.updated": {
        const paymentAttemptData = transformWebhookData((event as any).data);
        await ctx.runMutation(internal.paymentAttempts.savePaymentAttempt, {
          paymentAttemptData,
        });
        break;
      }

      default:
        console.log("Ignored webhook event", (event as any).type);
    }

    return new Response(null, { status: 200 });
  }),
});

// Bot Manager HTTP Endpoints
http.route({
  path: "/bot-manager/claim-sq",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { botId, sqNumber, status, claimedAt } = body;

      if (!botId || !sqNumber || !status || !claimedAt) {
        return new Response(
          JSON.stringify({ success: false, message: "Missing required fields" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      await ctx.runMutation(internal.sqClaims.createClaim, {
        botId,
        sqNumber,
        status,
        claimedAt,
      });

      return new Response(
        JSON.stringify({ success: true, message: "Claim created successfully" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error: any) {
      console.error("Error creating SQ claim:", error);
      return new Response(
        JSON.stringify({ success: false, message: error.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }),
});

http.route({
  path: "/bot-manager/complete-sq",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { botId, sqNumber, completedAt } = body;

      if (!botId || !sqNumber || !completedAt) {
        return new Response(
          JSON.stringify({ success: false, message: "Missing required fields" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      await ctx.runMutation(internal.sqClaims.completeClaim, {
        botId,
        sqNumber,
        completedAt,
      });

      return new Response(
        JSON.stringify({ success: true, message: "Claim completed successfully" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error: any) {
      console.error("Error completing SQ claim:", error);
      return new Response(
        JSON.stringify({ success: false, message: error.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }),
});

http.route({
  path: "/bot-manager/reserve-refund-rows",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { botId, sqNumber, startRow, rowCount, reservedAt } = body;

      if (!botId || !sqNumber || !startRow || !rowCount || !reservedAt) {
        return new Response(
          JSON.stringify({ success: false, message: "Missing required fields" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      await ctx.runMutation(internal.sqClaims.createRefundReservation, {
        botId,
        sqNumber,
        startRow,
        rowCount,
        reservedAt,
      });

      return new Response(
        JSON.stringify({ success: true, message: "Reservation created successfully" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error: any) {
      console.error("Error creating refund reservation:", error);
      return new Response(
        JSON.stringify({ success: false, message: error.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }),
});

http.route({
  path: "/bot-manager/complete-refund-reservation",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { botId, sqNumber, completedAt } = body;

      if (!botId || !sqNumber || !completedAt) {
        return new Response(
          JSON.stringify({ success: false, message: "Missing required fields" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      await ctx.runMutation(internal.sqClaims.completeRefundReservation, {
        botId,
        sqNumber,
        completedAt,
      });

      return new Response(
        JSON.stringify({ success: true, message: "Reservation completed successfully" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error: any) {
      console.error("Error completing refund reservation:", error);
      return new Response(
        JSON.stringify({ success: false, message: error.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }),
});

// Queue management endpoints
http.route({
  path: "/bot-manager/try-claim-sq",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { botId, sqNumber } = body;

      if (!botId || !sqNumber) {
        return new Response(
          JSON.stringify({ success: false, message: "Missing botId or sqNumber" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const result = await ctx.runMutation(internal.queue.tryClaimSQInternal, {
        botId,
        sqNumber,
      });

      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error: any) {
      console.error("Error trying to claim SQ:", error);
      return new Response(
        JSON.stringify({ success: false, message: error.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }),
});

http.route({
  path: "/bot-manager/release-sq",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { botId, sqNumber } = body;

      if (!botId || !sqNumber) {
        return new Response(
          JSON.stringify({ success: false, message: "Missing botId or sqNumber" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const result = await ctx.runMutation(internal.queue.releaseSQInternal, {
        botId,
        sqNumber,
      });

      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error: any) {
      console.error("Error releasing SQ:", error);
      return new Response(
        JSON.stringify({ success: false, message: error.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }),
});

async function validateRequest(req: Request): Promise<WebhookEvent | null> {
  const payloadString = await req.text();
  const svixHeaders = {
    "svix-id": req.headers.get("svix-id")!,
    "svix-timestamp": req.headers.get("svix-timestamp")!,
    "svix-signature": req.headers.get("svix-signature")!,
  };
  const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET!);
  try {
    return wh.verify(payloadString, svixHeaders) as unknown as WebhookEvent;
  } catch (error) {
    console.error("Error verifying webhook event", error);
    return null;
  }
}

export default http;