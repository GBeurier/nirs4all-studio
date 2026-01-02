/**
 * WebSocket client for nirs4all webapp.
 *
 * Provides real-time updates for training progress, job status changes,
 * and other long-running operations.
 *
 * Phase 5 Implementation.
 */

export type MessageType =
  | 'job_started'
  | 'job_progress'
  | 'job_completed'
  | 'job_failed'
  | 'job_cancelled'
  | 'job_metrics'
  | 'training_epoch'
  | 'training_batch'
  | 'training_checkpoint'
  | 'ping'
  | 'pong'
  | 'error'
  | 'connected'
  | 'subscribed'
  | 'unsubscribed';

export interface WebSocketMessage {
  type: MessageType;
  channel: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface JobProgressData {
  job_id: string;
  progress: number;
  message: string;
  metrics: Record<string, unknown>;
}

export interface TrainingEpochData {
  job_id: string;
  epoch: number;
  total_epochs: number;
  progress: number;
  train: Record<string, number>;
  val?: Record<string, number>;
}

export interface JobCompletedData {
  job_id: string;
  result: Record<string, unknown>;
}

export interface JobFailedData {
  job_id: string;
  error: string;
  traceback?: string;
}

type MessageHandler = (message: WebSocketMessage) => void;
type ConnectionHandler = () => void;
type ErrorHandler = (error: Event) => void;

export interface WebSocketClientOptions {
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Reconnect delay in ms (default: 3000) */
  reconnectDelay?: number;
  /** Max reconnect attempts (default: 5) */
  maxReconnectAttempts?: number;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
}

/**
 * WebSocket client for connecting to the nirs4all backend.
 *
 * @example
 * ```typescript
 * const ws = new WebSocketClient('ws://localhost:8000/ws');
 *
 * ws.on('job_progress', (msg) => {
 *   console.log('Progress:', msg.data.progress);
 * });
 *
 * ws.connect();
 * ws.subscribe('job:training_abc123');
 * ```
 */
export class WebSocketClient {
  private socket: WebSocket | null = null;
  private url: string;
  private options: Required<WebSocketClientOptions>;
  private reconnectAttempts = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Event handlers
  private messageHandlers: Map<MessageType | 'all', Set<MessageHandler>> = new Map();
  private connectHandlers: Set<ConnectionHandler> = new Set();
  private disconnectHandlers: Set<ConnectionHandler> = new Set();
  private errorHandlers: Set<ErrorHandler> = new Set();

  // Subscribed channels
  private subscriptions: Set<string> = new Set();

  constructor(url: string, options: WebSocketClientOptions = {}) {
    this.url = url;
    this.options = {
      autoReconnect: options.autoReconnect ?? true,
      reconnectDelay: options.reconnectDelay ?? 3000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 5,
      heartbeatInterval: options.heartbeatInterval ?? 30000,
    };
  }

  /**
   * Connect to the WebSocket server.
   */
  connect(): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      this.socket = new WebSocket(this.url);
      this.setupEventListeners();
    } catch (error) {
      console.error('WebSocket connection error:', error);
      this.handleReconnect();
    }
  }

  /**
   * Disconnect from the WebSocket server.
   */
  disconnect(): void {
    this.stopHeartbeat();
    this.stopReconnect();

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  /**
   * Check if the connection is open.
   */
  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Subscribe to a channel for updates.
   *
   * @param channel - Channel name (e.g., "job:abc123")
   */
  subscribe(channel: string): void {
    this.subscriptions.add(channel);

    if (this.isConnected()) {
      this.sendMessage({
        type: 'subscribe' as MessageType,
        channel: 'system',
        data: { channel },
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Unsubscribe from a channel.
   *
   * @param channel - Channel name
   */
  unsubscribe(channel: string): void {
    this.subscriptions.delete(channel);

    if (this.isConnected()) {
      this.sendMessage({
        type: 'unsubscribe' as MessageType,
        channel: 'system',
        data: { channel },
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Register a handler for a specific message type.
   *
   * @param type - Message type to listen for, or 'all' for all messages
   * @param handler - Handler function
   */
  on(type: MessageType | 'all', handler: MessageHandler): void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(handler);
  }

  /**
   * Remove a handler for a message type.
   *
   * @param type - Message type
   * @param handler - Handler function to remove
   */
  off(type: MessageType | 'all', handler: MessageHandler): void {
    this.messageHandlers.get(type)?.delete(handler);
  }

  /**
   * Register a handler for connection events.
   */
  onConnect(handler: ConnectionHandler): void {
    this.connectHandlers.add(handler);
  }

  /**
   * Register a handler for disconnection events.
   */
  onDisconnect(handler: ConnectionHandler): void {
    this.disconnectHandlers.add(handler);
  }

  /**
   * Register a handler for error events.
   */
  onError(handler: ErrorHandler): void {
    this.errorHandlers.add(handler);
  }

  /**
   * Send a ping message to keep the connection alive.
   */
  ping(): void {
    this.sendMessage({
      type: 'ping',
      channel: 'system',
      data: {},
      timestamp: new Date().toISOString(),
    });
  }

  private setupEventListeners(): void {
    if (!this.socket) return;

    this.socket.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.startHeartbeat();

      // Re-subscribe to channels
      for (const channel of this.subscriptions) {
        this.subscribe(channel);
      }

      // Notify handlers
      for (const handler of this.connectHandlers) {
        handler();
      }
    };

    this.socket.onclose = () => {
      console.log('WebSocket disconnected');
      this.stopHeartbeat();

      // Notify handlers
      for (const handler of this.disconnectHandlers) {
        handler();
      }

      // Attempt reconnect
      if (this.options.autoReconnect) {
        this.handleReconnect();
      }
    };

    this.socket.onerror = (error) => {
      console.error('WebSocket error:', error);

      for (const handler of this.errorHandlers) {
        handler(error);
      }
    };

    this.socket.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
  }

  private handleMessage(message: WebSocketMessage): void {
    // Call handlers for this specific message type
    const handlers = this.messageHandlers.get(message.type);
    if (handlers) {
      for (const handler of handlers) {
        handler(message);
      }
    }

    // Call handlers for 'all' messages
    const allHandlers = this.messageHandlers.get('all');
    if (allHandlers) {
      for (const handler of allHandlers) {
        handler(message);
      }
    }
  }

  private sendMessage(message: WebSocketMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.ping();
    }, this.options.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      console.log('Max reconnect attempts reached');
      return;
    }

    this.stopReconnect();
    this.reconnectAttempts++;

    console.log(
      `Reconnecting in ${this.options.reconnectDelay}ms (attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.options.reconnectDelay);
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

/**
 * Create a WebSocket client for job updates.
 *
 * @param jobId - Job ID to subscribe to
 * @returns WebSocket client configured for the job
 */
export function createJobWebSocket(jobId: string): WebSocketClient {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const url = `${protocol}//${host}/ws/job/${jobId}`;

  return new WebSocketClient(url);
}

/**
 * Create a WebSocket client for training updates.
 *
 * @param jobId - Training job ID
 * @returns WebSocket client configured for training updates
 */
export function createTrainingWebSocket(jobId: string): WebSocketClient {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const url = `${protocol}//${host}/ws/training/${jobId}`;

  return new WebSocketClient(url);
}

/**
 * Create the main WebSocket client.
 *
 * @returns WebSocket client connected to the main endpoint
 */
export function createMainWebSocket(): WebSocketClient {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const url = `${protocol}//${host}/ws`;

  return new WebSocketClient(url);
}
