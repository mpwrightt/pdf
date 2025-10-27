"use client";

import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, Activity, PlayCircle, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";

export default function Home() {
  const queueStatus = useQuery(api.queue.getQueueStatus);

  const AVAILABLE_BOTS = ["BOT1", "BOT2", "BOT3"];

  const getBotStatus = (botId: string) => {
    if (!queueStatus?.sqClaims) return { status: "idle" as const, sqNumber: undefined };

    const claim = queueStatus.sqClaims.find(
      (c) => c.botId === botId && c.status === "CLAIMING"
    );

    if (claim) {
      return {
        status: "active" as const,
        sqNumber: claim.sqNumber,
        claimedAt: claim.claimedAt,
      };
    }

    return { status: "idle" as const, sqNumber: undefined };
  };

  if (!queueStatus) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-8">
        <div className="max-w-5xl mx-auto space-y-8">
          <Skeleton className="h-12 w-64" />
          <div className="grid md:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-64" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="text-center space-y-2">
            <h1 className="text-5xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600">
              Bot Operations Center
            </h1>
            <p className="text-muted-foreground text-lg">
              Select a bot to begin processing discrepancy refunds
            </p>
          </div>
        </motion.div>

        {/* Bot Cards */}
        <div className="grid md:grid-cols-3 gap-6">
          {AVAILABLE_BOTS.map((botId, index) => {
            const botStatus = getBotStatus(botId);
            const isActive = botStatus.status === "active";

            return (
              <motion.div
                key={botId}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="hover:shadow-xl transition-all duration-300 border-2 hover:border-blue-500">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Bot className="h-6 w-6 text-blue-600" />
                        <CardTitle className="text-2xl font-bold">{botId}</CardTitle>
                      </div>
                      <Badge
                        variant="outline"
                        className={`${
                          isActive
                            ? "bg-green-500 text-white border-none animate-pulse"
                            : "bg-gray-500 text-white border-none"
                        }`}
                      >
                        {isActive ? (
                          <span className="flex items-center gap-1">
                            <Activity className="h-3 w-3" />
                            ACTIVE
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            IDLE
                          </span>
                        )}
                      </Badge>
                    </div>
                    <CardDescription>
                      {isActive
                        ? `Processing: ${botStatus.sqNumber}`
                        : "Ready to process discrepancies"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {isActive && (
                      <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-md space-y-1">
                        <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                          Current SQ
                        </p>
                        <p className="font-mono text-lg font-bold text-blue-600">
                          {botStatus.sqNumber}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Started: {botStatus.claimedAt}
                        </p>
                      </div>
                    )}

                    <Link href={`/bot/${botId}`} className="block">
                      <Button
                        className="w-full"
                        size="lg"
                        variant={isActive ? "default" : "outline"}
                      >
                        <PlayCircle className="h-5 w-5 mr-2" />
                        {isActive ? "Continue Processing" : "Start Operating"}
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Stats Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="grid md:grid-cols-2 gap-4"
        >
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Active Claims
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">
                {queueStatus.sqClaims?.filter((c) => c.status === "CLAIMING").length || 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Processed Today
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">
                {queueStatus.sqClaims?.filter((c) => c.status === "COMPLETED").length || 0}
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
