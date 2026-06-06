import { useEffect } from "react";

import { getWebSocketBaseUrl } from "@/lib/websocket";

import type { ProgressState, WsMessage } from "./types";

// WebSocket connection for real-time updates
export function useRunWebSocket(
  runId: string,
  onUpdate: (data: WsMessage) => void,
  onLog: (log: string) => void,
  onProgress: (state: ProgressState) => void,
  onReconnecting: (attempt: number, maxAttempts: number) => void,
  onConnected: () => void
) {
  useEffect(() => {
    if (!runId) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;

    const connect = async () => {
      try {
        const baseUrl = await getWebSocketBaseUrl();
        const wsUrl = `${baseUrl}/ws`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          reconnectAttempts = 0;
          onConnected();
          // Subscribe to job channel
          ws?.send(JSON.stringify({
            type: "subscribe",
            channel: `job:${runId}`,
            data: {},
          }));
        };

        ws.onmessage = (event) => {
          try {
            const message: WsMessage = JSON.parse(event.data);
            if (message.channel === `job:${runId}` || message.channel === "system") {
              onUpdate(message);

              // Handle progress updates with step messages
              if (message.type === "job_progress" && message.data) {
                const { progress, message: stepMessage } = message.data;
                if (progress !== undefined || stepMessage) {
                  onProgress({
                    progress: progress ?? 0,
                    message: stepMessage || "",
                    timestamp: Date.now(),
                  });
                }
              }

              // Extract logs from progress messages
              if (message.data?.log) {
                onLog(message.data.log);
              }
              if (message.data?.message && message.type === "job_progress") {
                // Also log progress messages
                const progressMsg = `[INFO] ${message.data.message}`;
                if (!message.data.log) {
                  onLog(progressMsg);
                }
              }
            }
          } catch {
            // Ignore parse errors
          }
        };

        ws.onclose = () => {
          // Attempt reconnection with exponential backoff
          if (reconnectAttempts < maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
            reconnectAttempts++;
            onReconnecting(reconnectAttempts, maxReconnectAttempts);
            reconnectTimer = setTimeout(() => {
              void connect();
            }, delay);
          }
        };

        ws.onerror = () => {
          ws?.close();
        };
      } catch {
        // WebSocket not available
      }
    };

    void connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.close();
      }
    };
  }, [runId, onUpdate, onLog, onProgress, onReconnecting, onConnected]);
}
