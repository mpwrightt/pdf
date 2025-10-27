import { NextResponse } from "next/server";

/**
 * API Route: Upload to Refund Log
 *
 * Calls the Apps Script web app to upload SQ data to the Refund Log
 */

export async function POST(request: Request) {
  try {
    const { botId, sqData, manualData } = await request.json();

    const appsScriptUrl = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL;
    const apiKey = process.env.APPS_SCRIPT_API_KEY;

    if (!appsScriptUrl || appsScriptUrl === 'YOUR_APPS_SCRIPT_WEB_APP_URL_HERE') {
      return NextResponse.json(
        { error: "Apps Script URL not configured. Please deploy the Apps Script and add the URL to .env.local" },
        { status: 500 }
      );
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: "Apps Script API key not configured" },
        { status: 500 }
      );
    }

    // Call Apps Script to upload to Refund Log
    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'uploadToRefundLog',
        sqData: sqData,
        manualData: manualData || {},
        apiKey: apiKey
      })
    });

    if (!response.ok) {
      throw new Error(`Apps Script returned ${response.status}`);
    }

    const result = await response.json();

    if (!result.success) {
      return NextResponse.json(
        { error: result.message || "Failed to upload" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Successfully uploaded to Refund Log",
      row: result.row
    });

  } catch (error) {
    console.error("Error uploading to Refund Log:", error);
    return NextResponse.json(
      { error: "Failed to upload to Refund Log: " + (error as Error).message },
      { status: 500 }
    );
  }
}
