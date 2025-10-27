"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ArrowLeft, Download, Upload, ExternalLink, Play,
  CheckCircle, AlertCircle, Loader2
} from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";

export default function BotOperationPage() {
  const params = useParams();
  const router = useRouter();
  const botId = params.botId as string;

  const queueStatus = useQuery(api.queue.getQueueStatus);
  const tryClaimSQ = useMutation(api.queue.tryClaimSQ);
  const releaseSQ = useMutation(api.queue.releaseSQ);

  const [isProcessing, setIsProcessing] = useState(false);
  const [currentSQ, setCurrentSQ] = useState<any>(null);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [manualData, setManualData] = useState<Record<string, string>>({});

  // Get current bot's claim
  const botClaim = queueStatus?.sqClaims?.find(
    (c) => c.botId === botId && c.status === "CLAIMING"
  );

  const handlePullAndClaim = async () => {
    setIsProcessing(true);
    try {
      const response = await fetch("/api/pull-sq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to pull SQ");
      }

      const sqData = await response.json();

      // Claim it in Convex
      const claimResult = await tryClaimSQ({
        botId,
        sqNumber: sqData.sqNumber,
      });

      if (claimResult.success) {
        setCurrentSQ(sqData);

        // Check for missing fields
        if (sqData.missingFields && sqData.missingFields.length > 0) {
          setMissingFields(sqData.missingFields);
        }

        // Auto-open SQ link
        if (sqData.sqLink) {
          window.open(sqData.sqLink, "_blank");
        }

        alert(`Successfully claimed SQ: ${sqData.sqNumber}`);
      } else {
        alert(claimResult.message);
      }
    } catch (error) {
      console.error("Error pulling SQ:", error);
      alert(`Error: ${error}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUploadToRefundLog = async () => {
    if (!currentSQ) return;

    setIsProcessing(true);
    try {
      const response = await fetch("/api/upload-refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId,
          sqData: currentSQ,
          manualData,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to upload to Refund Log");
      }

      // Release the SQ claim
      await releaseSQ({
        botId,
        sqNumber: currentSQ.sqNumber,
      });

      alert("Successfully uploaded to Refund Log!");
      setCurrentSQ(null);
      setManualData({});
      setMissingFields([]);
    } catch (error) {
      console.error("Error uploading:", error);
      alert(`Error: ${error}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSyncManualData = async () => {
    // Validate all missing fields are filled
    const unfilled = missingFields.filter((field) => !manualData[field]);
    if (unfilled.length > 0) {
      alert(`Please fill in: ${unfilled.join(", ")}`);
      return;
    }

    setIsProcessing(true);
    try {
      const response = await fetch("/api/sync-manual-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId,
          sqNumber: currentSQ.sqNumber,
          manualData,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to sync manual data");
      }

      // Clear missing fields
      setMissingFields([]);
      alert("Manual data synced! You can now upload to Refund Log.");
    } catch (error) {
      console.error("Error syncing manual data:", error);
      alert(`Error: ${error}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">{botId} Operation Console</h1>
            <p className="text-muted-foreground">
              Process discrepancy refunds step-by-step
            </p>
          </div>
        </div>

        {/* Status Alert */}
        {botClaim ? (
          <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-900 dark:text-green-100">
              Currently processing: <span className="font-mono font-bold">{botClaim.sqNumber}</span>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {botId} is idle. Click "Pull & Claim Next SQ" to start processing.
            </AlertDescription>
          </Alert>
        )}

        {/* Main Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Step 1: Pull & Claim SQ</CardTitle>
            <CardDescription>
              Fetch the next unclaimed SQ from the Discrep Sheet and automatically open the SQ link
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={handlePullAndClaim}
              disabled={isProcessing || !!botClaim}
              size="lg"
              className="w-full"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Download className="h-5 w-5 mr-2" />
                  Pull & Claim Next SQ
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* SQ Data Display */}
        {currentSQ && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Current SQ Data</span>
                  <Badge variant="outline" className="text-lg">
                    {currentSQ.sqNumber}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Order Number</p>
                    <p className="font-semibold">{currentSQ.orderNumber || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Buyer Name</p>
                    <p className="font-semibold">{currentSQ.buyerName || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Game</p>
                    <p className="font-semibold">{currentSQ.game}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Card Name</p>
                    <p className="font-semibold">{currentSQ.cardName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Set</p>
                    <p className="font-semibold">{currentSQ.setName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Quantity</p>
                    <p className="font-semibold">{currentSQ.qty}</p>
                  </div>
                </div>

                {currentSQ.sqLink && (
                  <Button
                    variant="outline"
                    onClick={() => window.open(currentSQ.sqLink, "_blank")}
                    className="w-full"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open SQ Link
                  </Button>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Manual Entry for Missing Fields */}
        {missingFields.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card className="border-yellow-500">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-yellow-600" />
                  Step 2: Fill Missing Information
                </CardTitle>
                <CardDescription>
                  Some fields are missing. Please enter them manually based on the SQ.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {missingFields.map((field) => (
                  <div key={field}>
                    <label className="text-sm font-medium block mb-2">
                      {field}
                    </label>
                    <input
                      type="text"
                      value={manualData[field] || ""}
                      onChange={(e) =>
                        setManualData({ ...manualData, [field]: e.target.value })
                      }
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder={`Enter ${field}`}
                    />
                  </div>
                ))}
                <Button onClick={handleSyncManualData} className="w-full">
                  <Play className="h-4 w-4 mr-2" />
                  Sync Manual Data
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Upload to Refund Log */}
        {currentSQ && (
          <Card>
            <CardHeader>
              <CardTitle>Step 3: Upload to Refund Log</CardTitle>
              <CardDescription>
                Upload the processed SQ data to the Refund Log sheet
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={handleUploadToRefundLog}
                disabled={isProcessing || missingFields.length > 0}
                size="lg"
                className="w-full"
                variant="default"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-5 w-5 mr-2" />
                    Upload to Refund Log
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
