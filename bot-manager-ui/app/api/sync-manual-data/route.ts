import { NextResponse } from "next/server";

/**
 * API Route: Sync Manual Data to Helper Doc
 *
 * Calls the Apps Script to update the Helper Doc with manually entered data
 */

export async function POST(request: Request) {
  try {
    const { botId, sqNumber, manualData } = await request.json();

    const appsScriptUrl = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL;
    const apiKey = process.env.APPS_SCRIPT_API_KEY;

    if (!appsScriptUrl || appsScriptUrl === 'YOUR_APPS_SCRIPT_WEB_APP_URL_HERE') {
      return NextResponse.json(
        { error: "Apps Script URL not configured" },
        { status: 500 }
      );
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: "Apps Script API key not configured" },
        { status: 500 }
      );
    }

    // Call Apps Script to sync manual data
    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'syncManualDataToHelper',
        botId: botId,
        sqNumber: sqNumber,
        manualData: manualData,
        apiKey: apiKey
      })
    });

    if (!response.ok) {
      throw new Error(`Apps Script returned ${response.status}`);
    }

    const result = await response.json();

    if (!result.success) {
      return NextResponse.json(
        { error: result.message || "Failed to sync manual data" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Manual data synced successfully"
    });

  } catch (error) {
    console.error("Error syncing manual data:", error);
    return NextResponse.json(
      { error: "Failed to sync manual data: " + (error as Error).message },
      { status: 500 }
    );
  }
}
