/**
 * Backend Status Component
 *
 * Displays backend connection status with:
 * - Connection indicator (connected/disconnected)
 * - Backend URL
 * - Latency measurement
 * - Periodic health checks
 * - Manual test connection button
 *
 * Phase 5: System Information & Diagnostics
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { performHealthCheck } from "@/api/client";
import type { HealthCheckWithLatency } from "@/types/settings";
import { formatRelativeTime } from "@/utils/formatters";

interface BackendStatusProps {
  /** Health check interval in seconds (default: 30) */
  checkInterval?: number;
  /** Whether to show compact version */
  compact?: boolean;
}

type ConnectionStatus = "connected" | "disconnected" | "checking" | "degraded";

interface StatusHistoryEntry {
  timestamp: string;
  latency_ms: number;
  success: boolean;
}

const MAX_HISTORY = 10;

export function BackendStatus({
  checkInterval = 30,
  compact = false,
}: BackendStatusProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ConnectionStatus>("checking");
  const [lastCheck, setLastCheck] = useState<HealthCheckWithLatency | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [history, setHistory] = useState<StatusHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const backendUrl = new URL("/api", window.location.origin).toString();

  const performCheck = useCallback(async () => {
    setIsChecking(true);
    setError(null);

    try {
      const result = await performHealthCheck();
      setLastCheck(result);
      setStatus(result.latency_ms > 1000 ? "degraded" : "connected");

      setHistory((prev) => {
        const newEntry: StatusHistoryEntry = {
          timestamp: result.timestamp,
          latency_ms: result.latency_ms,
          success: true,
        };
        return [newEntry, ...prev].slice(0, MAX_HISTORY);
      });
    } catch (err) {
      setStatus("disconnected");
      setError(err instanceof Error ? err.message : "Connection failed");

      setHistory((prev) => {
        const newEntry: StatusHistoryEntry = {
          timestamp: new Date().toISOString(),
          latency_ms: 0,
          success: false,
        };
        return [newEntry, ...prev].slice(0, MAX_HISTORY);
      });
    } finally {
      setIsChecking(false);
    }
  }, []);

  // Initial check and periodic checks
  useEffect(() => {
    performCheck();

    intervalRef.current = setInterval(performCheck, checkInterval * 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [performCheck, checkInterval]);

  const getStatusColor = () => {
    switch (status) {
      case "connected":
        return "text-green-500";
      case "degraded":
        return "text-yellow-500";
      case "disconnected":
        return "text-destructive";
      case "checking":
        return "text-muted-foreground";
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case "connected":
        return <CheckCircle2 className={`h-5 w-5 ${getStatusColor()}`} />;
      case "degraded":
        return <AlertCircle className={`h-5 w-5 ${getStatusColor()}`} />;
      case "disconnected":
        return <XCircle className={`h-5 w-5 ${getStatusColor()}`} />;
      case "checking":
        return (
          <RefreshCw
            className={`h-5 w-5 ${getStatusColor()} animate-spin`}
          />
        );
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "connected":
        return t("settings.advanced.backend.status.connected");
      case "degraded":
        return t("settings.advanced.backend.status.degraded");
      case "disconnected":
        return t("settings.advanced.backend.status.disconnected");
      case "checking":
        return t("settings.advanced.backend.status.checking");
    }
  };

  const getLatencyColor = (latency: number) => {
    if (latency < 100) return "text-green-500";
    if (latency < 500) return "text-yellow-500";
    return "text-destructive";
  };

  // Calculate average latency from history
  const avgLatency =
    history.filter((h) => h.success).length > 0
      ? Math.round(
          history.filter((h) => h.success).reduce((sum, h) => sum + h.latency_ms, 0) /
            history.filter((h) => h.success).length
        )
      : 0;

  // Calculate success rate
  const successRate =
    history.length > 0
      ? Math.round((history.filter((h) => h.success).length / history.length) * 100)
      : 100;

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-2">
          {status === "connected" ? (
            <Wifi className="h-4 w-4 text-green-500" />
          ) : status === "disconnected" ? (
            <WifiOff className="h-4 w-4 text-destructive" />
          ) : (
            <Activity className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">{getStatusText()}</span>
        </div>
        {lastCheck && status !== "disconnected" && (
          <Badge variant="outline" className={getLatencyColor(lastCheck.latency_ms)}>
            {lastCheck.latency_ms}ms
          </Badge>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 ml-auto"
          onClick={performCheck}
          disabled={isChecking}
          aria-label={t("settings.advanced.backend.status.testConnection")}
        >
          <RefreshCw
            className={`h-3 w-3 ${isChecking ? "animate-spin" : ""}`}
          />
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              {t("settings.advanced.backend.status.title")}
            </CardTitle>
            <CardDescription>{t("settings.advanced.backend.status.description")}</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={performCheck}
            disabled={isChecking}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isChecking ? "animate-spin" : ""}`}
            />
            {t("settings.advanced.backend.status.testConnection")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Indicator */}
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-3">
            {getStatusIcon()}
            <div>
              <p className={`font-medium ${getStatusColor()}`}>
                {getStatusText()}
              </p>
              <p className="text-xs text-muted-foreground">
                {backendUrl}
              </p>
            </div>
          </div>
          {lastCheck && status !== "disconnected" && (
            <div className="text-right">
              <p className={`font-mono font-medium ${getLatencyColor(lastCheck.latency_ms)}`}>
                {lastCheck.latency_ms}ms
              </p>
              <p className="text-xs text-muted-foreground">
                {formatRelativeTime(lastCheck.timestamp)}
              </p>
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Latency Stats */}
        {history.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("settings.advanced.backend.status.avgLatency")}</p>
              <p className={`text-lg font-mono font-medium ${getLatencyColor(avgLatency)}`}>
                {avgLatency}ms
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("settings.advanced.backend.status.successRate")}</p>
              <div className="flex items-center gap-2">
                <p className={`text-lg font-mono font-medium ${
                  successRate === 100 ? "text-green-500" : successRate >= 80 ? "text-yellow-500" : "text-destructive"
                }`}>
                  {successRate}%
                </p>
                <Progress value={successRate} className="flex-1 h-2" />
              </div>
            </div>
          </div>
        )}

        {/* Recent History */}
        {history.length > 1 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t("settings.advanced.backend.status.recentChecks")}</p>
            <div className="flex gap-1 h-8 items-end">
              {history.slice(0, 10).reverse().map((entry, index) => {
                const height = entry.success
                  ? Math.max(20, Math.min(100, (1000 - entry.latency_ms) / 10))
                  : 20;
                return (
                  <div
                    key={index}
                    className={`flex-1 rounded-t transition-all ${
                      entry.success
                        ? entry.latency_ms < 100
                          ? "bg-green-500"
                          : entry.latency_ms < 500
                          ? "bg-yellow-500"
                          : "bg-orange-500"
                        : "bg-destructive"
                    }`}
                    style={{ height: `${height}%` }}
                    title={
                      entry.success
                        ? `${entry.latency_ms}ms`
                        : t("settings.advanced.backend.status.failed")
                    }
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Auto-refresh indicator */}
        <p className="text-xs text-muted-foreground text-center">
          {t("settings.advanced.backend.status.autoRefreshEvery", { seconds: checkInterval })}
        </p>
      </CardContent>
    </Card>
  );
}
