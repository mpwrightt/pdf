"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";

interface QueueItem {
  sqNumber: string;
  botId: string;
  status: string;
  claimedAt: string;
  completedAt?: string;
}

interface QueueStatusTableProps {
  items: QueueItem[];
  type: "claims" | "reservations";
}

export function QueueStatusTable({ items, type }: QueueStatusTableProps) {
  const getStatusBadge = (status: string) => {
    const color =
      status === "CLAIMING" || status === "WRITING"
        ? "bg-blue-500 text-white"
        : "bg-green-500 text-white";
    return (
      <Badge className={`${color} border-none`}>
        {status}
      </Badge>
    );
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SQ Number</TableHead>
            <TableHead>Bot ID</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Claimed At</TableHead>
            <TableHead>Completed At</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No {type} found
              </TableCell>
            </TableRow>
          ) : (
            items.map((item, index) => (
              <motion.tr
                key={`${item.sqNumber}-${item.botId}-${index}`}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: index * 0.05 }}
                className="border-b"
              >
                <TableCell className="font-mono font-semibold">
                  {item.sqNumber}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{item.botId}</Badge>
                </TableCell>
                <TableCell>{getStatusBadge(item.status)}</TableCell>
                <TableCell className="text-sm">{item.claimedAt}</TableCell>
                <TableCell className="text-sm">
                  {item.completedAt || "-"}
                </TableCell>
              </motion.tr>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
