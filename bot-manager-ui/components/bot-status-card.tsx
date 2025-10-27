"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, CheckCircle2, Clock, PlayCircle } from "lucide-react";
import { motion } from "framer-motion";

interface BotStatusCardProps {
  botId: string;
  status: "idle" | "claiming" | "processing";
  currentSQ?: string;
  claimedAt?: string;
  onReserve?: (botId: string) => void;
  onRelease?: (botId: string) => void;
}

export function BotStatusCard({
  botId,
  status,
  currentSQ,
  claimedAt,
  onReserve,
  onRelease,
}: BotStatusCardProps) {
  const getStatusColor = () => {
    switch (status) {
      case "idle":
        return "bg-gray-500";
      case "claiming":
        return "bg-yellow-500";
      case "processing":
        return "bg-green-500";
      default:
        return "bg-gray-500";
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case "idle":
        return <Clock className="h-4 w-4" />;
      case "claiming":
        return <Activity className="h-4 w-4 animate-pulse" />;
      case "processing":
        return <PlayCircle className="h-4 w-4 animate-pulse" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="hover:shadow-lg transition-shadow">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-bold">{botId}</CardTitle>
            <Badge
              variant="outline"
              className={`${getStatusColor()} text-white border-none`}
            >
              <span className="flex items-center gap-1">
                {getStatusIcon()}
                {status.toUpperCase()}
              </span>
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {currentSQ && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Current SQ</p>
              <p className="font-mono font-semibold text-lg">{currentSQ}</p>
            </div>
          )}
          {claimedAt && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Claimed At</p>
              <p className="text-sm font-medium">{claimedAt}</p>
            </div>
          )}
          <div className="flex gap-2">
            {status === "idle" && onReserve && (
              <Button
                onClick={() => onReserve(botId)}
                className="flex-1"
                variant="default"
              >
                <PlayCircle className="h-4 w-4 mr-2" />
                Reserve
              </Button>
            )}
            {status !== "idle" && onRelease && (
              <Button
                onClick={() => onRelease(botId)}
                className="flex-1"
                variant="outline"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Release
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
