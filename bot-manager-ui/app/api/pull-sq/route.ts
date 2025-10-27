import { NextResponse } from "next/server";

/**
 * API Route: Pull Next SQ from Discrep Sheet
 *
 * Calls the Apps Script web app to pull and claim the next SQ
 */

export async function POST(request: Request) {
  try {
    const { botId } = await request.json();

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

    // Call Apps Script to pull and claim SQ
    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'pullNextSQ',
        botId: botId,
        apiKey: apiKey
      })
    });

    if (!response.ok) {
      throw new Error(`Apps Script returned ${response.status}`);
    }

    const result = await response.json();

    if (!result.success) {
      return NextResponse.json(
        { error: result.message || "Failed to pull SQ" },
        { status: 404 }
      );
    }

    return NextResponse.json(result.sqData);

  } catch (error) {
    console.error("Error pulling SQ:", error);
    return NextResponse.json(
      { error: "Failed to pull SQ from Discrep sheet: " + (error as Error).message },
      { status: 500 }
    );
  }
}
