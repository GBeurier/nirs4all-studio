import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WebSocketClient,
  WebSocketMessage,
  MessageType,
  createJobWebSocket,
  createTrainingWebSocket,
  createMainWebSocket,
  JobProgressData,
  TrainingEpochData,
} from '@/lib/websocket';

/**
 * Hook for using the main WebSocket connection.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isConnected, subscribe, lastMessage } = useWebSocket();
 *
 *   useEffect(() => {
 *     subscribe('job:abc123');
 *   }, [subscribe]);
 *
 *   return <div>Connected: {isConnected ? 'Yes' : 'No'}</div>;
 * }
 * ```
 */
export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const clientRef = useRef<WebSocketClient | null>(null);

  useEffect(() => {
    const client = createMainWebSocket();
    clientRef.current = client;

    client.onConnect(() => setIsConnected(true));
    client.onDisconnect(() => setIsConnected(false));
    client.on('all', (msg) => setLastMessage(msg));

    client.connect();

    return () => {
      client.disconnect();
    };
  }, []);

  const subscribe = useCallback((channel: string) => {
    clientRef.current?.subscribe(channel);
  }, []);

  const unsubscribe = useCallback((channel: string) => {
    clientRef.current?.unsubscribe(channel);
  }, []);

  return {
    isConnected,
    lastMessage,
    subscribe,
    unsubscribe,
    client: clientRef.current,
  };
}

/**
 * Hook for subscribing to a specific job's updates.
 *
 * @param jobId - The job ID to subscribe to
 *
 * @example
 * ```tsx
 * function TrainingProgress({ jobId }: { jobId: string }) {
 *   const { progress, status, metrics, error } = useJobUpdates(jobId);
 *
 *   return (
 *     <div>
 *       <p>Status: {status}</p>
 *       <p>Progress: {progress}%</p>
 *       {error && <p>Error: {error}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useJobUpdates(jobId: string | null) {
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [metrics, setMetrics] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<WebSocketClient | null>(null);

  useEffect(() => {
    if (!jobId) return;

    const client = createJobWebSocket(jobId);
    clientRef.current = client;

    client.onConnect(() => setIsConnected(true));
    client.onDisconnect(() => setIsConnected(false));

    client.on('job_started', () => {
      setStatus('running');
      setProgress(0);
    });

    client.on('job_progress', (msg) => {
      const data = msg.data as unknown as JobProgressData;
      setStatus('running');
      setProgress(data.progress);
      setProgressMessage(data.message);
      setMetrics(data.metrics);
    });

    client.on('job_completed', (msg) => {
      setStatus('completed');
      setProgress(100);
      setResult(msg.data.result as Record<string, unknown>);
    });

    client.on('job_failed', (msg) => {
      setStatus('failed');
      setError(msg.data.error as string);
    });

    client.on('job_cancelled', () => {
      setStatus('cancelled');
    });

    client.on('job_metrics', (msg) => {
      setMetrics(msg.data.metrics as Record<string, unknown>);
    });

    client.connect();

    return () => {
      client.disconnect();
    };
  }, [jobId]);

  return {
    isConnected,
    status,
    progress,
    progressMessage,
    metrics,
    result,
    error,
  };
}

/**
 * Hook for subscribing to training job updates with epoch-level detail.
 *
 * @param jobId - The training job ID
 *
 * @example
 * ```tsx
 * function TrainingMonitor({ jobId }: { jobId: string }) {
 *   const { currentEpoch, totalEpochs, trainMetrics, valMetrics, history } = useTrainingUpdates(jobId);
 *
 *   return (
 *     <div>
 *       <p>Epoch: {currentEpoch} / {totalEpochs}</p>
 *       <p>Loss: {trainMetrics.loss}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useTrainingUpdates(jobId: string | null) {
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | null>(null);
  const [currentEpoch, setCurrentEpoch] = useState(0);
  const [totalEpochs, setTotalEpochs] = useState(0);
  const [progress, setProgress] = useState(0);
  const [trainMetrics, setTrainMetrics] = useState<Record<string, number>>({});
  const [valMetrics, setValMetrics] = useState<Record<string, number> | null>(null);
  const [history, setHistory] = useState<TrainingEpochData[]>([]);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<WebSocketClient | null>(null);

  useEffect(() => {
    if (!jobId) return;

    const client = createTrainingWebSocket(jobId);
    clientRef.current = client;

    client.onConnect(() => setIsConnected(true));
    client.onDisconnect(() => setIsConnected(false));

    client.on('job_started', () => {
      setStatus('running');
      setProgress(0);
      setHistory([]);
    });

    client.on('training_epoch', (msg) => {
      const data = msg.data as unknown as TrainingEpochData;
      setStatus('running');
      setCurrentEpoch(data.epoch);
      setTotalEpochs(data.total_epochs);
      setProgress(data.progress);
      setTrainMetrics(data.train);
      setValMetrics(data.val || null);
      setHistory((prev: TrainingEpochData[]) => [...prev, data]);
    });

    client.on('job_progress', (msg) => {
      const data = msg.data as unknown as JobProgressData;
      setProgress(data.progress);
    });

    client.on('job_completed', (msg) => {
      setStatus('completed');
      setProgress(100);
      setResult(msg.data.result as Record<string, unknown>);
    });

    client.on('job_failed', (msg) => {
      setStatus('failed');
      setError(msg.data.error as string);
    });

    client.on('job_cancelled', () => {
      setStatus('cancelled');
    });

    client.connect();

    return () => {
      client.disconnect();
    };
  }, [jobId]);

  return {
    isConnected,
    status,
    currentEpoch,
    totalEpochs,
    progress,
    trainMetrics,
    valMetrics,
    history,
    result,
    error,
  };
}

/**
 * Hook for subscribing to specific message types.
 *
 * @param messageType - The message type to listen for
 * @param callback - Callback function when message is received
 */
export function useWebSocketMessage(
  messageType: MessageType | 'all',
  callback: (message: WebSocketMessage) => void
) {
  const { client } = useWebSocket();

  useEffect(() => {
    if (!client) return;

    client.on(messageType, callback);

    return () => {
      client.off(messageType, callback);
    };
  }, [client, messageType, callback]);
}
