# Convex Backend Setup Guide

## Overview

The Convex backend provides atomic queue coordination for the Bot Manager system, preventing race conditions when multiple bots try to claim the same SQ number.

## Important: Convex URL Domains

Convex uses different domains for different types of endpoints:

- **Queries & Mutations**: Use `.convex.cloud` domain
  - Example: `https://energized-spoonbill-94.convex.cloud`
  - Used for: Regular database queries and mutations

- **HTTP Routes**: Use `.convex.site` domain
  - Example: `https://energized-spoonbill-94.convex.site`
  - Used for: HTTP endpoints called from Google Apps Script
  - **This is critical** - HTTP routes will return 404 if you use `.convex.cloud`

## Deployment

### Development Server

```bash
cd convex-backend
npx convex dev
```

This runs the Convex dev server which:
- Watches for code changes
- Automatically pushes updates to the cloud
- Provides real-time debugging

### Configuration Files

#### `convex.json`
```json
{
  "functions": "convex/",
  "node": {
    "externalPackages": ["svix"]
  },
  "authInfo": [{
    "applicationID": "convex",
    "domain": "https://calm-mayfly-1.clerk.accounts.dev"
  }]
}
```

#### `.env.local`
```env
CONVEX_DEPLOYMENT=dev:energized-spoonbill-94
NEXT_PUBLIC_CONVEX_URL=https://energized-spoonbill-94.convex.cloud  # For queries/mutations
CONVEX_HTTP_URL=https://energized-spoonbill-94.convex.site          # For HTTP routes
```

## HTTP Endpoints

All HTTP endpoints are defined in `convex/http.ts`:

### Queue Coordination

- **POST** `/bot-manager/try-claim-sq`
  - Claims an SQ for a bot atomically
  - Request: `{"botId": "BOT1", "sqNumber": "251019-200rpb"}`
  - Response: `{"success": true, "message": "Successfully claimed SQ 251019-200rpb"}`

- **POST** `/bot-manager/release-sq`
  - Releases an SQ claim when bot completes processing
  - Request: `{"botId": "BOT1", "sqNumber": "251019-200rpb"}`
  - Response: `{"success": true, "message": "Released SQ 251019-200rpb"}`

### Status Tracking (for UI dashboard)

- **POST** `/bot-manager/claim-sq`
  - Logs SQ claim status for dashboard

- **POST** `/bot-manager/complete-sq`
  - Logs SQ completion for dashboard

- **POST** `/bot-manager/reserve-refund-rows`
  - Reserves rows in Refund Log

- **POST** `/bot-manager/complete-refund-reservation`
  - Marks refund reservation as complete

## Testing HTTP Endpoints

```bash
# Test claim endpoint (should succeed)
curl -X POST https://energized-spoonbill-94.convex.site/bot-manager/try-claim-sq \
  -H "Content-Type: application/json" \
  -d '{"botId":"TEST","sqNumber":"TEST123"}'

# Test release endpoint (should succeed)
curl -X POST https://energized-spoonbill-94.convex.site/bot-manager/release-sq \
  -H "Content-Type: application/json" \
  -d '{"botId":"TEST","sqNumber":"TEST123"}'
```

## Database Schema

### `sq_claims` Table
- `botId` (string): Which bot claimed the SQ
- `sqNumber` (string): The SQ number
- `status` ("CLAIMING" | "COMPLETED"): Current status
- `claimedAt` (number): Timestamp when claimed
- `completedAt` (optional number): Timestamp when completed

### `refund_reservations` Table
- `botId` (string): Which bot reserved the rows
- `sqNumber` (string): The SQ number
- `startRow` (number): First row reserved
- `rowCount` (number): Number of rows reserved
- `status` ("WRITING" | "COMPLETED"): Current status
- `reservedAt` (number): Timestamp when reserved
- `completedAt` (optional number): Timestamp when completed

## Google Apps Script Integration

In `QueueManagerService_WebApp.gs`, the Convex URL is configured:

```javascript
CONVEX_URL: 'https://energized-spoonbill-94.convex.site',  // Note: .convex.site for HTTP routes
```

The Apps Script calls Convex HTTP endpoints in these functions:
- `tryReserveSQ()` - Calls `/bot-manager/try-claim-sq`
- `releaseSQ()` - Calls `/bot-manager/release-sq`

## Race Condition Prevention

The Convex queue provides atomic SQ reservation:

1. **BOT1** pulls SQ `251019-200rpb` from Discrepancy Log
2. **BOT1** calls `tryReserveSQ()` → Convex claims it atomically
3. **BOT2** tries to pull the same SQ
4. **BOT2** calls `tryReserveSQ()` → Convex rejects (already claimed)
5. **BOT2** moves to next SQ in queue
6. **BOT1** completes processing and calls `releaseSQ()`

This prevents duplicate work and data corruption.

## Troubleshooting

### HTTP Routes Return 404

**Problem**: Endpoints return `HTTP 404` with empty response body

**Solution**: Check that you're using `.convex.site` domain, not `.convex.cloud`

### "Unexpected end of JSON input" in Apps Script

**Problem**: Apps Script logs show `SyntaxError: Unexpected end of JSON input`

**Root Cause**: HTTP endpoint returned 404 with empty body, which can't be parsed as JSON

**Solution**: Fix the Convex URL to use `.convex.site` domain

### Dev Server Not Updating

**Problem**: Code changes aren't reflected in deployed functions

**Solution**:
1. Stop the dev server (`Ctrl+C`)
2. Run `npx convex dev` again
3. Verify you see "✔ Convex functions ready!" message

## Deployment History

- **Initial Setup**: Created convex-backend with minimal dependencies
- **External Packages**: Added `svix` for Clerk webhook verification
- **HTTP Routes Fix**: Changed from `.convex.cloud` to `.convex.site` for HTTP endpoints
