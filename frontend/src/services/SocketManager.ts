import { io, Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents } from '../types/events';

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export class SocketManager {
  private static instance: SocketManager;
  private socket: TypedSocket | null = null;
  private currentToken: string | null = null;
  private currentUrl: string | null = null;

  public static getInstance(): SocketManager {
    if (!SocketManager.instance) {
      SocketManager.instance = new SocketManager();
    }
    return SocketManager.instance;
  }

  public connect(token: string, serverUrl?: string): TypedSocket {
    const url = serverUrl || import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || 'http://localhost:8000';

    if (this.socket && this.currentToken === token && this.currentUrl === url) {
      if (!this.socket.connected) {
        this.socket.connect();
      }
      return this.socket;
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.currentToken = token;
    this.currentUrl = url;

    this.socket = io(url, {
      path: '/socket.io',
      auth: { token },
      extraHeaders: {
        Authorization: `Bearer ${token}`,
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    }) as TypedSocket;

    this.socket.on('connect_error', (err) => {
      console.error('[SocketManager] Connection error:', err.message, err);
    });

    return this.socket;
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.currentToken = null;
      this.currentUrl = null;
    }
  }

  public getSocket(): TypedSocket | null {
    return this.socket;
  }

  public isConnected(): boolean {
    return Boolean(this.socket?.connected);
  }

  public emit<K extends keyof ClientToServerEvents | (string & {})>(
    event: K,
    ...args: K extends keyof ClientToServerEvents ? Parameters<ClientToServerEvents[K]> : any[]
  ): void {
    if (this.socket) {
      (this.socket as any).emit(event as string, ...args);
    }
  }

  public on<K extends keyof ServerToClientEvents | (string & {})>(
    event: K,
    listener: K extends keyof ServerToClientEvents ? ServerToClientEvents[K] : (...args: any[]) => void
  ): void {
    if (this.socket) {
      (this.socket as any).on(event as string, listener as any);
    }
  }

  public off<K extends keyof ServerToClientEvents | (string & {})>(
    event: K,
    listener?: K extends keyof ServerToClientEvents ? ServerToClientEvents[K] : (...args: any[]) => void
  ): void {
    if (this.socket) {
      (this.socket as any).off(event as string, listener as any);
    }
  }
}

export const socketManager = SocketManager.getInstance();
